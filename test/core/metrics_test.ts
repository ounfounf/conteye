import { assertEquals, assertGreater, assertLessOrEqual } from "jsr:@std/assert";
import { MetricsCollector } from "~/core/metrics.ts";

Deno.test("MetricsCollector", async (t) => {
  await t.step("initializes with zero counts", () => {
    const collector = new MetricsCollector();
    const taskMetrics = collector.getTaskMetrics();

    assertEquals(taskMetrics.pending, 0);
    assertEquals(taskMetrics.running, 0);
    assertEquals(taskMetrics.completed, 0);
    assertEquals(taskMetrics.failed, 0);
    assertEquals(taskMetrics.avgDurationMs, 0);
    assertEquals(taskMetrics.throughputPerSec, 0);
  });

  await t.step("tracks queued tasks", () => {
    const collector = new MetricsCollector();

    collector.recordTaskQueued(Date.now());
    collector.recordTaskQueued(Date.now());

    const metrics = collector.getTaskMetrics();
    assertEquals(metrics.pending, 2);
  });

  await t.step("tracks task start transitions pending to running", () => {
    const collector = new MetricsCollector();
    const queueTime = Date.now();

    collector.recordTaskQueued(queueTime);
    assertEquals(collector.getTaskMetrics().pending, 1);
    assertEquals(collector.getTaskMetrics().running, 0);

    collector.recordTaskStarted(queueTime);
    assertEquals(collector.getTaskMetrics().pending, 0);
    assertEquals(collector.getTaskMetrics().running, 1);
  });

  await t.step("tracks task completion", () => {
    const collector = new MetricsCollector();
    const startTime = Date.now();

    collector.recordTaskQueued(startTime);
    collector.recordTaskStarted(startTime);
    collector.recordTaskCompleted(startTime);

    const metrics = collector.getTaskMetrics();
    assertEquals(metrics.pending, 0);
    assertEquals(metrics.running, 0);
    assertEquals(metrics.completed, 1);
    assertEquals(metrics.failed, 0);
  });

  await t.step("tracks task failure", () => {
    const collector = new MetricsCollector();
    const startTime = Date.now();

    collector.recordTaskQueued(startTime);
    collector.recordTaskStarted(startTime);
    collector.recordTaskFailed(startTime);

    const metrics = collector.getTaskMetrics();
    assertEquals(metrics.pending, 0);
    assertEquals(metrics.running, 0);
    assertEquals(metrics.completed, 0);
    assertEquals(metrics.failed, 1);
  });

  await t.step("calculates average duration", async () => {
    const collector = new MetricsCollector();

    // Simulate 3 tasks with ~10ms duration each
    for (let i = 0; i < 3; i++) {
      const startTime = Date.now();
      collector.recordTaskQueued(startTime);
      collector.recordTaskStarted(startTime);
      await new Promise(resolve => setTimeout(resolve, 10));
      collector.recordTaskCompleted(startTime);
    }

    const metrics = collector.getTaskMetrics();
    assertEquals(metrics.completed, 3);
    assertGreater(metrics.avgDurationMs, 0);
  });

  await t.step("getQueueMetrics returns queue depth", () => {
    const collector = new MetricsCollector();

    collector.recordTaskQueued(Date.now());
    collector.recordTaskQueued(Date.now());
    collector.recordTaskQueued(Date.now());

    const queueMetrics = collector.getQueueMetrics();
    assertEquals(queueMetrics.depth, 3);
  });

  await t.step("getResourceMetrics returns memory info", () => {
    const collector = new MetricsCollector();
    const resourceMetrics = collector.getResourceMetrics();

    assertGreater(resourceMetrics.memoryUsedBytes, 0);
    assertGreater(resourceMetrics.heapUsedBytes, 0);
    assertGreater(resourceMetrics.heapTotalBytes, 0);
  });

  await t.step("getInstanceMetrics tracks uptime", async () => {
    const collector = new MetricsCollector();

    await new Promise(resolve => setTimeout(resolve, 50));

    const instanceMetrics = collector.getInstanceMetrics();
    assertGreater(instanceMetrics.uptimeMs, 40);
    assertGreater(instanceMetrics.startTime, 0);
  });

  await t.step("getMetrics returns combined metrics", () => {
    const collector = new MetricsCollector();

    const workerMetrics = {
      total: 4,
      local: 3,
      remote: 1,
      busy: 2,
      idle: 2,
    };

    const metrics = collector.getMetrics(workerMetrics);

    assertEquals(metrics.workers, workerMetrics);
    assertEquals(typeof metrics.instance.uptimeMs, "number");
    assertEquals(typeof metrics.tasks.completed, "number");
    assertEquals(typeof metrics.resources.memoryUsedBytes, "number");
    assertEquals(typeof metrics.queue.depth, "number");
  });

  await t.step("reset clears all metrics", () => {
    const collector = new MetricsCollector();

    // Add some metrics
    collector.recordTaskQueued(Date.now());
    collector.recordTaskStarted(Date.now());
    collector.recordTaskCompleted(Date.now());

    // Reset
    collector.reset();

    const metrics = collector.getTaskMetrics();
    assertEquals(metrics.pending, 0);
    assertEquals(metrics.running, 0);
    assertEquals(metrics.completed, 0);
    assertEquals(metrics.failed, 0);
  });

  await t.step("handles high volume of tasks", () => {
    const collector = new MetricsCollector();

    // Simulate 1000 completed tasks
    for (let i = 0; i < 1000; i++) {
      const startTime = Date.now();
      collector.recordTaskQueued(startTime);
      collector.recordTaskStarted(startTime);
      collector.recordTaskCompleted(startTime);
    }

    const metrics = collector.getTaskMetrics();
    assertEquals(metrics.completed, 1000);
    assertEquals(metrics.pending, 0);
    assertEquals(metrics.running, 0);
  });

  await t.step("pending count never goes negative", () => {
    const collector = new MetricsCollector();

    // Start a task without queuing first
    collector.recordTaskStarted(Date.now());

    const metrics = collector.getTaskMetrics();
    assertEquals(metrics.pending, 0); // Should be 0, not -1
  });

  await t.step("running count never goes negative", () => {
    const collector = new MetricsCollector();

    // Complete a task without starting first
    collector.recordTaskCompleted(Date.now());

    const metrics = collector.getTaskMetrics();
    assertEquals(metrics.running, 0); // Should be 0, not -1
  });
});
