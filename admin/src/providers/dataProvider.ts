import type { DataProvider } from "@refinedev/core";
import { Client, fetchExchange } from "@urql/core";
import gql from "graphql-tag";

// GraphQL Queries
const QUERIES = {
  // Workers
  workers: gql`
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
          busy
          idle
        }
      }
    }
  `,
  worker: gql`
    query GetWorker($id: ID!) {
      worker(id: $id) {
        id
        type
        busy
        host
      }
    }
  `,

  // Peers
  peers: gql`
    query GetPeers {
      peers {
        peers {
          id
          wsUrl
          connectedAt
        }
      }
    }
  `,

  // Tasks
  tasks: gql`
    query GetTasks($status: [TaskStatus!], $limit: Int, $offset: Int) {
      tasks(status: $status, limit: $limit, offset: $offset) {
        tasks {
          id
          status
          queuedAt
          startedAt
          completedAt
          workerId
          error
        }
        summary {
          total
          pending
          running
          completed
          failed
        }
      }
    }
  `,
  task: gql`
    query GetTask($id: ID!) {
      task(id: $id) {
        id
        request
        status
        queuedAt
        startedAt
        completedAt
        workerId
        result
        error
      }
    }
  `,

  // Ingests
  ingests: gql`
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
  `,
  ingest: gql`
    query GetIngest($id: ID!) {
      ingest(id: $id) {
        id
        root
        status
        processors
        totalFiles
        processedFiles
        totalBytes
        processedBytes
        startedAt
        completedAt
        errors {
          path
          error
          timestamp
        }
      }
    }
  `,

  // Dashboard
  dashboard: gql`
    query GetDashboard {
      health {
        status
      }
      status {
        id
        version
        wsUrl
        uptime
        startTime
      }
      metrics {
        instance {
          uptimeMs
          startTime
        }
        workers {
          total
          local
          remote
          busy
          idle
        }
        tasks {
          pending
          running
          completed
          failed
          avgDurationMs
          throughputPerSec
        }
        resources {
          memoryUsedBytes
          heapUsedBytes
          heapTotalBytes
        }
        queue {
          depth
          avgWaitTimeMs
        }
      }
    }
  `,
};

// GraphQL Mutations
const MUTATIONS = {
  disconnectWorker: gql`
    mutation DisconnectWorker($id: ID!) {
      disconnectWorker(id: $id) {
        success
        error
      }
    }
  `,
  connectPeer: gql`
    mutation ConnectPeer($wsUrl: String!) {
      connectPeer(wsUrl: $wsUrl) {
        success
        peer {
          id
          wsUrl
          connectedAt
        }
        error
      }
    }
  `,
  disconnectPeer: gql`
    mutation DisconnectPeer($id: ID!) {
      disconnectPeer(id: $id) {
        success
        error
      }
    }
  `,
  startIngest: gql`
    mutation StartIngest($root: String!, $processors: [String!]) {
      startIngest(root: $root, processors: $processors) {
        success
        ingest {
          id
          root
          status
          processors
          totalFiles
          processedFiles
        }
        error
      }
    }
  `,
  cancelIngest: gql`
    mutation CancelIngest($id: ID!) {
      cancelIngest(id: $id) {
        success
        error
      }
    }
  `,
};

export const dataProvider = (apiUrl: string): DataProvider => {
  const client = new Client({
    url: apiUrl,
    exchanges: [fetchExchange],
  });

  return {
    getList: async ({ resource, pagination, filters }) => {
      const query = QUERIES[resource as keyof typeof QUERIES];
      if (!query) {
        throw new Error(`No query defined for resource: ${resource}`);
      }

      // Build variables for tasks (supports pagination and filtering)
      const variables: Record<string, unknown> = {};
      if (resource === "tasks") {
        if (pagination) {
          variables.limit = pagination.pageSize || 10;
          variables.offset = ((pagination.current || 1) - 1) * (pagination.pageSize || 10);
        }
        if (filters) {
          const statusFilter = filters.find((f) => "field" in f && f.field === "status");
          if (statusFilter && "value" in statusFilter && statusFilter.value) {
            variables.status = Array.isArray(statusFilter.value)
              ? statusFilter.value
              : [statusFilter.value];
          }
        }
      }

      const result = await client.query(query, variables).toPromise();

      if (result.error) {
        throw new Error(result.error.message);
      }

      // Map response based on resource
      let data: unknown[] = [];
      let total = 0;

      switch (resource) {
        case "workers":
          data = result.data?.workers?.workers || [];
          total = result.data?.workers?.summary?.total || data.length;
          break;
        case "peers":
          data = result.data?.peers?.peers || [];
          total = data.length;
          break;
        case "tasks":
          data = result.data?.tasks?.tasks || [];
          total = result.data?.tasks?.summary?.total || data.length;
          break;
        case "ingests":
          data = result.data?.ingests?.ingests || [];
          total = result.data?.ingests?.total || data.length;
          break;
        case "dashboard":
          // Special case: return the whole response as a single item
          data = [result.data];
          total = 1;
          break;
        default:
          data = [];
          total = 0;
      }

      return {
        data: data as never[],
        total,
      };
    },

    getOne: async ({ resource, id }) => {
      const queryKey = resource.replace(/s$/, "") as keyof typeof QUERIES;
      const query = QUERIES[queryKey];

      if (!query) {
        throw new Error(`No query defined for resource: ${resource}`);
      }

      const result = await client.query(query, { id }).toPromise();

      if (result.error) {
        throw new Error(result.error.message);
      }

      const data = result.data?.[queryKey];
      if (!data) {
        throw new Error(`${resource} not found`);
      }

      return { data };
    },

    create: async ({ resource, variables }) => {
      let mutation;
      let resultKey: string;
      let mutationVariables: Record<string, unknown>;

      switch (resource) {
        case "peers":
          mutation = MUTATIONS.connectPeer;
          resultKey = "connectPeer";
          mutationVariables = { wsUrl: (variables as { wsUrl: string }).wsUrl };
          break;
        case "ingests":
          mutation = MUTATIONS.startIngest;
          resultKey = "startIngest";
          mutationVariables = {
            root: (variables as { root: string; processors?: string[] }).root,
            processors: (variables as { root: string; processors?: string[] }).processors,
          };
          break;
        default:
          throw new Error(`Create not supported for resource: ${resource}`);
      }

      const result = await client.mutation(mutation, mutationVariables).toPromise();

      if (result.error) {
        throw new Error(result.error.message);
      }

      const response = result.data?.[resultKey];
      if (!response?.success) {
        throw new Error(response?.error || "Operation failed");
      }

      // Return the created entity
      const data = response.peer || response.ingest || { id: "created" };
      return { data };
    },

    deleteOne: async ({ resource, id }) => {
      let mutation;
      let resultKey: string;

      switch (resource) {
        case "workers":
          mutation = MUTATIONS.disconnectWorker;
          resultKey = "disconnectWorker";
          break;
        case "peers":
          mutation = MUTATIONS.disconnectPeer;
          resultKey = "disconnectPeer";
          break;
        case "ingests":
          mutation = MUTATIONS.cancelIngest;
          resultKey = "cancelIngest";
          break;
        default:
          throw new Error(`Delete not supported for resource: ${resource}`);
      }

      const result = await client.mutation(mutation, { id }).toPromise();

      if (result.error) {
        throw new Error(result.error.message);
      }

      const response = result.data?.[resultKey];
      if (!response?.success) {
        throw new Error(response?.error || "Operation failed");
      }

      return { data: { id } as never };
    },

    update: async () => {
      throw new Error("Update not supported by this API");
    },

    getMany: async ({ resource, ids }) => {
      // Fetch each item individually
      const results = await Promise.all(
        ids.map((id) =>
          client
            .query(QUERIES[resource.replace(/s$/, "") as keyof typeof QUERIES], { id })
            .toPromise()
        )
      );

      const data = results
        .filter((r) => !r.error && r.data)
        .map((r) => r.data?.[resource.replace(/s$/, "")]);

      return { data: data as never[] };
    },

    createMany: async () => {
      throw new Error("CreateMany not supported by this API");
    },

    deleteMany: async ({ resource, ids }) => {
      // Delete each item individually
      await Promise.all(
        ids.map((id) =>
          dataProvider(apiUrl).deleteOne({ resource, id })
        )
      );

      return { data: ids.map((id) => ({ id })) as never[] };
    },

    updateMany: async () => {
      throw new Error("UpdateMany not supported by this API");
    },

    custom: async ({ url, method, payload }) => {
      if (method === "get") {
        const query = payload?.query;
        const variables = payload?.variables;
        const result = await client.query(query, variables).toPromise();
        return { data: result.data };
      }
      throw new Error("Custom method not supported");
    },

    getApiUrl: () => apiUrl,
  };
};
