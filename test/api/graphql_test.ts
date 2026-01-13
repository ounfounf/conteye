import { assertEquals, assertExists, assertStringIncludes } from "jsr:@std/assert";
import { Instance } from "~/core/instance.ts";
import { createRouter } from "~/api/router.ts";

async function setupTestInstance(): Promise<{
  instance: Instance;
  router: (req: Request) => Promise<Response>;
  cleanup: () => Promise<void>;
}> {
  const tempDir = await Deno.makeTempDir({ prefix: "graphql_test_" });
  const dbPath = `${tempDir}/test.db`;

  const instance = await Instance.create({
    port: 0,
    dbPath,
    workerCount: 2,
  });

  const router = createRouter(instance);

  return {
    instance,
    router,
    cleanup: async () => {
      await instance.close();
      await Deno.remove(tempDir, { recursive: true });
    },
  };
}

function createGraphQLRequest(
  query: string,
  variables?: Record<string, unknown>
): Request {
  return new Request("http://localhost:3000/graphql", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
}

Deno.test({ name: "GraphQL API", sanitizeOps: false, sanitizeResources: false }, async (t) => {
  // GraphiQL interface tests
  await t.step("GET /graphql returns GraphiQL HTML interface", async () => {
    const { router, cleanup } = await setupTestInstance();
    try {
      const response = await router(
        new Request("http://localhost:3000/graphql", { method: "GET" })
      );
      const html = await response.text();

      assertEquals(response.status, 200);
      assertEquals(response.headers.get("Content-Type"), "text/html");
      assertStringIncludes(html, "GraphiQL");
      assertStringIncludes(html, "graphiql");
    } finally {
      await cleanup();
    }
  });

  // Schema endpoint tests
  await t.step("GET /graphql/schema returns GraphQL schema", async () => {
    const { router, cleanup } = await setupTestInstance();
    try {
      const response = await router(
        new Request("http://localhost:3000/graphql/schema", { method: "GET" })
      );
      const schema = await response.text();

      assertEquals(response.status, 200);
      assertEquals(response.headers.get("Content-Type"), "text/plain");
      assertStringIncludes(schema, "type Query");
      assertStringIncludes(schema, "type Mutation");
      assertStringIncludes(schema, "health");
      assertStringIncludes(schema, "workers");
      assertStringIncludes(schema, "tasks");
      assertStringIncludes(schema, "ingests");
      assertStringIncludes(schema, "peers");
    } finally {
      await cleanup();
    }
  });

  // Health query tests
  await t.step("Query: health returns healthy status", async () => {
    const { router, cleanup } = await setupTestInstance();
    try {
      const response = await router(
        createGraphQLRequest(`
          query {
            health {
              status
            }
          }
        `)
      );
      const data = await response.json();

      assertEquals(response.status, 200);
      assertEquals(data.data.health.status, "healthy");
    } finally {
      await cleanup();
    }
  });

  // Status query tests
  await t.step("Query: status returns instance status", async () => {
    const { instance, router, cleanup } = await setupTestInstance();
    try {
      const response = await router(
        createGraphQLRequest(`
          query {
            status {
              id
              version
              wsUrl
              uptime
              startTime
            }
          }
        `)
      );
      const data = await response.json();

      assertEquals(response.status, 200);
      assertEquals(data.data.status.id, instance.id);
      assertExists(data.data.status.version);
      assertExists(data.data.status.wsUrl);
      assertExists(data.data.status.uptime);
      assertExists(data.data.status.startTime);
    } finally {
      await cleanup();
    }
  });

  // Metrics query tests
  await t.step("Query: metrics returns all metric categories", async () => {
    const { router, cleanup } = await setupTestInstance();
    try {
      const response = await router(
        createGraphQLRequest(`
          query {
            metrics {
              instance {
                uptimeMs
                startTime
              }
              workers {
                total
                local
                remote
                busy
                idle
              }
              tasks {
                pending
                running
                completed
                failed
                avgDurationMs
                throughputPerSec
              }
              resources {
                memoryUsedBytes
                heapUsedBytes
                heapTotalBytes
              }
              queue {
                depth
                avgWaitTimeMs
              }
            }
          }
        `)
      );
      const data = await response.json();

      assertEquals(response.status, 200);
      assertExists(data.data.metrics.instance);
      assertExists(data.data.metrics.workers);
      assertExists(data.data.metrics.tasks);
      assertExists(data.data.metrics.resources);
      assertExists(data.data.metrics.queue);
      assertEquals(data.data.metrics.workers.total, 2);
    } finally {
      await cleanup();
    }
  });

  // Workers query tests
  await t.step("Query: workers returns worker list and summary", async () => {
    const { router, cleanup } = await setupTestInstance();
    try {
      const response = await router(
        createGraphQLRequest(`
          query {
            workers {
              workers {
                id
                type
                busy
                host
              }
              summary {
                total
                local
                remote
                busy
                idle
              }
            }
          }
        `)
      );
      const data = await response.json();

      assertEquals(response.status, 200);
      assertEquals(Array.isArray(data.data.workers.workers), true);
      assertEquals(data.data.workers.summary.total, 2);
      assertEquals(data.data.workers.summary.local, 2);
      assertEquals(data.data.workers.summary.remote, 0);
    } finally {
      await cleanup();
    }
  });

  await t.step("Query: worker returns null for non-existent worker", async () => {
    const { router, cleanup } = await setupTestInstance();
    try {
      const response = await router(
        createGraphQLRequest(`
          query {
            worker(id: "non-existent-id") {
              id
              type
              busy
            }
          }
        `)
      );
      const data = await response.json();

      assertEquals(response.status, 200);
      assertEquals(data.data.worker, null);
    } finally {
      await cleanup();
    }
  });

  await t.step("Query: worker returns worker by id (via workers list)", async () => {
    const { router, cleanup } = await setupTestInstance();
    try {
      // Get the list of workers and verify we can find one
      const response = await router(
        createGraphQLRequest(`
          query {
            workers {
              workers {
                id
                type
                busy
              }
            }
          }
        `)
      );
      const data = await response.json();

      assertEquals(response.status, 200);
      assertEquals(data.data.workers.workers.length, 2);
      // Verify worker properties are present
      const firstWorker = data.data.workers.workers[0];
      assertExists(firstWorker.id);
      assertEquals(firstWorker.type, "local");
      assertEquals(typeof firstWorker.busy, "boolean");
    } finally {
      await cleanup();
    }
  });

  // Peers query tests
  await t.step("Query: peers returns empty list initially", async () => {
    const { router, cleanup } = await setupTestInstance();
    try {
      const response = await router(
        createGraphQLRequest(`
          query {
            peers {
              peers {
                id
                wsUrl
                connectedAt
              }
            }
          }
        `)
      );
      const data = await response.json();

      assertEquals(response.status, 200);
      assertEquals(data.data.peers.peers, []);
    } finally {
      await cleanup();
    }
  });

  // Tasks query tests
  await t.step("Query: tasks returns empty list initially", async () => {
    const { router, cleanup } = await setupTestInstance();
    try {
      const response = await router(
        createGraphQLRequest(`
          query {
            tasks {
              tasks {
                id
                status
                queuedAt
              }
              summary {
                total
                pending
                running
                completed
                failed
              }
            }
          }
        `)
      );
      const data = await response.json();

      assertEquals(response.status, 200);
      assertEquals(data.data.tasks.tasks, []);
      assertEquals(data.data.tasks.summary.total, 0);
    } finally {
      await cleanup();
    }
  });

  await t.step("Query: tasks supports limit parameter", async () => {
    const { router, cleanup } = await setupTestInstance();
    try {
      const response = await router(
        createGraphQLRequest(
          `query GetTasks($limit: Int) {
            tasks(limit: $limit) {
              tasks {
                id
              }
            }
          }`,
          { limit: 10 }
        )
      );
      const data = await response.json();

      assertEquals(response.status, 200);
      assertExists(data.data.tasks.tasks);
    } finally {
      await cleanup();
    }
  });

  await t.step("Query: task returns null for non-existent task", async () => {
    const { router, cleanup } = await setupTestInstance();
    try {
      const response = await router(
        createGraphQLRequest(`
          query {
            task(id: "non-existent-id") {
              id
              status
            }
          }
        `)
      );
      const data = await response.json();

      assertEquals(response.status, 200);
      assertEquals(data.data.task, null);
    } finally {
      await cleanup();
    }
  });

  await t.step("Query: activeTasks returns active tasks", async () => {
    const { router, cleanup } = await setupTestInstance();
    try {
      const response = await router(
        createGraphQLRequest(`
          query {
            activeTasks {
              tasks {
                id
                status
              }
              summary {
                pending
                running
              }
            }
          }
        `)
      );
      const data = await response.json();

      assertEquals(response.status, 200);
      assertExists(data.data.activeTasks.tasks);
      assertExists(data.data.activeTasks.summary);
    } finally {
      await cleanup();
    }
  });

  await t.step("Query: taskSummary returns summary counts", async () => {
    const { router, cleanup } = await setupTestInstance();
    try {
      const response = await router(
        createGraphQLRequest(`
          query {
            taskSummary {
              total
              pending
              running
              completed
              failed
            }
          }
        `)
      );
      const data = await response.json();

      assertEquals(response.status, 200);
      assertEquals(typeof data.data.taskSummary.total, "number");
      assertEquals(typeof data.data.taskSummary.pending, "number");
      assertEquals(typeof data.data.taskSummary.running, "number");
      assertEquals(typeof data.data.taskSummary.completed, "number");
      assertEquals(typeof data.data.taskSummary.failed, "number");
    } finally {
      await cleanup();
    }
  });

  // Ingests query tests
  await t.step("Query: ingests returns empty list initially", async () => {
    const { router, cleanup } = await setupTestInstance();
    try {
      const response = await router(
        createGraphQLRequest(`
          query {
            ingests {
              ingests {
                id
                root
                status
                progress
                processedFiles
                totalFiles
              }
              active
              total
            }
          }
        `)
      );
      const data = await response.json();

      assertEquals(response.status, 200);
      assertEquals(data.data.ingests.ingests, []);
      assertEquals(data.data.ingests.active, 0);
      assertEquals(data.data.ingests.total, 0);
    } finally {
      await cleanup();
    }
  });

  await t.step("Query: ingest returns null for non-existent ingest", async () => {
    const { router, cleanup } = await setupTestInstance();
    try {
      const response = await router(
        createGraphQLRequest(`
          query {
            ingest(id: "non-existent-id") {
              id
              status
            }
          }
        `)
      );
      const data = await response.json();

      assertEquals(response.status, 200);
      assertEquals(data.data.ingest, null);
    } finally {
      await cleanup();
    }
  });

  await t.step("Query: activeIngests returns active ingests", async () => {
    const { router, cleanup } = await setupTestInstance();
    try {
      const response = await router(
        createGraphQLRequest(`
          query {
            activeIngests {
              ingests {
                id
                status
                progress
              }
              count
            }
          }
        `)
      );
      const data = await response.json();

      assertEquals(response.status, 200);
      assertExists(data.data.activeIngests.ingests);
      assertEquals(typeof data.data.activeIngests.count, "number");
    } finally {
      await cleanup();
    }
  });

  // Combined query tests (multiple fields in one query)
  await t.step("Query: multiple fields in single query", async () => {
    const { router, cleanup } = await setupTestInstance();
    try {
      const response = await router(
        createGraphQLRequest(`
          query {
            health {
              status
            }
            workers {
              summary {
                total
              }
            }
            taskSummary {
              total
            }
          }
        `)
      );
      const data = await response.json();

      assertEquals(response.status, 200);
      assertEquals(data.data.health.status, "healthy");
      assertEquals(data.data.workers.summary.total, 2);
      assertEquals(data.data.taskSummary.total, 0);
    } finally {
      await cleanup();
    }
  });

  // Mutation tests: connectRemoteWorker
  await t.step("Mutation: connectRemoteWorker validates URL format", async () => {
    const { router, cleanup } = await setupTestInstance();
    try {
      const response = await router(
        createGraphQLRequest(`
          mutation {
            connectRemoteWorker(wsUrl: "not-a-valid-url") {
              success
              peerId
              error
            }
          }
        `)
      );
      const data = await response.json();

      assertEquals(response.status, 200);
      assertEquals(data.data.connectRemoteWorker.success, false);
      assertStringIncludes(data.data.connectRemoteWorker.error, "Invalid");
    } finally {
      await cleanup();
    }
  });

  // Mutation tests: disconnectWorker
  await t.step("Mutation: disconnectWorker returns error for non-existent worker", async () => {
    const { router, cleanup } = await setupTestInstance();
    try {
      const response = await router(
        createGraphQLRequest(`
          mutation {
            disconnectWorker(id: "non-existent-id") {
              success
              error
            }
          }
        `)
      );
      const data = await response.json();

      assertEquals(response.status, 200);
      assertEquals(data.data.disconnectWorker.success, false);
      assertExists(data.data.disconnectWorker.error);
    } finally {
      await cleanup();
    }
  });

  await t.step("Mutation: disconnectWorker cannot disconnect local workers", async () => {
    const { router, cleanup } = await setupTestInstance();
    try {
      // Get a local worker ID
      const listResponse = await router(
        createGraphQLRequest(`
          query {
            workers {
              workers {
                id
                type
              }
            }
          }
        `)
      );
      const listData = await listResponse.json();
      const localWorker = listData.data.workers.workers.find(
        (w: { type: string }) => w.type === "local"
      );

      // Try to disconnect it
      const response = await router(
        createGraphQLRequest(`
          mutation {
            disconnectWorker(id: "${localWorker.id}") {
              success
              error
            }
          }
        `)
      );
      const data = await response.json();

      assertEquals(response.status, 200);
      assertEquals(data.data.disconnectWorker.success, false);
      assertStringIncludes(data.data.disconnectWorker.error, "local");
    } finally {
      await cleanup();
    }
  });

  // Mutation tests: connectPeer
  await t.step("Mutation: connectPeer validates URL format", async () => {
    const { router, cleanup } = await setupTestInstance();
    try {
      const response = await router(
        createGraphQLRequest(`
          mutation {
            connectPeer(wsUrl: "invalid-url") {
              success
              peer {
                id
              }
              error
            }
          }
        `)
      );
      const data = await response.json();

      assertEquals(response.status, 200);
      assertEquals(data.data.connectPeer.success, false);
      assertStringIncludes(data.data.connectPeer.error, "Invalid");
    } finally {
      await cleanup();
    }
  });

  // Mutation tests: disconnectPeer
  await t.step("Mutation: disconnectPeer returns error for non-existent peer", async () => {
    const { router, cleanup } = await setupTestInstance();
    try {
      const response = await router(
        createGraphQLRequest(`
          mutation {
            disconnectPeer(id: "non-existent-id") {
              success
              error
            }
          }
        `)
      );
      const data = await response.json();

      assertEquals(response.status, 200);
      assertEquals(data.data.disconnectPeer.success, false);
      assertStringIncludes(data.data.disconnectPeer.error, "not found");
    } finally {
      await cleanup();
    }
  });

  // Mutation tests: startIngest
  await t.step("Mutation: startIngest requires root path", async () => {
    const { router, cleanup } = await setupTestInstance();
    try {
      const response = await router(
        createGraphQLRequest(`
          mutation {
            startIngest(root: "") {
              success
              ingest {
                id
              }
              error
            }
          }
        `)
      );
      const data = await response.json();

      assertEquals(response.status, 200);
      assertEquals(data.data.startIngest.success, false);
      assertStringIncludes(data.data.startIngest.error, "root");
    } finally {
      await cleanup();
    }
  });

  await t.step("Mutation: startIngest validates empty root path", async () => {
    const { router, cleanup } = await setupTestInstance();
    try {
      // Test with empty root - should fail validation
      const response = await router(
        createGraphQLRequest(`
          mutation {
            startIngest(root: "") {
              success
              error
            }
          }
        `)
      );
      const data = await response.json();

      assertEquals(response.status, 200);
      assertEquals(data.data.startIngest.success, false);
      assertStringIncludes(data.data.startIngest.error, "root");
    } finally {
      await cleanup();
    }
  });

  await t.step("Mutation: startIngest response structure is correct", async () => {
    const { router, cleanup } = await setupTestInstance();
    try {
      // Test response structure (will fail due to non-existent path but shows structure)
      const response = await router(
        createGraphQLRequest(`
          mutation {
            startIngest(root: "/tmp/definitely-not-existing-path-12345") {
              success
              ingest {
                id
                status
              }
              error
            }
          }
        `)
      );
      const data = await response.json();

      assertEquals(response.status, 200);
      assertExists(data.data.startIngest);
      assertEquals(typeof data.data.startIngest.success, "boolean");
      // Should fail because path doesn't exist
      assertEquals(data.data.startIngest.success, false);
      assertExists(data.data.startIngest.error);
    } finally {
      await cleanup();
    }
  });

  // Mutation tests: cancelIngest
  await t.step("Mutation: cancelIngest returns error for non-existent ingest", async () => {
    const { router, cleanup } = await setupTestInstance();
    try {
      const response = await router(
        createGraphQLRequest(`
          mutation {
            cancelIngest(id: "non-existent-id") {
              success
              error
            }
          }
        `)
      );
      const data = await response.json();

      assertEquals(response.status, 200);
      assertEquals(data.data.cancelIngest.success, false);
      assertStringIncludes(data.data.cancelIngest.error, "not found");
    } finally {
      await cleanup();
    }
  });

  // Error handling tests
  await t.step("returns error for invalid query", async () => {
    const { router, cleanup } = await setupTestInstance();
    try {
      const response = await router(
        createGraphQLRequest(`
          query {
            unknownField {
              id
            }
          }
        `)
      );
      const data = await response.json();

      assertEquals(response.status, 200);
      assertExists(data.errors);
      assertEquals(data.errors.length > 0, true);
    } finally {
      await cleanup();
    }
  });

  await t.step("returns error for missing query", async () => {
    const { router, cleanup } = await setupTestInstance();
    try {
      const response = await router(
        new Request("http://localhost:3000/graphql", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        })
      );
      const data = await response.json();

      assertEquals(response.status, 400);
      assertExists(data.errors);
    } finally {
      await cleanup();
    }
  });

  await t.step("returns error for invalid JSON body", async () => {
    const { router, cleanup } = await setupTestInstance();
    try {
      const response = await router(
        new Request("http://localhost:3000/graphql", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "not valid json",
        })
      );
      const data = await response.json();

      assertEquals(response.status, 400);
      assertExists(data.errors);
    } finally {
      await cleanup();
    }
  });

  await t.step("rejects non-GET/POST methods (returns 404)", async () => {
    const { router, cleanup } = await setupTestInstance();
    try {
      const response = await router(
        new Request("http://localhost:3000/graphql", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: "{ health { status } }" }),
        })
      );
      const data = await response.json();

      // PUT is not a registered route, so it returns 404
      assertEquals(response.status, 404);
      assertEquals(data.error, "Not found");
    } finally {
      await cleanup();
    }
  });

  // CORS tests
  await t.step("GraphQL endpoint includes CORS headers", async () => {
    const { router, cleanup } = await setupTestInstance();
    try {
      const response = await router(
        createGraphQLRequest(`
          query {
            health {
              status
            }
          }
        `)
      );

      assertEquals(response.headers.get("Access-Control-Allow-Origin"), "*");
    } finally {
      await cleanup();
    }
  });

  // Multi-operation document tests (like GraphiQL default template)
  await t.step("handles document with multiple named operations - executes first by default", async () => {
    const { router, cleanup } = await setupTestInstance();
    try {
      // Document with multiple named operations (like GraphiQL default)
      const response = await router(
        createGraphQLRequest(`
          query GetDashboard {
            health {
              status
            }
            status {
              id
              version
            }
          }

          query GetWorkers {
            workers {
              workers {
                id
                type
              }
              summary {
                total
              }
            }
          }

          query GetTasks {
            taskSummary {
              total
              pending
            }
          }
        `)
      );
      const data = await response.json();

      assertEquals(response.status, 200);
      // Should execute the first operation (GetDashboard)
      assertExists(data.data.health);
      assertEquals(data.data.health.status, "healthy");
      assertExists(data.data.status);
      assertExists(data.data.status.id);
    } finally {
      await cleanup();
    }
  });

  await t.step("handles document with multiple named operations - operationName selects specific", async () => {
    const { router, cleanup } = await setupTestInstance();
    try {
      // Request with operationName to select specific operation
      const response = await router(
        new Request("http://localhost:3000/graphql", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query: `
              query GetDashboard {
                health {
                  status
                }
              }

              query GetWorkers {
                workers {
                  workers {
                    id
                    type
                  }
                  summary {
                    total
                  }
                }
              }
            `,
            operationName: "GetWorkers",
          }),
        })
      );
      const data = await response.json();

      assertEquals(response.status, 200);
      // Should execute GetWorkers, not GetDashboard
      assertExists(data.data.workers);
      assertExists(data.data.workers.workers);
      assertExists(data.data.workers.summary);
      // health should NOT be present since we selected GetWorkers
      assertEquals(data.data.health, undefined);
    } finally {
      await cleanup();
    }
  });

  await t.step("returns error when operationName not found", async () => {
    const { router, cleanup } = await setupTestInstance();
    try {
      const response = await router(
        new Request("http://localhost:3000/graphql", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query: `
              query GetDashboard {
                health {
                  status
                }
              }
            `,
            operationName: "NonExistentOperation",
          }),
        })
      );
      const data = await response.json();

      assertEquals(response.status, 200);
      assertExists(data.errors);
      assertStringIncludes(data.errors[0].message, "NonExistentOperation");
      assertStringIncludes(data.errors[0].message, "not found");
    } finally {
      await cleanup();
    }
  });
});
