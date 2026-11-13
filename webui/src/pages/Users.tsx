import { useId, useState, type FormEvent } from "react";
import { Plus, Pencil, RefreshCw, Search, UserRound } from "lucide-react";
import {
  Alert,
  Button,
  Card,
  Group,
  PasswordInput,
  Stack,
  Switch,
  Text,
  TextInput,
  ThemeIcon,
} from "@mantine/core";
import { api, json } from "../api";
import type { User } from "../types";
import { useResource } from "../lib/use-resource";
import { errorText, formatTime } from "../lib/utils";
import { DataTable, type TableColumn } from "../components/DataTable";
import { Feedback, Status } from "../components/Feedback";
import { PageHeading } from "../components/PageHeading";
import { AppModal } from "../components/AppModal";

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
  const formId = useId();
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
    <AppModal
      opened
      onClose={() => {
        if (!busy) onClose();
      }}
      title={user ? `编辑用户 · ${user.username}` : "添加用户"}
      description="所有启用人员具有相同的后台管理能力。"
      footer={
        <Group justify="flex-end" gap="sm">
          <Button type="button" variant="default" onClick={onClose} disabled={busy}>
            取消
          </Button>
          <Button type="submit" form={formId} disabled={busy}>
            {busy ? "正在保存…" : "保存用户"}
          </Button>
        </Group>
      }
    >
      <form id={formId} onSubmit={submit}>
        <Stack gap="md">
          <Feedback message={error} />
          <TextInput
            label="用户名"
            value={username}
            onChange={(event) => setUsername(event.currentTarget.value)}
            autoComplete="off"
            required
            disabled={!!user}
            maxLength={64}
          />
          <TextInput
            label="显示名称（可选）"
            value={name}
            onChange={(event) => setName(event.currentTarget.value)}
            maxLength={100}
          />
          <PasswordInput
            label={user ? "重置密码（留空保持原密码）" : "登录密码"}
            description="至少 10 位。修改密码将使该用户的现有网页登录失效。"
            value={password}
            onChange={(event) => setPassword(event.currentTarget.value)}
            required={!user}
            minLength={password ? 10 : undefined}
            maxLength={1024}
            autoComplete="new-password"
          />
          {user && (
            <>
              <Switch
                checked={enabled}
                onChange={(event) => setEnabled(event.currentTarget.checked)}
                label="允许此用户登录"
              />
              <Text size="xs" c="dimmed">
                停用用户会结束其网页登录。该用户创建的 MCP token
                独立管理，不会自动吊销。
              </Text>
            </>
          )}
        </Stack>
      </form>
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
  const filtered = data.users.filter((u) =>
    `${u.username} ${u.display_name}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const columns: TableColumn<User>[] = [
    {
      id: "username",
      header: "用户",
      sortable: true,
      value: (row) => row.username,
      render: (row) => (
        <Group gap="sm" wrap="nowrap">
          <ThemeIcon variant="light" size="sm" radius="xl">
            <UserRound size={14} aria-hidden="true" />
          </ThemeIcon>
          <Stack gap={0}>
            <Text size="sm" fw={600}>
              {row.display_name || row.username}
              {row.id === currentUser.id && (
                <Text span size="xs" c="dimmed" fw={400}>
                  {" "}
                  · 当前用户
                </Text>
              )}
            </Text>
            <Text size="xs" c="dimmed" className="mono">
              {row.username}
            </Text>
          </Stack>
        </Group>
      ),
    },
    {
      id: "enabled",
      header: "登录状态",
      sortable: true,
      value: (row) => (row.enabled ? 1 : 0),
      render: (row) => (
        <Status value={row.enabled ? "enabled" : "disabled"} />
      ),
    },
    {
      id: "last_login_at",
      header: "最近登录",
      sortable: true,
      value: (row) => row.last_login_at ?? "",
      render: (row) => (
        <span className="mono nowrap">{formatTime(row.last_login_at)}</span>
      ),
    },
    {
      id: "created_at",
      header: "创建时间",
      sortable: true,
      value: (row) => row.created_at ?? "",
      render: (row) => (
        <span className="mono nowrap">{formatTime(row.created_at)}</span>
      ),
    },
    {
      id: "actions",
      header: "操作",
      render: (row) => (
        <Button
          variant="subtle"
          size="compact-sm"
          leftSection={<Pencil size={13} aria-hidden="true" />}
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
        eyebrow="PEOPLE"
        title="用户管理"
        description="管理后台登录账号。人员权限一致，MCP token 单独管理。"
        extra={
          <Button
            onClick={() => setEditor(null)}
            leftSection={<Plus size={15} aria-hidden="true" />}
          >
            添加用户
          </Button>
        }
      />
      <Feedback message={message} success onDismiss={() => setMessage("")} />
      <Alert
        variant="light"
        color="gray"
        icon={<UserRound size={17} aria-hidden="true" />}
        mb="md"
      >
        {data.users.filter((u) => u.enabled).length} 位启用用户 ·
        修改账号、凭证和配置的行为会记录到人员操作审计。
      </Alert>
      <Card withBorder p="md" radius="md">
        <Group justify="space-between" mb="sm" wrap="nowrap" gap="sm">
          <TextInput
            w={260}
            aria-label="搜索用户"
            placeholder="搜索用户名或显示名称…"
            leftSection={<Search size={15} aria-hidden="true" />}
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
          <Button
            variant="subtle"
            color="gray"
            onClick={reload}
            disabled={loading}
            leftSection={<RefreshCw size={14} aria-hidden="true" />}
          >
            刷新
          </Button>
        </Group>
        <DataTable
          columns={columns}
          data={filtered}
          rowKey={(row) => row.id}
          loading={loading}
          error={error}
          onRetry={reload}
          empty={query ? "没有匹配的用户" : "还没有用户"}
          emptyAction={
            query ? (
              <Button variant="default" size="xs" onClick={() => setQuery("")}>
                清除搜索
              </Button>
            ) : (
              <Button
                variant="default"
                size="xs"
                onClick={() => setEditor(null)}
                leftSection={<Plus size={14} aria-hidden="true" />}
              >
                添加用户
              </Button>
            )
          }
        />
        <Text size="xs" c="dimmed" mt="sm">
          至少保留一个可登录账号。停用人员不会自动吊销其创建的服务 token。
        </Text>
      </Card>
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
