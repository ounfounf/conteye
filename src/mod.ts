import type { DuckDBConnection } from "@duckdb/node-api";
import { DuckDBInstance } from "@duckdb/node-api";
import { ProgressBar } from "@std/cli/unstable-progress-bar";
import { dirname } from "@std/path/dirname";
import { WorkerPool } from "~/work/worker_pool.ts";
import type { PathInfo, FileInfo } from '~/fs.ts'
import { setupLogging, getAppLogger } from "~/logger.ts";

const logger = getAppLogger("main");

export const sqliteTableSchema = `
CREATE TABLE IF NOT EXISTS paths (
    path TEXT PRIMARY KEY,
    parent TEXT,
    isFile INTEGER NOT NULL,
    size INTEGER,
    mtime INTEGER NOT NULL,
    ctime INTEGER NOT NULL,
    atime INTEGER NOT NULL,
    FOREIGN KEY (parent) REFERENCES paths(path)
);

CREATE TABLE IF NOT EXISTS files (
    path TEXT PRIMARY KEY,
    xxhash3 TEXT NOT NULL,
    FOREIGN KEY (path) REFERENCES paths(path)
);
`

export async function stat (path: string, pool: WorkerPool): Promise<PathInfo> {
    const [stat, realPath] = await Promise.all([
      pool.execute<Deno.FileInfo>({ action: 'stat', path }),
      pool.execute<string>({ action: 'realPath', path })
    ]);
    const parentPath = dirname(realPath)

    // If parent is the same as the path, it's a root (e.g., C:\ on Windows, / on Unix)
    const parent = parentPath === realPath ? null : parentPath

    const info = {
        path: realPath,
        parent,
        mtime: stat.mtime ? Math.floor(stat.mtime.getTime()) : 0,
        ctime: stat.ctime ? Math.floor(stat.ctime.getTime()) : 0,
        atime: stat.atime ? Math.floor(stat.atime.getTime()) : 0,
    }

    if (stat.isFile) {
        return {
            isFile: true,
            size: stat.size,
            ...info
        }
    } else if (stat.isDirectory) {
        return {
            isFile: false,
            size: null,
            ...info
        }
    } else {
        throw new Error(`Unsupported file type at path: ${path}`);
    }
}

export async function integrate (root: string, db: DuckDBConnection, pool: WorkerPool): Promise<void> {
    logger.info `Starting integration for root ${root}`;
    using stack = new DisposableStack()
    const bar = new ProgressBar({max: 0})
    stack.defer(() => bar.stop())

    const selectMtimeStmt = await db.prepare(`
        SELECT mtime FROM paths WHERE path = $path
    `)

    const insertPathStmt = await db.prepare(`
        INSERT OR REPLACE INTO paths (path, parent, isFile, size, mtime, ctime, atime)
        VALUES ($path, $parent, $isFile, $size, $mtime, $ctime, $atime)
    `)

    const insertFileStmt = await db.prepare(`
        INSERT OR REPLACE INTO files (path, xxhash3)
        VALUES ($path, $xxhash3)
    `)

    async function _integrate(path: string, {direction}: { direction: 'up' | 'down' | 'root' }): Promise<void> {
        const info = await stat(path, pool)

        if (direction !== 'up') {
            selectMtimeStmt.bind({ path: info.path })
            const existing = (await selectMtimeStmt.runAndRead()).getRowObjects()[0] as { mtime: number } | undefined;

            if (existing && existing.mtime >= info.mtime) {
                return
            }
        }

        // Ensure parent exists before inserting this path
        if (direction !== 'down' && info.parent) {
            selectMtimeStmt.bind({ path: info.parent })
            const existing = (await selectMtimeStmt.runAndRead()).getRowObjects()[0] as { mtime: number } | undefined;
            if (!existing) {
                try {
                    await _integrate(info.parent, {direction: 'up'})
                } catch (error) {
                    // If parent can't be processed, continue anyway
                    // console.warn(`Warning: Could not process parent ${info.parent}: ${error}`)
                }
            }
        }

        insertPathStmt.bind(info)
        await insertPathStmt.run()

        if (info.isFile) {
            bar.max += info.size!

            const xxhash3 = await (async () => {
              try {
                const xxhash3 = await pool.execute<string>({
                    name: 'xxhash3',
                    action: 'open',
                    source: {
                        type: 'file',
                        path,
                    }
                })
                return xxhash3
              } catch {
                  bar.max -= info.size!
              }
            })()

            if (!xxhash3) {
                return
            }
            bar.value += info.size!

            const fileInfo: FileInfo = {
                path: info.path,
                xxhash3
            }

            insertFileStmt.bind(fileInfo)
            await insertFileStmt.run()
        } else if (direction === 'down' || direction === 'root') {
            const entries = await pool.execute<Deno.DirEntry[]>({ action: 'readDir', path: info.path })
            for (const dirEntry of entries) {
                const childPath = `${info.path}/${dirEntry.name}`
                await _integrate(childPath, { direction: 'down' } )
            }
        }
    }

    await _integrate(root, { direction: 'root' })
    logger.info `Completed integration for root ${root}`;
}

if (import.meta.main) {
    const [dbPath, root] = Deno.args

    if (!dbPath || !root) {
        logger.error `Usage: deno run --allow-read --allow-write --allow-ffi src/mod.ts <dbPath> <root>`;
        Deno.exit(1);
    }

    await setupLogging();

    using stack = new DisposableStack()

    const workerCount = navigator.hardwareConcurrency - 1 || 4;
    logger.info `Creating worker pool with ${workerCount} workers`;
    const pool = await WorkerPool.create(workerCount);
    logger.info `Worker pool created successfully`;
    stack.defer(() => pool.close());

    logger.info `Opening database at ${dbPath}`;
    const instance = await DuckDBInstance.create(dbPath)
    stack.defer(() => instance.closeSync())

    const connection = await instance.connect()
    stack.defer(() => connection.closeSync())
    logger.info `Database connected successfully`;

    await connection.run(sqliteTableSchema)
    await integrate(
        await Deno.realPath(root),
        connection,
        pool
    )
}