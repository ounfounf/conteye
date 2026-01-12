import type { Instance } from "~/core/instance.ts";
import type { Task, TaskFilter, TaskSummary } from "~/core/task_manager.ts";

export interface TasksResponse {
  tasks: Task[];
  summary: TaskSummary;
}

export interface TaskResponse extends Task {}

export function handleGetTasks(instance: Instance, url: URL): Response {
  // Parse query parameters for filtering
  const status = url.searchParams.get("status");
  const limit = url.searchParams.get("limit");
  const offset = url.searchParams.get("offset");

  const filter: TaskFilter = {};

  if (status) {
    const statuses = status.split(",") as TaskFilter["status"];
    filter.status = statuses;
  }

  if (limit) {
    const parsedLimit = parseInt(limit, 10);
    if (!isNaN(parsedLimit) && parsedLimit > 0) {
      filter.limit = Math.min(parsedLimit, 1000); // Cap at 1000
    }
  }

  if (offset) {
    const parsedOffset = parseInt(offset, 10);
    if (!isNaN(parsedOffset) && parsedOffset >= 0) {
      filter.offset = parsedOffset;
    }
  }

  const tasks = instance.taskManager.getTasks(filter);
  const summary = instance.taskManager.getSummary();

  const response: TasksResponse = {
    tasks,
    summary,
  };

  return Response.json(response);
}

export function handleGetTask(instance: Instance, taskId: string): Response {
  const task = instance.taskManager.getTask(taskId);

  if (!task) {
    return Response.json({ error: "Task not found" }, { status: 404 });
  }

  return Response.json(task);
}

export function handleGetActiveTasks(instance: Instance): Response {
  const tasks = instance.taskManager.getActiveTasks();
  const summary = instance.taskManager.getSummary();

  return Response.json({
    tasks,
    summary: {
      pending: summary.pending,
      running: summary.running,
    },
  });
}

export function handleGetTaskSummary(instance: Instance): Response {
  const summary = instance.taskManager.getSummary();
  return Response.json(summary);
}
