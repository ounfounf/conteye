/// <reference lib="deno.worker" />
import { apply as applyProcess } from '~/process/index.ts';
import { apply as applyFs } from '~/fs.ts';
import type { WorkRequest } from "./request.ts";
import { getAppLogger } from "~/logger.ts";

const uuid = crypto.randomUUID()
const logger = getAppLogger("worker");

logger.debug `Starting worker with UUID: ${uuid}`;
self.postMessage({ uuid, ready: true });
logger.info `Worker ${uuid} ready and listening for requests`;

self.onmessage = async (event: MessageEvent<WorkRequest>) => {
  const request = event.data;
  logger.debug `Worker ${uuid} received work request: ${request.action}`;

  try {
    logger.debug `Worker ${uuid} processing ${request.action} request`;
    const result = request.action === 'open'
      ? await applyProcess(request)
      : await applyFs(request);
    logger.debug `Worker ${uuid} request completed successfully`;
    self.postMessage({ uuid, result });
  } catch (error) {
    logger.debug `Worker ${uuid} request failed: ${error}`;
    self.postMessage({ uuid, error: error instanceof Error ? error.message : String(error) });
  }
}