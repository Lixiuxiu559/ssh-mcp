import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Avatar, Button, Card, Empty, Flex, Skeleton, Typography } from "antd";
import { Feedback } from "./Feedback";

export function SetupPanel({
  icon: Icon,
  title,
  children,
}: {
  icon: LucideIcon;
  title: string;
  children: ReactNode;
}) {
  return (
    <Card className="setup-panel">
      <Flex align="center" gap={12} className="setup-heading">
        <Avatar shape="square" icon={<Icon size={19} aria-hidden="true" />} />
        <Typography.Title level={2}>{title}</Typography.Title>
      </Flex>
      {children}
    </Card>
  );
}

export function ResourceStatus({
  loading,
  error,
  onRetry,
}: {
  loading: boolean;
  error: string;
  onRetry: () => void;
}) {
  return (
    <Card aria-busy={loading}>
      {loading ? (
        <Skeleton active paragraph={{ rows: 2 }} />
      ) : (
        <Flex vertical align="start" gap={12}>
          <Feedback message={error} />
          <Button onClick={onRetry}>重试</Button>
        </Flex>
      )}
    </Card>
  );
}

export function ListNotice({
  title,
  description,
  compact,
  onClear,
  action,
}: {
  title: string;
  description: string;
  icon?: LucideIcon;
  compact?: boolean;
  onClear?: () => void;
  action?: ReactNode;
}) {
  return (
    <Flex
      align="center"
      justify="center"
      className={compact ? "list-notice list-notice-compact" : "list-notice"}
    >
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description={
          <Flex vertical gap={4}>
            <Typography.Text strong>{title}</Typography.Text>
            <Typography.Text type="secondary">{description}</Typography.Text>
          </Flex>
        }
      >
        {onClear && (
          <Button size="small" onClick={onClear}>
            清除筛选
          </Button>
        )}
        {action}
      </Empty>
    </Flex>
  );
}
