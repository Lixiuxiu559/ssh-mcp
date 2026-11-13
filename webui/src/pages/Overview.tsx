import { useState } from "react";
import {
  Activity,
  ArrowRight,
  CircleCheck,
  CircleAlert,
  Network,
  Server,
} from "lucide-react";
import type { AuditRecord, Page, ServerEntry, TokenEntry } from "../types";
import { useResource } from "../lib/use-resource";
import { formatTime } from "../lib/utils";
import { Button } from "../components/ui/button";
import { Feedback, Status } from "../components/ui/feedback";

interface AuditResult {
  records: AuditRecord[];
  total: number;
}
const actions: Record<string, string> = {
  "user.login": "登录后台",
  "user.initialize": "初始化工作区",
  "user.logout": "退出登录",
  "server.create": "添加服务器",
  "server.update": "更新服务器",
  "server.delete": "删除服务器",
  "server.test": "测试连接",
  "token.create": "创建 Token",
  "token.update": "更新 Token",
  "token.revoke": "吊销 Token",
  "user.create": "添加成员",
  "user.update": "更新成员",
  "audit.export": "导出审计",
  "key.upload": "上传密钥",
};
const startOfWindow = () => new Date(Date.now() - 86400000).toISOString();
const shortTime = (value: string) =>
  new Date(value).toLocaleTimeString("zh-CN", { hour12: false });

export default function Overview({
  onNavigate,
  healthy,
}: {
  onNavigate: (page: Page) => void;
  healthy: boolean;
}) {
  const [since, setSince] = useState(startOfWindow);
  const servers = useResource<{ servers: ServerEntry[] }>("/api/servers", {
    servers: [],
  });
  const tokens = useResource<{ tokens: TokenEntry[] }>("/api/tokens", {
    tokens: [],
  });
  const windowQuery = `since=${encodeURIComponent(since)}`;
  const calls = useResource<AuditResult>(
    `/api/audit?kind=mcp&limit=3&${windowQuery}`,
    { records: [], total: 0 },
  );
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
  const error = [
    ...new Set(resources.map((resource) => resource.error).filter(Boolean)),
  ].join("；");
  const enabledTokens = tokens.data.tokens.filter(
    (token) => token.enabled && !token.revoked,
  ).length;
  const number = (
    value: number,
    resource: { loading: boolean; error: string },
  ) =>
    resource.error || resource.loading ? "—" : value.toLocaleString("zh-CN");
  function refresh() {
    setSince(startOfWindow());
    servers.reload();
    tokens.reload();
    events.reload();
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>总览</h1>
          <p>监控服务器连接和 MCP 工具调用</p>
        </div>
        <button
          className={`status ${healthy ? "status-connected" : "status-offline"}`}
          onClick={refresh}
          disabled={loading}
          aria-label="刷新总览数据"
          title="刷新总览数据"
        >
          <CircleCheck size={12} />
          {healthy ? "网关正常" : "状态未知"}
        </button>
      </div>
      <Feedback message={error} />
      <div className="overview-metrics" aria-busy={loading}>
        <div className="metric-card">
          <div className="metric-label">
            服务器总数
            <Server size={14} />
          </div>
          <strong>{number(servers.data.servers.length, servers)}</strong>
          <p>已配置 SSH 目标</p>
        </div>
        <div className="metric-card">
          <div className="metric-label">
            近 24h MCP 调用
            <Activity size={14} />
          </div>
          <strong>{number(calls.data.total, calls)}</strong>
          <p>最近 24 小时的调用记录</p>
        </div>
        <div className="metric-card">
          <div className="metric-label">
            近 24h 执行失败
            <CircleAlert size={14} />
          </div>
          <strong>{number(failures.data.total, failures)}</strong>
          <p className="danger-text">
            {!failures.error && !calls.error && !loading && calls.data.total
              ? `执行失败占比 ${((failures.data.total / calls.data.total) * 100).toFixed(2)}%`
              : "调用结果为失败的记录"}
          </p>
        </div>
        <div className="metric-card">
          <div className="metric-label">
            有效 MCP Token
            <Network size={14} />
          </div>
          <strong>{number(enabledTokens, tokens)}</strong>
          <p>已启用且未吊销的凭证</p>
        </div>
      </div>
      <section className="panel overview-calls">
        <div className="section-heading">
          <h2>最近 MCP 调用</h2>
          <span className="tag">最近 24h</span>
        </div>
        <div className="table-scroll" aria-busy={calls.loading}>
          <table className="data-table recent-calls">
            <thead>
              <tr>
                <th>Token</th>
                <th>目标服务器</th>
                <th>工具</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              {calls.data.records.map((record) => (
                <tr key={record.id}>
                  <td>
                    {record.token_name ||
                      record.token_id ||
                      record.user ||
                      "历史调用"}
                  </td>
                  <td>{record.server || "网关"}</td>
                  <td>{record.tool || "—"}</td>
                  <td>
                    <Status value={record.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!calls.data.records.length && (
            <p className="empty-inline">
              {calls.error
                ? "加载失败，请刷新重试"
                : calls.loading
                  ? "正在读取…"
                  : "最近 24 小时暂无调用记录"}
            </p>
          )}
        </div>
      </section>
      <section className="panel overview-events">
        <div className="section-heading">
          <h2>最近事件</h2>
          <Button variant="quiet" onClick={() => onNavigate("person-audit")}>
            查看审计
            <ArrowRight size={14} />
          </Button>
        </div>
        <div className="event-list" aria-busy={events.loading}>
          {events.data.records.map((record, index) => (
            <div
              className="event-item"
              key={record.id || `${record.ts}-${index}`}
            >
              {record.status === "ok" ? (
                <CircleCheck size={14} className="success-text" />
              ) : (
                <CircleAlert size={14} className="danger-text" />
              )}
              <div>
                <p title={record.object_id || undefined}>
                  {actions[record.action || ""] ||
                    record.action ||
                    "工作区操作"}
                  {record.object_id &&
                  !["user", "session"].includes(record.object_type || "")
                    ? ` · ${record.object_id}`
                    : ` · ${record.username || record.user || "未认证来源"}`}
                </p>
                <time dateTime={record.ts} title={formatTime(record.ts)}>
                  {shortTime(record.ts)}
                </time>
              </div>
              <Status value={record.status} />
            </div>
          ))}
        </div>
        {!events.data.records.length && (
          <p className="empty-inline">
            {events.error
              ? "加载失败，请刷新重试"
              : events.loading
                ? "正在读取…"
                : "暂无人员操作记录"}
          </p>
        )}
      </section>
      <Button className="overview-more" onClick={() => onNavigate("servers")}>
        查看服务器列表
        <ArrowRight size={14} />
      </Button>
    </>
  );
}
