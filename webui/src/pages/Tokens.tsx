import TokensPage from "../features/TokensPage";

export default function Tokens({ onManageWorkspaces }: { onManageWorkspaces: () => void }) {
  return (
    <TokensPage
      onManageWorkspaces={onManageWorkspaces}
      clientName="ssh"
      exampleUrl="https://ssh.example.com/mcp"
      descriptionPlaceholder="例如：持续集成部署"
    />
  );
}
