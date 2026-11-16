import { Button } from "antd";
import { Github } from "lucide-react";

export function RepositoryLink({ href }: { href: string }) {
  return (
    <Button
      type="text"
      size="small"
      className="repository-link"
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="GitHub 仓库（在新标签页打开）"
      icon={<Github size={16} aria-hidden="true" />}
    >
      GitHub 仓库
    </Button>
  );
}
