import {
  Breadcrumb,
  Button,
  Card,
  Descriptions,
  Flex,
  Space,
  Table,
  Tabs,
  Tag,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  ArrowLeft,
  ArrowRight,
  Cable,
  CircleAlert,
  CircleCheck,
  Pencil,
  Server,
  Terminal,
} from "lucide-react";
import type { AuditRecord, ServerEntry } from "../types";
import { useResource } from "../lib/use-resource";
import { formatTime, formatCompactTime } from "../lib/utils";
import { ListNotice } from "./ListStates";
import { Feedback, Status } from "./Feedback";

export interface ConnectionCheck {
  ok: boolean;
  message: string;
}
export const credentialLabels: Record<string, string> = {
  private_key_file: "私钥文件",
  private_key_inline: "内嵌私钥",
  password: "密码",
};

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
  const audit = useResource<{ records: AuditRecord[]; total: number }>(
    `/api/audit?kind=mcp&server=${encodeURIComponent(server.alias)}&limit=20`,
    { records: [], total: 0 },
  );
  const noCalls = !audit.loading && !audit.error && !audit.data.records.length;
  const credential =
    credentialLabels[server.credential_type] || server.credential_type;
  const columns: ColumnsType<AuditRecord> = [
    {
      key: "time",
      title: "时间",
      width: 190,
      render: (_, row) => <span className="nowrap">{formatTime(row.ts)}</span>,
    },
    {
      key: "token",
      title: "Token",
      ellipsis: true,
      render: (_, row) => row.token_name || row.token_id || row.user || "—",
    },
    {
      key: "tool",
      title: "工具",
      ellipsis: true,
      render: (_, row) => row.tool || "—",
    },
    {
      key: "status",
      title: "状态",
      width: 110,
      render: (_, row) => <Status value={row.status} />,
    },
  ];
  const overview = (
    <Flex vertical gap={16}>
      <Card title="基本信息">
        <Descriptions
          column={2}
          items={[
            { key: "host", label: "SSH 地址", children: server.host },
            { key: "port", label: "端口", children: server.port },
            { key: "credential", label: "认证方式", children: credential },
            {
              key: "knownHosts",
              label: "主机指纹校验",
              children: server.has_known_hosts ? "已配置" : "未配置",
            },
            { key: "username", label: "远端账号", children: server.username },
            {
              key: "description",
              label: "描述",
              children: server.description || "—",
            },
          ]}
        />
      </Card>
      <Card
        title="最近调用"
        loading={audit.loading && !audit.data.records.length}
      >
        <Feedback message={audit.error} />
        <Flex vertical gap={12}>
          {audit.data.records.slice(0, 2).map((record) => (
            <Flex
              key={record.id}
              justify="space-between"
              gap={12}
              align="center"
            >
              <Flex vertical style={{ minWidth: 0 }}>
                <Typography.Text ellipsis>
                  {record.tool || "—"} ·{" "}
                  {record.token_name ||
                    record.token_id ||
                    record.user ||
                    "历史调用"}
                </Typography.Text>
                <Typography.Text type="secondary">
                  <time dateTime={record.ts}>
                    {formatCompactTime(record.ts, true)}
                  </time>
                </Typography.Text>
              </Flex>
              <Status value={record.status} />
            </Flex>
          ))}
        </Flex>
        {noCalls && (
          <ListNotice
            compact
            title="暂无调用记录"
            description="通过 MCP 在这台服务器上执行工具后，即可查看最近调用。"
          />
        )}
      </Card>
    </Flex>
  );
  const config = (
    <Card title="连接配置">
      <Descriptions
        column={2}
        items={[
          { key: "alias", label: "服务器别名", children: server.alias },
          {
            key: "host",
            label: "目标端点",
            children: `${server.host}:${server.port}`,
          },
          { key: "username", label: "远端账号", children: server.username },
          {
            key: "tags",
            label: "标签",
            children: server.tags.join("、") || "—",
          },
          {
            key: "knownHosts",
            label: "主机指纹校验",
            children: server.has_known_hosts ? "已配置" : "未配置",
          },
          {
            key: "credential",
            label: "凭据",
            children: `${credential} · 仅写入，不回显`,
          },
        ]}
      />
      <Button
        onClick={onEdit}
        style={{ marginTop: 16 }}
        icon={<Pencil size={14} aria-hidden="true" />}
      >
        编辑配置
      </Button>
    </Card>
  );
  const history = (
    <Card title="审计记录">
      <Feedback message={audit.error} />
      {noCalls ? (
        <ListNotice
          title="这台服务器暂无调用记录"
          description="首次 MCP 调用后，这里会显示调用时间、凭证和执行结果。"
        />
      ) : (
        <>
          <Table<AuditRecord>
            dataSource={audit.data.records}
            columns={columns}
            rowKey="id"
            pagination={false}
            loading={audit.loading}
            tableLayout="fixed"
            scroll={{ x: 600 }}
          />
          {!!audit.data.total && (
            <Typography.Paragraph
              type="secondary"
              style={{ marginTop: 12, marginBottom: 0 }}
            >
              展示最近 {audit.data.records.length} 条，共 {audit.data.total}{" "}
              条记录
            </Typography.Paragraph>
          )}
        </>
      )}
    </Card>
  );
  return (
    <>
      <Breadcrumb
        style={{ marginBottom: 16 }}
        items={[
          {
            title: (
              <Button
                type="link"
                size="small"
                onClick={onBack}
                icon={<ArrowLeft size={13} aria-hidden="true" />}
              >
                服务器
              </Button>
            ),
          },
          { title: server.alias },
        ]}
      />
      <Flex
        justify="space-between"
        align="start"
        style={{ marginBottom: 20 }}
        gap={16}
      >
        <Flex vertical gap={6}>
          <Space>
            <Typography.Title level={1} style={{ margin: 0 }}>
              {server.alias}
            </Typography.Title>
            <Status
              value={check ? (check.ok ? "ok" : "error") : "unchecked"}
              label={check ? (check.ok ? "检测通过" : "连接失败") : "尚未检测"}
            />
          </Space>
          <Space>
            {server.tags[0] && <Tag>{server.tags[0]}</Tag>}
            <Typography.Text>
              {server.host}:{server.port}
            </Typography.Text>
          </Space>
        </Flex>
        <Space>
          <Button
            disabled={busy}
            loading={busy}
            onClick={onTest}
            icon={<Cable size={14} aria-hidden="true" />}
          >
            测试连接
          </Button>
          <Button
            onClick={onEdit}
            disabled={busy}
            icon={<Pencil size={14} aria-hidden="true" />}
          >
            编辑
          </Button>
          <Button danger onClick={onDelete} disabled={busy}>
            删除
          </Button>
        </Space>
      </Flex>
      <Card size="small" style={{ marginBottom: 16 }}>
        <Flex justify="space-between" align="center" gap={16}>
          <Space size={16}>
            <Space size={6}>
              <Terminal size={14} aria-hidden="true" />
              <Typography.Text>AI 客户端</Typography.Text>
            </Space>
            <ArrowRight size={14} aria-hidden="true" />
            <Space size={6}>
              <Cable size={14} aria-hidden="true" />
              <Typography.Text>MCP 网关</Typography.Text>
            </Space>
            <ArrowRight size={14} aria-hidden="true" />
            <Space size={6}>
              <Server size={14} aria-hidden="true" />
              <Typography.Text>目标服务器</Typography.Text>
            </Space>
          </Space>
          <Space size={6}>
            {check?.ok ? (
              <CircleCheck
                size={14}
                aria-hidden="true"
                style={{ color: "var(--ant-color-success)" }}
              />
            ) : (
              <CircleAlert
                size={14}
                aria-hidden="true"
                style={{
                  color: check
                    ? "var(--ant-color-error)"
                    : "var(--ant-color-text-secondary)",
                }}
              />
            )}
            <Typography.Text type={check && !check.ok ? "danger" : undefined}>
              {check
                ? check.ok
                  ? "SSH 连接已验证"
                  : check.message
                : "SSH 连接尚未检测"}
            </Typography.Text>
          </Space>
        </Flex>
      </Card>
      <Tabs
        defaultActiveKey="overview"
        items={[
          { key: "overview", label: "概览", children: overview },
          { key: "config", label: "连接配置", children: config },
          { key: "audit", label: "审计记录", children: history },
        ]}
      />
    </>
  );
}
