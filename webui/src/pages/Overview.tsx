import { useEffect, useState } from "react";
import { Activity, ArrowRight, CircleAlert, Network, Server } from "lucide-react";
import { Button, Col, Row } from "antd";
import type { AuditRecord, Page, ServerEntry, TokenEntry } from "../types";
import { useResource } from "../lib/use-resource";
import { useListPagination } from "../lib/pagination";
import { personActionLabel } from "../lib/audit-labels";
import { Feedback } from "../components/Feedback";
import { PageHeading } from "../components/PageHeading";
import { OverviewMetrics } from "../components/OverviewMetrics";
import type { OverviewMetric } from "../components/OverviewMetrics";
import { RecentMcpCalls } from "../components/RecentMcpCalls";
import type { RecentMcpCall } from "../components/RecentMcpCalls";
import { RecentActivity } from "../components/RecentActivity";
import type { RecentActivityItem } from "../components/RecentActivity";

interface AuditResult {
  records: AuditRecord[];
  total: number;
}
const startOfWindow = () => new Date(Date.now() - 86400000).toISOString();

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
  const { pagination, resetPage } = useListPagination();
  const servers = useResource<{ servers: ServerEntry[] }>("/api/servers", {
    servers: [],
  });
  const tokens = useResource<{ tokens: TokenEntry[] }>("/api/tokens", {
    tokens: [],
  });
  const windowQuery = `since=${encodeURIComponent(since)}`;
  const calls = useResource<AuditResult>(
    `/api/audit?kind=mcp&limit=${pagination.pageSize}&offset=${(pagination.current - 1) * pagination.pageSize}&${windowQuery}`,
    { records: [], total: 0 },
  );
  useEffect(() => {
    if (
      !calls.loading &&
      !calls.error &&
      pagination.current > Math.max(1, Math.ceil(calls.data.total / pagination.pageSize))
    ) {
      resetPage();
    }
  }, [calls.loading, calls.error, calls.data.total, pagination.current, pagination.pageSize, resetPage]);
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
  const metricError = [
    ...new Set([servers, tokens, failures].map((resource) => resource.error).filter(Boolean)),
  ].join("；");
  const enabledTokens = tokens.data.tokens.filter((token) => token.enabled).length;
  const number = (
    value: number,
    resource: { loading: boolean; error: string },
  ) => (resource.error || resource.loading ? "—" : value);
  function refresh() {
    resetPage();
    onRefreshHealth();
    setSince(startOfWindow());
    servers.reload();
    tokens.reload();
    events.reload();
  }
  const metrics: OverviewMetric[] = [
    {
      label: "服务器总数",
      icon: <Server size={15} aria-hidden="true" />,
      value: number(servers.data.servers.length, servers),
    },
    {
      label: "近 24h MCP 调用",
      icon: <Activity size={15} aria-hidden="true" />,
      value: number(calls.data.total, calls),
    },
    {
      label: "近 24h 执行失败",
      icon: <CircleAlert size={15} aria-hidden="true" />,
      value: number(failures.data.total, failures),
      hint:
        !failures.error && !calls.error && !loading && calls.data.total
          ? `执行失败占比 ${((failures.data.total / calls.data.total) * 100).toFixed(2)}%`
          : undefined,
      danger: !failures.loading && !failures.error && failures.data.total > 0,
    },
    {
      label: "有效 MCP Token",
      icon: <Network size={15} aria-hidden="true" />,
      value: number(enabledTokens, tokens),
    },
  ];
  const callItems: RecentMcpCall[] = calls.data.records.map((record) => ({
    id: record.id,
    token: record.token_name || record.token_id || record.user || "历史调用",
    target: record.server || "网关",
    tool: record.tool || "—",
    status: record.status,
  }));
  const eventItems: RecentActivityItem[] = events.data.records.map((record) => ({
    id: record.id,
    title: `${personActionLabel(record.action)} · ${
      record.object_id && ["server", "key"].includes(record.object_type || "")
        ? record.object_id
        : record.username || record.user || "未认证来源"
    }`,
    timestamp: record.ts,
    status: record.status,
  }));
  return (
    <>
      <PageHeading title="总览" />
      <Feedback message={metricError} />
      <OverviewMetrics items={metrics} />
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={14}>
          <RecentMcpCalls
            records={callItems}
            total={calls.data.total}
            targetLabel="目标服务器"
            healthy={healthy}
            loading={calls.loading}
            error={calls.error}
            refreshing={loading}
            pagination={pagination}
            onRefresh={refresh}
            onViewAudit={() => onNavigate("mcp-audit")}
          />
        </Col>
        <Col span={10}>
          <RecentActivity
            items={eventItems}
            loading={events.loading}
            error={events.error}
            onRetry={events.reload}
            onViewAudit={() => onNavigate("person-audit")}
          />
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
