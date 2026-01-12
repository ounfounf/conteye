import type { Instance } from "~/core/instance.ts";

export interface OpenApiSpec {
  openapi: string;
  info: {
    title: string;
    version: string;
    description: string;
  };
  servers: Array<{
    url: string;
    description: string;
  }>;
  paths: Record<string, Record<string, PathOperation>>;
  components: {
    schemas: Record<string, SchemaObject>;
  };
}

interface PathOperation {
  summary: string;
  description?: string;
  tags: string[];
  parameters?: ParameterObject[];
  requestBody?: RequestBodyObject;
  responses: Record<string, ResponseObject>;
}

interface ParameterObject {
  name: string;
  in: "path" | "query" | "header";
  required?: boolean;
  schema: SchemaObject;
  description?: string;
}

interface RequestBodyObject {
  required?: boolean;
  content: {
    "application/json": {
      schema: SchemaObject;
    };
  };
}

interface ResponseObject {
  description: string;
  content?: {
    "application/json": {
      schema: SchemaObject;
    };
  };
}

interface SchemaObject {
  type?: string;
  format?: string;
  properties?: Record<string, SchemaObject>;
  items?: SchemaObject;
  required?: string[];
  enum?: string[];
  $ref?: string;
  description?: string;
}

export function generateOpenApiSpec(instance: Instance): OpenApiSpec {
  const status = instance.getStatus();

  return {
    openapi: "3.0.3",
    info: {
      title: "ConTeye API",
      version: status.version,
      description: "Content analysis and file processing API with distributed worker support",
    },
    servers: [
      {
        url: `http://localhost:${instance.config.port}`,
        description: "Local server",
      },
    ],
    paths: {
      // Health and Status
      "/api/health": {
        get: {
          summary: "Health check",
          description: "Returns the health status of the instance",
          tags: ["Status"],
          responses: {
            "200": {
              description: "Instance is healthy",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      status: { type: "string", enum: ["healthy"] },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/api/status": {
        get: {
          summary: "Instance status",
          description: "Returns detailed status information about the instance",
          tags: ["Status"],
          responses: {
            "200": {
              description: "Instance status",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/InstanceStatus" },
                },
              },
            },
          },
        },
      },
      "/api/metrics": {
        get: {
          summary: "Instance metrics",
          description: "Returns performance and resource metrics",
          tags: ["Status"],
          responses: {
            "200": {
              description: "Instance metrics",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Metrics" },
                },
              },
            },
          },
        },
      },

      // Workers
      "/api/workers": {
        get: {
          summary: "List workers",
          description: "Returns all workers in the pool (local and remote)",
          tags: ["Workers"],
          responses: {
            "200": {
              description: "Worker list",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/WorkersResponse" },
                },
              },
            },
          },
        },
      },
      "/api/workers/{id}": {
        get: {
          summary: "Get worker",
          description: "Returns details of a specific worker",
          tags: ["Workers"],
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string" },
              description: "Worker UUID",
            },
          ],
          responses: {
            "200": {
              description: "Worker details",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/WorkerInfo" },
                },
              },
            },
            "404": {
              description: "Worker not found",
            },
          },
        },
        delete: {
          summary: "Disconnect worker",
          description: "Disconnects a remote worker from the pool",
          tags: ["Workers"],
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string" },
              description: "Worker UUID",
            },
          ],
          responses: {
            "200": {
              description: "Worker disconnected",
            },
            "404": {
              description: "Worker not found or cannot be disconnected",
            },
          },
        },
      },
      "/api/workers/remote": {
        post: {
          summary: "Connect remote worker",
          description: "Connects to a remote worker pool via WebSocket",
          tags: ["Workers"],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["wsUrl"],
                  properties: {
                    wsUrl: {
                      type: "string",
                      description: "WebSocket URL of the remote worker pool",
                    },
                  },
                },
              },
            },
          },
          responses: {
            "201": {
              description: "Connected to remote worker",
            },
            "400": {
              description: "Invalid request",
            },
          },
        },
      },

      // Peers
      "/api/peers": {
        get: {
          summary: "List peers",
          description: "Returns all connected peer instances",
          tags: ["Peers"],
          responses: {
            "200": {
              description: "Peer list",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/PeersResponse" },
                },
              },
            },
          },
        },
        post: {
          summary: "Connect to peer",
          description: "Connects to another ConTeye instance",
          tags: ["Peers"],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["wsUrl"],
                  properties: {
                    wsUrl: {
                      type: "string",
                      description: "WebSocket URL of the peer instance",
                    },
                  },
                },
              },
            },
          },
          responses: {
            "201": {
              description: "Connected to peer",
            },
            "400": {
              description: "Invalid request",
            },
          },
        },
      },
      "/api/peers/{id}": {
        delete: {
          summary: "Disconnect peer",
          description: "Disconnects from a peer instance",
          tags: ["Peers"],
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string" },
              description: "Peer ID",
            },
          ],
          responses: {
            "200": {
              description: "Peer disconnected",
            },
            "404": {
              description: "Peer not found",
            },
          },
        },
      },

      // Tasks
      "/api/tasks": {
        get: {
          summary: "List tasks",
          description: "Returns tasks with optional filtering",
          tags: ["Tasks"],
          parameters: [
            {
              name: "status",
              in: "query",
              schema: { type: "string" },
              description: "Filter by status (comma-separated: pending,running,completed,failed)",
            },
            {
              name: "limit",
              in: "query",
              schema: { type: "integer" },
              description: "Maximum number of tasks to return",
            },
            {
              name: "offset",
              in: "query",
              schema: { type: "integer" },
              description: "Number of tasks to skip",
            },
          ],
          responses: {
            "200": {
              description: "Task list",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/TasksResponse" },
                },
              },
            },
          },
        },
      },
      "/api/tasks/active": {
        get: {
          summary: "List active tasks",
          description: "Returns pending and running tasks",
          tags: ["Tasks"],
          responses: {
            "200": {
              description: "Active task list",
            },
          },
        },
      },
      "/api/tasks/summary": {
        get: {
          summary: "Task summary",
          description: "Returns task count summary by status",
          tags: ["Tasks"],
          responses: {
            "200": {
              description: "Task summary",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/TaskSummary" },
                },
              },
            },
          },
        },
      },
      "/api/tasks/{id}": {
        get: {
          summary: "Get task",
          description: "Returns details of a specific task",
          tags: ["Tasks"],
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string" },
              description: "Task UUID",
            },
          ],
          responses: {
            "200": {
              description: "Task details",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Task" },
                },
              },
            },
            "404": {
              description: "Task not found",
            },
          },
        },
      },

      // Ingests
      "/api/ingests": {
        get: {
          summary: "List ingests",
          description: "Returns all ingest jobs",
          tags: ["Ingests"],
          responses: {
            "200": {
              description: "Ingest list",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/IngestsResponse" },
                },
              },
            },
          },
        },
        post: {
          summary: "Start ingest",
          description: "Starts a new file ingestion job",
          tags: ["Ingests"],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["root"],
                  properties: {
                    root: {
                      type: "string",
                      description: "Root directory path to ingest",
                    },
                    processors: {
                      type: "array",
                      items: { type: "string" },
                      description: "Processors to apply (default: xxhash3)",
                    },
                  },
                },
              },
            },
          },
          responses: {
            "201": {
              description: "Ingest started",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/IngestJob" },
                },
              },
            },
            "400": {
              description: "Invalid request",
            },
          },
        },
      },
      "/api/ingests/active": {
        get: {
          summary: "List active ingests",
          description: "Returns currently running ingest jobs",
          tags: ["Ingests"],
          responses: {
            "200": {
              description: "Active ingest list",
            },
          },
        },
      },
      "/api/ingests/{id}": {
        get: {
          summary: "Get ingest",
          description: "Returns details of a specific ingest job",
          tags: ["Ingests"],
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string" },
              description: "Ingest job UUID",
            },
          ],
          responses: {
            "200": {
              description: "Ingest details",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/IngestJob" },
                },
              },
            },
            "404": {
              description: "Ingest not found",
            },
          },
        },
        delete: {
          summary: "Cancel ingest",
          description: "Cancels a running ingest job",
          tags: ["Ingests"],
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string" },
              description: "Ingest job UUID",
            },
          ],
          responses: {
            "200": {
              description: "Ingest cancelled",
            },
            "404": {
              description: "Ingest not found or already completed",
            },
          },
        },
      },
    },
    components: {
      schemas: {
        InstanceStatus: {
          type: "object",
          properties: {
            id: { type: "string", description: "Instance UUID" },
            version: { type: "string", description: "API version" },
            wsUrl: { type: "string", description: "WebSocket URL for worker connections" },
            uptime: { type: "integer", description: "Uptime in milliseconds" },
            startTime: { type: "integer", description: "Start timestamp" },
          },
        },
        Metrics: {
          type: "object",
          properties: {
            instance: {
              type: "object",
              properties: {
                uptimeMs: { type: "integer" },
                startTime: { type: "integer" },
              },
            },
            workers: {
              type: "object",
              properties: {
                total: { type: "integer" },
                local: { type: "integer" },
                remote: { type: "integer" },
                busy: { type: "integer" },
                idle: { type: "integer" },
              },
            },
            tasks: {
              type: "object",
              properties: {
                pending: { type: "integer" },
                running: { type: "integer" },
                completed: { type: "integer" },
                failed: { type: "integer" },
                avgDurationMs: { type: "number" },
                throughputPerSec: { type: "number" },
              },
            },
            resources: {
              type: "object",
              properties: {
                memoryUsedBytes: { type: "integer" },
                heapUsedBytes: { type: "integer" },
                heapTotalBytes: { type: "integer" },
              },
            },
            queue: {
              type: "object",
              properties: {
                depth: { type: "integer" },
                avgWaitTimeMs: { type: "number" },
              },
            },
          },
        },
        WorkerInfo: {
          type: "object",
          properties: {
            id: { type: "string" },
            type: { type: "string", enum: ["local", "remote"] },
            busy: { type: "boolean" },
            host: { type: "string", description: "Remote host (for remote workers)" },
          },
        },
        WorkersResponse: {
          type: "object",
          properties: {
            workers: {
              type: "array",
              items: { $ref: "#/components/schemas/WorkerInfo" },
            },
            summary: {
              type: "object",
              properties: {
                total: { type: "integer" },
                local: { type: "integer" },
                remote: { type: "integer" },
                busy: { type: "integer" },
                idle: { type: "integer" },
              },
            },
          },
        },
        PeersResponse: {
          type: "object",
          properties: {
            peers: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  wsUrl: { type: "string" },
                  connectedAt: { type: "integer" },
                },
              },
            },
          },
        },
        Task: {
          type: "object",
          properties: {
            id: { type: "string" },
            request: { type: "object" },
            status: { type: "string", enum: ["pending", "running", "completed", "failed"] },
            queuedAt: { type: "integer" },
            startedAt: { type: "integer" },
            completedAt: { type: "integer" },
            workerId: { type: "string" },
            result: { type: "object" },
            error: { type: "string" },
          },
        },
        TasksResponse: {
          type: "object",
          properties: {
            tasks: {
              type: "array",
              items: { $ref: "#/components/schemas/Task" },
            },
            summary: { $ref: "#/components/schemas/TaskSummary" },
          },
        },
        TaskSummary: {
          type: "object",
          properties: {
            total: { type: "integer" },
            pending: { type: "integer" },
            running: { type: "integer" },
            completed: { type: "integer" },
            failed: { type: "integer" },
          },
        },
        IngestJob: {
          type: "object",
          properties: {
            id: { type: "string" },
            root: { type: "string" },
            status: { type: "string", enum: ["queued", "scanning", "processing", "completed", "cancelled", "failed"] },
            processors: { type: "array", items: { type: "string" } },
            totalFiles: { type: "integer" },
            processedFiles: { type: "integer" },
            totalBytes: { type: "integer" },
            processedBytes: { type: "integer" },
            startedAt: { type: "integer" },
            completedAt: { type: "integer" },
            errors: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  path: { type: "string" },
                  error: { type: "string" },
                  timestamp: { type: "integer" },
                },
              },
            },
          },
        },
        IngestsResponse: {
          type: "object",
          properties: {
            ingests: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  root: { type: "string" },
                  status: { type: "string" },
                  progress: { type: "integer" },
                  processedFiles: { type: "integer" },
                  totalFiles: { type: "integer" },
                },
              },
            },
            active: { type: "integer" },
            total: { type: "integer" },
          },
        },
      },
    },
  };
}
