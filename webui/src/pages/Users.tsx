import { useId, useState } from "react";
import { Plus, Pencil, RefreshCw, Search, UserRound } from "lucide-react";
import {
  Avatar,
  Button,
  Card,
  Flex,
  Form,
  Input,
  Space,
  Switch,
  Typography,
} from "antd";
import { api, json } from "../api";
import type { User } from "../types";
import { useResource } from "../lib/use-resource";
import { errorText, formatTime } from "../lib/utils";
import { DataTable, type TableColumn } from "../components/DataTable";
import { Feedback, Status } from "../components/Feedback";
import { PageHeading } from "../components/PageHeading";
import { AppModal } from "../components/AppModal";

interface UserValues {
  username: string;
  display_name: string;
  password?: string;
  enabled: boolean;
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
                enabled: values.enabled,
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
        disabled={busy}
        initialValues={{
          username: user?.username || "",
          display_name: user?.display_name || "",
          enabled: user?.enabled ?? true,
        }}
      >
        <Form.Item
          name="username"
          label="用户名"
          rules={[{ required: true, message: "请输入用户名" }]}
        >
          <Input autoComplete="off" disabled={!!user || busy} maxLength={64} />
        </Form.Item>
        <Form.Item name="display_name" label="显示名称（可选）">
          <Input maxLength={100} />
        </Form.Item>
        <Form.Item
          name="password"
          label={user ? "重置密码（留空保持原密码）" : "登录密码"}
          extra={user ? "修改密码会结束该用户的现有网页登录。" : undefined}
          rules={[
            { required: !user, message: "请输入登录密码" },
            { min: 10, message: "密码至少需要 10 位" },
          ]}
        >
          <Input.Password
            maxLength={1024}
            autoComplete="new-password"
            placeholder="至少 10 位"
          />
        </Form.Item>
        {user && (
          <Form.Item
            name="enabled"
            label="允许此用户登录"
            valuePropName="checked"
          >
            <Switch checkedChildren="允许" unCheckedChildren="停用" />
          </Form.Item>
        )}
      </Form>
    </AppModal>
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
        <Space>
          <Avatar
            size="small"
            icon={<UserRound size={14} aria-hidden="true" />}
          />
          <Flex vertical>
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
        </Space>
      ),
    },
    {
      id: "enabled",
      header: "登录状态",
      value: (row) => (row.enabled ? 1 : 0),
      render: (row) => <Status value={row.enabled ? "enabled" : "disabled"} />,
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
        <Button
          type="text"
          size="small"
          icon={<Pencil size={13} aria-hidden="true" />}
          onClick={() => setEditor(row)}
        >
          编辑
        </Button>
      ),
    },
  ];
  return (
    <>
      <PageHeading
        title="成员管理"
        extra={
          <Button
            type="primary"
            icon={<Plus size={15} aria-hidden="true" />}
            onClick={() => setEditor(null)}
          >
            添加成员
          </Button>
        }
      />
      <Feedback message={message} success onDismiss={() => setMessage("")} />
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
            {!loading && !error && (
              <Typography.Text type="secondary">
                {data.users.filter((user) => user.enabled).length} 位启用成员
              </Typography.Text>
            )}
            <Button
              type="text"
              onClick={reload}
              disabled={loading}
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
    </>
  );
}
