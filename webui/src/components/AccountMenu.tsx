import { useState } from "react";
import { App, Avatar, Button, Dropdown, Flex, Typography } from "antd";
import { KeyRound, LogOut, UserRound } from "lucide-react";
import type { User } from "../console-types";
import { AccountEditor, type AccountEditorMode } from "./AccountEditor";

export function AccountMenu({
  user,
  onUserUpdated,
  onPasswordChanged,
  onLogout,
}: {
  user: User;
  onUserUpdated: (user: User) => void;
  onPasswordChanged: () => void;
  onLogout: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [editor, setEditor] = useState<AccountEditorMode | null>(null);
  const { message } = App.useApp();
  const name = user.display_name || user.username;

  return (
    <>
      <Dropdown
        trigger={["click"]}
        placement="bottomRight"
        open={open}
        onOpenChange={setOpen}
        styles={{
          root: { width: 248 },
          menu: { boxShadow: "none", background: "transparent" },
        }}
        popupRender={(menu) => (
          <div className="account-menu-panel">
            <Flex align="center" gap={12} className="account-menu-header">
              <Avatar
                size={36}
                icon={<UserRound size={18} aria-hidden="true" />}
              />
              <Flex vertical style={{ minWidth: 0, flex: 1 }}>
                <Typography.Text strong ellipsis title={name}>
                  {name}
                </Typography.Text>
                {name !== user.username && (
                  <Typography.Text
                    type="secondary"
                    ellipsis
                    title={user.username}
                  >
                    {user.username}
                  </Typography.Text>
                )}
              </Flex>
            </Flex>
            {menu}
          </div>
        )}
        menu={{
          onClick: () => setOpen(false),
          items: [
            {
              key: "profile",
              icon: <UserRound size={16} aria-hidden="true" />,
              label: "个人资料",
              onClick: () => setEditor("profile"),
            },
            {
              key: "password",
              icon: <KeyRound size={16} aria-hidden="true" />,
              label: "修改密码",
              onClick: () => setEditor("password"),
            },
            { type: "divider" },
            {
              key: "logout",
              danger: true,
              icon: <LogOut size={16} aria-hidden="true" />,
              label: "退出登录",
              onClick: () => void onLogout(),
            },
          ],
        }}
      >
        <Button
          shape="circle"
          aria-label="账号菜单"
          aria-haspopup="menu"
          aria-expanded={open}
          icon={<UserRound size={16} aria-hidden="true" />}
        />
      </Dropdown>
      {editor && (
        <AccountEditor
          key={editor}
          user={user}
          mode={editor}
          onClose={() => setEditor(null)}
          onSaved={(updated) => {
            setEditor(null);
            if (editor === "password") onPasswordChanged();
            else {
              onUserUpdated(updated);
              void message.success("个人资料已更新。");
            }
          }}
        />
      )}
    </>
  );
}
