import { Table } from "antd";
import type { TablePaginationConfig, TableProps } from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  DEFAULT_PAGE_SIZE,
  PAGE_SIZE_OPTIONS,
  listPagination,
  useListPagination,
} from "../lib/pagination";

function centerColumns<T extends object>(columns: ColumnsType<T>): ColumnsType<T> {
  return columns.map((column) => ({
    ...column,
    align: "center",
    ...("children" in column ? { children: centerColumns(column.children) } : {}),
  }));
}

export function AppTable<T extends object>({
  columns,
  pagination,
  ...props
}: TableProps<T>) {
  const { pagination: localPagination } = useListPagination();
  let options: TablePaginationConfig | false = false;
  if (pagination !== false) {
    const pageSize = pagination?.pageSize ?? localPagination.pageSize;
    const total = pagination?.total ?? props.dataSource?.length ?? 0;
    const current = pagination?.current ?? localPagination.current;
    options = {
      ...listPagination,
      ...localPagination,
      ...pagination,
      current: Math.min(current, Math.max(1, Math.ceil(total / pageSize))),
      pageSize,
      defaultPageSize: DEFAULT_PAGE_SIZE,
      pageSizeOptions: PAGE_SIZE_OPTIONS,
      showSizeChanger: true,
      onChange: (value, size, info) => {
        const nextPage = size === pageSize ? value : 1;
        localPagination.onChange(nextPage, size);
        pagination?.onChange?.(nextPage, size, info);
      },
    };
  }
  return (
    <Table<T>
      {...props}
      columns={columns && centerColumns(columns)}
      pagination={options}
    />
  );
}
