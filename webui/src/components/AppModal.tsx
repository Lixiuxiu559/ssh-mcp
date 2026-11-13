import { Box, Modal, Stack, Text } from "@mantine/core";
import type { MantineSize } from "@mantine/core";
import type { ReactNode } from "react";

/**
 * 统一弹窗骨架：标题固定，内容区上下滚动，底部操作栏固定在弹窗底部。
 * 表单弹窗请把提交按钮放进 footer，并用 Button 的 form 属性关联表单 id。
 */
export function AppModal({
  opened,
  onClose,
  title,
  description,
  size,
  children,
  footer,
}: {
  opened: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  size?: MantineSize | number;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={title}
      size={size}
      styles={{
        content: {
          display: "flex",
          flexDirection: "column",
          maxHeight: "calc(100dvh - 6rem)",
        },
        body: {
          display: "flex",
          flexDirection: "column",
          flex: 1,
          minHeight: 0,
          overflow: "hidden",
          padding: 0,
        },
      }}
    >
      <Box
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          padding: "var(--mantine-spacing-md) var(--mantine-spacing-md) 0",
        }}
      >
        <Stack gap="md" pb="md">
          {description && (
            <Text size="sm" c="dimmed">
              {description}
            </Text>
          )}
          {children}
        </Stack>
      </Box>
      {footer && (
        <Box
          px="md"
          py="md"
          style={{
            borderTop: "1px solid var(--mantine-color-default-border)",
            flexShrink: 0,
          }}
        >
          {footer}
        </Box>
      )}
    </Modal>
  );
}
