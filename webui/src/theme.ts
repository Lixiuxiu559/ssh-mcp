import { createTheme, type MantineColorsTuple } from "@mantine/core";

// 配色使用 Mantine 默认（默认 primaryColor "blue"）。
// 暗色表面保持默认纯黑系；仅把文字色阶提亮：dark[0] 主文字纯白，[1] muted、[2] dimmed 依次减弱。
const dark: MantineColorsTuple = [
  "#ffffff",
  "#e0e0e0",
  "#ababab",
  "#696969",
  "#424242",
  "#3b3b3b",
  "#2e2e2e",
  "#242424",
  "#1f1f1f",
  "#141414",
];

// 主色与其余颜色均为 Mantine 默认；非颜色项（圆角/字体/字号）在此覆盖。
export const theme = createTheme({
  colors: { dark },
  defaultRadius: "md",
  radius: {
    xs: "6px",
    sm: "8px",
    md: "12px",
    lg: "16px",
    xl: "999px",
  },
  fontFamily:
    '-apple-system, "Segoe UI", system-ui, Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji"',
  fontFamilyMonospace:
    '"SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace',
  headings: {
    fontWeight: "600",
    sizes: {
      h1: { fontSize: "20px", lineHeight: "1.3" },
      h2: { fontSize: "16px", lineHeight: "1.35" },
      h3: { fontSize: "15px", lineHeight: "1.35" },
      h4: { fontSize: "13px", lineHeight: "1.4" },
    },
  },
  components: {
    Button: {
      defaultProps: { radius: "xl" },
    },
    ActionIcon: {
      defaultProps: { radius: "xl" },
    },
    Badge: {
      defaultProps: { radius: "xl", fw: 500 },
    },
    Alert: {
      defaultProps: { radius: "md" },
    },
    Modal: {
      defaultProps: { centered: true },
    },
    NavLink: {
      styles: {
        root: { borderRadius: "var(--mantine-radius-md)" },
      },
    },
  },
});
