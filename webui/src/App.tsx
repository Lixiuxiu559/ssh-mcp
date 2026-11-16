import { useEffect } from "react";
import { Button, Flex, Spin } from "antd";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  Boxes,
  History,
  KeyRound,
  LayoutDashboard,
  Server,
  Users,
} from "lucide-react";
import type { Page } from "./types";
import Login from "./pages/Login";
import Servers from "./pages/Servers";
import Overview from "./pages/Overview";
import UsersPage from "./pages/Users";
import Tokens from "./pages/Tokens";
import Audit from "./pages/Audit";
import { ConsoleLayout } from "./components/ConsoleLayout";
import { Feedback } from "./components/Feedback";
import { AccountMenu } from "./components/AccountMenu";
import { GatewayStatus } from "./components/GatewayStatus";
import { navigation } from "./lib/navigation";
import { useConsoleNavigation } from "./lib/use-console-navigation";
import { useResource } from "./lib/use-resource";
import { useSession } from "./lib/use-session";

const icons: Record<Page, LucideIcon> = {
  overview: LayoutDashboard,
  servers: Server,
  users: Users,
  tokens: KeyRound,
  "mcp-audit": Activity,
  "person-audit": History,
};
const consoleNavigation = navigation.map((item) => {
  const Icon = icons[item.id];
  return { ...item, icon: <Icon size={16} aria-hidden="true" /> };
});

export default function App() {
  const auth = useSession();
  const { session, error, setError } = auth;
  const workspace = useConsoleNavigation<Page>({
    navigation,
    defaultPage: "overview",
    pageKey: "workspace-page",
    collapsedKey: "workspace-nav-collapsed",
  });
  const { page, collapsed } = workspace;
  const health = useResource<{ ok: boolean }>("/healthz", { ok: false });
  const healthy = health.data.ok && !health.error;
  const title = navigation.find((item) => item.id === page)?.label || "工作区";
  useEffect(() => {
    document.title = session
      ? `${title} · SSH MCP Console`
      : "登录 · SSH MCP Console";
  }, [title, session]);

  if (auth.booting)
    return (
      <Flex align="center" justify="center" className="startup">
        <Spin description="正在连接工作区…" />
      </Flex>
    );
  if (error && !session)
    return (
      <Flex vertical gap={16} align="center" justify="center" className="startup">
        <Feedback message={error} />
        <Button onClick={() => void auth.boot()}>重新连接</Button>
      </Flex>
    );
  if (!session)
    return (
      <Login
        setup={auth.setup}
        notice={auth.loginNotice?.message || ""}
        noticeType={auth.loginNotice?.type}
        onLogin={auth.login}
      />
    );

  function navigate(value: Page) {
    workspace.navigate(value);
    setError("");
  }
  return (
    <ConsoleLayout
      brand="SSH MCP Gateway"
      brandIcon={<Boxes size={20} aria-hidden="true" />}
      navigation={consoleNavigation}
      selected={page}
      collapsed={collapsed}
      onNavigate={navigate}
      onCollapsedChange={workspace.changeCollapsed}
      account={
        <AccountMenu
          user={session.user}
          onUserUpdated={auth.userUpdated}
          onPasswordChanged={auth.passwordChanged}
          onLogout={auth.logout}
        />
      }
      gateway={
        <GatewayStatus
          collapsed={collapsed}
          healthy={healthy}
          loading={health.loading}
          onRefresh={health.reload}
        />
      }
    >
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
        <UsersPage key={session.user.display_name} currentUser={session.user} />
      ) : page === "tokens" ? (
        <Tokens />
      ) : (
        <Audit key={page} kind={page === "mcp-audit" ? "mcp" : "person"} />
      )}
    </ConsoleLayout>
  );
}
