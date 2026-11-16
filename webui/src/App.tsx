import { useEffect, useState } from "react";
import {
  Badge,
  Button,
  Flex,
  Layout,
  Menu,
  Spin,
  Tooltip,
  Typography,
} from "antd";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  Boxes,
  History,
  KeyRound,
  LayoutDashboard,
  PanelLeftClose,
  PanelLeftOpen,
  Server,
  Users,
} from "lucide-react";
import { api, ApiError, json, setCsrfToken } from "./api";
import type { Page, Session, User } from "./types";
import Login from "./pages/Login";
import Servers from "./pages/Servers";
import Overview from "./pages/Overview";
import UsersPage from "./pages/Users";
import Tokens from "./pages/Tokens";
import Audit from "./pages/Audit";
import { Feedback } from "./components/Feedback";
import { ThemeToggle } from "./components/theme-controls";
import { AccountMenu } from "./components/AccountMenu";
import { RepositoryLink } from "./components/RepositoryLink";
import { navigation } from "./lib/navigation";
import { useResource } from "./lib/use-resource";
import { errorText } from "./lib/utils";

const icons: Record<Page, LucideIcon> = {
  overview: LayoutDashboard,
  servers: Server,
  users: Users,
  tokens: KeyRound,
  "mcp-audit": Activity,
  "person-audit": History,
};

const pageIds = new Set<string>(navigation.map((item) => item.id));
function readInitialPage(): Page {
  try {
    const value = localStorage.getItem("workspace-page");
    return value && pageIds.has(value) ? (value as Page) : "overview";
  } catch {
    return "overview";
  }
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [setup, setSetup] = useState(false);
  const [booting, setBooting] = useState(true);
  const [error, setError] = useState("");
  const [loginNotice, setLoginNotice] = useState<{
    message: string;
    type: "success" | "warning";
  } | null>(null);
  const [page, setPage] = useState<Page>(readInitialPage);
  const [navCollapsed, setNavCollapsed] = useState(() => {
    try {
      return localStorage.getItem("workspace-nav-collapsed") === "true";
    } catch {
      return false;
    }
  });
  const health = useResource<{ ok: boolean }>("/healthz", { ok: false });
  const healthy = health.data.ok && !health.error;
  const title = navigation.find((item) => item.id === page)?.label || "工作区";
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
          setLoginNotice(null);
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
      ? `${title} · SSH MCP Console`
      : "登录 · SSH MCP Console";
  }, [title, session]);
  useEffect(() => {
    const expire = () => {
      setSession(null);
      setLoginNotice({ message: "登录已过期，请重新登录。", type: "warning" });
      setCsrfToken("");
    };
    window.addEventListener("session-expired", expire);
    return () => window.removeEventListener("session-expired", expire);
  }, []);
  if (booting)
    return (
      <Flex align="center" justify="center" className="startup">
        <Spin description="正在连接工作区…" />
      </Flex>
    );
  if (error && !session)
    return (
      <Flex
        vertical
        gap={16}
        align="center"
        justify="center"
        className="startup"
      >
        <Feedback message={error} />
        <Button onClick={() => void boot()}>重新连接</Button>
      </Flex>
    );
  if (!session)
    return (
      <Login
        setup={setup}
        notice={loginNotice?.message || ""}
        noticeType={loginNotice?.type}
        onLogin={(value) => {
          setSession(value);
          setSetup(false);
          setLoginNotice(null);
        }}
      />
    );
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
  function navigate(value: Page) {
    setPage(value);
    try {
      localStorage.setItem("workspace-page", value);
    } catch {
      /* 偏好存储可选。 */
    }
    setError("");
  }
  function toggleSidebar() {
    const collapsed = !navCollapsed;
    setNavCollapsed(collapsed);
    try {
      localStorage.setItem("workspace-nav-collapsed", String(collapsed));
    } catch {
      /* 偏好存储可选。 */
    }
  }
  return (
    <Layout className="app-layout">
      <Layout.Header className="app-header">
        <Flex align="center" gap={12}>
          <Tooltip title={navCollapsed ? "展开侧边栏" : "收起侧边栏"}>
            <Button
              type="text"
              aria-label={navCollapsed ? "展开侧边栏" : "收起侧边栏"}
              onClick={toggleSidebar}
              icon={
                navCollapsed ? (
                  <PanelLeftOpen size={16} />
                ) : (
                  <PanelLeftClose size={16} />
                )
              }
            />
          </Tooltip>
          <Typography.Link href="./" className="app-brand">
            <Boxes size={20} />
            <strong>SSH MCP Gateway</strong>
          </Typography.Link>
        </Flex>
        <Flex gap={8} align="center">
          <ThemeToggle />
          <AccountMenu
            user={session.user}
            onUserUpdated={userUpdated}
            onPasswordChanged={passwordChanged}
            onLogout={logout}
          />
        </Flex>
      </Layout.Header>
      <Layout className="app-workspace">
        <Layout.Sider
          theme="light"
          width={220}
          collapsedWidth={64}
          collapsed={navCollapsed}
          trigger={null}
          className="app-sidebar"
        >
          <Flex vertical justify="space-between" className="sidebar-inner">
            <nav aria-label="主导航">
              <Menu
                mode="inline"
                selectedKeys={[page]}
                onClick={({ key }) => navigate(key as Page)}
                items={navigation.map((item) => {
                  const Icon = icons[item.id];
                  return {
                    key: item.id,
                    label: item.label,
                    icon: <Icon size={16} aria-hidden="true" />,
                  };
                })}
              />
            </nav>
            <Flex
              vertical
              gap={8}
              className={`sidebar-footer${navCollapsed ? " sidebar-footer-collapsed" : ""}`}
            >
              <RepositoryLink iconOnly={navCollapsed} />
              <Tooltip title={healthy ? "网关运行正常" : "网关状态未知"}>
                <div className="gateway-status">
                  <Badge
                    status={healthy ? "success" : "default"}
                    text={
                      navCollapsed
                        ? undefined
                        : healthy
                          ? "网关运行正常"
                          : "网关状态未知"
                    }
                  />
                </div>
              </Tooltip>
            </Flex>
          </Flex>
        </Layout.Sider>
        <Layout.Content className="app-content">
          <main>
            <Feedback message={error} onDismiss={() => setError("")} />
            {page === "overview" ? (
              <Overview
                onNavigate={navigate}
                healthy={healthy}
                onRefreshHealth={health.reload}
              />
            ) : page === "servers" ? (
              <Servers />
            ) : page === "users" ? (
              <UsersPage
                key={session.user.display_name}
                currentUser={session.user}
              />
            ) : page === "tokens" ? (
              <Tokens />
            ) : (
              <Audit
                key={page}
                kind={page === "mcp-audit" ? "mcp" : "person"}
              />
            )}
          </main>
        </Layout.Content>
      </Layout>
    </Layout>
  );
}
