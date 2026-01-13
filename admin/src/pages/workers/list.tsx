import { useList, useDelete } from "@refinedev/core";
import { List, ShowButton, DeleteButton } from "@refinedev/antd";
import { Table, Tag, Space, Card, Row, Col, Statistic } from "antd";
import { CloudServerOutlined, DesktopOutlined, ApiOutlined } from "@ant-design/icons";

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

export const WorkerList = () => {
  const { data, isLoading } = useList<Worker>({
    resource: "workers",
  });

  const { mutate: deleteWorker } = useDelete();

  const workers = data?.data || [];

  // Calculate summary from data
  const summary: WorkerSummary = {
    total: workers.length,
    local: workers.filter((w) => w.type === "local").length,
    remote: workers.filter((w) => w.type === "remote").length,
    busy: workers.filter((w) => w.busy).length,
    idle: workers.filter((w) => !w.busy).length,
  };

  return (
    <List>
      {/* Summary Cards */}
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
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
