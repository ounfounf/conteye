import type { Instance } from "~/core/instance.ts";
import { getAppLogger } from "~/logger.ts";

// Import handlers
import {
  handleGetStatus,
  handleGetMetrics,
  handleGetHealth,
} from "./handlers/status.ts";

import {
  handleGetWorkers,
  handleGetWorker,
  handleConnectRemoteWorker,
  handleDisconnectWorker,
  handleGetPeers,
  handleConnectPeer,
  handleDisconnectPeer,
} from "./handlers/workers.ts";

import {
  handleGetTasks,
  handleGetTask,
  handleGetActiveTasks,
  handleGetTaskSummary,
} from "./handlers/tasks.ts";

import {
  handleGetIngests,
  handleGetIngest,
  handleStartIngest,
  handleCancelIngest,
  handleGetActiveIngests,
} from "./handlers/ingests.ts";

import { generateOpenApiSpec } from "./openapi.ts";

const logger = getAppLogger("router");

type RouteHandler = (
  instance: Instance,
  request: Request,
  params: Record<string, string>,
  url: URL
) => Response | Promise<Response>;

interface Route {
  method: string;
  pattern: RegExp;
  paramNames: string[];
  handler: RouteHandler;
}

function createRoute(
  method: string,
  path: string,
  handler: RouteHandler
): Route {
  // Convert path pattern to regex
  // e.g., "/api/tasks/:id" -> /^\/api\/tasks\/([^\/]+)$/
  const paramNames: string[] = [];
  const regexPattern = path
    .replace(/:([^/]+)/g, (_, paramName) => {
      paramNames.push(paramName);
      return "([^/]+)";
    })
    .replace(/\//g, "\\/");

  return {
    method,
    pattern: new RegExp(`^${regexPattern}$`),
    paramNames,
    handler,
  };
}

// Define all routes
const routes: Route[] = [
  // Health and status
  createRoute("GET", "/api/health", (instance) => handleGetHealth(instance)),
  createRoute("GET", "/api/status", (instance) => handleGetStatus(instance)),
  createRoute("GET", "/api/metrics", (instance) => handleGetMetrics(instance)),

  // Workers
  createRoute("GET", "/api/workers", (instance) => handleGetWorkers(instance)),
  createRoute("GET", "/api/workers/:id", (instance, _req, params) =>
    handleGetWorker(instance, params.id)
  ),
  createRoute("POST", "/api/workers/remote", (instance, req) =>
    handleConnectRemoteWorker(instance, req)
  ),
  createRoute("DELETE", "/api/workers/:id", (instance, _req, params) =>
    handleDisconnectWorker(instance, params.id)
  ),

  // Peers
  createRoute("GET", "/api/peers", (instance) => handleGetPeers(instance)),
  createRoute("POST", "/api/peers", (instance, req) =>
    handleConnectPeer(instance, req)
  ),
  createRoute("DELETE", "/api/peers/:id", (instance, _req, params) =>
    handleDisconnectPeer(instance, params.id)
  ),

  // Tasks
  createRoute("GET", "/api/tasks", (instance, _req, _params, url) =>
    handleGetTasks(instance, url)
  ),
  createRoute("GET", "/api/tasks/active", (instance) =>
    handleGetActiveTasks(instance)
  ),
  createRoute("GET", "/api/tasks/summary", (instance) =>
    handleGetTaskSummary(instance)
  ),
  createRoute("GET", "/api/tasks/:id", (instance, _req, params) =>
    handleGetTask(instance, params.id)
  ),

  // Ingests
  createRoute("GET", "/api/ingests", (instance) => handleGetIngests(instance)),
  createRoute("GET", "/api/ingests/active", (instance) =>
    handleGetActiveIngests(instance)
  ),
  createRoute("POST", "/api/ingests", (instance, req) =>
    handleStartIngest(instance, req)
  ),
  createRoute("GET", "/api/ingests/:id", (instance, _req, params) =>
    handleGetIngest(instance, params.id)
  ),
  createRoute("DELETE", "/api/ingests/:id", (instance, _req, params) =>
    handleCancelIngest(instance, params.id)
  ),

  // OpenAPI spec
  createRoute("GET", "/api/openapi.json", (instance) => {
    const spec = generateOpenApiSpec(instance);
    return Response.json(spec);
  }),
];

function addCorsHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function createRouter(instance: Instance) {
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const method = request.method;
    const path = url.pathname;

    logger.debug`Router: ${method} ${path}`;

    // Handle CORS preflight
    if (method === "OPTIONS") {
      return addCorsHeaders(new Response(null, { status: 204 }));
    }

    // Handle WebSocket upgrade for worker connections
    if (path === "/ws/workers" && request.headers.get("upgrade") === "websocket") {
      return handleWebSocketUpgrade(instance, request);
    }

    // Find matching route
    for (const route of routes) {
      if (route.method !== method) continue;

      const match = path.match(route.pattern);
      if (!match) continue;

      // Extract params
      const params: Record<string, string> = {};
      route.paramNames.forEach((name, index) => {
        params[name] = match[index + 1];
      });

      try {
        const response = await route.handler(instance, request, params, url);
        return addCorsHeaders(response);
      } catch (error) {
        logger.error`Router error: ${error}`;
        return addCorsHeaders(
          Response.json(
            { error: error instanceof Error ? error.message : "Internal server error" },
            { status: 500 }
          )
        );
      }
    }

    // No route matched
    return addCorsHeaders(
      Response.json({ error: "Not found" }, { status: 404 })
    );
  };
}

function handleWebSocketUpgrade(instance: Instance, request: Request): Response {
  logger.debug`WebSocket upgrade request`;

  try {
    const { socket, response } = Deno.upgradeWebSocket(request);

    // Create a new WorkerPool for this connection that uses the instance's pool
    socket.onopen = () => {
      logger.debug`WebSocket client connected`;
    };

    socket.onmessage = async (event: MessageEvent<string>) => {
      try {
        const rawRequest = JSON.parse(event.data);
        const clientUuid = rawRequest.clientUuid || crypto.randomUUID();
        const { clientUuid: _, ...workRequest } = rawRequest;

        // Send acknowledgement
        socket.send(JSON.stringify({
          uuid: clientUuid,
          busy: false,
          alive: true,
        }));

        // Execute on the instance's pool
        try {
          const result = await instance.pool.execute(workRequest);
          socket.send(JSON.stringify({
            uuid: clientUuid,
            busy: false,
            result,
          }));
        } catch (error) {
          socket.send(JSON.stringify({
            uuid: clientUuid,
            busy: false,
            error: error instanceof Error ? error.message : "Unknown error",
          }));
        }
      } catch (error) {
        logger.error`WebSocket message error: ${error}`;
      }
    };

    socket.onclose = () => {
      logger.debug`WebSocket client disconnected`;
    };

    socket.onerror = (event) => {
      logger.error`WebSocket error: ${event}`;
    };

    return response;
  } catch (error) {
    logger.error`WebSocket upgrade failed: ${error}`;
    return Response.json({ error: "WebSocket upgrade failed" }, { status: 500 });
  }
}
