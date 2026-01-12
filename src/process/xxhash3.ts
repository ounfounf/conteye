import { createXXHash3 } from "hash-wasm";
import type { Processor } from "./process.ts";
const hasher = await createXXHash3()

export const process: Processor = async (stream: ReadableStream<Uint8Array>): Promise<string> => {
    hasher.init()
    for await (const chunk of stream) {
        hasher.update(chunk)
    }
    return hasher.digest()
}