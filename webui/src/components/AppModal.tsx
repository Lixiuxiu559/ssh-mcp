import { Flex, Modal, Typography } from "antd";
import type { ReactNode } from "react";

const widths = { xs: 360, sm: 440, md: 540, lg: 720, xl: 900 };

export function AppModal({
  opened,
  onClose,
  title,
  description,
  size = "md",
  children,
  footer,
  busy = false,
}: {
  opened: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  size?: keyof typeof widths | number;
  children: ReactNode;
  footer?: ReactNode;
  busy?: boolean;
}) {
  return (
    <Modal
      open={opened}
      onCancel={onClose}
      title={title}
      width={typeof size === "number" ? size : widths[size]}
      footer={footer ?? null}
      centered
      destroyOnHidden
      closable={!busy}
      keyboard={!busy}
      mask={{ closable: !busy }}
      focusable={{ trap: true, focusTriggerAfterClose: true }}
      styles={{
        body: {
          maxHeight: "calc(100dvh - 220px)",
          overflowY: "auto",
          paddingBlock: 16,
        },
      }}
    >
      <Flex vertical gap={16}>
        {description && (
          <Typography.Text type="secondary">{description}</Typography.Text>
        )}
        {children}
      </Flex>
    </Modal>
  );
}
