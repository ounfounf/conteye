# ConTeye

A high-performance content analysis and file processing system with distributed worker support. ConTeye provides an OpenAPI-based HTTP interface for monitoring tasks, managing resources, and coordinating multiple instances in a peer-to-peer architecture.

## Features

- **Distributed Processing**: Connect multiple instances to share worker pools across machines
- **OpenAPI Interface**: RESTful API with full OpenAPI 3.0 specification
- **Real-time Monitoring**: Track tasks, workers, and resource metrics
- **File Ingestion**: Recursively process directories with configurable processors
- **WebSocket Peer Connections**: Instances can connect to share workloads
- **DuckDB Storage**: Fast analytical database for file metadata and hashes

## Quick Start

### Prerequisites

- [Deno](https://deno.land/) v1.40 or later

### Installation

```bash
git clone <repository-url>
cd conteye
```

### Start the Server

```bash
# Start server with default settings
deno task server --db ./data.db

# Or with custom port and worker count
deno task server --db ./data.db --port 8080 --workers 8
```

### Full Command Options

```bash
deno run --allow-net --allow-read --allow-write --allow-ffi src/server.ts [OPTIONS]

OPTIONS:
  --port <port>       Port to listen on (default: 3000)
  --hostname <host>   Hostname to bind to (default: 0.0.0.0)
  --db <path>         Path to DuckDB database file (required)
  --workers <count>   Number of worker threads (default: CPU cores - 1)
  --help              Show help message
```

## API Reference

### Status & Monitoring

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Health check |
| GET | `/api/status` | Instance status including WebSocket URL |
| GET | `/api/metrics` | Performance and resource metrics |

### Workers

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/workers` | List all workers (local and remote) |
| GET | `/api/workers/:id` | Get specific worker details |
| POST | `/api/workers/remote` | Connect to a remote worker pool |
| DELETE | `/api/workers/:id` | Disconnect a remote worker |

### Peers

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/peers` | List connected peer instances |
| POST | `/api/peers` | Connect to a peer instance |
| DELETE | `/api/peers/:id` | Disconnect from a peer |

### Tasks

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/tasks` | List tasks (supports `?status=`, `?limit=`, `?offset=`) |
| GET | `/api/tasks/:id` | Get specific task details |
| GET | `/api/tasks/active` | List pending and running tasks |
| GET | `/api/tasks/summary` | Get task count summary by status |

### Ingests

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/ingests` | List all ingest jobs |
| GET | `/api/ingests/:id` | Get specific ingest job details |
| GET | `/api/ingests/active` | List active ingest jobs |
| POST | `/api/ingests` | Start a new ingest job |
| DELETE | `/api/ingests/:id` | Cancel an ingest job |

### OpenAPI Specification

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/openapi.json` | Full OpenAPI 3.0 specification |

### WebSocket

| Endpoint | Description |
|----------|-------------|
| `/ws/workers` | Worker pool connection endpoint for peer instances |

## Usage Examples

### Check Instance Status

```bash
curl http://localhost:3000/api/status
```

Response:
```json
{
  "id": "a1b2c3d4-...",
  "version": "0.1.0",
  "wsUrl": "ws://localhost:3000/ws/workers",
  "uptime": 123456,
  "startTime": 1704067200000
}
```

### Get Metrics

```bash
curl http://localhost:3000/api/metrics
```

Response:
```json
{
  "instance": {
    "uptimeMs": 123456,
    "startTime": 1704067200000
  },
  "workers": {
    "total": 8,
    "local": 7,
    "remote": 1,
    "busy": 3,
    "idle": 5
  },
  "tasks": {
    "pending": 10,
    "running": 3,
    "completed": 1500,
    "failed": 5,
    "avgDurationMs": 45,
    "throughputPerSec": 12.5
  },
  "resources": {
    "memoryUsedBytes": 52428800,
    "heapUsedBytes": 31457280,
    "heapTotalBytes": 67108864
  },
  "queue": {
    "depth": 10,
    "avgWaitTimeMs": 25
  }
}
```

### Start an Ingest Job

```bash
curl -X POST http://localhost:3000/api/ingests \
  -H "Content-Type: application/json" \
  -d '{"root": "/path/to/directory", "processors": ["xxhash3"]}'
```

Response:
```json
{
  "success": true,
  "ingest": {
    "id": "job-uuid-...",
    "root": "/path/to/directory",
    "status": "queued",
    "processors": ["xxhash3"],
    "totalFiles": 0,
    "processedFiles": 0,
    "startedAt": 1704067200000,
    "errors": []
  }
}
```

### Connect to a Peer Instance

```bash
# Instance A connects to Instance B's worker pool
curl -X POST http://localhost:3000/api/peers \
  -H "Content-Type: application/json" \
  -d '{"wsUrl": "ws://instance-b:3001/ws/workers"}'
```

### List Workers

```bash
curl http://localhost:3000/api/workers
```

Response:
```json
{
  "workers": [
    {"id": "uuid-1", "type": "local", "busy": false},
    {"id": "uuid-2", "type": "local", "busy": true},
    {"id": "uuid-3", "type": "remote", "busy": false, "host": "instance-b:3001"}
  ],
  "summary": {
    "total": 3,
    "local": 2,
    "remote": 1,
    "busy": 1,
    "idle": 2
  }
}
```

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      OpenAPI HTTP Server                        │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │ GET /status  │  │ GET /metrics │  │ GET /tasks           │  │
│  │ GET /workers │  │ GET /ingests │  │ POST /ingests        │  │
│  └──────────────┘  └──────────────┘  └──────────────────────┘  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ WebSocket /ws/workers  (peer-to-peer connections)        │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────────┐
│                        Instance Core                            │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────────────┐ │
│  │ WorkerPool  │  │ TaskManager  │  │ MetricsCollector       │ │
│  │ (local +    │  │              │  │                        │ │
│  │  remote)    │  │              │  │                        │ │
│  └─────────────┘  └──────────────┘  └────────────────────────┘ │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ IngestManager - manages file ingestion jobs             │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────────────────────┐
              │      DuckDB Database          │
              │  - paths (file metadata)      │
              │  - files (content hashes)     │
              └───────────────────────────────┘
```

## Processors

ConTeye supports pluggable processors for file content analysis:

| Processor | Description |
|-----------|-------------|
| `xxhash3` | Fast XXHash3 content hashing (default) |
| `md5` | MD5 content hashing |
| `ffprobe` | Media metadata extraction (requires ffprobe) |

## Database Schema

ConTeye uses DuckDB with the following schema:

```sql
CREATE TABLE paths (
    path TEXT PRIMARY KEY,
    parent TEXT,
    isFile INTEGER NOT NULL,
    size INTEGER,
    mtime INTEGER NOT NULL,
    ctime INTEGER NOT NULL,
    atime INTEGER NOT NULL
);

CREATE TABLE files (
    path TEXT PRIMARY KEY,
    xxhash3 TEXT NOT NULL
);
```

## Development

### Run Tests

```bash
deno task test
```

### Type Check

```bash
deno check src/server.ts
deno check src/mod.ts
```

### Project Structure

```
src/
├── server.ts              # OpenAPI server entry point
├── mod.ts                 # CLI entry point (legacy)
├── core/
│   ├── instance.ts        # Central instance state
│   ├── metrics.ts         # Metrics collection
│   ├── task_manager.ts    # Task tracking
│   └── ingest_manager.ts  # Ingest job management
├── api/
│   ├── router.ts          # HTTP routing
│   ├── openapi.ts         # OpenAPI spec generation
│   └── handlers/
│       ├── status.ts      # Status endpoints
│       ├── workers.ts     # Worker endpoints
│       ├── tasks.ts       # Task endpoints
│       └── ingests.ts     # Ingest endpoints
├── work/
│   ├── worker_pool.ts     # Worker pool with WebSocket support
│   ├── worker.ts          # Worker thread implementation
│   └── request.ts         # Request types
├── process/
│   ├── index.ts           # Processor registry
│   ├── xxhash3.ts         # XXHash3 processor
│   ├── md5.ts             # MD5 processor
│   └── ffprobe.ts         # FFprobe processor
├── fs.ts                  # Filesystem operations
└── logger.ts              # Logging configuration
```

## License

[Add license information here]
