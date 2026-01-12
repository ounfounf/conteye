import { assertEquals, assertRejects, assertExists, assertNotEquals, assertGreater } from "jsr:@std/assert";
import { expect } from "jsr:@std/expect";
import { delay } from "jsr:@std/async/delay";
import { WorkerPool, WebSocketHost, ThreadWorker } from "~/work/worker_pool.ts";
import type { ProcessRequest } from "~/process/index.ts";
import { TEST_DATA, type TestDataKey } from "~test/util/data.ts";
import { setupLogging } from "~/logger.ts";

// Setup debug logging for tests
await setupLogging({
  // verbose: true
});

// Temp directory for test files
let tempDir: string;

// Helper to create a test file with specific content
async function createTestFile(name: string, content: Uint8Array): Promise<string> {
  const path = `${tempDir}/${name}`;
  await Deno.writeFile(path, content);
  return path;
}

// Helper to create xxhash3 ProcessRequest
function xxhash3Request(path: string): ProcessRequest {
  return {
    action: "open",
    name: "xxhash3",
    source: { type: "file", path },
  };
}

// ============================================================================
// Test Setup and Teardown
// ============================================================================

// Default step timeout: 5 seconds per step
const STEP_TIMEOUT = 5_000;

// Helper to create a step with timeout
function step(
  t: Deno.TestContext,
  name: string,
  fn: () => Promise<void>,
  timeout: number = STEP_TIMEOUT
): Promise<boolean> {
  return t.step(name, async () => {
    let timeoutId: number | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error(`Step "${name}" timed out after ${timeout}ms`)), timeout);
    });
    try {
      await Promise.race([fn(), timeoutPromise]);
    } finally {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
    }
  });
}

Deno.test({
  name: "WorkerPool Test Suite",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn(t) {
    // Setup: create temp directory and test files
    tempDir = await Deno.makeTempDir({ prefix: "worker_pool_test_" });

    const testFiles: Record<TestDataKey, string> = {} as Record<TestDataKey, string>;
    for (const [key, data] of Object.entries(TEST_DATA)) {
      testFiles[key as TestDataKey] = await createTestFile(`${key}.bin`, data.bytes);
    }

    // ========================================================================
    // Unit Tests: WorkerPool Basic Functionality
    // ========================================================================

    await step(t,"WorkerPool.create() creates pool with specified worker count", async () => {
      const pool = await WorkerPool.create(3);
      try {
        assertEquals(pool.pool.length, 3);
        assertExists(pool.uuid);
        assertEquals(pool.queue.length, 0);
      } finally {
        pool.close();
      }
    });

    await step(t,"WorkerPool.create() with 1 worker", async () => {
      const pool = await WorkerPool.create(1);
      try {
        assertEquals(pool.pool.length, 1);
      } finally {
        pool.close();
      }
    });

    await step(t,"WorkerPool has unique UUID", async () => {
      const pool1 = await WorkerPool.create(1);
      const pool2 = await WorkerPool.create(1);
      try {
        assertNotEquals(pool1.uuid, pool2.uuid);
      } finally {
        pool1.close();
        pool2.close();
      }
    });

    await step(t,"WorkerPool.close() terminates all workers", async () => {
      const pool = await WorkerPool.create(2);
      assertEquals(pool.pool.length, 2);
      pool.close();
      assertEquals(pool.pool.length, 0);
    });

    // ========================================================================
    // Unit Tests: Single Request Execution
    // ========================================================================

    await step(t,"execute() single request - empty file", async () => {
      const pool = await WorkerPool.create(1);
      try {
        const result = await pool.execute<string>(xxhash3Request(testFiles.empty));
        assertEquals(result, TEST_DATA.empty.xxhash3);
      } finally {
        pool.close();
      }
    });

    await step(t,"execute() single request - single byte", async () => {
      const pool = await WorkerPool.create(1);
      try {
        const result = await pool.execute<string>(xxhash3Request(testFiles.singleByte));
        assertEquals(result, TEST_DATA.singleByte.xxhash3);
      } finally {
        pool.close();
      }
    });

    await step(t,"execute() single request - hello", async () => {
      const pool = await WorkerPool.create(1);
      try {
        const result = await pool.execute<string>(xxhash3Request(testFiles.hello));
        assertEquals(result, TEST_DATA.hello.xxhash3);
      } finally {
        pool.close();
      }
    });

    await step(t,"execute() single request - Hello World", async () => {
      const pool = await WorkerPool.create(1);
      try {
        const result = await pool.execute<string>(xxhash3Request(testFiles.helloWorld));
        assertEquals(result, TEST_DATA.helloWorld.xxhash3);
      } finally {
        pool.close();
      }
    });

    await step(t,"execute() single request - zeros 1k", async () => {
      const pool = await WorkerPool.create(1);
      try {
        const result = await pool.execute<string>(xxhash3Request(testFiles.zeros1k));
        assertEquals(result, TEST_DATA.zeros1k.xxhash3);
      } finally {
        pool.close();
      }
    });

    await step(t,"execute() single request - byte range pattern", async () => {
      const pool = await WorkerPool.create(1);
      try {
        const result = await pool.execute<string>(xxhash3Request(testFiles.byteRange));
        assertEquals(result, TEST_DATA.byteRange.xxhash3);
      } finally {
        pool.close();
      }
    });

    await step(t,"execute() single request - large 1MB file", async () => {
      const pool = await WorkerPool.create(1);
      try {
        const result = await pool.execute<string>(xxhash3Request(testFiles.largeMB));
        assertEquals(result, TEST_DATA.largeMB.xxhash3);
      } finally {
        pool.close();
      }
    });

    // ========================================================================
    // Parallel Execution Tests
    // ========================================================================

    await step(t,"parallel execution with multiple workers", async () => {
      const pool = await WorkerPool.create(4);
      try {
        const keys = Object.keys(testFiles) as TestDataKey[];
        const requests = keys.map(key =>
          pool.execute<string>(xxhash3Request(testFiles[key]))
        );

        const results = await Promise.all(requests);

        for (let i = 0; i < keys.length; i++) {
          assertEquals(results[i], TEST_DATA[keys[i]].xxhash3);
        }
      } finally {
        pool.close();
      }
    });

    await step(t,"parallel execution - same file multiple times", async () => {
      const pool = await WorkerPool.create(4);
      try {
        const requests = Array(10).fill(null).map(() =>
          pool.execute<string>(xxhash3Request(testFiles.hello))
        );

        const results = await Promise.all(requests);

        for (const result of results) {
          assertEquals(result, TEST_DATA.hello.xxhash3);
        }
      } finally {
        pool.close();
      }
    });

    await step(t,"parallel execution with more requests than workers (queue overflow)", async () => {
      const pool = await WorkerPool.create(2);
      try {
        const keys = Object.keys(testFiles) as TestDataKey[];
        const requests = [...keys, ...keys].map(key =>
          pool.execute<string>(xxhash3Request(testFiles[key]))
        );

        const results = await Promise.all(requests);
        assertEquals(results.length, keys.length * 2);
      } finally {
        pool.close();
      }
    });

    // ========================================================================
    // Serial Execution Tests
    // ========================================================================

    await step(t,"serial execution with single worker", async () => {
      const pool = await WorkerPool.create(1);
      try {
        for (const [key, data] of Object.entries(TEST_DATA)) {
          const result = await pool.execute<string>(xxhash3Request(testFiles[key as TestDataKey]));
          assertEquals(result, data.xxhash3, `Failed for ${key}`);
        }
      } finally {
        pool.close();
      }
    });

    await step(t,"serial execution maintains order with queue", async () => {
      const pool = await WorkerPool.create(1);
      try {
        const order: number[] = [];
        const requests = [1, 2, 3, 4, 5].map(async (n) => {
          await pool.execute<string>(xxhash3Request(testFiles.hello));
          order.push(n);
          return n;
        });

        await Promise.all(requests);
        assertEquals(order.length, 5);
      } finally {
        pool.close();
      }
    });

    // ========================================================================
    // Queue Management Tests
    // ========================================================================

    await step(t,"queue is empty when workers are available", async () => {
      const pool = await WorkerPool.create(4);
      try {
        assertEquals(pool.queue.length, 0);

        const promise = pool.execute<string>(xxhash3Request(testFiles.hello));
        assertEquals(pool.queue.length, 0);

        await promise;
      } finally {
        pool.close();
      }
    });

    await step(t,"multiple pools operate independently", async () => {
      const pool1 = await WorkerPool.create(2);
      const pool2 = await WorkerPool.create(2);
      try {
        const result1 = pool1.execute<string>(xxhash3Request(testFiles.hello));
        const result2 = pool2.execute<string>(xxhash3Request(testFiles.helloWorld));

        const [r1, r2] = await Promise.all([result1, result2]);

        assertEquals(r1, TEST_DATA.hello.xxhash3);
        assertEquals(r2, TEST_DATA.helloWorld.xxhash3);
      } finally {
        pool1.close();
        pool2.close();
      }
    });

    // ========================================================================
    // Error Handling Tests
    // ========================================================================

    await step(t,"execute() rejects for non-existent file", async () => {
      const pool = await WorkerPool.create(1);
      await assertRejects(
        async () => {
          await pool.execute<string>(xxhash3Request(`${tempDir}/nonexistent.bin`));
        },
        Error
      );
      pool.close();
    });

    await step(t,"execute() rejects for invalid path", async () => {
      const pool = await WorkerPool.create(1);
      await assertRejects(
        async () => {
          await pool.execute<string>(xxhash3Request(`${tempDir}/invalid_path_test.bin`));
        },
        Error
      );
      pool.close();
    });

    await step(t,"pool continues working after error", async () => {
      const pool = await WorkerPool.create(1);
      try {
        await assertRejects(
          async () => {
            await pool.execute<string>(xxhash3Request(`${tempDir}/nonexistent.bin`));
          }
        );

        const result = await pool.execute<string>(xxhash3Request(testFiles.hello));
        assertEquals(result, TEST_DATA.hello.xxhash3);
      } finally {
        pool.close();
      }
    });

    await step(t,"multiple errors don't break the pool", async () => {
      const pool = await WorkerPool.create(2);
      try {
        const results = await Promise.allSettled([
          pool.execute<string>(xxhash3Request(testFiles.hello)),
          pool.execute<string>(xxhash3Request(`${tempDir}/bad1.bin`)),
          pool.execute<string>(xxhash3Request(testFiles.helloWorld)),
          pool.execute<string>(xxhash3Request(`${tempDir}/bad2.bin`)),
          pool.execute<string>(xxhash3Request(testFiles.zeros1k)),
        ]);

        assertEquals((results[0] as PromiseFulfilledResult<string>).value, TEST_DATA.hello.xxhash3);
        assertEquals(results[1].status, "rejected");
        assertEquals((results[2] as PromiseFulfilledResult<string>).value, TEST_DATA.helloWorld.xxhash3);
        assertEquals(results[3].status, "rejected");
        assertEquals((results[4] as PromiseFulfilledResult<string>).value, TEST_DATA.zeros1k.xxhash3);
      } finally {
        pool.close();
      }
    });

    // ========================================================================
    // FS Request Tests (non-xxhash3)
    // ========================================================================

    await step(t,"execute() stat request", async () => {
      const pool = await WorkerPool.create(1);
      try {
        const result = await pool.execute<Deno.FileInfo>({
          action: "stat",
          path: testFiles.hello,
        });

        assertExists(result);
        assertEquals(result.size, TEST_DATA.hello.bytes.length);
        assertEquals(result.isFile, true);
      } finally {
        pool.close();
      }
    });

    await step(t,"execute() readDir request", async () => {
      const pool = await WorkerPool.create(1);
      try {
        const result = await pool.execute<Deno.DirEntry[]>({
          action: "readDir",
          path: tempDir,
        });

        assertExists(result);
        assertGreater(result.length, 0);

        const names = result.map(e => e.name);
        expect(names).toContain("hello.bin");
        expect(names).toContain("empty.bin");
      } finally {
        pool.close();
      }
    });

    await step(t,"execute() realPath request", async () => {
      const pool = await WorkerPool.create(1);
      try {
        const result = await pool.execute<string>({
          action: "realPath",
          path: testFiles.hello,
        });

        assertExists(result);
        expect(result).toContain("hello.bin");
      } finally {
        pool.close();
      }
    });

    // ========================================================================
    // WebSocket Integration Tests
    // ========================================================================

    await step(t,"WebSocketHost.create() creates host with workers", async () => {
      const host = await WebSocketHost.create(2, { port: 0 });
      try {
        assertExists(host);
        assertExists(host.server);
        assertEquals(host.proxies.length, 0);
      } finally {
        await host.server.shutdown();
      }
    });

    await step(t,"WorkerPool can connect to WebSocketHost", async () => {
      const host = await WebSocketHost.create(2, { port: 0 });
      const addr = host.server.addr as Deno.NetAddr;
      const pool = await WorkerPool.create(1);

      try {
        const proxy = await pool.connect(`ws://localhost:${addr.port}`);
        assertExists(proxy);
        assertEquals(pool.pool.length, 2);

        await delay(100);
        assertEquals(host.proxies.length, 1);
      } finally {
        pool.close();
        await host.server.shutdown();
      }
    });

    await step(t,"execute() via WebSocket remote worker", async () => {
      const host = await WebSocketHost.create(2, { port: 0 });
      const addr = host.server.addr as Deno.NetAddr;
      const pool = new WorkerPool([]);

      try {
        await pool.connect(`ws://localhost:${addr.port}`);
        await delay(100);

        const result = await pool.execute<string>(xxhash3Request(testFiles.hello));
        assertEquals(result, TEST_DATA.hello.xxhash3);
      } finally {
        pool.close();
        await host.server.shutdown();
      }
    }, 10_000);

    await step(t,"execute() multiple requests via WebSocket", async () => {
      const host = await WebSocketHost.create(2, { port: 0 });
      const addr = host.server.addr as Deno.NetAddr;
      const pool = new WorkerPool([]);

      try {
        await pool.connect(`ws://localhost:${addr.port}`);
        await delay(100);

        for (const [key, data] of Object.entries(TEST_DATA)) {
          const result = await pool.execute<string>(xxhash3Request(testFiles[key as TestDataKey]));
          assertEquals(result, data.xxhash3, `WebSocket failed for ${key}`);
        }
      } finally {
        pool.close();
        await host.server.shutdown();
      }
    }, 15_000);

    await step(t,"mixed local and WebSocket execution", async () => {
      const host = await WebSocketHost.create(2, { port: 0 });
      const addr = host.server.addr as Deno.NetAddr;
      const pool = await WorkerPool.create(2);

      try {
        await pool.connect(`ws://localhost:${addr.port}`);
        await delay(100);

        assertEquals(pool.pool.length, 3);

        const keys = Object.keys(testFiles) as TestDataKey[];
        const requests = keys.map(key =>
          pool.execute<string>(xxhash3Request(testFiles[key]))
        );

        const results = await Promise.all(requests);

        for (let i = 0; i < keys.length; i++) {
          assertEquals(results[i], TEST_DATA[keys[i]].xxhash3);
        }
      } finally {
        pool.close();
        await host.server.shutdown();
      }
    }, 10_000);

    await step(t,"multiple WebSocket connections to same host", async () => {
      const host = await WebSocketHost.create(4, { port: 0 });
      const addr = host.server.addr as Deno.NetAddr;
      const pool = new WorkerPool([]);

      try {
        await pool.connect(`ws://localhost:${addr.port}`);
        await pool.connect(`ws://localhost:${addr.port}`);
        await delay(100);

        assertEquals(pool.pool.length, 2);
        assertEquals(host.proxies.length, 2);

        const result = await pool.execute<string>(xxhash3Request(testFiles.hello));
        assertEquals(result, TEST_DATA.hello.xxhash3);
      } finally {
        pool.close();
        await host.server.shutdown();
      }
    }, 10_000);

    // ========================================================================
    // Performance and Stress Tests
    // ========================================================================

    await step(t,"stress test: 100 parallel requests", async () => {
      const pool = await WorkerPool.create(4);
      try {
        const keys = Object.keys(testFiles) as TestDataKey[];
        const requests: Promise<string>[] = [];
        for (let i = 0; i < 100; i++) {
          const key = keys[i % keys.length];
          requests.push(pool.execute<string>(xxhash3Request(testFiles[key])));
        }

        const results = await Promise.all(requests);
        assertEquals(results.length, 100);

        for (const result of results) {
          expect(result).toMatch(/^[0-9a-f]{16}$/);
        }
      } finally {
        pool.close();
      }
    });

    await step(t,"stress test: rapid sequential requests", async () => {
      const pool = await WorkerPool.create(1);
      try {
        for (let i = 0; i < 20; i++) {
          const result = await pool.execute<string>(xxhash3Request(testFiles.hello));
          assertEquals(result, TEST_DATA.hello.xxhash3);
        }
      } finally {
        pool.close();
      }
    });

    await step(t,"stress test: mixed parallel and sequential", async () => {
      const pool = await WorkerPool.create(3);
      try {
        for (let batch = 0; batch < 5; batch++) {
          const requests = [
            pool.execute<string>(xxhash3Request(testFiles.hello)),
            pool.execute<string>(xxhash3Request(testFiles.helloWorld)),
            pool.execute<string>(xxhash3Request(testFiles.zeros1k)),
          ];

          const results = await Promise.all(requests);
          assertEquals(results[0], TEST_DATA.hello.xxhash3);
          assertEquals(results[1], TEST_DATA.helloWorld.xxhash3);
          assertEquals(results[2], TEST_DATA.zeros1k.xxhash3);
        }
      } finally {
        pool.close();
      }
    });

    // ========================================================================
    // Worker State Tests
    // ========================================================================

    await step(t,"workers have unique UUIDs", async () => {
      const pool = await WorkerPool.create(4);
      try {
        const uuids = pool.pool.map(w => w.uuid);
        const uniqueUuids = new Set(uuids);
        assertEquals(uniqueUuids.size, 4);
      } finally {
        pool.close();
      }
    });

    await step(t,"workers start not busy", async () => {
      const pool = await WorkerPool.create(3);
      try {
        for (const worker of pool.pool) {
          assertEquals(worker.busy, false);
        }
      } finally {
        pool.close();
      }
    });

    // ========================================================================
    // Detailed State Tests: ThreadWorker
    // ========================================================================

    await step(t,"ThreadWorker.create() initializes with correct state", async () => {
      const worker = await ThreadWorker.create();
      try {
        assertExists(worker.uuid);
        expect(worker.uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
        assertEquals(worker.busy, false);
      } finally {
        worker.close();
      }
    });

    await step(t,"ThreadWorker.busy transitions to true during execution", async () => {
      const worker = await ThreadWorker.create();
      try {
        assertEquals(worker.busy, false, "Worker should start not busy");

        // Start execution but don't await immediately
        const resultPromise = new Promise<string>((resolve, reject) => {
          worker.execute({
            request: xxhash3Request(testFiles.largeMB),
            resolve,
            reject,
            queuedAt: Date.now()
          });
        });

        // Check busy state immediately after starting
        assertEquals(worker.busy, true, "Worker should be busy during execution");

        // Wait for completion
        await resultPromise;
        assertEquals(worker.busy, false, "Worker should not be busy after completion");
      } finally {
        worker.close();
      }
    });

    await step(t,"ThreadWorker.busy returns to false after error", async () => {
      const worker = await ThreadWorker.create();
      try {
        assertEquals(worker.busy, false);

        const resultPromise = new Promise<string>((resolve, reject) => {
          worker.execute({
            request: xxhash3Request(`${tempDir}/does_not_exist_state_test.bin`),
            resolve,
            reject,
            queuedAt: Date.now()
          });
        });

        assertEquals(worker.busy, true, "Worker should be busy during execution");

        await resultPromise.catch(() => {});
        assertEquals(worker.busy, false, "Worker should not be busy after error");
      } finally {
        worker.close();
      }
    });

    await step(t,"multiple ThreadWorkers have independent UUIDs", async () => {
      const workers = await Promise.all([
        ThreadWorker.create(),
        ThreadWorker.create(),
        ThreadWorker.create(),
      ]);
      try {
        const uuids = workers.map(w => w.uuid);
        const uniqueUuids = new Set(uuids);
        assertEquals(uniqueUuids.size, 3, "All workers should have unique UUIDs");
      } finally {
        workers.forEach(w => w.close());
      }
    });

    await step(t,"ThreadWorker.close() can be called multiple times safely", async () => {
      const worker = await ThreadWorker.create();
      worker.close();
      worker.close(); // Should not throw
      worker.close(); // Should not throw
    });

    // ========================================================================
    // Detailed State Tests: WorkerPool
    // ========================================================================

    await step(t,"WorkerPool constructor initializes empty queue", async () => {
      const pool = new WorkerPool([]);
      assertEquals(pool.queue.length, 0);
      assertEquals(pool.pool.length, 0);
      assertExists(pool.uuid);
    });

    await step(t,"WorkerPool.uuid is valid UUID format", async () => {
      const pool = await WorkerPool.create(1);
      try {
        expect(pool.uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      } finally {
        pool.close();
      }
    });

    await step(t,"WorkerPool.pool contains correct number of workers after create", async () => {
      for (const count of [1, 2, 3, 4, 5]) {
        const pool = await WorkerPool.create(count);
        assertEquals(pool.pool.length, count, `Pool should have ${count} workers`);
        pool.close();
        assertEquals(pool.pool.length, 0, "Pool should be empty after close");
      }
    });

    await step(t,"WorkerPool.queue grows when all workers busy", async () => {
      const pool = await WorkerPool.create(1);
      try {
        assertEquals(pool.queue.length, 0, "Queue should start empty");

        // Start first request - will occupy the only worker
        const promise1 = pool.execute<string>(xxhash3Request(testFiles.largeMB));
        assertEquals(pool.queue.length, 0, "First request should not queue (worker available)");

        // Start second request - should queue
        const promise2 = pool.execute<string>(xxhash3Request(testFiles.hello));
        assertEquals(pool.queue.length, 1, "Second request should queue (worker busy)");

        // Start third request - should also queue
        const promise3 = pool.execute<string>(xxhash3Request(testFiles.helloWorld));
        assertEquals(pool.queue.length, 2, "Third request should queue");

        await Promise.all([promise1, promise2, promise3]);
        assertEquals(pool.queue.length, 0, "Queue should be empty after all complete");
      } finally {
        pool.close();
      }
    });

    await step(t,"WorkerPool.queue drains as workers become free", async () => {
      const pool = await WorkerPool.create(2);
      try {
        // Queue up 5 requests with only 2 workers
        const promises = [
          pool.execute<string>(xxhash3Request(testFiles.hello)),
          pool.execute<string>(xxhash3Request(testFiles.hello)),
          pool.execute<string>(xxhash3Request(testFiles.hello)),
          pool.execute<string>(xxhash3Request(testFiles.hello)),
          pool.execute<string>(xxhash3Request(testFiles.hello)),
        ];

        // Initially 3 should be queued (5 requests, 2 workers)
        assertEquals(pool.queue.length, 3, "3 requests should be queued initially");

        await Promise.all(promises);
        assertEquals(pool.queue.length, 0, "Queue should be empty after completion");
      } finally {
        pool.close();
      }
    });

    await step(t,"WorkerPool worker busy states during parallel execution", async () => {
      const pool = await WorkerPool.create(2);
      try {
        // All workers should start not busy
        assertEquals(pool.pool.every(w => !w.busy), true, "All workers should start not busy");

        // Start two requests to occupy both workers
        const promise1 = pool.execute<string>(xxhash3Request(testFiles.largeMB));
        const promise2 = pool.execute<string>(xxhash3Request(testFiles.largeMB));

        // Both workers should now be busy
        const busyCount = pool.pool.filter(w => w.busy).length;
        assertEquals(busyCount, 2, "Both workers should be busy");

        await Promise.all([promise1, promise2]);

        // All workers should be free again
        assertEquals(pool.pool.every(w => !w.busy), true, "All workers should be free after completion");
      } finally {
        pool.close();
      }
    });

    await step(t,"WorkerPool.close() empties pool array", async () => {
      const pool = await WorkerPool.create(4);
      assertEquals(pool.pool.length, 4);

      pool.close();
      assertEquals(pool.pool.length, 0, "Pool array should be empty after close");
      assertEquals(pool.queue.length, 0, "Queue should remain empty");
    });

    await step(t,"WorkerPool.close() preserves uuid", async () => {
      const pool = await WorkerPool.create(2);
      const originalUuid = pool.uuid;

      pool.close();
      assertEquals(pool.uuid, originalUuid, "UUID should be preserved after close");
    });

    // ========================================================================
    // Detailed State Tests: Queue Behavior
    // ========================================================================

    await step(t,"queue request contains correct structure", async () => {
      const pool = await WorkerPool.create(1);
      try {
        // Occupy the worker
        const blockingPromise = pool.execute<string>(xxhash3Request(testFiles.largeMB));

        // Queue a request
        const queuedPromise = pool.execute<string>(xxhash3Request(testFiles.hello));

        // Check queue structure
        assertEquals(pool.queue.length, 1);
        const queuedRequest = pool.queue[0];
        assertExists(queuedRequest.request);
        assertExists(queuedRequest.resolve);
        assertExists(queuedRequest.reject);
        assertEquals(typeof queuedRequest.resolve, "function");
        assertEquals(typeof queuedRequest.reject, "function");

        await Promise.all([blockingPromise, queuedPromise]);
      } finally {
        pool.close();
      }
    });

    await step(t,"queue maintains FIFO order", async () => {
      const pool = await WorkerPool.create(1);
      try {
        const executionOrder: number[] = [];

        // Occupy the worker with first request
        const p1 = pool.execute<string>(xxhash3Request(testFiles.hello)).then(() => {
          executionOrder.push(1);
        });

        // Queue additional requests
        const p2 = pool.execute<string>(xxhash3Request(testFiles.hello)).then(() => {
          executionOrder.push(2);
        });
        const p3 = pool.execute<string>(xxhash3Request(testFiles.hello)).then(() => {
          executionOrder.push(3);
        });
        const p4 = pool.execute<string>(xxhash3Request(testFiles.hello)).then(() => {
          executionOrder.push(4);
        });

        await Promise.all([p1, p2, p3, p4]);

        // Verify FIFO execution order
        assertEquals(executionOrder, [1, 2, 3, 4], "Requests should complete in FIFO order");
      } finally {
        pool.close();
      }
    });

    // ========================================================================
    // Detailed State Tests: WebSocketHost
    // ========================================================================

    await step(t,"WebSocketHost initializes with empty proxies array", async () => {
      const host = await WebSocketHost.create(2, { port: 0 });
      try {
        assertEquals(host.proxies.length, 0);
        assertExists(host.server);
      } finally {
        await host.server.shutdown();
      }
    });

    await step(t,"WebSocketHost.proxies grows with each connection", async () => {
      const host = await WebSocketHost.create(2, { port: 0 });
      const addr = host.server.addr as Deno.NetAddr;
      const pool = new WorkerPool([]);

      try {
        assertEquals(host.proxies.length, 0, "Should start with no proxies");

        await pool.connect(`ws://localhost:${addr.port}`);
        await delay(50);
        assertEquals(host.proxies.length, 1, "Should have 1 proxy after first connection");

        await pool.connect(`ws://localhost:${addr.port}`);
        await delay(50);
        assertEquals(host.proxies.length, 2, "Should have 2 proxies after second connection");
      } finally {
        pool.close();
        await host.server.shutdown();
      }
    });

    await step(t,"WebSocketHost server has valid address", async () => {
      const host = await WebSocketHost.create(2, { port: 0 });
      try {
        const addr = host.server.addr as Deno.NetAddr;
        assertExists(addr.port);
        assertGreater(addr.port, 0);
      } finally {
        await host.server.shutdown();
      }
    });

    // ========================================================================
    // Detailed State Tests: Connection State
    // ========================================================================

    await step(t,"WorkerPool.connect() adds worker to pool", async () => {
      const host = await WebSocketHost.create(2, { port: 0 });
      const addr = host.server.addr as Deno.NetAddr;
      const pool = new WorkerPool([]);

      try {
        assertEquals(pool.pool.length, 0, "Pool should start empty");

        await pool.connect(`ws://localhost:${addr.port}`);
        assertEquals(pool.pool.length, 1, "Pool should have 1 worker after connect");

        await pool.connect(`ws://localhost:${addr.port}`);
        assertEquals(pool.pool.length, 2, "Pool should have 2 workers after second connect");
      } finally {
        pool.close();
        await host.server.shutdown();
      }
    });

    await step(t,"WorkerPool.connect() returns WebSocket proxy with correct uuid", async () => {
      const host = await WebSocketHost.create(2, { port: 0 });
      const addr = host.server.addr as Deno.NetAddr;
      const pool = new WorkerPool([]);

      try {
        const proxy = await pool.connect(`ws://localhost:${addr.port}`);
        assertExists(proxy);
        assertEquals(proxy.uuid, pool.uuid, "Proxy UUID should match pool UUID");
        assertEquals(proxy.busy, false, "Proxy should start not busy");
      } finally {
        pool.close();
        await host.server.shutdown();
      }
    });

    await step(t,"mixed local and remote workers in pool", async () => {
      const host = await WebSocketHost.create(2, { port: 0 });
      const addr = host.server.addr as Deno.NetAddr;
      const pool = await WorkerPool.create(2); // 2 local workers

      try {
        assertEquals(pool.pool.length, 2, "Should have 2 local workers");

        await pool.connect(`ws://localhost:${addr.port}`);
        assertEquals(pool.pool.length, 3, "Should have 3 workers (2 local + 1 remote)");

        // Verify all workers have required interface
        for (const worker of pool.pool) {
          assertExists(worker.uuid);
          assertEquals(typeof worker.busy, "boolean");
          assertEquals(typeof worker.execute, "function");
          assertEquals(typeof worker.close, "function");
        }
      } finally {
        pool.close();
        await host.server.shutdown();
      }
    });

    // ========================================================================
    // Edge Cases
    // ========================================================================

    await step(t,"execute() with zero-length file", async () => {
      const pool = await WorkerPool.create(1);
      try {
        const result = await pool.execute<string>(xxhash3Request(testFiles.empty));
        assertEquals(result, TEST_DATA.empty.xxhash3);
      } finally {
        pool.close();
      }
    });

    await step(t,"create pool with varying worker counts", async () => {
      for (const count of [1, 2, 4, 8]) {
        const pool = await WorkerPool.create(count);
        try {
          assertEquals(pool.pool.length, count);

          const result = await pool.execute<string>(xxhash3Request(testFiles.hello));
          assertEquals(result, TEST_DATA.hello.xxhash3);
        } finally {
          pool.close();
        }
      }
    });

    await step(t,"rapid pool create/close cycles", async () => {
      for (let i = 0; i < 5; i++) {
        const pool = await WorkerPool.create(2);
        const result = await pool.execute<string>(xxhash3Request(testFiles.hello));
        assertEquals(result, TEST_DATA.hello.xxhash3);
        pool.close();
      }
    });

    // ========================================================================
    // Cleanup
    // ========================================================================

    await Deno.remove(tempDir, { recursive: true });
  },
});

// ============================================================================
// Standalone Tests for xxhash3 Value Verification
// ============================================================================

Deno.test("xxhash3 precomputed values verification", async (t) => {
  const { createXXHash3 } = await import("hash-wasm");
  const hasher = await createXXHash3();

  async function computeHash(data: Uint8Array): Promise<string> {
    hasher.init();
    hasher.update(data);
    return hasher.digest();
  }

  await step(t,"verify empty bytes hash", async () => {
    const hash = await computeHash(TEST_DATA.empty.bytes);
    assertEquals(hash, TEST_DATA.empty.xxhash3);
  });

  await step(t,"verify single byte hash", async () => {
    const hash = await computeHash(TEST_DATA.singleByte.bytes);
    assertEquals(hash, TEST_DATA.singleByte.xxhash3);
  });

  await step(t,"verify 'hello' hash", async () => {
    const hash = await computeHash(TEST_DATA.hello.bytes);
    assertEquals(hash, TEST_DATA.hello.xxhash3);
  });

  await step(t,"verify 'Hello, World!' hash", async () => {
    const hash = await computeHash(TEST_DATA.helloWorld.bytes);
    assertEquals(hash, TEST_DATA.helloWorld.xxhash3);
  });

  await step(t,"verify zeros 1k hash", async () => {
    const hash = await computeHash(TEST_DATA.zeros1k.bytes);
    assertEquals(hash, TEST_DATA.zeros1k.xxhash3);
  });

  await step(t,"verify byte range hash", async () => {
    const hash = await computeHash(TEST_DATA.byteRange.bytes);
    assertEquals(hash, TEST_DATA.byteRange.xxhash3);
  });

  await step(t,"verify large 1MB hash", async () => {
    const hash = await computeHash(TEST_DATA.largeMB.bytes);
    assertEquals(hash, TEST_DATA.largeMB.xxhash3);
  });
});
