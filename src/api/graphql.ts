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
    connectPeer(wsUrl: String!): ConnectPeerResponse!
    disconnectPeer(id: ID!): DisconnectResponse!

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
    error: String
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

// Simple GraphQL parser and executor
interface GraphQLRequest {
  query: string;
  variables?: Record<string, unknown>;
  operationName?: string;
}

interface GraphQLResponse {
  data?: Record<string, unknown>;
  errors?: Array<{ message: string; path?: string[] }>;
}

// Resolvers
function createResolvers(instance: Instance) {
  return {
    Query: {
      // Status
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

      // Workers
      workers: () => {
        const workers = instance.pool.getWorkerInfo();
        const summary = instance.pool.getWorkerCount();
        return { workers, summary };
      },

      worker: (_: unknown, args: { id: string }) => {
        const workers = instance.pool.getWorkerInfo();
        return workers.find(w => w.id === args.id) || null;
      },

      // Peers
      peers: () => {
        const peers = instance.getPeers();
        return { peers };
      },

      // Tasks
      tasks: (_: unknown, args: { status?: string[]; limit?: number; offset?: number }) => {
        const filter: TaskFilter = {};

        if (args.status) {
          filter.status = args.status as TaskFilter["status"];
        }
        if (args.limit) {
          filter.limit = Math.min(args.limit, 1000);
        }
        if (args.offset) {
          filter.offset = args.offset;
        }

        const tasks = instance.taskManager.getTasks(filter);
        const summary = instance.taskManager.getSummary();
        return { tasks, summary };
      },

      task: (_: unknown, args: { id: string }) => {
        return instance.taskManager.getTask(args.id) || null;
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

      // Ingests
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

      ingest: (_: unknown, args: { id: string }) => {
        return instance.ingestManager!.getJob(args.id) || null;
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
    },

    Mutation: {
      // Workers
      connectRemoteWorker: async (_: unknown, args: { wsUrl: string }) => {
        try {
          new URL(args.wsUrl);
        } catch {
          return { success: false, error: "Invalid wsUrl format" };
        }

        try {
          const peer = await instance.connectToPeer(args.wsUrl);
          return { success: true, peerId: peer.id };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
          };
        }
      },

      disconnectWorker: (_: unknown, args: { id: string }) => {
        const success = instance.pool.disconnectWorker(args.id);
        if (!success) {
          return {
            success: false,
            error: "Worker not found or cannot be disconnected (local workers cannot be disconnected)",
          };
        }
        return { success: true };
      },

      // Peers
      connectPeer: async (_: unknown, args: { wsUrl: string }) => {
        try {
          new URL(args.wsUrl);
        } catch {
          return { success: false, error: "Invalid wsUrl format" };
        }

        try {
          const peer = await instance.connectToPeer(args.wsUrl);
          return { success: true, peer };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
          };
        }
      },

      disconnectPeer: (_: unknown, args: { id: string }) => {
        const success = instance.disconnectPeer(args.id);
        if (!success) {
          return { success: false, error: "Peer not found" };
        }
        return { success: true };
      },

      // Ingests
      startIngest: async (_: unknown, args: { root: string; processors?: string[] }) => {
        if (!args.root) {
          return { success: false, error: "root path is required" };
        }

        try {
          const stat = await Deno.stat(args.root);
          if (!stat.isDirectory) {
            return { success: false, error: "root must be a directory" };
          }
        } catch {
          return { success: false, error: "root path does not exist or is not accessible" };
        }

        try {
          const options: IngestOptions = {};
          if (args.processors) {
            options.processors = args.processors as ProcessorName[];
          }

          const job = await instance.ingestManager!.start(args.root, options);
          return { success: true, ingest: job };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
          };
        }
      },

      cancelIngest: (_: unknown, args: { id: string }) => {
        const success = instance.ingestManager!.cancel(args.id);
        if (!success) {
          return { success: false, error: "Ingest job not found or already completed" };
        }
        return { success: true };
      },
    },
  };
}

// Simple GraphQL executor (no external dependencies)
async function executeGraphQL(
  instance: Instance,
  request: GraphQLRequest
): Promise<GraphQLResponse> {
  const resolvers = createResolvers(instance);
  const { query, variables = {}, operationName } = request;

  try {
    // Extract the specific operation from the document
    const operation = extractOperation(query, operationName);
    if (!operation) {
      return {
        errors: [{ message: operationName
          ? `Operation "${operationName}" not found`
          : "No valid operation found in query" }],
      };
    }

    const result = await executeOperation(resolvers, operation.type, operation.body, variables);
    return { data: result };
  } catch (error) {
    logger.error`GraphQL execution error: ${error}`;
    return {
      errors: [{ message: error instanceof Error ? error.message : "Unknown error" }],
    };
  }
}

// Extract a specific operation from a GraphQL document
interface Operation {
  type: "Query" | "Mutation";
  name?: string;
  body: string;
}

function extractOperation(query: string, operationName?: string): Operation | null {
  // Find all operations in the document
  const operations: Operation[] = [];

  // Match operation definitions: (query|mutation) [Name] [(...)] { ... }
  // We need to find each operation and extract its body with proper brace matching
  const opRegex = /(query|mutation)\s*(\w+)?\s*(?:\([^)]*\))?\s*\{/gi;
  let match;

  while ((match = opRegex.exec(query)) !== null) {
    const opType = match[1].toLowerCase() === "mutation" ? "Mutation" : "Query";
    const opName = match[2];
    const startBrace = match.index + match[0].length - 1; // Position of opening {

    // Find the matching closing brace
    let depth = 1;
    let endBrace = startBrace + 1;

    for (let i = startBrace + 1; i < query.length && depth > 0; i++) {
      if (query[i] === "{") depth++;
      else if (query[i] === "}") depth--;
      if (depth === 0) {
        endBrace = i;
        break;
      }
    }

    // Extract the operation body (content between braces)
    const body = query.slice(startBrace, endBrace + 1);
    operations.push({ type: opType, name: opName, body });
  }

  // If no operations found, try parsing as anonymous query
  if (operations.length === 0) {
    // Check if it's just a selection set without operation type
    const trimmed = query.trim();
    if (trimmed.startsWith("{")) {
      return { type: "Query", body: trimmed };
    }
    return null;
  }

  // If operationName is specified, find that operation
  if (operationName) {
    const found = operations.find(op => op.name === operationName);
    return found || null;
  }

  // Otherwise return the first operation
  return operations[0];
}

// Simple query parser and executor
async function executeOperation(
  resolvers: ReturnType<typeof createResolvers>,
  operationType: "Query" | "Mutation",
  query: string,
  variables: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const result: Record<string, unknown> = {};

  // Extract field calls from query
  const fieldCalls = parseFieldCalls(query, operationType.toLowerCase());

  for (const fieldCall of fieldCalls) {
    const { name, args, alias } = fieldCall;
    const resolverGroup = operationType === "Query" ? resolvers.Query : resolvers.Mutation;
    const resolver = resolverGroup[name as keyof typeof resolverGroup];

    if (!resolver) {
      throw new Error(`Unknown field: ${name}`);
    }

    // Resolve arguments with variables
    const resolvedArgs = resolveArguments(args, variables);

    // Execute resolver
    // deno-lint-ignore no-explicit-any
    const fieldResult = await (resolver as any)(null, resolvedArgs);
    result[alias || name] = fieldResult;
  }

  return result;
}

interface FieldCall {
  name: string;
  alias?: string;
  args: Record<string, unknown>;
}

function parseFieldCalls(operationBody: string, _operationType: string): FieldCall[] {
  const fieldCalls: FieldCall[] = [];

  // The operationBody is now just "{ ... }" - extract the content between braces
  const trimmed = operationBody.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    return fieldCalls;
  }

  const body = trimmed.slice(1, -1); // Remove outer braces

  // Parse field calls - handle nested braces for selection sets
  let depth = 0;
  let currentField = "";

  for (let i = 0; i < body.length; i++) {
    const char = body[i];

    if (char === "{") {
      depth++;
      currentField += char;
    } else if (char === "}") {
      depth--;
      currentField += char;
      // When we close a top-level selection set, the field is complete
      if (depth === 0 && currentField.trim()) {
        const parsed = parseFieldCall(currentField.trim());
        if (parsed) fieldCalls.push(parsed);
        currentField = "";
      }
    } else if ((char === "\n" || char === " ") && depth === 0) {
      // At depth 0, whitespace can separate fields without selection sets
      if (currentField.trim() && !currentField.includes("{")) {
        // Field without selection set (e.g., scalar field) - rare at root level
        const parsed = parseFieldCall(currentField.trim());
        if (parsed) fieldCalls.push(parsed);
        currentField = "";
      } else if (char === "\n" && !currentField.trim()) {
        // Skip empty lines
        continue;
      } else {
        currentField += char;
      }
    } else {
      currentField += char;
    }
  }

  // Handle last field (if no selection set)
  if (currentField.trim()) {
    const parsed = parseFieldCall(currentField.trim());
    if (parsed) fieldCalls.push(parsed);
  }

  return fieldCalls;
}

function parseFieldCall(fieldStr: string): FieldCall | null {
  // Handle alias: aliasName: fieldName(args) { ... }
  let alias: string | undefined;
  let str = fieldStr;

  // Check for alias
  const aliasMatch = str.match(/^(\w+)\s*:\s*/);
  if (aliasMatch) {
    alias = aliasMatch[1];
    str = str.slice(aliasMatch[0].length);
  }

  // Parse field name - find where arguments start (if any)
  const nameMatch = str.match(/^(\w+)/);
  if (!nameMatch) return null;

  const name = nameMatch[1];
  str = str.slice(name.length).trim();

  // Parse arguments if present
  const args: Record<string, unknown> = {};
  if (str.startsWith("(")) {
    // Find matching closing paren, accounting for nested parens and strings
    let depth = 0;
    let inString = false;
    let stringChar = "";
    let endIndex = 0;

    for (let i = 0; i < str.length; i++) {
      const char = str[i];
      const prevChar = i > 0 ? str[i - 1] : "";

      if (!inString) {
        if (char === '"' || char === "'") {
          inString = true;
          stringChar = char;
        } else if (char === "(") {
          depth++;
        } else if (char === ")") {
          depth--;
          if (depth === 0) {
            endIndex = i;
            break;
          }
        }
      } else {
        if (char === stringChar && prevChar !== "\\") {
          inString = false;
        }
      }
    }

    const argsStr = str.slice(1, endIndex);
    parseArgsString(argsStr, args);
  }

  return { name, alias, args };
}

function parseArgsString(argsStr: string, args: Record<string, unknown>): void {
  // Parse arguments like: id: "value", limit: 10, status: [a, b]
  let i = 0;
  while (i < argsStr.length) {
    // Skip whitespace
    while (i < argsStr.length && /\s/.test(argsStr[i])) i++;
    if (i >= argsStr.length) break;

    // Read argument name
    let argName = "";
    while (i < argsStr.length && /\w/.test(argsStr[i])) {
      argName += argsStr[i++];
    }
    if (!argName) break;

    // Skip whitespace and colon
    while (i < argsStr.length && /[\s:]/.test(argsStr[i])) i++;

    // Read argument value
    const valueStart = i;
    let value: unknown;

    if (argsStr[i] === '"') {
      // String value
      i++; // Skip opening quote
      let strValue = "";
      while (i < argsStr.length && argsStr[i] !== '"') {
        if (argsStr[i] === "\\" && i + 1 < argsStr.length) {
          i++;
          strValue += argsStr[i];
        } else {
          strValue += argsStr[i];
        }
        i++;
      }
      i++; // Skip closing quote
      value = strValue;
    } else if (argsStr[i] === "$") {
      // Variable reference
      i++; // Skip $
      let varName = "";
      while (i < argsStr.length && /\w/.test(argsStr[i])) {
        varName += argsStr[i++];
      }
      value = { __variable: varName };
    } else if (argsStr[i] === "[") {
      // Array value
      let depth = 0;
      let arrEnd = i;
      for (; arrEnd < argsStr.length; arrEnd++) {
        if (argsStr[arrEnd] === "[") depth++;
        else if (argsStr[arrEnd] === "]") {
          depth--;
          if (depth === 0) {
            arrEnd++;
            break;
          }
        }
      }
      const arrStr = argsStr.slice(i, arrEnd);
      i = arrEnd;
      // Parse array elements (simplified - handles enums and strings)
      try {
        // Try JSON parse with quoted values
        value = JSON.parse(arrStr.replace(/(\w+)(?=\s*[,\]])/g, '"$1"'));
      } catch {
        value = [];
      }
    } else {
      // Number, boolean, null, or enum
      let rawValue = "";
      while (i < argsStr.length && !/[\s,)]/.test(argsStr[i])) {
        rawValue += argsStr[i++];
      }
      if (rawValue === "true") value = true;
      else if (rawValue === "false") value = false;
      else if (rawValue === "null") value = null;
      else if (!isNaN(Number(rawValue))) value = Number(rawValue);
      else value = rawValue; // enum value
    }

    args[argName] = value;

    // Skip comma and whitespace
    while (i < argsStr.length && /[\s,]/.test(argsStr[i])) i++;
  }
}

function resolveArguments(
  args: Record<string, unknown>,
  variables: Record<string, unknown>
): Record<string, unknown> {
  const resolved: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(args)) {
    if (value && typeof value === "object" && "__variable" in value) {
      const varName = (value as { __variable: string }).__variable;
      resolved[key] = variables[varName];
    } else {
      resolved[key] = value;
    }
  }

  return resolved;
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
