import type { Processor } from "./process.ts";

import * as xxhash3 from './xxhash3.ts';
import * as md5 from './md5.ts';
import * as ffprobe from './ffprobe.ts';

export const processors: Record<string, { process: Processor }> = {
  xxhash3,
  md5,
  ffprobe
} as const;

export type ProcessorName = keyof typeof processors;

export type StreamSource = {
  type: 'file';
  path: string | URL;
} | {
  type: 'url';
  url: string | URL;
}

export type ProcessRequest = {
  action: 'open';
  name: ProcessorName;
  source: StreamSource;
};

export async function openSource(source: StreamSource): Promise<ReadableStream<Uint8Array>> {
  if (source.type === 'file') {
    const file = await Deno.open(source.path, { read: true });
    return file.readable;
  } else if (source.type === 'url') {
    const response = await fetch(source.url);
    if (!response.body) {
      throw new Error(`No body in response from URL: ${source.url}`);
    }
    return response.body;
  }

  // Should never reach here
  throw new Error(`Unknown source type: ${(source as any).type}`);
}

export async function apply ({name, source}: ProcessRequest): Promise<string> {
  const processor = processors[name].process;
  return await processor(await openSource(source));
}