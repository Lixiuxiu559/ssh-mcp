import { useState } from "react";
import { ChevronRight, Plus, RefreshCw, Search } from "lucide-react";
import {
  Button,
  Card,
  Flex,
  Input,
  Select,
  Space,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { api, json } from "../api";
import type { AuditRecord, ServerEntry } from "../types";
import { useResource } from "../lib/use-resource";
import { errorText, formatCompactTime } from "../lib/utils";
import { AppTable } from "../components/AppTable";
import { Feedback, Status } from "../components/Feedback";
import { ListNotice, ResourceStatus } from "../components/ListStates";
import { PageHeading } from "../components/PageHeading";
import { AppModal } from "../components/AppModal";
import { ServerEditor } from "../components/ServerEditor";
import {
  ServerDetails,
  type ConnectionCheck,
} from "../components/ServerDetails";

function RecentCalls({ alias }: { alias: string }) {
  const audit = useResource<{ records: AuditRecord[]; total: number }>(
    `/api/audit?kind=mcp&server=${encodeURIComponent(alias)}&days=1&limit=1`,
    { records: [], total: 0 },
  );
  const latest = audit.data.records[0];
  if (audit.loading)
    return <Typography.Text type="secondary">正在读取…</Typography.Text>;
  if (audit.error)
    return <Typography.Text type="secondary">记录暂不可用</Typography.Text>;
  return (
    <Flex vertical gap={2} align="center">
      <Typography.Text>{audit.data.total} 次</Typography.Text>
      {latest && (
        <Typography.Text type="secondary">
          最近 {formatCompactTime(latest.ts)}
        </Typography.Text>
      )}
    </Flex>
  );
}

const connectionOptions = [
  { value: "", label: "全部状态" },
  { value: "ok", label: "检测通过" },
  { value: "error", label: "连接失败" },
  { value: "unchecked", label: "尚未检测" },
];

export default function Servers() {
  const { data, loading, error, reload } = useResource<{
    servers: ServerEntry[];
  }>("/api/servers", { servers: [] });
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState("");
  const [connection, setConnection] = useState("");
  const [editor, setEditor] = useState<ServerEntry | null | undefined>(
    undefined,
  );
  const [deleting, setDeleting] = useState<ServerEntry | null>(null);
  const [details, setDetails] = useState<ServerEntry | null>(null);
  const [busy, setBusy] = useState("");
  const [actionError, setActionError] = useState("");
  const [message, setMessage] = useState("");
  const [checks, setChecks] = useState<Record<string, ConnectionCheck>>({});
  const hasServers = data.servers.length > 0;
  const tags = [...new Set(data.servers.flatMap((server) => server.tags))];
  const tagOptions = [
    { value: "", label: "全部环境" },
    ...tags.map((value) => ({ value, label: value })),
  ];
  const hasFilters = !!(query || tag || connection);
  const filtered = data.servers.filter((server) => {
    const matchesQuery =
      `${server.alias} ${server.host} ${server.username} ${server.description} ${server.tags.join(" ")}`
        .toLowerCase()
        .includes(query.toLowerCase());
    const check = checks[server.alias];
    const matchesConnection =
      !connection ||
      (connection === "unchecked"
        ? !check
        : connection === "ok"
          ? check?.ok === true
          : check?.ok === false);
    return (
      matchesQuery && (!tag || server.tags.includes(tag)) && matchesConnection
    );
  });
  function clearFilters() {
    setQuery("");
    setTag("");
    setConnection("");
  }
  function serverSaved() {
    if (!hasServers) clearFilters();
    const alias = editor?.alias;
    if (alias)
      setChecks((old) => {
        const next = { ...old };
        delete next[alias];
        return next;
      });
    setEditor(undefined);
    setDetails(null);
    reload();
    setMessage("服务器配置已保存。");
  }
  async function test(server: ServerEntry) {
    setBusy(server.alias);
    setActionError("");
    setMessage("");
    try {
      const result = await api<{
        ok: boolean;
        message?: string;
        error?: string;
      }>("/api/servers/test", json("POST", server));
      setChecks((old) => ({
        ...old,
        [server.alias]: {
          ok: result.ok,
          message:
            result.message ||
            result.error ||
            (result.ok ? "连接成功" : "连接失败"),
        },
      }));
    } catch (error) {
      setActionError(errorText(error));
    } finally {
      setBusy("");
    }
  }
  async function remove() {
    if (!deleting) return;
    setBusy("delete");
    setActionError("");
    try {
      await api(
        `/api/servers/${encodeURIComponent(deleting.alias)}`,
        json("DELETE"),
      );
      setDeleting(null);
      setDetails(null);
      reload();
      setMessage("服务器配置已删除，历史审计保留。");
    } catch (error) {
      setActionError(errorText(error));
    } finally {
      setBusy("");
    }
  }
  function openDetails(server: ServerEntry) {
    setDetails(server);
    setActionError("");
  }
  const columns: ColumnsType<ServerEntry> = [
    {
      key: "alias",
      title: "服务器 / 环境",
      width: "26%",
      render: (_, server) => (
        <Flex vertical gap={2} align="center">
          <Button
            type="link"
            style={{ padding: 0, height: "auto", justifyContent: "center" }}
            aria-label={`查看 ${server.alias} 详情`}
            onClick={(event) => {
              event.stopPropagation();
              openDetails(server);
            }}
          >
            {server.alias}
          </Button>
          {!!server.tags.length && (
            <Typography.Text type="secondary">
              {server.tags.join(" · ")}
            </Typography.Text>
          )}
        </Flex>
      ),
    },
    {
      key: "host",
      title: "主机端点",
      width: "31%",
      render: (_, server) => `${server.host}:${server.port}`,
    },
    {
      key: "connection",
      title: "手动连接检测",
      render: (_, server) => {
        const check = checks[server.alias];
        return (
          <Flex vertical gap={2} align="center">
            <Status
              value={check ? (check.ok ? "ok" : "error") : "unchecked"}
              label={check ? (check.ok ? "检测通过" : "连接失败") : "尚未检测"}
            />
            {check && !check.ok && (
              <Typography.Text type="danger">{check.message}</Typography.Text>
            )}
          </Flex>
        );
      },
    },
    {
      key: "audit",
      title: "近 24h 调用",
      render: (_, server) => <RecentCalls alias={server.alias} />,
    },
    {
      key: "details",
      title: <span className="sr-only">查看详情</span>,
      width: 44,
      render: () => <ChevronRight size={14} aria-hidden="true" />,
    },
  ];
  return (
    <>
      <Feedback message={actionError} onDismiss={() => setActionError("")} />
      <Feedback message={message} success onDismiss={() => setMessage("")} />
      {details ? (
        <ServerDetails
          key={details.alias}
          server={details}
          check={checks[details.alias]}
          busy={!!busy}
          onBack={() => setDetails(null)}
          onTest={() => void test(details)}
          onEdit={() => setEditor(details)}
          onDelete={() => {
            setActionError("");
            setDeleting(details);
          }}
        />
      ) : (
        <>
          <PageHeading title="服务器管理" />
          {!hasServers ? (
            loading || error ? (
              <ResourceStatus
                loading={loading}
                error={error}
                onRetry={reload}
              />
            ) : (
              <ServerEditor editing={null} onSaved={serverSaved} />
            )
          ) : (
            <Card>
              <Flex gap={12} align="center" style={{ marginBottom: 16 }}>
                <Input
                  allowClear
                  aria-label="搜索服务器"
                  placeholder="搜索名称、主机或标签…"
                  prefix={<Search size={15} aria-hidden="true" />}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  style={{ flex: 1 }}
                />
                <Select
                  aria-label="筛选服务器标签"
                  style={{ width: 150 }}
                  options={tagOptions}
                  value={tag}
                  onChange={setTag}
                />
                <Select
                  aria-label="筛选连接检测"
                  style={{ width: 150 }}
                  options={connectionOptions}
                  value={connection}
                  onChange={setConnection}
                />
                {hasFilters && filtered.length > 0 && (
                  <Button type="text" onClick={clearFilters}>
                    重置筛选
                  </Button>
                )}
                <Button
                  type="text"
                  aria-label="刷新服务器"
                  loading={loading}
                  icon={<RefreshCw size={15} aria-hidden="true" />}
                  onClick={reload}
                />
                <Typography.Text
                  type="secondary"
                  style={{ whiteSpace: "nowrap" }}
                >
                  共 {loading || error ? "—" : filtered.length} 台
                </Typography.Text>
                <Button
                  type="primary"
                  onClick={() => setEditor(null)}
                  icon={<Plus size={15} aria-hidden="true" />}
                >
                  新增
                </Button>
              </Flex>
              <Feedback message={error} />
              {error && <Button onClick={reload}>重试</Button>}
              {!filtered.length && !loading && !error ? (
                <ListNotice
                  title="没有匹配的服务器"
                  description="试试其他名称、环境或连接状态。"
                  onClear={clearFilters}
                />
              ) : (
                <AppTable<ServerEntry>
                  className="server-list"
                  aria-label="服务器列表"
                  dataSource={filtered}
                  columns={columns}
                  rowKey="alias"
                  loading={loading}
                  tableLayout="fixed"
                  scroll={{ x: 800 }}
                  onRow={(server) => ({
                    onClick: () => openDetails(server),
                    style: { cursor: "pointer" },
                  })}
                />
              )}
            </Card>
          )}
        </>
      )}
      {editor !== undefined && (
        <ServerEditor
          editing={editor}
          onClose={() => setEditor(undefined)}
          onSaved={serverSaved}
        />
      )}
      <AppModal
        opened={!!deleting}
        onClose={() => {
          if (!busy) setDeleting(null);
        }}
        busy={!!busy}
        title="删除服务器配置"
        footer={
          <Space>
            <Button onClick={() => setDeleting(null)} disabled={!!busy}>
              取消
            </Button>
            <Button
              danger
              type="primary"
              onClick={() => void remove()}
              disabled={!!busy}
              loading={busy === "delete"}
            >
              删除配置
            </Button>
          </Space>
        }
      >
        <Typography.Paragraph>
          确认删除 <Typography.Text strong>{deleting?.alias}</Typography.Text>
          ？后续 MCP 调用将无法再使用此别名。
        </Typography.Paragraph>
        <Feedback message={actionError} />
      </AppModal>
    </>
  );
}
