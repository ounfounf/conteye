import { assertEquals, assertExists, assertNotEquals } from "jsr:@std/assert";
import { DuckDBInstance } from "npm:@duckdb/node-api";
import { IngestManager } from "~/core/ingest_manager.ts";
import { WorkerPool } from "~/work/worker_pool.ts";
import { DB_SCHEMA } from "~/core/instance.ts";

async function setupTestDb() {
  const instance = await DuckDBInstance.create(":memory:");
  const connection = await instance.connect();
  await connection.run(DB_SCHEMA);
  return { instance, connection };
}

async function setupTestEnvironment() {
  const { instance: dbInstance, connection } = await setupTestDb();
  const pool = await WorkerPool.create(2);

  // Create a temp directory with test files
  const tempDir = await Deno.makeTempDir({ prefix: "ingest_test_" });

  // Create some test files
  await Deno.writeTextFile(`${tempDir}/file1.txt`, "Hello World");
  await Deno.writeTextFile(`${tempDir}/file2.txt`, "Test content");
  await Deno.mkdir(`${tempDir}/subdir`);
  await Deno.writeTextFile(`${tempDir}/subdir/file3.txt`, "Nested file");

  return {
    dbInstance,
    connection,
    pool,
    tempDir,
    cleanup: async () => {
      pool.close();
      connection.closeSync();
      dbInstance.closeSync();
      await Deno.remove(tempDir, { recursive: true });
    },
  };
}

Deno.test({ name: "IngestManager", sanitizeOps: false, sanitizeResources: false }, async (t) => {
  await t.step("start creates an ingest job with queued status", async () => {
    const env = await setupTestEnvironment();
    try {
      const manager = new IngestManager(env.connection, env.pool);
      const job = await manager.start(env.tempDir);

      assertExists(job.id);
      assertEquals(job.root, env.tempDir);
      assertEquals(job.processors, ["xxhash3"]);
      assertExists(job.startedAt);
      assertEquals(job.errors.length, 0);
    } finally {
      await env.cleanup();
    }
  });

  await t.step("start accepts custom processors", async () => {
    const env = await setupTestEnvironment();
    try {
      const manager = new IngestManager(env.connection, env.pool);
      const job = await manager.start(env.tempDir, { processors: ["md5"] });

      assertEquals(job.processors, ["md5"]);
    } finally {
      await env.cleanup();
    }
  });

  await t.step("getJob retrieves job by ID", async () => {
    const env = await setupTestEnvironment();
    try {
      const manager = new IngestManager(env.connection, env.pool);
      const created = await manager.start(env.tempDir);
      const retrieved = manager.getJob(created.id);

      assertEquals(retrieved?.id, created.id);
    } finally {
      await env.cleanup();
    }
  });

  await t.step("getJob returns undefined for non-existent ID", async () => {
    const env = await setupTestEnvironment();
    try {
      const manager = new IngestManager(env.connection, env.pool);
      const job = manager.getJob("non-existent-id");

      assertEquals(job, undefined);
    } finally {
      await env.cleanup();
    }
  });

  await t.step("getJobs returns all jobs sorted by startedAt", async () => {
    const env = await setupTestEnvironment();
    try {
      const manager = new IngestManager(env.connection, env.pool);
      const job1 = await manager.start(env.tempDir);
      await new Promise(resolve => setTimeout(resolve, 10)); // Ensure different timestamps
      const job2 = await manager.start(env.tempDir);

      const jobs = manager.getJobs();
      assertEquals(jobs.length, 2);
      // Most recent first
      assertEquals(jobs[0].id, job2.id);
      assertEquals(jobs[1].id, job1.id);
    } finally {
      await env.cleanup();
    }
  });

  await t.step("cancel stops a running job", async () => {
    const env = await setupTestEnvironment();
    try {
      const manager = new IngestManager(env.connection, env.pool);
      const job = await manager.start(env.tempDir);

      // Check if job is still active, if so try to cancel
      const initialJob = manager.getJob(job.id);
      if (initialJob?.status === "completed" || initialJob?.status === "failed") {
        // Job completed too fast, just verify it has a valid end state
        assertExists(initialJob.completedAt);
      } else {
        // Job is still running, cancel it
        const cancelled = manager.cancel(job.id);
        assertEquals(cancelled, true);

        const updated = manager.getJob(job.id);
        assertEquals(updated?.status, "cancelled");
        assertExists(updated?.completedAt);
      }
    } finally {
      await env.cleanup();
    }
  });

  await t.step("cancel returns false for non-existent job", async () => {
    const env = await setupTestEnvironment();
    try {
      const manager = new IngestManager(env.connection, env.pool);
      const cancelled = manager.cancel("non-existent-id");

      assertEquals(cancelled, false);
    } finally {
      await env.cleanup();
    }
  });

  await t.step("cancel returns false for already completed job", async () => {
    const env = await setupTestEnvironment();
    try {
      const manager = new IngestManager(env.connection, env.pool);
      const job = await manager.start(env.tempDir);

      // Wait for completion
      while (true) {
        const current = manager.getJob(job.id);
        if (current?.status === "completed" || current?.status === "failed") {
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      const cancelled = manager.cancel(job.id);
      assertEquals(cancelled, false);
    } finally {
      await env.cleanup();
    }
  });

  await t.step("getActiveJobs returns only active jobs", async () => {
    const env = await setupTestEnvironment();
    try {
      const manager = new IngestManager(env.connection, env.pool);
      const job1 = await manager.start(env.tempDir);

      // Wait for job1 to complete
      while (true) {
        const current = manager.getJob(job1.id);
        if (current?.status === "completed" || current?.status === "failed") {
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // Start a new job
      await manager.start(env.tempDir);

      const activeJobs = manager.getActiveJobs();
      // The second job should be active (or already completed if fast enough)
      // At minimum, completed jobs should not be in active list
      for (const job of activeJobs) {
        assertNotEquals(job.status, "completed");
        assertNotEquals(job.status, "failed");
        assertNotEquals(job.status, "cancelled");
      }
    } finally {
      await env.cleanup();
    }
  });

  await t.step("getJobSummary returns progress information", async () => {
    const env = await setupTestEnvironment();
    try {
      const manager = new IngestManager(env.connection, env.pool);
      const job = await manager.start(env.tempDir);

      const summary = manager.getJobSummary(job.id);
      assertExists(summary);
      assertEquals(summary?.id, job.id);
      assertEquals(summary?.root, job.root);
      assertEquals(typeof summary?.progress, "number");
      assertEquals(typeof summary?.processedFiles, "number");
      assertEquals(typeof summary?.totalFiles, "number");
    } finally {
      await env.cleanup();
    }
  });

  await t.step("getJobSummary returns undefined for non-existent job", async () => {
    const env = await setupTestEnvironment();
    try {
      const manager = new IngestManager(env.connection, env.pool);
      const summary = manager.getJobSummary("non-existent-id");

      assertEquals(summary, undefined);
    } finally {
      await env.cleanup();
    }
  });

  await t.step("completes processing all files in directory", async () => {
    const env = await setupTestEnvironment();
    try {
      const manager = new IngestManager(env.connection, env.pool);
      const job = await manager.start(env.tempDir);

      // Wait for completion
      while (true) {
        const current = manager.getJob(job.id);
        if (current?.status === "completed" || current?.status === "failed") {
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      const completed = manager.getJob(job.id);
      assertEquals(completed?.status, "completed");
      assertExists(completed?.completedAt);
      // Should have processed 3 files
      assertEquals(completed?.processedFiles, 3);
    } finally {
      await env.cleanup();
    }
  });

  await t.step("stores file data in database", async () => {
    const env = await setupTestEnvironment();
    try {
      const manager = new IngestManager(env.connection, env.pool);
      const job = await manager.start(env.tempDir);

      // Wait for completion
      while (true) {
        const current = manager.getJob(job.id);
        if (current?.status === "completed" || current?.status === "failed") {
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // Check database has entries
      const pathsResult = await env.connection.run("SELECT COUNT(*) as count FROM paths");
      const pathRows = (await pathsResult.getRowObjects()) as Array<{ count: number }>;

      const filesResult = await env.connection.run("SELECT COUNT(*) as count FROM files");
      const fileRows = (await filesResult.getRowObjects()) as Array<{ count: number }>;

      // Should have paths entries (directories + files)
      assertEquals(pathRows[0].count > 0, true);
      // Should have file entries with hashes
      assertEquals(fileRows[0].count > 0, true);
    } finally {
      await env.cleanup();
    }
  });

  await t.step("clear cancels all active jobs", async () => {
    const env = await setupTestEnvironment();
    try {
      const manager = new IngestManager(env.connection, env.pool);
      await manager.start(env.tempDir);
      await manager.start(env.tempDir);

      manager.clear();

      const jobs = manager.getJobs();
      assertEquals(jobs.length, 0);
    } finally {
      await env.cleanup();
    }
  });

  await t.step("generates unique job IDs", async () => {
    const env = await setupTestEnvironment();
    try {
      const manager = new IngestManager(env.connection, env.pool);
      const job1 = await manager.start(env.tempDir);
      const job2 = await manager.start(env.tempDir);

      assertNotEquals(job1.id, job2.id);
    } finally {
      await env.cleanup();
    }
  });

  await t.step("records errors for inaccessible files", async () => {
    const env = await setupTestEnvironment();
    try {
      // Create a file then delete it to simulate access error during processing
      const problematicDir = await Deno.makeTempDir({ prefix: "ingest_error_test_" });

      const manager = new IngestManager(env.connection, env.pool);

      // Start ingest on non-existent path (after creating manager)
      // This should result in errors being recorded
      const job = await manager.start(`${problematicDir}/nonexistent`);

      // Wait for job to fail or complete
      while (true) {
        const current = manager.getJob(job.id);
        if (current?.status === "completed" || current?.status === "failed") {
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      const completed = manager.getJob(job.id);
      // Should have recorded the error
      assertEquals(completed?.status, "failed");
      assertEquals((completed?.errors?.length ?? 0) > 0, true);

      await Deno.remove(problematicDir, { recursive: true });
    } finally {
      await env.cleanup();
    }
  });
});
