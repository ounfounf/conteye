import { useShow, useDelete, useNavigation } from "@refinedev/core";
import { Show } from "@refinedev/antd";
import { Typography, Tag, Descriptions, Progress, Card, Table, Button, Popconfirm } from "antd";
import {
  ClockCircleOutlined,
  SyncOutlined,
  LoadingOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  StopOutlined,
} from "@ant-design/icons";

const { Title, Text } = Typography;

type IngestStatus = "queued" | "scanning" | "processing" | "completed" | "cancelled" | "failed";

interface IngestError {
  path: string;
  error: string;
  timestamp: number;
}

interface IngestJob {
  id: string;
  root: string;
  status: IngestStatus;
  processors: string[];
  totalFiles: number;
  processedFiles: number;
  totalBytes: number;
  processedBytes: number;
  startedAt: number | null;
  completedAt: number | null;
  errors: IngestError[];
}

const statusConfig: Record<IngestStatus, { color: string; icon: React.ReactNode }> = {
  queued: { color: "default", icon: <ClockCircleOutlined /> },
  scanning: { color: "processing", icon: <SyncOutlined spin /> },
  processing: { color: "processing", icon: <LoadingOutlined /> },
  completed: { color: "success", icon: <CheckCircleOutlined /> },
  cancelled: { color: "warning", icon: <StopOutlined /> },
  failed: { color: "error", icon: <CloseCircleOutlined /> },
};

function formatDate(timestamp: number | null): string {
  if (!timestamp) return "-";
  return new Date(timestamp).toLocaleString();
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDuration(start: number | null, end: number | null): string {
  if (!start) return "-";
  const endTime = end || Date.now();
  const durationMs = endTime - start;
  if (durationMs < 1000) return `${durationMs}ms`;
  if (durationMs < 60000) return `${(durationMs / 1000).toFixed(1)}s`;
  if (durationMs < 3600000) return `${(durationMs / 60000).toFixed(1)}m`;
  return `${(durationMs / 3600000).toFixed(1)}h`;
}

export const IngestShow = () => {
  const { query } = useShow<IngestJob>();
  const { data, isLoading } = query;
  const { mutate: deleteIngest, isLoading: isCancelling } = useDelete();
  const { list } = useNavigation();

  const ingest = data?.data;
  const config = ingest ? statusConfig[ingest.status] : null;

  const isActive =
    ingest?.status === "queued" ||
    ingest?.status === "scanning" ||
    ingest?.status === "processing";

  const progress =
    ingest && ingest.totalFiles > 0
      ? Math.round((ingest.processedFiles / ingest.totalFiles) * 100)
      : 0;

  const handleCancel = () => {
    if (!ingest) return;
    deleteIngest(
      { resource: "ingests", id: ingest.id },
      {
        onSuccess: () => {
          list("ingests");
        },
      }
    );
  };

  return (
    <Show
      isLoading={isLoading}
      headerButtons={
        isActive ? (
          <Popconfirm
            title="Cancel this ingest job?"
            onConfirm={handleCancel}
            okText="Cancel Ingest"
            cancelText="No"
          >
            <Button danger loading={isCancelling}>
              Cancel Ingest
            </Button>
          </Popconfirm>
        ) : undefined
      }
    >
      <Title level={5}>Ingest Job Details</Title>
      <Descriptions bordered column={1}>
        <Descriptions.Item label="ID">
          <code>{ingest?.id}</code>
        </Descriptions.Item>
        <Descriptions.Item label="Root Path">
          <code>{ingest?.root}</code>
        </Descriptions.Item>
        <Descriptions.Item label="Status">
          {config && (
            <Tag icon={config.icon} color={config.color}>
              {ingest?.status?.toUpperCase()}
            </Tag>
          )}
        </Descriptions.Item>
        <Descriptions.Item label="Processors">
          {ingest?.processors?.map((p) => (
            <Tag key={p}>{p}</Tag>
          )) || "-"}
        </Descriptions.Item>
        <Descriptions.Item label="Progress">
          <div style={{ width: 300 }}>
            <Progress
              percent={progress}
              status={
                ingest?.status === "failed"
                  ? "exception"
                  : ingest?.status === "completed"
                  ? "success"
                  : "active"
              }
            />
          </div>
        </Descriptions.Item>
        <Descriptions.Item label="Files">
          {ingest?.processedFiles?.toLocaleString()} / {ingest?.totalFiles?.toLocaleString()}
        </Descriptions.Item>
        <Descriptions.Item label="Data Processed">
          {formatBytes(ingest?.processedBytes || 0)} / {formatBytes(ingest?.totalBytes || 0)}
        </Descriptions.Item>
        <Descriptions.Item label="Started At">
          {formatDate(ingest?.startedAt ?? null)}
        </Descriptions.Item>
        <Descriptions.Item label="Completed At">
          {formatDate(ingest?.completedAt ?? null)}
        </Descriptions.Item>
        <Descriptions.Item label="Duration">
          {formatDuration(ingest?.startedAt ?? null, ingest?.completedAt ?? null)}
        </Descriptions.Item>
      </Descriptions>

      {/* Errors */}
      {ingest?.errors && ingest.errors.length > 0 && (
        <Card
          title={<Text type="danger">Errors ({ingest.errors.length})</Text>}
          style={{ marginTop: 24 }}
          size="small"
        >
          <Table
            dataSource={ingest.errors}
            rowKey={(record) => `${record.path}-${record.timestamp}`}
            size="small"
            pagination={{ pageSize: 10 }}
          >
            <Table.Column
              title="Path"
              dataIndex="path"
              render={(path: string) => (
                <code style={{ fontSize: 11, wordBreak: "break-all" }}>{path}</code>
              )}
            />
            <Table.Column
              title="Error"
              dataIndex="error"
              render={(error: string) => (
                <Text type="danger" style={{ fontSize: 12 }}>
                  {error}
                </Text>
              )}
            />
            <Table.Column
              title="Time"
              dataIndex="timestamp"
              render={(timestamp: number) => formatDate(timestamp)}
              width={180}
            />
          </Table>
        </Card>
      )}
    </Show>
  );
};
