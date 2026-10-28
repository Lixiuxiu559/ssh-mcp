import { useState, type FormEvent } from "react";
import { ArrowRight, Link2, LockKeyhole, Terminal } from "lucide-react";
import { api, json, setCsrfToken } from "../api";
import type { Session } from "../types";
import { Button } from "../components/ui/button";
import { Field, Input, PasswordInput } from "../components/ui/field";
import { Feedback } from "../components/ui/feedback";
import { ThemeControl } from "../components/theme-provider";
import { errorText } from "../lib/utils";
export default function Login({
  setup,
  notice,
  onLogin,
}: {
  setup: boolean;
  notice?: string;
  onLogin: (session: Session) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [setupKey, setSetupKey] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (setup && password !== confirm) {
      setError("两次输入的密码不一致");
      return;
    }
    setBusy(true);
    try {
      const result = await api<Session>(
        `/api/auth/${setup ? "setup" : "login"}`,
        json("POST", {
          username,
          password,
          ...(setup ? { setup_key: setupKey } : {}),
        }),
      );
      setCsrfToken(result.csrf_token);
      onLogin(result);
    } catch (error) {
      setError(errorText(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="login-page">
      <header className="login-top">
        <a className="wordmark" href="./">
          <Link2 size={21} />
          <strong>链路</strong>
          <span>SSH MCP</span>
        </a>
        <ThemeControl />
      </header>
      <main className="login-layout">
        <section className="login-context">
          <span className="eyebrow">MCP CONNECTION WORKSPACE</span>
          <h1>
            让每次远程操作
            <br />
            都有清晰的来路。
          </h1>
          <p>
            连接你的服务器，管理服务凭证，追溯每一次调用。一个工作区，保留完整的操作上下文。
          </p>
          <div className="login-path">
            <span>
              <Terminal size={18} />
              运维客户端
            </span>
            <ArrowRight size={18} />
            <span>
              <Link2 size={18} />
              SSH MCP
            </span>
          </div>
          <div className="login-note">
            <LockKeyhole size={17} />
            <span>人员使用账号密码登录。MCP token 在工作区内独立管理。</span>
          </div>
        </section>
        <section className="login-card">
          <div className="login-card-heading">
            <span className="eyebrow">
              {setup ? "FIRST-TIME SETUP" : "WELCOME BACK"}
            </span>
            <h2>{setup ? "建立第一个用户" : "登录工作区"}</h2>
            <p>
              {setup
                ? "使用服务端初始化密钥创建账号，原有 MCP token 会继续保留。"
                : "使用你的用户名与密码继续。"}
            </p>
          </div>
          <form onSubmit={submit} className="form-stack">
            <Feedback message={error || notice} />
            {setup && (
              <Field
                label="初始化密钥"
                hint="从服务启动日志提示的 setup.key 文件读取。"
              >
                <PasswordInput
                  value={setupKey}
                  onChange={(e) => setSetupKey(e.target.value)}
                  autoComplete="off"
                  required
                  placeholder="服务端一次性初始化密钥"
                />
              </Field>
            )}
            <Field label="用户名">
              <Input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                required
                maxLength={64}
                placeholder="输入用户名"
              />
            </Field>
            <Field
              label="密码"
              hint={setup ? "至少 10 位，请使用独立的登录密码。" : undefined}
            >
              <PasswordInput
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={setup ? "new-password" : "current-password"}
                minLength={setup ? 10 : undefined}
                maxLength={1024}
                required
                placeholder="输入密码"
              />
            </Field>
            {setup && (
              <Field label="确认密码">
                <PasswordInput
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  autoComplete="new-password"
                  required
                  placeholder="再次输入密码"
                />
              </Field>
            )}
            <Button
              variant="primary"
              className="login-submit"
              disabled={busy}
              type="submit"
            >
              {busy ? "正在处理…" : setup ? "创建用户并进入" : "登录"}
              <ArrowRight size={16} />
            </Button>
          </form>
          <p className="login-footnote">
            {setup
              ? "初始化完成后此入口将关闭，所有启用人员具有相同管理能力。"
              : "登录状态仅用于管理后台，不作为 MCP 调用凭证。"}
          </p>
        </section>
      </main>
      <footer className="login-footer">
        SSH MCP<span>链路工作台 · Linkage 1.0</span>
      </footer>
    </div>
  );
}
