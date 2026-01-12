export type PathInfo = {
    path: string;
    parent: string | null;
    mtime: number;
    ctime: number;
    atime: number;
} & (
    { isFile: true; size: number } |
    { isFile: false; size: null }
)

export type FileInfo = {
    path: string; // reference to PathInfo.path
    xxhash3: string;
}

export type FsRequest = {
    action: 'stat' | 'readDir' | 'realPath';
    path: string;
}

export const apply = async (request: FsRequest): Promise<any> => {
    if (request.action === 'stat') {
        return await Deno.stat(request.path);
    } else if (request.action === 'readDir') {
        const entries = [];
        for await (const entry of Deno.readDir(request.path)) {
            entries.push(entry);
        }
        return entries;
    } else if (request.action === 'realPath') {
        return await Deno.realPath(request.path);
    } else {
        throw new Error(`Unknown action: ${request.action}`);
    }
}

interface Fs {
    stat(path: string): Promise<Deno.FileInfo>;
    realPath(path: string): Promise<string>;
    readDir(path: string): AsyncIterable<Deno.DirEntry>;
    open(path: string, options: Deno.OpenOptions): Promise<Deno.FsFile>;
}

const localFs: Fs = {
    stat: Deno.stat,
    realPath: Deno.realPath,
    readDir: Deno.readDir,
    open: Deno.open,
};