import { useId, useState, type FormEvent } from "react";
import {
  Ban,
  Code2,
  Copy,
  KeyRound,
  Pencil,
  Plus,
  RefreshCw,
  Search,
} from "lucide-react";
import {
  ActionIcon,
  Button,
  Card,
  Group,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  TextInput,
  Textarea,
  ThemeIcon,
} from "@mantine/core";
import { api, json } from "../api";
import type { TokenEntry, User } from "../types";
import { useResource } from "../lib/use-resource";
import { errorText, formatTime, copyText } from "../lib/utils";
import { DataTable, type TableColumn } from "../components/DataTable";
import { Feedback, Status } from "../components/Feedback";
import { PageHeading } from "../components/PageHeading";
import { AppModal } from "../components/AppModal";

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
  const formId = useId();
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
    <AppModal
      opened
      onClose={() => {
        if (!busy) onClose();
      }}
      title={item ? "编辑 MCP token" : "创建 MCP token"}
      description="此凭证用于客户端调用 MCP，不用于网页登录。"
      footer={
        <Group justify="flex-end" gap="sm">
          <Button type="button" variant="default" onClick={onClose} disabled={busy}>
            取消
          </Button>
          <Button type="submit" form={formId} disabled={busy}>
            {busy ? "正在保存…" : item ? "保存修改" : "创建 token"}
          </Button>
        </Group>
      }
    >
      <form id={formId} onSubmit={submit}>
        <Stack gap="md">
          <Feedback message={error} />
          <TextInput
            label="Token 名称"
            value={name}
            onChange={(event) => setName(event.currentTarget.value)}
            required
            maxLength={100}
            placeholder="例如 codex-dev 或 ci-runner"
          />
          <TextInput
            label="用途说明（可选）"
            value={description}
            onChange={(event) => setDescription(event.currentTarget.value)}
            maxLength={500}
            placeholder="记录凭证使用场景，便于后续追溯"
          />
          {item && (
            <Switch
              checked={enabled}
              onChange={(event) => setEnabled(event.currentTarget.checked)}
              label="启用此 token"
            />
          )}
          <Text size="xs" c="dimmed">
            {item
              ? "停用将阻止后续 MCP 调用；启用后可继续使用原凭证。"
              : "明文仅在创建完成后显示一次。新 token 不会使已有 token 失效。"}
          </Text>
        </Stack>
      </form>
    </AppModal>
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
  const columns: TableColumn<TokenEntry>[] = [
    {
      id: "name",
      header: "Token",
      sortable: true,
      value: (row) => row.name,
      render: (row) => (
        <Group gap="sm" wrap="nowrap" title={row.description || undefined}>
          <ThemeIcon variant="light" size="sm" radius="xl">
            <KeyRound size={14} aria-hidden="true" />
          </ThemeIcon>
          <Stack gap={0}>
            <Text size="sm" fw={600}>
              {row.name}
            </Text>
            <Text size="xs" c="dimmed" visibleFrom="md">
              {row.description || "未添加用途说明"}
            </Text>
          </Stack>
        </Group>
      ),
    },
    {
      id: "prefix",
      header: "凭证标识",
      sortable: true,
      value: (row) => row.prefix,
      render: (row) => (
        <span title={row.id} className="mono nowrap">
          {row.prefix || `${row.id.slice(0, 12)}…`}
        </span>
      ),
    },
    {
      id: "state",
      header: "状态",
      sortable: true,
      value: (row) => (row.revoked ? 0 : row.enabled ? 2 : 1),
      render: (row) => (
        <Status
          value={
            row.revoked
              ? "revoked"
              : row.enabled
                ? "enabled"
                : "disabled"
          }
        />
      ),
    },
    {
      id: "last_used_at",
      header: "最近调用",
      sortable: true,
      value: (row) => row.last_used_at ?? "",
      render: (row) => (
        <span className="mono nowrap">{formatTime(row.last_used_at)}</span>
      ),
    },
    {
      id: "created_by",
      header: "创建人",
      sortable: true,
      value: (row) => row.created_by ?? "",
      render: (row) => (
        <Text size="sm" title={row.created_by || undefined}>
          {people.users.find((user) => user.id === row.created_by)
            ?.username ||
            (row.created_by ? row.created_by.slice(0, 12) : "历史迁移")}
        </Text>
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
        <Group gap="xs" wrap="nowrap">
          <Button
            variant="subtle"
            size="compact-sm"
            onClick={() => {
              setConfigItem(row);
              setCopyMessage("");
            }}
            aria-label={`查看 ${row.name} 接入配置`}
            leftSection={<Code2 size={14} aria-hidden="true" />}
          >
            接入
          </Button>
          <ActionIcon
            variant="subtle"
            color="gray"
            aria-label={`编辑 ${row.name}`}
            disabled={row.revoked}
            onClick={() => setEditor(row)}
          >
            <Pencil size={15} aria-hidden="true" />
          </ActionIcon>
          <ActionIcon
            variant="subtle"
            color="red"
            aria-label={`吊销 ${row.name}`}
            disabled={row.revoked}
            onClick={() => {
              setRevoking(row);
              setActionError("");
            }}
          >
            <Ban size={15} aria-hidden="true" />
          </ActionIcon>
        </Group>
      ),
    },
  ];
  return (
    <>
      <PageHeading
        eyebrow="SERVICE CREDENTIALS"
        title="MCP Token"
        description="独立管理客户端凭证，每一次 MCP 调用按 token 留下操作痕迹。"
        extra={
          <Button
            onClick={() => setEditor(null)}
            leftSection={<Plus size={15} aria-hidden="true" />}
          >
            创建 token
          </Button>
        }
      />
      <SimpleGrid cols={{ base: 1, xs: 3 }} spacing="md" mb="md">
        <Card withBorder p="md" radius="md">
          <Text size="xs" c="dimmed" fw={600}>
            有效凭证
          </Text>
          <Text fz={22} fw={700} lh={1.2} mt={4}>
            {data.tokens.filter((t) => t.enabled && !t.revoked).length}
            <Text span size="xs" c="dimmed" fw={400} ml={6}>
              个 token
            </Text>
          </Text>
        </Card>
        <Card withBorder p="md" radius="md">
          <Text size="xs" c="dimmed" fw={600}>
            已停用或吊销
          </Text>
          <Text fz={22} fw={700} lh={1.2} mt={4}>
            {data.tokens.filter((t) => !t.enabled || t.revoked).length}
            <Text span size="xs" c="dimmed" fw={400} ml={6}>
              个 token
            </Text>
          </Text>
        </Card>
        <Card withBorder p="md" radius="md">
          <Text size="xs" c="dimmed" fw={600}>
            凭证生命周期
          </Text>
          <Text fz={22} fw={700} lh={1.2} mt={4}>
            独立管理
            <Text span size="xs" c="dimmed" fw={400} ml={6}>
              升级保留
            </Text>
          </Text>
        </Card>
      </SimpleGrid>
      <Feedback message={actionError} onDismiss={() => setActionError("")} />
      <Feedback message={message} success onDismiss={() => setMessage("")} />
      <Card withBorder p="md" radius="md">
        <Group justify="space-between" mb="sm" wrap="nowrap" gap="sm">
          <TextInput
            w={260}
            aria-label="搜索 token"
            placeholder="搜索名称、用途或标识…"
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
          empty={query ? "没有匹配的 token" : "还没有 token"}
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
                创建 token
              </Button>
            )
          }
        />
        <Text size="xs" c="dimmed" mt="sm">
          人员账号与服务 token
          独立。创建者只用于管理追溯，不能代表凭证的实际使用者。
        </Text>
      </Card>
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
      <AppModal
        opened={!!created}
        onClose={() => {
          setCreated(null);
          setCopyMessage("");
        }}
        title="保存你的 MCP token"
        description="明文仅显示这一次，关闭后无法再次读取。"
        size="lg"
        footer={
          <Group justify="flex-end">
            <Button
              onClick={() => {
                setCreated(null);
                setCopyMessage("");
              }}
            >
              已保存，关闭
            </Button>
          </Group>
        }
      >
        {created && (
          <Stack gap="md">
            <Textarea
              label={created.item.name}
              className="mono secret-display"
              readOnly
              value={created.token}
              rows={3}
              onFocus={(event) => event.currentTarget.select()}
            />
            <div>
              <Button
                variant="default"
                onClick={() => void copy(created.token)}
                leftSection={<Copy size={15} aria-hidden="true" />}
              >
                复制 token
              </Button>
            </div>
            <Textarea
              label="客户端接入配置"
              className="mono"
              readOnly
              rows={10}
              value={connectionConfig(created.token)}
              spellCheck={false}
            />
            <Group gap="sm">
              <Button
                variant="default"
                onClick={() => void copy(connectionConfig(created.token))}
                leftSection={<Copy size={15} aria-hidden="true" />}
              >
                复制配置
              </Button>
              <Text size="sm" c="dimmed" role="status">
                {copyMessage}
              </Text>
            </Group>
          </Stack>
        )}
      </AppModal>
      <AppModal
        opened={!!configItem}
        onClose={() => setConfigItem(null)}
        title="MCP 客户端接入"
        description="将配置中的占位内容替换为该 token 的真实明文。"
        size="lg"
        footer={
          <Group justify="space-between" w="100%" wrap="nowrap">
            <Button
              variant="default"
              onClick={() => void copy(connectionConfig("<MCP_TOKEN>"))}
              leftSection={<Copy size={15} aria-hidden="true" />}
            >
              复制配置模板
            </Button>
            <Text size="sm" c="dimmed" role="status">
              {copyMessage}
            </Text>
          </Group>
        }
      >
        <Stack gap="md">
          <Textarea
            label="HTTP 接入配置"
            className="mono"
            rows={10}
            readOnly
            value={connectionConfig("<MCP_TOKEN>")}
            spellCheck={false}
          />
          <Text size="xs" c="dimmed">
            凭证标识：{configItem?.id}。服务不再返回已创建 token
            的明文；若丢失，请创建新 token。
          </Text>
        </Stack>
      </AppModal>
      <AppModal
        opened={!!revoking}
        onClose={() => setRevoking(null)}
        title="吊销 MCP token"
        description="吊销不可恢复。如需暂时停用，可在编辑中关闭启用开关。"
        footer={
          <Group justify="flex-end" gap="sm">
            <Button variant="default" disabled={busy} onClick={() => setRevoking(null)}>
              取消
            </Button>
            <Button color="red" disabled={busy} onClick={() => void revoke()}>
              {busy ? "正在吊销…" : "确认吊销"}
            </Button>
          </Group>
        }
      >
        <Text size="sm">
          确认吊销 <Text span fw={700}>{revoking?.name}</Text>
          ？使用此凭证的后续调用将被拒绝。
        </Text>
        <Feedback message={actionError} onDismiss={() => setActionError("")} />
      </AppModal>
    </>
  );
}
