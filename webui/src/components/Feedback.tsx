import { Alert, Badge } from "@mantine/core";
import { AlertCircle, CheckCircle2 } from "lucide-react";

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
      color={success ? "green" : "red"}
      variant="light"
      icon={
        success ? (
          <CheckCircle2 size={17} aria-hidden="true" />
        ) : (
          <AlertCircle size={17} aria-hidden="true" />
        )
      }
      withCloseButton={!!onDismiss}
      onClose={onDismiss}
      role={success ? "status" : "alert"}
    >
      {message}
    </Alert>
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
};

const statusColors: Record<string, string> = {
  ok: "green",
  enabled: "green",
  error: "red",
  timeout: "red",
  denied: "red",
  revoked: "red",
  started: "yellow",
  running: "yellow",
  pending: "yellow",
  unknown: "yellow",
  disabled: "gray",
  cancelled: "gray",
  legacy: "gray",
};

export function Status({ value, label }: { value: string; label?: string }) {
  return (
    <Badge variant="light" color={statusColors[value] ?? "gray"}>
      {label || statusLabels[value] || value}
    </Badge>
  );
}
