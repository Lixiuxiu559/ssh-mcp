import { useEffect, useState } from 'react'
import {
  App as AntApp,
  Alert,
  Button,
  Card,
  Empty,
  Popconfirm,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd'
import {
  CloudServerOutlined,
  DeleteOutlined,
  EditOutlined,
  KeyOutlined,
  LogoutOutlined,
  PlusOutlined,
  UserOutlined,
} from '@ant-design/icons'
import { api, clearToken } from '../api'
import type { Me, ServerEntry } from '../types'
import { CRED_LABEL } from '../types'
import PageHeader from '../components/PageHeader'
import ServerFormModal from '../components/ServerFormModal'
import UserManager from '../components/UserManager'
import AuditPanel from '../components/AuditPanel'

const MUTED = { color: 'var(--color-text-secondary)' }

/* ssh-mcp 管理端：服务器配置管理 + 审计日志，单页应用。 */
export default function AdminHome({ me }: { me: Me }) {
  const { message } = AntApp.useApp()
  const [servers, setServers] = useState<ServerEntry[] | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<ServerEntry | null>(null)

  const loadServers = () => {
    api('/api/servers')
      .then((d) => setServers(d.servers))
      .catch((e) => {
        message.error((e as Error).message)
        setServers([])
      })
  }


  useEffect(() => {
    loadServers()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const delServer = async (alias: string) => {
    try {
      await api('/api/servers/' + encodeURIComponent(alias), { method: 'DELETE' })
      message.success('已删除')
      loadServers()
    } catch (e) {
      message.error((e as Error).message)
    }
  }

  const serverCols = [
    {
      title: '别名',
      dataIndex: 'alias',
      render: (v: string) => (
        <Tag bordered={false} color="primary" className="mono" style={{ fontSize: 12.5 }}>
          {v}
        </Tag>
      ),
    },
    {
      title: '主机',
      dataIndex: 'host',
      render: (v: string, r: ServerEntry) => (
        <span className="mono" style={{ color: 'var(--color-text-primary)' }}>
          {v}
          <span style={{ color: 'var(--color-text-tertiary)' }}>:{r.port}</span>
        </span>
      ),
    },
    { title: '账户', dataIndex: 'username' },
    {
      title: '凭据类型',
      dataIndex: 'credential_type',
      render: (t: string) => (
        <span style={MUTED}>
          <KeyOutlined style={{ marginRight: 6 }} />
          {CRED_LABEL[t] || t}
        </span>
      ),
    },
    {
      title: '标签',
      dataIndex: 'tags',
      render: (tags: string[]) =>
        (tags || []).map((t) => (
          <Tag key={t} bordered={false}>
            {t}
          </Tag>
        )),
    },
    {
      title: '描述',
      dataIndex: 'description',
      render: (v: string) => <span style={MUTED}>{v || '—'}</span>,
    },
    {
      title: '操作',
      key: 'actions',
      width: 170,
      render: (_: unknown, r: ServerEntry) =>
        me.admin ? (
          <Space>
            <Button
              size="small"
              icon={<EditOutlined />}
              onClick={() => {
                setEditing(r)
                setModalOpen(true)
              }}
            >
              编辑
            </Button>
            <Popconfirm
              title={`确定删除服务器 ${r.alias} 吗？`}
              okText="删除"
              okButtonProps={{ danger: true }}
              onConfirm={() => delServer(r.alias)}
            >
              <Button size="small" danger icon={<DeleteOutlined />}>
                删除
              </Button>
            </Popconfirm>
          </Space>
        ) : (
          <Typography.Text type="secondary">仅管理员</Typography.Text>
        ),
    },
  ]


  return (
    <div className="page">
      <PageHeader
        title="ssh-mcp 服务器管理"
        subtitle="网页上改完配置，所有成员的 agent 立即可用"
        extra={
          <Space>
            <Tag icon={<UserOutlined />} bordered={false} style={{ padding: '3px 10px' }}>
              {me.username}
            </Tag>
            {me.admin && (
              <Tag color="primary" bordered={false} style={{ padding: '3px 10px' }}>
                ADMIN
              </Tag>
            )}
            <Button icon={<LogoutOutlined />} onClick={() => { clearToken(); location.reload() }}>
              退出
            </Button>
          </Space>
        }
      />

      {me.default_admin && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 'var(--space-5)' }}
          message="当前使用内置默认管理员账号 admin / admin（未配置任何成员时的引导账号）"
          description="请在下方「成员与 Token」中设置正式成员与 token；保存后该默认账号将自动失效。"
        />
      )}

      <section className="section">
        <Card
          title={
            <Space>
              <CloudServerOutlined style={{ color: 'var(--color-primary)' }} />
              服务器
            </Space>
          }
          extra={
            me.admin && (
              <Button type="primary" icon={<PlusOutlined />} onClick={() => setModalOpen(true)}>
                新增服务器
              </Button>
            )
          }
        >
          <Table
            rowKey="alias"
            columns={serverCols}
            dataSource={servers || []}
            loading={servers === null}
            pagination={false}
            scroll={{ x: 880 }}
            locale={{
              emptyText: (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={
                    me.admin ? '点击右上角新增第一台服务器' : '请联系管理员在网页端添加服务器'
                  }
                />
              ),
            }}
          />
        </Card>
      </section>

      <section className="section">
        <AuditPanel />
      </section>

      <ServerFormModal
        open={modalOpen}
        editing={editing}
        onClose={() => {
          setModalOpen(false)
          setEditing(null)
        }}
        onSaved={() => {
          setModalOpen(false)
          setEditing(null)
          loadServers()
        }}
      />

      <section className="section">
        <UserManager />
      </section>
    </div>
  )
}