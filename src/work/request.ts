import type { ProcessRequest } from "~/process/index.ts";
import type { FsRequest } from "~/fs.ts";

export type WorkRequest = FsRequest | ProcessRequest;