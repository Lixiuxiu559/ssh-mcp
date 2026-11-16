import { useState, type ReactNode } from "react";
import { App as AntApp, ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";
import { appTheme } from "../theme";
import { ThemeContext, type ColorScheme } from "./theme-controls";

export interface ConsoleProviderProps {
  themeKey: string;
  cssVarKey?: string;
  children: ReactNode;
}

/** 首帧主题由宿主 HTML 设置；这里只持有同一浅深状态及服务专属偏好。 */
export function ConsoleProvider({
  themeKey,
  cssVarKey = "mcp-console",
  children,
}: ConsoleProviderProps) {
  const [colorScheme, setScheme] = useState<ColorScheme>(
    document.documentElement.dataset.theme === "dark" ? "dark" : "light",
  );
  function setColorScheme(value: ColorScheme) {
    setScheme(value);
    document.documentElement.dataset.theme = value;
    try {
      localStorage.setItem(themeKey, value);
    } catch {
      /* 偏好存储可选。 */
    }
  }
  return (
    <ThemeContext.Provider value={{ colorScheme, setColorScheme }}>
      <ConfigProvider
        locale={zhCN}
        theme={appTheme(colorScheme === "dark", cssVarKey)}
      >
        <AntApp>{children}</AntApp>
      </ConfigProvider>
    </ThemeContext.Provider>
  );
}
