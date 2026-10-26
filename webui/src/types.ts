export interface User {
  id: string;
  username: string;
  display_name: string;
  enabled: boolean;
  created_at?: string;
  last_login_at?: string | null;
}
export interface Session {
  user: User;
  csrf_token: string;
}
export interface ServerEntry {
  alias: string;
  host: string;
  port: number;
  username: string;
  description: string;
  tags: string[];
  credential_type: string;
  has_known_hosts: boolean;
}
export interface TokenEntry {
  id: string;
  name: string;
  description: string;
  prefix: string;
  enabled: boolean;
  revoked: boolean;
  created_by: string | null;
  created_at: string;
  last_used_at: string | null;
}
export interface AuditRecord {
  id: string | number;
  ts: string;
  ended_at?: string | null;
  status: string;
  token_id?: string | null;
  token_name?: string | null;
  token_prefix?: string | null;
  tool?: string | null;
  server?: string | null;
  command?: string | null;
  path?: string | null;
  target_host?: string | null;
  target_port?: number | null;
  target_username?: string | null;
  actor_user_id?: string | null;
  username?: string | null;
  user?: string | null;
  action?: string | null;
  object_type?: string | null;
  object_id?: string | null;
  summary?: string | null;
  error?: string | null;
  source_ip?: string | null;
  duration_ms?: number | null;
  request_id?: string | null;
  legacy?: boolean;
  content_bytes?: number | null;
  content_sha256?: string | null;
}
export type AuditKind = "mcp" | "person";
export type Page =
  "servers" | "users" | "tokens" | "mcp-audit" | "person-audit";
