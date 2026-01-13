import { useCreate, useNavigation } from "@refinedev/core";
import { Create } from "@refinedev/antd";
import { Form, Input, Checkbox, Alert, Typography } from "antd";
import { useState } from "react";

const { Text } = Typography;

const AVAILABLE_PROCESSORS = [
  { name: "xxhash3", description: "Fast non-cryptographic hash (XXH3)" },
  { name: "md5", description: "MD5 cryptographic hash" },
  { name: "ffprobe", description: "Media file metadata extraction" },
];

interface FormValues {
  root: string;
  processors: string[];
}

export const IngestCreate = () => {
  const [form] = Form.useForm();
  const { mutate, isLoading } = useCreate();
  const { list } = useNavigation();
  const [error, setError] = useState<string | null>(null);

  const onFinish = (values: FormValues) => {
    setError(null);
    mutate(
      {
        resource: "ingests",
        values: {
          root: values.root,
          processors: values.processors || [],
        },
      },
      {
        onSuccess: () => {
          list("ingests");
        },
        onError: (err) => {
          setError(err.message || "Failed to start ingest");
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
      title="Start New Ingest"
    >
      {error && (
        <Alert
          type="error"
          message="Ingest Failed to Start"
          description={error}
          showIcon
          style={{ marginBottom: 16 }}
          closable
          onClose={() => setError(null)}
        />
      )}
      <Form
        form={form}
        layout="vertical"
        onFinish={onFinish}
        initialValues={{ processors: ["xxhash3"] }}
      >
        <Form.Item
          label="Root Directory"
          name="root"
          rules={[
            { required: true, message: "Root directory is required" },
            {
              pattern: /^(\/|[A-Za-z]:\\)/,
              message: "Must be an absolute path (e.g., /path/to/dir or C:\\path\\to\\dir)",
            },
          ]}
          help="Enter the absolute path to the directory to ingest"
        >
          <Input
            placeholder="/path/to/directory or C:\path\to\directory"
            size="large"
          />
        </Form.Item>

        <Form.Item
          label="Processors"
          name="processors"
          help="Select which processors to run on each file"
        >
          <Checkbox.Group style={{ width: "100%" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {AVAILABLE_PROCESSORS.map((processor) => (
                <Checkbox key={processor.name} value={processor.name}>
                  <Text strong>{processor.name}</Text>
                  <Text type="secondary" style={{ marginLeft: 8 }}>
                    - {processor.description}
                  </Text>
                </Checkbox>
              ))}
            </div>
          </Checkbox.Group>
        </Form.Item>
      </Form>
    </Create>
  );
};
