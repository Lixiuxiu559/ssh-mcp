import { useState, type ReactNode } from "react";
import { ArrowRight, LockKeyhole, Terminal, type LucideIcon } from "lucide-react";
import {
  Alert,
  Button,
  Card,
  Col,
  Flex,
  Form,
  Input,
  Row,
  Tag,
  Typography,
} from "antd";
import { api, json, setCsrfToken } from "../api";
import type { Session } from "../console-types";
import { ThemeControl } from "../components/theme-controls";
import { RepositoryLink } from "../components/RepositoryLink";
import { errorText } from "../lib/utils";

interface LoginValues {
  username: string;
  password: string;
  confirm?: string;
  setup_key?: string;
}

export interface ConsoleLoginProps {
  setup: boolean;
  notice?: string;
  noticeType?: "success" | "warning";
  onLogin: (session: Session) => void;
  brand: string;
  subtitle: string;
  icon: LucideIcon;
  headline: ReactNode;
  description: string;
  repositoryUrl: string;
  clientLabel?: string;
}

export function ConsoleLogin({
  setup, notice, noticeType = "warning", onLogin,
  brand, subtitle, icon: Icon, headline, description, repositoryUrl,
  clientLabel = "MCP 客户端",
}: ConsoleLoginProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(values: LoginValues) {
    if (busy) return;
    setError("");
    setBusy(true);
    try {
      const result = await api<Session>(
        `/api/auth/${setup ? "setup" : "login"}`,
        json("POST", {
          username: values.username,
          password: values.password,
          ...(setup ? { setup_key: values.setup_key } : {}),
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
    <Flex vertical className="login-page">
      <Flex justify="space-between" align="center" className="login-header">
        <Flex align="center" gap={8}>
          <Icon size={20} aria-hidden="true" />
          <Typography.Text strong>{brand}</Typography.Text>
          <Typography.Text type="secondary">{subtitle}</Typography.Text>
        </Flex>
        <ThemeControl />
      </Flex>
      <Flex align="center" justify="center" className="login-content">
        <Row align="middle" gutter={48} className="login-columns">
          <Col span={14}>
            <Flex vertical gap={16} className="login-introduction">
              <Typography.Text type="secondary" className="login-eyebrow">
                MCP CONNECTION WORKSPACE
              </Typography.Text>
              <Typography.Title
                level={1}
                className="login-headline"
                style={{ margin: 0 }}
              >
                {headline}
              </Typography.Title>
              <Typography.Paragraph
                type="secondary"
                className="login-description"
              >
                {description}
              </Typography.Paragraph>
              <Flex align="center" gap={12}>
                <Tag
                  icon={<Terminal size={15} aria-hidden="true" />}
                  className="login-connection"
                  variant="outlined"
                >
                  {clientLabel}
                </Tag>
                <ArrowRight size={16} aria-hidden="true" />
                <Tag
                  icon={<Icon size={15} aria-hidden="true" />}
                  className="login-connection"
                  variant="outlined"
                >
                  {brand}
                </Tag>
              </Flex>
              <Flex align="center" gap={8} className="login-identity">
                <LockKeyhole size={16} aria-hidden="true" />
                <Typography.Text type="secondary">
                  人员使用账号密码登录。MCP token 在工作区内独立管理。
                </Typography.Text>
              </Flex>
            </Flex>
          </Col>
          <Col span={10}>
            <Card className="login-card">
              <Flex vertical gap={4} className="login-card-heading">
                <Typography.Text type="secondary" className="login-eyebrow">
                  {setup ? "FIRST-TIME SETUP" : "WELCOME BACK"}
                </Typography.Text>
                <Typography.Title level={2} style={{ margin: 0 }}>
                  {setup ? "建立第一个用户" : "登录工作区"}
                </Typography.Title>
                <Typography.Text type="secondary">
                  {setup
                    ? "使用服务端初始化密钥创建账号，原有 MCP token 会继续保留。"
                    : "使用你的用户名与密码继续。"}
                </Typography.Text>
              </Flex>
              {(error || notice) && (
                <Alert
                  type={error ? "error" : noticeType}
                  showIcon
                  title={error || notice}
                  style={{ marginBottom: 16 }}
                  role="alert"
                />
              )}
              <Form<LoginValues>
                className="login-form"
                layout="vertical"
                onFinish={submit}
                disabled={busy}
                autoComplete="on"
              >
                {setup && (
                  <Form.Item
                    name="setup_key"
                    label="初始化密钥"
                    extra="从服务启动日志提示的 setup.key 文件读取。"
                    rules={[{ required: true, message: "请输入初始化密钥" }]}
                  >
                    <Input.Password
                      autoComplete="off"
                      placeholder="服务端一次性初始化密钥"
                    />
                  </Form.Item>
                )}
                <Form.Item
                  name="username"
                  label="用户名"
                  rules={[{ required: true, message: "请输入用户名" }]}
                >
                  <Input
                    autoComplete="username"
                    maxLength={64}
                    placeholder="输入用户名"
                  />
                </Form.Item>
                <Form.Item
                  name="password"
                  label="密码"
                  rules={[
                    { required: true, message: "请输入密码" },
                    ...(setup
                      ? [{ min: 10, message: "密码至少需要 10 位" }]
                      : []),
                  ]}
                >
                  <Input.Password
                    autoComplete={setup ? "new-password" : "current-password"}
                    maxLength={1024}
                    placeholder={setup ? "至少 10 位" : "输入密码"}
                  />
                </Form.Item>
                {setup && (
                  <Form.Item
                    name="confirm"
                    label="确认密码"
                    dependencies={["password"]}
                    rules={[
                      { required: true, message: "请再次输入密码" },
                      ({ getFieldValue }) => ({
                        validator(_, value) {
                          return !value || getFieldValue("password") === value
                            ? Promise.resolve()
                            : Promise.reject(new Error("两次输入的密码不一致"));
                        },
                      }),
                    ]}
                  >
                    <Input.Password
                      autoComplete="new-password"
                      placeholder="再次输入密码"
                    />
                  </Form.Item>
                )}
                <Button
                  block
                  type="primary"
                  htmlType="submit"
                  size="large"
                  loading={busy}
                  icon={<ArrowRight size={16} aria-hidden="true" />}
                  iconPlacement="end"
                >
                  {setup ? "创建用户并进入" : "登录"}
                </Button>
              </Form>
              <Typography.Paragraph type="secondary" className="login-note">
                {setup
                  ? "初始化完成后此入口将关闭，所有启用人员具有相同管理能力。"
                  : "登录状态仅用于管理后台，不作为 MCP 调用凭证。"}
              </Typography.Paragraph>
            </Card>
          </Col>
        </Row>
      </Flex>
      <Flex justify="center" align="center" gap={16} className="login-footer">
        <Typography.Text type="secondary">
          {brand} {subtitle}
        </Typography.Text>
        <RepositoryLink href={repositoryUrl} />
      </Flex>
    </Flex>
  );
}
