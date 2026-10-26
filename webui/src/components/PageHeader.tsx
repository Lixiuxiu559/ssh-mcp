import type { ReactNode } from 'react'
import { Space, Typography } from 'antd'

/* 统一页头：标题 + 副标题 + 右侧动作区。所有页面共用，保证节奏一致。 */
export default function PageHeader({
  title,
  subtitle,
  extra,
  breadcrumb,
}: {
  title: ReactNode
  subtitle?: ReactNode
  extra?: ReactNode
  breadcrumb?: ReactNode
}) {
  return (
    <header style={{ marginBottom: 'var(--space-6)' }}>
      {breadcrumb && <div style={{ marginBottom: 'var(--space-2)' }}>{breadcrumb}</div>}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 'var(--space-4)',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ minWidth: 0 }}>
          <Typography.Title level={3} style={{ margin: 0, fontWeight: 650 }}>
            {title}
          </Typography.Title>
          {subtitle && (
            <Typography.Text type="secondary" style={{ fontSize: 'var(--text-small)' }}>
              {subtitle}
            </Typography.Text>
          )}
        </div>
        {extra && <Space>{extra}</Space>}
      </div>
    </header>
  )
}
