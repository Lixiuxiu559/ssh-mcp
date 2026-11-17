import { useId, useState } from "react";
import { Alert, Button, Form, Input, Space } from "antd";
import { api, json } from "../api";
import type { User } from "../console-types";
import { errorText } from "../lib/utils";
import { AppModal } from "./AppModal";
import { Feedback } from "./Feedback";
import { characterLengthRule, passwordLengthRule } from "../lib/identity";

export type AccountEditorMode = "profile" | "password";
interface AccountValues {
  display_name?: string;
  password?: string;
  confirm?: string;
}

export function AccountEditor({
  user,
  mode,
  onClose,
  onSaved,
}: {
  user: User;
  mode: AccountEditorMode;
  onClose: () => void;
  onSaved: (user: User) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const formId = useId();
  const password = mode === "password";
  async function submit(values: AccountValues) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const updated = await api<User>(
        `/api/users/${encodeURIComponent(user.id)}`,
        json(
          "PATCH",
          password
            ? { password: values.password }
            : { display_name: values.display_name || "" },
        ),
      );
      onSaved(updated);
    } catch (error) {
      setError(errorText(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <AppModal
      opened
      title={password ? "修改密码" : "个人资料"}
      size="sm"
      busy={busy}
      onClose={() => {
        if (!busy) onClose();
      }}
      footer={
        <Space>
          <Button onClick={onClose} disabled={busy}>
            取消
          </Button>
          <Button type="primary" htmlType="submit" form={formId} loading={busy}>
            {password ? "修改并重新登录" : "保存资料"}
          </Button>
        </Space>
      }
    >
      <Feedback message={error} />
      {password && (
        <Alert
          type="warning"
          showIcon
          title="修改后将结束此账号的所有网页登录，需要重新登录。"
        />
      )}
      <Form<AccountValues>
        id={formId}
        layout="vertical"
        disabled={busy}
        onFinish={submit}
        scrollToFirstError={{ focus: true }}
        initialValues={{ display_name: user.display_name }}
      >
        <Form.Item label="用户名">
          <Input value={user.username} readOnly autoComplete="username" />
        </Form.Item>
        {password ? (
          <>
            <Form.Item
              name="password"
              label="新密码"
              rules={[
                { required: true, message: "请输入新密码" },
                passwordLengthRule(),
              ]}
            >
              <Input.Password
                autoComplete="new-password"
                placeholder="至少 6 位"
              />
            </Form.Item>
            <Form.Item
              name="confirm"
              label="确认新密码"
              dependencies={["password"]}
              rules={[
                { required: true, message: "请再次输入新密码" },
                ({ getFieldValue }) => ({
                  validator(_, value) {
                    return !value || value === getFieldValue("password")
                      ? Promise.resolve()
                      : Promise.reject(new Error("两次输入的密码不一致"));
                  },
                }),
              ]}
            >
              <Input.Password
                autoComplete="new-password"
                placeholder="再次输入新密码"
              />
            </Form.Item>
          </>
        ) : (
          <Form.Item
            name="display_name"
            label="显示名称"
            rules={[characterLengthRule(128, "显示名不能超过 128 个字符")]}
          >
            <Input
              autoComplete="nickname"
              placeholder="输入显示名称"
            />
          </Form.Item>
        )}
      </Form>
    </AppModal>
  );
}
