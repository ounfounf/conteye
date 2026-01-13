import { parseArgs } from "@std/cli/parse-args";
import { Instance, type InstanceConfig } from "~/core/instance.ts";
import { createRouter } from "~/api/router.ts";
import { setupLogging, getAppLogger } from "~/logger.ts";

const logger = getAppLogger("server");

interface ServerArgs {
  port: number;
  hostname: string;
  db?: string;
  noDb: boolean;
  workers?: number;
  help: boolean;
}

function printUsage(): void {
  console.log(`
ConTeye Server - Content analysis API with distributed worker support

USAGE:
  deno run --allow-net --allow-read --allow-write --allow-ffi src/server.ts [OPTIONS]

OPTIONS:
  --port <port>       Port to listen on (default: 8000)
  --hostname <host>   Hostname to bind to (default: 0.0.0.0)
  --db <path>         Path to DuckDB database file
  --no-db             Run as pure worker without database (disables ingest functionality)
  --workers <count>   Number of worker threads (default: CPU cores - 1)
  --help              Show this help message

EXAMPLES:
  # Start server on default port with database
  deno run --allow-net --allow-read --allow-write --allow-ffi src/server.ts --db ./data.db

  # Start server on custom port
  deno run --allow-net --allow-read --allow-write --allow-ffi src/server.ts --port 8080 --db ./data.db

  # Start server as pure worker without database
  deno run --allow-net --allow-read --allow-write src/server.ts --no-db

  # Start server with custom worker count
  deno run --allow-net --allow-read --allow-write --allow-ffi src/server.ts --db ./data.db --workers 8

API ENDPOINTS:
  GET  /api/health              Health check
  GET  /api/status              Instance status and WebSocket URL
  GET  /api/metrics             Performance metrics

  GET  /api/workers             List all workers
  POST /api/workers/remote      Connect to remote worker pool
  DELETE /api/workers/:id       Disconnect a worker

  GET  /api/peers               List connected peer instances
  POST /api/peers               Connect to peer instance
  DELETE /api/peers/:id         Disconnect from peer

  GET  /api/tasks               List tasks
  GET  /api/tasks/:id           Get task details
  GET  /api/tasks/active        List active tasks
  GET  /api/tasks/summary       Task count summary

  GET  /api/ingests             List ingest jobs
  POST /api/ingests             Start new ingest job
  GET  /api/ingests/:id         Get ingest details
  DELETE /api/ingests/:id       Cancel ingest job

  GET  /api/openapi.json        OpenAPI specification

WEBSOCKET:
  /ws/workers                   Worker pool connection endpoint
                                Other instances can connect here to share workers
`);
}

function parseServerArgs(args: string[]): ServerArgs {
  const parsed = parseArgs(args, {
    string: ["port", "hostname", "db", "workers"],
    boolean: ["help", "no-db"],
    default: {
      port: "8000",
      hostname: "0.0.0.0",
      help: false,
      "no-db": false,
    },
  });

  return {
    port: parseInt(parsed.port as string, 10),
    hostname: parsed.hostname as string,
    db: parsed.db as string,
    noDb: parsed["no-db"] as boolean,
    workers: parsed.workers ? parseInt(parsed.workers as string, 10) : undefined,
    help: parsed.help as boolean,
  };
}

async function startServer(config: InstanceConfig): Promise<Instance> {
  logger.info`Starting ConTeye server on ${config.hostname}:${config.port}`;

  // Create instance
  const instance = await Instance.create(config);

  // Create router
  const router = createRouter(instance);

  // Start HTTP server
  const server = Deno.serve(
    {
      port: config.port,
      hostname: config.hostname,
      onListen: ({ hostname, port }) => {
        logger.info`Server listening on http://${hostname}:${port}`;
        logger.info`WebSocket endpoint: ws://${hostname}:${port}/ws/workers`;
        logger.info`OpenAPI spec: http://${hostname}:${port}/api/openapi.json`;
        console.log(`
╔══════════════════════════════════════════════════════════════════╗
║                      ConTeye Server Started                      ║
╠══════════════════════════════════════════════════════════════════╣
║  HTTP API:    http://${hostname}:${port.toString().padEnd(37)}║
║  WebSocket:   ws://${hostname}:${port.toString().padEnd(40)}║
║  OpenAPI:     http://${hostname}:${port}/api/openapi.json${" ".repeat(Math.max(0, 20 - port.toString().length))}║
╠══════════════════════════════════════════════════════════════════╣
║  Instance ID: ${instance.id.substring(0, 50).padEnd(50)}║
║  Workers:     ${instance.pool.getWorkerCount().total.toString().padEnd(50)}║
║  Database:    ${config.dbPath ? config.dbPath.substring(0, 50).padEnd(50) : "Disabled (pure worker mode)".padEnd(50)}║
╚══════════════════════════════════════════════════════════════════╝
`);
      },
    },
    router
  );

  instance.setHttpServer(server);

  return instance;
}

// Main entry point
if (import.meta.main) {
  await setupLogging();

  const args = parseServerArgs(Deno.args);

  if (args.help) {
    printUsage();
    Deno.exit(0);
  }

  if (args.noDb && args.db) {
    console.error("Error: Cannot specify both --db and --no-db");
    console.error("Run with --help for usage information");
    Deno.exit(1);
  }

  if (!args.noDb && !args.db) {
    console.error("Error: Must specify either --db <path> or --no-db");
    console.error("Run with --help for usage information");
    Deno.exit(1);
  }

  const config: InstanceConfig = {
    port: args.port,
    hostname: args.hostname,
    dbPath: args.db,
    workerCount: args.workers,
  };

  const instance = await startServer(config);

  // Handle shutdown
  const shutdown = async () => {
    logger.info`Shutting down server...`;
    await instance.close();
    Deno.exit(0);
  };

  Deno.addSignalListener("SIGINT", shutdown);
  if (Deno.build.os !== "windows") {
    Deno.addSignalListener("SIGTERM", shutdown);
  }

  // Keep process running
  await new Promise(() => {});
}

export { startServer, type ServerArgs };
