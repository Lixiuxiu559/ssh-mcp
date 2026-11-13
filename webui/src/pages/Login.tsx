import { useState, type FormEvent } from "react";
import {
  AlertCircle,
  ArrowRight,
  Link2,
  LockKeyhole,
  Terminal,
} from "lucide-react";
import {
  Alert,
  Box,
  Button,
  Grid,
  Group,
  Paper,
  PasswordInput,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { api, json, setCsrfToken } from "../api";
import type { Session } from "../types";
import { ThemeControl } from "../components/theme-controls";
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
    <Stack mih="100vh" justify="space-between" gap={0}>
      <Group justify="space-between" align="center" px="xl" py="md">
        <Group gap="xs">
          <Link2 size={20} aria-hidden="true" />
          <Text fw={700}>SSH MCP</Text>
          <Text c="dimmed" size="sm">
            Gateway Console
          </Text>
        </Group>
        <ThemeControl />
      </Group>
      <Box
        px="xl"
        pb="xl"
        style={{ flex: 1, display: "flex", alignItems: "center" }}
      >
        <Grid gap={48} align="center" maw={1040} mx="auto" w="100%">
          <Grid.Col span={{ base: 12, md: 7 }}>
            <Stack gap="md">
              <Text
                size="xs"
                fw={700}
                c="dimmed"
                tt="uppercase"
                style={{ letterSpacing: 1 }}
              >
                MCP CONNECTION WORKSPACE
              </Text>
              <Title order={1} fz={28} lh={1.3}>
                让每次远程操作
                <br />
                都有清晰的来路。
              </Title>
              <Text c="dimmed" maw={420}>
                连接你的服务器，管理服务凭证，追溯每一次调用。一个工作区，保留完整的操作上下文。
              </Text>
              <Group gap="sm">
                <Paper
                  withBorder
                  radius="xl"
                  px="sm"
                  py={6}
                  display="inline-flex"
                >
                  <Group gap={6} wrap="nowrap">
                    <Terminal size={15} aria-hidden="true" />
                    <Text size="sm">运维客户端</Text>
                  </Group>
                </Paper>
                <ArrowRight size={16} aria-hidden="true" />
                <Paper
                  withBorder
                  radius="xl"
                  px="sm"
                  py={6}
                  display="inline-flex"
                >
                  <Group gap={6} wrap="nowrap">
                    <Link2 size={15} aria-hidden="true" />
                    <Text size="sm">SSH MCP</Text>
                  </Group>
                </Paper>
              </Group>
              <Group gap="xs" c="dimmed" wrap="nowrap">
                <LockKeyhole size={16} aria-hidden="true" />
                <Text size="sm">
                  人员使用账号密码登录。MCP token 在工作区内独立管理。
                </Text>
              </Group>
            </Stack>
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 5 }}>
            <Paper withBorder p="xl" radius="lg" shadow="sm">
              <Stack gap={4} mb="lg">
                <Text size="xs" fw={700} c="dimmed" tt="uppercase">
                  {setup ? "FIRST-TIME SETUP" : "WELCOME BACK"}
                </Text>
                <Title order={2}>{setup ? "建立第一个用户" : "登录工作区"}</Title>
                <Text size="sm" c="dimmed">
                  {setup
                    ? "使用服务端初始化密钥创建账号，原有 MCP token 会继续保留。"
                    : "使用你的用户名与密码继续。"}
                </Text>
              </Stack>
              <form onSubmit={submit}>
                <Stack gap="md">
                  {(error || notice) && (
                    <Alert
                      color="red"
                      variant="light"
                      icon={<AlertCircle size={16} aria-hidden="true" />}
                      role="alert"
                    >
                      {error || notice}
                    </Alert>
                  )}
                  {setup && (
                    <PasswordInput
                      label="初始化密钥"
                      description="从服务启动日志提示的 setup.key 文件读取。"
                      value={setupKey}
                      onChange={(event) => setSetupKey(event.currentTarget.value)}
                      autoComplete="off"
                      required
                      placeholder="服务端一次性初始化密钥"
                    />
                  )}
                  <TextInput
                    label="用户名"
                    value={username}
                    onChange={(event) => setUsername(event.currentTarget.value)}
                    autoComplete="username"
                    required
                    maxLength={64}
                    placeholder="输入用户名"
                  />
                  <PasswordInput
                    label="密码"
                    description={
                      setup ? "至少 10 位，请使用独立的登录密码。" : undefined
                    }
                    value={password}
                    onChange={(event) => setPassword(event.currentTarget.value)}
                    autoComplete={setup ? "new-password" : "current-password"}
                    minLength={setup ? 10 : undefined}
                    maxLength={1024}
                    required
                    placeholder="输入密码"
                  />
                  {setup && (
                    <PasswordInput
                      label="确认密码"
                      value={confirm}
                      onChange={(event) => setConfirm(event.currentTarget.value)}
                      autoComplete="new-password"
                      required
                      placeholder="再次输入密码"
                    />
                  )}
                  <Button
                    type="submit"
                    size="md"
                    loading={busy}
                    rightSection={
                      busy ? undefined : (
                        <ArrowRight size={16} aria-hidden="true" />
                      )
                    }
                  >
                    {busy
                      ? "正在处理…"
                      : setup
                        ? "创建用户并进入"
                        : "登录"}
                  </Button>
                </Stack>
              </form>
              <Text size="xs" c="dimmed" mt="lg">
                {setup
                  ? "初始化完成后此入口将关闭，所有启用人员具有相同管理能力。"
                  : "登录状态仅用于管理后台，不作为 MCP 调用凭证。"}
              </Text>
            </Paper>
          </Grid.Col>
        </Grid>
      </Box>
      <Group justify="center" py="md" gap={4}>
        <Text size="xs" c="dimmed">
          SSH MCP
        </Text>
        <Text size="xs" c="dimmed">
          Gateway Console
        </Text>
      </Group>
    </Stack>
  );
}
