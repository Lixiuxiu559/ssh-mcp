import type { Key, ReactNode } from "react";
import { Button, Flex } from "antd";
import type { TablePaginationConfig } from "antd";
import type { ColumnsType } from "antd/es/table";
import { AppTable } from "./AppTable";
import { Feedback } from "./Feedback";
import { ListNotice } from "./ListStates";

export interface TableColumn<T> {
  id: string;
  header: ReactNode;
  render?: (row: T) => ReactNode;
  value?: (row: T) => string | number | null | undefined;
  sortable?: boolean;
  align?: "left" | "center" | "right";
  width?: number | string;
  fixed?: "left" | "right";
}

export function DataTable<T extends object>({
  columns,
  data,
  rowKey,
  loading = false,
  error,
  onRetry,
  empty = "暂无记录",
  emptyDescription = "添加记录或调整筛选条件后重试",
  emptyAction,
  sortable = true,
  stickyHeader = false,
  fixedLayout = false,
  minWidth = 200,
  pagination,
}: {
  columns: TableColumn<T>[];
  data: T[];
  rowKey?: (row: T, index: number) => Key;
  loading?: boolean;
  error?: string;
  onRetry?: () => void;
  empty?: string;
  emptyDescription?: string;
  emptyAction?: ReactNode;
  sortable?: boolean;
  stickyHeader?: boolean;
  fixedLayout?: boolean;
  minWidth?: number;
  pagination?: TablePaginationConfig | false;
}) {
  const definitions: ColumnsType<T> = columns.map((column) => ({
    key: column.id,
    title: column.header,
    width: column.width,
    fixed: column.fixed,
    align: column.align,
    sorter:
      sortable && column.sortable !== false && column.value
        ? (a, b) => {
            const x = column.value!(a);
            const y = column.value!(b);
            return typeof x === "number" && typeof y === "number"
              ? x - y
              : String(x ?? "").localeCompare(String(y ?? ""), "zh-CN");
          }
        : undefined,
    render: (_, row) => {
      if (column.render) return column.render(row);
      const value = column.value
        ? column.value(row)
        : (row as Record<string, unknown>)[column.id];
      return value == null || value === "" ? "—" : String(value);
    },
  }));
  return (
    <Flex vertical gap={12}>
      {error && (
        <div>
          <Feedback message={error} />
          {onRetry && (
            <Button onClick={onRetry} loading={loading}>
              重试
            </Button>
          )}
        </div>
      )}
      {!loading && !error && !data.length ? (
        <ListNotice
          title={empty}
          description={emptyDescription}
          action={emptyAction}
        />
      ) : (
        <AppTable<T>
          size="middle"
          dataSource={data}
          columns={definitions}
          rowKey={(row, index) =>
            rowKey ? rowKey(row, index ?? 0) : String(index)
          }
          loading={loading}
          pagination={pagination}
          sticky={stickyHeader}
          tableLayout={fixedLayout ? "fixed" : "auto"}
          scroll={{ x: minWidth }}
        />
      )}
    </Flex>
  );
}
