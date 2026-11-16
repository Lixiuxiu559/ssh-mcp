import type { ReactNode } from "react";
import { Button, Flex, Layout, Menu, Tooltip, Typography } from "antd";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { ThemeToggle } from "./theme-controls";

export interface ConsoleNavigationItem<Key extends string = string> {
  id: Key;
  label: string;
  icon?: ReactNode;
}

export interface ConsoleLayoutProps<Key extends string> {
  brand: ReactNode;
  brandIcon?: ReactNode;
  brandHref?: string;
  navigation: readonly ConsoleNavigationItem<Key>[];
  selected: Key;
  collapsed: boolean;
  onNavigate: (key: Key) => void;
  onCollapsedChange: (collapsed: boolean) => void;
  account: ReactNode;
  gateway: ReactNode;
  children: ReactNode;
}

/** 只组织控制台结构；服务提供品牌、导航、账号、网关与领域页面。 */
export function ConsoleLayout<Key extends string>({
  brand,
  brandIcon,
  brandHref = "./",
  navigation,
  selected,
  collapsed,
  onNavigate,
  onCollapsedChange,
  account,
  gateway,
  children,
}: ConsoleLayoutProps<Key>) {
  const collapseLabel = collapsed ? "展开侧边栏" : "收起侧边栏";
  return (
    <Layout className="app-layout">
      <Layout.Header className="app-header">
        <Flex align="center" gap={12}>
          <Tooltip title={collapseLabel}>
            <Button
              type="text"
              aria-label={collapseLabel}
              aria-expanded={!collapsed}
              onClick={() => onCollapsedChange(!collapsed)}
              icon={
                collapsed ? (
                  <PanelLeftOpen size={16} aria-hidden="true" />
                ) : (
                  <PanelLeftClose size={16} aria-hidden="true" />
                )
              }
            />
          </Tooltip>
          <Typography.Link href={brandHref} className="app-brand">
            {brandIcon}
            <strong>{brand}</strong>
          </Typography.Link>
        </Flex>
        <Flex gap={8} align="center">
          <ThemeToggle />
          {account}
        </Flex>
      </Layout.Header>
      <Layout className="app-workspace">
        <Layout.Sider
          theme="light"
          width={220}
          collapsedWidth={64}
          collapsed={collapsed}
          trigger={null}
          className="app-sidebar"
        >
          <Flex vertical justify="space-between" className="sidebar-inner">
            <nav aria-label="主导航">
              <Menu
                mode="inline"
                selectedKeys={[selected]}
                onClick={({ key }) => {
                  const item = navigation.find((entry) => entry.id === key);
                  if (item) onNavigate(item.id);
                }}
                items={navigation.map(({ id, label, icon }) => ({
                  key: id,
                  label,
                  icon,
                }))}
              />
            </nav>
            <div className="sidebar-footer">{gateway}</div>
          </Flex>
        </Layout.Sider>
        <Layout.Content className="app-content">
          <main>{children}</main>
        </Layout.Content>
      </Layout>
    </Layout>
  );
}
