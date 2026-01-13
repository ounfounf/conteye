import { useShow } from "@refinedev/core";
import { Show } from "@refinedev/antd";
import { Typography, Tag, Descriptions } from "antd";
import { DesktopOutlined, ApiOutlined } from "@ant-design/icons";

const { Title } = Typography;

interface Worker {
  id: string;
  type: "local" | "remote";
  busy: boolean;
  host: string | null;
}

export const WorkerShow = () => {
  const { query } = useShow<Worker>();
  const { data, isLoading } = query;
  const worker = data?.data;

  return (
    <Show isLoading={isLoading}>
      <Title level={5}>Worker Details</Title>
      <Descriptions bordered column={1}>
        <Descriptions.Item label="ID">
          <code>{worker?.id}</code>
        </Descriptions.Item>
        <Descriptions.Item label="Type">
          <Tag
            icon={worker?.type === "local" ? <DesktopOutlined /> : <ApiOutlined />}
            color={worker?.type === "local" ? "blue" : "purple"}
          >
            {worker?.type?.toUpperCase()}
          </Tag>
        </Descriptions.Item>
        <Descriptions.Item label="Status">
          <Tag color={worker?.busy ? "orange" : "green"}>
            {worker?.busy ? "BUSY" : "IDLE"}
          </Tag>
        </Descriptions.Item>
        <Descriptions.Item label="Host">
          {worker?.host || "-"}
        </Descriptions.Item>
      </Descriptions>
    </Show>
  );
};
