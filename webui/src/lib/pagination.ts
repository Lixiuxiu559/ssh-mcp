import { useCallback, useState } from "react";
import type { TablePaginationConfig } from "antd";

export const DEFAULT_PAGE_SIZE = 10;
export const PAGE_SIZE_OPTIONS = [10, 20, 50];

export const listPagination: TablePaginationConfig = {
  defaultPageSize: DEFAULT_PAGE_SIZE,
  pageSizeOptions: PAGE_SIZE_OPTIONS,
  showSizeChanger: true,
  showTotal: (total) => `共 ${total} 条记录`,
  size: "small",
};

export function useListPagination() {
  const [page, setPage] = useState({
    current: 1,
    pageSize: DEFAULT_PAGE_SIZE,
  });
  const onChange = useCallback((current: number, pageSize: number) => {
    setPage((previous) => ({
      current: pageSize === previous.pageSize ? current : 1,
      pageSize,
    }));
  }, []);
  const resetPage = useCallback(() => {
    setPage((previous) => ({ ...previous, current: 1 }));
  }, []);
  return { pagination: { ...page, onChange }, resetPage };
}
