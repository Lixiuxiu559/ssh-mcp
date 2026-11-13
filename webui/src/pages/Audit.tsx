import { useMemo, useState, type FormEvent } from "react";
import {
  ArrowUpRight,
  Download,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import {
  ActionIcon,
  Button,
  Card,
  Group,
  Pagination,
  Select,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { response } from "../api";
import type {
  AuditKind,
  AuditRecord,
  ServerEntry,
  TokenEntry,
  User,
} from "../types";
import { useResource } from "../lib/use-resource";
import { formatTime, errorText } from "../lib/utils";
import { DataTable, type TableColumn } from "../components/DataTable";
import { Feedback, Status } from "../components/Feedback";
import { PageHeading } from "../components/PageHeading";
import { AppModal } from "../components/AppModal";

interface Filters {
  q: string;
  days: string;
  status: string;
  server: string;
  token_id: string;
  user_id: string;
}
const initialFilters: Filters = {
  q: "",
  days: "7",
  status: "",
  server: "",
  token_id: "",
  user_id: "",
};
const pageSize = 20;
function text(value: unknown) {
  return value == null || value === ""
    ? "—"
    : typeof value === "string"
      ? value
      : JSON.stringify(value);
}
function filterParams(filters: Filters) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters))
    if (value && key !== "days") params.set(key, value);
  if (filters.days !== "all")
    params.set(
      "since",
      new Date(Date.now() - Number(filters.days) * 86400000).toISOString(),
    );
  return params;
}

const daysOptions = [
  { value: "1", label: "最近 24 小时" },
  { value: "7", label: "最近 7 天" },
  { value: "30", label: "最近 30 天" },
  { value: "all", label: "全部留存记录" },
];
const statusOptions = [
  { value: "", label: "全部结果" },
  { value: "ok", label: "成功" },
  { value: "error", label: "失败" },
  { value: "denied", label: "已拒绝" },
  { value: "timeout", label: "超时" },
  { value: "cancelled", label: "已取消" },
  { value: "pending", label: "未完成" },
];

export default function Audit({ kind }: { kind: AuditKind }) {
  const person = kind === "person";
  const [draft, setDraft] = useState(initialFilters);
  const [filters, setFilters] = useState(initialFilters);
  const [page, setPage] = useState(0);
  const [details, setDetails] = useState<AuditRecord | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const params = useMemo(() => {
    const value = filterParams(filters);
    value.set("kind", kind);
    value.set("limit", String(pageSize));
    value.set("offset", String(page * pageSize));
    return value.toString();
  }, [filters, page, kind]);
  const { data, loading, error, reload } = useResource<{
    records: AuditRecord[];
    total: number;
  }>(`/api/audit?${params}`, { records: [], total: 0 });
  const { data: servers } = useResource<{ servers: ServerEntry[] }>(
    "/api/servers",
    { servers: [] },
  );
  const { data: tokens } = useResource<{ tokens: TokenEntry[] }>(
    "/api/tokens",
    { tokens: [] },
  );
  const { data: users } = useResource<{ users: User[] }>("/api/users", {
    users: [],
  });
  function change<K extends keyof Filters>(key: K, value: Filters[K]) {
    setDraft((old) => ({ ...old, [key]: value }));
  }
  function search(event: FormEvent) {
    event.preventDefault();
    setPage(0);
    setFilters({ ...draft });
  }
  async function exportCsv() {
    setExporting(true);
    setExportError("");
    try {
      const params = filterParams(filters);
      params.set("kind", kind);
      const res = await response(`/api/audit/export?${params}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `ssh-${kind}-audit-${new Date().toISOString().slice(0, 10)}.csv`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      setExportError(errorText(error));
    } finally {
      setExporting(false);
    }
  }
  const columns: TableColumn<AuditRecord>[] = [
    {
      id: "ts",
      header: "时间",
      value: (row) => row.ts,
      render: (row) => (
        <span className="mono nowrap">{formatTime(row.ts)}</span>
      ),
    },
    {
      id: "identity",
      header: person ? "操作人员" : "调用凭证",
      render: (row) => (
        <Stack gap={0}>
          <Text size="sm" fw={600}>
            {person
              ? row.username || row.user || "未认证来源"
              : row.token_name || row.user || "历史调用"}
          </Text>
          <Text size="xs" c="dimmed" className="mono">
            {person
              ? row.actor_user_id || row.source_ip || "—"
              : row.token_prefix || row.token_id || "legacy"}
          </Text>
        </Stack>
      ),
    },
    {
      id: "action",
      header: person ? "动作 / 对象" : "工具 / 目标",
      render: (row) => (
        <Stack gap={0}>
          <Text size="sm" fw={600} className="mono">
            {text(person ? row.action : row.tool)}
          </Text>
          <Text size="xs" c="dimmed">
            {person
              ? `${row.object_type || ""} ${row.object_id || ""}`
              : row.server || "网关"}
          </Text>
        </Stack>
      ),
    },
    {
      id: "summary",
      header: "操作摘要",
      render: (row) => (
        <Text
          size="sm"
          className="mono wrap-anywhere"
          title={text(
            person
              ? row.summary
              : row.command || row.path,
          )}
        >
          {text(
            person
              ? row.summary
              : row.command || row.path || row.target_host,
          )}
        </Text>
      ),
    },
    {
      id: "status",
      header: "结果",
      sortable: true,
      value: (row) => row.status ?? "",
      render: (row) => <Status value={String(row.status || "pending")} />,
    },
    {
      id: "duration_ms",
      header: "耗时",
      sortable: true,
      value: (row) => row.duration_ms ?? -1,
      render: (row) => (
        <span className="mono nowrap">
          {typeof row.duration_ms === "number" ? `${row.duration_ms} ms` : "—"}
        </span>
      ),
    },
    {
      id: "details",
      header: "详情",
      render: (row) => (
        <ActionIcon
          variant="subtle"
          color="gray"
          aria-label={`查看 ${formatTime(row.ts)} 审计详情`}
          onClick={() => setDetails(row)}
        >
          <ArrowUpRight size={16} aria-hidden="true" />
        </ActionIcon>
      ),
    },
  ];
  const pages = Math.max(1, Math.ceil(data.total / pageSize));
  const hasFilters = Boolean(
    filters.q ||
      filters.status ||
      filters.server ||
      filters.token_id ||
      filters.user_id ||
      filters.days !== "7",
  );
  function clearFilters() {
    setDraft(initialFilters);
    setFilters({ ...initialFilters });
    setPage(0);
  }
  return (
    <>
      <PageHeading
        eyebrow={person ? "PEOPLE ACTIVITY" : "MCP ACTIVITY"}
        title={person ? "人员操作审计" : "MCP 调用审计"}
        description={
          person
            ? "追溯登录、账号、凭证和资源配置的变更。"
            : "查看哪个 token 在什么目标上执行了什么操作，以及调用结果。"
        }
        extra={
          <Button
            variant="default"
            onClick={() => void exportCsv()}
            disabled={exporting}
            leftSection={<Download size={15} aria-hidden="true" />}
          >
            {exporting ? "正在导出…" : "导出 CSV"}
          </Button>
        }
      />
      <Feedback message={exportError} onDismiss={() => setExportError("")} />
      <Card withBorder p="md" radius="md">
        <form className="audit-filter" onSubmit={search}>
          <Group align="center" gap="sm" wrap="wrap" mb="sm">
            <TextInput
              flex={1}
              miw={200}
              aria-label="搜索审计记录"
              value={draft.q}
              placeholder={person ? "动作、对象或人员…" : "命令、路径或工具…"}
              leftSection={<Search size={15} aria-hidden="true" />}
              onChange={(event) => change("q", event.currentTarget.value)}
            />
            <Select
              aria-label="审计时间范围"
              w={150}
              data={daysOptions}
              value={draft.days}
              onChange={(value) => change("days", value ?? "7")}
            />
            <Select
              aria-label="操作结果"
              w={130}
              data={statusOptions}
              value={draft.status}
              onChange={(value) => change("status", value ?? "")}
            />
            {person ? (
              <Select
                aria-label="操作人员"
                w={150}
                data={[
                  { value: "", label: "全部人员" },
                  ...users.users.map((user) => ({
                    value: user.id,
                    label: user.display_name || user.username,
                  })),
                ]}
                value={draft.user_id}
                onChange={(value) => change("user_id", value ?? "")}
              />
            ) : (
              <>
                <Select
                  aria-label="目标服务器"
                  w={150}
                  data={[
                    { value: "", label: "全部服务器" },
                    ...servers.servers.map((server) => ({
                      value: server.alias,
                      label: server.alias,
                    })),
                  ]}
                  value={draft.server}
                  onChange={(value) => change("server", value ?? "")}
                />
                <Select
                  aria-label="调用 token"
                  w={150}
                  data={[
                    { value: "", label: "全部 token" },
                    ...tokens.tokens.map((token) => ({
                      value: token.id,
                      label: token.name,
                    })),
                  ]}
                  value={draft.token_id}
                  onChange={(value) => change("token_id", value ?? "")}
                />
              </>
            )}
            <Button type="submit" disabled={loading}>
              筛选
            </Button>
            <ActionIcon
              variant="default"
              size="input-sm"
              type="button"
              onClick={clearFilters}
              aria-label="清除审计筛选"
            >
              <X size={15} aria-hidden="true" />
            </ActionIcon>
            <ActionIcon
              variant="default"
              size="input-sm"
              type="button"
              onClick={reload}
              disabled={loading}
              aria-label="刷新审计"
            >
              <RefreshCw size={15} aria-hidden="true" />
            </ActionIcon>
          </Group>
        </form>
        <DataTable
          sortable={false}
          stickyHeader
          data={data.records}
          columns={columns}
          rowKey={(row, index) => row.id ?? index}
          loading={loading}
          error={error}
          onRetry={reload}
          empty="当前条件下没有审计记录"
          emptyAction={
            hasFilters ? (
              <Button variant="default" size="xs" onClick={clearFilters}>
                清除筛选
              </Button>
            ) : undefined
          }
        />
        <Group justify="space-between" mt="sm" wrap="nowrap">
          <Text size="xs" c="dimmed">
            共 {data.total} 条记录 · 默认保留 30 天
          </Text>
          <Pagination
            total={pages}
            value={page + 1}
            onChange={(value) => setPage(value - 1)}
            siblings={1}
            boundaries={1}
            size="sm"
            disabled={loading}
          />
        </Group>
      </Card>
      <Text size="xs" c="dimmed" mt="md">
        {person
          ? "秘密字段仅记录更换动作，不展示密码、私钥或 token 明文。"
          : "Token 标识代表调用凭证，不等同于实际使用者身份。旧版记录保留原始身份，不推测 token 归属。"}
      </Text>
      <AppModal
        opened={!!details}
        onClose={() => setDetails(null)}
        title={person ? "人员操作详情" : "MCP 调用详情"}
        description="操作发生时保存的身份与目标快照。"
        size="lg"
      >
        {details && (
          <Stack gap="md">
            <dl className="detail-grid">
              <dt>时间</dt>
              <dd className="mono">{formatTime(details.ts)}</dd>
              <dt>结果</dt>
              <dd>
                <Status value={details.status} />
              </dd>
              <dt>{person ? "操作人员" : "调用 token"}</dt>
              <dd>
                {person
                  ? details.username || details.user || "未认证来源"
                  : details.token_name || details.user || "历史调用"}
              </dd>
              <dt>{person ? "人员 ID" : "Token ID"}</dt>
              <dd className="mono">{text(person ? details.actor_user_id : details.token_id)}</dd>
              <dt>{person ? "动作" : "工具"}</dt>
              <dd className="mono">
                {text(person ? details.action : details.tool)}
              </dd>
              <dt>{person ? "对象" : "服务器别名"}</dt>
              <dd className="mono">
                {person
                  ? `${details.object_type || ""} ${details.object_id || ""}`
                  : text(details.server)}
              </dd>
              {!person && (
                <>
                  <dt>执行目标快照</dt>
                  <dd className="mono">
                    {details.target_host
                      ? `${details.target_username || ""}@${details.target_host}:${details.target_port || 22}`
                      : "旧记录未保存目标快照"}
                  </dd>
                  <dt>结束时间</dt>
                  <dd className="mono">{formatTime(details.ended_at)}</dd>
                  <dt>耗时</dt>
                  <dd className="mono">
                    {details.duration_ms == null
                      ? "—"
                      : `${details.duration_ms} ms`}
                  </dd>
                </>
              )}
              <dt>请求编号</dt>
              <dd className="mono">{text(details.request_id)}</dd>
              <dt>来源 IP</dt>
              <dd className="mono">{text(details.source_ip)}</dd>
            </dl>
            <div>
              <Title order={4} mb={6}>
                {person ? "变更摘要" : "命令 / 文件路径"}
              </Title>
              <pre className="detail-pre">
                {text(
                  person ? details.summary : details.command || details.path,
                )}
              </pre>
            </div>
            {details.error && <Feedback message={details.error} />}
            {details.content_sha256 && (
              <div>
                <Title order={4} mb={6}>
                  传输内容摘要
                </Title>
                <Text size="xs" className="mono wrap-anywhere">
                  {details.content_bytes} bytes
                  <br />
                  SHA-256: {details.content_sha256}
                </Text>
              </div>
            )}
          </Stack>
        )}
      </AppModal>
    </>
  );
}
