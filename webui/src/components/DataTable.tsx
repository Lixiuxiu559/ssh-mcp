import { useMemo, useState, type Key, type ReactNode } from "react";
import { Box, Button, EmptyState, Skeleton, Table } from "@mantine/core";
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  SearchX,
} from "lucide-react";

export interface TableColumn<T> {
  id: string;
  header: ReactNode;
  render?: (row: T) => ReactNode;
  /** 排序取值；数字按数值比较，其余按 zh-CN 字典序。 */
  value?: (row: T) => string | number | null | undefined;
  sortable?: boolean;
  align?: "left" | "center" | "right";
  width?: number | string;
}

type SortState = { key: string; dir: "asc" | "desc" } | null;

function cellText<T>(column: TableColumn<T>, row: T): ReactNode {
  if (column.render) return column.render(row);
  const value = column.value
    ? column.value(row)
    : (row as Record<string, unknown>)[column.id];
  return value == null || value === "" ? "—" : String(value);
}

export function DataTable<T>({
  columns,
  data,
  rowKey,
  loading = false,
  error,
  onRetry,
  empty = "暂无记录",
  emptyAction,
  sortable = true,
  stickyHeader = false,
}: {
  columns: TableColumn<T>[];
  data: T[];
  rowKey?: (row: T, index: number) => Key;
  loading?: boolean;
  error?: string;
  onRetry?: () => void;
  empty?: string;
  emptyAction?: ReactNode;
  sortable?: boolean;
  stickyHeader?: boolean;
}) {
  const [sort, setSort] = useState<SortState>(null);
  const rows = useMemo(() => {
    if (!sort) return data;
    const column = columns.find((item) => item.id === sort.key);
    if (!column?.value) return data;
    const factor = sort.dir === "asc" ? 1 : -1;
    return [...data].sort((a, b) => {
      const x = column.value!(a);
      const y = column.value!(b);
      if (typeof x === "number" && typeof y === "number") return (x - y) * factor;
      return String(x ?? "").localeCompare(String(y ?? ""), "zh-CN") * factor;
    });
  }, [data, sort, columns]);

  const retry = onRetry ? (
    <Button variant="default" size="xs" onClick={onRetry} disabled={loading}>
      重试
    </Button>
  ) : null;

  function toggleSort(column: TableColumn<T>) {
    setSort((old) =>
      old?.key === column.id
        ? { key: column.id, dir: old.dir === "asc" ? "desc" : "asc" }
        : { key: column.id, dir: "asc" },
    );
  }

  return (
    <Box>
      <Table.ScrollContainer minWidth={200} aria-busy={loading}>
        <Table
          highlightOnHover
          verticalSpacing="sm"
          horizontalSpacing="md"
          stickyHeader={stickyHeader}
        >
          <Table.Thead>
            <Table.Tr>
              {columns.map((column) => {
                const canSort =
                  sortable && column.sortable !== false && !!column.value;
                const sorted = sort?.key === column.id ? sort.dir : null;
                return (
                  <Table.Th
                    key={column.id}
                    w={column.width}
                    style={column.align ? { textAlign: column.align } : undefined}
                    aria-sort={
                      canSort
                        ? sorted === "asc"
                          ? "ascending"
                          : sorted === "desc"
                            ? "descending"
                            : "none"
                        : undefined
                    }
                  >
                    {canSort ? (
                      <button
                        type="button"
                        className="sort-button"
                        onClick={() => toggleSort(column)}
                      >
                        {column.header}
                        {sorted === "asc" ? (
                          <ArrowUp size={12} aria-hidden="true" />
                        ) : sorted === "desc" ? (
                          <ArrowDown size={12} aria-hidden="true" />
                        ) : (
                          <ArrowUpDown size={12} aria-hidden="true" />
                        )}
                      </button>
                    ) : (
                      column.header
                    )}
                  </Table.Th>
                );
              })}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {loading && !rows.length
              ? Array.from({ length: 4 }, (_, index) => (
                  <Table.Tr key={`skeleton-${index}`}>
                    {columns.map((column) => (
                      <Table.Td key={column.id}>
                        <Skeleton height={12} />
                      </Table.Td>
                    ))}
                  </Table.Tr>
                ))
              : rows.map((row, index) => (
                  <Table.Tr key={rowKey ? rowKey(row, index) : index}>
                    {columns.map((column) => (
                      <Table.Td
                        key={column.id}
                        style={
                          column.align ? { textAlign: column.align } : undefined
                        }
                      >
                        {cellText(column, row)}
                      </Table.Td>
                    ))}
                  </Table.Tr>
                ))}
          </Table.Tbody>
        </Table>
        {!rows.length && !loading && (
          error ? (
            <EmptyState
              icon={<AlertCircle size={26} aria-hidden="true" />}
              title="加载失败"
              description={error}
            >
              <EmptyState.Actions>{retry}</EmptyState.Actions>
            </EmptyState>
          ) : (
            <EmptyState
              icon={<SearchX size={26} aria-hidden="true" />}
              title={empty}
              description="添加记录或调整筛选条件后重试"
            >
              {emptyAction && <EmptyState.Actions>{emptyAction}</EmptyState.Actions>}
            </EmptyState>
          )
        )}
      </Table.ScrollContainer>
    </Box>
  );
}
