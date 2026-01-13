import { useList } from "@refinedev/core";
import { List, ShowButton } from "@refinedev/antd";
import { Table, Tag, Space, Card, Row, Col, Statistic, Select } from "antd";
import {
  HourglassOutlined,
  SyncOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
} from "@ant-design/icons";
import { useState } from "react";

type TaskStatus = "pending" | "running" | "completed" | "failed";

interface Task {
  id: string;
  status: TaskStatus;
  queuedAt: number;
  startedAt: number | null;
  completedAt: number | null;
  workerId: string | null;
  error: string | null;
}

interface TaskSummary {
  total: number;
  pending: number;
  running: number;
  completed: number;
  failed: number;
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

export const TaskList = () => {
  const [statusFilter, setStatusFilter] = useState<TaskStatus[]>([]);
  const [pagination, setPagination] = useState({ current: 1, pageSize: 20 });

  const { data, isLoading } = useList<Task>({
    resource: "tasks",
    pagination: {
      current: pagination.current,
      pageSize: pagination.pageSize,
    },
    filters: statusFilter.length > 0
      ? [{ field: "status", operator: "in", value: statusFilter }]
      : [],
  });

  const tasks = data?.data || [];
  const total = data?.total || 0;

  // Calculate summary from visible data
  const summary: TaskSummary = {
    total,
    pending: tasks.filter((t) => t.status === "pending").length,
    running: tasks.filter((t) => t.status === "running").length,
    completed: tasks.filter((t) => t.status === "completed").length,
    failed: tasks.filter((t) => t.status === "failed").length,
  };

  return (
    <List>
      {/* Summary Cards */}
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col xs={12} sm={8} md={4}>
          <Card size="small">
            <Statistic title="Total" value={summary.total} />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={4}>
          <Card size="small">
            <Statistic
              title="Pending"
              value={summary.pending}
              prefix={<HourglassOutlined />}
              valueStyle={{ color: "#fa8c16" }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={4}>
          <Card size="small">
            <Statistic
              title="Running"
              value={summary.running}
              prefix={<SyncOutlined />}
              valueStyle={{ color: "#1890ff" }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={4}>
          <Card size="small">
            <Statistic
              title="Completed"
              value={summary.completed}
              prefix={<CheckCircleOutlined />}
              valueStyle={{ color: "#52c41a" }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={4}>
          <Card size="small">
            <Statistic
              title="Failed"
              value={summary.failed}
              prefix={<CloseCircleOutlined />}
              valueStyle={{ color: "#ff4d4f" }}
            />
          </Card>
        </Col>
      </Row>

      {/* Filter */}
      <div style={{ marginBottom: 16 }}>
        <span style={{ marginRight: 8 }}>Filter by status:</span>
        <Select
          mode="multiple"
          placeholder="All statuses"
          style={{ width: 300 }}
          value={statusFilter}
          onChange={setStatusFilter}
          options={[
            { label: "Pending", value: "pending" },
            { label: "Running", value: "running" },
            { label: "Completed", value: "completed" },
            { label: "Failed", value: "failed" },
          ]}
          allowClear
        />
      </div>

      {/* Tasks Table */}
      <Table
        dataSource={tasks}
        rowKey="id"
        loading={isLoading}
        pagination={{
          current: pagination.current,
          pageSize: pagination.pageSize,
          total,
          showSizeChanger: true,
          pageSizeOptions: ["10", "20", "50", "100"],
          onChange: (page, pageSize) => {
            setPagination({ current: page, pageSize });
          },
        }}
      >
        <Table.Column
          title="ID"
          dataIndex="id"
          render={(id: string) => (
            <code style={{ fontSize: 12 }}>{id.slice(0, 8)}...</code>
          )}
        />
        <Table.Column
          title="Status"
          dataIndex="status"
          render={(status: TaskStatus) => {
            const config = statusConfig[status];
            return (
              <Tag icon={config.icon} color={config.color}>
                {status.toUpperCase()}
              </Tag>
            );
          }}
        />
        <Table.Column
          title="Queued At"
          dataIndex="queuedAt"
          render={formatDate}
          sorter={(a: Task, b: Task) => a.queuedAt - b.queuedAt}
          defaultSortOrder="descend"
        />
        <Table.Column
          title="Started At"
          dataIndex="startedAt"
          render={formatDate}
        />
        <Table.Column
          title="Completed At"
          dataIndex="completedAt"
          render={formatDate}
        />
        <Table.Column
          title="Worker"
          dataIndex="workerId"
          render={(workerId: string | null) =>
            workerId ? <code style={{ fontSize: 11 }}>{workerId.slice(0, 8)}...</code> : "-"
          }
        />
        <Table.Column
          title="Error"
          dataIndex="error"
          render={(error: string | null) =>
            error ? (
              <Tag color="red" style={{ maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis" }}>
                {error}
              </Tag>
            ) : (
              "-"
            )
          }
        />
        <Table.Column
          title="Actions"
          render={(_, record: Task) => (
            <Space>
              <ShowButton hideText size="small" recordItemId={record.id} />
            </Space>
          )}
        />
      </Table>
    </List>
  );
};
