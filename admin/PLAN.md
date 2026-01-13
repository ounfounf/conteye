# ConTeye Admin Panel - Implementation Plan

## Overview
Build a Refine-based admin panel using Ant Design to manage the ConTeye GraphQL API. The panel will be created in an `admin/` subfolder with its own Node.js/React build process.

## Architecture Decisions

### Custom Data Provider Required
Your GraphQL API uses a custom schema that differs from Refine's default conventions:
- **Your API**: `workers { workers, summary }`, `tasks(status, limit, offset) { tasks, summary }`
- **Refine default**: `resource { nodes, totalCount }` with `createOneResource` mutations

We'll create a custom data provider that maps your API structure to Refine's expectations.

### Technology Stack
- **Framework**: Refine v4
- **UI Library**: Ant Design (`@refinedev/antd`)
- **GraphQL Client**: URQL
- **Build Tool**: Vite
- **Language**: TypeScript

---

## Implementation Steps

### Step 1: Initialize Project Structure

Create `admin/` directory with:
```
admin/
├── src/
│   ├── App.tsx                 # Main Refine app setup
│   ├── main.tsx                # Entry point
│   ├── providers/
│   │   └── dataProvider.ts     # Custom GraphQL data provider
│   ├── graphql/
│   │   └── queries.ts          # All GraphQL queries/mutations
│   ├── pages/
│   │   ├── dashboard/
│   │   │   └── index.tsx       # Dashboard with metrics
│   │   ├── workers/
│   │   │   ├── list.tsx        # Worker list with summary
│   │   │   └── show.tsx        # Worker details
│   │   ├── peers/
│   │   │   ├── list.tsx        # Peer list
│   │   │   └── create.tsx      # Connect new peer
│   │   ├── tasks/
│   │   │   ├── list.tsx        # Task list with filtering
│   │   │   └── show.tsx        # Task details
│   │   └── ingests/
│   │       ├── list.tsx        # Ingest jobs list
│   │       ├── show.tsx        # Ingest job details
│   │       └── create.tsx      # Start new ingest
│   └── components/
│       ├── StatusBadge.tsx     # Status indicator component
│       └── MetricsCard.tsx     # Dashboard metric cards
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
└── .gitignore
```

### Step 2: Package Dependencies

**package.json** key dependencies:
```json
{
  "dependencies": {
    "@refinedev/antd": "^5.x",
    "@refinedev/core": "^4.x",
    "@refinedev/react-router": "^1.x",
    "@urql/core": "^5.x",
    "antd": "^5.x",
    "graphql": "^16.x",
    "graphql-tag": "^2.x",
    "react": "^18.x",
    "react-dom": "^18.x",
    "react-router": "^7.x"
  }
}
```

### Step 3: Custom Data Provider

Create a data provider that handles your API's unique structure:

**Key mappings:**
| Refine Method | Your GraphQL API | Response Mapping |
|---------------|------------------|------------------|
| `getList("workers")` | `workers { workers, summary }` | `data.workers.workers` |
| `getList("tasks")` | `tasks(status, limit, offset) { tasks, summary }` | `data.tasks.tasks` |
| `getList("ingests")` | `ingests { ingests, active, total }` | `data.ingests.ingests` |
| `getList("peers")` | `peers { peers }` | `data.peers.peers` |
| `getOne("worker", id)` | `worker(id) { ... }` | `data.worker` |
| `getOne("task", id)` | `task(id) { ... }` | `data.task` |
| `getOne("ingest", id)` | `ingest(id) { ... }` | `data.ingest` |
| `create("ingest")` | `startIngest(root, processors)` | `data.startIngest.ingest` |
| `delete("ingest", id)` | `cancelIngest(id)` | `data.cancelIngest` |
| `create("peer")` | `connectPeer(wsUrl)` | `data.connectPeer.peer` |
| `delete("peer", id)` | `disconnectPeer(id)` | `data.disconnectPeer` |
| `delete("worker", id)` | `disconnectWorker(id)` | `data.disconnectWorker` |

### Step 4: GraphQL Queries & Mutations

Define all queries matching your schema:

```graphql
# Dashboard
query GetDashboard {
  health { status }
  status { id, version, wsUrl, uptime, startTime }
  metrics {
    workers { total, local, remote, busy, idle }
    tasks { pending, running, completed, failed, avgDurationMs, throughputPerSec }
    resources { memoryUsedBytes, heapUsedBytes, heapTotalBytes }
    queue { depth, avgWaitTimeMs }
  }
}

# Workers
query GetWorkers { workers { workers { id, type, busy, host }, summary { ... } } }
query GetWorker($id: ID!) { worker(id: $id) { id, type, busy, host } }
mutation DisconnectWorker($id: ID!) { disconnectWorker(id: $id) { success, error } }

# Peers
query GetPeers { peers { peers { id, wsUrl, connectedAt } } }
mutation ConnectPeer($wsUrl: String!) { connectPeer(wsUrl: $wsUrl) { success, peer { ... }, error } }
mutation DisconnectPeer($id: ID!) { disconnectPeer(id: $id) { success, error } }

# Tasks
query GetTasks($status: [TaskStatus!], $limit: Int, $offset: Int) {
  tasks(status: $status, limit: $limit, offset: $offset) { tasks { ... }, summary { ... } }
}
query GetTask($id: ID!) { task(id: $id) { ... } }
query GetTaskSummary { taskSummary { total, pending, running, completed, failed } }

# Ingests
query GetIngests { ingests { ingests { ... }, active, total } }
query GetIngest($id: ID!) { ingest(id: $id) { ... } }
mutation StartIngest($root: String!, $processors: [String!]) {
  startIngest(root: $root, processors: $processors) { success, ingest { ... }, error }
}
mutation CancelIngest($id: ID!) { cancelIngest(id: $id) { success, error } }
```

### Step 5: Page Components

#### Dashboard
- Health status indicator
- Instance info (version, uptime, WebSocket URL)
- Metrics cards: Workers (total/busy/idle), Tasks (pending/running/completed/failed), Queue depth
- Resource usage (memory)
- Quick actions: Start Ingest, Connect Worker

#### Workers Page
- Table: ID, Type (local/remote badge), Status (busy/idle), Host
- Summary stats header
- Action: Disconnect (remote workers only)

#### Peers Page
- Table: ID, WebSocket URL, Connected At
- Action: Connect new peer (modal form with wsUrl input)
- Action: Disconnect peer

#### Tasks Page
- Table: ID, Status (color-coded badge), Queued At, Started At, Worker ID
- Filters: Status (multi-select: pending, running, completed, failed)
- Pagination with limit/offset
- Summary stats header
- Click to view task details (request, result, error)

#### Ingests Page
- Table: ID, Root path, Status (badge), Progress bar, Files (processed/total)
- Actions: Start new ingest, Cancel active ingest
- Create form: Root path input, Processor selection (checkboxes)
- Show page: Full details with error list

### Step 6: Components

**StatusBadge**: Maps status strings to Ant Design Tag colors
- `healthy/completed` → green
- `running/processing` → blue
- `pending/queued` → orange
- `failed/cancelled` → red

**MetricsCard**: Reusable statistic card with icon, title, value, trend

---

## Files to Create

| File | Purpose |
|------|---------|
| `admin/package.json` | Dependencies and scripts |
| `admin/vite.config.ts` | Vite build configuration |
| `admin/tsconfig.json` | TypeScript configuration |
| `admin/index.html` | HTML entry point |
| `admin/src/main.tsx` | React entry point |
| `admin/src/App.tsx` | Refine app with providers and routes |
| `admin/src/providers/dataProvider.ts` | Custom GraphQL data provider |
| `admin/src/graphql/queries.ts` | All GraphQL operations |
| `admin/src/pages/dashboard/index.tsx` | Dashboard page |
| `admin/src/pages/workers/list.tsx` | Workers list |
| `admin/src/pages/workers/show.tsx` | Worker details |
| `admin/src/pages/peers/list.tsx` | Peers list |
| `admin/src/pages/peers/create.tsx` | Connect peer form |
| `admin/src/pages/tasks/list.tsx` | Tasks list with filters |
| `admin/src/pages/tasks/show.tsx` | Task details |
| `admin/src/pages/ingests/list.tsx` | Ingests list |
| `admin/src/pages/ingests/show.tsx` | Ingest details |
| `admin/src/pages/ingests/create.tsx` | Start ingest form |
| `admin/src/components/StatusBadge.tsx` | Status indicator |
| `admin/src/components/MetricsCard.tsx` | Dashboard metrics |

---

## Configuration

### API Endpoint
The admin panel will connect to the GraphQL endpoint. Default configuration:
```typescript
const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000/graphql";
```

### CORS
Your GraphQL server may need CORS headers for the admin panel to connect from a different port during development.

---

## Verification

After implementation, verify by:

1. **Install dependencies**: `cd admin && npm install`
2. **Start dev server**: `npm run dev`
3. **Start ConTeye server**: `deno task server` (in main project)
4. **Test pages**:
   - Dashboard loads with health/metrics
   - Workers list shows local workers
   - Tasks list with status filtering works
   - Start a new ingest job via the form
   - Cancel an active ingest
5. **Build for production**: `npm run build`

---

## Notes

- The admin panel is a standalone React app that communicates with your existing GraphQL API
- No changes required to the existing ConTeye Deno codebase
- The custom data provider handles the mapping between Refine's conventions and your API schema
- All mutations return `{ success, error }` which we'll handle with notifications
