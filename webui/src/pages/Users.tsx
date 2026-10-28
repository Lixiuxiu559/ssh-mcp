import { useMemo, useState, type FormEvent } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus, Pencil, RefreshCw, Search, UserRound } from "lucide-react";
import { api, json } from "../api";
import type { User } from "../types";
import { useResource } from "../lib/use-resource";
import { errorText, formatTime } from "../lib/utils";
import { Button } from "../components/ui/button";
import { Modal } from "../components/ui/dialog";
import { Field, Input, PasswordInput } from "../components/ui/field";
import { Feedback, Status } from "../components/ui/feedback";
import { DataTable } from "../components/ui/data-table";
import { Switch } from "../components/ui/switch";
function UserEditor({
  user,
  onClose,
  onSaved,
}: {
  user: User | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [username, setUsername] = useState(user?.username || "");
  const [name, setName] = useState(user?.display_name || "");
  const [password, setPassword] = useState("");
  const [enabled, setEnabled] = useState(user?.enabled ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      await api(
        user ? `/api/users/${encodeURIComponent(user.id)}` : "/api/users",
        json(
          user ? "PATCH" : "POST",
          user
            ? { display_name: name, enabled, ...(password ? { password } : {}) }
            : { username, display_name: name, password },
        ),
      );
      onSaved();
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
      title={user ? `编辑用户 · ${user.username}` : "添加用户"}
      description="所有启用人员具有相同的后台管理能力。"
    >
      <form onSubmit={submit} className="form-stack">
        <Feedback message={error} />
        <Field label="用户名">
          <Input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="off"
            required
            disabled={!!user}
            maxLength={64}
          />
        </Field>
        <Field label="显示名称（可选）">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={100}
          />
        </Field>
        <Field
          label={user ? "重置密码（留空保持原密码）" : "登录密码"}
          hint="至少 10 位。修改密码将使该用户的现有网页登录失效。"
        >
          <PasswordInput
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required={!user}
            minLength={password ? 10 : undefined}
            maxLength={1024}
            autoComplete="new-password"
          />
        </Field>
        {user && (
          <>
            <Switch
              checked={enabled}
              onCheckedChange={setEnabled}
              label="允许此用户登录"
            />
            <p className="field-hint">
              停用用户会结束其网页登录。该用户创建的 MCP token
              独立管理，不会自动吊销。
            </p>
          </>
        )}
        <div className="dialog-actions right">
          <Button type="button" onClick={onClose} disabled={busy}>
            取消
          </Button>
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? "正在保存…" : "保存用户"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
export default function UsersPage({ currentUser }: { currentUser: User }) {
  const { data, loading, error, reload } = useResource<{ users: User[] }>(
    "/api/users",
    { users: [] },
  );
  const [query, setQuery] = useState("");
  const [editor, setEditor] = useState<User | null | undefined>(undefined);
  const [message, setMessage] = useState("");
  const filtered = data.users.filter((u) =>
    `${u.username} ${u.display_name}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const columns = useMemo<ColumnDef<User, unknown>[]>(
    () => [
      {
        accessorKey: "username",
        header: "用户",
        cell: ({ row }) => (
          <div className="name-cell">
            <span className="node-icon">
              <UserRound size={16} />
            </span>
            <span>
              <strong>
                {row.original.display_name || row.original.username}
                {row.original.id === currentUser.id && (
                  <span className="small muted"> · 当前用户</span>
                )}
              </strong>
              <small className="mono">{row.original.username}</small>
            </span>
          </div>
        ),
      },
      {
        accessorKey: "enabled",
        header: "登录状态",
        cell: ({ row }) => (
          <Status value={row.original.enabled ? "enabled" : "disabled"} />
        ),
      },
      {
        accessorKey: "last_login_at",
        header: "最近登录",
        cell: ({ getValue }) => (
          <span className="mono small">
            {formatTime(getValue() as string | null)}
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
          <Button variant="quiet" onClick={() => setEditor(row.original)}>
            <Pencil size={14} />
            编辑
          </Button>
        ),
      },
    ],
    [currentUser.id],
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">PEOPLE</span>
          <h1>用户管理</h1>
          <p>管理后台登录账号。人员权限一致，MCP token 单独管理。</p>
        </div>
        <Button variant="primary" onClick={() => setEditor(null)}>
          <Plus size={16} />
          添加用户
        </Button>
      </div>
      <Feedback message={message} success onDismiss={() => setMessage("")} />
      <div className="info-strip">
        <UserRound size={17} />
        <span>
          {data.users.filter((u) => u.enabled).length} 位启用用户 ·
          修改账号、凭证和配置的行为会记录到人员操作审计。
        </span>
      </div>
      <section className="panel">
        <div className="panel-toolbar">
          <div className="search-input">
            <Search size={16} />
            <input
              aria-label="搜索用户"
              placeholder="搜索用户名或显示名称…"
              value={query}
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
          empty={query ? "没有匹配的用户" : "还没有用户"}
          emptyAction={
            query ? (
              <Button variant="secondary" onClick={() => setQuery("")}>
                清除搜索
              </Button>
            ) : (
              <Button variant="secondary" onClick={() => setEditor(null)}>
                <Plus size={15} />
                添加用户
              </Button>
            )
          }
        />
        <div className="panel-footnote">
          至少保留一个可登录账号。停用人员不会自动吊销其创建的服务 token。
        </div>
      </section>
      {editor !== undefined && (
        <UserEditor
          user={editor}
          onClose={() => setEditor(undefined)}
          onSaved={() => {
            setEditor(undefined);
            reload();
            setMessage("用户信息已保存。");
          }}
        />
      )}
    </>
  );
}
