import { useState } from "react";
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { ArrowUpDown, SearchX } from "lucide-react";
export function DataTable<T>({
  data,
  columns,
  loading,
  empty = "暂无记录",
  sortable = true,
}: {
  data: T[];
  columns: ColumnDef<T, unknown>[];
  loading?: boolean;
  empty?: string;
  sortable?: boolean;
}) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const table = useReactTable({
    data,
    columns,
    enableSorting: sortable,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });
  return (
    <div className="table-scroll" aria-busy={loading}>
      <table className="data-table">
        <thead>
          {table.getHeaderGroups().map((group) => (
            <tr key={group.id}>
              {group.headers.map((header) => (
                <th key={header.id}>
                  {header.isPlaceholder ? null : header.column.getCanSort() ? (
                    <button
                      className="sort-button"
                      onClick={header.column.getToggleSortingHandler()}
                    >
                      {flexRender(
                        header.column.columnDef.header,
                        header.getContext(),
                      )}
                      <ArrowUpDown size={12} />
                    </button>
                  ) : (
                    flexRender(
                      header.column.columnDef.header,
                      header.getContext(),
                    )
                  )}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id}>
              {row.getVisibleCells().map((cell) => (
                <td key={cell.id}>
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {!data.length && (
        <div className="table-empty">
          <SearchX size={24} />
          <strong>{loading ? "正在读取…" : empty}</strong>
          <span>
            {loading ? "正在加载服务数据" : "添加记录或调整筛选条件后重试"}
          </span>
        </div>
      )}
    </div>
  );
}
