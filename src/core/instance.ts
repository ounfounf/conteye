import { WorkerPool, WebSocketHost } from "~/work/worker_pool.ts";
import { MetricsCollector } from "./metrics.ts";
import { TaskManager } from "./task_manager.ts";
import { IngestManager } from "./ingest_manager.ts";
import { getAppLogger } from "~/logger.ts";

type DuckDBConnection = any;
type DuckDBInstance = any;

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

CREATE TABLE IF NOT EXISTS known_peers (
    wsUrl TEXT PRIMARY KEY,
    name TEXT,
    autoConnect INTEGER NOT NULL DEFAULT 1,
    createdAt BIGINT NOT NULL,
    lastConnectedAt BIGINT
);
`;

export interface InstanceConfig {
  port: number;
  hostname?: string;
  dbPath?: string;
  workerCount?: number;
}

export interface PeerInfo {
  id: string;
  wsUrl: string;
  connectedAt: number;
}

export interface KnownPeer {
  wsUrl: string;
  name?: string;
  autoConnect: boolean;
  createdAt: number;
  lastConnectedAt?: number;
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
  readonly db?: DuckDBConnection;
  readonly dbInstance?: DuckDBInstance;
  readonly metrics: MetricsCollector;
  readonly taskManager: TaskManager;
  readonly ingestManager?: IngestManager;

  private readonly startTime: number;
  private readonly peers: Map<string, PeerInfo> = new Map();
  private httpServer?: Deno.HttpServer;

  private constructor(
    config: InstanceConfig,
    pool: WorkerPool,
    wsHost: WebSocketHost,
    dbInstance?: DuckDBInstance,
    db?: DuckDBConnection,
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
    this.ingestManager = db ? new IngestManager(db, pool) : undefined;

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

    let dbInstance: any;
    let db: any;

    if (config.dbPath) {
      // Dynamically import DuckDB only when needed
      const duckdb = await import("@duckdb/node-api");
      const DuckDBInstanceClass = duckdb.DuckDBInstance;

      // Create database connection
      logger.debug`Opening database at ${config.dbPath}`;
      dbInstance = await DuckDBInstanceClass.create(config.dbPath);
      db = await dbInstance.connect();
      await db.run(DB_SCHEMA);
    }

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

  async connectToPeer(wsUrl: string, name?: string): Promise<PeerInfo> {
    logger.info`Connecting to peer at ${wsUrl}`;
    await this.pool.connect(wsUrl);

    const peer: PeerInfo = {
      id: crypto.randomUUID(),
      wsUrl,
      connectedAt: Date.now(),
    };
    this.peers.set(peer.id, peer);

    // Automatically save to known peers if database is available
    if (this.db) {
      try {
        await this.saveKnownPeer(wsUrl, name, true);
        await this.updateKnownPeerLastConnected(wsUrl);
      } catch (error) {
        // Log but don't fail the connection if save fails
        logger.warn`Failed to save known peer ${wsUrl}: ${error}`;
      }
    }

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

  // Known peers management (persisted to database)

  async saveKnownPeer(wsUrl: string, name?: string, autoConnect = true): Promise<KnownPeer> {
    if (!this.db) {
      throw new Error("Database not available - cannot save known peer");
    }

    const now = Date.now();
    const stmt = await this.db.prepare(`
      INSERT INTO known_peers (wsUrl, name, autoConnect, createdAt)
      VALUES ($wsUrl, $name, $autoConnect, $createdAt)
      ON CONFLICT(wsUrl) DO UPDATE SET
        name = COALESCE(excluded.name, known_peers.name),
        autoConnect = excluded.autoConnect
    `);
    stmt.bind({
      wsUrl,
      name: name ?? null,
      autoConnect: autoConnect ? 1 : 0,
      createdAt: BigInt(now),
    });
    await stmt.run();

    logger.info`Saved known peer: wsUrl=${wsUrl}, name=${name ?? "none"}, autoConnect=${autoConnect}`;

    return {
      wsUrl,
      name,
      autoConnect,
      createdAt: now,
    };
  }

  async getKnownPeers(): Promise<KnownPeer[]> {
    if (!this.db) {
      return [];
    }

    const result = await this.db.run("SELECT * FROM known_peers ORDER BY createdAt ASC");
    const rows = (await result.getRowObjects()) as Array<{
      wsUrl: string;
      name: string | null;
      autoConnect: number;
      createdAt: bigint;
      lastConnectedAt: bigint | null;
    }>;

    return rows.map((row) => ({
      wsUrl: row.wsUrl,
      name: row.name ?? undefined,
      autoConnect: row.autoConnect === 1,
      createdAt: Number(row.createdAt),
      lastConnectedAt: row.lastConnectedAt ? Number(row.lastConnectedAt) : undefined,
    }));
  }

  async removeKnownPeer(wsUrl: string): Promise<boolean> {
    if (!this.db) {
      return false;
    }

    const stmt = await this.db.prepare("DELETE FROM known_peers WHERE wsUrl = $wsUrl");
    stmt.bind({ wsUrl });
    const result = await stmt.run();
    const changes = result.rowsChanged ?? 0;

    if (changes > 0) {
      logger.info`Removed known peer: wsUrl=${wsUrl}`;
      return true;
    }
    return false;
  }

  async updateKnownPeerLastConnected(wsUrl: string): Promise<void> {
    if (!this.db) {
      return;
    }

    const stmt = await this.db.prepare(
      "UPDATE known_peers SET lastConnectedAt = $lastConnectedAt WHERE wsUrl = $wsUrl"
    );
    stmt.bind({
      lastConnectedAt: BigInt(Date.now()),
      wsUrl,
    });
    await stmt.run();
  }

  async connectToKnownPeers(): Promise<{ connected: string[]; failed: Array<{ wsUrl: string; error: string }> }> {
    const knownPeers = await this.getKnownPeers();
    const autoConnectPeers = knownPeers.filter(p => p.autoConnect);

    const connected: string[] = [];
    const failed: Array<{ wsUrl: string; error: string }> = [];

    logger.info`Attempting to connect to ${autoConnectPeers.length} known peers`;

    for (const knownPeer of autoConnectPeers) {
      try {
        await this.connectToPeer(knownPeer.wsUrl);
        await this.updateKnownPeerLastConnected(knownPeer.wsUrl);
        connected.push(knownPeer.wsUrl);
        logger.info`Connected to known peer: ${knownPeer.wsUrl}`;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        failed.push({ wsUrl: knownPeer.wsUrl, error: message });
        logger.warn`Failed to connect to known peer ${knownPeer.wsUrl}: ${message}`;
      }
    }

    logger.info`Connected to ${connected.length}/${autoConnectPeers.length} known peers`;
    return { connected, failed };
  }

  setHttpServer(server: Deno.HttpServer): void {
    this.httpServer = server;
  }

  async close(): Promise<void> {
    logger.info`Closing instance ${this.id}`;

    // Cancel all active ingests
    this.ingestManager?.clear();

    // Close HTTP server
    if (this.httpServer) {
      await this.httpServer.shutdown();
    }

    // Close worker pool
    this.pool.close();

    // Close database
    if (this.db && this.dbInstance) {
      this.db.closeSync();
      this.dbInstance.closeSync();
    }

    logger.info`Instance ${this.id} closed`;
  }
}
