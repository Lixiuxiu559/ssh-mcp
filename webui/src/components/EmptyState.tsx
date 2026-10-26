import type { ReactNode } from 'react'
import { Button, Empty } from 'antd'

/* 统一空状态：小号 outline 图标 + 标题 + 引导文案 + 可选 CTA */
export default function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  children,
}: {
  icon?: React.ComponentType<{ style?: React.CSSProperties }>
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  children?: ReactNode
}) {
  return (
    <Empty
      image={
        Icon ? (
          <Icon style={{ fontSize: 40, color: 'var(--color-text-tertiary)' }} />
        ) : (
          Empty.PRESENTED_IMAGE_SIMPLE
        )
      }
      style={{ padding: 'var(--space-10) 0' }}
      description={
        <div style={{ maxWidth: 360, margin: '0 auto' }}>
          <div style={{ fontWeight: 600, fontSize: 'var(--text-body)' }}>{title}</div>
          {description && (
            <div
              style={{
                color: 'var(--color-text-tertiary)',
                fontSize: 'var(--text-small)',
                marginTop: 'var(--space-1)',
              }}
            >
              {description}
            </div>
          )}
        </div>
      }
    >
      {action && <Button type="primary">{action}</Button>}
      {children}
    </Empty>
  )
}
