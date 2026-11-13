import {
  ActionIcon,
  SegmentedControl,
  useMantineColorScheme,
  type MantineColorScheme,
} from "@mantine/core";
import { Moon, Sun } from "lucide-react";

export function ThemeControl() {
  const { colorScheme, setColorScheme } = useMantineColorScheme();
  return (
    <SegmentedControl
      aria-label="界面主题"
      size="xs"
      value={colorScheme}
      onChange={(value) => setColorScheme(value as MantineColorScheme)}
      data={[
        { value: "light", label: "浅色" },
        { value: "dark", label: "深色" },
      ]}
    />
  );
}

export function ThemeToggle() {
  const { colorScheme, setColorScheme } = useMantineColorScheme();
  const dark = colorScheme === "dark";
  return (
    <ActionIcon
      variant="default"
      size="lg"
      radius="xl"
      aria-label={dark ? "切换为浅色主题" : "切换为深色主题"}
      onClick={() => setColorScheme(dark ? "light" : "dark")}
    >
      {dark ? (
        <Sun size={15} aria-hidden="true" />
      ) : (
        <Moon size={15} aria-hidden="true" />
      )}
    </ActionIcon>
  );
}
