import { useState } from 'react'
import { Alert, Button, Card, Form, Input, Typography } from 'antd'
import { CloudServerOutlined } from '@ant-design/icons'
import { api, setToken, clearToken } from '../api'
import type { Me } from '../types'

export default function Login({ onLogin }: { onLogin: (me: Me) => void }) {
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')

  const onFinish = async ({ token }: { token: string }) => {
    setLoading(true)
    setErr('')
    setToken(token)
    try {
      onLogin(await api('/api/me'))
    } catch (e) {
      clearToken()
      setErr((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-shell">
      <Card className="login-card">
        <div className="login-brand">
          <span className="brand-logo" style={{ width: 54, height: 54, borderRadius: 16, fontSize: 26 }}>
            <CloudServerOutlined />
          </span>
        </div>
        <Typography.Title level={3} style={{ textAlign: 'center', marginTop: 0, marginBottom: 4 }}>
          MCP Hub
        </Typography.Title>
        <Typography.Paragraph
          type="secondary"
          style={{ textAlign: 'center', fontSize: 'var(--text-small)' }}
        >
          团队共享的 MCP 统一管理平台 · 使用个人 token 登录
        </Typography.Paragraph>
        <Form layout="vertical" onFinish={onFinish} requiredMark={false}>
          <Form.Item label="访问令牌" name="token" rules={[{ required: true, message: '请粘贴 token' }]}>
            <Input.Password placeholder="粘贴你的 token" autoFocus autoComplete="off" />
          </Form.Item>
          {err && (
            <Alert
              type="error"
              showIcon
              message={err}
              style={{ marginBottom: 16 }}
              role="alert"
            />
          )}
          <Button type="primary" htmlType="submit" block loading={loading}>
            登 录
          </Button>
        </Form>
      </Card>
    </div>
  )
}
