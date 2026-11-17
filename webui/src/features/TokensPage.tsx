import { useEffect, useId, useState, type ReactNode } from "react";
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
  Tag,
  Typography,
  Tooltip,
} from "antd";
import { api, json } from "../api";
import type { TokenEntry, User, WorkspaceEntry } from "../console-types";
import { useResource } from "../lib/use-resource";
import { useWorkspaces } from "../lib/use-workspaces";
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
import { WorkspaceLabels, WorkspaceSelectField } from "../components/WorkspaceAccess";
import { McpConnectionExamples } from "../components/McpConnectionExamples";
import { characterLengthRule, expiryFromLocal, expiryPatch, expiryRule, isTokenExpired, isTokenUsable, localExpiry } from "../lib/identity";
import { useTokenClock } from "../lib/use-token-clock";

const { Text } = Typography;
export interface TokensPageProps {
  clientName: string;
  exampleUrl: string;
  descriptionPlaceholder: string;
  onManageWorkspaces?: () => void;
}

interface TokenValues {
  name: string;
  description?: string;
  workspace_id: string;
  expires_at?: string;
}

function TokenEditor({
  item,
  onClose,
  onSaved,
  connectionExamples,
  descriptionPlaceholder,
  workspaces,
  workspaceLoading,
  workspaceError,
  onReloadWorkspaces,
  onManageWorkspaces,
}: {
  item: TokenEntry | null;
  connectionExamples: ReactNode;
  descriptionPlaceholder: string;
  workspaces: WorkspaceEntry[];
  workspaceLoading: boolean;
  workspaceError: string;
  onReloadWorkspaces: () => void;
  onManageWorkspaces?: () => void;
  onClose?: () => void;
  onSaved: (value?: { token: string; item: TokenEntry }) => void;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const formId = useId();
  const originalExpiry = localExpiry(item?.expires_at);
  async function submit({ name, description = "", workspace_id, expires_at }: TokenValues) {
    if (busy) return;
    setError("");
    setBusy(true);
    try {
      if (item) {
        await api(
          `/api/tokens/${encodeURIComponent(item.id)}`,
          json("PATCH", { name, description, ...expiryPatch(expires_at, item.expires_at) }),
        );
        onSaved();
      } else {
        onSaved(
          await api<{ token: string; item: TokenEntry }>(
            "/api/tokens",
            json("POST", { name, description, workspace_id, expires_at: expiryFromLocal(expires_at || "") }),
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
      scrollToFirstError={{ focus: true }}
      initialValues={{
        name: item?.name || "",
        description: item?.description || "",
        workspace_id: item?.workspace_id,
        expires_at: originalExpiry,
      }}
    >
      <Feedback message={error} />
      {item ? (
        <Form.Item label="工作空间" extra="Token 创建后不可更改所属工作空间。">
          <WorkspaceLabels ids={[item.workspace_id]} workspaces={workspaces} />
        </Form.Item>
      ) : (
        <WorkspaceSelectField disabled={busy} workspaces={workspaces} loading={workspaceLoading} error={workspaceError} onRetry={onReloadWorkspaces} onManage={onManageWorkspaces} />
      )}
      <Form.Item
        name="name"
        label="Token 名称"
        rules={[
          { required: true, whitespace: true, message: "请输入 Token 名称" },
          characterLengthRule(128, "Token 名称须为 1–128 个字符"),
        ]}
      >
        <Input
          placeholder="例如 codex-dev 或 ci-runner"
          autoComplete="off"
        />
      </Form.Item>
      <Form.Item
        name="description"
        label="用途说明（可选）"
        rules={[characterLengthRule(1000, "备注不能超过 1000 个字符")]}
      >
        <Input placeholder={descriptionPlaceholder} />
      </Form.Item>
      <Form.Item
        name="expires_at"
        label="到期时间（可选）"
        extra="留空长期有效；按当前浏览器时区设置。到期后停止 MCP 调用，可重新设置未来时间。"
        rules={[expiryRule(originalExpiry)]}
      >
        <Input type="datetime-local" step={1} />
      </Form.Item>
      {!item && (
        <Text type="secondary">
          创建后可在列表中复制 Token，或查看 Claude Code、Codex 接入配置。
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
      disabled={!item && (workspaceLoading || !!workspaceError || !workspaces.length)}
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
            {connectionExamples}
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

function TokenConnection({
  item,
  clientName,
}: {
  item: TokenEntry;
  clientName: string;
}) {
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(item.can_copy);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!item.can_copy) return;
    let active = true;
    setLoading(true);
    setError("");
    api<{ token: string }>(
      `/api/tokens/${encodeURIComponent(item.id)}/reveal`, json("POST"),
    ).then((result) => {
      if (active) setToken(result.token);
    }).catch((error) => {
      if (active) setError(errorText(error));
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [item.id, item.can_copy, attempt]);
  if (loading || error) {
    return <ResourceStatus loading={loading} error={error} onRetry={() => setAttempt((value) => value + 1)} />;
  }
  return (
    <Flex vertical gap={12}>
      {!item.can_copy && (
        <Typography.Text type="secondary">
          此 Token 创建时只保存了校验值。请在模板中填入已保存的 Token，或创建新 Token。
        </Typography.Text>
      )}
      <McpConnectionExamples serverName={clientName} token={token || "<MCP_TOKEN>"} url={new URL("mcp", location.href).href} />
    </Flex>
  );
}

export default function TokensPage({
  clientName,
  exampleUrl,
  descriptionPlaceholder,
  onManageWorkspaces,
}: TokensPageProps) {
  const connectionExamples = <McpConnectionExamples serverName={clientName} url={exampleUrl} />;
  const { data, setData, loading, error, reload } = useResource<{
    tokens: TokenEntry[];
  }>("/api/tokens", { tokens: [] });
  const { data: people } = useResource<{ users: User[] }>("/api/users", {
    users: [],
  });
  const workspaceResource = useWorkspaces();
  const workspaces = workspaceResource.data.workspaces;
  const workspaceProps = {
    workspaces,
    workspaceLoading: workspaceResource.loading,
    workspaceError: workspaceResource.error,
    onReloadWorkspaces: workspaceResource.reload,
    onManageWorkspaces,
  };
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
  const [copyingId, setCopyingId] = useState("");
  const [actionError, setActionError] = useState("");
  const [message, setMessage] = useState("");
  const [copyMessage, setCopyMessage] = useState("");
  const managedTokens = data.tokens.filter((token) => !token.revoked);
  const now = useTokenClock(data.tokens);
  const hasTokens = managedTokens.length > 0;
  const activeCount = managedTokens.filter((token) => isTokenUsable(token, now)).length;
  const expiredCount = managedTokens.filter((token) => isTokenExpired(token, now)).length;
  const disabledCount = managedTokens.filter((token) => !token.enabled && !isTokenExpired(token, now)).length;
  const filtered = managedTokens.filter((token) =>
    `${token.name} ${token.description} ${token.id} ${workspaces.find((workspace) => workspace.id === token.workspace_id)?.name || ""}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  function refreshList() {
    reload();
    workspaceResource.reload();
  }
  function tokenSaved(value?: { token: string; item: TokenEntry }) {
    setEditor(undefined);
    refreshList();
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
  async function copyToken(item: TokenEntry) {
    if (copyingId || busy || updatingId) return;
    setCopyingId(item.id);
    setActionError("");
    setMessage("");
    try {
      const result = await api<{ token: string }>(
        `/api/tokens/${encodeURIComponent(item.id)}/reveal`, json("POST"),
      );
      try {
        await copyText(result.token);
        setMessage(`已复制 ${item.name} 的 Token。`);
      } catch (error) {
        setCreated({ token: result.token, item });
        setCopyMessage(`${errorText(error)}。可选中下方 Token 手动复制。`);
      }
    } catch (error) {
      setActionError(errorText(error));
    } finally {
      setCopyingId("");
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
      id: "workspace",
      width: 150,
      header: "工作空间",
      value: (row) => workspaces.find((workspace) => workspace.id === row.workspace_id)?.name || row.workspace_id,
      render: (row) => <WorkspaceLabels ids={[row.workspace_id]} workspaces={workspaces} />,
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
      id: "expires_at",
      width: 170,
      header: "到期时间",
      value: (row) => row.expires_at ?? "",
      render: (row) => (
        <Flex vertical gap={4} align="center">
          <span className="table-time">{row.expires_at ? formatTime(row.expires_at) : "长期有效"}</span>
          {isTokenExpired(row, now) && <Tag color="warning">已到期</Tag>}
        </Flex>
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
        <Text ellipsis style={{ maxWidth: "100%" }} title={people.users.find((user) => user.id === row.created_by)?.username || row.created_by || undefined}>
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
      width: 210,
      fixed: "right",
      header: "操作",
      render: (row) => (
        <Space size={4}>
          <Tooltip title={row.can_copy ? "复制 Token" : "此 Token 只保存了校验值，请创建新 Token 以启用复制"}>
            <Button
              type="text"
              size="small"
              aria-label={`复制 ${row.name} Token`}
              icon={<Copy size={14} aria-hidden="true" />}
              loading={copyingId === row.id}
              disabled={!row.can_copy || loading || busy || !!updatingId || !!copyingId}
              onClick={() => void copyToken(row)}
            >
              复制
            </Button>
          </Tooltip>
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
            connectionExamples={connectionExamples}
            descriptionPlaceholder={descriptionPlaceholder}
            {...workspaceProps}
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
              placeholder="搜索名称、用途、空间或标识…"
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
                可用 {activeCount} · 禁用 {disabledCount} · 已到期 {expiredCount}
              </Text>
              <Button
                type="text"
                icon={<RefreshCw size={14} aria-hidden="true" />}
                disabled={loading || busy || !!updatingId}
                onClick={refreshList}
              >
                刷新
              </Button>
            </Space>
          </Flex>
          <Feedback message={workspaceResource.error ? `工作空间加载失败：${workspaceResource.error}` : ""} />
          {workspaceResource.error && <Button onClick={workspaceResource.reload} style={{ marginBottom: 16 }}>重试加载工作空间</Button>}
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
              minWidth={1426}
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
          connectionExamples={connectionExamples}
          descriptionPlaceholder={descriptionPlaceholder}
          {...workspaceProps}
          onClose={() => setEditor(undefined)}
          onSaved={tokenSaved}
        />
      )}
      <AppModal
        opened={!!created}
        onClose={closeCreated}
        title="保存你的 MCP Token"
        description="可在 Token 列表中再次复制，或打开接入配置。"
        size="lg"
        footer={
          <Button type="primary" onClick={closeCreated}>
            已保存，关闭
          </Button>
        }
      >
        {created && (
          <Flex vertical gap={16}>
            <Typography.Paragraph style={{ marginBottom: 0 }}>工作空间：{workspaces.find((workspace) => workspace.id === created.item.workspace_id)?.name || created.item.workspace_id}。仅可访问该空间内的资源。</Typography.Paragraph>
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
            </Form>
            <Text type="secondary" role="status">{copyMessage}</Text>
            <McpConnectionExamples serverName={clientName} token={created.token} url={new URL("mcp", location.href).href} />
          </Flex>
        )}
      </AppModal>
      <AppModal
        opened={!!configItem}
        onClose={() => setConfigItem(null)}
        title={`接入配置 · ${configItem?.name ?? ""}`}
        description="选择客户端后，将配置合并到对应文件。配置使用当前网关地址。"
        size="lg"
      >
        {configItem && <TokenConnection key={configItem.id} item={configItem} clientName={clientName} />}
        <Typography.Paragraph type="secondary" style={{ marginTop: 16, marginBottom: 0 }}>
          工作空间：{workspaces.find((workspace) => workspace.id === configItem?.workspace_id)?.name || configItem?.workspace_id}。
          凭证标识：{configItem?.id}。
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
