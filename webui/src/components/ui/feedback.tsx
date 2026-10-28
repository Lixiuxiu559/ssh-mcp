import { AlertCircle, CheckCircle2, X } from "lucide-react";

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
    <div
      className={`feedback ${success ? "feedback-success" : "feedback-error"}`}
      role={success ? "status" : "alert"}
    >
      {success ? (
        <CheckCircle2 size={17} aria-hidden="true" />
      ) : (
        <AlertCircle size={17} aria-hidden="true" />
      )}
      <span className="feedback-text">{message}</span>
      {onDismiss && (
        <button
          type="button"
          className="feedback-close"
          aria-label="关闭提示"
          onClick={onDismiss}
        >
          <X size={15} aria-hidden="true" />
        </button>
      )}
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
    unknown: "结果未知",
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
        : ["pending", "unknown"].includes(value)
          ? "warning"
          : "offline";
  return (
    <span className={`status status-${kind}`}>
      <span className="status-shape" aria-hidden="true" />
      {label || labels[value] || value}
    </span>
  );
}
