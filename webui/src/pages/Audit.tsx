import { useMemo, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import {
  Button,
  Card,
  Descriptions,
  Flex,
  Select,
  Typography,
} from "antd";
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
import { useListPagination } from "../lib/pagination";
import {
  personActionLabel,
  personObjectLabel,
  personSummaryLabel,
} from "../lib/audit-labels";
import { DataTable, type TableColumn } from "../components/DataTable";
import { Feedback, Status } from "../components/Feedback";
import { ListNotice } from "../components/ListStates";
import { PageHeading } from "../components/PageHeading";
import { AppModal } from "../components/AppModal";
import { AuditToolbar } from "../components/AuditToolbar";

const { Text, Title } = Typography;

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
function hasActiveFilters(filters: Filters) {
  return Boolean(
    filters.q ||
      filters.status ||
      filters.server ||
      filters.token_id ||
      filters.user_id ||
      filters.days !== initialFilters.days,
  );
}

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

export default function Audit({ kind }: { kind: AuditKind }) {
  const person = kind === "person";
  const [draft, setDraft] = useState(initialFilters);
  const [filters, setFilters] = useState(initialFilters);
  const { pagination, resetPage } = useListPagination();
  const { current, pageSize } = pagination;
  const [details, setDetails] = useState<AuditRecord | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const params = useMemo(() => {
    const value = filterParams(filters);
    value.set("kind", kind);
    value.set("limit", String(pageSize));
    value.set("offset", String((current - 1) * pageSize));
    return value.toString();
  }, [filters, current, pageSize, kind]);
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
  function search() {
    resetPage();
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
      width: 184,
      value: (row) => row.ts,
      render: (row) => <span className="table-time">{formatTime(row.ts)}</span>,
    },
    {
      id: "identity",
      header: person ? "操作人员" : "调用凭证",
      width: "16%",
      render: (row) => (
        <Flex vertical gap={0} align="center" style={{ minWidth: 0 }}>
          <Text ellipsis strong>
            {person
              ? row.username || row.user || "未认证来源"
              : row.token_name || row.user || "历史调用"}
          </Text>
          {!person && (row.workspace_name || row.workspace_id) && (
            <Text ellipsis type="secondary" title={row.workspace_id || undefined}>{row.workspace_name || row.workspace_id}</Text>
          )}
          {!person && (
            <Text ellipsis type="secondary" className="mono">
              {row.token_prefix || row.token_id || "legacy"}
            </Text>
          )}
        </Flex>
      ),
    },
    {
      id: "action",
      header: person ? "操作 / 对象" : "工具 / 目标",
      width: "18%",
      render: (row) => (
        <Flex vertical gap={0} align="center" style={{ minWidth: 0 }}>
          <Text ellipsis strong className={person ? undefined : "mono"}>
            {person ? personActionLabel(row.action) : text(row.tool)}
          </Text>
          <Text ellipsis type="secondary">
            {person
              ? personObjectLabel(row, users.users)
              : row.server || "网关"}
          </Text>
        </Flex>
      ),
    },
    {
      id: "summary",
      header: "操作摘要",
      render: (row) => {
        const summary = text(
          person
            ? personSummaryLabel(row)
            : row.command || row.path || row.target_host,
        );
        return (
          <Text ellipsis title={summary} style={{ display: "block" }}>
            {summary}
          </Text>
        );
      },
    },
    {
      id: "status",
      header: "结果",
      width: 98,
      sortable: true,
      value: (row) => row.status ?? "",
      render: (row) => <Status value={String(row.status || "pending")} />,
    },
    {
      id: "duration_ms",
      header: "耗时",
      width: 108,
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
      width: 70,
      align: "center",
      render: (row) => (
        <Button
          type="text"
          size="small"
          aria-label={`查看 ${formatTime(row.ts)} 审计详情`}
          onClick={() => setDetails(row)}
        >
          <ArrowUpRight size={16} aria-hidden="true" />
        </Button>
      ),
    },
  ];
  const hasFilters = hasActiveFilters(filters);
  const empty = !loading && !error && data.records.length === 0;
  function clearFilters() {
    setDraft(initialFilters);
    setFilters({ ...initialFilters });
    resetPage();
  }
  return (
    <>
      <PageHeading title={person ? "人员操作审计" : "MCP 调用审计"} />
      <Feedback message={exportError} onDismiss={() => setExportError("")} />
      <Card>
        <AuditToolbar
          draft={draft}
          onChange={change}
          searchPlaceholder={person ? "动作、对象或人员…" : "命令、路径或工具…"}
          statusValues={["", "ok", "error", "denied", "timeout", "cancelled", "pending"]}
          loading={loading}
          exporting={exporting}
          showClear={(hasActiveFilters(draft) || hasFilters) && !(empty && hasFilters)}
          onSearch={search}
          onClear={clearFilters}
          onRefresh={reload}
          onExport={exportCsv}
          resourceFilter={!person && (
            <Select
              aria-label="目标服务器"
              style={{ width: 150 }}
              options={[
                { value: "", label: "全部服务器" },
                ...servers.servers.map((server) => ({
                  value: server.alias,
                  label: server.alias,
                })),
              ]}
              value={draft.server}
              onChange={(value) => change("server", value ?? "")}
            />
          )}
          identityFilter={person ? (
            <Select
              aria-label="操作人员"
              style={{ width: 150 }}
              options={[
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
            <Select
              aria-label="调用 token"
              style={{ width: 150 }}
              options={[
                { value: "", label: "全部 token" },
                ...tokens.tokens.map((token) => ({
                  value: token.id,
                  label: token.name,
                })),
              ]}
              value={draft.token_id}
              onChange={(value) => change("token_id", value ?? "")}
            />
          )}
        />
        {empty ? (
          <ListNotice
            title={
              hasFilters ? "没有符合筛选条件的记录" : "最近 7 天暂无审计记录"
            }
            description={
              hasFilters
                ? "调整时间范围或清除筛选条件后再试。"
                : person
                  ? "登录后台或变更配置后，这里会显示操作记录。"
                  : "通过 MCP 客户端调用工具后，这里会显示调用记录。"
            }
            onClear={hasFilters ? clearFilters : undefined}
            action={
              !hasFilters && (
                <Button
                  size="small"
                  onClick={() => {
                    const all = { ...initialFilters, days: "all" };
                    setDraft(all);
                    setFilters(all);
                    resetPage();
                  }}
                >
                  查看全部留存记录
                </Button>
              )
            }
          />
        ) : (
          <DataTable
            sortable={false}
            pagination={{
              ...pagination,
              total: data.total,
              disabled: loading,
            }}
            fixedLayout
            minWidth={person ? 760 : 840}
            data={data.records}
            columns={
              person
                ? columns.filter((column) => column.id !== "duration_ms")
                : columns
            }
            rowKey={(row, index) => row.id ?? index}
            loading={loading}
            error={error}
            onRetry={reload}
          />
        )}
      </Card>
      <AppModal
        opened={!!details}
        onClose={() => setDetails(null)}
        title={person ? "人员操作详情" : "MCP 调用详情"}
        size="lg"
      >
        {details && (
          <Flex vertical gap={20}>
            <Descriptions
              column={1}
              size="small"
              items={[
                {
                  key: "time",
                  label: "时间",
                  children: formatTime(details.ts),
                },
                {
                  key: "status",
                  label: "结果",
                  children: <Status value={details.status} />,
                },
                {
                  key: "identity",
                  label: person ? "操作人员" : "调用 Token",
                  children: person
                    ? details.username || details.user || "未认证来源"
                    : details.token_name || details.user || "历史调用",
                },
                {
                  key: "workspace",
                  label: "工作空间",
                  children: <Text className="wrap-anywhere" title={details.workspace_id || undefined}>{details.workspace_name || details.workspace_id || "—"}</Text>,
                },
                {
                  key: "identity-id",
                  label: person ? "人员 ID" : "Token ID",
                  children: (
                    <Text className="mono wrap-anywhere">
                      {text(person ? details.actor_user_id : details.token_id)}
                    </Text>
                  ),
                },
                {
                  key: "action",
                  label: person ? "操作" : "工具",
                  children: person
                    ? personActionLabel(details.action)
                    : text(details.tool),
                },
                {
                  key: "object",
                  label: person ? "对象" : "服务器别名",
                  children: person
                    ? personObjectLabel(details, users.users)
                    : text(details.server),
                },
                ...(person
                  ? [
                      {
                        key: "action-code",
                        label: "事件代码",
                        children: text(details.action),
                      },
                      {
                        key: "object-id",
                        label: "对象 ID",
                        children: (
                          <Text className="mono wrap-anywhere">
                            {text(details.object_id)}
                          </Text>
                        ),
                      },
                    ]
                  : []),
                ...(!person
                  ? [
                      {
                        key: "target",
                        label: "执行目标快照",
                        children: details.target_host
                          ? `${details.target_username || ""}@${details.target_host}:${details.target_port || 22}`
                          : "旧记录未保存目标快照",
                      },
                      {
                        key: "end",
                        label: "结束时间",
                        children: formatTime(details.ended_at),
                      },
                      {
                        key: "duration",
                        label: "耗时",
                        children:
                          details.duration_ms == null
                            ? "—"
                            : `${details.duration_ms} ms`,
                      },
                    ]
                  : []),
                {
                  key: "request",
                  label: "请求编号",
                  children: (
                    <Text className="mono wrap-anywhere">
                      {text(details.request_id)}
                    </Text>
                  ),
                },
                {
                  key: "source",
                  label: "来源 IP",
                  children: text(details.source_ip),
                },
              ]}
            />
            <div>
              <Title level={5} style={{ marginTop: 0, marginBottom: 8 }}>
                {person ? "变更摘要" : "命令 / 文件路径"}
              </Title>
              <pre className="detail-pre">
                {text(
                  person
                    ? personSummaryLabel(details)
                    : details.command || details.path || details.target_host,
                )}
              </pre>
            </div>
            {details.error && <Feedback message={details.error} />}
            {details.content_sha256 && (
              <div>
                <Title level={5} style={{ marginTop: 0, marginBottom: 8 }}>
                  传输内容摘要
                </Title>
                <Text className="mono wrap-anywhere">
                  {details.content_bytes} bytes
                  <br />
                  SHA-256: {details.content_sha256}
                </Text>
              </div>
            )}
          </Flex>
        )}
      </AppModal>
    </>
  );
}
