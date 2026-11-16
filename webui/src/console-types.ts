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
