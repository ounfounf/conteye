import type { Instance } from "~/core/instance.ts";
import type { Metrics } from "~/core/metrics.ts";

export interface StatusResponse {
  id: string;
  version: string;
  wsUrl: string;
  uptime: number;
  startTime: number;
}

export interface MetricsResponse extends Metrics {}

export function handleGetStatus(instance: Instance): Response {
  const status = instance.getStatus();
  return Response.json(status);
}

export function handleGetMetrics(instance: Instance): Response {
  const workerMetrics = instance.pool.getWorkerCount();
  const metrics = instance.metrics.getMetrics({
    total: workerMetrics.total,
    local: workerMetrics.local,
    remote: workerMetrics.remote,
    busy: workerMetrics.busy,
    idle: workerMetrics.idle,
  });
  return Response.json(metrics);
}

export function handleGetHealth(_instance: Instance): Response {
  return Response.json({ status: "healthy" });
}
