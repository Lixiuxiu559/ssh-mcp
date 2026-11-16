import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { App as AntApp, ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";
import "antd/dist/reset.css";
import "./global.css";
import App from "./App";
import { appTheme } from "./theme";
import { ThemeContext, type ColorScheme } from "./components/theme-controls";

function Root() {
  const [colorScheme, setScheme] = useState<ColorScheme>(
    document.documentElement.dataset.theme === "dark" ? "dark" : "light",
  );
  function setColorScheme(value: ColorScheme) {
    setScheme(value);
    document.documentElement.dataset.theme = value;
    try {
      localStorage.setItem("ssh-mcp-theme", value);
    } catch {
      /* 偏好存储可选。 */
    }
  }
  return (
    <ThemeContext.Provider value={{ colorScheme, setColorScheme }}>
      <ConfigProvider locale={zhCN} theme={appTheme(colorScheme === "dark")}>
        <AntApp>
          <App />
        </AntApp>
      </ConfigProvider>
    </ThemeContext.Provider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
