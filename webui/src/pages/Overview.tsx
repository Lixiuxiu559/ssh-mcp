import { useState } from "react";
import {
  Activity,
  ArrowRight,
  CircleAlert,
  CircleCheck,
  Network,
  RefreshCw,
  Server,
} from "lucide-react";
import {
  Button,
  Card,
  Col,
  Flex,
  Row,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
} from "antd";
import type { TableColumnsType } from "antd";
import type { AuditRecord, Page, ServerEntry, TokenEntry } from "../types";
import { useResource } from "../lib/use-resource";
import { formatTime } from "../lib/utils";
import { personActionLabel } from "../lib/audit-labels";
import { Feedback, Status } from "../components/Feedback";
import { ListNotice } from "../components/ListStates";
import { PageHeading } from "../components/PageHeading";

interface AuditResult {
  records: AuditRecord[];
  total: number;
}
const startOfWindow = () => new Date(Date.now() - 86400000).toISOString();
const shortTime = (value: string) =>
  new Date(value).toLocaleTimeString("zh-CN", { hour12: false });
const callColumns: TableColumnsType<AuditRecord> = [
  {
    key: "token",
    title: "Token",
    ellipsis: true,
    render: (_, record) =>
      record.token_name || record.token_id || record.user || "历史调用",
  },
  {
    key: "server",
    title: "目标服务器",
    ellipsis: true,
    render: (_, record) => record.server || "网关",
  },
  {
    key: "tool",
    title: "工具",
    ellipsis: true,
    render: (_, record) => record.tool || "—",
  },
  {
    key: "status",
    title: "状态",
    width: 88,
    render: (_, record) => <Status value={record.status} />,
  },
];

export default function Overview({
  onNavigate,
  healthy,
  onRefreshHealth,
}: {
  onNavigate: (page: Page) => void;
  healthy: boolean;
  onRefreshHealth: () => void;
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
    (token) => token.enabled,
  ).length;
  const number = (
    value: number,
    resource: { loading: boolean; error: string },
  ) => (resource.error || resource.loading ? "—" : value);
  function refresh() {
    onRefreshHealth();
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
      danger: false,
    },
    {
      label: "近 24h MCP 调用",
      icon: Activity,
      value: number(calls.data.total, calls),
      danger: false,
    },
    {
      label: "近 24h 执行失败",
      icon: CircleAlert,
      value: number(failures.data.total, failures),
      hint:
        !failures.error && !calls.error && !loading && calls.data.total
          ? `执行失败占比 ${((failures.data.total / calls.data.total) * 100).toFixed(2)}%`
          : undefined,
      danger: !failures.loading && !failures.error && failures.data.total > 0,
    },
    {
      label: "有效 MCP Token",
      icon: Network,
      value: number(enabledTokens, tokens),
      danger: false,
    },
  ];
  return (
    <>
      <PageHeading
        title="总览"
        extra={
          <Space>
            <Tag
              color={healthy ? "success" : "default"}
              icon={
                healthy ? <CircleCheck size={13} /> : <CircleAlert size={13} />
              }
            >
              {healthy ? "网关正常" : "状态未知"}
            </Tag>
            <Button
              onClick={refresh}
              disabled={loading}
              aria-label="刷新总览数据"
              icon={<RefreshCw size={14} aria-hidden="true" />}
            >
              刷新
            </Button>
          </Space>
        }
      />
      <Feedback message={error} />
      <Row gutter={16} style={{ marginBottom: 24 }}>
        {metrics.map((metric) => (
          <Col key={metric.label} span={6}>
            <Card style={{ height: "100%" }}>
              <Statistic
                title={
                  <Flex justify="space-between" align="center">
                    <span>{metric.label}</span>
                    <metric.icon size={15} aria-hidden="true" />
                  </Flex>
                }
                value={metric.value}
                styles={{
                  content: {
                    color: metric.danger ? "var(--ant-color-error)" : undefined,
                  },
                }}
              />
              {metric.hint && (
                <Typography.Text type={metric.danger ? "danger" : "secondary"}>
                  {metric.hint}
                </Typography.Text>
              )}
            </Card>
          </Col>
        ))}
      </Row>
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={14}>
          <Card
            className="overview-panel"
            title="最近 MCP 调用"
            extra={
              <Space>
                <Tag>最近 24h</Tag>
                <Button
                  type="link"
                  size="small"
                  onClick={() => onNavigate("mcp-audit")}
                  icon={<ArrowRight size={13} aria-hidden="true" />}
                  iconPlacement="end"
                >
                  查看审计
                </Button>
              </Space>
            }
            style={{ height: "100%" }}
          >
            {calls.data.records.length || calls.loading ? (
              <Table<AuditRecord>
                columns={callColumns}
                dataSource={calls.data.records}
                rowKey={(record) => record.id}
                pagination={false}
                size="small"
                loading={calls.loading}
              />
            ) : calls.error ? (
              <Typography.Text type="danger">
                加载失败，请刷新重试
              </Typography.Text>
            ) : (
              <ListNotice
                compact
                icon={Activity}
                title="最近 24 小时暂无调用"
                description="MCP 客户端的工具调用会显示在这里。"
              />
            )}
          </Card>
        </Col>
        <Col span={10}>
          <Card
            className="overview-panel"
            title="最近事件"
            extra={
              <Button
                type="link"
                size="small"
                icon={<ArrowRight size={13} aria-hidden="true" />}
                iconPlacement="end"
                onClick={() => onNavigate("person-audit")}
              >
                查看审计
              </Button>
            }
            style={{ height: "100%" }}
            loading={events.loading && !events.data.records.length}
          >
            <Flex vertical gap={16} aria-busy={events.loading}>
              {events.data.records.map((record, index) => (
                <Flex
                  key={record.id || `${record.ts}-${index}`}
                  justify="space-between"
                  align="center"
                  gap={12}
                >
                  <Flex gap={8} align="center" style={{ minWidth: 0 }}>
                    {record.status === "ok" ? (
                      <CircleCheck
                        size={15}
                        aria-hidden="true"
                        style={{
                          flexShrink: 0,
                          color: "var(--ant-color-success)",
                        }}
                      />
                    ) : (
                      <CircleAlert
                        size={15}
                        aria-hidden="true"
                        style={{
                          flexShrink: 0,
                          color: "var(--ant-color-error)",
                        }}
                      />
                    )}
                    <Flex vertical style={{ minWidth: 0 }}>
                      <Typography.Text
                        ellipsis
                        title={record.object_id || undefined}
                      >
                        {personActionLabel(record.action)}
                        {record.object_id &&
                        ["server", "key"].includes(record.object_type || "")
                          ? ` · ${record.object_id}`
                          : ` · ${record.username || record.user || "未认证来源"}`}
                      </Typography.Text>
                      <Typography.Text
                        type="secondary"
                        title={formatTime(record.ts)}
                      >
                        <time dateTime={record.ts}>{shortTime(record.ts)}</time>
                      </Typography.Text>
                    </Flex>
                  </Flex>
                  <Status value={record.status} />
                </Flex>
              ))}
            </Flex>
            {!events.loading &&
              !events.data.records.length &&
              (events.error ? (
                <Typography.Text type="danger">
                  加载失败，请刷新重试
                </Typography.Text>
              ) : (
                <ListNotice
                  compact
                  title="暂无人员操作记录"
                  description="成员登录或变更配置后会产生记录。"
                />
              ))}
          </Card>
        </Col>
      </Row>
      <Button
        type="link"
        icon={<ArrowRight size={14} aria-hidden="true" />}
        iconPlacement="end"
        onClick={() => onNavigate("servers")}
      >
        查看服务器列表
      </Button>
    </>
  );
}
