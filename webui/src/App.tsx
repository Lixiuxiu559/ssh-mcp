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
  const [page, setPage] = useState<Page>("servers");
  const [command, setCommand] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
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
    const expire = () => {
      setSession(null);
      setCsrfToken("");
    };
    window.addEventListener("session-expired", expire);
    return () => window.removeEventListener("session-expired", expire);
  }, []);
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
        onLogin={(value) => {
          setSession(value);
          setSetup(false);
        }}
      />
    );
  async function logout() {
    try {
      await api("/api/auth/logout", json("POST"));
      setSession(null);
      setCsrfToken("");
    } catch (error) {
      setError(errorText(error));
    }
  }
  function navigate(value: Page) {
    setPage(value);
    setNavOpen(false);
    setError("");
  }
  const title = navigation.find((item) => item.id === page)!.label;
  return (
    <div className={`workspace ${navOpen ? "nav-expanded" : ""}`}>
      <aside className="sidebar">
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
          onClick={() => setNavOpen(false)}
          aria-label="关闭导航"
        />
      )}
      <div className="workspace-main">
        <header className="topbar">
          <div className="topbar-start">
            <Button
              variant="quiet"
              className="icon-button mobile-nav"
              aria-label={navOpen ? "关闭导航" : "打开导航"}
              onClick={() => setNavOpen(!navOpen)}
            >
              {navOpen ? (
                <PanelLeftClose size={18} />
              ) : (
                <PanelLeftOpen size={18} />
              )}
            </Button>
            <span className="breadcrumb">
              SSH MCP <span>/</span> <strong>{title}</strong>
            </span>
          </div>
          <div className="topbar-actions">
            <button
              className="command-trigger"
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
          <Feedback message={error} />
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
