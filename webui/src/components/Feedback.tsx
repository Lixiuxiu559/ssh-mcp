import { Alert, Tag } from "antd";

export function Feedback({
  message,
  success = false,
  onDismiss,
}: {
  message?: string | null;
  success?: boolean;
  onDismiss?: () => void;
}) {
  if (!message) return null;
  return (
    <Alert
      type={success ? "success" : "error"}
      title={message}
      showIcon
      closable={!!onDismiss}
      afterClose={onDismiss}
      role={success ? "status" : "alert"}
      style={{ marginBottom: 16 }}
    />
  );
}

const statusLabels: Record<string, string> = {
  ok: "成功",
  error: "失败",
  cancelled: "已取消",
  timeout: "超时",
  pending: "未完成",
  unknown: "结果未知",
  started: "进行中",
  running: "进行中",
  enabled: "已启用",
  disabled: "已停用",
  revoked: "已吊销",
  denied: "已拒绝",
  legacy: "历史记录",
  unchecked: "尚未检测",
};
const statusColors: Record<string, string> = {
  ok: "success",
  enabled: "success",
  error: "error",
  timeout: "error",
  denied: "error",
  revoked: "error",
  started: "processing",
  running: "processing",
  pending: "warning",
  unknown: "warning",
};
export function Status({ value, label }: { value: string; label?: string }) {
  return (
    <Tag color={statusColors[value]}>
      {label || statusLabels[value] || value}
    </Tag>
  );
}
