import { useCustom } from "@refinedev/core";
import { List, ShowButton, DeleteButton } from "@refinedev/antd";
import { Table, Tag, Space, Card, Row, Col, Statistic, Collapse, Typography, Tooltip } from "antd";
import { CloudServerOutlined, DesktopOutlined, ApiOutlined, InfoCircleOutlined, SyncOutlined, ClockCircleOutlined } from "@ant-design/icons";
import gql from "graphql-tag";

const { Text } = Typography;

interface Worker {
  id: string;
  type: "local" | "remote";
  busy: boolean;
  host: string | null;
}

interface WorkerSummary {
  total: number;
  local: number;
  remote: number;
  busy: number;
  idle: number;
}

interface RemoteWorkerStatus {
  peerId: string;
  host: string;
  totalWorkers: number;
  localWorkers: number;
  remoteWorkers: number;
  busyWorkers: number;
  idleWorkers: number;
  pendingTasks: number;
  runningTasks: number;
  lastUpdated: number;
}

interface AggregatedWorkerSummary extends WorkerSummary {
  remoteActualTotal: number;
  remoteActualBusy: number;
  remoteActualIdle: number;
}

const WORKERS_QUERY = gql`
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
      remoteStatuses {
        peerId
        host
        totalWorkers
        localWorkers
        remoteWorkers
        busyWorkers
        idleWorkers
        pendingTasks
        runningTasks
        lastUpdated
      }
      aggregatedSummary {
        total
        local
        remote
        busy
        idle
        remoteActualTotal
        remoteActualBusy
        remoteActualIdle
      }
    }
  }
`;

interface WorkersData {
  workers: {
    workers: Worker[];
    summary: WorkerSummary;
    remoteStatuses: RemoteWorkerStatus[];
    aggregatedSummary: AggregatedWorkerSummary;
  };
}

function formatTimeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

export const WorkerList = () => {
  const { data, isLoading } = useCustom<WorkersData>({
    url: "",
    method: "get",
    config: {
      payload: {
        query: WORKERS_QUERY,
      },
    },
    queryOptions: {
      refetchInterval: 5000,
    },
  });

  const workersData = data?.data?.workers;
  const workers = workersData?.workers || [];
  const summary = workersData?.summary || { total: 0, local: 0, remote: 0, busy: 0, idle: 0 };
  const remoteStatuses = workersData?.remoteStatuses || [];
  const aggregated = workersData?.aggregatedSummary;

  // Check if we have actual remote worker data
  const hasRemoteDetails = remoteStatuses.length > 0;

  return (
    <List>
      {/* Summary Cards - Computational View (remotes = 1 worker each) */}
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={12} sm={8} md={4}>
          <Card size="small">
            <Statistic
              title="Total"
              value={summary.total}
              prefix={<CloudServerOutlined />}
            />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={4}>
          <Card size="small">
            <Statistic
              title="Local"
              value={summary.local}
              prefix={<DesktopOutlined />}
              valueStyle={{ color: "#1890ff" }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={4}>
          <Card size="small">
            <Statistic
              title="Remote"
              value={summary.remote}
              prefix={<ApiOutlined />}
              valueStyle={{ color: "#722ed1" }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={4}>
          <Card size="small">
            <Statistic
              title="Busy"
              value={summary.busy}
              valueStyle={{ color: "#fa8c16" }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={4}>
          <Card size="small">
            <Statistic
              title="Idle"
              value={summary.idle}
              valueStyle={{ color: "#52c41a" }}
            />
          </Card>
        </Col>
      </Row>

      {/* Aggregated Remote Details - Admin View */}
      {hasRemoteDetails && aggregated && (
        <Card
          size="small"
          style={{ marginBottom: 16 }}
          title={
            <Space>
              <InfoCircleOutlined />
              <span>Remote Workers Detail (Admin View)</span>
              <Tooltip title="These counts show actual workers on remote instances. For task distribution, each remote counts as 1 worker.">
                <InfoCircleOutlined style={{ color: "#1890ff" }} />
              </Tooltip>
            </Space>
          }
        >
          <Row gutter={[16, 16]}>
            <Col xs={12} sm={8} md={4}>
              <Statistic
                title="Actual Total"
                value={aggregated.remoteActualTotal}
                valueStyle={{ color: "#722ed1" }}
              />
            </Col>
            <Col xs={12} sm={8} md={4}>
              <Statistic
                title="Actual Busy"
                value={aggregated.remoteActualBusy}
                prefix={<SyncOutlined spin={aggregated.remoteActualBusy > 0} />}
                valueStyle={{ color: "#fa8c16" }}
              />
            </Col>
            <Col xs={12} sm={8} md={4}>
              <Statistic
                title="Actual Idle"
                value={aggregated.remoteActualIdle}
                valueStyle={{ color: "#52c41a" }}
              />
            </Col>
          </Row>

          {/* Per-Remote Breakdown */}
          <Collapse ghost style={{ marginTop: 16 }}>
            {remoteStatuses.map((remote) => (
              <Collapse.Panel
                key={remote.peerId}
                header={
                  <Space>
                    <ApiOutlined />
                    <Text strong>{remote.host}</Text>
                    <Tag color="purple">{remote.totalWorkers} workers</Tag>
                    <Tag color={remote.busyWorkers > 0 ? "orange" : "green"}>
                      {remote.busyWorkers} busy
                    </Tag>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      <ClockCircleOutlined /> {formatTimeAgo(remote.lastUpdated)}
                    </Text>
                  </Space>
                }
              >
                <Row gutter={[16, 8]}>
                  <Col span={6}>
                    <Text type="secondary">Local Workers:</Text> {remote.localWorkers}
                  </Col>
                  <Col span={6}>
                    <Text type="secondary">Remote Workers:</Text> {remote.remoteWorkers}
                  </Col>
                  <Col span={6}>
                    <Text type="secondary">Pending Tasks:</Text> {remote.pendingTasks}
                  </Col>
                  <Col span={6}>
                    <Text type="secondary">Running Tasks:</Text> {remote.runningTasks}
                  </Col>
                </Row>
              </Collapse.Panel>
            ))}
          </Collapse>
        </Card>
      )}

      {/* Workers Table */}
      <Table dataSource={workers} rowKey="id" loading={isLoading}>
        <Table.Column
          title="ID"
          dataIndex="id"
          render={(id: string) => <code>{id}</code>}
        />
        <Table.Column
          title="Type"
          dataIndex="type"
          render={(type: string) => (
            <Tag
              icon={type === "local" ? <DesktopOutlined /> : <ApiOutlined />}
              color={type === "local" ? "blue" : "purple"}
            >
              {type.toUpperCase()}
            </Tag>
          )}
          filters={[
            { text: "Local", value: "local" },
            { text: "Remote", value: "remote" },
          ]}
          onFilter={(value, record: Worker) => record.type === value}
        />
        <Table.Column
          title="Status"
          dataIndex="busy"
          render={(busy: boolean) => (
            <Tag color={busy ? "orange" : "green"}>
              {busy ? "BUSY" : "IDLE"}
            </Tag>
          )}
          filters={[
            { text: "Busy", value: true },
            { text: "Idle", value: false },
          ]}
          onFilter={(value, record: Worker) => record.busy === value}
        />
        <Table.Column
          title="Host"
          dataIndex="host"
          render={(host: string | null) => host || "-"}
        />
        <Table.Column
          title="Actions"
          render={(_, record: Worker) => (
            <Space>
              <ShowButton hideText size="small" recordItemId={record.id} />
              {record.type === "remote" && (
                <DeleteButton
                  hideText
                  size="small"
                  recordItemId={record.id}
                  confirmTitle="Disconnect this remote worker?"
                  confirmOkText="Disconnect"
                  onSuccess={() => {
                    // Refetch happens automatically
                  }}
                />
              )}
            </Space>
          )}
        />
      </Table>
    </List>
  );
};
