import { useList, useDelete } from "@refinedev/core";
import { List, ShowButton, CreateButton, DeleteButton } from "@refinedev/antd";
import { Table, Tag, Progress, Space, Card, Row, Col, Statistic, Tooltip } from "antd";
import {
  FolderOpenOutlined,
  LoadingOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  StopOutlined,
  ClockCircleOutlined,
  SyncOutlined,
} from "@ant-design/icons";

type IngestStatus = "queued" | "scanning" | "processing" | "completed" | "cancelled" | "failed";

interface IngestJob {
  id: string;
  root: string;
  status: IngestStatus;
  progress: number;
  processedFiles: number;
  totalFiles: number;
}

const statusConfig: Record<IngestStatus, { color: string; icon: React.ReactNode }> = {
  queued: { color: "default", icon: <ClockCircleOutlined /> },
  scanning: { color: "processing", icon: <SyncOutlined spin /> },
  processing: { color: "processing", icon: <LoadingOutlined /> },
  completed: { color: "success", icon: <CheckCircleOutlined /> },
  cancelled: { color: "warning", icon: <StopOutlined /> },
  failed: { color: "error", icon: <CloseCircleOutlined /> },
};

export const IngestList = () => {
  const { data, isLoading } = useList<IngestJob>({
    resource: "ingests",
  });

  const ingests = data?.data || [];

  // Calculate summary
  const activeIngests = ingests.filter(
    (i) => i.status === "queued" || i.status === "scanning" || i.status === "processing"
  ).length;

  return (
    <List
      headerButtons={
        <CreateButton>Start Ingest</CreateButton>
      }
    >
      {/* Summary Cards */}
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col xs={12} sm={8} md={6}>
          <Card size="small">
            <Statistic
              title="Total"
              value={ingests.length}
              prefix={<FolderOpenOutlined />}
            />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={6}>
          <Card size="small">
            <Statistic
              title="Active"
              value={activeIngests}
              prefix={<LoadingOutlined />}
              valueStyle={{ color: "#1890ff" }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={6}>
          <Card size="small">
            <Statistic
              title="Completed"
              value={ingests.filter((i) => i.status === "completed").length}
              prefix={<CheckCircleOutlined />}
              valueStyle={{ color: "#52c41a" }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={6}>
          <Card size="small">
            <Statistic
              title="Failed"
              value={ingests.filter((i) => i.status === "failed").length}
              prefix={<CloseCircleOutlined />}
              valueStyle={{ color: "#ff4d4f" }}
            />
          </Card>
        </Col>
      </Row>

      {/* Ingests Table */}
      <Table dataSource={ingests} rowKey="id" loading={isLoading}>
        <Table.Column
          title="ID"
          dataIndex="id"
          render={(id: string) => (
            <code style={{ fontSize: 12 }}>{id.slice(0, 8)}...</code>
          )}
        />
        <Table.Column
          title="Root Path"
          dataIndex="root"
          render={(root: string) => (
            <Tooltip title={root}>
              <code style={{ fontSize: 12 }}>
                {root.length > 40 ? `...${root.slice(-37)}` : root}
              </code>
            </Tooltip>
          )}
        />
        <Table.Column
          title="Status"
          dataIndex="status"
          render={(status: IngestStatus) => {
            const config = statusConfig[status];
            return (
              <Tag icon={config.icon} color={config.color}>
                {status.toUpperCase()}
              </Tag>
            );
          }}
          filters={[
            { text: "Queued", value: "queued" },
            { text: "Scanning", value: "scanning" },
            { text: "Processing", value: "processing" },
            { text: "Completed", value: "completed" },
            { text: "Cancelled", value: "cancelled" },
            { text: "Failed", value: "failed" },
          ]}
          onFilter={(value, record: IngestJob) => record.status === value}
        />
        <Table.Column
          title="Progress"
          dataIndex="progress"
          render={(progress: number, record: IngestJob) => (
            <div style={{ width: 120 }}>
              <Progress
                percent={progress}
                size="small"
                status={
                  record.status === "failed"
                    ? "exception"
                    : record.status === "completed"
                    ? "success"
                    : "active"
                }
              />
            </div>
          )}
        />
        <Table.Column
          title="Files"
          render={(_, record: IngestJob) => (
            <span>
              {record.processedFiles.toLocaleString()} / {record.totalFiles.toLocaleString()}
            </span>
          )}
        />
        <Table.Column
          title="Actions"
          render={(_, record: IngestJob) => (
            <Space>
              <ShowButton hideText size="small" recordItemId={record.id} />
              {(record.status === "queued" ||
                record.status === "scanning" ||
                record.status === "processing") && (
                <DeleteButton
                  hideText
                  size="small"
                  recordItemId={record.id}
                  confirmTitle="Cancel this ingest job?"
                  confirmOkText="Cancel"
                />
              )}
            </Space>
          )}
        />
      </Table>
    </List>
  );
};
