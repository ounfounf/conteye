import { createMD5 } from "hash-wasm";
import type { Processor } from "./process.ts";
const hasher = await createMD5()

export const process: Processor = async (stream: ReadableStream<Uint8Array>): Promise<string> => {
    hasher.init()
    for await (const chunk of stream) {
        hasher.update(chunk)
    }
    return hasher.digest()
}
