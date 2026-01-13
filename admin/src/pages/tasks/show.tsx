import { useShow } from "@refinedev/core";
import { Show } from "@refinedev/antd";
import { Typography, Tag, Descriptions, Card } from "antd";
import {
  HourglassOutlined,
  SyncOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
} from "@ant-design/icons";

const { Title, Text } = Typography;

type TaskStatus = "pending" | "running" | "completed" | "failed";

interface Task {
  id: string;
  request: unknown;
  status: TaskStatus;
  queuedAt: number;
  startedAt: number | null;
  completedAt: number | null;
  workerId: string | null;
  result: unknown;
  error: string | null;
}

const statusConfig: Record<TaskStatus, { color: string; icon: React.ReactNode }> = {
  pending: { color: "orange", icon: <HourglassOutlined /> },
  running: { color: "blue", icon: <SyncOutlined spin /> },
  completed: { color: "green", icon: <CheckCircleOutlined /> },
  failed: { color: "red", icon: <CloseCircleOutlined /> },
};

function formatDate(timestamp: number | null): string {
  if (!timestamp) return "-";
  return new Date(timestamp).toLocaleString();
}

function formatDuration(start: number | null, end: number | null): string {
  if (!start || !end) return "-";
  const durationMs = end - start;
  if (durationMs < 1000) return `${durationMs}ms`;
  if (durationMs < 60000) return `${(durationMs / 1000).toFixed(2)}s`;
  return `${(durationMs / 60000).toFixed(2)}m`;
}

export const TaskShow = () => {
  const { query } = useShow<Task>();
  const { data, isLoading } = query;
  const task = data?.data;

  const config = task ? statusConfig[task.status] : null;

  return (
    <Show isLoading={isLoading}>
      <Title level={5}>Task Details</Title>
      <Descriptions bordered column={1}>
        <Descriptions.Item label="ID">
          <code>{task?.id}</code>
        </Descriptions.Item>
        <Descriptions.Item label="Status">
          {config && (
            <Tag icon={config.icon} color={config.color}>
              {task?.status?.toUpperCase()}
            </Tag>
          )}
        </Descriptions.Item>
        <Descriptions.Item label="Worker ID">
          {task?.workerId ? <code>{task.workerId}</code> : "-"}
        </Descriptions.Item>
        <Descriptions.Item label="Queued At">
          {formatDate(task?.queuedAt ?? null)}
        </Descriptions.Item>
        <Descriptions.Item label="Started At">
          {formatDate(task?.startedAt ?? null)}
        </Descriptions.Item>
        <Descriptions.Item label="Completed At">
          {formatDate(task?.completedAt ?? null)}
        </Descriptions.Item>
        <Descriptions.Item label="Duration">
          {formatDuration(task?.startedAt ?? null, task?.completedAt ?? null)}
        </Descriptions.Item>
      </Descriptions>

      {task?.error && (
        <Card
          title={<Text type="danger">Error</Text>}
          style={{ marginTop: 24 }}
          size="small"
        >
          <pre style={{ margin: 0, whiteSpace: "pre-wrap", color: "#ff4d4f" }}>
            {task.error}
          </pre>
        </Card>
      )}

      {task?.request && (
        <Card title="Request" style={{ marginTop: 24 }} size="small">
          <pre style={{ margin: 0, whiteSpace: "pre-wrap", fontSize: 12, maxHeight: 300, overflow: "auto" }}>
            {JSON.stringify(task.request, null, 2)}
          </pre>
        </Card>
      )}

      {task?.result && (
        <Card title="Result" style={{ marginTop: 24 }} size="small">
          <pre style={{ margin: 0, whiteSpace: "pre-wrap", fontSize: 12, maxHeight: 300, overflow: "auto" }}>
            {JSON.stringify(task.result, null, 2)}
          </pre>
        </Card>
      )}
    </Show>
  );
};
