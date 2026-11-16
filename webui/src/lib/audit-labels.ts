import type { AuditRecord, User } from "../types";

export const personActionLabels: Record<string, string> = {
  "user.login": "登录后台",
  "user.initialize": "初始化工作区",
  "user.logout": "退出登录",
  "user.create": "添加成员",
  "user.update": "修改成员",
  "server.create": "添加服务器",
  "server.update": "更新服务器",
  "server.delete": "删除服务器",
  "server.test": "测试连接",
  "token.create": "创建 Token",
  "token.update": "更新 Token",
  "token.delete": "删除 Token",
  "token.revoke": "吊销 Token",
  "audit.export": "导出审计",
  "key.upload": "上传密钥",
};

export function personActionLabel(action?: string | null) {
  return personActionLabels[action || ""] || "其他操作";
}

export function personSummaryLabel(record: AuditRecord) {
  if (!record.summary) return "—";
  if (record.action !== "user.update" && record.action !== "token.update")
    return record.summary;
  const labels: Record<string, string> = {
    display_name: "显示名称",
    enabled: record.object_type === "user" ? "登录状态" : "启用状态",
    name: "Token 名称",
    description: "用途说明",
    密码已更换: "密码",
  };
  const fields = record.summary.split(",").map((field) => field.trim());
  return fields.every((field) => Object.hasOwn(labels, field))
    ? `修改${fields.map((field) => labels[field]).join("、")}`
    : record.summary;
}

export function personObjectLabel(record: AuditRecord, users: User[]) {
  if (record.action === "user.login" || record.action === "user.logout")
    return "管理后台";
  switch (record.object_type) {
    case "user": {
      const user = users.find((item) => item.id === record.object_id);
      const name =
        record.object_id && record.object_id === record.actor_user_id
          ? record.username || user?.username
          : user?.username;
      return name ? `成员 · ${name}` : "成员账号";
    }
    case "token":
      return record.token_name ? `Token · ${record.token_name}` : "MCP Token";
    case "server":
      return record.object_id ? `服务器 · ${record.object_id}` : "服务器";
    case "key":
      return record.object_id
        ? `服务器密钥 · ${record.object_id}`
        : "服务器密钥";
    case "audit":
      return "审计记录";
    case "session":
      return "登录会话";
    default:
      return "其他对象";
  }
}
