import { assertEquals, assertExists, assertStringIncludes } from "jsr:@std/assert";
import { DuckDBInstance } from "npm:@duckdb/node-api";
import { Instance, DB_SCHEMA } from "~/core/instance.ts";
import { createRouter } from "~/api/router.ts";

async function setupTestInstance(): Promise<{
  instance: Instance;
  router: (req: Request) => Promise<Response>;
  cleanup: () => Promise<void>;
}> {
  // Create a temp database
  const tempDir = await Deno.makeTempDir({ prefix: "router_test_" });
  const dbPath = `${tempDir}/test.db`;

  const instance = await Instance.create({
    port: 0, // Will be assigned
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

function createRequest(
  method: string,
  path: string,
  body?: unknown
): Request {
  const url = `http://localhost:3000${path}`;
  const options: RequestInit = { method };

  if (body) {
    options.headers = { "Content-Type": "application/json" };
    options.body = JSON.stringify(body);
  }

  return new Request(url, options);
}

Deno.test({ name: "API Router", sanitizeOps: false, sanitizeResources: false }, async (t) => {
  // Health endpoint tests
  await t.step("GET /api/health returns healthy status", async () => {
    const { router, cleanup } = await setupTestInstance();
    try {
      const response = await router(createRequest("GET", "/api/health"));
      const data = await response.json();

      assertEquals(response.status, 200);
      assertEquals(data.status, "healthy");
    } finally {
      await cleanup();
    }
  });

  // Status endpoint tests
  await t.step("GET /api/status returns instance status", async () => {
    const { instance, router, cleanup } = await setupTestInstance();
    try {
      const response = await router(createRequest("GET", "/api/status"));
      const data = await response.json();

      assertEquals(response.status, 200);
      assertEquals(data.id, instance.id);
      assertExists(data.version);
      assertExists(data.wsUrl);
      assertExists(data.uptime);
      assertExists(data.startTime);
    } finally {
      await cleanup();
    }
  });

  // Metrics endpoint tests
  await t.step("GET /api/metrics returns metrics", async () => {
    const { router, cleanup } = await setupTestInstance();
    try {
      const response = await router(createRequest("GET", "/api/metrics"));
      const data = await response.json();

      assertEquals(response.status, 200);
      assertExists(data.instance);
      assertExists(data.workers);
      assertExists(data.tasks);
      assertExists(data.resources);
      assertExists(data.queue);
    } finally {
      await cleanup();
    }
  });

  // Workers endpoint tests
  await t.step("GET /api/workers returns worker list", async () => {
    const { router, cleanup } = await setupTestInstance();
    try {
      const response = await router(createRequest("GET", "/api/workers"));
      const data = await response.json();

      assertEquals(response.status, 200);
      assertExists(data.workers);
      assertExists(data.summary);
      assertEquals(Array.isArray(data.workers), true);
      assertEquals(data.summary.total, 2); // We created 2 workers
    } finally {
      await cleanup();
    }
  });

  await t.step("GET /api/workers/:id returns 404 for non-existent worker", async () => {
    const { router, cleanup } = await setupTestInstance();
    try {
      const response = await router(createRequest("GET", "/api/workers/non-existent-id"));
      const data = await response.json();

      assertEquals(response.status, 404);
      assertExists(data.error);
    } finally {
      await cleanup();
    }
  });

  await t.step("POST /api/workers/remote requires wsUrl", async () => {
    const { router, cleanup } = await setupTestInstance();
    try {
      const response = await router(createRequest("POST", "/api/workers/remote", {}));
      const data = await response.json();

      assertEquals(response.status, 400);
      assertEquals(data.success, false);
      assertStringIncludes(data.error, "wsUrl");
    } finally {
      await cleanup();
    }
  });

  await t.step("POST /api/workers/remote validates URL format", async () => {
    const { router, cleanup } = await setupTestInstance();
    try {
      const response = await router(
        createRequest("POST", "/api/workers/remote", { wsUrl: "not-a-valid-url" })
      );
      const data = await response.json();

      assertEquals(response.status, 400);
      assertEquals(data.success, false);
    } finally {
      await cleanup();
    }
  });

  // Peers endpoint tests
  await t.step("GET /api/peers returns empty list initially", async () => {
    const { router, cleanup } = await setupTestInstance();
    try {
      const response = await router(createRequest("GET", "/api/peers"));
      const data = await response.json();

      assertEquals(response.status, 200);
      assertEquals(data.peers, []);
    } finally {
      await cleanup();
    }
  });

  await t.step("POST /api/peers requires wsUrl", async () => {
    const { router, cleanup } = await setupTestInstance();
    try {
      const response = await router(createRequest("POST", "/api/peers", {}));
      const data = await response.json();

      assertEquals(response.status, 400);
      assertEquals(data.success, false);
    } finally {
      await cleanup();
    }
  });

  await t.step("POST /api/peers accepts valid WebSocket URLs", async () => {
    const { router, cleanup } = await setupTestInstance();
    try {
      // Test ws:// URL without path - connection will fail but URL validation should pass
      const response1 = await router(createRequest("POST", "/api/peers", { wsUrl: "ws://10.0.0.31:8000" }));
      const data1 = await response1.json();

      // Connection will fail (no server), but should NOT fail with "Invalid wsUrl format"
      if (!data1.success) {
        assertEquals(data1.error.includes("Invalid wsUrl format"), false,
          `Expected validation to pass, but got error: ${data1.error}`);
      }

      // Test ws:// URL with path
      const response2 = await router(createRequest("POST", "/api/peers", { wsUrl: "ws://10.0.0.31:8000/ws" }));
      const data2 = await response2.json();

      if (!data2.success) {
        assertEquals(data2.error.includes("Invalid wsUrl format"), false,
          `Expected validation to pass, but got error: ${data2.error}`);
      }

      // Test wss:// URL
      const response3 = await router(createRequest("POST", "/api/peers", { wsUrl: "wss://example.com:8080" }));
      const data3 = await response3.json();

      if (!data3.success) {
        assertEquals(data3.error.includes("Invalid wsUrl format"), false,
          `Expected validation to pass, but got error: ${data3.error}`);
      }
    } finally {
      await cleanup();
    }
  });

  await t.step("DELETE /api/peers/:id returns 404 for non-existent peer", async () => {
    const { router, cleanup } = await setupTestInstance();
    try {
      const response = await router(createRequest("DELETE", "/api/peers/non-existent"));
      const data = await response.json();

      assertEquals(response.status, 404);
      assertEquals(data.success, false);
    } finally {
      await cleanup();
    }
  });

  // Tasks endpoint tests
  await t.step("GET /api/tasks returns empty list initially", async () => {
    const { router, cleanup } = await setupTestInstance();
    try {
      const response = await router(createRequest("GET", "/api/tasks"));
      const data = await response.json();

      assertEquals(response.status, 200);
      assertEquals(data.tasks, []);
      assertExists(data.summary);
      assertEquals(data.summary.total, 0);
    } finally {
      await cleanup();
    }
  });

  await t.step("GET /api/tasks supports status filter", async () => {
    const { router, cleanup } = await setupTestInstance();
    try {
      const response = await router(
        createRequest("GET", "/api/tasks?status=pending,running")
      );
      const data = await response.json();

      assertEquals(response.status, 200);
      assertExists(data.tasks);
    } finally {
      await cleanup();
    }
  });

  await t.step("GET /api/tasks supports limit and offset", async () => {
    const { router, cleanup } = await setupTestInstance();
    try {
      const response = await router(
        createRequest("GET", "/api/tasks?limit=10&offset=0")
      );
      const data = await response.json();

      assertEquals(response.status, 200);
      assertExists(data.tasks);
    } finally {
      await cleanup();
    }
  });

  await t.step("GET /api/tasks/:id returns 404 for non-existent task", async () => {
    const { router, cleanup } = await setupTestInstance();
    try {
      const response = await router(createRequest("GET", "/api/tasks/non-existent-id"));
      const data = await response.json();

      assertEquals(response.status, 404);
      assertExists(data.error);
    } finally {
      await cleanup();
    }
  });

  await t.step("GET /api/tasks/active returns active tasks", async () => {
    const { router, cleanup } = await setupTestInstance();
    try {
      const response = await router(createRequest("GET", "/api/tasks/active"));
      const data = await response.json();

      assertEquals(response.status, 200);
      assertExists(data.tasks);
      assertExists(data.summary);
    } finally {
      await cleanup();
    }
  });

  await t.step("GET /api/tasks/summary returns summary", async () => {
    const { router, cleanup } = await setupTestInstance();
    try {
      const response = await router(createRequest("GET", "/api/tasks/summary"));
      const data = await response.json();

      assertEquals(response.status, 200);
      assertEquals(typeof data.total, "number");
      assertEquals(typeof data.pending, "number");
      assertEquals(typeof data.running, "number");
      assertEquals(typeof data.completed, "number");
      assertEquals(typeof data.failed, "number");
    } finally {
      await cleanup();
    }
  });

  // Ingests endpoint tests
  await t.step("GET /api/ingests returns empty list initially", async () => {
    const { router, cleanup } = await setupTestInstance();
    try {
      const response = await router(createRequest("GET", "/api/ingests"));
      const data = await response.json();

      assertEquals(response.status, 200);
      assertEquals(data.ingests, []);
      assertEquals(data.active, 0);
      assertEquals(data.total, 0);
    } finally {
      await cleanup();
    }
  });

  await t.step("POST /api/ingests requires root path", async () => {
    const { router, cleanup } = await setupTestInstance();
    try {
      const response = await router(createRequest("POST", "/api/ingests", {}));
      const data = await response.json();

      assertEquals(response.status, 400);
      assertEquals(data.success, false);
      assertStringIncludes(data.error, "root");
    } finally {
      await cleanup();
    }
  });

  await t.step("POST /api/ingests validates root path exists", async () => {
    const { router, cleanup } = await setupTestInstance();
    try {
      const response = await router(
        createRequest("POST", "/api/ingests", { root: "/non/existent/path" })
      );
      const data = await response.json();

      assertEquals(response.status, 400);
      assertEquals(data.success, false);
    } finally {
      await cleanup();
    }
  });

  await t.step("POST /api/ingests starts ingest job for valid directory", async () => {
    const { router, cleanup } = await setupTestInstance();
    const tempDir = await Deno.makeTempDir({ prefix: "ingest_api_test_" });
    await Deno.writeTextFile(`${tempDir}/test.txt`, "test content");

    try {
      const response = await router(
        createRequest("POST", "/api/ingests", { root: tempDir })
      );
      const data = await response.json();

      assertEquals(response.status, 201);
      assertEquals(data.success, true);
      assertExists(data.ingest);
      assertExists(data.ingest.id);
    } finally {
      await Deno.remove(tempDir, { recursive: true });
      await cleanup();
    }
  });

  await t.step("GET /api/ingests/:id returns 404 for non-existent ingest", async () => {
    const { router, cleanup } = await setupTestInstance();
    try {
      const response = await router(createRequest("GET", "/api/ingests/non-existent-id"));
      const data = await response.json();

      assertEquals(response.status, 404);
      assertExists(data.error);
    } finally {
      await cleanup();
    }
  });

  await t.step("DELETE /api/ingests/:id returns 404 for non-existent ingest", async () => {
    const { router, cleanup } = await setupTestInstance();
    try {
      const response = await router(createRequest("DELETE", "/api/ingests/non-existent-id"));
      const data = await response.json();

      assertEquals(response.status, 404);
      assertEquals(data.success, false);
    } finally {
      await cleanup();
    }
  });

  await t.step("GET /api/ingests/active returns active ingests", async () => {
    const { router, cleanup } = await setupTestInstance();
    try {
      const response = await router(createRequest("GET", "/api/ingests/active"));
      const data = await response.json();

      assertEquals(response.status, 200);
      assertExists(data.ingests);
      assertEquals(typeof data.count, "number");
    } finally {
      await cleanup();
    }
  });

  // OpenAPI endpoint tests
  await t.step("GET /api/openapi.json returns OpenAPI spec", async () => {
    const { router, cleanup } = await setupTestInstance();
    try {
      const response = await router(createRequest("GET", "/api/openapi.json"));
      const data = await response.json();

      assertEquals(response.status, 200);
      assertEquals(data.openapi, "3.0.3");
      assertExists(data.info);
      assertExists(data.paths);
      assertExists(data.components);
    } finally {
      await cleanup();
    }
  });

  // 404 tests
  await t.step("returns 404 for unknown routes", async () => {
    const { router, cleanup } = await setupTestInstance();
    try {
      const response = await router(createRequest("GET", "/api/unknown"));
      const data = await response.json();

      assertEquals(response.status, 404);
      assertEquals(data.error, "Not found");
    } finally {
      await cleanup();
    }
  });

  // CORS tests
  await t.step("OPTIONS request returns CORS headers", async () => {
    const { router, cleanup } = await setupTestInstance();
    try {
      const response = await router(createRequest("OPTIONS", "/api/health"));

      assertEquals(response.status, 204);
      assertEquals(response.headers.get("Access-Control-Allow-Origin"), "*");
      assertExists(response.headers.get("Access-Control-Allow-Methods"));
      assertExists(response.headers.get("Access-Control-Allow-Headers"));
    } finally {
      await cleanup();
    }
  });

  await t.step("responses include CORS headers", async () => {
    const { router, cleanup } = await setupTestInstance();
    try {
      const response = await router(createRequest("GET", "/api/health"));

      assertEquals(response.headers.get("Access-Control-Allow-Origin"), "*");
    } finally {
      await cleanup();
    }
  });
});
