/* 领域类型：ssh-mcp API 契约 */

export interface ServerEntry {
  alias: string
  host: string
  port: number
  username: string
  description: string
  tags: string[]
  credential_type: string
  has_known_hosts: boolean
}

export interface AuditRecord {
  ts: string
  user: string
  tool: string
  server: string
  command?: string
  path?: string
  status: 'ok' | string
  duration_ms: number
  request_id?: string
  error?: string
  content_bytes?: number
  content_sha256?: string
}

export interface Me {
  username: string
  admin: boolean
  default_admin?: boolean
}

export const CRED_FIELDS: Record<string, string[]> = {
  private_key_file: ['path', 'passphrase'],
  private_key_inline: ['private_key', 'passphrase'],
  password: ['password'],
}

export const CRED_LABEL: Record<string, string> = {
  private_key_file: '私钥文件',
  private_key_inline: '内嵌私钥',
  password: '密码',
}
