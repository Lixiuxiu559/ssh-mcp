import { useCallback, useEffect, useState } from "react";
import { api, ApiError, json, setCsrfToken } from "../api";
import type { Session, User } from "../console-types";
import { errorText } from "./utils";

export interface LoginNotice {
  message: string;
  type: "success" | "warning";
}

/** Cookie 会话与 CSRF 的公共状态机；MCP Token 不参与网页登录。 */
export function useSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [setup, setSetup] = useState(false);
  const [booting, setBooting] = useState(true);
  const [error, setError] = useState("");
  const [loginNotice, setLoginNotice] = useState<LoginNotice | null>(null);

  const boot = useCallback(async () => {
    setBooting(true);
    setError("");
    try {
      const status = await api<{ setup_required: boolean }>("/api/auth/status");
      setSetup(status.setup_required);
      if (!status.setup_required) {
        try {
          const value = await api<Session>("/api/me");
          setSession(value);
          setCsrfToken(value.csrf_token);
        } catch (error) {
          if (!(error instanceof ApiError && error.status === 401)) throw error;
          // 首次进入或刷新时没有会话是正常状态。
          setLoginNotice(null);
        }
      }
    } catch (error) {
      setError(errorText(error));
    } finally {
      setBooting(false);
    }
  }, []);

  useEffect(() => {
    void boot();
  }, [boot]);
  useEffect(() => {
    const expire = () => {
      setSession(null);
      setLoginNotice({ message: "登录已过期，请重新登录。", type: "warning" });
      setCsrfToken("");
    };
    window.addEventListener("session-expired", expire);
    return () => window.removeEventListener("session-expired", expire);
  }, []);

  function login(value: Session) {
    setSession(value);
    setCsrfToken(value.csrf_token);
    setSetup(false);
    setLoginNotice(null);
  }
  async function logout() {
    try {
      await api("/api/auth/logout", json("POST"));
      setSession(null);
      setLoginNotice(null);
      setCsrfToken("");
    } catch (error) {
      setError(errorText(error));
    }
  }
  function userUpdated(user: User) {
    setSession((current) => (current ? { ...current, user } : null));
  }
  function passwordChanged() {
    setSession(null);
    setCsrfToken("");
    setLoginNotice({
      message: "密码已修改，请使用新密码重新登录。",
      type: "success",
    });
  }

  return {
    session,
    setup,
    booting,
    error,
    setError,
    loginNotice,
    boot,
    login,
    logout,
    userUpdated,
    passwordChanged,
  };
}
