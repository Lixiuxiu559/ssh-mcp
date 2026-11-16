import { createContext, useContext } from "react";
import { Button, Segmented, Tooltip } from "antd";
import { MoonOutlined, SunOutlined } from "@ant-design/icons";

export type ColorScheme = "light" | "dark";
export const ThemeContext = createContext<{
  colorScheme: ColorScheme;
  setColorScheme: (value: ColorScheme) => void;
}>({
  colorScheme: "light",
  setColorScheme: () => {},
});

export function ThemeControl() {
  const { colorScheme, setColorScheme } = useContext(ThemeContext);
  return (
    <Segmented
      aria-label="界面主题"
      value={colorScheme}
      onChange={setColorScheme}
      options={[
        { value: "light", label: "浅色" },
        { value: "dark", label: "深色" },
      ]}
    />
  );
}
export function ThemeToggle() {
  const { colorScheme, setColorScheme } = useContext(ThemeContext);
  const dark = colorScheme === "dark";
  const label = dark ? "切换为浅色主题" : "切换为深色主题";
  return (
    <Tooltip title={label}>
      <Button
        aria-label={label}
        shape="circle"
        icon={dark ? <SunOutlined /> : <MoonOutlined />}
        onClick={() => setColorScheme(dark ? "light" : "dark")}
      />
    </Tooltip>
  );
}
