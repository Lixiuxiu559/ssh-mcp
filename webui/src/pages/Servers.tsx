import { useMemo, useState } from "react";
import {
  Plus,
  Search,
  RefreshCw,
  Pencil,
  Trash2,
  Cable,
  Server as ServerIcon,
  ArrowUpRight,
} from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { api, json } from "../api";
import type { ServerEntry } from "../types";
import { useResource } from "../lib/use-resource";
import { errorText } from "../lib/utils";
import { Button } from "../components/ui/button";
import { DataTable } from "../components/ui/data-table";
import { Feedback, Status } from "../components/ui/feedback";
import { Modal } from "../components/ui/dialog";
import { ServerEditor } from "../components/ServerEditor";
export default function Servers() {
  const { data, loading, error, reload } = useResource<{
    servers: ServerEntry[];
  }>("/api/servers", { servers: [] });
  const [query, setQuery] = useState("");
  const [editor, setEditor] = useState<ServerEntry | null | undefined>(
    undefined,
  );
  const [deleting, setDeleting] = useState<ServerEntry | null>(null);
  const [details, setDetails] = useState<ServerEntry | null>(null);
  const [busy, setBusy] = useState("");
  const [actionError, setActionError] = useState("");
  const [message, setMessage] = useState("");
  const [checks, setChecks] = useState<
    Record<string, { ok: boolean; message: string }>
  >({});
  const filtered = data.servers.filter((s) =>
    `${s.alias} ${s.host} ${s.username} ${s.description} ${s.tags.join(" ")}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
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
      reload();
      setMessage("服务器配置已删除，历史审计保留。");
    } catch (error) {
      setActionError(errorText(error));
    } finally {
      setBusy("");
    }
  }
  const columns = useMemo<ColumnDef<ServerEntry, unknown>[]>(
    () => [
      {
        accessorKey: "alias",
        header: "服务器",
        cell: ({ row }) => (
          <button
            className="name-link"
            onClick={() => setDetails(row.original)}
          >
            <span className="node-icon">
              <ServerIcon size={16} />
            </span>
            <span>
              <strong className="mono">{row.original.alias}</strong>
              <small>{row.original.description || "未添加描述"}</small>
            </span>
          </button>
        ),
      },
      {
        accessorKey: "host",
        header: "目标端点",
        cell: ({ row }) => (
          <span className="mono">
            {row.original.host}
            <span className="muted">:{row.original.port}</span>
          </span>
        ),
      },
      {
        accessorKey: "username",
        header: "远端账号",
        cell: ({ getValue }) => (
          <span className="mono">{String(getValue())}</span>
        ),
      },
      {
        id: "credential",
        header: "凭据",
        cell: ({ row }) => (
          <span className="small">
            {{
              private_key_file: "私钥文件",
              private_key_inline: "内嵌私钥",
              password: "密码",
            }[row.original.credential_type] || row.original.credential_type}
          </span>
        ),
      },
      {
        id: "connection",
        header: "连接检测",
        cell: ({ row }) =>
          checks[row.original.alias] ? (
            <span title={checks[row.original.alias].message}>
              <Status
                value={checks[row.original.alias].ok ? "ok" : "error"}
                label={checks[row.original.alias].ok ? "检测通过" : "连接失败"}
              />
            </span>
          ) : (
            <span className="muted small">尚未检测</span>
          ),
      },
      {
        id: "actions",
        header: "操作",
        cell: ({ row }) => (
          <div className="row-actions">
            <Button
              variant="quiet"
              disabled={!!busy}
              onClick={() => void test(row.original)}
              title="测试连接"
            >
              <Cable size={14} />
              <span>{busy === row.original.alias ? "检测中" : "测试"}</span>
            </Button>
            <Button
              variant="quiet"
              className="icon-button"
              aria-label={`编辑 ${row.original.alias}`}
              onClick={() => setEditor(row.original)}
            >
              <Pencil size={15} />
            </Button>
            <Button
              variant="quiet"
              className="icon-button danger-text"
              aria-label={`删除 ${row.original.alias}`}
              onClick={() => {
                setDeleting(row.original);
                setActionError("");
              }}
            >
              <Trash2 size={15} />
            </Button>
          </div>
        ),
      },
    ],
    [checks, busy],
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">CONNECTIONS</span>
          <h1>服务器</h1>
          <p>集中管理 SSH 目标与凭据，让工具调用连接正确的环境。</p>
        </div>
        <Button variant="primary" onClick={() => setEditor(null)}>
          <Plus size={16} />
          添加服务器
        </Button>
      </div>
      <div className="metric-band">
        <div>
          <span>已配置目标</span>
          <strong>
            {data.servers.length}
            <small>台服务器</small>
          </strong>
        </div>
        <div>
          <span>主机指纹校验</span>
          <strong>
            {data.servers.filter((s) => s.has_known_hosts).length}
            <small>台已配置</small>
          </strong>
        </div>
        <div>
          <span>接入方式</span>
          <strong className="metric-text">
            SSH<small>按别名调用</small>
          </strong>
        </div>
      </div>
      <Feedback message={error || actionError} />
      <Feedback message={message} success />
      <section className="panel">
        <div className="panel-toolbar">
          <div className="search-input">
            <Search size={16} />
            <input
              aria-label="搜索服务器"
              placeholder="搜索别名、主机、标签…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="toolbar-end">
            <span className="muted small">{filtered.length} 台目标</span>
            <Button onClick={reload} disabled={loading} variant="quiet">
              <RefreshCw size={15} />
              刷新
            </Button>
          </div>
        </div>
        <DataTable
          data={filtered}
          columns={columns}
          loading={loading}
          empty={query ? "没有匹配的服务器" : "还没有服务器"}
        />
        <div className="panel-footnote">
          连接状态来自手动测试，不代表持续健康监测。凭据仅用于网关连接，不向客户端返回。
        </div>
      </section>
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
            reload();
            setMessage("服务器配置已保存。");
          }}
        />
      )}
      <Modal
        open={!!deleting}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        title="删除服务器配置"
        description="此操作移除网关配置，不会删除远端主机。"
      >
        <p>
          确认删除 <strong className="mono">{deleting?.alias}</strong>？后续 MCP
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
      <Modal
        open={!!details}
        onOpenChange={(open) => {
          if (!open) setDetails(null);
        }}
        title={details?.alias || "服务器详情"}
        description="当前配置与已观测的连接信息。"
        wide
      >
        {details && (
          <>
            <div className="connection-path">
              <div>
                <span className="node-icon">
                  <ArrowUpRight size={18} />
                </span>
                <strong>运维客户端</strong>
                <small>MCP 调用方</small>
              </div>
              <span className="path-segment">MCP</span>
              <div>
                <span className="node-icon">
                  <Cable size={18} />
                </span>
                <strong>ssh-mcp</strong>
                <small>SSH 网关</small>
              </div>
              <span className="path-segment">SSH :{details.port}</span>
              <div>
                <span className="node-icon">
                  <ServerIcon size={18} />
                </span>
                <strong>{details.alias}</strong>
                <small>{details.host}</small>
              </div>
            </div>
            <p className="muted small">
              此图表示配置的目标路径，不表示存在活跃会话。
            </p>
            <dl className="detail-grid">
              <dt>目标主机</dt>
              <dd className="mono">
                {details.host}:{details.port}
              </dd>
              <dt>远端账号</dt>
              <dd className="mono">{details.username}</dd>
              <dt>主机指纹校验</dt>
              <dd>{details.has_known_hosts ? "已配置" : "未配置"}</dd>
              <dt>标签</dt>
              <dd>{details.tags.join("、") || "—"}</dd>
              <dt>最近手动检测</dt>
              <dd>{checks[details.alias]?.message || "尚未检测"}</dd>
              <dt>描述</dt>
              <dd>{details.description || "—"}</dd>
            </dl>
            <div className="dialog-actions right">
              <Button
                onClick={() => {
                  setDetails(null);
                  setEditor(details);
                }}
              >
                <Pencil size={15} />
                编辑配置
              </Button>
            </div>
          </>
        )}
      </Modal>
    </>
  );
}
