import { getAppLogger } from "~/logger.ts";

const logger = getAppLogger("metrics");

export interface WorkerMetrics {
  total: number;
  local: number;
  remote: number;
  busy: number;
  idle: number;
}

export interface TaskMetrics {
  pending: number;
  running: number;
  completed: number;
  failed: number;
  avgDurationMs: number;
  throughputPerSec: number;
}

export interface ResourceMetrics {
  memoryUsedBytes: number;
  memoryTotalBytes: number;
  heapUsedBytes: number;
  heapTotalBytes: number;
}

export interface QueueMetrics {
  depth: number;
  avgWaitTimeMs: number;
}

export interface InstanceMetrics {
  uptimeMs: number;
  startTime: number;
}

export interface Metrics {
  instance: InstanceMetrics;
  workers: WorkerMetrics;
  tasks: TaskMetrics;
  resources: ResourceMetrics;
  queue: QueueMetrics;
}

interface TaskTiming {
  startTime: number;
  endTime?: number;
  waitTime: number;
}

export class MetricsCollector {
  private startTime: number;
  private taskTimings: TaskTiming[] = [];
  private completedCount = 0;
  private failedCount = 0;
  private pendingCount = 0;
  private runningCount = 0;

  // Rolling window for throughput calculation (last 60 seconds)
  private readonly WINDOW_SIZE_MS = 60_000;
  private readonly MAX_TIMINGS = 10_000;

  constructor() {
    this.startTime = Date.now();
    logger.debug`MetricsCollector initialized`;
  }

  recordTaskQueued(waitStartTime: number): void {
    this.pendingCount++;
    logger.debug`Task queued, pending=${this.pendingCount}`;
  }

  recordTaskStarted(waitStartTime: number): void {
    this.pendingCount = Math.max(0, this.pendingCount - 1);
    this.runningCount++;
    const timing: TaskTiming = {
      startTime: Date.now(),
      waitTime: Date.now() - waitStartTime,
    };
    this.taskTimings.push(timing);

    // Prune old timings to prevent memory growth
    if (this.taskTimings.length > this.MAX_TIMINGS) {
      this.taskTimings = this.taskTimings.slice(-this.MAX_TIMINGS / 2);
    }

    logger.debug`Task started, running=${this.runningCount}, pending=${this.pendingCount}`;
  }

  recordTaskCompleted(startTime: number): void {
    this.runningCount = Math.max(0, this.runningCount - 1);
    this.completedCount++;

    // Update the timing entry
    const timing = this.taskTimings.find(t => t.startTime === startTime);
    if (timing) {
      timing.endTime = Date.now();
    }

    logger.debug`Task completed, completed=${this.completedCount}, running=${this.runningCount}`;
  }

  recordTaskFailed(startTime: number): void {
    this.runningCount = Math.max(0, this.runningCount - 1);
    this.failedCount++;

    // Update the timing entry
    const timing = this.taskTimings.find(t => t.startTime === startTime);
    if (timing) {
      timing.endTime = Date.now();
    }

    logger.debug`Task failed, failed=${this.failedCount}, running=${this.runningCount}`;
  }

  getTaskMetrics(): TaskMetrics {
    const now = Date.now();
    const windowStart = now - this.WINDOW_SIZE_MS;

    // Calculate average duration from completed tasks
    const completedTimings = this.taskTimings.filter(t => t.endTime !== undefined);
    const avgDurationMs = completedTimings.length > 0
      ? completedTimings.reduce((sum, t) => sum + (t.endTime! - t.startTime), 0) / completedTimings.length
      : 0;

    // Calculate throughput from recent completions
    const recentCompletions = completedTimings.filter(t => t.endTime! >= windowStart);
    const throughputPerSec = recentCompletions.length / (this.WINDOW_SIZE_MS / 1000);

    return {
      pending: this.pendingCount,
      running: this.runningCount,
      completed: this.completedCount,
      failed: this.failedCount,
      avgDurationMs: Math.round(avgDurationMs),
      throughputPerSec: Math.round(throughputPerSec * 100) / 100,
    };
  }

  getQueueMetrics(): QueueMetrics {
    // Calculate average wait time from recent tasks
    const recentTimings = this.taskTimings.slice(-100);
    const avgWaitTimeMs = recentTimings.length > 0
      ? recentTimings.reduce((sum, t) => sum + t.waitTime, 0) / recentTimings.length
      : 0;

    return {
      depth: this.pendingCount,
      avgWaitTimeMs: Math.round(avgWaitTimeMs),
    };
  }

  getResourceMetrics(): ResourceMetrics {
    // Deno memory info
    const memInfo = Deno.memoryUsage();

    return {
      memoryUsedBytes: memInfo.rss,
      memoryTotalBytes: memInfo.rss, // Deno doesn't expose system total
      heapUsedBytes: memInfo.heapUsed,
      heapTotalBytes: memInfo.heapTotal,
    };
  }

  getInstanceMetrics(): InstanceMetrics {
    return {
      uptimeMs: Date.now() - this.startTime,
      startTime: this.startTime,
    };
  }

  getMetrics(workerMetrics: WorkerMetrics): Metrics {
    return {
      instance: this.getInstanceMetrics(),
      workers: workerMetrics,
      tasks: this.getTaskMetrics(),
      resources: this.getResourceMetrics(),
      queue: this.getQueueMetrics(),
    };
  }

  reset(): void {
    this.taskTimings = [];
    this.completedCount = 0;
    this.failedCount = 0;
    this.pendingCount = 0;
    this.runningCount = 0;
    this.startTime = Date.now();
    logger.debug`MetricsCollector reset`;
  }
}
