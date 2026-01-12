import { assertEquals, assertExists, assertNotEquals } from "jsr:@std/assert";
import { TaskManager } from "~/core/task_manager.ts";
import type { WorkRequest } from "~/work/request.ts";

function createTestRequest(action: string = "stat"): WorkRequest {
  return { action: "stat", path: "/test/path" } as WorkRequest;
}

Deno.test("TaskManager", async (t) => {
  await t.step("createTask creates a task with pending status", () => {
    const manager = new TaskManager();
    const request = createTestRequest();
    const task = manager.createTask(request);

    assertExists(task.id);
    assertEquals(task.status, "pending");
    assertEquals(task.request, request);
    assertExists(task.queuedAt);
    assertEquals(task.startedAt, undefined);
    assertEquals(task.completedAt, undefined);
  });

  await t.step("createTask generates unique IDs", () => {
    const manager = new TaskManager();
    const task1 = manager.createTask(createTestRequest());
    const task2 = manager.createTask(createTestRequest());

    assertNotEquals(task1.id, task2.id);
  });

  await t.step("getTask retrieves task by ID", () => {
    const manager = new TaskManager();
    const created = manager.createTask(createTestRequest());
    const retrieved = manager.getTask(created.id);

    assertEquals(retrieved, created);
  });

  await t.step("getTask returns undefined for non-existent ID", () => {
    const manager = new TaskManager();
    const task = manager.getTask("non-existent-id");

    assertEquals(task, undefined);
  });

  await t.step("markRunning updates task status and sets startedAt", () => {
    const manager = new TaskManager();
    const task = manager.createTask(createTestRequest());

    manager.markRunning(task.id, "worker-123");

    const updated = manager.getTask(task.id);
    assertEquals(updated?.status, "running");
    assertExists(updated?.startedAt);
    assertEquals(updated?.workerId, "worker-123");
  });

  await t.step("markCompleted updates task status and sets result", () => {
    const manager = new TaskManager();
    const task = manager.createTask(createTestRequest());
    manager.markRunning(task.id, "worker-123");

    manager.markCompleted(task.id, { data: "result" });

    const updated = manager.getTask(task.id);
    assertEquals(updated?.status, "completed");
    assertExists(updated?.completedAt);
    assertEquals(updated?.result, { data: "result" });
  });

  await t.step("markFailed updates task status and sets error", () => {
    const manager = new TaskManager();
    const task = manager.createTask(createTestRequest());
    manager.markRunning(task.id, "worker-123");

    manager.markFailed(task.id, "Something went wrong");

    const updated = manager.getTask(task.id);
    assertEquals(updated?.status, "failed");
    assertExists(updated?.completedAt);
    assertEquals(updated?.error, "Something went wrong");
  });

  await t.step("getTasks returns all tasks", () => {
    const manager = new TaskManager();
    manager.createTask(createTestRequest());
    manager.createTask(createTestRequest());
    manager.createTask(createTestRequest());

    const tasks = manager.getTasks();
    assertEquals(tasks.length, 3);
  });

  await t.step("getTasks filters by single status", () => {
    const manager = new TaskManager();
    const task1 = manager.createTask(createTestRequest());
    const task2 = manager.createTask(createTestRequest());
    manager.createTask(createTestRequest());

    manager.markRunning(task1.id, "worker-1");
    manager.markRunning(task2.id, "worker-2");
    manager.markCompleted(task2.id, "done");

    const runningTasks = manager.getTasks({ status: "running" });
    assertEquals(runningTasks.length, 1);
    assertEquals(runningTasks[0].id, task1.id);

    const completedTasks = manager.getTasks({ status: "completed" });
    assertEquals(completedTasks.length, 1);
    assertEquals(completedTasks[0].id, task2.id);
  });

  await t.step("getTasks filters by multiple statuses", () => {
    const manager = new TaskManager();
    const task1 = manager.createTask(createTestRequest());
    const task2 = manager.createTask(createTestRequest());
    manager.createTask(createTestRequest());

    manager.markRunning(task1.id, "worker-1");
    manager.markRunning(task2.id, "worker-2");
    manager.markCompleted(task2.id, "done");

    const activeTasks = manager.getTasks({ status: ["pending", "running"] });
    assertEquals(activeTasks.length, 2);
  });

  await t.step("getTasks applies limit", () => {
    const manager = new TaskManager();
    for (let i = 0; i < 10; i++) {
      manager.createTask(createTestRequest());
    }

    const limited = manager.getTasks({ limit: 5 });
    assertEquals(limited.length, 5);
  });

  await t.step("getTasks applies offset", () => {
    const manager = new TaskManager();
    const tasks = [];
    for (let i = 0; i < 10; i++) {
      tasks.push(manager.createTask(createTestRequest()));
    }

    const offset = manager.getTasks({ offset: 5, limit: 5 });
    assertEquals(offset.length, 5);
  });

  await t.step("getTasks returns tasks sorted by queuedAt descending", async () => {
    const manager = new TaskManager();
    const task1 = manager.createTask(createTestRequest());
    await new Promise(resolve => setTimeout(resolve, 5));
    const task2 = manager.createTask(createTestRequest());
    await new Promise(resolve => setTimeout(resolve, 5));
    const task3 = manager.createTask(createTestRequest());

    const tasks = manager.getTasks();
    // Most recent first
    assertEquals(tasks[0].id, task3.id);
    assertEquals(tasks[2].id, task1.id);
  });

  await t.step("getSummary returns correct counts", () => {
    const manager = new TaskManager();
    const task1 = manager.createTask(createTestRequest());
    const task2 = manager.createTask(createTestRequest());
    const task3 = manager.createTask(createTestRequest());
    manager.createTask(createTestRequest()); // pending

    manager.markRunning(task1.id, "w1");
    manager.markRunning(task2.id, "w2");
    manager.markCompleted(task2.id, "done");
    manager.markRunning(task3.id, "w3");
    manager.markFailed(task3.id, "error");

    const summary = manager.getSummary();
    assertEquals(summary.total, 4);
    assertEquals(summary.pending, 1);
    assertEquals(summary.running, 1);
    assertEquals(summary.completed, 1);
    assertEquals(summary.failed, 1);
  });

  await t.step("getActiveTasks returns only pending and running", () => {
    const manager = new TaskManager();
    const task1 = manager.createTask(createTestRequest());
    const task2 = manager.createTask(createTestRequest());
    const task3 = manager.createTask(createTestRequest());

    manager.markRunning(task1.id, "w1");
    manager.markRunning(task2.id, "w2");
    manager.markCompleted(task2.id, "done");
    // task3 stays pending

    const active = manager.getActiveTasks();
    assertEquals(active.length, 2);

    const statuses = active.map(t => t.status);
    assertEquals(statuses.includes("running"), true);
    assertEquals(statuses.includes("pending"), true);
    assertEquals(statuses.includes("completed"), false);
  });

  await t.step("clear removes all tasks", () => {
    const manager = new TaskManager();
    manager.createTask(createTestRequest());
    manager.createTask(createTestRequest());
    manager.createTask(createTestRequest());

    manager.clear();

    assertEquals(manager.getTasks().length, 0);
    assertEquals(manager.getSummary().total, 0);
  });

  await t.step("respects maxTasks limit", () => {
    const manager = new TaskManager({ maxTasks: 5 });

    // Create 10 tasks
    for (let i = 0; i < 10; i++) {
      const task = manager.createTask(createTestRequest());
      manager.markRunning(task.id, "w1");
      manager.markCompleted(task.id, "done");
    }

    // Should be pruned to maxTasks
    const tasks = manager.getTasks();
    assertEquals(tasks.length <= 5, true);
  });

  await t.step("handles marking non-existent task gracefully", () => {
    const manager = new TaskManager();

    // Should not throw
    manager.markRunning("non-existent", "worker");
    manager.markCompleted("non-existent", "result");
    manager.markFailed("non-existent", "error");

    // Verify no tasks were created
    assertEquals(manager.getTasks().length, 0);
  });

  await t.step("task lifecycle: pending -> running -> completed", () => {
    const manager = new TaskManager();
    const task = manager.createTask(createTestRequest());

    // Initial state
    assertEquals(task.status, "pending");
    assertEquals(task.startedAt, undefined);
    assertEquals(task.completedAt, undefined);
    assertEquals(task.workerId, undefined);
    assertEquals(task.result, undefined);

    // Start running
    manager.markRunning(task.id, "worker-abc");
    let updated = manager.getTask(task.id)!;
    assertEquals(updated.status, "running");
    assertExists(updated.startedAt);
    assertEquals(updated.workerId, "worker-abc");
    assertEquals(updated.completedAt, undefined);

    // Complete
    manager.markCompleted(task.id, { hash: "abc123" });
    updated = manager.getTask(task.id)!;
    assertEquals(updated.status, "completed");
    assertExists(updated.completedAt);
    assertEquals(updated.result, { hash: "abc123" });
    assertEquals(updated.error, undefined);
  });

  await t.step("task lifecycle: pending -> running -> failed", () => {
    const manager = new TaskManager();
    const task = manager.createTask(createTestRequest());

    manager.markRunning(task.id, "worker-xyz");
    manager.markFailed(task.id, "File not found");

    const updated = manager.getTask(task.id)!;
    assertEquals(updated.status, "failed");
    assertExists(updated.completedAt);
    assertEquals(updated.error, "File not found");
    assertEquals(updated.result, undefined);
  });
});
