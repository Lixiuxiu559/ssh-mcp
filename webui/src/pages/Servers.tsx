import { Fragment, useState } from "react";
import { Plus, ChevronRight } from "lucide-react";
import { api, json } from "../api";
import type { AuditRecord, ServerEntry } from "../types";
import { useResource } from "../lib/use-resource";
import { errorText, formatCompactTime } from "../lib/utils";
import { Button } from "../components/ui/button";
import { Feedback, Status } from "../components/ui/feedback";
import { Modal } from "../components/ui/dialog";
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
    <button className="server-row" onClick={onOpen}>
      <div>
        <div className="server-row-title">
          <strong>{server.alias}</strong>
          <Status
            value={check ? (check.ok ? "ok" : "error") : "unchecked"}
            label={check ? (check.ok ? "检测通过" : "连接失败") : "尚未检测"}
          />
        </div>
        <p>
          {server.tags[0] || "未分组"} · {server.host}:{server.port}
        </p>
        <small>
          {audit.loading
            ? "正在读取调用记录…"
            : audit.error
              ? "调用记录暂不可用"
              : `24h ${audit.data.total} 次 · 最近 ${latest ? formatCompactTime(latest.ts) : "暂无调用"}`}
        </small>
        {check && !check.ok && <p className="danger-text">{check.message}</p>}
      </div>
      <ChevronRight size={14} />
    </button>
  );
}
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
          <div className="page-heading">
            <div>
              <h1>服务器管理</h1>
              <p>管理网关连接的 Linux 目标服务器</p>
            </div>
            <Button variant="primary" onClick={() => setEditor(null)}>
              <Plus size={14} />
              新增
            </Button>
          </div>
          <section className="panel server-filter-panel">
            <input
              className="input"
              aria-label="搜索服务器"
              placeholder="搜索服务器名称..."
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <div className="server-filter-options">
              <select
                className="input"
                aria-label="筛选服务器标签"
                value={tag}
                onChange={(event) => setTag(event.target.value)}
              >
                <option value="">全部环境</option>
                {tags.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
              <select
                className="input"
                aria-label="筛选连接检测"
                value={connection}
                onChange={(event) => setConnection(event.target.value)}
              >
                <option value="">全部状态</option>
                <option value="ok">检测通过</option>
                <option value="error">连接失败</option>
                <option value="unchecked">尚未检测</option>
              </select>
            </div>
            <div className="server-filter-summary">
              <span>
                共 {loading || error ? "—" : filtered.length} 台服务器
              </span>
              <Button variant="quiet" onClick={clearFilters}>
                重置筛选
              </Button>
            </div>
          </section>
          <Feedback message={error} />
          <section className="panel server-list" aria-busy={loading}>
            {filtered.map((server) => (
              <Fragment key={server.alias}>
                <ServerRow
                  server={server}
                  check={checks[server.alias]}
                  onOpen={() => {
                    setDetails(server);
                    setActionError("");
                  }}
                />
                <div className="server-list-divider" aria-hidden="true" />
              </Fragment>
            ))}
            {!filtered.length && (
              <div className="table-empty">
                <strong>
                  {loading
                    ? "正在读取…"
                    : error
                      ? "服务器加载失败"
                      : hasFilters
                        ? "没有匹配的服务器"
                        : "还没有服务器"}
                </strong>
                {!loading && (
                  <Button
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
              </div>
            )}
          </section>
          <p className="page-note">
            连接状态为本页手动检测结果，不代表持续健康监测。
          </p>
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
      <Modal
        open={!!deleting}
        onOpenChange={(open) => {
          if (!open && !busy) setDeleting(null);
        }}
        title="删除服务器配置"
        description="此操作移除网关配置，不会删除远端主机。"
      >
        <p>
          确认删除 <strong>{deleting?.alias}</strong>？后续 MCP
          调用将无法再使用此别名。
        </p>
        <Feedback message={actionError} />
        <div className="dialog-actions right">
          <Button onClick={() => setDeleting(null)} disabled={!!busy}>
            取消
          </Button>
          <Button
            variant="danger"
            onClick={() => void remove()}
            disabled={!!busy}
          >
            {busy ? "正在删除…" : "删除配置"}
          </Button>
        </div>
      </Modal>
    </>
  );
}
