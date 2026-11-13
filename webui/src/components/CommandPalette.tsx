import { useEffect, useMemo, useState } from "react";
import {
  Box,
  Group,
  Kbd,
  Stack,
  Text,
  TextInput,
  UnstyledButton,
} from "@mantine/core";
import {
  CornerDownLeft,
  Search,
} from "lucide-react";
import { AppModal } from "./AppModal";
import type { Page } from "../types";

export const navigation: { id: Page; label: string; description: string }[] = [
  { id: "overview", label: "总览", description: "服务器、调用记录与最近事件" },
  { id: "servers", label: "服务器管理", description: "连接配置与目标主机" },
  { id: "tokens", label: "MCP Token", description: "独立服务凭证与客户端接入" },
  { id: "users", label: "成员管理", description: "登录账号与人员状态" },
  {
    id: "mcp-audit",
    label: "MCP 调用审计",
    description: "Token、目标与工具操作",
  },
  {
    id: "person-audit",
    label: "人员操作审计",
    description: "账号、凭证与配置变更",
  },
];

export function CommandPalette({
  open,
  onOpenChange,
  onNavigate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNavigate: (page: Page) => void;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const results = useMemo(
    () =>
      navigation.filter((item) =>
        `${item.label}${item.description}${item.id}`
          .toLowerCase()
          .includes(query.toLowerCase()),
      ),
    [query],
  );
  useEffect(() => {
    if (open) {
      setQuery("");
      setSelected(0);
    }
  }, [open]);
  function navigate(page: Page) {
    onNavigate(page);
    onOpenChange(false);
  }
  return (
    <AppModal
      opened={open}
      onClose={() => onOpenChange(false)}
      title="快速前往"
      description="搜索工作区页面，使用方向键选择。"
      size="sm"
    >
      <Stack gap="sm">
        <TextInput
          data-autofocus
          leftSection={<Search size={16} aria-hidden="true" />}
          aria-label="搜索页面"
          value={query}
          onChange={(event) => {
            setQuery(event.currentTarget.value);
            setSelected(0);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setSelected((value) => Math.min(value + 1, results.length - 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setSelected((value) => Math.max(value - 1, 0));
            } else if (event.key === "Enter" && results[selected]) {
              event.preventDefault();
              navigate(results[selected].id);
            }
          }}
          role="combobox"
          aria-expanded="true"
          aria-controls="command-results"
          aria-activedescendant={
            results[selected] ? `command-${results[selected].id}` : undefined
          }
          autoComplete="off"
        />
        <Stack
          gap={4}
          role="listbox"
          aria-label="页面搜索结果"
        >
          {results.length ? (
            results.map((item, index) => (
              <UnstyledButton
                id={`command-${item.id}`}
                key={item.id}
                role="option"
                aria-selected={index === selected}
                onMouseEnter={() => setSelected(index)}
                onClick={() => navigate(item.id)}
                px="sm"
                py={8}
                style={{ borderRadius: "var(--mantine-radius-md)" }}
                bg={index === selected ? "var(--mantine-color-default-hover)" : undefined}
              >
                <Group justify="space-between" wrap="nowrap">
                  <Box>
                    <Text size="sm" fw={600}>
                      {item.label}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {item.description}
                    </Text>
                  </Box>
                  <CornerDownLeft size={14} aria-hidden="true" opacity={0.5} />
                </Group>
              </UnstyledButton>
            ))
          ) : (
            <Text size="sm" c="dimmed" ta="center" py="md">
              没有匹配页面，尝试其他关键词。
            </Text>
          )}
        </Stack>
        <Group gap={6} c="dimmed">
          <Kbd>↑</Kbd>
          <Kbd>↓</Kbd>
          <Text size="xs">选择</Text>
          <Kbd>↵</Kbd>
          <Text size="xs">打开</Text>
          <Kbd>Esc</Kbd>
          <Text size="xs">关闭</Text>
        </Group>
      </Stack>
    </AppModal>
  );
}
