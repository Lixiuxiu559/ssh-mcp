import { useState } from "react";
import { ChevronRight, Plus, Search } from "lucide-react";
import {
  Button,
  Card,
  Group,
  Paper,
  Select,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { api, json } from "../api";
import type { AuditRecord, ServerEntry } from "../types";
import { useResource } from "../lib/use-resource";
import { errorText, formatCompactTime } from "../lib/utils";
import { Feedback, Status } from "../components/Feedback";
import { PageHeading } from "../components/PageHeading";
import { AppModal } from "../components/AppModal";
import { ServerEditor } from "../components/ServerEditor";
import {
  ServerDetails,
  type ConnectionCheck,
} from "../components/ServerDetails";

function ServerRow({
  server,
  check,
  onOpen,
}: {
  server: ServerEntry;
  check?: ConnectionCheck;
  onOpen: () => void;
}) {
  const audit = useResource<{ records: AuditRecord[]; total: number }>(
    `/api/audit?kind=mcp&server=${encodeURIComponent(server.alias)}&days=1&limit=1`,
    { records: [], total: 0 },
  );
  const latest = audit.data.records[0];
  return (
    <Paper
      component="button"
      className="server-row"
      onClick={onOpen}
      p="md"
      w="100%"
      style={{ border: "none", background: "transparent", textAlign: "left" }}
    >
      <Stack gap={4}>
        <Group justify="space-between" wrap="nowrap" gap="sm">
          <Group gap="sm" wrap="nowrap">
            <Text fw={700}>{server.alias}</Text>
            <Status
              value={check ? (check.ok ? "ok" : "error") : "unchecked"}
              label={check ? (check.ok ? "检测通过" : "连接失败") : "尚未检测"}
            />
          </Group>
          <ChevronRight size={14} aria-hidden="true" />
        </Group>
        <Text size="sm" c="dimmed">
          {server.tags[0] || "未分组"} · {server.host}:{server.port}
        </Text>
        <Text size="xs" c="dimmed">
          {audit.loading
            ? "正在读取调用记录…"
            : audit.error
              ? "调用记录暂不可用"
              : `24h ${audit.data.total} 次 · 最近 ${latest ? formatCompactTime(latest.ts) : "暂无调用"}`}
        </Text>
        {check && !check.ok && <Text size="sm" c="red">{check.message}</Text>}
      </Stack>
    </Paper>
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
          <PageHeading
            title="服务器管理"
            description="管理网关连接的 Linux 目标服务器"
            extra={
              <Button
                onClick={() => setEditor(null)}
                leftSection={<Plus size={15} aria-hidden="true" />}
              >
                新增
              </Button>
            }
          />
          <Card withBorder p="sm" radius="md" mb="md">
            <Group align="center" gap="sm" wrap="wrap">
              <TextInput
                flex={1}
                miw={220}
                aria-label="搜索服务器"
                placeholder="搜索服务器名称..."
                leftSection={<Search size={15} aria-hidden="true" />}
                value={query}
                onChange={(event) => setQuery(event.currentTarget.value)}
              />
              <Select
                aria-label="筛选服务器标签"
                w={150}
                data={tagOptions}
                value={tag}
                onChange={(value) => setTag(value ?? "")}
              />
              <Select
                aria-label="筛选连接检测"
                w={150}
                data={connectionOptions}
                value={connection}
                onChange={(value) => setConnection(value ?? "")}
              />
              <Button variant="subtle" color="gray" onClick={clearFilters}>
                重置筛选
              </Button>
            </Group>
            <Text size="xs" c="dimmed" mt={8}>
              共 {loading || error ? "—" : filtered.length} 台服务器
            </Text>
          </Card>
          <Feedback message={error} />
          <Paper withBorder radius="md" mb="md" aria-busy={loading}>
            <Stack gap={0}>
              {filtered.map((server, index) => (
                <div key={server.alias}>
                  <ServerRow
                    server={server}
                    check={checks[server.alias]}
                    onOpen={() => {
                      setDetails(server);
                      setActionError("");
                    }}
                  />
                  {index < filtered.length - 1 && (
                    <div
                      style={{
                        borderTop:
                          "1px solid var(--mantine-color-default-border)",
                      }}
                      aria-hidden="true"
                    />
                  )}
                </div>
              ))}
            </Stack>
            {!filtered.length && (
              <Stack align="center" py="xl" gap="xs">
                <Text fw={600}>
                  {loading
                    ? "正在读取…"
                    : error
                      ? "服务器加载失败"
                      : hasFilters
                        ? "没有匹配的服务器"
                        : "还没有服务器"}
                </Text>
                {!loading && (
                  <Button
                    variant="default"
                    onClick={
                      error
                        ? reload
                        : hasFilters
                          ? clearFilters
                          : () => setEditor(null)
                    }
                  >
                    {error ? "重试" : hasFilters ? "清除筛选" : "添加服务器"}
                  </Button>
                )}
              </Stack>
            )}
          </Paper>
          <Text size="xs" c="dimmed">
            连接状态为本页手动检测结果，不代表持续健康监测。
          </Text>
        </>
      )}
      {editor !== undefined && (
        <ServerEditor
          editing={editor}
          onClose={() => setEditor(undefined)}
          onSaved={() => {
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
          }}
        />
      )}
      <AppModal
        opened={!!deleting}
        onClose={() => {
          if (!busy) setDeleting(null);
        }}
        title="删除服务器配置"
        description="此操作移除网关配置，不会删除远端主机。"
        footer={
          <Group justify="flex-end" gap="sm">
            <Button variant="default" onClick={() => setDeleting(null)} disabled={!!busy}>
              取消
            </Button>
            <Button
              color="red"
              onClick={() => void remove()}
              disabled={!!busy}
            >
              {busy ? "正在删除…" : "删除配置"}
            </Button>
          </Group>
        }
      >
        <Text size="sm">
          确认删除 <Text span fw={700}>{deleting?.alias}</Text>？后续 MCP
          调用将无法再使用此别名。
        </Text>
        <Feedback message={actionError} />
      </AppModal>
    </>
  );
}
