import { Link2 } from "lucide-react";
import { ConsoleLogin, type ConsoleLoginProps } from "../components/ConsoleLogin";

type LoginProps = Pick<ConsoleLoginProps, "setup" | "notice" | "noticeType" | "onLogin">;
export default function Login(props: LoginProps) {
  return <ConsoleLogin {...props}
    brand="SSH MCP"
    subtitle="Gateway Console"
    icon={Link2}
    headline={<>让每次远程操作<br />都有清晰的来路。</>}
    description="连接你的服务器，管理服务凭证，追溯每一次调用。一个工作区，保留完整的操作上下文。"
    clientLabel="运维客户端"
    repositoryUrl="https://github.com/Lixiuxiu559/ssh-mcp"
  />;
}
