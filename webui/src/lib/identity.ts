/** 人员与 Token 表单按 Unicode 字符计数，与服务端 Python len 保持一致。 */
export function characterLengthRule(maximum: number, message: string, minimum = 0) {
  return {
    validator(_: unknown, value: unknown): Promise<void> {
      // 必填规则由表单单独处理；编辑成员时空密码表示保持原值。
      if (value === undefined || value === null || value === "") return Promise.resolve();
      const count = typeof value === "string" ? Array.from(value).length : -1;
      return count >= minimum && count <= maximum
        ? Promise.resolve()
        : Promise.reject(new Error(message));
    },
  };
}

export function passwordLengthRule(minimum = 6) {
  return characterLengthRule(1024, `密码长度须为 ${minimum}–1024 个字符`, minimum);
}

/** datetime-local 使用浏览器时区；编辑未变化的旧期限时不得重新发送或截断。 */
export function localExpiry(value?: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function expiryFromLocal(value: string): string | null {
  if (!value) return null;
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  const date = new Date(value);
  if (!parts || !Number.isFinite(date.getTime()) ||
      date.getFullYear() !== Number(parts[1]) || date.getMonth() + 1 !== Number(parts[2]) ||
      date.getDate() !== Number(parts[3]) || date.getHours() !== Number(parts[4]) ||
      date.getMinutes() !== Number(parts[5]) || date.getSeconds() !== Number(parts[6] || 0)) {
    throw new Error("请输入有效的到期时间");
  }
  return date.toISOString();
}

export function expiryRule(original = "") {
  return {
    validator(_: unknown, value: string | undefined): Promise<void> {
      if (!value || value === original) return Promise.resolve();
      try {
        const expiry = expiryFromLocal(value);
        return expiry && new Date(expiry).getTime() > Date.now()
          ? Promise.resolve()
          : Promise.reject(new Error("到期时间必须晚于当前时间"));
      } catch (error) {
        return Promise.reject(error);
      }
    },
  };
}

export function expiryPatch(value: string | undefined, original?: string | null) {
  return (value || "") === localExpiry(original)
    ? {}
    : { expires_at: expiryFromLocal(value || "") };
}

export function isTokenExpired(item: { expires_at?: string | null; expired?: boolean }, now = Date.now()) {
  if (item.expired) return true;
  if (!item.expires_at) return false;
  const expiry = new Date(item.expires_at).getTime();
  return !Number.isFinite(expiry) || now >= expiry;
}

export function isTokenUsable(item: {
  enabled: boolean; revoked: boolean; expires_at?: string | null; expired?: boolean;
}, now = Date.now()) {
  return item.enabled && !item.revoked && !isTokenExpired(item, now);
}

/** effect 建立前已跨过截止时，立即补一次 render，不能丢弃该期限。 */
export function nextTokenRefreshDelay(tokens: { expires_at?: string | null }[], renderedAt: number, current: number) {
  const deadlines = tokens.map((token) => token.expires_at ? new Date(token.expires_at).getTime() : NaN)
    .filter(Number.isFinite);
  if (deadlines.some((deadline) => deadline > renderedAt && deadline <= current)) return 0;
  const upcoming = deadlines.filter((deadline) => deadline > current);
  return upcoming.length
    ? Math.min(Math.min(...upcoming) - current + 1, 2_147_483_647)
    : null;
}
