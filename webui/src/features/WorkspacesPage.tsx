import { useId, useState } from "react";
import { Button, Card, Flex, Form, Input, Space, Tooltip, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { Pencil, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import { api, json } from "../api";
import type { WorkspaceEntry } from "../console-types";
import { useWorkspaces } from "../lib/use-workspaces";
import { useListPagination } from "../lib/pagination";
import { errorText } from "../lib/utils";
import { AppModal } from "../components/AppModal";
import { AppTable } from "../components/AppTable";
import { Feedback } from "../components/Feedback";
import { ListNotice, ResourceStatus } from "../components/ListStates";
import { PageHeading } from "../components/PageHeading";

function WorkspaceEditor({ item, onClose, onSaved }: {
  item: WorkspaceEntry | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const formId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save({ name }: { name: string }) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await api(item ? `/api/workspaces/${encodeURIComponent(item.id)}` : "/api/workspaces",
        json(item ? "PATCH" : "POST", { name: name.trim() }));
      onSaved();
    } catch (error) {
      setError(errorText(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <AppModal opened busy={busy} onClose={onClose} title={item ? "重命名工作空间" : "创建工作空间"}
      footer={<Space><Button disabled={busy} onClick={onClose}>取消</Button><Button type="primary" form={formId} htmlType="submit" loading={busy}>{item ? "保存名称" : "创建工作空间"}</Button></Space>}>
      <Form id={formId} layout="vertical" disabled={busy} initialValues={{ name: item?.name || "" }} onFinish={save}>
        <Feedback message={error} />
        <Form.Item name="name" label="工作空间名称" rules={[{ required: true, whitespace: true, message: "请输入工作空间名称" }, { max: 100, message: "名称不能超过 100 个字符" }]}>
          <Input autoFocus autoComplete="off" maxLength={100} placeholder="例如：订单系统、项目 A" />
        </Form.Item>
        <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>资源可分配至多个工作空间，每个 MCP Token 固定属于一个工作空间。</Typography.Paragraph>
      </Form>
    </AppModal>
  );
}

export default function WorkspacesPage() {
  const { data, loading, error, reload } = useWorkspaces();
  const { pagination, resetPage } = useListPagination();
  const [query, setQuery] = useState("");
  const [editor, setEditor] = useState<WorkspaceEntry | null | undefined>(undefined);
  const [deleting, setDeleting] = useState<WorkspaceEntry | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [message, setMessage] = useState("");
  const filtered = data.workspaces.filter((workspace) => workspace.name.toLowerCase().includes(query.trim().toLowerCase()));
  async function remove() {
    if (!deleting || busy) return;
    setBusy(true);
    setActionError("");
    try {
      await api(`/api/workspaces/${encodeURIComponent(deleting.id)}`, json("DELETE"));
      setDeleting(null);
      const lastPage = Math.max(1, Math.ceil((filtered.length - 1) / pagination.pageSize));
      if (pagination.current > lastPage) pagination.onChange(lastPage, pagination.pageSize);
      reload();
      setMessage("工作空间已删除，历史审计保留。");
    } catch (error) {
      setActionError(errorText(error));
    } finally {
      setBusy(false);
    }
  }
  const columns: ColumnsType<WorkspaceEntry> = [
    { key: "name", title: "工作空间", sorter: (a, b) => a.name.localeCompare(b.name), render: (_, item) => <Typography.Text strong className="wrap-anywhere">{item.name}</Typography.Text> },
    { key: "id", title: "空间标识", render: (_, item) => <span className="mono wrap-anywhere">{item.id}</span> },
    { key: "actions", title: "操作", width: 160, render: (_, item) => <Space>
      <Button type="text" disabled={busy || loading} icon={<Pencil size={15} aria-hidden="true" />} onClick={() => setEditor(item)}>重命名</Button>
      <Tooltip title="删除工作空间"><Button danger type="text" disabled={busy || loading} aria-label={`删除 ${item.name}`} icon={<Trash2 size={15} aria-hidden="true" />} onClick={() => { setDeleting(item); setActionError(""); }} /></Tooltip>
    </Space> },
  ];
  return (
    <>
      <PageHeading title="工作空间" />
      <Feedback message={message} success onDismiss={() => setMessage("")} />
      {!data.workspaces.length && (loading || error) ? <ResourceStatus loading={loading} error={error} onRetry={reload} /> : <Card>
        <Flex gap={12} align="center" style={{ marginBottom: 16 }}>
          <Input allowClear style={{ width: 280 }} value={query} aria-label="搜索工作空间" placeholder="搜索工作空间名称…" prefix={<Search size={15} aria-hidden="true" />} onChange={(event) => { setQuery(event.target.value); resetPage(); }} />
          <Typography.Text type="secondary" style={{ marginLeft: "auto" }}>共 {data.workspaces.length} 个工作空间</Typography.Text>
          <Button type="text" aria-label="刷新工作空间" loading={loading} icon={<RefreshCw size={15} aria-hidden="true" />} onClick={reload} />
          <Button type="primary" disabled={busy || loading} icon={<Plus size={15} aria-hidden="true" />} onClick={() => setEditor(null)}>创建工作空间</Button>
        </Flex>
        <Feedback message={error} />
        {error && <Button onClick={reload} style={{ marginBottom: 16 }}>重试</Button>}
        {!filtered.length && !loading && !error ? <ListNotice title={query ? "没有匹配的工作空间" : "创建第一个工作空间"} description={query ? "试试其他工作空间名称。" : "先创建工作空间，再分配资源并创建专属 MCP Token。后台始终展示全部工作空间的资源。"} onClear={query ? () => { setQuery(""); resetPage(); } : undefined} action={!query ? <Button type="primary" onClick={() => setEditor(null)}>创建工作空间</Button> : undefined} /> : <AppTable<WorkspaceEntry> aria-label="工作空间列表" rowKey="id" dataSource={filtered} columns={columns} loading={loading} pagination={{ ...pagination, total: filtered.length }} tableLayout="fixed" scroll={{ x: 680 }} />}
        <Typography.Paragraph type="secondary" style={{ margin: "16px 0 0" }}>已有资源或未删除 Token 引用的工作空间无法删除。请先移除资源归属并删除该空间的 Token。</Typography.Paragraph>
      </Card>}
      {editor !== undefined && <WorkspaceEditor item={editor} onClose={() => setEditor(undefined)} onSaved={() => { setEditor(undefined); setQuery(""); resetPage(); reload(); setMessage(editor ? "工作空间名称已更新。" : "工作空间已创建。"); }} />}
      <AppModal opened={!!deleting} busy={busy} onClose={() => setDeleting(null)} title="删除工作空间" footer={<Space><Button disabled={busy} onClick={() => setDeleting(null)}>取消</Button><Button danger type="primary" loading={busy} onClick={() => void remove()}>确认删除</Button></Space>}>
        <Typography.Paragraph>确认删除 <Typography.Text strong>{deleting?.name}</Typography.Text>？删除后无法恢复，历史审计保留。</Typography.Paragraph>
        <Typography.Paragraph type="secondary">如仍有资源或未删除 Token 引用，服务会拒绝删除并显示原因。</Typography.Paragraph>
        <Feedback message={actionError} />
      </AppModal>
    </>
  );
}
