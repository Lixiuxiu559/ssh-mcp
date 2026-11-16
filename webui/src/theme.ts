import { theme } from "antd";
import type { ThemeConfig } from "antd";

export const fontFamily = '"OPPO Sans", -apple-system, "Segoe UI", sans-serif';

export function appTheme(dark: boolean, cssVarKey = "mcp-console"): ThemeConfig {
  return {
    algorithm: dark ? theme.darkAlgorithm : theme.defaultAlgorithm,
    cssVar: { key: cssVarKey },
    token: { fontFamily, borderRadius: 8, fontSize: 14, controlHeight: 34 },
    components: {
      Layout: {
        headerBg: dark ? "#141414" : "#ffffff",
        siderBg: dark ? "#141414" : "#ffffff",
      },
      Typography: {
        fontSizeHeading1: 20,
        fontSizeHeading2: 16,
        fontSizeHeading3: 15,
        fontSizeHeading4: 14,
      },
      Menu: { itemHeight: 40, itemMarginBlock: 4 },
      Table: {
        cellPaddingBlock: 12,
        cellPaddingBlockMD: 10,
        cellPaddingInlineMD: 12,
      },
      Card: { headerHeight: 48 },
    },
  };
}
