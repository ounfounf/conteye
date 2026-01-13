import type { Instance } from "~/core/instance.ts";
import type { WorkerInfo } from "~/work/worker_pool.ts";

export interface WorkersResponse {
  workers: WorkerInfo[];
  summary: {
    total: number;
    local: number;
    remote: number;
    busy: number;
    idle: number;
  };
}

export interface ConnectWorkerRequest {
  wsUrl: string;
}

export interface ConnectWorkerResponse {
  success: boolean;
  peerId?: string;
  error?: string;
}

export interface DisconnectWorkerResponse {
  success: boolean;
  error?: string;
}

export function handleGetWorkers(instance: Instance): Response {
  const workers = instance.pool.getWorkerInfo();
  const summary = instance.pool.getWorkerCount();

  const response: WorkersResponse = {
    workers,
    summary,
  };

  return Response.json(response);
}

export function handleGetWorker(instance: Instance, workerId: string): Response {
  const workers = instance.pool.getWorkerInfo();
  const worker = workers.find(w => w.id === workerId);

  if (!worker) {
    return Response.json({ error: "Worker not found" }, { status: 404 });
  }

  return Response.json(worker);
}

export async function handleConnectRemoteWorker(
  instance: Instance,
  request: Request
): Promise<Response> {
  try {
    const body = await request.json() as ConnectWorkerRequest;

    if (!body.wsUrl) {
      return Response.json(
        { success: false, error: "wsUrl is required" },
        { status: 400 }
      );
    }

    // Validate URL format
    try {
      const url = new URL(body.wsUrl);
      if (url.protocol !== 'ws:' && url.protocol !== 'wss:') {
        return Response.json(
          { success: false, error: "Invalid wsUrl format" },
          { status: 400 }
        );
      }
    } catch {
      return Response.json(
        { success: false, error: "Invalid wsUrl format" },
        { status: 400 }
      );
    }

    const peer = await instance.connectToPeer(body.wsUrl);

    const response: ConnectWorkerResponse = {
      success: true,
      peerId: peer.id,
    };

    return Response.json(response, { status: 201 });
  } catch (error) {
    const response: ConnectWorkerResponse = {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
    return Response.json(response, { status: 500 });
  }
}

export function handleDisconnectWorker(
  instance: Instance,
  workerId: string
): Response {
  const success = instance.pool.disconnectWorker(workerId);

  if (!success) {
    return Response.json(
      { success: false, error: "Worker not found or cannot be disconnected (local workers cannot be disconnected)" },
      { status: 404 }
    );
  }

  const response: DisconnectWorkerResponse = { success: true };
  return Response.json(response);
}

// Peer management

export interface PeersResponse {
  peers: Array<{
    id: string;
    wsUrl: string;
    connectedAt: number;
  }>;
}

export function handleGetPeers(instance: Instance): Response {
  const peers = instance.getPeers();
  const response: PeersResponse = { peers };
  return Response.json(response);
}

export async function handleConnectPeer(
  instance: Instance,
  request: Request
): Promise<Response> {
  try {
    const body = await request.json() as { wsUrl: string };

    if (!body.wsUrl) {
      return Response.json(
        { success: false, error: "wsUrl is required" },
        { status: 400 }
      );
    }

    // Validate URL format
    try {
      const url = new URL(body.wsUrl);
      if (url.protocol !== 'ws:' && url.protocol !== 'wss:') {
        return Response.json(
          { success: false, error: "Invalid wsUrl format" },
          { status: 400 }
        );
      }
    } catch {
      return Response.json(
        { success: false, error: "Invalid wsUrl format" },
        { status: 400 }
      );
    }

    const peer = await instance.connectToPeer(body.wsUrl);
    return Response.json({ success: true, peer }, { status: 201 });
  } catch (error) {
    return Response.json(
      { success: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

export function handleDisconnectPeer(
  instance: Instance,
  peerId: string
): Response {
  const success = instance.disconnectPeer(peerId);

  if (!success) {
    return Response.json(
      { success: false, error: "Peer not found" },
      { status: 404 }
    );
  }

  return Response.json({ success: true });
}
