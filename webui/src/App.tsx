import { useEffect, useState } from "react";
import {
  Link2,
  Server,
  KeyRound,
  Users,
  Activity,
  History,
  Search,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { api, ApiError, json, setCsrfToken } from "./api";
import type { Page, Session } from "./types";
import Login from "./pages/Login";
import Servers from "./pages/Servers";
import UsersPage from "./pages/Users";
import Tokens from "./pages/Tokens";
import Audit from "./pages/Audit";
import { Button } from "./components/ui/button";
import { Feedback } from "./components/ui/feedback";
import { ThemeControl } from "./components/theme-provider";
import { CommandPalette, navigation } from "./components/CommandPalette";
import { errorText } from "./lib/utils";
const icons = {
  servers: Server,
  users: Users,
  tokens: KeyRound,
  "mcp-audit": Activity,
  "person-audit": History,
};
export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [setup, setSetup] = useState(false);
  const [booting, setBooting] = useState(true);
  const [error, setError] = useState("");
  const [expired, setExpired] = useState(false);
  const [page, setPage] = useState<Page>("servers");
  const [command, setCommand] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const title = navigation.find((item) => item.id === page)?.label || "工作区";
  function closeNav() {
    setNavOpen(false);
    requestAnimationFrame(() =>
      document.getElementById("nav-toggle")?.focus(),
    );
  }
  async function boot() {
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
          // 首次进入或刷新时没有会话是正常状态，不显示"登录已过期"。
          setExpired(false);
        }
      }
    } catch (error) {
      setError(errorText(error));
    } finally {
      setBooting(false);
    }
  }
  useEffect(() => {
    void boot();
  }, []);
  useEffect(() => {
    document.title = session
      ? `${title} · SSH MCP 链路工作台`
      : "登录 · SSH MCP 链路工作台";
  }, [title, session]);
  useEffect(() => {
    const expire = () => {
      setSession(null);
      setExpired(true);
      setCsrfToken("");
    };
    window.addEventListener("session-expired", expire);
    return () => window.removeEventListener("session-expired", expire);
  }, []);
  useEffect(() => {
    if (!navOpen) return;
    const handle = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeNav();
    };
    document.addEventListener("keydown", handle);
    return () => document.removeEventListener("keydown", handle);
  }, [navOpen]);
  useEffect(() => {
    if (!session) return;
    const handle = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommand((value) => !value);
      }
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [session]);
  if (booting)
    return (
      <div className="boot-state" role="status">
        <Link2 size={25} />
        <p>正在连接工作区…</p>
      </div>
    );
  if (error && !session)
    return (
      <div className="boot-state">
        <Feedback message={error} />
        <Button onClick={() => void boot()}>重新连接</Button>
      </div>
    );
  if (!session)
    return (
      <Login
        setup={setup}
        notice={expired ? "登录已过期，请重新登录。" : ""}
        onLogin={(value) => {
          setSession(value);
          setSetup(false);
          setExpired(false);
        }}
      />
    );
  async function logout() {
    try {
      await api("/api/auth/logout", json("POST"));
      setSession(null);
      setExpired(false);
      setCsrfToken("");
    } catch (error) {
      setError(errorText(error));
    }
  }
  function navigate(value: Page) {
    const wasOpen = navOpen;
    setPage(value);
    setNavOpen(false);
    setError("");
    if (wasOpen)
      requestAnimationFrame(() =>
        document.getElementById("nav-toggle")?.focus(),
      );
  }
  return (
    <div className={`workspace ${navOpen ? "nav-expanded" : ""}`}>
      <aside className="sidebar" id="workspace-nav" aria-label="工作区导航">
        <a className="sidebar-brand" href="./">
          <span className="brand-symbol">
            <Link2 size={21} />
          </span>
          <span>
            <strong>链路</strong>
            <small>SSH MCP</small>
          </span>
        </a>
        <div className="sidebar-caption">工作空间</div>
        <nav aria-label="主导航">
          {navigation.map((item) => {
            const Icon = icons[item.id];
            return (
              <button
                key={item.id}
                type="button"
                className={`nav-item ${page === item.id ? "current" : ""}`}
                aria-current={page === item.id ? "page" : undefined}
                onClick={() => navigate(item.id)}
              >
                <Icon size={17} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
        <div className="sidebar-bottom">
          <span className="sidebar-service">
            <span className="service-dot" />
            SSH 网关服务
          </span>
          <p>连接 · 凭证 · 操作痕迹</p>
          <small>Linkage 1.0</small>
        </div>
      </aside>
      {navOpen && (
        <button
          className="nav-overlay"
          onClick={closeNav}
          aria-label="关闭导航"
        />
      )}
      <div className="workspace-main">
        <header className="topbar">
          <div className="topbar-start">
            <Button
              variant="quiet"
              className="icon-button mobile-nav"
              id="nav-toggle"
              aria-label={navOpen ? "关闭导航" : "打开导航"}
              aria-expanded={navOpen}
              aria-controls="workspace-nav"
              onClick={() => (navOpen ? closeNav() : setNavOpen(true))}
            >
              {navOpen ? (
                <PanelLeftClose size={18} />
              ) : (
                <PanelLeftOpen size={18} />
              )}
            </Button>
            <span className="breadcrumb">
              <span className="crumb-root">
                SSH MCP <span className="crumb-sep">/</span>{" "}
              </span>
              <strong>{title}</strong>
            </span>
          </div>
          <div className="topbar-actions">
            <button
              className="command-trigger"
              aria-label="搜索页面（⌘ K）"
              onClick={() => setCommand(true)}
            >
              <Search size={15} />
              <span>搜索页面</span>
              <kbd>⌘ K</kbd>
            </button>
            <ThemeControl />
            <span className="member-name" title={session.user.username}>
              {session.user.display_name || session.user.username}
            </span>
            <Button
              variant="quiet"
              className="icon-button"
              onClick={() => void logout()}
              aria-label="退出登录"
            >
              <LogOut size={17} />
            </Button>
          </div>
        </header>
        <main className="page-content">
          <Feedback message={error} onDismiss={() => setError("")} />
          {page === "servers" ? (
            <Servers />
          ) : page === "users" ? (
            <UsersPage currentUser={session.user} />
          ) : page === "tokens" ? (
            <Tokens />
          ) : (
            <Audit key={page} kind={page === "mcp-audit" ? "mcp" : "person"} />
          )}
        </main>
        <footer className="workspace-footer">
          <span>SSH MCP 工作区</span>
          <span>人员与服务凭证独立管理</span>
        </footer>
      </div>
      <CommandPalette
        open={command}
        onOpenChange={setCommand}
        onNavigate={navigate}
      />
    </div>
  );
}
