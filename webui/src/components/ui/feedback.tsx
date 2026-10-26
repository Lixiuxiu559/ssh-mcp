import { AlertCircle, CheckCircle2 } from "lucide-react";
export function Feedback({
  message,
  success = false,
}: {
  message?: string | null;
  success?: boolean;
}) {
  if (!message) return null;
  return (
    <div
      className={`feedback ${success ? "feedback-success" : "feedback-error"}`}
      role={success ? "status" : "alert"}
    >
      {success ? <CheckCircle2 size={17} /> : <AlertCircle size={17} />}
      <span>{message}</span>
    </div>
  );
}
export function Status({ value, label }: { value: string; label?: string }) {
  const labels: Record<string, string> = {
    ok: "成功",
    error: "失败",
    cancelled: "已取消",
    timeout: "超时",
    pending: "未完成",
    started: "进行中",
    running: "进行中",
    enabled: "已启用",
    disabled: "已停用",
    revoked: "已吊销",
    denied: "已拒绝",
    legacy: "历史记录",
  };
  const kind = ["ok", "enabled"].includes(value)
    ? "connected"
    : ["error", "timeout", "denied"].includes(value)
      ? "error"
      : ["started", "running"].includes(value)
        ? "calling"
        : "offline";
  return (
    <span className={`status status-${kind}`}>
      <span className="status-shape" aria-hidden />
      {label || labels[value] || value}
    </span>
  );
}
