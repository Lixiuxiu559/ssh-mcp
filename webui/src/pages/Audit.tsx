import { useMemo, useState, type FormEvent } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import {
  Download,
  RefreshCw,
  Search,
  ChevronLeft,
  ChevronRight,
  ArrowUpRight,
  X,
} from "lucide-react";
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
import { DataTable } from "../components/ui/data-table";
import { Button } from "../components/ui/button";
import { Feedback, Status } from "../components/ui/feedback";
import { Modal } from "../components/ui/dialog";
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
  const columns = useMemo<ColumnDef<AuditRecord, unknown>[]>(
    () => [
      {
        accessorKey: "ts",
        header: "时间",
        cell: ({ getValue }) => (
          <span className="mono small nowrap">
            {formatTime(getValue() as string)}
          </span>
        ),
      },
      {
        id: "identity",
        header: person ? "操作人员" : "调用凭证",
        cell: ({ row }) => (
          <div className="identity-cell">
            <strong>
              {person
                ? row.original.username || row.original.user || "未认证来源"
                : row.original.token_name || row.original.user || "历史调用"}
            </strong>
            <small className="mono">
              {person
                ? row.original.actor_user_id || row.original.source_ip || "—"
                : row.original.token_prefix ||
                  row.original.token_id ||
                  "legacy"}
            </small>
          </div>
        ),
      },
      {
        id: "action",
        header: person ? "动作 / 对象" : "工具 / 目标",
        cell: ({ row }) => (
          <div className="identity-cell">
            <strong className="mono">
              {text(person ? row.original.action : row.original.tool)}
            </strong>
            <small>
              {person
                ? `${row.original.object_type || ""} ${row.original.object_id || ""}`
                : row.original.server || "网关"}
            </small>
          </div>
        ),
      },
      {
        id: "summary",
        header: "操作摘要",
        cell: ({ row }) => (
          <span
            className="audit-summary mono"
            title={text(
              person
                ? row.original.summary
                : row.original.command || row.original.path,
            )}
          >
            {text(
              person
                ? row.original.summary
                : row.original.command ||
                    row.original.path ||
                    row.original.target_host,
            )}
          </span>
        ),
      },
      {
        accessorKey: "status",
        header: "结果",
        cell: ({ getValue }) => (
          <Status value={String(getValue() || "pending")} />
        ),
      },
      {
        accessorKey: "duration_ms",
        header: "耗时",
        cell: ({ getValue }) => (
          <span className="mono small nowrap">
            {typeof getValue() === "number" ? `${getValue()} ms` : "—"}
          </span>
        ),
      },
      {
        id: "details",
        header: "详情",
        cell: ({ row }) => (
          <Button
            variant="quiet"
            className="icon-button"
            aria-label={`查看 ${formatTime(row.original.ts)} 审计详情`}
            onClick={() => setDetails(row.original)}
          >
            <ArrowUpRight size={16} />
          </Button>
        ),
      },
    ],
    [person],
  );
  const pages = Math.max(1, Math.ceil(data.total / pageSize));
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">
            {person ? "PEOPLE ACTIVITY" : "MCP ACTIVITY"}
          </span>
          <h1>{person ? "人员操作审计" : "MCP 调用审计"}</h1>
          <p>
            {person
              ? "追溯登录、账号、凭证和资源配置的变更。"
              : "查看哪个 token 在什么目标上执行了什么操作，以及调用结果。"}
          </p>
        </div>
        <Button onClick={() => void exportCsv()} disabled={exporting}>
          <Download size={16} />
          {exporting ? "正在导出…" : "导出 CSV"}
        </Button>
      </div>
      <Feedback message={error || exportError} />
      <section className="panel">
        <form className="audit-filter" onSubmit={search}>
          <div className="search-input">
            <Search size={16} />
            <input
              aria-label="搜索审计记录"
              value={draft.q}
              placeholder={person ? "动作、对象或人员…" : "命令、路径或工具…"}
              onChange={(e) => change("q", e.target.value)}
            />
          </div>
          <select
            className="input filter-select"
            aria-label="审计时间范围"
            value={draft.days}
            onChange={(e) => change("days", e.target.value)}
          >
            <option value="1">最近 24 小时</option>
            <option value="7">最近 7 天</option>
            <option value="30">最近 30 天</option>
            <option value="all">全部留存记录</option>
          </select>
          <select
            className="input filter-select"
            aria-label="操作结果"
            value={draft.status}
            onChange={(e) => change("status", e.target.value)}
          >
            <option value="">全部结果</option>
            <option value="ok">成功</option>
            <option value="error">失败</option>
            <option value="denied">已拒绝</option>
            <option value="timeout">超时</option>
            <option value="cancelled">已取消</option>
            <option value="pending">未完成</option>
          </select>
          {person ? (
            <select
              className="input filter-select"
              aria-label="操作人员"
              value={draft.user_id}
              onChange={(e) => change("user_id", e.target.value)}
            >
              <option value="">全部人员</option>
              {users.users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.display_name || user.username}
                </option>
              ))}
            </select>
          ) : (
            <>
              <select
                className="input filter-select"
                aria-label="目标服务器"
                value={draft.server}
                onChange={(e) => change("server", e.target.value)}
              >
                <option value="">全部服务器</option>
                {servers.servers.map((server) => (
                  <option key={server.alias} value={server.alias}>
                    {server.alias}
                  </option>
                ))}
              </select>
              <select
                className="input filter-select"
                aria-label="调用 token"
                value={draft.token_id}
                onChange={(e) => change("token_id", e.target.value)}
              >
                <option value="">全部 token</option>
                {tokens.tokens.map((token) => (
                  <option key={token.id} value={token.id}>
                    {token.name}
                  </option>
                ))}
              </select>
            </>
          )}
          <div className="button-row">
            <Button type="submit" variant="primary" disabled={loading}>
              筛选
            </Button>
            <Button
              type="button"
              variant="quiet"
              onClick={() => {
                setDraft(initialFilters);
                setFilters({ ...initialFilters });
                setPage(0);
              }}
              aria-label="清除审计筛选"
            >
              <X size={15} />
            </Button>
            <Button
              type="button"
              variant="quiet"
              onClick={reload}
              disabled={loading}
              aria-label="刷新审计"
            >
              <RefreshCw size={15} />
            </Button>
          </div>
        </form>
        <DataTable
          sortable={false}
          data={data.records}
          columns={columns}
          loading={loading}
          empty="当前条件下没有审计记录"
        />
        <div className="table-pagination">
          <span className="muted small">
            共 {data.total} 条记录 · 默认保留 30 天
          </span>
          <div className="button-row">
            <Button
              variant="quiet"
              className="icon-button"
              aria-label="上一页"
              disabled={page === 0 || loading}
              onClick={() => setPage(page - 1)}
            >
              <ChevronLeft size={17} />
            </Button>
            <span className="mono small">
              {page + 1} / {pages}
            </span>
            <Button
              variant="quiet"
              className="icon-button"
              aria-label="下一页"
              disabled={page + 1 >= pages || loading}
              onClick={() => setPage(page + 1)}
            >
              <ChevronRight size={17} />
            </Button>
          </div>
        </div>
      </section>
      <p className="page-note">
        {person
          ? "秘密字段仅记录更换动作，不展示密码、私钥或 token 明文。"
          : "Token 标识代表调用凭证，不等同于实际使用者身份。旧版记录保留原始身份，不推测 token 归属。"}
      </p>
      <Modal
        open={!!details}
        onOpenChange={(open) => {
          if (!open) setDetails(null);
        }}
        title={person ? "人员操作详情" : "MCP 调用详情"}
        description="操作发生时保存的身份与目标快照。"
        wide
      >
        {details && (
          <>
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
              <dd className="mono wrap">
                {text(person ? details.actor_user_id : details.token_id)}
              </dd>
              <dt>{person ? "动作" : "工具"}</dt>
              <dd className="mono">
                {text(person ? details.action : details.tool)}
              </dd>
              <dt>{person ? "对象" : "服务器别名"}</dt>
              <dd className="mono wrap">
                {person
                  ? `${details.object_type || ""} ${details.object_id || ""}`
                  : text(details.server)}
              </dd>
              {!person && (
                <>
                  <dt>执行目标快照</dt>
                  <dd className="mono wrap">
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
              <dd className="mono wrap">{text(details.request_id)}</dd>
              <dt>来源 IP</dt>
              <dd className="mono">{text(details.source_ip)}</dd>
            </dl>
            <div className="detail-block">
              <h3>{person ? "变更摘要" : "命令 / 文件路径"}</h3>
              <pre>
                {text(
                  person ? details.summary : details.command || details.path,
                )}
              </pre>
            </div>
            {details.error && <Feedback message={details.error} />}
            {details.content_sha256 && (
              <div className="detail-block">
                <h3>传输内容摘要</h3>
                <p className="small mono wrap">
                  {details.content_bytes} bytes
                  <br />
                  SHA-256: {details.content_sha256}
                </p>
              </div>
            )}
          </>
        )}
      </Modal>
    </>
  );
}
