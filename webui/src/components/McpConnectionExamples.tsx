import { useState } from "react";
import { Button, Flex, Input, Tabs, Typography } from "antd";
import { Copy } from "lucide-react";
import { copyText, errorText } from "../lib/utils";

type McpClient = "claude" | "codex";

export function connectionConfig(
  client: McpClient,
  serverName: string,
  token: string,
  url: string,
) {
  if (client === "codex") {
    return [
      `[mcp_servers.${JSON.stringify(serverName)}]`,
      `url = ${JSON.stringify(url)}`,
      `http_headers = { Authorization = ${JSON.stringify(`Bearer ${token}`)} }`,
    ].join("\n");
  }
  return JSON.stringify({
    mcpServers: {
      [serverName]: { type: "http", url, headers: { Authorization: `Bearer ${token}` } },
    },
  }, null, 2);
}

export function McpConnectionExamples({
  serverName,
  token = "<MCP_TOKEN>",
  url,
}: {
  serverName: string;
  token?: string;
  url: string;
}) {
  const [message, setMessage] = useState("");
  const [copying, setCopying] = useState(false);
  async function copy(value: string) {
    setMessage("");
    setCopying(true);
    try {
      await copyText(value);
      setMessage("已复制到剪贴板。");
    } catch (error) {
      setMessage(errorText(error));
    } finally {
      setCopying(false);
    }
  }
  return (
    <Flex vertical gap={8}>
      <Tabs
        defaultActiveKey="claude"
        onChange={() => setMessage("")}
        items={[
          { key: "claude" as const, label: "Claude Code", path: "项目目录的 .mcp.json（JSON）" },
          { key: "codex" as const, label: "Codex", path: "~/.codex/config.toml 或项目内 .codex/config.toml（TOML）" },
        ].map(({ key, label, path }) => {
          const config = connectionConfig(key, serverName, token, url);
          return {
            key,
            label,
            children: (
              <Flex vertical gap={12}>
                <Typography.Text type="secondary">{path}</Typography.Text>
                <Input.TextArea
                  className="mono"
                  aria-label={`${label} 接入配置`}
                  value={config}
                  readOnly
                  spellCheck={false}
                  autoSize={{ minRows: 4, maxRows: 14 }}
                />
                <Button
                  style={{ alignSelf: "start" }}
                  icon={<Copy size={15} aria-hidden="true" />}
                  loading={copying}
                  onClick={() => void copy(config)}
                >
                  复制 {label} 配置
                </Button>
              </Flex>
            ),
          };
        })}
      />
      <Typography.Text type="secondary" role="status">{message}</Typography.Text>
    </Flex>
  );
}
