import { Badge } from 'antd'

export type ServerStatus = 'online' | 'offline' | 'updating'

const MAP: Record<ServerStatus, { color: string; label: string }> = {
  online: { color: 'var(--color-success)', label: 'Online' },
  offline: { color: 'var(--color-text-tertiary)', label: 'Offline' },
  updating: { color: 'var(--color-warning)', label: 'Updating' },
}

export default function StatusBadge({
  status,
  size = 'default',
}: {
  status: ServerStatus
  size?: 'default' | 'small'
}) {
  const { color, label } = MAP[status]
  return (
    <Badge
      status="default"
      color={color}
      text={label}
      style={{ color: 'var(--color-text-secondary)', fontSize: size === 'small' ? 12.5 : 13.5 }}
    />
  )
}
