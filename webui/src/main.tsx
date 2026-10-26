import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { App as AntApp, ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import { buildTheme, type ThemeMode } from './theme'
import './token.css'
import App from './App'

const THEME_KEY = 'ssh_mcp_theme'

export function useThemeMode() {
  const [mode, setMode] = useState<ThemeMode>(
    () => (localStorage.getItem(THEME_KEY) as ThemeMode) || 'light',
  )
  useEffect(() => {
    document.documentElement.dataset.theme = mode
    localStorage.setItem(THEME_KEY, mode)
  }, [mode])
  return { mode, toggle: () => setMode((m) => (m === 'light' ? 'dark' : 'light')) }
}

function Root() {
  const { mode, toggle } = useThemeMode()
  return (
    <ConfigProvider
      locale={zhCN}
      theme={buildTheme(mode)}
      // 关闭两字按钮的自动空格（"取 消"/"保 存"），保证全局文案间距一致
      button={{ autoInsertSpace: false }}
    >
      <AntApp style={{ minHeight: '100dvh' }}>
        <StrictMode>
          <App mode={mode} onToggleTheme={toggle} />
        </StrictMode>
      </AntApp>
    </ConfigProvider>
  )
}

createRoot(document.getElementById('root')!).render(<Root />)
