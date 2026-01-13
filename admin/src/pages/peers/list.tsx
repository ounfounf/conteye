import { useList } from "@refinedev/core";
import { List, CreateButton, DeleteButton } from "@refinedev/antd";
import { Table, Space, Typography } from "antd";

const { Text } = Typography;

interface Peer {
  id: string;
  wsUrl: string;
  connectedAt: number;
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString();
}

export const PeerList = () => {
  const { data, isLoading } = useList<Peer>({
    resource: "peers",
  });

  const peers = data?.data || [];

  return (
    <List
      headerButtons={
        <CreateButton>Connect Peer</CreateButton>
      }
    >
      <Table dataSource={peers} rowKey="id" loading={isLoading}>
        <Table.Column
          title="ID"
          dataIndex="id"
          render={(id: string) => <code>{id}</code>}
        />
        <Table.Column
          title="WebSocket URL"
          dataIndex="wsUrl"
          render={(wsUrl: string) => <Text code>{wsUrl}</Text>}
        />
        <Table.Column
          title="Connected At"
          dataIndex="connectedAt"
          render={(connectedAt: number) => formatDate(connectedAt)}
          sorter={(a: Peer, b: Peer) => a.connectedAt - b.connectedAt}
          defaultSortOrder="descend"
        />
        <Table.Column
          title="Actions"
          render={(_, record: Peer) => (
            <Space>
              <DeleteButton
                hideText
                size="small"
                recordItemId={record.id}
                confirmTitle="Disconnect this peer?"
                confirmOkText="Disconnect"
              />
            </Space>
          )}
        />
      </Table>
    </List>
  );
};
