import { useId, useState } from "react";
import {
  Trash2,
  Code2,
  Copy,
  KeyRound,
  Pencil,
  Plus,
  RefreshCw,
  Search,
} from "lucide-react";
import {
  Avatar,
  Button,
  Row,
  Col,
  Card,
  Flex,
  Form,
  Input,
  Space,
  Switch,
  Typography,
  Tooltip,
} from "antd";
import { api, json } from "../api";
import type { TokenEntry, User } from "../console-types";
import { useResource } from "../lib/use-resource";
import { errorText, formatTime, copyText } from "../lib/utils";
import { DataTable, type TableColumn } from "../components/DataTable";
import { Feedback } from "../components/Feedback";
import {
  ListNotice,
  ResourceStatus,
  SetupPanel,
} from "../components/ListStates";
import { PageHeading } from "../components/PageHeading";
import { AppModal } from "../components/AppModal";

const { Text } = Typography;
export interface TokensPageProps {
  clientName: string;
  exampleUrl: string;
  descriptionPlaceholder: string;
}

interface TokenValues {
  name: string;
  description?: string;
}

function TokenEditor({
  item,
  onClose,
  onSaved,
  configTemplate,
  descriptionPlaceholder,
}: {
  item: TokenEntry | null;
  configTemplate: string;
  descriptionPlaceholder: string;
  onClose?: () => void;
  onSaved: (value?: { token: string; item: TokenEntry }) => void;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const formId = useId();
  async function submit({ name, description = "" }: TokenValues) {
    if (busy) return;
    setError("");
    setBusy(true);
    try {
      if (item) {
        await api(
          `/api/tokens/${encodeURIComponent(item.id)}`,
          json("PATCH", { name, description }),
        );
        onSaved();
      } else {
        onSaved(
          await api<{ token: string; item: TokenEntry }>(
            "/api/tokens",
            json("POST", { name, description }),
          ),
        );
      }
    } catch (error) {
      setError(errorText(error));
    } finally {
      setBusy(false);
    }
  }
  const fields = (
    <Form<TokenValues>
      id={formId}
      layout="vertical"
      disabled={busy}
      onFinish={submit}
      initialValues={{
        name: item?.name || "",
        description: item?.description || "",
      }}
    >
      <Feedback message={error} />
      <Form.Item
        name="name"
        label="Token 名称"
        rules={[
          { required: true, whitespace: true, message: "请输入 Token 名称" },
          { max: 100 },
        ]}
      >
        <Input
          maxLength={100}
          placeholder="例如 codex-dev 或 ci-runner"
          autoComplete="off"
        />
      </Form.Item>
      <Form.Item
        name="description"
        label="用途说明（可选）"
        rules={[{ max: 500 }]}
      >
        <Input maxLength={500} placeholder={descriptionPlaceholder} />
      </Form.Item>
      {!item && (
        <Text type="secondary">
          Token 明文只在创建后显示一次，请及时复制保存。
        </Text>
      )}
    </Form>
  );
  const submitButton = (
    <Button
      type="primary"
      htmlType="submit"
      form={formId}
      loading={busy}
      icon={item ? undefined : <Plus size={15} aria-hidden="true" />}
    >
      {item ? "保存修改" : "创建 Token"}
    </Button>
  );
  if (!onClose) {
    return (
      <SetupPanel icon={KeyRound} title="创建第一个 MCP Token">
        <Row gutter={40}>
          <Col span={12}>
            <Typography.Title level={3} className="setup-section-title">
              <KeyRound size={17} aria-hidden="true" />
              凭证信息
            </Typography.Title>
            {fields}
            <Flex style={{ marginTop: 24 }}>{submitButton}</Flex>
          </Col>
          <Col span={12}>
            <Typography.Title level={3} className="setup-section-title">
              <Code2 size={17} aria-hidden="true" />
              客户端配置示例
            </Typography.Title>
            <pre className="setup-code">
              <code>{configTemplate}</code>
            </pre>
          </Col>
        </Row>
      </SetupPanel>
    );
  }
  return (
    <AppModal
      opened
      onClose={() => {
        if (!busy) onClose();
      }}
      busy={busy}
      title={item ? "编辑 MCP Token" : "创建 MCP Token"}
      footer={
        <Space>
          <Button onClick={onClose} disabled={busy}>
            取消
          </Button>
          {submitButton}
        </Space>
      }
    >
      {fields}
    </AppModal>
  );
}

function connectionConfig(
  clientName: string,
  token: string,
  url = new URL("mcp", location.href).href,
) {
  return JSON.stringify(
    {
      mcpServers: {
        [clientName]: {
          type: "http",
          url,
          headers: { Authorization: `Bearer ${token}` },
        },
      },
    },
    null,
    2,
  );
}

export default function TokensPage({
  clientName,
  exampleUrl,
  descriptionPlaceholder,
}: TokensPageProps) {
  const configTemplate = connectionConfig(clientName, "<MCP_TOKEN>", exampleUrl);
  const { data, setData, loading, error, reload } = useResource<{
    tokens: TokenEntry[];
  }>("/api/tokens", { tokens: [] });
  const { data: people } = useResource<{ users: User[] }>("/api/users", {
    users: [],
  });
  const [query, setQuery] = useState("");
  const [editor, setEditor] = useState<TokenEntry | null | undefined>(
    undefined,
  );
  const [created, setCreated] = useState<{
    token: string;
    item: TokenEntry;
  } | null>(null);
  const [configItem, setConfigItem] = useState<TokenEntry | null>(null);
  const [deleting, setDeleting] = useState<TokenEntry | null>(null);
  const [busy, setBusy] = useState(false);
  const [updatingId, setUpdatingId] = useState("");
  const [actionError, setActionError] = useState("");
  const [message, setMessage] = useState("");
  const [copyMessage, setCopyMessage] = useState("");
  const managedTokens = data.tokens.filter((token) => !token.revoked);
  const hasTokens = managedTokens.length > 0;
  const activeCount = managedTokens.filter((token) => token.enabled).length;
  const filtered = managedTokens.filter((token) =>
    `${token.name} ${token.description} ${token.id}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  function tokenSaved(value?: { token: string; item: TokenEntry }) {
    setEditor(undefined);
    reload();
    if (value) {
      setQuery("");
      setCreated(value);
      setCopyMessage("");
    } else setMessage("Token 已更新。");
  }
  function closeCreated() {
    setCreated(null);
    setCopyMessage("");
  }
  async function copy(value: string) {
    try {
      await copyText(value);
      setCopyMessage("已复制到剪贴板。");
    } catch (error) {
      setCopyMessage(errorText(error));
    }
  }
  async function remove() {
    if (!deleting || loading || busy || updatingId) return;
    setBusy(true);
    setActionError("");
    try {
      await api(
        `/api/tokens/${encodeURIComponent(deleting.id)}`,
        json("DELETE"),
      );
      setData((current) => ({
        tokens: current.tokens.filter((token) => token.id !== deleting.id),
      }));
      setDeleting(null);
      if (managedTokens.length === 1) setQuery("");
      setMessage("Token 已删除，历史调用记录保留。");
    } catch (error) {
      setActionError(errorText(error));
    } finally {
      setBusy(false);
    }
  }
  async function setEnabled(item: TokenEntry, enabled: boolean) {
    if (loading || busy || updatingId) return;
    setUpdatingId(item.id);
    setActionError("");
    setMessage("");
    try {
      const updated = await api<TokenEntry>(
        `/api/tokens/${encodeURIComponent(item.id)}`,
        json("PATCH", { enabled }),
      );
      setData((current) => ({
        tokens: current.tokens.map((token) =>
          token.id === updated.id ? updated : token,
        ),
      }));
      setMessage(`Token 已${enabled ? "启用" : "禁用"}。`);
    } catch (error) {
      setActionError(errorText(error));
    } finally {
      setUpdatingId("");
    }
  }
  const columns: TableColumn<TokenEntry>[] = [
    {
      id: "name",
      header: "Token",
      sortable: true,
      value: (row) => row.name,
      render: (row) => (
        <Flex gap={12} align="center" justify="center" style={{ minWidth: 0 }}>
          <Avatar
            size={28}
            style={{ flexShrink: 0 }}
            icon={<KeyRound size={14} aria-hidden="true" />}
          />
          <Flex vertical style={{ minWidth: 0 }}>
            <Text strong ellipsis title={row.name}>
              {row.name}
            </Text>
            {row.description && (
              <Text type="secondary" ellipsis title={row.description}>
                {row.description}
              </Text>
            )}
          </Flex>
        </Flex>
      ),
    },
    {
      id: "prefix",
      width: 148,
      header: "凭证标识",
      value: (row) => row.prefix,
      render: (row) => (
        <span title={row.id} className="mono nowrap">
          {row.prefix || `${row.id.slice(0, 12)}…`}
        </span>
      ),
    },
    {
      id: "state",
      width: 100,
      header: "状态",
      value: (row) => Number(row.enabled),
      render: (row) => (
        <Switch
          checked={row.enabled}
          checkedChildren="启用"
          unCheckedChildren="禁用"
          aria-label={`启用 ${row.name}`}
          loading={updatingId === row.id}
          disabled={loading || busy || !!updatingId}
          onChange={(enabled) => void setEnabled(row, enabled)}
        />
      ),
    },
    {
      id: "last_used_at",
      width: 160,
      header: "最近调用",
      value: (row) => row.last_used_at ?? "",
      render: (row) => (
        <span className="table-time">{formatTime(row.last_used_at)}</span>
      ),
    },
    {
      id: "created_by",
      width: 100,
      header: "创建人",
      value: (row) => row.created_by ?? "",
      render: (row) => (
        <Text title={row.created_by || undefined}>
          {people.users.find((user) => user.id === row.created_by)?.username ||
            (row.created_by ? row.created_by.slice(0, 12) : "历史迁移")}
        </Text>
      ),
    },
    {
      id: "created_at",
      width: 160,
      header: "创建时间",
      value: (row) => row.created_at ?? "",
      render: (row) => (
        <span className="table-time">{formatTime(row.created_at)}</span>
      ),
    },
    {
      id: "actions",
      width: 144,
      fixed: "right",
      header: "操作",
      render: (row) => (
        <Space size={4}>
          <Button
            type="text"
            size="small"
            aria-label={`查看 ${row.name} 接入配置`}
            icon={<Code2 size={14} aria-hidden="true" />}
            onClick={() => {
              setConfigItem(row);
              setCopyMessage("");
            }}
          >
            接入
          </Button>
          <Tooltip title="编辑 Token">
            <Button
              type="text"
              size="small"
              aria-label={`编辑 ${row.name}`}
              icon={<Pencil size={15} aria-hidden="true" />}
              disabled={loading || busy || !!updatingId}
              onClick={() => setEditor(row)}
            />
          </Tooltip>
          <Tooltip title="删除 Token">
            <Button
              type="text"
              size="small"
              danger
              aria-label={`删除 ${row.name}`}
              icon={<Trash2 size={15} aria-hidden="true" />}
              disabled={loading || busy || !!updatingId}
              onClick={() => {
                setDeleting(row);
                setActionError("");
              }}
            />
          </Tooltip>
        </Space>
      ),
    },
  ];
  return (
    <>
      <PageHeading title="MCP Token" />
      <Feedback message={actionError} onDismiss={() => setActionError("")} />
      <Feedback message={message} success onDismiss={() => setMessage("")} />
      {!hasTokens ? (
        loading || error ? (
          <ResourceStatus loading={loading} error={error} onRetry={reload} />
        ) : (
          <TokenEditor
            item={null}
            onSaved={tokenSaved}
            configTemplate={configTemplate}
            descriptionPlaceholder={descriptionPlaceholder}
          />
        )
      ) : (
        <Card>
          <Flex
            justify="space-between"
            align="center"
            gap={12}
            style={{ marginBottom: 16 }}
          >
            <Input
              style={{ width: 280 }}
              aria-label="搜索 Token"
              placeholder="搜索名称、用途或标识…"
              prefix={<Search size={15} aria-hidden="true" />}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              allowClear
            />
            <Space size="middle">
              <Button
                type="primary"
                icon={<Plus size={15} aria-hidden="true" />}
                disabled={loading || busy || !!updatingId}
                onClick={() => setEditor(null)}
              >
                创建 Token
              </Button>
              <Text type="secondary">
                启用 {activeCount} · 禁用 {managedTokens.length - activeCount}
              </Text>
              <Button
                type="text"
                icon={<RefreshCw size={14} aria-hidden="true" />}
                disabled={loading || busy || !!updatingId}
                onClick={reload}
              >
                刷新
              </Button>
            </Space>
          </Flex>
          {!filtered.length && !loading && !error ? (
            <ListNotice
              title="没有匹配的 Token"
              description="试试其他名称、用途或凭证标识。"
              onClear={() => setQuery("")}
            />
          ) : (
            <DataTable
              columns={columns}
              fixedLayout
              minWidth={1040}
              data={filtered}
              rowKey={(row) => row.id}
              loading={loading}
              error={error}
              onRetry={reload}
            />
          )}
        </Card>
      )}
      {editor !== undefined && (
        <TokenEditor
          item={editor}
          configTemplate={configTemplate}
          descriptionPlaceholder={descriptionPlaceholder}
          onClose={() => setEditor(undefined)}
          onSaved={tokenSaved}
        />
      )}
      <AppModal
        opened={!!created}
        onClose={closeCreated}
        title="保存你的 MCP Token"
        description="明文仅显示这一次，关闭后无法再次读取。"
        size="lg"
        footer={
          <Button type="primary" onClick={closeCreated}>
            已保存，关闭
          </Button>
        }
      >
        {created && (
          <Flex vertical gap={16}>
            <Form layout="vertical">
              <Form.Item label={created.item.name}>
                <Input.TextArea
                  className="mono secret-display"
                  readOnly
                  value={created.token}
                  rows={3}
                  onFocus={(event) => event.target.select()}
                />
              </Form.Item>
              <Button
                icon={<Copy size={15} aria-hidden="true" />}
                onClick={() => void copy(created.token)}
              >
                复制 Token
              </Button>
              <Form.Item
                label="客户端接入配置"
                style={{ marginTop: 20, marginBottom: 0 }}
              >
                <Input.TextArea
                  className="mono"
                  readOnly
                  rows={10}
                  value={connectionConfig(clientName, created.token)}
                  spellCheck={false}
                />
              </Form.Item>
            </Form>
            <Space>
              <Button
                icon={<Copy size={15} aria-hidden="true" />}
                onClick={() => void copy(connectionConfig(clientName, created.token))}
              >
                复制配置
              </Button>
              <Text type="secondary" role="status">
                {copyMessage}
              </Text>
            </Space>
          </Flex>
        )}
      </AppModal>
      <AppModal
        opened={!!configItem}
        onClose={() => setConfigItem(null)}
        title={`接入配置 · ${configItem?.name ?? ""}`}
        description="将示例 URL 和 <MCP_TOKEN> 替换为网关地址和已保存的 Token。"
        size="lg"
        footer={
          <Flex justify="space-between" align="center" gap={16}>
            <Button
              icon={<Copy size={15} aria-hidden="true" />}
              onClick={() => void copy(configTemplate)}
            >
              复制配置模板
            </Button>
            <Text type="secondary" role="status">
              {copyMessage}
            </Text>
          </Flex>
        }
      >
        <Form layout="vertical">
          <Form.Item label="HTTP 配置示例" style={{ marginBottom: 0 }}>
            <Input.TextArea
              className="mono"
              rows={10}
              readOnly
              value={configTemplate}
              spellCheck={false}
            />
          </Form.Item>
        </Form>
        <Typography.Paragraph type="secondary" style={{ marginTop: 16, marginBottom: 0 }}>
          凭证标识：{configItem?.id}。服务不返回已创建 Token 的明文；若丢失，请创建新 Token。
        </Typography.Paragraph>
      </AppModal>
      <AppModal
        opened={!!deleting}
        onClose={() => {
          if (!busy) setDeleting(null);
        }}
        busy={busy}
        title="删除 MCP Token"
        description="删除后凭证立即失效，历史调用记录会保留。"
        footer={
          <Space>
            <Button disabled={busy} onClick={() => setDeleting(null)}>
              取消
            </Button>
            <Button
              danger
              type="primary"
              loading={busy}
              onClick={() => void remove()}
            >
              确认删除
            </Button>
          </Space>
        }
      >
        <Typography.Paragraph>
          确认删除 <Text strong>{deleting?.name}</Text>
          ？删除后无法恢复。
        </Typography.Paragraph>
        <Feedback message={actionError} onDismiss={() => setActionError("")} />
      </AppModal>
    </>
  );
}
