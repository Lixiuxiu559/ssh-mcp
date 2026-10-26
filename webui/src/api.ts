const TOKEN_KEY = 'ssh_mcp_token'

export const getToken = () => localStorage.getItem(TOKEN_KEY) || ''
export const setToken = (t: string) => localStorage.setItem(TOKEN_KEY, t.trim())
export const clearToken = () => localStorage.removeItem(TOKEN_KEY)

// 去掉前导 "/" 转成相对路径：页面挂在任何子路径（如 /ssh-mcp/）下，
// 都会请求所在子路径下的 api，经网关剥前缀后命中后端的 /api/*
export const apiUrl = (path: string) => path.replace(/^\//, '')

export async function api(path: string, opts: RequestInit = {}): Promise<any> {
  const resp = await fetch(apiUrl(path), {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + getToken(),
      ...(opts.headers || {}),
    },
  })
  if (resp.status === 401) {
    clearToken()
    location.reload()
    throw new Error('token 无效，请重新登录')
  }
  const data = await resp.json().catch(() => ({}))
  if (!resp.ok) throw new Error(data.detail || data.error || 'HTTP ' + resp.status)
  return data
}
