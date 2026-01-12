import type { Processor } from "./process.ts";

async function runProbeOnPath(path: string): Promise<string> {
    const { code, stdout, stderr } = await new Deno.Command("ffprobe", {
        args: ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", path],
        stdout: "piped",
        stderr: "piped",
    }).output();
    if (code !== 0) {
        throw new Error(new TextDecoder().decode(stderr));
    }
    return new TextDecoder().decode(stdout);
}

export const process: Processor = async (stream: ReadableStream<Uint8Array>): Promise<string> => {
    const tmpPath = await Deno.makeTempFile();
    try {
        const file = await Deno.open(tmpPath, { write: true });
        await stream.pipeTo(file.writable);
        return await runProbeOnPath(tmpPath);
    } finally {
        try { await Deno.remove(tmpPath); } catch { /* ignore cleanup errors */ }
    }
}
