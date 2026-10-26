import { useEffect, useState } from 'react'
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Input,
  Space,
  Switch,
  Table,
} from 'antd'
import {
  DeleteOutlined,
  PlusOutlined,
  ReloadOutlined,
  SaveOutlined,
  TeamOutlined,
} from '@ant-design/icons'
import { api } from '../api'

interface UserRow {
  key: string // 稳定行 key：避免增删行时输入框状态串位
  username: string
  admin: boolean
  token: string // 配置原文（明文或 ${ENV} 引用），可查看可直接编辑
}

let rowSeq = 0
const nextKey = () => `row-${++rowSeq}`

/* 成员与 Token 管理：增删用户、查看/重置 token、切换 admin。保存后立即热生效。 */
export default function UserManager() {
  const { message } = AntApp.useApp()
  const [rows, setRows] = useState<UserRow[] | null>(null)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const load = () => {
    api('/api/users')
      .then((d) =>
        setRows(
          (d.users as Array<{ username: string; admin: boolean; token: string }>).map((u) => ({
            key: nextKey(),
            username: u.username,
            admin: u.admin,
            token: u.token,
          })),
        ),
      )
      .then(() => {
        setDirty(false)
        setErr(null)
      })
      .catch((e) => message.error((e as Error).message))
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [])

  const patch = (key: string, part: Partial<UserRow>) => {
    setRows((rs) => (rs ?? []).map((r) => (r.key === key ? { ...r, ...part } : r)))
    setDirty(true)
  }

  const remove = (key: string) => {
    setRows((rs) => (rs ?? []).filter((r) => r.key !== key))
    setDirty(true)
  }

  const addRow = () => {
    setRows((rs) => [...(rs ?? []), { key: nextKey(), username: '', admin: false, token: '' }])
    setDirty(true)
  }

  const save = async () => {
    setSaving(true)
    setErr(null)
    try {
      await api('/api/users', {
        method: 'PUT',
        body: JSON.stringify({
          users: (rows ?? []).map((r) => ({
            username: r.username.trim(),
            token: r.token,
            admin: r.admin,
          })),
        }),
      })
      message.success('成员已保存并热生效；token 变更的用户需用新 token 重新登录')
      load()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const columns = [
    {
      title: '用户名',
      dataIndex: 'username',
      width: 180,
      render: (_: unknown, r: UserRow) => (
        <Input
          value={r.username}
          onChange={(e) => patch(r.key, { username: e.target.value })}
          placeholder="用户名"
          variant="filled"
        />
      ),
    },
    {
      title: 'Token',
      key: 'token',
      render: (_: unknown, r: UserRow) => (
        <Input.Password
          value={r.token}
          onChange={(e) => patch(r.key, { token: e.target.value })}
          placeholder="必填，或 ${ENV_VAR} 引用"
          autoComplete="new-password"
          variant="filled"
        />
      ),
    },
    {
      title: '管理员',
      dataIndex: 'admin',
      width: 100,
      render: (_: unknown, r: UserRow) => (
        <Switch checked={r.admin} onChange={(v) => patch(r.key, { admin: v })} />
      ),
    },
    {
      title: '',
      key: 'del',
      width: 48,
      render: (_v: unknown, r: UserRow) => (
        <Button type="text" danger icon={<DeleteOutlined />} onClick={() => remove(r.key)} />
      ),
    },
  ]

  return (
    <Card
      title={
        <Space>
          <TeamOutlined style={{ color: 'var(--color-primary)' }} />
          成员与 Token
        </Space>
      }
      extra={
        <Space>
          <Button icon={<ReloadOutlined />} onClick={load} disabled={dirty}>
            重新加载
          </Button>
          <Button type="primary" icon={<SaveOutlined />} onClick={save} loading={saving} disabled={!dirty}>
            保存并生效
          </Button>
        </Space>
      }
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 'var(--space-3)' }}
        message="Token 直接编辑保存即热生效（不能为空），变更后该用户需用新 token 重新登录。支持 ${ENV_VAR} 环境变量引用（引用本身不会被展开）。"
      />
      {rows === null ? null : (
        <>
          <Table
            rowKey="key"
            size="small"
            columns={columns}
            dataSource={rows}
            pagination={false}
          />
          <Button
            type="dashed"
            block
            icon={<PlusOutlined />}
            style={{ marginTop: 'var(--space-3)' }}
            onClick={addRow}
          >
            新增成员
          </Button>
        </>
      )}
      {err && (
        <Alert type="error" showIcon style={{ marginTop: 'var(--space-3)' }} message={err} />
      )}
    </Card>
  )
}