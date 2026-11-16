import { ArrowRight, CircleAlert, CircleCheck, CircleHelp } from "lucide-react";
import { Button, Card, Flex, Typography } from "antd";
import { formatTime } from "../lib/utils";
import { Feedback, Status } from "./Feedback";
import { ListNotice } from "./ListStates";

export interface RecentActivityItem {
  id: string | number;
  title: string;
  timestamp: string;
  status: string;
}

export interface RecentActivityProps {
  items: readonly RecentActivityItem[];
  loading: boolean;
  error?: string;
  onViewAudit: () => void;
  onRetry: () => void;
  emptyTitle?: string;
  emptyDescription?: string;
}

export function RecentActivity({
  items,
  loading,
  error,
  onViewAudit,
  onRetry,
  emptyTitle = "暂无人员操作记录",
  emptyDescription = "成员登录或变更配置后会产生记录。",
}: RecentActivityProps) {
  return (
    <Card
      className="overview-panel overview-recent-activity"
      title="最近事件"
      extra={
        <Button
          type="link"
          size="small"
          icon={<ArrowRight size={13} aria-hidden="true" />}
          iconPlacement="end"
          onClick={onViewAudit}
        >
          查看审计
        </Button>
      }
      style={{ height: "100%" }}
      loading={loading && !items.length}
      aria-busy={loading}
    >
      {error && (
        <>
          <Feedback message={error} />
          <Button
            size="small"
            onClick={onRetry}
            disabled={loading}
            style={{ alignSelf: "flex-start", marginBottom: items.length ? 16 : 0 }}
          >
            重试
          </Button>
        </>
      )}
      <Flex vertical gap={16}>
        {items.map((item) => {
          const failed = ["error", "timeout", "denied"].includes(item.status);
          const Icon = item.status === "ok" ? CircleCheck : failed ? CircleAlert : CircleHelp;
          const color = item.status === "ok"
            ? "var(--ant-color-success)"
            : failed
              ? "var(--ant-color-error)"
              : "var(--ant-color-text-secondary)";
          return (
            <Flex key={item.id} justify="space-between" align="center" gap={12}>
              <Flex gap={8} align="center" style={{ minWidth: 0 }}>
                <Icon size={15} aria-hidden="true" style={{ flexShrink: 0, color }} />
                <Flex vertical style={{ minWidth: 0 }}>
                  <Typography.Text ellipsis title={item.title}>
                    {item.title}
                  </Typography.Text>
                  <Typography.Text type="secondary" title={formatTime(item.timestamp)}>
                    <time dateTime={item.timestamp}>
                      {new Date(item.timestamp).toLocaleTimeString("zh-CN", { hour12: false })}
                    </time>
                  </Typography.Text>
                </Flex>
              </Flex>
              <Status value={item.status} />
            </Flex>
          );
        })}
      </Flex>
      {!loading && !items.length && !error && (
        <ListNotice compact title={emptyTitle} description={emptyDescription} />
      )}
    </Card>
  );
}
