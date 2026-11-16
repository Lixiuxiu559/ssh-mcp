import { useState } from "react";

export interface ConsoleNavigationOptions<Key extends string> {
  navigation: readonly { id: Key }[];
  defaultPage: Key;
  pageKey: string;
  collapsedKey: string;
}

/** 导航与折叠偏好保存在宿主服务自己的键中。 */
export function useConsoleNavigation<Key extends string>({
  navigation,
  defaultPage,
  pageKey,
  collapsedKey,
}: ConsoleNavigationOptions<Key>) {
  const [page, setPage] = useState<Key>(() => {
    try {
      const value = localStorage.getItem(pageKey);
      return navigation.find((item) => item.id === value)?.id ?? defaultPage;
    } catch {
      return defaultPage;
    }
  });
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(collapsedKey) === "true";
    } catch {
      return false;
    }
  });

  function navigate(value: Key) {
    if (!navigation.some((item) => item.id === value)) return;
    setPage(value);
    try {
      localStorage.setItem(pageKey, value);
    } catch {
      /* 偏好存储可选。 */
    }
  }
  function changeCollapsed(value: boolean) {
    setCollapsed(value);
    try {
      localStorage.setItem(collapsedKey, String(value));
    } catch {
      /* 偏好存储可选。 */
    }
  }
  return { page, navigate, collapsed, changeCollapsed };
}
