import { useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ChevronRight,
  CircleCheck,
  CircleAlert,
  Cable,
  Pencil,
  Server,
  Terminal,
} from "lucide-react";
import type { AuditRecord, ServerEntry } from "../types";
import { useResource } from "../lib/use-resource";
import { formatTime, formatCompactTime } from "../lib/utils";
import { Button } from "./ui/button";
import { Feedback, Status } from "./ui/feedback";

export interface ConnectionCheck {
  ok: boolean;
  message: string;
}
export const credentialLabels: Record<string, string> = {
  private_key_file: "私钥文件",
  private_key_inline: "内嵌私钥",
  password: "密码",
};
const tabs = [
  { id: "overview", label: "概览" },
  { id: "config", label: "连接配置" },
  { id: "audit", label: "审计记录" },
] as const;
type Tab = (typeof tabs)[number]["id"];
export function ServerDetails({
  server,
  check,
  busy,
  onBack,
  onTest,
  onEdit,
  onDelete,
}: {
  server: ServerEntry;
  check?: ConnectionCheck;
  busy: boolean;
  onBack: () => void;
  onTest: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [tab, setTab] = useState<Tab>("overview");
  const audit = useResource<{ records: AuditRecord[]; total: number }>(
    `/api/audit?kind=mcp&server=${encodeURIComponent(server.alias)}&limit=20`,
    { records: [], total: 0 },
  );
  return (
    <>
      <div className="detail-breadcrumb">
        <Button variant="quiet" onClick={onBack}>
          <ArrowLeft size={14} />
          服务器
        </Button>
        <ChevronRight size={12} />
        <span>{server.alias}</span>
      </div>
      <div className="server-detail-heading">
        <div className="detail-title">
          <h1>{server.alias}</h1>
          <Status
            value={check ? (check.ok ? "ok" : "error") : "unchecked"}
            label={check ? (check.ok ? "检测通过" : "连接失败") : "尚未检测"}
          />
        </div>
        <div className="detail-address">
          {server.tags[0] && <span className="tag">{server.tags[0]}</span>}
          <span>
            {server.host}:{server.port}
          </span>
        </div>
        <div className="button-row">
          <Button disabled={busy} onClick={onTest}>
            <Cable size={14} />
            {busy ? "检测中…" : "测试连接"}
          </Button>
          <Button onClick={onEdit}>
            <Pencil size={14} />
            编辑
          </Button>
          <Button variant="danger" onClick={onDelete}>
            删除
          </Button>
        </div>
      </div>
      <section className="panel reference-path-panel">
        <h2>连接路径</h2>
        <div className="reference-path">
          <div>
            <Terminal size={14} />
            <span>AI 客户端</span>
          </div>
          <ArrowRight size={14} className="success-text" />
          <div>
            <Cable size={14} />
            <span>MCP 网关</span>
          </div>
          <ArrowRight size={14} className="success-text" />
          <div>
            <Server size={14} />
            <span>目标服务器</span>
          </div>
        </div>
        <div className="path-result">
          {check ? (
            check.ok ? (
              <CircleCheck size={14} className="success-text" />
            ) : (
              <CircleAlert size={14} className="danger-text" />
            )
          ) : (
            <CircleAlert size={14} className="muted" />
          )}
          <span>
            {check
              ? check.ok
                ? "SSH 连接已验证"
                : check.message
              : "配置路径 · SSH 连接尚未检测"}
          </span>
        </div>
      </section>
      <div className="detail-tabs" role="tablist" aria-label="服务器详情">
        {tabs.map((item, index) => (
          <button
            key={item.id}
            id={`server-tab-${item.id}`}
            role="tab"
            aria-selected={tab === item.id}
            aria-controls={`server-panel-${item.id}`}
            tabIndex={tab === item.id ? 0 : -1}
            onClick={() => setTab(item.id)}
            onKeyDown={(event) => {
              let next = index;
              if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
              else if (event.key === "ArrowLeft")
                next = (index + tabs.length - 1) % tabs.length;
              else if (event.key === "Home") next = 0;
              else if (event.key === "End") next = tabs.length - 1;
              else return;
              event.preventDefault();
              setTab(tabs[next].id);
              document.getElementById(`server-tab-${tabs[next].id}`)?.focus();
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div
        className="detail-tab-content"
        role="tabpanel"
        id={`server-panel-${tab}`}
        aria-labelledby={`server-tab-${tab}`}
        tabIndex={0}
      >
        {tab === "overview" && (
          <>
            <section className="panel reference-info-panel">
              <h2>基本信息</h2>
              <table className="reference-info-table">
                <tbody>
                  <tr>
                    <th>SSH 地址</th>
                    <td>{server.host}</td>
                  </tr>
                  <tr>
                    <th>端口</th>
                    <td>{server.port}</td>
                  </tr>
                  <tr>
                    <th>认证方式</th>
                    <td>
                      {credentialLabels[server.credential_type] ||
                        server.credential_type}
                    </td>
                  </tr>
                  <tr>
                    <th>主机指纹校验</th>
                    <td>{server.has_known_hosts ? "已配置" : "未配置"}</td>
                  </tr>
                  <tr>
                    <th>远端账号</th>
                    <td>{server.username}</td>
                  </tr>
                  <tr>
                    <th>描述</th>
                    <td>{server.description || "—"}</td>
                  </tr>
                </tbody>
              </table>
            </section>
            <section className="panel reference-info-panel">
              <h2>最近调用</h2>
              <Feedback message={audit.error} />
              {audit.data.records.slice(0, 2).map((record) => (
                <div className="detail-call" key={record.id}>
                  <div>
                    <p>
                      {record.tool || "—"} ·{" "}
                      {record.token_name ||
                        record.token_id ||
                        record.user ||
                        "历史调用"}
                    </p>
                    <time dateTime={record.ts}>
                      {formatCompactTime(record.ts, true)}
                    </time>
                  </div>
                  <Status value={record.status} />
                </div>
              ))}
              {!audit.data.records.length && (
                <p className="muted small">
                  {audit.loading
                    ? "正在读取…"
                    : audit.error
                      ? "调用记录加载失败"
                      : "暂无调用记录"}
                </p>
              )}
            </section>
          </>
        )}
        {tab === "config" && (
          <section className="panel reference-info-panel">
            <h2>连接配置</h2>
            <table className="reference-info-table">
              <tbody>
                <tr>
                  <th>服务器别名</th>
                  <td>{server.alias}</td>
                </tr>
                <tr>
                  <th>目标端点</th>
                  <td>
                    {server.host}:{server.port}
                  </td>
                </tr>
                <tr>
                  <th>远端账号</th>
                  <td>{server.username}</td>
                </tr>
                <tr>
                  <th>标签</th>
                  <td>{server.tags.join("、") || "—"}</td>
                </tr>
                <tr>
                  <th>主机指纹校验</th>
                  <td>{server.has_known_hosts ? "已配置" : "未配置"}</td>
                </tr>
                <tr>
                  <th>凭据</th>
                  <td>
                    {credentialLabels[server.credential_type] ||
                      server.credential_type}{" "}
                    · 仅写入，不回显
                  </td>
                </tr>
              </tbody>
            </table>
            <Button onClick={onEdit}>
              <Pencil size={14} />
              编辑配置
            </Button>
          </section>
        )}
        {tab === "audit" && (
          <section className="panel reference-info-panel">
            <h2>审计记录</h2>
            <Feedback message={audit.error} />
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>时间</th>
                    <th>Token</th>
                    <th>工具</th>
                    <th>状态</th>
                  </tr>
                </thead>
                <tbody>
                  {audit.data.records.map((record) => (
                    <tr key={record.id}>
                      <td className="nowrap">{formatTime(record.ts)}</td>
                      <td>
                        {record.token_name ||
                          record.token_id ||
                          record.user ||
                          "—"}
                      </td>
                      <td>{record.tool || "—"}</td>
                      <td>
                        <Status value={record.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="muted small">
              {audit.loading
                ? "正在读取…"
                : audit.error
                  ? "加载失败"
                  : `展示最近 ${audit.data.records.length} 条，共 ${audit.data.total} 条记录`}
            </p>
          </section>
        )}
      </div>
    </>
  );
}
