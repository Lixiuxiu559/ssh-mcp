import { Button, Tooltip } from "antd";
import { Github } from "lucide-react";

export function RepositoryLink({ iconOnly = false }: { iconOnly?: boolean }) {
  const link = (
    <Button
      type="text"
      size="small"
      className="repository-link"
      href="https://github.com/Lixiuxiu559/ssh-mcp"
      target="_blank"
      rel="noopener noreferrer"
      aria-label="GitHub 仓库（在新标签页打开）"
      icon={<Github size={16} aria-hidden="true" />}
    >
      {iconOnly ? undefined : "GitHub 仓库"}
    </Button>
  );
  return iconOnly ? <Tooltip title="GitHub 仓库">{link}</Tooltip> : link;
}
