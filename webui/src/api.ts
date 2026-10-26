let csrfToken = "";
export function setCsrfToken(token: string) {
  csrfToken = token;
}
export function apiUrl(path: string) {
  return path.replace(/^\/+/, "");
}
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function response(
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(options.headers);
  if (options.body && !(options.body instanceof FormData))
    headers.set("Content-Type", "application/json");
  if (
    options.method &&
    !["GET", "HEAD"].includes(options.method.toUpperCase()) &&
    csrfToken
  ) {
    headers.set("X-CSRF-Token", csrfToken);
  }
  const res = await fetch(apiUrl(path), {
    ...options,
    headers,
    credentials: "same-origin",
  });
  if (!res.ok) {
    let detail = `请求失败（${res.status}）`;
    try {
      const body = await res.json();
      if (typeof body.detail === "string") detail = body.detail;
    } catch {
      /* preserve status */
    }
    if (res.status === 401 && !path.includes("/auth/"))
      window.dispatchEvent(new Event("session-expired"));
    throw new ApiError(detail, res.status);
  }
  return res;
}
export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const res = await response(path, options);
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}
export function json(method: string, body?: unknown): RequestInit {
  return {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  };
}
