import type { WorkRequest } from "~/work/request.ts";
import { getAppLogger } from "~/logger.ts";

const logger = getAppLogger("task_manager");

export type TaskStatus = "pending" | "running" | "completed" | "failed";

export interface Task {
  id: string;
  request: WorkRequest;
  status: TaskStatus;
  queuedAt: number;
  startedAt?: number;
  completedAt?: number;
  workerId?: string;
  result?: unknown;
  error?: string;
}

export interface TaskFilter {
  status?: TaskStatus | TaskStatus[];
  limit?: number;
  offset?: number;
}

export interface TaskSummary {
  total: number;
  pending: number;
  running: number;
  completed: number;
  failed: number;
}

export class TaskManager {
  private tasks: Map<string, Task> = new Map();
  private taskOrder: string[] = [];

  // Configuration
  private readonly maxTasks: number;
  private readonly retentionMs: number;

  constructor(options?: { maxTasks?: number; retentionMs?: number }) {
    this.maxTasks = options?.maxTasks ?? 10_000;
    this.retentionMs = options?.retentionMs ?? 3600_000; // 1 hour default
    logger.debug`TaskManager initialized with maxTasks=${this.maxTasks}, retentionMs=${this.retentionMs}`;
  }

  createTask(request: WorkRequest): Task {
    const id = crypto.randomUUID();
    const task: Task = {
      id,
      request,
      status: "pending",
      queuedAt: Date.now(),
    };

    this.tasks.set(id, task);
    this.taskOrder.push(id);
    this.pruneOldTasks();

    logger.debug`Task created: id=${id}, action=${request.action}`;
    return task;
  }

  markRunning(taskId: string, workerId: string): void {
    const task = this.tasks.get(taskId);
    if (task) {
      task.status = "running";
      task.startedAt = Date.now();
      task.workerId = workerId;
      logger.debug`Task running: id=${taskId}, workerId=${workerId}`;
    }
  }

  markCompleted(taskId: string, result: unknown): void {
    const task = this.tasks.get(taskId);
    if (task) {
      task.status = "completed";
      task.completedAt = Date.now();
      task.result = result;
      logger.debug`Task completed: id=${taskId}`;
    }
  }

  markFailed(taskId: string, error: string): void {
    const task = this.tasks.get(taskId);
    if (task) {
      task.status = "failed";
      task.completedAt = Date.now();
      task.error = error;
      logger.debug`Task failed: id=${taskId}, error=${error}`;
    }
  }

  getTask(id: string): Task | undefined {
    return this.tasks.get(id);
  }

  getTasks(filter?: TaskFilter): Task[] {
    let tasks = Array.from(this.tasks.values());

    // Filter by status
    if (filter?.status) {
      const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
      tasks = tasks.filter(t => statuses.includes(t.status));
    }

    // Sort by queued time (newest first)
    tasks.sort((a, b) => b.queuedAt - a.queuedAt);

    // Apply pagination
    const offset = filter?.offset ?? 0;
    const limit = filter?.limit ?? 100;
    tasks = tasks.slice(offset, offset + limit);

    return tasks;
  }

  getSummary(): TaskSummary {
    let pending = 0;
    let running = 0;
    let completed = 0;
    let failed = 0;

    for (const task of this.tasks.values()) {
      switch (task.status) {
        case "pending":
          pending++;
          break;
        case "running":
          running++;
          break;
        case "completed":
          completed++;
          break;
        case "failed":
          failed++;
          break;
      }
    }

    return {
      total: this.tasks.size,
      pending,
      running,
      completed,
      failed,
    };
  }

  getActiveTasks(): Task[] {
    return Array.from(this.tasks.values()).filter(
      t => t.status === "pending" || t.status === "running"
    );
  }

  private pruneOldTasks(): void {
    const now = Date.now();

    // Remove tasks older than retention period
    while (this.taskOrder.length > 0) {
      const oldestId = this.taskOrder[0];
      const oldest = this.tasks.get(oldestId);

      if (!oldest) {
        this.taskOrder.shift();
        continue;
      }

      // Keep active tasks regardless of age
      if (oldest.status === "pending" || oldest.status === "running") {
        break;
      }

      // Check if task is old enough to prune
      const taskAge = now - (oldest.completedAt ?? oldest.queuedAt);
      if (taskAge < this.retentionMs && this.tasks.size <= this.maxTasks) {
        break;
      }

      this.tasks.delete(oldestId);
      this.taskOrder.shift();
      logger.debug`Pruned old task: id=${oldestId}`;
    }

    // If still over limit, prune completed tasks aggressively
    while (this.tasks.size > this.maxTasks) {
      const oldestId = this.taskOrder.shift();
      if (oldestId) {
        const task = this.tasks.get(oldestId);
        if (task && (task.status === "completed" || task.status === "failed")) {
          this.tasks.delete(oldestId);
          logger.debug`Pruned task over limit: id=${oldestId}`;
        } else if (task) {
          // Put active task back at end
          this.taskOrder.push(oldestId);
        }
      }
    }
  }

  clear(): void {
    this.tasks.clear();
    this.taskOrder = [];
    logger.debug`TaskManager cleared`;
  }
}
