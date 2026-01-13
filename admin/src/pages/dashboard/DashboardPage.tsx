import { useCustom } from "@refinedev/core";
import { Row, Col, Card, Statistic, Typography, Tag, Space, Spin } from "antd";
import {
  CheckCircleOutlined,
  CloudServerOutlined,
  UnorderedListOutlined,
  HourglassOutlined,
  SyncOutlined,
  CheckOutlined,
  CloseCircleOutlined,
  DatabaseOutlined,
} from "@ant-design/icons";
import gql from "graphql-tag";

const { Title, Text } = Typography;

const DASHBOARD_QUERY = gql`
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
`;

interface DashboardData {
  health: { status: string };
  status: {
    id: string;
    version: string;
    wsUrl: string;
    uptime: number;
    startTime: number;
  };
  metrics: {
    instance: { uptimeMs: number; startTime: number };
    workers: { total: number; local: number; remote: number; busy: number; idle: number };
    tasks: {
      pending: number;
      running: number;
      completed: number;
      failed: number;
      avgDurationMs: number;
      throughputPerSec: number;
    };
    resources: { memoryUsedBytes: number; heapUsedBytes: number; heapTotalBytes: number };
    queue: { depth: number; avgWaitTimeMs: number };
  };
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export const DashboardPage = () => {
  const { data, isLoading } = useCustom<DashboardData>({
    url: "",
    method: "get",
    config: {
      payload: {
        query: DASHBOARD_QUERY,
      },
    },
    queryOptions: {
      refetchInterval: 5000, // Refresh every 5 seconds
    },
  });

  if (isLoading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: 400 }}>
        <Spin size="large" />
      </div>
    );
  }

  const dashboard = data?.data;
  const health = dashboard?.health;
  const status = dashboard?.status;
  const metrics = dashboard?.metrics;

  return (
    <div style={{ padding: 24 }}>
      {/* Header */}
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col span={24}>
          <Card>
            <Space size="large" align="center">
              <div>
                <Title level={4} style={{ margin: 0 }}>ConTeye Instance</Title>
                <Text type="secondary">{status?.id}</Text>
              </div>
              <Tag
                icon={health?.status === "healthy" ? <CheckCircleOutlined /> : <CloseCircleOutlined />}
                color={health?.status === "healthy" ? "success" : "error"}
              >
                {health?.status?.toUpperCase()}
              </Tag>
              <Statistic title="Version" value={status?.version || "-"} />
              <Statistic title="Uptime" value={formatUptime((status?.uptime || 0) / 1000)} />
              <div>
                <Text type="secondary">WebSocket URL</Text>
                <br />
                <Text code>{status?.wsUrl}</Text>
              </div>
            </Space>
          </Card>
        </Col>
      </Row>

      {/* Workers */}
      <Title level={5}>
        <CloudServerOutlined /> Workers
      </Title>
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col xs={12} sm={8} md={4}>
          <Card>
            <Statistic title="Total" value={metrics?.workers?.total || 0} />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={4}>
          <Card>
            <Statistic
              title="Local"
              value={metrics?.workers?.local || 0}
              valueStyle={{ color: "#1890ff" }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={4}>
          <Card>
            <Statistic
              title="Remote"
              value={metrics?.workers?.remote || 0}
              valueStyle={{ color: "#722ed1" }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={4}>
          <Card>
            <Statistic
              title="Busy"
              value={metrics?.workers?.busy || 0}
              prefix={<SyncOutlined spin={metrics?.workers?.busy ? true : false} />}
              valueStyle={{ color: "#fa8c16" }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={4}>
          <Card>
            <Statistic
              title="Idle"
              value={metrics?.workers?.idle || 0}
              valueStyle={{ color: "#52c41a" }}
            />
          </Card>
        </Col>
      </Row>

      {/* Tasks */}
      <Title level={5}>
        <UnorderedListOutlined /> Tasks
      </Title>
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col xs={12} sm={8} md={4}>
          <Card>
            <Statistic
              title="Pending"
              value={metrics?.tasks?.pending || 0}
              prefix={<HourglassOutlined />}
              valueStyle={{ color: "#fa8c16" }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={4}>
          <Card>
            <Statistic
              title="Running"
              value={metrics?.tasks?.running || 0}
              prefix={<SyncOutlined spin={metrics?.tasks?.running ? true : false} />}
              valueStyle={{ color: "#1890ff" }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={4}>
          <Card>
            <Statistic
              title="Completed"
              value={metrics?.tasks?.completed || 0}
              prefix={<CheckOutlined />}
              valueStyle={{ color: "#52c41a" }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={4}>
          <Card>
            <Statistic
              title="Failed"
              value={metrics?.tasks?.failed || 0}
              prefix={<CloseCircleOutlined />}
              valueStyle={{ color: "#ff4d4f" }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={4}>
          <Card>
            <Statistic
              title="Avg Duration"
              value={(metrics?.tasks?.avgDurationMs || 0).toFixed(1)}
              suffix="ms"
            />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={4}>
          <Card>
            <Statistic
              title="Throughput"
              value={(metrics?.tasks?.throughputPerSec || 0).toFixed(2)}
              suffix="/sec"
            />
          </Card>
        </Col>
      </Row>

      {/* Queue & Resources */}
      <Row gutter={[16, 16]}>
        <Col xs={24} md={12}>
          <Title level={5}>
            <UnorderedListOutlined /> Queue
          </Title>
          <Row gutter={[16, 16]}>
            <Col span={12}>
              <Card>
                <Statistic title="Depth" value={metrics?.queue?.depth || 0} />
              </Card>
            </Col>
            <Col span={12}>
              <Card>
                <Statistic
                  title="Avg Wait Time"
                  value={(metrics?.queue?.avgWaitTimeMs || 0).toFixed(1)}
                  suffix="ms"
                />
              </Card>
            </Col>
          </Row>
        </Col>
        <Col xs={24} md={12}>
          <Title level={5}>
            <DatabaseOutlined /> Resources
          </Title>
          <Row gutter={[16, 16]}>
            <Col span={12}>
              <Card>
                <Statistic
                  title="Memory Used"
                  value={formatBytes(metrics?.resources?.memoryUsedBytes || 0)}
                />
              </Card>
            </Col>
            <Col span={12}>
              <Card>
                <Statistic
                  title="Heap"
                  value={`${formatBytes(metrics?.resources?.heapUsedBytes || 0)} / ${formatBytes(metrics?.resources?.heapTotalBytes || 0)}`}
                />
              </Card>
            </Col>
          </Row>
        </Col>
      </Row>
    </div>
  );
};
