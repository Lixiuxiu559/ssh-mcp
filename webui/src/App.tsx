import { useEffect, useState } from "react";
import {
  ActionIcon,
  Anchor,
  AppShell,
  Box,
  Burger,
  Button,
  Center,
  Group,
  Kbd,
  Loader,
  Menu,
  NavLink,
  Stack,
  Text,
  ThemeIcon,
  Tooltip,
} from "@mantine/core";
import { useDisclosure, useLocalStorage } from "@mantine/hooks";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  Boxes,
  CircleCheck,
  History,
  KeyRound,
  LayoutDashboard,
  Link2,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Server,
  UserRound,
  Users,
} from "lucide-react";
import { api, ApiError, json, setCsrfToken } from "./api";
import type { Page, Session } from "./types";
import Login from "./pages/Login";
import Servers from "./pages/Servers";
import Overview from "./pages/Overview";
import UsersPage from "./pages/Users";
import Tokens from "./pages/Tokens";
import Audit from "./pages/Audit";
import { Feedback } from "./components/Feedback";
import { ThemeControl, ThemeToggle } from "./components/theme-controls";
import { CommandPalette, navigation } from "./components/CommandPalette";
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
  const [expired, setExpired] = useState(false);
  const [page, setPage] = useState<Page>(readInitialPage);
  const [navOpened, { toggle: toggleNav, close: closeNav }] =
    useDisclosure(false);
  const [navCollapsed, setNavCollapsed] = useLocalStorage({
    key: "workspace-nav-collapsed",
    defaultValue: false,
  });
  const navWidth = navCollapsed ? 64 : 220;
  const [command, commandHandlers] = useDisclosure(false);
  const health = useResource<{ ok: boolean }>("/healthz", { ok: false });
  const healthy = health.data.ok && !health.error;
  const title = navigation.find((item) => item.id === page)?.label || "工作区";
  function closeMobileNav() {
    closeNav();
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
      ? `${title} · SSH MCP Console`
      : "登录 · SSH MCP Console";
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
    if (!navOpened) return;
    const handle = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeMobileNav();
    };
    document.addEventListener("keydown", handle);
    return () => document.removeEventListener("keydown", handle);
  }, [navOpened]);
  useEffect(() => {
    if (!session) return;
    const handle = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        commandHandlers.toggle();
      }
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [session]);
  if (booting)
    return (
      <Center mih="100vh">
        <Stack align="center" gap="sm">
          <Loader size={26} type="dots" />
          <Text size="sm" c="dimmed">
            正在连接工作区…
          </Text>
        </Stack>
      </Center>
    );
  if (error && !session)
    return (
      <Center mih="100vh">
        <Stack align="center" gap="md" w={360}>
          <Link2 size={26} stroke="1.5" />
          <Feedback message={error} />
          <Button onClick={() => void boot()}>重新连接</Button>
        </Stack>
      </Center>
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
    const wasOpen = navOpened;
    setPage(value);
    try {
      localStorage.setItem("workspace-page", value);
    } catch {
      /* 偏好存储可选。 */
    }
    closeNav();
    setError("");
    if (wasOpen)
      requestAnimationFrame(() =>
        document.getElementById("nav-toggle")?.focus(),
      );
  }
  return (
    <AppShell
      header={{ height: 56 }}
      navbar={{
        width: navWidth,
        breakpoint: "sm",
        collapsed: { mobile: !navOpened },
      }}
      padding={{ base: "sm", sm: "xl" }}
    >
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between" wrap="nowrap">
          <Group gap="sm" wrap="nowrap">
            <Burger
              id="nav-toggle"
              opened={navOpened}
              onClick={toggleNav}
              hiddenFrom="sm"
              size="sm"
              aria-label={navOpened ? "关闭导航" : "打开导航"}
            />
            <Anchor href="./" underline="never" c="inherit">
              <Group gap={8} wrap="nowrap">
                <ThemeIcon variant="light" size="sm" radius="md">
                  <Boxes size={15} aria-hidden="true" />
                </ThemeIcon>
                <Box>
                  <Text size="sm" fw={700} lh={1.2}>
                    SSH MCP Gateway
                  </Text>
                  <Text size="10px" c="dimmed" lh={1.2}>
                    Infrastructure Console
                  </Text>
                </Box>
              </Group>
            </Anchor>
          </Group>
          <Group gap="xs" wrap="nowrap">
            <ThemeToggle />
            <Menu shadow="md" position="bottom-end">
              <Menu.Target>
                <ActionIcon
                  variant="default"
                  size="lg"
                  aria-label="账号与偏好设置"
                >
                  <UserRound size={15} aria-hidden="true" />
                </ActionIcon>
              </Menu.Target>
              <Menu.Dropdown w={230}>
                <Menu.Label>
                  {session.user.display_name || session.user.username}
                </Menu.Label>
                <Box px="xs" pb="xs">
                  <ThemeControl />
                </Box>
                <Menu.Divider />
                <Menu.Item
                  leftSection={<Search size={14} aria-hidden="true" />}
                  rightSection={<Kbd>⌘K</Kbd>}
                  onClick={commandHandlers.open}
                >
                  快速前往
                </Menu.Item>
                <Menu.Item
                  color="red"
                  leftSection={<LogOut size={14} aria-hidden="true" />}
                  onClick={() => void logout()}
                >
                  退出登录
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          </Group>
        </Group>
      </AppShell.Header>
      <AppShell.Navbar aria-label="工作区导航">
        <Stack justify="space-between" h="100%" gap="sm" py="sm">
          <Box component="nav" aria-label="主导航">
            <Group
              justify="space-between"
              px="xs"
              pb="xs"
              wrap="nowrap"
              visibleFrom="sm"
              style={{ minHeight: 28 }}
            >
              {!navCollapsed && (
                <Text size="11px" fw={600} c="dimmed" tt="uppercase">
                  工作空间
                </Text>
              )}
              <Tooltip
                label={navCollapsed ? "展开侧边栏" : "收起侧边栏"}
                position="right"
              >
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  aria-label={navCollapsed ? "展开侧边栏" : "收起侧边栏"}
                  onClick={() => setNavCollapsed((value) => !value)}
                  style={
                    navCollapsed ? { alignSelf: "center", margin: "0 auto" } : undefined
                  }
                >
                  {navCollapsed ? (
                    <PanelLeftOpen size={16} aria-hidden="true" />
                  ) : (
                    <PanelLeftClose size={16} aria-hidden="true" />
                  )}
                </ActionIcon>
              </Tooltip>
            </Group>
            <Stack gap={4} px="xs">
              {navigation.map((item) => {
                const Icon = icons[item.id];
                const link = (
                  <NavLink
                    active={page === item.id}
                    onClick={() => navigate(item.id)}
                    label={navCollapsed ? undefined : item.label}
                    leftSection={<Icon size={16} aria-hidden="true" />}
                    aria-current={page === item.id ? "page" : undefined}
                    aria-label={navCollapsed ? item.label : undefined}
                    style={
                      navCollapsed ? { justifyContent: "center" } : undefined
                    }
                  />
                );
                return navCollapsed ? (
                  <Tooltip key={item.id} label={item.label} position="right">
                    {link}
                  </Tooltip>
                ) : (
                  <div key={item.id}>{link}</div>
                );
              })}
            </Stack>
          </Box>
          <Box px="xs" pb="xs">
            {navCollapsed ? (
              <Tooltip
                label={healthy ? "网关运行正常 · SSH MCP v0.2.0" : "网关状态未知"}
                position="right"
              >
                <Center>
                  <CircleCheck
                    size={18}
                    aria-hidden="true"
                    color={
                      healthy
                        ? "var(--mantine-color-green-6)"
                        : "var(--mantine-color-dimmed)"
                    }
                  />
                </Center>
              </Tooltip>
            ) : (
              <Group gap="xs" wrap="nowrap">
                <CircleCheck
                  size={14}
                  aria-hidden="true"
                  color={
                    healthy
                      ? "var(--mantine-color-green-6)"
                      : "var(--mantine-color-dimmed)"
                  }
                />
                <Box>
                  <Text size="xs" fw={600}>
                    {healthy ? "网关运行正常" : "网关状态未知"}
                  </Text>
                  <Text size="10px" c="dimmed">
                    SSH MCP · v0.2.0
                  </Text>
                </Box>
              </Group>
            )}
          </Box>
        </Stack>
      </AppShell.Navbar>
      <AppShell.Main>
        <Feedback message={error} onDismiss={() => setError("")} />
        {page === "overview" ? (
          <Overview onNavigate={navigate} healthy={healthy} />
        ) : page === "servers" ? (
          <Servers />
        ) : page === "users" ? (
          <UsersPage currentUser={session.user} />
        ) : page === "tokens" ? (
          <Tokens />
        ) : (
          <Audit
            key={page}
            kind={page === "mcp-audit" ? "mcp" : "person"}
          />
        )}
      </AppShell.Main>
      <CommandPalette
        open={command}
        onOpenChange={(open) =>
          open ? commandHandlers.open() : commandHandlers.close()
        }
        onNavigate={navigate}
      />
    </AppShell>
  );
}
