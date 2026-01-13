import { useCreate, useNavigation } from "@refinedev/core";
import { Create } from "@refinedev/antd";
import { Form, Input, Button, Alert } from "antd";
import { useState } from "react";

export const PeerCreate = () => {
  const [form] = Form.useForm();
  const { mutate, isLoading } = useCreate();
  const { list } = useNavigation();
  const [error, setError] = useState<string | null>(null);

  const onFinish = (values: { wsUrl: string }) => {
    setError(null);
    mutate(
      {
        resource: "peers",
        values: { wsUrl: values.wsUrl },
      },
      {
        onSuccess: () => {
          list("peers");
        },
        onError: (err) => {
          setError(err.message || "Failed to connect to peer");
        },
      }
    );
  };

  return (
    <Create
      saveButtonProps={{
        loading: isLoading,
        onClick: () => form.submit(),
      }}
      title="Connect to Peer"
    >
      {error && (
        <Alert
          type="error"
          message="Connection Failed"
          description={error}
          showIcon
          style={{ marginBottom: 16 }}
          closable
          onClose={() => setError(null)}
        />
      )}
      <Form form={form} layout="vertical" onFinish={onFinish}>
        <Form.Item
          label="WebSocket URL"
          name="wsUrl"
          rules={[
            { required: true, message: "WebSocket URL is required" },
            {
              pattern: /^wss?:\/\/.+/,
              message: "Must be a valid WebSocket URL (ws:// or wss://)",
            },
          ]}
          help="Enter the WebSocket URL of the remote ConTeye instance"
        >
          <Input
            placeholder="ws://192.168.1.100:8000/ws/workers"
            size="large"
          />
        </Form.Item>
      </Form>
    </Create>
  );
};
