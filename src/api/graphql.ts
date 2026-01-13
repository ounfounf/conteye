import { graphql, buildSchema } from "graphql";
import type { Instance } from "~/core/instance.ts";
import type { TaskFilter } from "~/core/task_manager.ts";
import type { IngestOptions } from "~/core/ingest_manager.ts";
import type { ProcessorName } from "~/process/index.ts";
import { getAppLogger } from "~/logger.ts";

const logger = getAppLogger("graphql");

// GraphQL Schema Definition
export const typeDefs = `
  type Query {
    # Status
    health: HealthStatus!
    status: InstanceStatus!
    metrics: Metrics!

    # Workers
    workers: WorkersResponse!
    worker(id: ID!): WorkerInfo

    # Peers
    peers: PeersResponse!
    knownPeers: KnownPeersResponse!

    # Tasks
    tasks(status: [TaskStatus!], limit: Int, offset: Int): TasksResponse!
    task(id: ID!): Task
    activeTasks: ActiveTasksResponse!
    taskSummary: TaskSummary!

    # Ingests
    ingests: IngestsResponse!
    ingest(id: ID!): IngestJob
    activeIngests: ActiveIngestsResponse!
  }

  type Mutation {
    # Workers
    connectRemoteWorker(wsUrl: String!): ConnectWorkerResponse!
    disconnectWorker(id: ID!): DisconnectResponse!

    # Peers
    connectPeer(wsUrl: String!, save: Boolean, name: String): ConnectPeerResponse!
    disconnectPeer(id: ID!): DisconnectResponse!

    # Known Peers
    saveKnownPeer(wsUrl: String!, name: String, autoConnect: Boolean): SaveKnownPeerResponse!
    removeKnownPeer(wsUrl: String!): DisconnectResponse!
    connectToKnownPeers: ConnectToKnownPeersResponse!

    # Ingests
    startIngest(root: String!, processors: [String!]): StartIngestResponse!
    cancelIngest(id: ID!): CancelIngestResponse!
  }

  # Status types
  type HealthStatus {
    status: String!
  }

  type InstanceStatus {
    id: ID!
    version: String!
    wsUrl: String!
    uptime: Int!
    startTime: Float!
  }

  type Metrics {
    instance: InstanceMetrics!
    workers: WorkerMetrics!
    tasks: TaskMetrics!
    resources: ResourceMetrics!
    queue: QueueMetrics!
  }

  type InstanceMetrics {
    uptimeMs: Int!
    startTime: Float!
  }

  type WorkerMetrics {
    total: Int!
    local: Int!
    remote: Int!
    busy: Int!
    idle: Int!
  }

  type TaskMetrics {
    pending: Int!
    running: Int!
    completed: Int!
    failed: Int!
    avgDurationMs: Float!
    throughputPerSec: Float!
  }

  type ResourceMetrics {
    memoryUsedBytes: Int!
    heapUsedBytes: Int!
    heapTotalBytes: Int!
  }

  type QueueMetrics {
    depth: Int!
    avgWaitTimeMs: Float!
  }

  # Worker types
  enum WorkerType {
    local
    remote
  }

  type WorkerInfo {
    id: ID!
    type: WorkerType!
    busy: Boolean!
    host: String
  }

  type WorkerSummary {
    total: Int!
    local: Int!
    remote: Int!
    busy: Int!
    idle: Int!
  }

  type WorkersResponse {
    workers: [WorkerInfo!]!
    summary: WorkerSummary!
  }

  type ConnectWorkerResponse {
    success: Boolean!
    peerId: ID
    error: String
  }

  type DisconnectResponse {
    success: Boolean!
    error: String
  }

  # Peer types
  type PeerInfo {
    id: ID!
    wsUrl: String!
    connectedAt: Float!
  }

  type PeersResponse {
    peers: [PeerInfo!]!
  }

  type ConnectPeerResponse {
    success: Boolean!
    peer: PeerInfo
    saved: Boolean
    error: String
  }

  # Known Peer types
  type KnownPeer {
    wsUrl: String!
    name: String
    autoConnect: Boolean!
    createdAt: Float!
    lastConnectedAt: Float
  }

  type KnownPeersResponse {
    knownPeers: [KnownPeer!]!
  }

  type SaveKnownPeerResponse {
    success: Boolean!
    knownPeer: KnownPeer
    error: String
  }

  type ConnectToKnownPeersResponse {
    success: Boolean!
    connected: [String!]!
    failed: [FailedPeerConnection!]!
  }

  type FailedPeerConnection {
    wsUrl: String!
    error: String!
  }

  # Task types
  enum TaskStatus {
    pending
    running
    completed
    failed
  }

  type Task {
    id: ID!
    request: JSON
    status: TaskStatus!
    queuedAt: Float!
    startedAt: Float
    completedAt: Float
    workerId: ID
    result: JSON
    error: String
  }

  type TaskSummary {
    total: Int!
    pending: Int!
    running: Int!
    completed: Int!
    failed: Int!
  }

  type TasksResponse {
    tasks: [Task!]!
    summary: TaskSummary!
  }

  type ActiveTasksResponse {
    tasks: [Task!]!
    summary: ActiveTaskSummary!
  }

  type ActiveTaskSummary {
    pending: Int!
    running: Int!
  }

  # Ingest types
  enum IngestStatus {
    queued
    scanning
    processing
    completed
    cancelled
    failed
  }

  type IngestError {
    path: String!
    error: String!
    timestamp: Float!
  }

  type IngestJob {
    id: ID!
    root: String!
    status: IngestStatus!
    processors: [String!]!
    totalFiles: Int!
    processedFiles: Int!
    totalBytes: Float!
    processedBytes: Float!
    startedAt: Float
    completedAt: Float
    errors: [IngestError!]!
  }

  type IngestJobSummary {
    id: ID!
    root: String!
    status: IngestStatus!
    progress: Int!
    processedFiles: Int!
    totalFiles: Int!
  }

  type IngestsResponse {
    ingests: [IngestJobSummary!]!
    active: Int!
    total: Int!
  }

  type ActiveIngestsResponse {
    ingests: [IngestJobSummary!]!
    count: Int!
  }

  type StartIngestResponse {
    success: Boolean!
    ingest: IngestJob
    error: String
  }

  type CancelIngestResponse {
    success: Boolean!
    error: String
  }

  # Custom scalar for arbitrary JSON
  scalar JSON
`;

// Build schema once at module load
const schema = buildSchema(typeDefs);

interface GraphQLRequest {
  query: string;
  variables?: Record<string, unknown>;
  operationName?: string;
}

interface GraphQLResponse {
  data?: Record<string, unknown>;
  errors?: Array<{ message: string; path?: string[] }>;
}

// Root value factory for graphql-js (flat structure, args as first param)
function createRootValue(instance: Instance) {
  return {
    // Query: Status
    health: () => ({ status: "healthy" }),

    status: () => instance.getStatus(),

    metrics: () => {
      const workerMetrics = instance.pool.getWorkerCount();
      return instance.metrics.getMetrics({
        total: workerMetrics.total,
        local: workerMetrics.local,
        remote: workerMetrics.remote,
        busy: workerMetrics.busy,
        idle: workerMetrics.idle,
      });
    },

    // Query: Workers
    workers: () => {
      const workers = instance.pool.getWorkerInfo();
      const summary = instance.pool.getWorkerCount();
      return { workers, summary };
    },

    worker: ({ id }: { id: string }) => {
      const workers = instance.pool.getWorkerInfo();
      return workers.find(w => w.id === id) || null;
    },

    // Query: Peers
    peers: () => {
      const peers = instance.getPeers();
      return { peers };
    },

    // Query: Known Peers
    knownPeers: async () => {
      const knownPeers = await instance.getKnownPeers();
      return { knownPeers };
    },

    // Query: Tasks
    tasks: ({ status, limit, offset }: { status?: string[]; limit?: number; offset?: number }) => {
      const filter: TaskFilter = {};

      if (status) {
        filter.status = status as TaskFilter["status"];
      }
      if (limit) {
        filter.limit = Math.min(limit, 1000);
      }
      if (offset) {
        filter.offset = offset;
      }

      const tasks = instance.taskManager.getTasks(filter);
      const summary = instance.taskManager.getSummary();
      return { tasks, summary };
    },

    task: ({ id }: { id: string }) => {
      return instance.taskManager.getTask(id) || null;
    },

    activeTasks: () => {
      const tasks = instance.taskManager.getActiveTasks();
      const summary = instance.taskManager.getSummary();
      return {
        tasks,
        summary: {
          pending: summary.pending,
          running: summary.running,
        },
      };
    },

    taskSummary: () => instance.taskManager.getSummary(),

    // Query: Ingests
    ingests: () => {
      const jobs = instance.ingestManager!.getJobs();
      const activeJobs = instance.ingestManager!.getActiveJobs();

      const ingests = jobs.map(job => ({
        id: job.id,
        root: job.root,
        status: job.status,
        progress: job.totalFiles > 0
          ? Math.round((job.processedFiles / job.totalFiles) * 100)
          : 0,
        processedFiles: job.processedFiles,
        totalFiles: job.totalFiles,
      }));

      return {
        ingests,
        active: activeJobs.length,
        total: jobs.length,
      };
    },

    ingest: ({ id }: { id: string }) => {
      return instance.ingestManager!.getJob(id) || null;
    },

    activeIngests: () => {
      const activeJobs = instance.ingestManager!.getActiveJobs();

      const ingests = activeJobs.map(job => ({
        id: job.id,
        root: job.root,
        status: job.status,
        progress: job.totalFiles > 0
          ? Math.round((job.processedFiles / job.totalFiles) * 100)
          : 0,
        processedFiles: job.processedFiles,
        totalFiles: job.totalFiles,
      }));

      return {
        ingests,
        count: ingests.length,
      };
    },

    // Mutation: Workers
    connectRemoteWorker: async ({ wsUrl }: { wsUrl: string }) => {
      // Validate WebSocket URL format
      try {
        const url = new URL(wsUrl);
        if (url.protocol !== 'ws:' && url.protocol !== 'wss:') {
          return { success: false, error: "Invalid wsUrl format" };
        }
      } catch {
        return { success: false, error: "Invalid wsUrl format" };
      }

      try {
        const peer = await instance.connectToPeer(wsUrl);
        return { success: true, peerId: peer.id };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    },

    disconnectWorker: ({ id }: { id: string }) => {
      const success = instance.pool.disconnectWorker(id);
      if (!success) {
        return {
          success: false,
          error: "Worker not found or cannot be disconnected (local workers cannot be disconnected)",
        };
      }
      return { success: true };
    },

    // Mutation: Peers
    connectPeer: async ({ wsUrl, save, name }: { wsUrl: string; save?: boolean; name?: string }) => {
      // Validate WebSocket URL format
      try {
        const url = new URL(wsUrl);
        if (url.protocol !== 'ws:' && url.protocol !== 'wss:') {
          return { success: false, error: "Invalid wsUrl format" };
        }
      } catch {
        return { success: false, error: "Invalid wsUrl format" };
      }

      try {
        const peer = await instance.connectToPeer(wsUrl);

        // Optionally save to known peers
        if (save) {
          try {
            await instance.saveKnownPeer(wsUrl, name, true);
            await instance.updateKnownPeerLastConnected(wsUrl);
          } catch {
            // Ignore save errors - connection still succeeded
          }
        }

        return { success: true, peer, saved: save ?? false };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    },

    disconnectPeer: ({ id }: { id: string }) => {
      const success = instance.disconnectPeer(id);
      if (!success) {
        return { success: false, error: "Peer not found" };
      }
      return { success: true };
    },

    // Mutation: Known Peers
    saveKnownPeer: async ({ wsUrl, name, autoConnect }: { wsUrl: string; name?: string; autoConnect?: boolean }) => {
      // Validate WebSocket URL format
      try {
        const url = new URL(wsUrl);
        if (url.protocol !== 'ws:' && url.protocol !== 'wss:') {
          return { success: false, error: "Invalid wsUrl format - must use ws:// or wss://" };
        }
      } catch {
        return { success: false, error: "Invalid wsUrl format" };
      }

      try {
        const knownPeer = await instance.saveKnownPeer(wsUrl, name, autoConnect ?? true);
        return { success: true, knownPeer };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    },

    removeKnownPeer: async ({ wsUrl }: { wsUrl: string }) => {
      const success = await instance.removeKnownPeer(wsUrl);
      if (!success) {
        return { success: false, error: "Known peer not found" };
      }
      return { success: true };
    },

    connectToKnownPeers: async () => {
      const result = await instance.connectToKnownPeers();
      return {
        success: true,
        connected: result.connected,
        failed: result.failed,
      };
    },

    // Mutation: Ingests
    startIngest: async ({ root, processors }: { root: string; processors?: string[] }) => {
      if (!root) {
        return { success: false, error: "root path is required" };
      }

      try {
        const stat = await Deno.stat(root);
        if (!stat.isDirectory) {
          return { success: false, error: "root must be a directory" };
        }
      } catch {
        return { success: false, error: "root path does not exist or is not accessible" };
      }

      try {
        const options: IngestOptions = {};
        if (processors) {
          options.processors = processors as ProcessorName[];
        }

        const job = await instance.ingestManager!.start(root, options);
        return { success: true, ingest: job };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    },

    cancelIngest: ({ id }: { id: string }) => {
      const success = instance.ingestManager!.cancel(id);
      if (!success) {
        return { success: false, error: "Ingest job not found or already completed" };
      }
      return { success: true };
    },
  };
}

// Execute GraphQL query using graphql-js
async function executeGraphQL(
  instance: Instance,
  request: GraphQLRequest
): Promise<GraphQLResponse> {
  const rootValue = createRootValue(instance);
  const { query, variables = {}, operationName } = request;

  try {
    const result = await graphql({
      schema,
      source: query,
      rootValue,
      variableValues: variables,
      operationName,
    });

    return {
      data: result.data as Record<string, unknown> | undefined,
      errors: result.errors?.map((e: { message: string; path?: readonly (string | number)[] }) => ({
        message: e.message,
        path: e.path as string[] | undefined,
      })),
    };
  } catch (error) {
    logger.error`GraphQL execution error: ${error}`;
    return {
      errors: [{ message: error instanceof Error ? error.message : "Unknown error" }],
    };
  }
}

// HTTP handler for GraphQL endpoint
export async function handleGraphQL(
  instance: Instance,
  request: Request
): Promise<Response> {
  if (request.method === "GET") {
    // Return GraphiQL interface
    return new Response(getGraphiQLHTML(), {
      headers: { "Content-Type": "text/html" },
    });
  }

  if (request.method !== "POST") {
    return Response.json(
      { errors: [{ message: "Method not allowed. Use POST for queries." }] },
      { status: 405 }
    );
  }

  try {
    const body = await request.json() as GraphQLRequest;

    if (!body.query) {
      return Response.json(
        { errors: [{ message: "Query is required" }] },
        { status: 400 }
      );
    }

    const result = await executeGraphQL(instance, body);
    return Response.json(result);
  } catch (error) {
    logger.error`GraphQL request error: ${error}`;
    return Response.json(
      { errors: [{ message: "Invalid request body" }] },
      { status: 400 }
    );
  }
}

// Return GraphQL schema for introspection
export function handleGraphQLSchema(): Response {
  return new Response(typeDefs, {
    headers: { "Content-Type": "text/plain" },
  });
}

// GraphiQL HTML interface
function getGraphiQLHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ConTeye GraphQL</title>
  <style>
    body {
      height: 100%;
      margin: 0;
      width: 100%;
      overflow: hidden;
    }
    #graphiql {
      height: 100vh;
    }
  </style>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/react/18.2.0/umd/react.production.min.js" crossorigin="anonymous"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.2.0/umd/react-dom.production.min.js" crossorigin="anonymous"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/graphiql/3.0.10/graphiql.min.js" crossorigin="anonymous"></script>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/graphiql/3.0.10/graphiql.min.css" crossorigin="anonymous" />
</head>
<body>
  <div id="graphiql"></div>
  <script>
    const root = ReactDOM.createRoot(document.getElementById('graphiql'));

    function graphQLFetcher(graphQLParams) {
      return fetch(window.location.href, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(graphQLParams),
      }).then(response => response.json());
    }

    root.render(
      React.createElement(GraphiQL, {
        fetcher: graphQLFetcher,
        defaultEditorToolsVisibility: true,
        defaultQuery: \`# ConTeye GraphQL API
#
# Try these example queries:

query GetDashboard {
  health {
    status
  }
  status {
    id
    version
    uptime
  }
  metrics {
    workers {
      total
      busy
      idle
    }
    tasks {
      pending
      running
      completed
      failed
    }
  }
  taskSummary {
    total
    pending
    running
    completed
    failed
  }
}

# List workers
query GetWorkers {
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
    }
  }
}

# List tasks with filtering
query GetTasks {
  tasks(status: [pending, running], limit: 10) {
    tasks {
      id
      status
      queuedAt
      workerId
    }
    summary {
      total
      pending
      running
    }
  }
}

# List ingests
query GetIngests {
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

# Start an ingest (mutation)
# mutation StartIngest {
#   startIngest(root: "/path/to/dir", processors: ["xxhash3"]) {
#     success
#     ingest {
#       id
#       status
#     }
#     error
#   }
# }
\`,
      })
    );
  </script>
</body>
</html>`;
}
