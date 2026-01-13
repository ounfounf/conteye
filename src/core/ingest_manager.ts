import type { DuckDBConnection } from "@duckdb/node-api";
import type { WorkerPool } from "~/work/worker_pool.ts";
import type { PathInfo, FileInfo } from "~/fs.ts";
import type { ProcessorName } from "~/process/index.ts";
import { dirname } from "@std/path/dirname";
import { getAppLogger } from "~/logger.ts";

const logger = getAppLogger("ingest_manager");

export type IngestStatus = "queued" | "scanning" | "processing" | "completed" | "cancelled" | "failed";

export interface IngestError {
  path: string;
  error: string;
  timestamp: number;
}

export interface IngestJob {
  id: string;
  root: string;
  status: IngestStatus;
  processors: ProcessorName[];
  totalFiles: number;
  processedFiles: number;
  totalBytes: number;
  processedBytes: number;
  startedAt: number;
  completedAt?: number;
  errors: IngestError[];
}

export interface IngestOptions {
  processors?: ProcessorName[];
}

export interface IngestJobSummary {
  id: string;
  root: string;
  status: IngestStatus;
  progress: number; // 0-100
  processedFiles: number;
  totalFiles: number;
}

export class IngestManager {
  private jobs: Map<string, IngestJob> = new Map();
  private abortControllers: Map<string, AbortController> = new Map();
  private db: DuckDBConnection;
  private pool: WorkerPool;

  constructor(db: DuckDBConnection, pool: WorkerPool) {
    this.db = db;
    this.pool = pool;
    logger.debug`IngestManager initialized`;
  }

  async start(root: string, options?: IngestOptions): Promise<IngestJob> {
    const id = crypto.randomUUID();
    const job: IngestJob = {
      id,
      root,
      status: "queued",
      processors: options?.processors ?? ["xxhash3"],
      totalFiles: 0,
      processedFiles: 0,
      totalBytes: 0,
      processedBytes: 0,
      startedAt: Date.now(),
      errors: [],
    };

    this.jobs.set(id, job);
    const abortController = new AbortController();
    this.abortControllers.set(id, abortController);

    logger.info`Starting ingest job: id=${id}, root=${root}`;

    // Start processing in background
    this.processJob(job, abortController.signal).catch(error => {
      job.status = "failed";
      job.completedAt = Date.now();
      job.errors.push({
        path: root,
        error: error.message,
        timestamp: Date.now(),
      });
      logger.error`Ingest job failed: id=${id}, error=${error.message}`;
    });

    return job;
  }

  cancel(id: string): boolean {
    const job = this.jobs.get(id);
    const abortController = this.abortControllers.get(id);

    if (!job || !abortController) {
      return false;
    }

    if (job.status === "completed" || job.status === "cancelled" || job.status === "failed") {
      return false;
    }

    abortController.abort();
    job.status = "cancelled";
    job.completedAt = Date.now();
    this.abortControllers.delete(id);

    logger.info`Ingest job cancelled: id=${id}`;
    return true;
  }

  getJob(id: string): IngestJob | undefined {
    return this.jobs.get(id);
  }

  getJobs(): IngestJob[] {
    return Array.from(this.jobs.values()).sort((a, b) => b.startedAt - a.startedAt);
  }

  getActiveJobs(): IngestJob[] {
    return this.getJobs().filter(
      j => j.status === "queued" || j.status === "scanning" || j.status === "processing"
    );
  }

  getJobSummary(id: string): IngestJobSummary | undefined {
    const job = this.jobs.get(id);
    if (!job) return undefined;

    const progress = job.totalFiles > 0
      ? Math.round((job.processedFiles / job.totalFiles) * 100)
      : 0;

    return {
      id: job.id,
      root: job.root,
      status: job.status,
      progress,
      processedFiles: job.processedFiles,
      totalFiles: job.totalFiles,
    };
  }

  private async processJob(job: IngestJob, signal: AbortSignal): Promise<void> {
    try {
      // Resolve the root path
      const resolvedRoot = await Deno.realPath(job.root);
      job.root = resolvedRoot;

      job.status = "scanning";
      logger.debug`Ingest job scanning: id=${job.id}`;

      // Prepare statements
      const selectMtimeStmt = await this.db.prepare(`
        SELECT mtime FROM paths WHERE path = $path
      `);

      const insertPathStmt = await this.db.prepare(`
        INSERT OR REPLACE INTO paths (path, parent, isFile, size, mtime, ctime, atime)
        VALUES ($path, $parent, $isFile, $size, $mtime, $ctime, $atime)
      `);

      const insertFileStmt = await this.db.prepare(`
        INSERT OR REPLACE INTO files (path, xxhash3)
        VALUES ($path, $xxhash3)
      `);

      job.status = "processing";
      logger.debug`Ingest job processing: id=${job.id}`;

      await this.integrateDirectory(
        job,
        resolvedRoot,
        { direction: "root" },
        { selectMtimeStmt, insertPathStmt, insertFileStmt },
        signal
      );

      if (signal.aborted) {
        return;
      }

      job.status = "completed";
      job.completedAt = Date.now();
      this.abortControllers.delete(job.id);
      logger.info`Ingest job completed: id=${job.id}, files=${job.processedFiles}`;

    } catch (error) {
      if (!signal.aborted) {
        throw error;
      }
    }
  }

  private async integrateDirectory(
    job: IngestJob,
    path: string,
    options: { direction: "up" | "down" | "root" },
    stmts: {
      selectMtimeStmt: any;
      insertPathStmt: any;
      insertFileStmt: any;
    },
    signal: AbortSignal
  ): Promise<void> {
    if (signal.aborted) return;

    try {
      const info = await this.stat(path);

      if (options.direction !== "up") {
        stmts.selectMtimeStmt.bind({ path: info.path });
        const existing = (await stmts.selectMtimeStmt.runAndRead()).getRowObjects()[0] as { mtime: number } | undefined;

        if (existing && existing.mtime >= info.mtime) {
          return;
        }
      }

      // Ensure parent exists before inserting this path
      if (options.direction !== "down" && info.parent) {
        stmts.selectMtimeStmt.bind({ path: info.parent });
        const existing = (await stmts.selectMtimeStmt.runAndRead()).getRowObjects()[0] as { mtime: number } | undefined;
        if (!existing) {
          try {
            await this.integrateDirectory(job, info.parent, { direction: "up" }, stmts, signal);
          } catch {
            // If parent can't be processed, continue anyway
          }
        }
      }

      stmts.insertPathStmt.bind(info);
      await stmts.insertPathStmt.run();

      if (info.isFile) {
        job.totalFiles++;
        job.totalBytes += info.size;

        // Process with each processor
        for (const processorName of job.processors) {
          if (signal.aborted) return;

          try {
            const result = await this.pool.execute<string>({
              name: processorName,
              action: "open",
              source: {
                type: "file",
                path,
              },
            });

            // Currently only storing xxhash3
            if (processorName === "xxhash3") {
              const fileInfo: FileInfo = {
                path: info.path,
                xxhash3: result,
              };
              stmts.insertFileStmt.bind(fileInfo);
              await stmts.insertFileStmt.run();
            }

            job.processedFiles++;
            job.processedBytes += info.size;

          } catch (error) {
            job.errors.push({
              path,
              error: error instanceof Error ? error.message : String(error),
              timestamp: Date.now(),
            });
          }
        }

      } else if (options.direction === "down" || options.direction === "root") {
        // Process directory entries
        const entries = await this.pool.execute<Deno.DirEntry[]>({
          action: "readDir",
          path: info.path,
        });

        for (const dirEntry of entries) {
          if (signal.aborted) return;

          const childPath = `${info.path}/${dirEntry.name}`;
          await this.integrateDirectory(job, childPath, { direction: "down" }, stmts, signal);
        }
      }

    } catch (error) {
      job.errors.push({
        path,
        error: error instanceof Error ? error.message : String(error),
        timestamp: Date.now(),
      });
    }
  }

  private async stat(path: string): Promise<PathInfo> {
    const [stat, realPath] = await Promise.all([
      this.pool.execute<Deno.FileInfo>({ action: "stat", path }),
      this.pool.execute<string>({ action: "realPath", path }),
    ]);

    const parentPath = dirname(realPath);
    const parent = parentPath === realPath ? null : parentPath;

    const info = {
      path: realPath,
      parent,
      mtime: stat.mtime ? Math.floor(stat.mtime.getTime()) : 0,
      ctime: stat.ctime ? Math.floor(stat.ctime.getTime()) : 0,
      atime: stat.atime ? Math.floor(stat.atime.getTime()) : 0,
    };

    if (stat.isFile) {
      return { isFile: true, size: stat.size, ...info };
    } else if (stat.isDirectory) {
      return { isFile: false, size: null, ...info };
    } else {
      throw new Error(`Unsupported file type at path: ${path}`);
    }
  }

  clear(): void {
    // Cancel all active jobs
    for (const [id, controller] of this.abortControllers) {
      controller.abort();
      const job = this.jobs.get(id);
      if (job) {
        job.status = "cancelled";
        job.completedAt = Date.now();
      }
    }
    this.abortControllers.clear();
    this.jobs.clear();
    logger.debug`IngestManager cleared`;
  }
}
