import { useId, useState } from "react";
import {
  Button,
  Row,
  Col,
  Collapse,
  Flex,
  Form,
  Input,
  InputNumber,
  Select,
  Space,
  Typography,
  Upload,
} from "antd";
import {
  Cable,
  KeyRound,
  Save,
  Server,
  Terminal,
  Upload as UploadIcon,
} from "lucide-react";
import type { ServerEntry } from "../types";
import { api, json } from "../api";
import { SetupPanel } from "./ListStates";
import { Feedback } from "./Feedback";
import { AppModal } from "./AppModal";
import { errorText } from "../lib/utils";

const credentials = {
  private_key_file: "私钥文件",
  private_key_inline: "内嵌私钥",
  password: "密码",
};

interface ServerForm {
  alias: string;
  host: string;
  port: number;
  username: string;
  description: string;
  tags: string;
  knownHosts: string;
  type: string;
  secret: string;
  passphrase: string;
}

export function ServerEditor({
  editing,
  onClose,
  onSaved,
}: {
  editing: ServerEntry | null;
  onClose?: () => void;
  onSaved: () => void;
}) {
  const [form] = Form.useForm<ServerForm>();
  const type =
    Form.useWatch("type", form) ??
    editing?.credential_type ??
    "private_key_file";
  const passphrase = Form.useWatch("passphrase", form);
  const [busy, setBusy] = useState<"save" | "test" | "upload" | "">("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const formId = useId();
  const secretRequired =
    !editing || type !== editing.credential_type || !!passphrase;

  function entry(values: ServerForm) {
    const result: Record<string, unknown> = {
      alias: values.alias,
      host: values.host,
      port: values.port,
      username: values.username,
      description: values.description || "",
      tags: (values.tags || "")
        .split(/[,，]/)
        .map((tag) => tag.trim())
        .filter(Boolean),
    };
    if (values.knownHosts?.trim())
      result.known_hosts = values.knownHosts.trim();
    const fields: Record<string, string> = {};
    if (values.secret) {
      const field =
        type === "password"
          ? "password"
          : type === "private_key_file"
            ? "path"
            : "private_key";
      fields[field] = values.secret;
    }
    if (values.passphrase && type !== "password")
      fields.passphrase = values.passphrase;
    if (
      !editing ||
      type !== editing.credential_type ||
      Object.keys(fields).length
    ) {
      result.credential = { type, ...fields };
    }
    return result;
  }

  async function save(values: ServerForm) {
    setBusy("save");
    setError("");
    setMessage("");
    try {
      await api(
        editing
          ? `/api/servers/${encodeURIComponent(editing.alias)}`
          : "/api/servers",
        json(editing ? "PUT" : "POST", entry(values)),
      );
      onSaved();
    } catch (error) {
      setError(errorText(error));
    } finally {
      setBusy("");
    }
  }

  async function test() {
    let values: ServerForm;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    setBusy("test");
    setError("");
    setMessage("");
    try {
      const value = await api<{
        ok: boolean;
        message?: string;
        error?: string;
      }>("/api/servers/test", json("POST", entry(values)));
      if (value.ok) setMessage(value.message || "连接成功");
      else setError(value.error || "连接失败");
    } catch (error) {
      setError(errorText(error));
    } finally {
      setBusy("");
    }
  }

  async function upload(file: File) {
    const alias = form.getFieldValue("alias")?.trim();
    if (!alias || !/^[A-Za-z0-9_-]+$/.test(alias)) {
      setError("请先填写合法的服务器别名，再上传私钥");
      return;
    }
    if (file.size > 65536) {
      setError("私钥文件不能超过 64 KiB");
      return;
    }
    setBusy("upload");
    setError("");
    setMessage("");
    try {
      const value = await api<{ path: string }>(
        "/api/keys",
        json("POST", { alias, content: await file.text() }),
      );
      form.setFieldValue("secret", value.path);
      setMessage("私钥已上传到网关，请保存服务器配置以关联。");
    } catch (error) {
      setError(errorText(error));
    } finally {
      setBusy("");
    }
  }

  const connection = (
    <>
      <Form.Item
        name="alias"
        label="服务器别名"
        rules={[
          { required: true, message: "请输入服务器别名" },
          {
            pattern: /^[A-Za-z0-9_-]+$/,
            message: "仅支持字母、数字、下划线和连字符",
          },
        ]}
      >
        <Input
          maxLength={100}
          disabled={!!editing || busy === "upload"}
          placeholder="prod-app-01"
        />
      </Form.Item>
      <Flex gap={16} align="start">
        <Form.Item
          name="host"
          label="目标主机"
          style={{ flex: 1 }}
          rules={[
            { required: true, whitespace: true, message: "请输入目标主机" },
          ]}
        >
          <Input placeholder="IP 或主机名" />
        </Form.Item>
        <Form.Item
          name="port"
          label="SSH 端口"
          rules={[{ required: true, message: "请输入端口" }]}
        >
          <InputNumber
            min={1}
            max={65535}
            precision={0}
            style={{ width: 116 }}
          />
        </Form.Item>
      </Flex>
      <Form.Item
        name="username"
        label="远端用户名"
        rules={[
          { required: true, whitespace: true, message: "请输入远端用户名" },
        ]}
      >
        <Input autoComplete="off" placeholder="deploy" />
      </Form.Item>
    </>
  );
  const credential = (
    <>
      {editing && (
        <Typography.Paragraph type="secondary">
          留空沿用已保存的凭据。
        </Typography.Paragraph>
      )}
      <Form.Item name="type" label="凭据类型">
        <Select
          disabled={busy === "upload"}
          options={Object.entries(credentials).map(([value, label]) => ({
            value,
            label,
          }))}
          onChange={() => form.setFieldsValue({ secret: "", passphrase: "" })}
        />
      </Form.Item>
      {type === "private_key_inline" && (
        <Form.Item
          name="secret"
          label="PEM 私钥内容"
          rules={[{ required: secretRequired, message: "请输入 PEM 私钥" }]}
        >
          <Input.TextArea
            className="mono"
            rows={5}
            placeholder="粘贴 PEM 私钥"
            spellCheck={false}
          />
        </Form.Item>
      )}
      {type === "password" && (
        <Form.Item
          name="secret"
          label="登录密码"
          rules={[{ required: secretRequired, message: "请输入 SSH 密码" }]}
        >
          <Input.Password
            autoComplete="new-password"
            placeholder={editing ? "留空沿用原凭据" : "输入 SSH 密码"}
          />
        </Form.Item>
      )}
      {type === "private_key_file" && (
        <Form.Item
          name="secret"
          label="网关私钥路径"
          rules={[
            { required: secretRequired, message: "请输入私钥路径或上传 PEM" },
          ]}
        >
          <Input
            disabled={busy === "upload"}
            autoComplete="off"
            placeholder={
              editing ? "留空沿用原凭据" : "/data/keys/prod-app-01.pem"
            }
            suffix={
              <Upload
                accept=".pem,.key"
                showUploadList={false}
                disabled={!!busy}
                beforeUpload={(file) => {
                  void upload(file);
                  return false;
                }}
              >
                <Button
                  type="text"
                  size="small"
                  disabled={!!busy}
                  loading={busy === "upload"}
                  aria-label="上传本地 PEM 私钥"
                  icon={<UploadIcon size={14} aria-hidden="true" />}
                >
                  上传 PEM
                </Button>
              </Upload>
            }
          />
        </Form.Item>
      )}
      {type !== "password" && (
        <Form.Item name="passphrase" label="私钥口令（可选）">
          <Input.Password autoComplete="new-password" />
        </Form.Item>
      )}
    </>
  );
  const optional = (
    <>
      <Form.Item
        name="knownHosts"
        label="known_hosts 文件路径（可选）"
        tooltip={
          editing?.has_known_hosts ? "留空保留现有设置" : "启用主机指纹校验"
        }
      >
        <Input placeholder="/data/keys/known_hosts" />
      </Form.Item>
      <Flex gap={16}>
        <Form.Item name="description" label="描述" style={{ flex: 1 }}>
          <Input maxLength={500} placeholder="用途、维护事项" />
        </Form.Item>
        <Form.Item name="tags" label="标签" style={{ flex: 1 }}>
          <Input placeholder="生产, 应用服务" />
        </Form.Item>
      </Flex>
    </>
  );
  const footer = (
    <Space>
      {onClose && (
        <Button onClick={onClose} disabled={!!busy}>
          取消
        </Button>
      )}
      <Button
        onClick={() => void test()}
        disabled={!!busy}
        loading={busy === "test"}
        icon={<Cable size={15} aria-hidden="true" />}
      >
        测试连接
      </Button>
      <Button
        type="primary"
        htmlType="submit"
        form={formId}
        disabled={!!busy}
        loading={busy === "save"}
        icon={<Save size={15} aria-hidden="true" />}
      >
        保存配置
      </Button>
    </Space>
  );
  const content = (
    <Form
      id={formId}
      form={form}
      disabled={!!busy}
      layout="vertical"
      onFinish={save}
      scrollToFirstError
      initialValues={{
        alias: editing?.alias || "",
        host: editing?.host || "",
        port: editing?.port || 22,
        username: editing?.username || "",
        description: editing?.description || "",
        tags: editing?.tags.join(", ") || "",
        knownHosts: "",
        type: editing?.credential_type || "private_key_file",
        secret: "",
        passphrase: "",
      }}
    >
      <Feedback message={error} />
      <Feedback message={message} success />
      {onClose ? (
        <>
          <Typography.Title level={3}>连接信息</Typography.Title>
          {connection}
          <Typography.Title level={3}>SSH 身份验证</Typography.Title>
          {credential}
          <Typography.Title level={3}>指纹校验、备注与分组</Typography.Title>
          {optional}
        </>
      ) : (
        <>
          <Row gutter={40}>
            <Col span={12}>
              <Typography.Title level={3} className="setup-section-title">
                <Terminal size={17} aria-hidden="true" />
                连接信息
              </Typography.Title>
              {connection}
            </Col>
            <Col span={12}>
              <Typography.Title level={3} className="setup-section-title">
                <KeyRound size={17} aria-hidden="true" />
                SSH 身份验证
              </Typography.Title>
              {credential}
            </Col>
          </Row>
          <div className="setup-actions">
            <Collapse
              ghost
              items={[
                { key: "optional", label: "更多设置", children: optional },
              ]}
            />
            {footer}
          </div>
        </>
      )}
    </Form>
  );
  if (!onClose)
    return (
      <SetupPanel icon={Server} title="添加第一台服务器">
        {content}
      </SetupPanel>
    );
  return (
    <AppModal
      opened
      onClose={() => {
        if (!busy) onClose();
      }}
      size="lg"
      busy={!!busy}
      title={editing ? `编辑 ${editing.alias}` : "添加服务器"}
      footer={footer}
    >
      {content}
    </AppModal>
  );
}
