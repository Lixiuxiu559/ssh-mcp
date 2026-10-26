import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
export type ThemeMode = "light" | "dark" | "auto";
const ThemeContext = createContext<{
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
}>({ mode: "auto", setMode: () => {} });
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<ThemeMode>(() => {
    try {
      const v = localStorage.getItem("linkage-theme");
      return v === "dark" || v === "light" ? v : "auto";
    } catch {
      return "auto";
    }
  });
  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      document.documentElement.dataset.theme =
        mode === "auto" ? (query.matches ? "dark" : "light") : mode;
    };
    apply();
    query.addEventListener("change", apply);
    try {
      localStorage.setItem("linkage-theme", mode);
    } catch {
      /* storage optional */
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
        <button
          key={value}
          type="button"
          aria-pressed={mode === value}
          onClick={() => setMode(value)}
        >
          {["浅色", "深色", "自动"][i]}
        </button>
      ))}
    </div>
  );
}
