import { Button, Flex, Form, Select, Tag, Typography } from "antd";
import type { WorkspaceEntry } from "../console-types";
import { Feedback } from "./Feedback";

export function WorkspaceLabels({
  ids,
  workspaces,
}: {
  ids: string[];
  workspaces: WorkspaceEntry[];
}) {
  if (!ids.length) return <Typography.Text type="secondary">未分配</Typography.Text>;
  return (
    <Flex gap={4} wrap justify="center">
      {ids.map((id) => (
        <Tag key={id} style={{ marginInlineEnd: 0, whiteSpace: "normal", overflowWrap: "anywhere" }}>
          {workspaces.find((workspace) => workspace.id === id)?.name || id}
        </Tag>
      ))}
    </Flex>
  );
}

export function WorkspaceSelectField({
  multiple = false,
  disabled = false,
  workspaces,
  loading,
  error,
  onRetry,
  onManage,
}: {
  multiple?: boolean;
  disabled?: boolean;
  workspaces: WorkspaceEntry[];
  loading: boolean;
  error: string;
  onRetry: () => void;
  onManage?: () => void;
}) {
  return (
    <>
      <Form.Item
        name={multiple ? "workspace_ids" : "workspace_id"}
        label={multiple ? "所属工作空间" : "工作空间"}
        rules={multiple ? undefined : [{ required: true, message: "请选择一个工作空间" }]}
        extra={multiple
          ? "可选择多个工作空间；未分配时，任何 MCP Token 都无法访问此资源。"
          : "Token 仅可访问此工作空间内的资源，创建后不可更改归属。"}
      >
        <Select
          mode={multiple ? "multiple" : undefined}
          allowClear={multiple}
          showSearch
          optionFilterProp="label"
          loading={loading}
          disabled={disabled || loading || !!error || !workspaces.length}
          placeholder={multiple ? "选择工作空间（可选）" : "选择一个工作空间"}
          options={workspaces.map((workspace) => ({ value: workspace.id, label: workspace.name }))}
        />
      </Form.Item>
      {error && (
        <Flex vertical gap={8} style={{ marginBottom: 16 }}>
          <Feedback message={`工作空间加载失败：${error}`} />
          <Button disabled={disabled} onClick={onRetry} style={{ alignSelf: "start" }}>重试加载工作空间</Button>
        </Flex>
      )}
      {!loading && !error && !workspaces.length && (
        <Typography.Paragraph type="secondary">
          尚无工作空间。先创建工作空间，再分配资源和创建 Token。
          {onManage && <Button disabled={disabled} type="link" size="small" onClick={onManage}>管理工作空间</Button>}
        </Typography.Paragraph>
      )}
    </>
  );
}
