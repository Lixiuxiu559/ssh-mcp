import { useState, type ReactNode } from "react";
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  LoaderCircle,
  SearchX,
} from "lucide-react";
import { Button } from "./button";

export function DataTable<T>({
  data,
  columns,
  loading,
  empty = "暂无记录",
  sortable = true,
  stickyFirst = true,
  error,
  onRetry,
  emptyAction,
}: {
  data: T[];
  columns: ColumnDef<T, unknown>[];
  loading?: boolean;
  empty?: string;
  sortable?: boolean;
  stickyFirst?: boolean;
  error?: string;
  onRetry?: () => void;
  emptyAction?: ReactNode;
}) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const table = useReactTable({
    data,
    columns,
    enableSorting: sortable,
    enableMultiSort: false,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });
  const retry = onRetry ? (
    <Button variant="secondary" onClick={onRetry} disabled={loading}>
      重试
    </Button>
  ) : null;
  return (
    <>
      {error && data.length > 0 && (
        <div className="table-error-inline" role="alert">
          <AlertCircle size={15} aria-hidden="true" />
          <span>{error}</span>
          {retry}
        </div>
      )}
      <div className="table-scroll" aria-busy={loading}>
        <table className={`data-table ${stickyFirst ? "sticky-first" : ""}`}>
          <thead>
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id}>
                {group.headers.map((header) => {
                  const sorted = header.column.getIsSorted();
                  return (
                    <th
                      key={header.id}
                      scope="col"
                      aria-sort={
                        header.column.getCanSort()
                          ? sorted === "asc"
                            ? "ascending"
                            : sorted === "desc"
                              ? "descending"
                              : "none"
                          : undefined
                      }
                    >
                      {header.isPlaceholder ? null : header.column.getCanSort() ? (
                        <button
                          type="button"
                          className="sort-button"
                          onClick={header.column.getToggleSortingHandler()}
                        >
                          {flexRender(
                            header.column.columnDef.header,
                            header.getContext(),
                          )}
                          {sorted === "asc" ? (
                            <ArrowUp size={12} aria-hidden="true" />
                          ) : sorted === "desc" ? (
                            <ArrowDown size={12} aria-hidden="true" />
                          ) : (
                            <ArrowUpDown size={12} aria-hidden="true" />
                          )}
                        </button>
                      ) : (
                        flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )
                      )}
                    </th>
                  );
                })}
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
        {!data.length &&
          (error ? (
            <div className="table-error" role="alert">
              <AlertCircle size={24} aria-hidden="true" />
              <strong>加载失败</strong>
              <span>{error}</span>
              {retry}
            </div>
          ) : (
            <div className="table-empty" role="status" aria-live="polite">
              {loading ? (
                <LoaderCircle className="spin" size={24} aria-hidden="true" />
              ) : (
                <SearchX size={24} aria-hidden="true" />
              )}
              <strong>{loading ? "正在读取…" : empty}</strong>
              <span>
                {loading ? "正在加载数据" : "添加记录或调整筛选条件后重试"}
              </span>
              {!loading && emptyAction}
            </div>
          ))}
      </div>
    </>
  );
}
