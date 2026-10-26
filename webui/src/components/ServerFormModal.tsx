import { useEffect, useState } from 'react'
import {
  App as AntApp,
  Alert,
  Button,
  Divider,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Tooltip,
  Upload,
} from 'antd'
import {
  CheckOutlined,
  CloudServerOutlined,
  InfoCircleOutlined,
  KeyOutlined,
  ThunderboltOutlined,
  UploadOutlined,
} from '@ant-design/icons'
import { api } from '../api'
import { CRED_FIELDS, type ServerEntry } from '../types'

const CRED_OPTIONS = [
  { value: 'private_key_file', label: '私钥文件路径（推荐）' },
  { value: 'private_key_inline', label: '内嵌私钥内容' },
  { value: 'password', label: '密码' },
]

/* 表单分组标题：给长表单建立视觉层次 */
function SectionTitle({ icon, title, desc }: { icon: React.ReactNode; title: string; desc?: string }) {
  return (
    <div style={{ marginBottom: 'var(--space-4)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, fontSize: 'var(--text-body)' }}>
        <span style={{ color: 'var(--color-primary)', display: 'inline-flex' }}>{icon}</span>
        {title}
      </div>
      {desc && (
        <div style={{ color: 'var(--color-text-tertiary)', fontSize: 'var(--text-small)', marginTop: 2 }}>
          {desc}
        </div>
      )}
    </div>
  )
}

/* 新增/编辑服务器弹窗。编辑时凭据字段留空 = 保持原凭据不变。 */
export default function ServerFormModal({
  open,
  editing,
  onClose,
  onSaved,
}: {
  open: boolean
  editing: ServerEntry | null
  onClose: () => void
  onSaved: () => void
}) {
  const { message } = AntApp.useApp()
  const [form] = Form.useForm()
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [uploadingKey, setUploadingKey] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null)

  /* 上传本地 .pem：内容发到后端落盘，路径自动回填到表单 */
  const handleUploadKey = async (file: File) => {
    const alias = String(form.getFieldValue('alias') || '').trim()
    if (!alias) {
      message.warning('请先填写别名 alias（用作网关机上的密钥文件名）')
      form.getFieldInstance('alias')?.focus?.()
      return false
    }
    setUploadingKey(true)
    try {
      const content = await file.text()
      const r = await api('/api/keys', {
        method: 'POST',
        body: JSON.stringify({ alias, content }),
      })
      form.setFieldValue(['credential', 'path'], r.path)
      form.setFields([{ name: ['credential', 'path'], errors: [] }])
      message.success('已上传到网关机：' + r.path + '，可点「测试连接」验证')
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setUploadingKey(false)
    }
    return false // 阻止 antd 默认上传行为
  }

  useEffect(() => {
    if (!open) return
    setTestResult(null)
    form.resetFields()
    form.setFieldsValue(
      editing
        ? {
            alias: editing.alias,
            host: editing.host,
            port: editing.port,
            username: editing.username,
            description: editing.description,
            tags: editing.tags || [],
            credential: { type: editing.credential_type },
          }
        : { port: 22, tags: [], credential: { type: 'private_key_file' } },
    )
    // 每次打开都回到表单顶部（弹窗内容区滚动位置不会随开关自动重置）
    requestAnimationFrame(() => {
      const body = document.querySelector<HTMLElement>('.ant-modal .ant-modal-body')
      if (body) body.scrollTop = 0
    })
  }, [open, editing, form])

  const buildEntry = (vals: any) => {
    const type = vals.credential?.type || 'private_key_file'
    const cred: Record<string, string> = {}
    for (const k of CRED_FIELDS[type] || []) {
      const v = vals.credential?.[k]
      if (v !== undefined && v !== null && String(v).trim() !== '') cred[k] = String(v)
    }
    const keepOriginal =
      !!editing && Object.keys(cred).length === 0 && type === editing.credential_type
    const entry: any = {
      alias: vals.alias?.trim(),
      host: vals.host?.trim(),
      port: vals.port || 22,
      username: vals.username?.trim(),
      description: vals.description?.trim() || '',
      tags: vals.tags || [],
    }
    if (vals.known_hosts?.trim()) entry.known_hosts = vals.known_hosts.trim()
    if (!keepOriginal) entry.credential = { type, ...cred }
    return entry
  }

  /* 校验失败时滚动并聚焦到第一个无效字段（按表单字段顺序，非报错先后） */
  const validateOrFocusFirst = async (fields?: string[]) => {
    try {
      await form.validateFields(fields)
      return true
    } catch (err) {
      const errorFields = (err as { errorFields?: { name: (string | number)[] }[] })?.errorFields
      const firstName = errorFields?.[0]?.name
      if (firstName) {
        form.scrollToField(firstName, { behavior: 'smooth', block: 'center' })
        // 聚焦对应输入框，方便键盘用户直接开始修正
        setTimeout(() => {
          const el = document.querySelector<HTMLElement>(
            '.ant-modal .ant-form-item-has-error input, .ant-modal .ant-form-item-has-error textarea',
          )
          el?.focus()
        }, 120)
      }
      return false
    }
  }

  const handleTest = async () => {
    if (!(await validateOrFocusFirst(['alias', 'host', 'port', 'username', 'credential']))) return
    const entry = buildEntry(form.getFieldsValue(true))
    setTesting(true)
    setTestResult(null)
    try {
      const r = await api('/api/servers/test', { method: 'POST', body: JSON.stringify(entry) })
      setTestResult(
        r.ok ? { ok: true, text: r.message || '连接成功' } : { ok: false, text: r.error || '连接失败' },
      )
    } catch (e) {
      setTestResult({ ok: false, text: (e as Error).message })
    } finally {
      setTesting(false)
    }
  }

  const handleSave = async () => {
    if (!(await validateOrFocusFirst())) return
    const vals = form.getFieldsValue(true)
    const entry = buildEntry(vals)
    setSaving(true)
    try {
      if (editing) {
        await api('/api/servers/' + encodeURIComponent(editing.alias), {
          method: 'PUT',
          body: JSON.stringify(entry),
        })
      } else {
        await api('/api/servers', { method: 'POST', body: JSON.stringify(entry) })
      }
      message.success('已保存，所有成员立即可用')
      onSaved()
    } catch (e) {
      setTestResult({ ok: false, text: (e as Error).message })
    } finally {
      setSaving(false)
    }
  }

  /* 弹窗底部固定操作区：测试结果紧邻按钮，点完立刻可见 */
  const footer = (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-4)' }}>
      <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }} role="status" aria-live="polite">
        {testResult && (
          <Alert
            type={testResult.ok ? 'success' : 'error'}
            showIcon
            message={testResult.text}
            style={{ padding: '4px 12px', fontSize: 'var(--text-small)' }}
          />
        )}
      </div>
      <div style={{ display: 'flex', gap: 'var(--space-2)', flex: 'none' }}>
        <Tooltip title="用当前填写的配置新建一次性 SSH 连接验证，不会保存">
          <Button icon={<ThunderboltOutlined />} loading={testing} onClick={handleTest}>
            测试连接
          </Button>
        </Tooltip>
        <Button onClick={onClose}>取消</Button>
        <Button type="primary" icon={<CheckOutlined />} loading={saving} onClick={handleSave}>
          保存
        </Button>
      </div>
    </div>
  )

  return (
    <Modal
      open={open}
      title={
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <CloudServerOutlined style={{ color: 'var(--color-primary)' }} />
          {editing ? '编辑 ' + editing.alias : '新增服务器'}
        </span>
      }
      width={620}
      centered
      styles={{ body: { maxHeight: 'calc(100dvh - 260px)', overflowY: 'auto', paddingTop: 'var(--space-5)' } }}
      onCancel={onClose}
      maskClosable={false}
      footer={footer}
      destroyOnHidden
    >
      <Form
        form={form}
        layout="vertical"
        requiredMark
        scrollToFirstError={{ behavior: 'smooth', block: 'center' }}
        style={{ marginBottom: 0 }}
      >
        {/* ── 基本信息 ── */}
        <div>
          <SectionTitle icon={<CloudServerOutlined />} title="基本信息" />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 var(--space-4)' }}>
            <Form.Item
              label="别名 alias"
              name="alias"
              rules={[
                { required: true, message: '请填写别名' },
                { pattern: /^[\w-]+$/, message: '只能包含字母、数字、下划线、连字符' },
              ]}
              extra="agent 用它指定机器"
            >
              <Input disabled={!!editing} placeholder="如 web-1" />
            </Form.Item>
            <Form.Item
              label="SSH 端口"
              name="port"
              rules={[{ required: true, message: '请填写端口' }]}
            >
              <InputNumber min={1} max={65535} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item
              label="主机地址"
              name="host"
              rules={[{ required: true, message: '请填写主机地址' }]}
            >
              <Input placeholder="IP 或主机名" />
            </Form.Item>
            <Form.Item
              label="登录用户名"
              name="username"
              rules={[{ required: true, message: '请填写登录用户名' }]}
            >
              <Input placeholder="root / deploy" />
            </Form.Item>
          </div>
        </div>

        <Divider style={{ margin: 'var(--space-2) 0 var(--space-5)' }} />

        {/* ── 登录凭据 ── */}
        <div>
          <SectionTitle
            icon={<KeyOutlined />}
            title="登录凭据"
            desc="凭据只写不读，保存后不会在页面上回显"
          />
          <Form.Item noStyle shouldUpdate={(p, c) => p.credential?.type !== c.credential?.type}>
            {({ getFieldValue }) => {
              const t = getFieldValue(['credential', 'type'])
              const credOptional = !!editing && t === editing?.credential_type
              return (
                <>
                  <Form.Item label="凭据类型" name={['credential', 'type']} rules={[{ required: true }]}>
                    <Select options={CRED_OPTIONS} />
                  </Form.Item>

                  {editing && (
                    <Alert
                      type="info"
                      showIcon
                      message="编辑模式：凭据字段留空 = 保持原凭据不变"
                      style={{ marginBottom: 'var(--space-4)' }}
                    />
                  )}

                  {t === 'private_key_file' && (
                    <>
                      <Form.Item
                        label="私钥文件路径"
                        name={['credential', 'path']}
                        rules={[{ required: !credOptional, message: '请填写私钥文件路径' }]}
                      >
                        <Input placeholder="/etc/ssh-mcp/keys/web-1.pem" />
                      </Form.Item>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginTop: -8, marginBottom: 'var(--space-4)' }}>
                        <Upload beforeUpload={handleUploadKey} showUploadList={false} accept=".pem,.key">
                          <Button icon={<UploadOutlined />} loading={uploadingKey}>
                            上传本地 .pem
                          </Button>
                        </Upload>
                        <span style={{ color: 'var(--color-text-tertiary)', fontSize: 'var(--text-small)' }}>
                          或手填网关机上的已有路径
                        </span>
                      </div>
                    </>
                  )}
                  {t === 'private_key_inline' && (
                    <Form.Item
                      label="PEM 私钥内容"
                      name={['credential', 'private_key']}
                      rules={[{ required: !credOptional, message: '请填写私钥内容' }]}
                      extra="支持 ${ENV_VAR} 引用环境变量，避免明文入库"
                    >
                      <Input.TextArea rows={4} placeholder="-----BEGIN OPENSSH PRIVATE KEY-----" className="mono" />
                    </Form.Item>
                  )}
                  {t === 'password' && (
                    <Form.Item
                      label="密码"
                      name={['credential', 'password']}
                      rules={[{ required: !credOptional, message: '请填写密码' }]}
                      extra="支持 ${ENV_VAR} 引用环境变量"
                    >
                      <Input.Password autoComplete="new-password" />
                    </Form.Item>
                  )}
                  {(t === 'private_key_file' || t === 'private_key_inline') && (
                    <Form.Item
                      label="私钥口令"
                      name={['credential', 'passphrase']}
                      extra="私钥未加密则留空"
                    >
                      <Input.Password autoComplete="new-password" placeholder="可选" />
                    </Form.Item>
                  )}
                </>
              )
            }}
          </Form.Item>
        </div>

        <Divider style={{ margin: 'var(--space-2) 0 var(--space-5)' }} />

        {/* ── 更多设置 ── */}
        <div>
          <SectionTitle icon={<InfoCircleOutlined />} title="更多设置" desc="全部可选" />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 var(--space-4)' }}>
            <Form.Item label="描述" name="description">
              <Input placeholder="如：Web 前端一号机" />
            </Form.Item>
            <Form.Item
              label="标签"
              name="tags"
              extra="输入后按回车添加，用于筛选与分组"
            >
              <Select mode="tags" tokenSeparators={[',']} open={false} placeholder="web, prod" />
            </Form.Item>
            <Form.Item
              label={
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                  known_hosts 路径
                  <Tooltip title="不填则跳过主机指纹校验，存在中间人风险。生产环境建议在网关机上用 ssh-keyscan 采集指纹后填入。">
                    <InfoCircleOutlined style={{ color: 'var(--color-text-tertiary)', fontSize: 12 }} />
                  </Tooltip>
                </span>
              }
              name="known_hosts"
              extra="留空则不校验主机指纹"
            >
              <Input placeholder="可选" />
            </Form.Item>
          </div>
        </div>
      </Form>
    </Modal>
  )
}
