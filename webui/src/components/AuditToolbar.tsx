import type { ReactNode } from "react";
import { Download, RefreshCw, Search, X } from "lucide-react";
import { Button, Flex, Form, Input, Select } from "antd";

export interface AuditToolbarDraft {
  q: string;
  days: string;
  status: string;
}

export interface AuditToolbarProps {
  draft: AuditToolbarDraft;
  onChange: (key: keyof AuditToolbarDraft, value: string) => void;
  searchPlaceholder: string;
  resourceFilter?: ReactNode;
  identityFilter?: ReactNode;
  statusValues?: readonly string[];
  loading: boolean;
  exporting: boolean;
  showClear: boolean;
  onSearch: () => void;
  onClear: () => void;
  onRefresh: () => void;
  onExport: () => void;
}

const daysOptions = [
  { value: "1", label: "最近 24 小时" },
  { value: "7", label: "最近 7 天" },
  { value: "30", label: "最近 30 天" },
  { value: "all", label: "全部留存记录" },
];

const statusOptions = [
  { value: "", label: "全部结果" },
  { value: "ok", label: "成功" },
  { value: "error", label: "失败" },
  { value: "denied", label: "已拒绝" },
  { value: "timeout", label: "超时" },
  { value: "cancelled", label: "已取消" },
  { value: "pending", label: "未完成" },
  { value: "running", label: "进行中" },
  { value: "unknown", label: "结果未知" },
];

export function AuditToolbar({
  draft,
  onChange,
  searchPlaceholder,
  resourceFilter,
  identityFilter,
  statusValues,
  loading,
  exporting,
  showClear,
  onSearch,
  onClear,
  onRefresh,
  onExport,
}: AuditToolbarProps) {
  return (
    <Form className="audit-filter" onFinish={onSearch}>
      <Flex align="center" gap={12} wrap style={{ marginBottom: 16 }}>
        <Input
          style={{ flex: 1, minWidth: 144 }}
          allowClear
          aria-label="搜索审计记录"
          value={draft.q}
          placeholder={searchPlaceholder}
          prefix={<Search size={15} aria-hidden="true" />}
          onChange={(event) => onChange("q", event.target.value)}
        />
        <Select
          aria-label="审计时间范围"
          style={{ width: 150 }}
          options={daysOptions}
          value={draft.days}
          onChange={(value) => onChange("days", value ?? "7")}
        />
        <Select
          aria-label="操作结果"
          style={{ width: 130 }}
          options={statusValues
            ? statusOptions.filter((option) => statusValues.includes(option.value))
            : statusOptions}
          value={draft.status}
          onChange={(value) => onChange("status", value ?? "")}
        />
        {resourceFilter}
        {identityFilter}
        <Flex gap={8}>
          <Button type="primary" htmlType="submit" loading={loading}>
            筛选
          </Button>
          {showClear && (
            <Button onClick={onClear} aria-label="清除审计筛选">
              <X size={15} aria-hidden="true" />
            </Button>
          )}
          <Button onClick={onRefresh} disabled={loading} aria-label="刷新审计">
            <RefreshCw size={15} aria-hidden="true" />
          </Button>
          <Button
            onClick={() => void onExport()}
            loading={exporting}
            icon={<Download size={15} aria-hidden="true" />}
          >
            {exporting ? "正在导出…" : "导出 CSV"}
          </Button>
        </Flex>
      </Flex>
    </Form>
  );
}
