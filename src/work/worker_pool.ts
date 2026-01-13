import type { WorkRequest } from "./request.ts";
import type { RemoteWorkerStatus } from "~/core/metrics.ts";
import { getAppLogger } from "~/logger.ts";

const logger = getAppLogger("worker_pool");

export type WorkerType = "local" | "remote";

export interface WorkerInfo {
  id: string;
  type: WorkerType;
  busy: boolean;
  host?: string;
}

export type QueueRequest<T> = {
  request: WorkRequest;
  resolve: (value: T) => void;
  reject: (reason?: any) => void;
  queuedAt: number;
  taskId?: string;
};

export interface WorkerPoolHooks {
  onTaskQueued?: (request: WorkRequest, taskId?: string) => void;
  onTaskStarted?: (request: WorkRequest, workerId: string, taskId?: string) => void;
  onTaskCompleted?: (request: WorkRequest, workerId: string, result: unknown, taskId?: string) => void;
  onTaskFailed?: (request: WorkRequest, workerId: string, error: Error, taskId?: string) => void;
}

interface BaseWorker {
  busy: boolean;
  uuid: string;

  execute<T>(request: QueueRequest<T>): void;
  close(): void;
}

export class ThreadWorker implements BaseWorker {
  private worker: Worker;
  busy: boolean;

  constructor(worker: Worker, public uuid: string) {
    this.worker = worker;
    this.busy = false;
    logger.debug`ThreadWorker ${uuid} constructed`;
  }

  close() {
    logger.debug`ThreadWorker ${this.uuid} closing`;
    this.worker.terminate();
  }

  static create(): Promise<ThreadWorker> {
    logger.debug`ThreadWorker.create() starting`;
    const worker = new Worker(new URL('./worker.ts', import.meta.url).href, { type: 'module' });
    return new Promise<ThreadWorker>((resolve) => {
      worker.onmessage = (event: MessageEvent<{ uuid: string; ready?: boolean }>) => {
        const { ready, uuid } = event.data;
        if (ready) {
          logger.debug`ThreadWorker.create() worker ready with uuid ${uuid}`;
          resolve(new ThreadWorker(worker, uuid));
        }
      };
    });
  }

  execute<T>(request: QueueRequest<T>): void {
    logger.debug`ThreadWorker ${this.uuid} execute() starting, action=${request.request.action}`;
    this.busy = true
    const handleMessage = (event: MessageEvent<{ uuid: string; result?: T; error?: string }>) => {
      const { result, error } = event.data;
      if (event.data.uuid !== this.uuid) {
        logger.debug`ThreadWorker ${this.uuid} ignoring message for uuid ${event.data.uuid}`;
        return;
      }
      this.worker.removeEventListener('message', handleMessage);
      this.busy = false
      if (error) {
        logger.debug`ThreadWorker ${this.uuid} execute() error: ${error}`;
        request.reject(new Error(error));
      } else if (result) {
        logger.debug`ThreadWorker ${this.uuid} execute() success`;
        request.resolve(result);
      } else {
        logger.debug`ThreadWorker ${this.uuid} execute() unknown response`;
        request.reject(new Error('Unknown response from worker'));
      }
    };
    this.worker.addEventListener('message', handleMessage);
    this.worker.postMessage(request.request);
  }
}

export class WorkerPool {
  pool: Array<BaseWorker>;
  // deno-lint-ignore no-explicit-any
  queue: Array<QueueRequest<any>>;
  uuid: string;
  hooks?: WorkerPoolHooks;

  constructor(pool: Array<BaseWorker>, hooks?: WorkerPoolHooks) {
    this.pool = pool;
    this.queue = [];
    this.uuid = crypto.randomUUID();
    this.hooks = hooks;
    logger.debug`WorkerPool ${this.uuid} constructed with ${pool.length} workers`;
  }

  setHooks(hooks: WorkerPoolHooks): void {
    this.hooks = hooks;
  }

  close() {
    logger.debug`WorkerPool ${this.uuid} closing ${this.pool.length} workers`;
    this.pool.forEach(worker => worker.close());
    this.pool.length = 0;
  }

  static async create(count: number): Promise<WorkerPool> {
    logger.debug`WorkerPool.create() starting with count=${count}`;
    const workers: Array<BaseWorker> = [];
    for (let i = 0; i < count; i++) {
      const worker = await ThreadWorker.create();
      workers.push(worker);
    }
    logger.debug`WorkerPool.create() created ${workers.length} workers`;
    return new WorkerPool(workers);
  }

  async connect(url: string): Promise<WebSocketRemoteProxy> {
    if (!url || typeof url !== 'string') {
      throw new Error("Invalid wsUrl format");
    }
    logger.debug`WorkerPool ${this.uuid} connecting to ${url}`;
    // Parse host from URL
    const urlWithoutProtocol = url.replace(/^wss?:\/\//, '');
    const host = urlWithoutProtocol.split('/')[0];
    let socket: WebSocket;
    try {
      socket = new WebSocket(url);
    } catch (error) {
      if (url.startsWith('ws://') || url.startsWith('wss://')) {
        throw new Error("WebSocket connection failed");
      } else {
        throw new Error("Invalid wsUrl format");
      }
    }
    const worker = await (new Promise<WebSocketRemoteProxy>((resolve, reject) => {
      socket.onopen = () => {
        logger.debug`WorkerPool ${this.uuid} WebSocket connected to ${url}`;
        resolve(new WebSocketRemoteProxy(socket, this.uuid, host));
      };
      socket.onerror = (event) => {
        logger.debug`WorkerPool ${this.uuid} WebSocket error: ${event}`;
        reject(new Error("WebSocket connection failed"));
      };
      socket.onclose = (event) => {
        logger.debug`WorkerPool ${this.uuid} WebSocket closed: ${event}`;
        reject(new Error("WebSocket connection closed"));
      };
    }))
    this.pool.push(worker);
    logger.debug`WorkerPool ${this.uuid} added remote worker, total workers=${this.pool.length}`;
    return worker;
  }

  execute<T>(request: WorkRequest, taskId?: string): Promise<T> {
    const availableWorker = this.pool.find(w => !w.busy);
    const queuedAt = Date.now();
    logger.debug`WorkerPool ${this.uuid} execute() action=${request.action} availableWorker=${!!availableWorker} queueLength=${this.queue.length}`;
    return new Promise<T>((resolve, reject) => {
      const queueRequest: QueueRequest<T> = { request, resolve, reject, queuedAt, taskId };
      if (availableWorker) {
        logger.debug`WorkerPool ${this.uuid} dispatching to worker ${availableWorker.uuid}`;
        this.hooks?.onTaskStarted?.(request, availableWorker.uuid, taskId);
        availableWorker.execute(queueRequest);
      } else {
        logger.debug`WorkerPool ${this.uuid} queueing request, new queueLength=${this.queue.length + 1}`;
        this.hooks?.onTaskQueued?.(request, taskId);
        this.queue.push(queueRequest);
      }
    }).finally(() => {
      logger.debug`WorkerPool ${this.uuid} execute() finally, queueLength=${this.queue.length}`;
      if (this.queue.length > 0) {
        const freeWorker = this.pool.find(w => !w.busy);
        if (freeWorker) {
          logger.debug`WorkerPool ${this.uuid} processing queued request with worker ${freeWorker.uuid}`;
          const nextRequest = this.queue.shift()!;
          this.hooks?.onTaskStarted?.(nextRequest.request, freeWorker.uuid, nextRequest.taskId);
          freeWorker.execute(nextRequest);
        }
      }
    });
  }

  // New methods for metrics and worker info

  getWorkerInfo(): WorkerInfo[] {
    return this.pool.map(worker => {
      const isLocal = worker instanceof ThreadWorker;
      return {
        id: worker.uuid,
        type: isLocal ? "local" : "remote" as WorkerType,
        busy: worker.busy,
        host: isLocal ? undefined : (worker as WebSocketRemoteProxy).host,
      };
    });
  }

  getQueueDepth(): number {
    return this.queue.length;
  }

  getWorkerCount(): { total: number; local: number; remote: number; busy: number; idle: number } {
    let local = 0;
    let remote = 0;
    let busy = 0;

    for (const worker of this.pool) {
      if (worker instanceof ThreadWorker) {
        local++;
      } else {
        remote++;
      }
      if (worker.busy) {
        busy++;
      }
    }

    return {
      total: this.pool.length,
      local,
      remote,
      busy,
      idle: this.pool.length - busy,
    };
  }

  disconnectWorker(workerId: string): boolean {
    const index = this.pool.findIndex(w => w.uuid === workerId);
    if (index === -1) return false;

    const worker = this.pool[index];
    // Only allow disconnecting remote workers
    if (worker instanceof ThreadWorker) {
      logger.debug`WorkerPool ${this.uuid} cannot disconnect local worker ${workerId}`;
      return false;
    }

    worker.close();
    this.pool.splice(index, 1);
    logger.debug`WorkerPool ${this.uuid} disconnected worker ${workerId}`;
    return true;
  }

  /**
   * Get status reports from all connected remote workers.
   * For admin UI monitoring only - does NOT affect computation.
   */
  getRemoteWorkerStatuses(): RemoteWorkerStatus[] {
    const statuses: RemoteWorkerStatus[] = [];
    for (const worker of this.pool) {
      if (!(worker instanceof ThreadWorker)) {
        const remote = worker as WebSocketRemoteProxy;
        if (remote.remoteStatus) {
          statuses.push(remote.remoteStatus);
        }
      }
    }
    return statuses;
  }

  /**
   * Get aggregated worker counts including remote worker details.
   * For admin UI monitoring only - does NOT affect computation.
   * Returns counts where remotes are expanded to show their actual workers.
   */
  getAggregatedWorkerCount(): {
    total: number;
    local: number;
    remote: number;
    busy: number;
    idle: number;
    /** Actual total workers across all remotes (for display) */
    remoteActualTotal: number;
    /** Actual busy workers across all remotes (for display) */
    remoteActualBusy: number;
    /** Actual idle workers across all remotes (for display) */
    remoteActualIdle: number;
  } {
    const basic = this.getWorkerCount();
    let remoteActualTotal = 0;
    let remoteActualBusy = 0;
    let remoteActualIdle = 0;

    for (const worker of this.pool) {
      if (!(worker instanceof ThreadWorker)) {
        const remote = worker as WebSocketRemoteProxy;
        if (remote.remoteStatus) {
          remoteActualTotal += remote.remoteStatus.totalWorkers;
          remoteActualBusy += remote.remoteStatus.busyWorkers;
          remoteActualIdle += remote.remoteStatus.idleWorkers;
        }
      }
    }

    return {
      ...basic,
      remoteActualTotal,
      remoteActualBusy,
      remoteActualIdle,
    };
  }
}

/**
 * Worker status info sent from remote to client.
 * For admin UI monitoring only - does NOT affect computation.
 */
interface WorkerStatusInfo {
  totalWorkers: number;
  localWorkers: number;
  remoteWorkers: number;
  busyWorkers: number;
  idleWorkers: number;
  pendingTasks: number;
  runningTasks: number;
}

type WebSocketResponse = {
  busy: boolean;
  uuid: string;
  /** Optional worker status from the remote instance */
  workerStatus?: WorkerStatusInfo;
} & (
  {
    error: string;
  } | {
    result: any;
  } | {
    alive: true;
  }
)

class WebSocketLocalProxy {
  pool: WorkerPool;
  socket: WebSocket;

  constructor(
    socket: WebSocket,
    pool: WorkerPool
  ) {
    this.socket = socket;
    this.pool = pool;
    logger.debug`WebSocketLocalProxy ${this.uuid} constructed`;

    this.socket.onmessage = (event: MessageEvent<string>) => {
      logger.debug`WebSocketLocalProxy ${this.uuid} received raw message: ${event.data}`;
      const rawRequest = JSON.parse(event.data);
      // Extract clientUuid if present, then remove it from the request
      const clientUuid = rawRequest.clientUuid || this.uuid;
      const { clientUuid: _, ...request } = rawRequest as WorkRequest & { clientUuid?: string };
      logger.debug`WebSocketLocalProxy ${this.uuid} parsed request action=${request.action} clientUuid=${clientUuid}`;
      this.send({
        uuid: clientUuid,
        busy: this.busy,
        alive: true,
        workerStatus: this.getWorkerStatus(),
      });
      logger.debug`WebSocketLocalProxy ${this.uuid} executing request action=${request.action}`;
      this.pool.execute(request)
        .then(result => {
          logger.debug`WebSocketLocalProxy ${this.uuid} execute success, sending result to clientUuid=${clientUuid}`;
          this.send({
            uuid: clientUuid,
            busy: this.busy,
            result,
            workerStatus: this.getWorkerStatus(),
          });
        })
        .catch(error => {
          logger.debug`WebSocketLocalProxy ${this.uuid} execute error: ${error.message}`;
          this.send({
            uuid: clientUuid,
            busy: this.busy,
            error: error.message,
            workerStatus: this.getWorkerStatus(),
          });
        });
    };

    this.socket.onclose = () => {
      logger.debug`WebSocketLocalProxy ${this.uuid} socket closed, closing pool`;
      this.pool.close();
    }

    this.socket.onerror = (event) => {
      logger.debug`WebSocketLocalProxy ${this.uuid} socket error: ${event}`;
    }
  }

  send(message: WebSocketResponse) {
    logger.debug`WebSocketLocalProxy ${this.uuid} sending: ${JSON.stringify(message)}`;
    this.socket.send(JSON.stringify(message));
  }

  get uuid() {
    return this.pool.uuid;
  }

  get busy() {
    return this.pool.pool.every(worker => worker.busy);
  }

  /**
   * Get worker status info to send to clients.
   * For admin UI monitoring only.
   */
  getWorkerStatus(): WorkerStatusInfo {
    const counts = this.pool.getWorkerCount();
    return {
      totalWorkers: counts.total,
      localWorkers: counts.local,
      remoteWorkers: counts.remote,
      busyWorkers: counts.busy,
      idleWorkers: counts.idle,
      pendingTasks: this.pool.getQueueDepth(),
      runningTasks: counts.busy, // running = busy workers
    };
  }
}

class WebSocketRemoteProxy implements BaseWorker {
  socket: WebSocket;
  busy: boolean;
  host?: string;

  /**
   * Status reported by the remote about its workers.
   * For admin UI monitoring only - does NOT affect computation.
   */
  remoteStatus?: RemoteWorkerStatus;

  constructor(socket: WebSocket, public uuid: string, host?: string) {
    this.host = host;
    this.socket = socket;
    this.busy = false;
    logger.debug`WebSocketRemoteProxy ${uuid} constructed`;

    this.socket.onerror = (event) => {
      logger.debug`WebSocketRemoteProxy ${this.uuid} socket error: ${event}`;
    }

    this.socket.onclose = () => {
      logger.debug`WebSocketRemoteProxy ${this.uuid} socket closed`;
    }
  }

  execute<T>(request: QueueRequest<T>): void {
    logger.debug`WebSocketRemoteProxy ${this.uuid} execute() starting, action=${request.request.action}`;
    this.busy = true;

    const handleMessage = (event: MessageEvent<string>) => {
      const data: WebSocketResponse = JSON.parse(event.data);
      logger.debug`WebSocketRemoteProxy ${this.uuid} received message: uuid=${data.uuid} busy=${data.busy} hasAlive=${'alive' in data} hasResult=${'result' in data} hasError=${'error' in data}`;

      if (data.uuid !== this.uuid) {
        logger.debug`WebSocketRemoteProxy ${this.uuid} ignoring message for uuid ${data.uuid}`;
        return;
      }

      this.busy = data.busy;

      // Update remote worker status if provided (for admin UI monitoring)
      if (data.workerStatus) {
        this.remoteStatus = {
          peerId: this.uuid,
          host: this.host || 'unknown',
          totalWorkers: data.workerStatus.totalWorkers,
          localWorkers: data.workerStatus.localWorkers,
          remoteWorkers: data.workerStatus.remoteWorkers,
          busyWorkers: data.workerStatus.busyWorkers,
          idleWorkers: data.workerStatus.idleWorkers,
          pendingTasks: data.workerStatus.pendingTasks,
          runningTasks: data.workerStatus.runningTasks,
          lastUpdated: Date.now(),
        };
        logger.debug`WebSocketRemoteProxy ${this.uuid} updated remote status: total=${data.workerStatus.totalWorkers} busy=${data.workerStatus.busyWorkers}`;
      }

      if ('alive' in data) {
        logger.debug`WebSocketRemoteProxy ${this.uuid} received alive ping`;
        return
      }

      this.socket.removeEventListener('message', handleMessage);
      this.busy = false;

      if ('error' in data) {
        logger.debug`WebSocketRemoteProxy ${this.uuid} execute() error: ${data.error}`;
        request.reject(new Error(data.error));
      }
      else if ('result' in data) {
        logger.debug`WebSocketRemoteProxy ${this.uuid} execute() success`;
        request.resolve(data.result);
      } else {
        logger.debug`WebSocketRemoteProxy ${this.uuid} execute() unknown response`;
        request.reject(new Error('Unknown response from worker'));
      }
    };

    this.socket.addEventListener('message', handleMessage);
    // Include the client's UUID so the server can echo it back
    const requestWithUuid = { ...request.request, clientUuid: this.uuid };
    logger.debug`WebSocketRemoteProxy ${this.uuid} sending request to socket`;
    this.socket.send(JSON.stringify(requestWithUuid));
  }

  close(): void {
    logger.debug`WebSocketRemoteProxy ${this.uuid} closing`;
    this.socket.close();
  }
}

export class WebSocketHost {
  private pool: WorkerPool;
  proxies: Array<WebSocketLocalProxy>;

  constructor(pool: WorkerPool, public server: Deno.HttpServer) {
    this.pool = pool;
    this.proxies = [];
    logger.debug`WebSocketHost constructed with pool ${pool.uuid}`;
  }

  static async create(
    count: number,
    options: Deno.ServeTcpOptions
  ): Promise<WebSocketHost> {
    logger.debug`WebSocketHost.create() starting with count=${count}`;
    const pool = await WorkerPool.create(count);
    const host = new WebSocketHost(
      pool,
      Deno.serve(options, (req: Request) => {
        logger.debug`WebSocketHost received connection request`;
        const { socket, response } = Deno.upgradeWebSocket(req);
        logger.debug`WebSocketHost upgraded to WebSocket, creating proxy`;
        host.proxies.push(new WebSocketLocalProxy(socket, pool));
        logger.debug`WebSocketHost now has ${host.proxies.length} proxies`;
        return response;
      })
    );
    logger.debug`WebSocketHost.create() complete`;
    return host
  }
}
