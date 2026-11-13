import { Group, Stack, Text, Title } from "@mantine/core";
import type { ReactNode } from "react";

export function PageHeading({
  eyebrow,
  title,
  description,
  extra,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  extra?: ReactNode;
}) {
  return (
    <Group justify="space-between" align="flex-start" mb="lg" wrap="nowrap">
      <Stack gap={4}>
        {eyebrow && (
          <Text size="xs" fw={600} c="dimmed" tt="uppercase" lh={1.3}>
            {eyebrow}
          </Text>
        )}
        <Title order={1}>{title}</Title>
        {description && (
          <Text size="sm" c="dimmed">
            {description}
          </Text>
        )}
      </Stack>
      {extra && (
        <Group gap="sm" wrap="nowrap">
          {extra}
        </Group>
      )}
    </Group>
  );
}
