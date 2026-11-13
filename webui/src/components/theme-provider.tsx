import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { Moon, Sun } from "lucide-react";
import { SERVICE_PALETTE } from "../lib/theme-config";

export type ThemeMode = "light" | "dark" | "auto";
const ThemeContext = createContext<{
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
}>({ mode: "auto", setMode: () => {} });

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<ThemeMode>(() => {
    try {
      const value = localStorage.getItem("linkage-theme");
      return value === "dark" || value === "light" ? value : "auto";
    } catch {
      return "auto";
    }
  });
  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      document.documentElement.dataset.palette = SERVICE_PALETTE;
      document.documentElement.dataset.theme =
        mode === "auto" ? (query.matches ? "dark" : "light") : mode;
    };
    apply();
    query.addEventListener("change", apply);
    try {
      localStorage.setItem("linkage-theme", mode);
    } catch {
      /* 偏好存储不可用时仍可使用当前页面。 */
    }
    return () => query.removeEventListener("change", apply);
  }, [mode]);
  return (
    <ThemeContext.Provider value={{ mode, setMode }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function ThemeControl() {
  const { mode, setMode } = useContext(ThemeContext);
  return (
    <div className="theme-control" role="group" aria-label="界面主题">
      {(["light", "dark", "auto"] as const).map((value, i) => (
        <button key={value} type="button" aria-pressed={mode === value} onClick={() => setMode(value)}>
          {["浅色", "深色", "自动"][i]}
        </button>
      ))}
    </div>
  );
}

export function ThemeToggle() {
  const { mode, setMode } = useContext(ThemeContext);
  const [systemDark, setSystemDark] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches);
  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setSystemDark(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  const dark = mode === "auto" ? systemDark : mode === "dark";
  return (
    <button type="button" className="theme-toggle" onClick={() => setMode(dark ? "light" : "dark")} aria-label={dark ? "切换为浅色主题" : "切换为深色主题"}>
      {dark ? <Sun size={14} aria-hidden="true" /> : <Moon size={14} aria-hidden="true" />}
      {dark ? "浅色" : "深色"}
    </button>
  );
}
