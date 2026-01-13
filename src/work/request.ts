import type { ProcessRequest } from "~/process/index.ts";
import type { FsRequest } from "~/fs.ts";

export type PingRequest = {
    action: 'ping';
}

export type WorkRequest = FsRequest | ProcessRequest | PingRequest;