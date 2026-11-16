import { Button, Tooltip } from "antd";
import { CheckCircle2, CircleHelp, RefreshCw } from "lucide-react";

export function GatewayStatus({
  collapsed,
  healthy,
  loading,
  onRefresh,
}: {
  collapsed: boolean;
  healthy: boolean;
  loading: boolean;
  onRefresh: () => void;
}) {
  const label = loading
    ? "正在检查网关…"
    : healthy
      ? "网关运行正常"
      : "网关状态未知";
  const Icon = healthy ? CheckCircle2 : CircleHelp;
  return (
    <Tooltip
      title={
        loading
          ? "正在检查网关状态"
          : collapsed
            ? `${label} · 点击刷新`
            : healthy
              ? "重新检查网关状态"
              : "无法获取网关状态，点击重试"
      }
      placement={collapsed ? "right" : "top"}
    >
      <Button
        block
        type="text"
        className={`gateway-status${collapsed ? " gateway-status-collapsed" : ""}`}
        aria-label={loading ? label : `${label}，点击刷新状态`}
        aria-busy={loading}
        disabled={loading}
        loading={loading}
        onClick={onRefresh}
        icon={
          <Icon
            size={16}
            aria-hidden="true"
            style={{
              color: healthy
                ? "var(--ant-color-success)"
                : "var(--ant-color-text-secondary)",
            }}
          />
        }
      >
        <span
          className={collapsed ? "sr-only" : "gateway-status-label"}
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {label}
        </span>
        {!collapsed && !loading && (
          <RefreshCw
            size={13}
            className="gateway-status-refresh"
            aria-hidden="true"
          />
        )}
      </Button>
    </Tooltip>
  );
}
