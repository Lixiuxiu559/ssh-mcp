"""面向 LLM/用户的错误类型。

全部继承 ToolError：即使 mask_error_details=True，消息也会原文透传，
因此消息里应包含"下一步建议"，且绝不能包含凭据。
"""

from fastmcp.exceptions import ToolError


class SshMcpError(ToolError):
    """ssh-mcp 工具错误基类。"""


class ServerNotFoundError(SshMcpError):
    def __init__(self, alias: str, available: list[str]):
        self.alias = alias
        self.available = available
        tips = "、".join(available) if available else "（尚未配置任何服务器）"
        super().__init__(
            f"未找到服务器 {alias!r}。可用服务器: {tips}。可先调用 list_servers 查看。"
        )


class CredentialConfigError(SshMcpError):
    """连接失败 / 认证失败 / 主机指纹校验失败。"""


class SshTimeoutError(SshMcpError):
    """连接或命令执行超时。"""


class FileTooLargeError(SshMcpError):
    """文件超出大小限制。"""


class BinaryFileError(SshMcpError):
    """文件不是 UTF-8 文本，无法按文本读取。"""
