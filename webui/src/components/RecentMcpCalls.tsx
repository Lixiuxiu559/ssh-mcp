import { Activity, ArrowRight, RefreshCw } from "lucide-react";
import { Button, Card, Flex, Space, Typography } from "antd";
import type { TableColumnsType } from "antd";
import { AppTable } from "./AppTable";
import { Feedback, Status } from "./Feedback";
import { ListNotice } from "./ListStates";

export interface RecentMcpCall {
  id: string | number;
  token: string;
  workspace?: string;
  target: string;
  tool: string;
  status: string;
}

export interface RecentMcpCallsProps {
  records: readonly RecentMcpCall[];
  total: number;
  targetLabel: string;
  loading: boolean;
  error?: string;
  refreshing?: boolean;
  pagination: {
    current: number;
    pageSize: number;
    onChange: (current: number, pageSize: number) => void;
  };
  onRefresh: () => void;
  onViewAudit: () => void;
}

export function RecentMcpCalls({
  records,
  total,
  targetLabel,
  loading,
  error,
  refreshing = loading,
  pagination,
  onRefresh,
  onViewAudit,
}: RecentMcpCallsProps) {
  const columns: TableColumnsType<RecentMcpCall> = [
    {
      dataIndex: "token",
      title: "Token / 工作空间",
      ellipsis: true,
      render: (token: string, record) => (
        <Flex vertical align="center" style={{ minWidth: 0 }}>
          <Typography.Text ellipsis title={token} style={{ maxWidth: "100%" }}>{token}</Typography.Text>
          {record.workspace && <Typography.Text ellipsis type="secondary" title={record.workspace} style={{ maxWidth: "100%" }}>{record.workspace}</Typography.Text>}
        </Flex>
      ),
    },
    { dataIndex: "target", title: targetLabel, ellipsis: true },
    { dataIndex: "tool", title: "工具", ellipsis: true },
    {
      dataIndex: "status",
      title: "状态",
      width: 88,
      render: (status: string) => <Status value={status} />,
    },
  ];
  return (
    <Card
      className="overview-panel overview-recent-calls"
      title={
        <Space size={12}>
          <span>最近 MCP 调用</span>
          <Typography.Text
            type="secondary"
            style={{ fontSize: "var(--ant-font-size-sm)", fontWeight: 400 }}
          >
            最近 24h
          </Typography.Text>
        </Space>
      }
      extra={
        <Space size={12}>
          <Button
            type="text"
            size="small"
            onClick={onRefresh}
            loading={refreshing}
            disabled={refreshing}
            aria-label="刷新总览数据"
            icon={<RefreshCw size={14} aria-hidden="true" />}
          />
          <Button
            type="link"
            size="small"
            onClick={onViewAudit}
            icon={<ArrowRight size={13} aria-hidden="true" />}
            iconPlacement="end"
          >
            查看审计
          </Button>
        </Space>
      }
      style={{ height: "100%" }}
      aria-busy={loading}
    >
      <Feedback message={error} />
      {records.length || loading ? (
        <AppTable<RecentMcpCall>
          columns={columns}
          dataSource={records}
          rowKey="id"
          pagination={{ ...pagination, total, disabled: loading }}
          size="small"
          loading={loading}
        />
      ) : !error ? (
        <ListNotice
          compact
          icon={Activity}
          title="最近 24 小时暂无调用"
          description="MCP 客户端的工具调用会显示在这里。"
        />
      ) : null}
    </Card>
  );
}
