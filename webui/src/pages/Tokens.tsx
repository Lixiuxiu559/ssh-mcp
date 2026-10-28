import { useMemo, useState, type FormEvent } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import {
  Plus,
  KeyRound,
  Pencil,
  Ban,
  Copy,
  Code2,
  Search,
  RefreshCw,
} from "lucide-react";
import { api, json } from "../api";
import type { TokenEntry, User } from "../types";
import { useResource } from "../lib/use-resource";
import { errorText, formatTime, copyText } from "../lib/utils";
import { Button } from "../components/ui/button";
import { Modal } from "../components/ui/dialog";
import { Field, Input } from "../components/ui/field";
import { Feedback, Status } from "../components/ui/feedback";
import { DataTable } from "../components/ui/data-table";
import { Switch } from "../components/ui/switch";
function TokenEditor({
  item,
  onClose,
  onSaved,
}: {
  item: TokenEntry | null;
  onClose: () => void;
  onSaved: (value?: { token: string; item: TokenEntry }) => void;
}) {
  const [name, setName] = useState(item?.name || "");
  const [description, setDescription] = useState(item?.description || "");
  const [enabled, setEnabled] = useState(item?.enabled ?? true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (item) {
        await api(
          `/api/tokens/${encodeURIComponent(item.id)}`,
          json("PATCH", { name, description, enabled }),
        );
        onSaved();
      } else
        onSaved(
          await api<{ token: string; item: TokenEntry }>(
            "/api/tokens",
            json("POST", { name, description }),
          ),
        );
    } catch (error) {
      setError(errorText(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
      title={item ? "编辑 MCP token" : "创建 MCP token"}
      description="此凭证用于客户端调用 MCP，不用于网页登录。"
    >
      <form onSubmit={submit} className="form-stack">
        <Feedback message={error} />
        <Field label="Token 名称">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={100}
            placeholder="例如 codex-dev 或 ci-runner"
          />
        </Field>
        <Field label="用途说明（可选）">
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={500}
            placeholder="记录凭证使用场景，便于后续追溯"
          />
        </Field>
        {item && (
          <Switch
            checked={enabled}
            onCheckedChange={setEnabled}
            label="启用此 token"
          />
        )}
        <p className="field-hint">
          {item
            ? "停用将阻止后续 MCP 调用；启用后可继续使用原凭证。"
            : "明文仅在创建完成后显示一次。新 token 不会使已有 token 失效。"}
        </p>
        <div className="dialog-actions right">
          <Button type="button" onClick={onClose} disabled={busy}>
            取消
          </Button>
          <Button variant="primary" type="submit" disabled={busy}>
            {busy ? "正在保存…" : item ? "保存修改" : "创建 token"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
function connectionConfig(token: string) {
  return JSON.stringify(
    {
      mcpServers: {
        ssh: {
          type: "http",
          url: new URL("mcp", location.href).href,
          headers: { Authorization: `Bearer ${token}` },
        },
      },
    },
    null,
    2,
  );
}
export default function Tokens() {
  const { data, loading, error, reload } = useResource<{
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
  const [revoking, setRevoking] = useState<TokenEntry | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [message, setMessage] = useState("");
  const [copyMessage, setCopyMessage] = useState("");
  const filtered = data.tokens.filter((t) =>
    `${t.name} ${t.description} ${t.id}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  async function copy(value: string) {
    try {
      await copyText(value);
      setCopyMessage("已复制到剪贴板。");
    } catch (error) {
      setCopyMessage(errorText(error));
    }
  }
  async function revoke() {
    if (!revoking) return;
    setBusy(true);
    setActionError("");
    try {
      await api(
        `/api/tokens/${encodeURIComponent(revoking.id)}`,
        json("DELETE"),
      );
      setRevoking(null);
      reload();
      setMessage("Token 已吊销，历史调用记录保留。");
    } catch (error) {
      setActionError(errorText(error));
    } finally {
      setBusy(false);
    }
  }
  const columns = useMemo<ColumnDef<TokenEntry, unknown>[]>(
    () => [
      {
        accessorKey: "name",
        header: "Token",
        cell: ({ row }) => (
          <div
            className="name-cell"
            title={row.original.description || undefined}
          >
            <span className="node-icon">
              <KeyRound size={16} />
            </span>
            <span>
              <strong>{row.original.name}</strong>
              <small className="compact-hide">
                {row.original.description || "未添加用途说明"}
              </small>
            </span>
          </div>
        ),
      },
      {
        accessorKey: "prefix",
        header: "凭证标识",
        cell: ({ row }) => (
          <span title={row.original.id} className="mono small">
            {row.original.prefix ||
              `${row.original.id.slice(0, 12)}…`}
          </span>
        ),
      },
      {
        id: "state",
        header: "状态",
        cell: ({ row }) => (
          <Status
            value={
              row.original.revoked
                ? "revoked"
                : row.original.enabled
                  ? "enabled"
                  : "disabled"
            }
          />
        ),
      },
      {
        accessorKey: "last_used_at",
        header: "最近调用",
        cell: ({ getValue }) => (
          <span className="mono small">
            {formatTime(getValue() as string | null)}
          </span>
        ),
      },
      {
        accessorKey: "created_by",
        header: "创建人",
        cell: ({ row }) => (
          <span className="small" title={row.original.created_by || undefined}>
            {people.users.find((user) => user.id === row.original.created_by)
              ?.username ||
              (row.original.created_by
                ? row.original.created_by.slice(0, 12)
                : "历史迁移")}
          </span>
        ),
      },
      {
        accessorKey: "created_at",
        header: "创建时间",
        cell: ({ getValue }) => (
          <span className="mono small">
            {formatTime(getValue() as string | null)}
          </span>
        ),
      },
      {
        id: "actions",
        header: "操作",
        cell: ({ row }) => (
          <div className="row-actions">
            <Button
              variant="quiet"
              onClick={() => {
                setConfigItem(row.original);
                setCopyMessage("");
              }}
              aria-label={`查看 ${row.original.name} 接入配置`}
            >
              <Code2 size={15} />
              接入
            </Button>
            <Button
              variant="quiet"
              className="icon-button"
              aria-label={`编辑 ${row.original.name}`}
              disabled={row.original.revoked}
              onClick={() => setEditor(row.original)}
            >
              <Pencil size={15} />
            </Button>
            <Button
              variant="quiet"
              className="icon-button danger-text"
              aria-label={`吊销 ${row.original.name}`}
              disabled={row.original.revoked}
              onClick={() => {
                setRevoking(row.original);
                setActionError("");
              }}
            >
              <Ban size={15} />
            </Button>
          </div>
        ),
      },
    ],
    [people.users],
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">SERVICE CREDENTIALS</span>
          <h1>MCP Token</h1>
          <p>独立管理客户端凭证，每一次 MCP 调用按 token 留下操作痕迹。</p>
        </div>
        <Button variant="primary" onClick={() => setEditor(null)}>
          <Plus size={16} />
          创建 token
        </Button>
      </div>
      <div className="metric-band">
        <div>
          <span>有效凭证</span>
          <strong>
            {data.tokens.filter((t) => t.enabled && !t.revoked).length}
            <small>个 token</small>
          </strong>
        </div>
        <div>
          <span>已停用或吊销</span>
          <strong>
            {data.tokens.filter((t) => !t.enabled || t.revoked).length}
            <small>个 token</small>
          </strong>
        </div>
        <div>
          <span>凭证生命周期</span>
          <strong className="metric-text">
            独立管理<small>升级保留</small>
          </strong>
        </div>
      </div>
      <Feedback
        message={actionError}
        onDismiss={() => setActionError("")}
      />
      <Feedback
        message={message}
        success
        onDismiss={() => setMessage("")}
      />
      <section className="panel">
        <div className="panel-toolbar">
          <div className="search-input">
            <Search size={16} />
            <input
              aria-label="搜索 token"
              value={query}
              placeholder="搜索名称、用途或标识…"
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <Button variant="quiet" onClick={reload} disabled={loading}>
            <RefreshCw size={15} />
            刷新
          </Button>
        </div>
        <DataTable
          columns={columns}
          data={filtered}
          loading={loading}
          error={error}
          onRetry={reload}
          empty={query ? "没有匹配的 token" : "还没有 token"}
          emptyAction={
            query ? (
              <Button variant="secondary" onClick={() => setQuery("")}>
                清除搜索
              </Button>
            ) : (
              <Button variant="secondary" onClick={() => setEditor(null)}>
                <Plus size={15} />
                创建 token
              </Button>
            )
          }
        />
        <div className="panel-footnote">
          人员账号与服务 token
          独立。创建者只用于管理追溯，不能代表凭证的实际使用者。
        </div>
      </section>
      {editor !== undefined && (
        <TokenEditor
          item={editor}
          onClose={() => setEditor(undefined)}
          onSaved={(value) => {
            setEditor(undefined);
            reload();
            if (value) {
              setCreated(value);
              setCopyMessage("");
            } else setMessage("Token 已更新。");
          }}
        />
      )}
      <Modal
        open={!!created}
        onOpenChange={(open) => {
          if (!open) {
            setCreated(null);
            setCopyMessage("");
          }
        }}
        title="保存你的 MCP token"
        description="明文仅显示这一次，关闭后无法再次读取。"
        wide
      >
        {created && (
          <div className="form-stack">
            <Field label={created.item.name}>
              <textarea
                className="input textarea mono secret-display"
                readOnly
                value={created.token}
                rows={3}
                onFocus={(e) => e.target.select()}
              />
            </Field>
            <Button onClick={() => void copy(created.token)}>
              <Copy size={15} />
              复制 token
            </Button>
            <Field label="客户端接入配置">
              <textarea
                className="input textarea mono config-code"
                readOnly
                rows={10}
                value={connectionConfig(created.token)}
                spellCheck={false}
              />
            </Field>
            <div className="button-row">
              <Button
                onClick={() => void copy(connectionConfig(created.token))}
              >
                <Copy size={15} />
                复制配置
              </Button>
              <span className="small muted" role="status">
                {copyMessage}
              </span>
            </div>
            <div className="dialog-actions right">
              <Button
                variant="primary"
                onClick={() => {
                  setCreated(null);
                  setCopyMessage("");
                }}
              >
                已保存，关闭
              </Button>
            </div>
          </div>
        )}
      </Modal>
      <Modal
        open={!!configItem}
        onOpenChange={(open) => {
          if (!open) setConfigItem(null);
        }}
        title="MCP 客户端接入"
        description="将配置中的占位内容替换为该 token 的真实明文。"
        wide
      >
        <div className="form-stack">
          <Field label="HTTP 接入配置">
            <textarea
              className="input textarea mono config-code"
              rows={10}
              readOnly
              value={connectionConfig("<MCP_TOKEN>")}
              spellCheck={false}
            />
          </Field>
          <div className="button-row">
            <Button onClick={() => void copy(connectionConfig("<MCP_TOKEN>"))}>
              <Copy size={15} />
              复制配置模板
            </Button>
            <span className="muted small" role="status">
              {copyMessage}
            </span>
          </div>
          <p className="small muted">
            凭证标识：{configItem?.id}。服务不再返回已创建 token
            的明文；若丢失，请创建新 token。
          </p>
        </div>
      </Modal>
      <Modal
        open={!!revoking}
        onOpenChange={(open) => {
          if (!open) setRevoking(null);
        }}
        title="吊销 MCP token"
        description="吊销不可恢复。如需暂时停用，可在编辑中关闭启用开关。"
      >
        <p>
          确认吊销 <strong>{revoking?.name}</strong>
          ？使用此凭证的后续调用将被拒绝。
        </p>
        <Feedback
          message={actionError}
          onDismiss={() => setActionError("")}
        />
        <div className="dialog-actions right">
          <Button disabled={busy} onClick={() => setRevoking(null)}>
            取消
          </Button>
          <Button
            variant="danger"
            disabled={busy}
            onClick={() => void revoke()}
          >
            {busy ? "正在吊销…" : "确认吊销"}
          </Button>
        </div>
      </Modal>
    </>
  );
}
