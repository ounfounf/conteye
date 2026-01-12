import type { DuckDBConnection, DuckDBInstance } from "npm:@duckdb/node-api";
import { DuckDBInstance as DuckDBInstanceClass } from "npm:@duckdb/node-api";
import { WorkerPool, WebSocketHost } from "~/work/worker_pool.ts";
import { MetricsCollector } from "./metrics.ts";
import { TaskManager } from "./task_manager.ts";
import { IngestManager } from "./ingest_manager.ts";
import { getAppLogger } from "~/logger.ts";

const logger = getAppLogger("instance");

export const DB_SCHEMA = `
CREATE TABLE IF NOT EXISTS paths (
    path TEXT PRIMARY KEY,
    parent TEXT,
    isFile INTEGER NOT NULL,
    size INTEGER,
    mtime INTEGER NOT NULL,
    ctime INTEGER NOT NULL,
    atime INTEGER NOT NULL,
    FOREIGN KEY (parent) REFERENCES paths(path)
);

CREATE TABLE IF NOT EXISTS files (
    path TEXT PRIMARY KEY,
    xxhash3 TEXT NOT NULL,
    FOREIGN KEY (path) REFERENCES paths(path)
);
`;

export interface InstanceConfig {
  port: number;
  hostname?: string;
  dbPath: string;
  workerCount?: number;
}

export interface PeerInfo {
  id: string;
  wsUrl: string;
  connectedAt: number;
}

export interface InstanceStatus {
  id: string;
  version: string;
  wsUrl: string;
  uptime: number;
  startTime: number;
}

export class Instance {
  readonly id: string;
  readonly config: InstanceConfig;
  readonly pool: WorkerPool;
  readonly wsHost: WebSocketHost;
  readonly db: DuckDBConnection;
  readonly dbInstance: DuckDBInstance;
  readonly metrics: MetricsCollector;
  readonly taskManager: TaskManager;
  readonly ingestManager: IngestManager;

  private readonly startTime: number;
  private readonly peers: Map<string, PeerInfo> = new Map();
  private httpServer?: Deno.HttpServer;

  private constructor(
    config: InstanceConfig,
    pool: WorkerPool,
    wsHost: WebSocketHost,
    dbInstance: DuckDBInstance,
    db: DuckDBConnection,
  ) {
    this.id = crypto.randomUUID();
    this.config = config;
    this.pool = pool;
    this.wsHost = wsHost;
    this.dbInstance = dbInstance;
    this.db = db;
    this.startTime = Date.now();

    this.metrics = new MetricsCollector();
    this.taskManager = new TaskManager();
    this.ingestManager = new IngestManager(db, pool);

    // Set up hooks to connect pool to metrics
    this.pool.setHooks({
      onTaskQueued: (_request, taskId) => {
        this.metrics.recordTaskQueued(Date.now());
        if (taskId) {
          // Task already created externally
        }
      },
      onTaskStarted: (_request, workerId, taskId) => {
        this.metrics.recordTaskStarted(Date.now());
        if (taskId) {
          this.taskManager.markRunning(taskId, workerId);
        }
      },
      onTaskCompleted: (_request, _workerId, result, taskId) => {
        this.metrics.recordTaskCompleted(Date.now());
        if (taskId) {
          this.taskManager.markCompleted(taskId, result);
        }
      },
      onTaskFailed: (_request, _workerId, error, taskId) => {
        this.metrics.recordTaskFailed(Date.now());
        if (taskId) {
          this.taskManager.markFailed(taskId, error.message);
        }
      },
    });

    logger.info`Instance ${this.id} initialized`;
  }

  static async create(config: InstanceConfig): Promise<Instance> {
    logger.info`Creating instance with config: port=${config.port}, dbPath=${config.dbPath}`;

    // Create worker pool
    const workerCount = config.workerCount ?? ((navigator.hardwareConcurrency - 1) || 4);
    logger.debug`Creating worker pool with ${workerCount} workers`;
    const pool = await WorkerPool.create(workerCount);

    // Create WebSocket host (uses port 0 to get assigned port, we'll use HTTP server for main port)
    logger.debug`Creating WebSocket host`;
    const wsHost = await WebSocketHost.create(0, { port: 0 }); // Placeholder, will be integrated

    // Create database connection
    logger.debug`Opening database at ${config.dbPath}`;
    const dbInstance = await DuckDBInstanceClass.create(config.dbPath);
    const db = await dbInstance.connect();
    await db.run(DB_SCHEMA);

    const instance = new Instance(config, pool, wsHost, dbInstance, db);
    return instance;
  }

  get wsUrl(): string {
    const hostname = this.config.hostname ?? "localhost";
    return `ws://${hostname}:${this.config.port}/ws/workers`;
  }

  getStatus(): InstanceStatus {
    return {
      id: this.id,
      version: "0.1.0",
      wsUrl: this.wsUrl,
      uptime: Date.now() - this.startTime,
      startTime: this.startTime,
    };
  }

  async connectToPeer(wsUrl: string): Promise<PeerInfo> {
    logger.info`Connecting to peer at ${wsUrl}`;
    await this.pool.connect(wsUrl);

    const peer: PeerInfo = {
      id: crypto.randomUUID(),
      wsUrl,
      connectedAt: Date.now(),
    };
    this.peers.set(peer.id, peer);

    logger.info`Connected to peer: id=${peer.id}, wsUrl=${wsUrl}`;
    return peer;
  }

  disconnectPeer(peerId: string): boolean {
    const peer = this.peers.get(peerId);
    if (!peer) {
      return false;
    }

    // Find and disconnect the worker with matching host
    const host = new URL(peer.wsUrl).host;
    const workers = this.pool.getWorkerInfo();
    for (const worker of workers) {
      if (worker.type === "remote" && worker.host === host) {
        this.pool.disconnectWorker(worker.id);
        break;
      }
    }

    this.peers.delete(peerId);
    logger.info`Disconnected from peer: id=${peerId}`;
    return true;
  }

  getPeers(): PeerInfo[] {
    return Array.from(this.peers.values());
  }

  setHttpServer(server: Deno.HttpServer): void {
    this.httpServer = server;
  }

  async close(): Promise<void> {
    logger.info`Closing instance ${this.id}`;

    // Cancel all active ingests
    this.ingestManager.clear();

    // Close HTTP server
    if (this.httpServer) {
      await this.httpServer.shutdown();
    }

    // Close worker pool
    this.pool.close();

    // Close database
    this.db.closeSync();
    this.dbInstance.closeSync();

    logger.info`Instance ${this.id} closed`;
  }
}
