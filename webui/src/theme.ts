import { theme, type ThemeConfig } from 'antd'

export type ThemeMode = 'light' | 'dark'

const shared: ThemeConfig['token'] = {
  borderRadius: 10,
  borderRadiusLG: 16,
  borderRadiusSM: 8,
  controlHeight: 34,
  controlHeightSM: 28,
  fontSize: 14,
  fontFamily:
    "'Inter', -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', 'PingFang SC', sans-serif",
  fontFamilyCode: "ui-monospace, 'SF Mono', 'JetBrains Mono', Menlo, monospace",
  wireframe: false,
}

export function buildTheme(mode: ThemeMode): ThemeConfig {
  const dark = mode === 'dark'
  return {
    algorithm: dark ? theme.darkAlgorithm : theme.defaultAlgorithm,
    token: {
      ...shared,
      colorPrimary: dark ? '#7b87e8' : '#5e6ad2',
      colorInfo: dark ? '#409cff' : '#0a84ff',
      colorSuccess: dark ? '#30d158' : '#34c759',
      colorWarning: dark ? '#ffb340' : '#ff9f0a',
      colorError: dark ? '#ff6961' : '#ff3b30',
      colorBgBase: dark ? '#0b0b0c' : '#f5f5f7',
      colorBgContainer: dark ? '#1c1c1e' : '#ffffff',
      colorBgElevated: dark ? '#232325' : '#ffffff',
      colorBgLayout: 'transparent',
      colorBorder: dark ? '#38383a' : '#d2d2d7',
      colorBorderSecondary: dark ? '#2c2c2e' : '#e5e5ea',
      colorText: dark ? '#f5f5f7' : '#1d1d1f',
      colorTextSecondary: dark ? '#a1a1a6' : '#6e6e73',
      colorTextTertiary: dark ? '#636366' : '#a1a1a6',
      motionDurationFast: '0.1s',
      motionDurationMid: '0.2s',
      motionDurationSlow: '0.3s',
    },
    components: {
      Layout: {
        headerBg: 'transparent',
        siderBg: 'transparent',
        bodyBg: 'transparent',
        headerHeight: 56,
      },
      Menu: {
        itemBg: 'transparent',
        subMenuItemBg: 'transparent',
        itemSelectedBg: dark
          ? 'rgba(123, 135, 232, 0.16)'
          : 'rgba(94, 106, 210, 0.1)',
        itemSelectedColor: dark ? '#8d98ec' : '#5e6ad2',
        itemHoverBg: dark ? 'rgba(255,255,255,.04)' : 'rgba(0,0,0,.03)',
        itemBorderRadius: 10,
        itemMarginInline: 10,
        itemHeight: 36,
        iconMarginInlineEnd: 12,
      },
      Table: {
        headerBg: 'transparent',
        headerSplitColor: 'transparent',
        rowHoverBg: dark
          ? 'rgba(123, 135, 232, 0.06)'
          : 'rgba(94, 106, 210, 0.04)',
        cellPaddingBlock: 12,
        fontSize: 13.5,
      },
      Card: {
        borderRadiusLG: 16,
        paddingLG: 20,
      },
      Modal: {
        borderRadiusLG: 20,
        titleFontSize: 17,
      },
      Drawer: {},
      Button: {
        fontWeight: 500,
        primaryShadow: 'none',
        defaultShadow: 'none',
        dangerShadow: 'none',
      },
      Input: {
        controlHeight: 34,
        borderRadius: 10,
      },
      Select: {
        controlHeight: 34,
        borderRadius: 10,
      },
      Segmented: {
        borderRadius: 8,
        itemSelectedBg: dark ? '#2c2c2e' : '#ffffff',
      },
      Tabs: {
        titleFontSize: 14,
      },
      Tag: {
        borderRadiusSM: 6,
      },
      Badge: {},
      Steps: {},
      Statistic: {
        titleFontSize: 13,
        contentFontSize: 26,
      },
      Empty: {},
      Alert: {
        borderRadiusLG: 12,
      },
    },
  }
}
