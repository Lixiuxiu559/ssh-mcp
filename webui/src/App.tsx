import { useEffect, useState } from 'react'
import { Button, Result, Spin, Tooltip } from 'antd'
import { CloudServerOutlined, MoonOutlined, SunOutlined } from '@ant-design/icons'
import Login from './pages/Login'
import AdminHome from './pages/AdminHome'
import { api, clearToken, getToken } from './api'
import type { Me } from './types'
import type { ThemeMode } from './theme'

/* ssh-mcp 管理端：玻璃页头 + 单页（服务器管理 + 审计日志）。 */
export default function App({
  mode,
  onToggleTheme,
}: {
  mode: ThemeMode
  onToggleTheme: () => void
}) {
  const [me, setMe] = useState<Me | null>(null)
  const [booting, setBooting] = useState(true)

  useEffect(() => {
    if (!getToken()) {
      setBooting(false)
      return
    }
    api('/api/me')
      .then(setMe)
      .catch(() => clearToken())
      .finally(() => setBooting(false))
  }, [])

  if (booting) {
    return (
      <div className="login-shell">
        <Spin size="large" />
      </div>
    )
  }
  if (!me) return <Login onLogin={setMe} />
  if (!me.admin) {
    return (
      <div className="login-shell">
        <Result
          status="403"
          title="403"
          subTitle={`账号 ${me.username} 没有管理权限，请使用管理员 token 登录`}
          extra={<Button onClick={() => { clearToken(); location.reload() }}>重新登录</Button>}
        />
      </div>
    )
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <span className="brand-logo" aria-hidden>
            <CloudServerOutlined />
          </span>
          <span style={{ fontWeight: 650, fontSize: 'var(--text-h3)', letterSpacing: '-0.01em' }}>
            ssh-mcp
          </span>
          <span style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)' }}>
            管理端
          </span>
        </div>
        <Tooltip title={mode === 'dark' ? '切换到 Light' : '切换到 Dark'}>
          <button className="icon-btn" onClick={onToggleTheme} aria-label="切换主题">
            {mode === 'dark' ? <SunOutlined /> : <MoonOutlined />}
          </button>
        </Tooltip>
      </header>
      <AdminHome me={me} />
    </div>
  )
}
