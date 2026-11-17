import { useId, useState } from "react";
import { Plus, Pencil, RefreshCw, Search, Trash2 } from "lucide-react";
import {
  Button,
  Card,
  Flex,
  Form,
  Input,
  Space,
  Switch,
  Tooltip,
  Typography,
} from "antd";
import { api, json } from "../api";
import type { User } from "../console-types";
import { useResource } from "../lib/use-resource";
import { errorText, formatTime } from "../lib/utils";
import { DataTable, type TableColumn } from "../components/DataTable";
import { Feedback } from "../components/Feedback";
import { PageHeading } from "../components/PageHeading";
import { AppModal } from "../components/AppModal";
import { characterLengthRule, passwordLengthRule } from "../lib/identity";

interface UserValues {
  username: string;
  display_name: string;
  password?: string;
}

function UserEditor({
  user,
  onClose,
  onSaved,
}: {
  user: User | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const formId = useId();
  async function submit(values: UserValues) {
    if (busy) return;
    setError("");
    setBusy(true);
    try {
      await api(
        user ? `/api/users/${encodeURIComponent(user.id)}` : "/api/users",
        json(
          user ? "PATCH" : "POST",
          user
            ? {
                display_name: values.display_name,
                ...(values.password ? { password: values.password } : {}),
              }
            : {
                username: values.username,
                display_name: values.display_name,
                password: values.password,
              },
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
    <AppModal
      opened
      onClose={() => {
        if (!busy) onClose();
      }}
      busy={busy}
      title={user ? `编辑成员 · ${user.username}` : "添加成员"}
      footer={
        <Space>
          <Button onClick={onClose} disabled={busy}>
            取消
          </Button>
          <Button type="primary" htmlType="submit" form={formId} loading={busy}>
            保存成员
          </Button>
        </Space>
      }
    >
      <Feedback message={error} />
      <Form<UserValues>
        id={formId}
        layout="vertical"
        onFinish={submit}
        scrollToFirstError={{ focus: true }}
        disabled={busy}
        initialValues={{
          username: user?.username || "",
          display_name: user?.display_name || "",
        }}
      >
        <Form.Item
          name="username"
          label="用户名"
          rules={[
            { required: true, whitespace: true, message: "请输入用户名" },
            characterLengthRule(128, "用户名须为 1–128 个字符"),
          ]}
        >
          <Input autoComplete="off" disabled={!!user || busy} />
        </Form.Item>
        <Form.Item name="display_name" label="显示名称（可选）" rules={[characterLengthRule(128, "显示名不能超过 128 个字符")]}>
          <Input />
        </Form.Item>
        <Form.Item
          name="password"
          label={user ? "重置密码（留空保持原密码）" : "登录密码"}
          extra={user ? "修改密码会结束该用户的现有网页登录。" : undefined}
          rules={[
            { required: !user, message: "请输入登录密码" },
            passwordLengthRule(),
          ]}
        >
          <Input.Password
            autoComplete="new-password"
            placeholder="至少 6 位"
          />
        </Form.Item>
      </Form>
    </AppModal>
  );
}

export default function MembersPage({ currentUser }: { currentUser: User }) {
  const { data, setData, loading, error, reload } = useResource<{ users: User[] }>(
    "/api/users",
    { users: [] },
  );
  const [query, setQuery] = useState("");
  const [editor, setEditor] = useState<User | null | undefined>(undefined);
  const [message, setMessage] = useState("");
  const [actionError, setActionError] = useState("");
  const [updatingId, setUpdatingId] = useState("");
  const [deleting, setDeleting] = useState<User | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const [deletingBusy, setDeletingBusy] = useState(false);
  const enabledCount = data.users.filter((user) => user.enabled).length;
  const actionsDisabled = loading || deletingBusy || !!updatingId;
  async function setEnabled(user: User, enabled: boolean) {
    if (actionsDisabled) return;
    if (!enabled && user.enabled && enabledCount <= 1) {
      setActionError("至少保留一个启用成员");
      return;
    }
    setUpdatingId(user.id);
    setActionError("");
    setMessage("");
    try {
      const updated = await api<User>(
        `/api/users/${encodeURIComponent(user.id)}`,
        json("PATCH", { enabled }),
      );
      setData((current) => ({
        users: current.users.map((item) => item.id === updated.id ? updated : item),
      }));
      setMessage(`成员 ${user.username} 已${enabled ? "启用" : "禁用"}。`);
      if (!enabled && user.id === currentUser.id)
        window.dispatchEvent(new Event("session-expired"));
    } catch (error) {
      setActionError(errorText(error));
    } finally {
      setUpdatingId("");
    }
  }
  async function removeUser() {
    if (!deleting || actionsDisabled) return;
    if (deleting.enabled && enabledCount <= 1) {
      setDeleteError("至少保留一个启用成员");
      return;
    }
    setDeletingBusy(true);
    setDeleteError("");
    setMessage("");
    try {
      await api(`/api/users/${encodeURIComponent(deleting.id)}`, json("DELETE"));
      setData((current) => ({
        users: current.users.filter((item) => item.id !== deleting.id),
      }));
      setMessage(`成员 ${deleting.username} 已删除，历史审计和 MCP Token 保留。`);
      setDeleting(null);
      if (deleting.id === currentUser.id)
        window.dispatchEvent(new Event("session-expired"));
    } catch (error) {
      setDeleteError(errorText(error));
    } finally {
      setDeletingBusy(false);
    }
  }
  const filtered = data.users.filter((user) =>
    `${user.username} ${user.display_name}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const columns: TableColumn<User>[] = [
    {
      id: "username",
      header: "用户",
      value: (row) => row.username,
      render: (row) => (
        <Flex vertical align="center">
          <Typography.Text strong>
            {row.display_name || row.username}
            {row.id === currentUser.id && (
              <Typography.Text type="secondary"> · 当前用户</Typography.Text>
            )}
          </Typography.Text>
          {row.display_name && row.display_name !== row.username && (
            <Typography.Text type="secondary">{row.username}</Typography.Text>
          )}
        </Flex>
      ),
    },
    {
      id: "enabled",
      header: "登录状态",
      value: (row) => (row.enabled ? 1 : 0),
      render: (row) => (
        <Tooltip
          title={row.enabled && enabledCount === 1
            ? "至少保留一个启用成员"
            : "禁用会撤销该成员的网页登录会话，MCP Token 独立管理"}
        >
          <Switch
            checked={row.enabled}
            checkedChildren="启用"
            unCheckedChildren="禁用"
            aria-label={`启用 ${row.username}`}
            loading={updatingId === row.id}
            disabled={actionsDisabled || (row.enabled && enabledCount === 1)}
            onChange={(enabled) => void setEnabled(row, enabled)}
          />
        </Tooltip>
      ),
    },
    {
      id: "last_login_at",
      header: "最近登录",
      value: (row) => row.last_login_at ?? "",
      render: (row) => (
        <span className="table-time">{formatTime(row.last_login_at)}</span>
      ),
    },
    {
      id: "created_at",
      header: "创建时间",
      value: (row) => row.created_at ?? "",
      render: (row) => (
        <span className="table-time">{formatTime(row.created_at)}</span>
      ),
    },
    {
      id: "actions",
      header: "操作",
      render: (row) => (
        <Space size={4}>
          <Button
            type="text"
            size="small"
            aria-label={`编辑成员 ${row.username}`}
            icon={<Pencil size={13} aria-hidden="true" />}
            disabled={actionsDisabled}
            onClick={() => setEditor(row)}
          >
            编辑
          </Button>
          <Tooltip title={row.enabled && enabledCount === 1 ? "至少保留一个启用成员" : "删除成员"}>
            <Button
              type="text"
              size="small"
              danger
              aria-label={`删除成员 ${row.username}`}
              icon={<Trash2 size={14} aria-hidden="true" />}
              disabled={actionsDisabled || (row.enabled && enabledCount === 1)}
              onClick={() => {
                setDeleting(row);
                setDeleteError("");
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
      <PageHeading title="成员管理" />
      <Feedback message={message} success onDismiss={() => setMessage("")} />
      <Feedback message={actionError} onDismiss={() => setActionError("")} />
      <Card>
        <Flex
          justify="space-between"
          align="center"
          gap={16}
          style={{ marginBottom: 16 }}
        >
          <Input
            style={{ width: 280 }}
            allowClear
            aria-label="搜索用户"
            placeholder="搜索用户名或显示名称…"
            prefix={<Search size={15} aria-hidden="true" />}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <Space size="middle">
            <Button
              type="primary"
              icon={<Plus size={15} aria-hidden="true" />}
              disabled={actionsDisabled}
              onClick={() => setEditor(null)}
            >
              添加成员
            </Button>
            {!loading && !error && (
              <Typography.Text type="secondary">
                {enabledCount} 位启用成员
              </Typography.Text>
            )}
            <Button
              type="text"
              onClick={reload}
              disabled={actionsDisabled}
              icon={<RefreshCw size={14} aria-hidden="true" />}
            >
              刷新
            </Button>
          </Space>
        </Flex>
        <DataTable
          columns={columns}
          data={filtered}
          rowKey={(row) => row.id}
          loading={loading}
          error={error}
          onRetry={reload}
          empty={query ? "没有匹配的用户" : "还没有用户"}
          emptyDescription={
            query
              ? "请尝试其他用户名或显示名称。"
              : "添加账号后，成员就可以登录管理后台。"
          }
          emptyAction={
            query ? (
              <Button size="small" onClick={() => setQuery("")}>
                清除搜索
              </Button>
            ) : (
              <Button
                size="small"
                onClick={() => setEditor(null)}
                icon={<Plus size={14} aria-hidden="true" />}
              >
                添加成员
              </Button>
            )
          }
        />
      </Card>
      {editor !== undefined && (
        <UserEditor
          user={editor}
          onClose={() => setEditor(undefined)}
          onSaved={() => {
            setEditor(undefined);
            reload();
            setMessage("成员信息已保存。");
          }}
        />
      )}
      <AppModal
        opened={!!deleting}
        onClose={() => { if (!deletingBusy) setDeleting(null); }}
        title="删除成员"
        busy={deletingBusy}
        footer={
          <Space>
            <Button disabled={deletingBusy} onClick={() => setDeleting(null)}>
              取消
            </Button>
            <Button danger type="primary" loading={deletingBusy} onClick={() => void removeUser()}>
              删除成员
            </Button>
          </Space>
        }
      >
        <Typography.Paragraph>
          确认删除成员 <Typography.Text strong>{deleting?.username}</Typography.Text>？
          该成员将无法登录，现有网页登录会话会立即失效。历史审计和已创建的 MCP Token 保留。
        </Typography.Paragraph>
        {deleting?.id === currentUser.id && (
          <Typography.Paragraph>这是你当前登录的账号，删除后将立即退出后台。</Typography.Paragraph>
        )}
        <Feedback message={deleteError} />
      </AppModal>
    </>
  );
}
