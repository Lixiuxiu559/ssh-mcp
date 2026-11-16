import type { Page } from "../types";

export const navigation: { id: Page; label: string }[] = [
  { id: "overview", label: "总览" },
  { id: "servers", label: "服务器管理" },
  { id: "tokens", label: "MCP Token" },
  { id: "users", label: "成员管理" },
  { id: "mcp-audit", label: "MCP 调用审计" },
  { id: "person-audit", label: "人员操作审计" },
];
