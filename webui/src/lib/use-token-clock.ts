import { useEffect, useState } from "react";
import { nextTokenRefreshDelay } from "./identity";

/** 到最近期限时更新显示；实际调用权限始终由服务端检查。 */
export function useTokenClock(tokens: { expires_at?: string | null }[]) {
  const [revision, setRevision] = useState(0);
  const now = Date.now();
  useEffect(() => {
    const delay = nextTokenRefreshDelay(tokens, now, Date.now());
    if (delay === null) return;
    const timer = window.setTimeout(() => setRevision((value) => value + 1), delay);
    return () => window.clearTimeout(timer);
  }, [tokens, now, revision]);
  return now;
}
