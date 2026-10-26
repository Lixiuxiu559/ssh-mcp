"""本机真实 asyncssh 协议回归，不访问实际运维服务器。"""

import asyncssh
import yaml
from fastmcp import Client

from ssh_mcp.config import ConfigFile
from ssh_mcp.server import create_mcp


class LocalServer(asyncssh.SSHServer):
    def begin_auth(self, username):
        return True

    def password_auth_supported(self):
        return True

    def validate_password(self, username, password):
        return username == "integration" and password == "local-test-credential"


async def test_real_ssh_command_and_target_audit(tmp_path):
    async def process(session):
        assert session.command == "printf integration"
        session.stdout.write("integration-ok\n")
        session.exit(0)

    listener = await asyncssh.listen(
        "127.0.0.1",
        0,
        server_factory=LocalServer,
        server_host_keys=[asyncssh.generate_private_key("ssh-ed25519")],
        process_factory=process,
    )
    try:
        config = tmp_path / "config.yaml"
        config.write_text(
            yaml.safe_dump(
                {
                    "servers": [
                        {
                            "alias": "loopback",
                            "host": "127.0.0.1",
                            "port": listener.get_port(),
                            "username": "integration",
                            "credential": {"type": "password", "password": "local-test-credential"},
                        }
                    ],
                }
            )
        )
        mcp, state = create_mcp(ConfigFile(config))
        async with Client(mcp) as client:
            result = await client.call_tool(
                "exec_command", {"server": "loopback", "command": "printf integration"}
            )
            assert result.data.stdout == "integration-ok\n"
            assert result.data.exit_code == 0
            records, total = state.audit.query(server="loopback")
            assert total == 1
            assert records[0]["target_host"] == "127.0.0.1"
            assert records[0]["target_port"] == listener.get_port()
            assert records[0]["target_username"] == "integration"
            assert records[0]["status"] == "ok"
            assert "local-test-credential" not in str(records)
    finally:
        listener.close()
        await listener.wait_closed()
