import { useState } from "react";
import {
  Activity,
  ArrowRight,
  CircleAlert,
  CircleCheck,
  Network,
  Server,
} from "lucide-react";
import {
  Badge,
  Box,
  Button,
  Card,
  Grid,
  Group,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Title,
} from "@mantine/core";
import type { AuditRecord, Page, ServerEntry, TokenEntry } from "../types";
import { useResource } from "../lib/use-resource";
import { formatTime } from "../lib/utils";
import { Feedback, Status } from "../components/Feedback";
import { PageHeading } from "../components/PageHeading";

interface AuditResult {
  records: AuditRecord[];
  total: number;
}
const actions: Record<string, string> = {
  "user.login": "登录后台",
  "user.initialize": "初始化工作区",
  "user.logout": "退出登录",
  "server.create": "添加服务器",
  "server.update": "更新服务器",
  "server.delete": "删除服务器",
  "server.test": "测试连接",
  "token.create": "创建 Token",
  "token.update": "更新 Token",
  "token.revoke": "吊销 Token",
  "user.create": "添加成员",
  "user.update": "更新成员",
  "audit.export": "导出审计",
  "key.upload": "上传密钥",
};
const startOfWindow = () => new Date(Date.now() - 86400000).toISOString();
const shortTime = (value: string) =>
  new Date(value).toLocaleTimeString("zh-CN", { hour12: false });

export default function Overview({
  onNavigate,
  healthy,
}: {
  onNavigate: (page: Page) => void;
  healthy: boolean;
}) {
  const [since, setSince] = useState(startOfWindow);
  const servers = useResource<{ servers: ServerEntry[] }>("/api/servers", {
    servers: [],
  });
  const tokens = useResource<{ tokens: TokenEntry[] }>("/api/tokens", {
    tokens: [],
  });
  const windowQuery = `since=${encodeURIComponent(since)}`;
  const calls = useResource<AuditResult>(
    `/api/audit?kind=mcp&limit=3&${windowQuery}`,
    { records: [], total: 0 },
  );
  const failures = useResource<AuditResult>(
    `/api/audit?kind=mcp&status=error&limit=1&${windowQuery}`,
    { records: [], total: 0 },
  );
  const events = useResource<AuditResult>("/api/audit?kind=person&limit=4", {
    records: [],
    total: 0,
  });
  const resources = [servers, tokens, calls, failures, events];
  const loading = resources.some((resource) => resource.loading);
  const error = [
    ...new Set(resources.map((resource) => resource.error).filter(Boolean)),
  ].join("；");
  const enabledTokens = tokens.data.tokens.filter(
    (token) => token.enabled && !token.revoked,
  ).length;
  const number = (
    value: number,
    resource: { loading: boolean; error: string },
  ) =>
    resource.error || resource.loading ? "—" : value.toLocaleString("zh-CN");
  function refresh() {
    setSince(startOfWindow());
    servers.reload();
    tokens.reload();
    events.reload();
  }
  const metrics = [
    {
      label: "服务器总数",
      icon: Server,
      value: number(servers.data.servers.length, servers),
      hint: "已配置 SSH 目标",
      danger: false,
    },
    {
      label: "近 24h MCP 调用",
      icon: Activity,
      value: number(calls.data.total, calls),
      hint: "最近 24 小时的调用记录",
      danger: false,
    },
    {
      label: "近 24h 执行失败",
      icon: CircleAlert,
      value: number(failures.data.total, failures),
      hint:
        !failures.error && !calls.error && !loading && calls.data.total
          ? `执行失败占比 ${((failures.data.total / calls.data.total) * 100).toFixed(2)}%`
          : "调用结果为失败的记录",
      danger: true,
    },
    {
      label: "有效 MCP Token",
      icon: Network,
      value: number(enabledTokens, tokens),
      hint: "已启用且未吊销的凭证",
      danger: false,
    },
  ];
  return (
    <>
      <PageHeading
        title="总览"
        description="监控服务器连接和 MCP 工具调用"
        extra={
          <Button
            size="compact-sm"
            variant="light"
            color={healthy ? "green" : "gray"}
            leftSection={<CircleCheck size={13} aria-hidden="true" />}
            onClick={refresh}
            disabled={loading}
            aria-label="刷新总览数据"
            title="刷新总览数据"
          >
            {healthy ? "网关正常" : "状态未知"}
          </Button>
        }
      />
      <Feedback message={error} />
      <SimpleGrid cols={{ base: 1, xs: 2, md: 4 }} spacing="md" mb="lg">
        {metrics.map((metric) => (
          <Card key={metric.label} withBorder p="md" radius="md">
            <Stack gap={4}>
              <Group justify="space-between" wrap="nowrap">
                <Text size="xs" c="dimmed" fw={600}>
                  {metric.label}
                </Text>
                <metric.icon size={14} aria-hidden="true" />
              </Group>
              <Text fz={24} fw={700} lh={1.1}>
                {metric.value}
              </Text>
              <Text
                size="xs"
                c={metric.danger && !metric.value.startsWith("—") ? "red" : "dimmed"}
              >
                {metric.hint}
              </Text>
            </Stack>
          </Card>
        ))}
      </SimpleGrid>
      <Grid gap="md" mb="md">
        <Grid.Col span={{ base: 12, md: 7 }}>
          <Card withBorder p="md" radius="md" h="100%">
            <Group justify="space-between" mb="sm" wrap="nowrap">
              <Title order={3}>最近 MCP 调用</Title>
              <Badge variant="light" color="gray">
                最近 24h
              </Badge>
            </Group>
            <Table.ScrollContainer minWidth={420}>
              <Table verticalSpacing="xs" highlightOnHover>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Token</Table.Th>
                    <Table.Th>目标服务器</Table.Th>
                    <Table.Th>工具</Table.Th>
                    <Table.Th>状态</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {calls.data.records.map((record) => (
                    <Table.Tr key={record.id}>
                      <Table.Td>
                        {record.token_name ||
                          record.token_id ||
                          record.user ||
                          "历史调用"}
                      </Table.Td>
                      <Table.Td>{record.server || "网关"}</Table.Td>
                      <Table.Td>{record.tool || "—"}</Table.Td>
                      <Table.Td>
                        <Status value={record.status} />
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
            {!calls.data.records.length && (
              <Text size="sm" c="dimmed" ta="center" py="md">
                {calls.error
                  ? "加载失败，请刷新重试"
                  : calls.loading
                    ? "正在读取…"
                    : "最近 24 小时暂无调用记录"}
              </Text>
            )}
          </Card>
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 5 }}>
          <Card withBorder p="md" radius="md" h="100%">
            <Group justify="space-between" mb="sm" wrap="nowrap">
              <Title order={3}>最近事件</Title>
              <Button
                variant="subtle"
                size="compact-sm"
                rightSection={<ArrowRight size={13} aria-hidden="true" />}
                onClick={() => onNavigate("person-audit")}
              >
                查看审计
              </Button>
            </Group>
            <Stack gap={0} aria-busy={events.loading}>
              {events.data.records.map((record, index) => (
                <Group
                  key={record.id || `${record.ts}-${index}`}
                  justify="space-between"
                  wrap="nowrap"
                  py="xs"
                  gap="sm"
                >
                  <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
                    {record.status === "ok" ? (
                      <CircleCheck
                        size={15}
                        aria-hidden="true"
                        color="var(--mantine-color-green-6)"
                        style={{ flexShrink: 0 }}
                      />
                    ) : (
                      <CircleAlert
                        size={15}
                        aria-hidden="true"
                        color="var(--mantine-color-red-6)"
                        style={{ flexShrink: 0 }}
                      />
                    )}
                    <Box style={{ minWidth: 0 }}>
                      <Text size="sm" truncate="end" title={record.object_id || undefined}>
                        {actions[record.action || ""] ||
                          record.action ||
                          "工作区操作"}
                        {record.object_id &&
                        !["user", "session"].includes(record.object_type || "")
                          ? ` · ${record.object_id}`
                          : ` · ${record.username || record.user || "未认证来源"}`}
                      </Text>
                      <Text
                        size="xs"
                        c="dimmed"
                        component="time"
                        dateTime={record.ts}
                        title={formatTime(record.ts)}
                      >
                        {shortTime(record.ts)}
                      </Text>
                    </Box>
                  </Group>
                  <Status value={record.status} />
                </Group>
              ))}
            </Stack>
            {!events.data.records.length && (
              <Text size="sm" c="dimmed" ta="center" py="md">
                {events.error
                  ? "加载失败，请刷新重试"
                  : events.loading
                    ? "正在读取…"
                    : "暂无人员操作记录"}
              </Text>
            )}
          </Card>
        </Grid.Col>
      </Grid>
      <Button
        variant="subtle"
        rightSection={<ArrowRight size={14} aria-hidden="true" />}
        onClick={() => onNavigate("servers")}
      >
        查看服务器列表
      </Button>
    </>
  );
}
