import { useState } from "react";
import {
  Badge,
  Breadcrumbs,
  Box,
  Button,
  Card,
  Group,
  Stack,
  Table,
  Tabs,
  Text,
  Title,
} from "@mantine/core";
import {
  ArrowLeft,
  ArrowRight,
  Cable,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  Pencil,
  Server,
  Terminal,
} from "lucide-react";
import type { AuditRecord, ServerEntry } from "../types";
import { useResource } from "../lib/use-resource";
import { formatTime, formatCompactTime } from "../lib/utils";
import { Feedback, Status } from "./Feedback";

export interface ConnectionCheck {
  ok: boolean;
  message: string;
}
export const credentialLabels: Record<string, string> = {
  private_key_file: "私钥文件",
  private_key_inline: "内嵌私钥",
  password: "密码",
};
const tabs = [
  { id: "overview", label: "概览" },
  { id: "config", label: "连接配置" },
  { id: "audit", label: "审计记录" },
] as const;
type Tab = (typeof tabs)[number]["id"];

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Table.Tr>
      <Table.Th w={140} c="dimmed" fw={500}>
        {label}
      </Table.Th>
      <Table.Td>{children}</Table.Td>
    </Table.Tr>
  );
}

export function ServerDetails({
  server,
  check,
  busy,
  onBack,
  onTest,
  onEdit,
  onDelete,
}: {
  server: ServerEntry;
  check?: ConnectionCheck;
  busy: boolean;
  onBack: () => void;
  onTest: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [tab, setTab] = useState<Tab>("overview");
  const audit = useResource<{ records: AuditRecord[]; total: number }>(
    `/api/audit?kind=mcp&server=${encodeURIComponent(server.alias)}&limit=20`,
    { records: [], total: 0 },
  );
  return (
    <>
      <Breadcrumbs mb="md" separator={<ChevronRight size={12} aria-hidden="true" />}>
        <Button
          variant="subtle"
          color="gray"
          size="compact-sm"
          onClick={onBack}
          leftSection={<ArrowLeft size={13} aria-hidden="true" />}
        >
          服务器
        </Button>
        <Text size="sm" c="dimmed">
          {server.alias}
        </Text>
      </Breadcrumbs>
      <Group justify="space-between" align="flex-start" wrap="nowrap" mb="md">
        <Stack gap={4}>
          <Group gap="sm" wrap="nowrap">
            <Title order={1}>{server.alias}</Title>
            <Status
              value={check ? (check.ok ? "ok" : "error") : "unchecked"}
              label={check ? (check.ok ? "检测通过" : "连接失败") : "尚未检测"}
            />
          </Group>
          <Group gap="sm" wrap="nowrap">
            {server.tags[0] && (
              <Badge variant="light" color="gray">
                {server.tags[0]}
              </Badge>
            )}
            <Text size="sm" c="dimmed">
              {server.host}:{server.port}
            </Text>
          </Group>
        </Stack>
        <Group gap="sm" wrap="nowrap">
          <Button
            variant="default"
            disabled={busy}
            onClick={onTest}
            leftSection={<Cable size={14} aria-hidden="true" />}
          >
            {busy ? "检测中…" : "测试连接"}
          </Button>
          <Button
            variant="default"
            onClick={onEdit}
            leftSection={<Pencil size={14} aria-hidden="true" />}
          >
            编辑
          </Button>
          <Button variant="light" color="red" onClick={onDelete}>
            删除
          </Button>
        </Group>
      </Group>
      <Card withBorder p="md" radius="md" mb="md">
        <Title order={3} mb="sm">
          连接路径
        </Title>
        <Group gap="md" mb="sm" wrap="wrap">
          <Group gap={6} wrap="nowrap">
            <Terminal size={14} aria-hidden="true" />
            <Text size="sm">AI 客户端</Text>
          </Group>
          <ArrowRight
            size={14}
            aria-hidden="true"
            color="var(--mantine-color-green-6)"
          />
          <Group gap={6} wrap="nowrap">
            <Cable size={14} aria-hidden="true" />
            <Text size="sm">MCP 网关</Text>
          </Group>
          <ArrowRight
            size={14}
            aria-hidden="true"
            color="var(--mantine-color-green-6)"
          />
          <Group gap={6} wrap="nowrap">
            <Server size={14} aria-hidden="true" />
            <Text size="sm">目标服务器</Text>
          </Group>
        </Group>
        <Group gap="xs" wrap="nowrap">
          {check ? (
            check.ok ? (
              <CircleCheck
                size={14}
                aria-hidden="true"
                color="var(--mantine-color-green-6)"
              />
            ) : (
              <CircleAlert
                size={14}
                aria-hidden="true"
                color="var(--mantine-color-red-6)"
              />
            )
          ) : (
            <CircleAlert
              size={14}
              aria-hidden="true"
              color="var(--mantine-color-dimmed)"
            />
          )}
          <Text size="sm" c={check && !check.ok ? "red" : undefined}>
            {check
              ? check.ok
                ? "SSH 连接已验证"
                : check.message
              : "配置路径 · SSH 连接尚未检测"}
          </Text>
        </Group>
      </Card>
      <Tabs defaultValue="overview" value={tab} onChange={(value) => setTab((value as Tab) || "overview")}>
        <Tabs.List mb="md">
          {tabs.map((item) => (
            <Tabs.Tab key={item.id} value={item.id}>
              {item.label}
            </Tabs.Tab>
          ))}
        </Tabs.List>
        <Tabs.Panel value="overview">
          <Stack gap="md">
            <Card withBorder p="md" radius="md">
              <Title order={3} mb="sm">
                基本信息
              </Title>
              <Table verticalSpacing="xs">
                <Table.Tbody>
                  <InfoRow label="SSH 地址">{server.host}</InfoRow>
                  <InfoRow label="端口">{server.port}</InfoRow>
                  <InfoRow label="认证方式">
                    {credentialLabels[server.credential_type] ||
                      server.credential_type}
                  </InfoRow>
                  <InfoRow label="主机指纹校验">
                    {server.has_known_hosts ? "已配置" : "未配置"}
                  </InfoRow>
                  <InfoRow label="远端账号">{server.username}</InfoRow>
                  <InfoRow label="描述">{server.description || "—"}</InfoRow>
                </Table.Tbody>
              </Table>
            </Card>
            <Card withBorder p="md" radius="md">
              <Title order={3} mb="sm">
                最近调用
              </Title>
              <Feedback message={audit.error} />
              <Stack gap="sm">
                {audit.data.records.slice(0, 2).map((record) => (
                  <Group
                    key={record.id}
                    justify="space-between"
                    wrap="nowrap"
                    gap="sm"
                  >
                    <Box style={{ minWidth: 0 }}>
                      <Text size="sm" truncate="end">
                        {record.tool || "—"} ·{" "}
                        {record.token_name ||
                          record.token_id ||
                          record.user ||
                          "历史调用"}
                      </Text>
                      <Text
                        size="xs"
                        c="dimmed"
                        component="time"
                        dateTime={record.ts}
                      >
                        {formatCompactTime(record.ts, true)}
                      </Text>
                    </Box>
                    <Status value={record.status} />
                  </Group>
                ))}
              </Stack>
              {!audit.data.records.length && (
                <Text size="sm" c="dimmed">
                  {audit.loading
                    ? "正在读取…"
                    : audit.error
                      ? "调用记录加载失败"
                      : "暂无调用记录"}
                </Text>
              )}
            </Card>
          </Stack>
        </Tabs.Panel>
        <Tabs.Panel value="config">
          <Card withBorder p="md" radius="md">
            <Title order={3} mb="sm">
              连接配置
            </Title>
            <Table verticalSpacing="xs" mb="md">
              <Table.Tbody>
                <InfoRow label="服务器别名">{server.alias}</InfoRow>
                <InfoRow label="目标端点">
                  {server.host}:{server.port}
                </InfoRow>
                <InfoRow label="远端账号">{server.username}</InfoRow>
                <InfoRow label="标签">
                  {server.tags.join("、") || "—"}
                </InfoRow>
                <InfoRow label="主机指纹校验">
                  {server.has_known_hosts ? "已配置" : "未配置"}
                </InfoRow>
                <InfoRow label="凭据">
                  {credentialLabels[server.credential_type] ||
                    server.credential_type}{" "}
                  · 仅写入，不回显
                </InfoRow>
              </Table.Tbody>
            </Table>
            <Button
              variant="default"
              onClick={onEdit}
              leftSection={<Pencil size={14} aria-hidden="true" />}
            >
              编辑配置
            </Button>
          </Card>
        </Tabs.Panel>
        <Tabs.Panel value="audit">
          <Card withBorder p="md" radius="md">
            <Title order={3} mb="sm">
              审计记录
            </Title>
            <Feedback message={audit.error} />
            <Table.ScrollContainer minWidth={480}>
              <Table verticalSpacing="xs" highlightOnHover>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>时间</Table.Th>
                    <Table.Th>Token</Table.Th>
                    <Table.Th>工具</Table.Th>
                    <Table.Th>状态</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {audit.data.records.map((record) => (
                    <Table.Tr key={record.id}>
                      <Table.Td className="nowrap">
                        {formatTime(record.ts)}
                      </Table.Td>
                      <Table.Td>
                        {record.token_name ||
                          record.token_id ||
                          record.user ||
                          "—"}
                      </Table.Td>
                      <Table.Td>{record.tool || "—"}</Table.Td>
                      <Table.Td>
                        <Status value={record.status} />
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
            <Text size="sm" c="dimmed" mt="sm">
              {audit.loading
                ? "正在读取…"
                : audit.error
                  ? "加载失败"
                  : `展示最近 ${audit.data.records.length} 条，共 ${audit.data.total} 条记录`}
            </Text>
          </Card>
        </Tabs.Panel>
      </Tabs>
    </>
  );
}
