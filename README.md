# ssh-mcp — 团队共享 SSH 网关 MCP 服务

基于 [FastMCP](https://gofastmcp.com) 的团队级 SSH 网关：服务器清单与凭据集中托管，
成员的 Claude Code / Codex 只需配置一个 URL 和个人 token，对话里直接说
「在 web-1 上执行 df -h」即可，无需再关心 IP、账户、密钥。

另提供**浏览器管理页**（token 登录）：管理员可在网页上增删改服务器配置、
一键测试连接，保存后所有成员立即可用（无需重启）。

## 功能

| MCP 工具 | 说明 |
|---|---|
| `list_servers` | 列出服务器清单（别名/主机/账户/标签/凭据类型，不含凭据） |
| `exec_command` | 执行 shell 命令，返回 stdout/stderr/exit_code，带超时 |
| `list_dir` | 浏览远端目录 |
| `read_file` | 读取 UTF-8 文本文件（上限 1MiB，二进制请用 download_file） |
| `upload_file` / `download_file` | 文件内容经参数传输（上限 10MiB），默认拒绝覆盖 |
| `server_health` | 聚合健康检查：负载/内存/磁盘/CPU 核数/运行时长 |

安全策略：**仅审计、不拦截**——每次工具调用写入 SQLite 审计库
（时间/用户/服务器/命令/路径/耗时），默认保留最近 30 天、超期自动清理，
网页上分页查看。

## 部署（网关机）

网关机需满足：能 SSH 直连所有目标服务器，安装 [uv](https://docs.astral.sh/uv/)。

```bash
cd ssh-mcp
uv sync                        # 安装依赖（自动创建虚拟环境）

cp config.example.yaml config.yaml   # 编辑服务器清单与用户 token
cp .env.example .env                 # 填写各成员 token、凭据环境变量，然后 source .env
chmod 600 config.yaml                # 配置里可能含明文凭据，收紧权限

uv run ssh-mcp -c config.yaml        # 启动，默认监听 0.0.0.0:8808
```

生产环境建议用 systemd 常驻（`Restart=always`），并给 `audit/` 目录配置轮转。

## Docker 部署

镜像已包含前端构建产物，配置 / 密钥 / 审计数据通过挂载卷持久化。

### 从镜像仓库部署（推荐）

```bash
mkdir -p /opt/ssh-mcp/keys /opt/ssh-mcp/audit
cd /opt/ssh-mcp
# 把源码仓库里的 config.example.yaml 复制成这里的 config.yaml 并编辑服务器清单；
# 首次也可留空 auth.users —— 启动后会启用内置引导账号 admin/admin
```

`/opt/ssh-mcp/docker-compose.yml`：

```yaml
services:
  ssh-mcp:
    image: docker.io/lijx559/ssh-mcp:0.1.2
    container_name: ssh-mcp
    restart: unless-stopped
    ports:
      - "8808:8808"
    # 整个目录挂载到 /data：网页改配置、上传 .pem、审计落库都写这里
    volumes:
      - /opt/ssh-mcp:/data
    # 以 uid 1000 运行（镜像内 appuser），目录属主需对齐
    user: "1000:1000"
    environment:
      TZ: Asia/Shanghai
```

```bash
chown -R 1000:1000 /opt/ssh-mcp && chmod 600 /opt/ssh-mcp/config.yaml
docker compose up -d
docker compose ps           # 确认 healthy
```

访问 `http://<网关机>:8808/`；经网关 nginx 子路径则是 `https://mcp.example.com/ssh-mcp/`（子路径统一约定见工作空间根 CLAUDE.md）。

### 本地构建（开发 / 离线场景）

```bash
cd ssh-mcp
DOCKER_UID=$(id -u) DOCKER_GID=$(id -g) docker compose up -d --build
```

### 更新到新版本

```bash
cd /opt/ssh-mcp
sed -i 's|ssh-mcp:0.1.1|ssh-mcp:0.1.2|' docker-compose.yml
docker compose up -d        # 自动 pull 新镜像并重建容器
```

配置、密钥、审计都在挂载卷里，更新容器不会丢数据。

> 自行构建并推送镜像（amd64 → ACR）的完整流程见 [`CLAUDE.md`](CLAUDE.md)。

### 常用命令

```bash
docker compose logs -f      # 看日志
docker compose restart      # 重启（数据都在挂载卷里）
docker compose down         # 停止
```

### Docker 部署要点

- **必须挂「目录」而非单个文件**。配置保存走原子写（先写 `.tmp` 再 rename），
  单文件 bind mount 会让临时文件与目标落在不同文件系统，rename 必然失败，
  所以挂载的是整个目录（如 `/opt/ssh-mcp:/data`）
- **容器内工作目录是 `/data`**，`config.yaml` 里的相对路径（`audit/audit.db`、
  `keys/`）都落在挂载卷内
- **`${ENV_VAR}` 引用的变量必须在容器环境里存在**，否则管理端保存配置会因校验
  失败而报错（这是刻意设计的 fail-fast）。在 compose 的 `environment:` 里补齐
- 容器以非 root 运行，`/healthz` 已配置为镜像 HEALTHCHECK
- 被控服务器不在容器可达网络时，用 compose 的 `extra_hosts` 或自定义 network 处理

### 配置要点

- **凭据类型**（每台服务器独立配置）：`private_key_file`（私钥文件路径）、
  `private_key_inline`（内嵌 PEM）、`password`
- **`${ENV_VAR}` 插值**：token/密码/口令建议引用环境变量；缺变量启动即报错；
  `$$` 表示字面 `$`
- **known_hosts**：不配置则跳过主机指纹校验（内网可接受，但存在中间人风险）。
  更稳妥做法：网关机上 `ssh-keyscan` 采集各服务器指纹存成文件，按台配置
- **用户与 token**：`auth.users` 中每项含 `username`、`token`、`admin`（管理员）。
  未配置任何成员时，服务会启用**内置默认管理员 `admin` / `admin`** 作为引导账号
  （启动日志有醒目提示），登录后请在管理页「成员与 Token」里改成正式成员——
  一旦配置了成员，默认账号自动失效。成员的增删改在管理页保存后**即时热生效**，
  无需重启

### 浏览器管理页

打开 `https://mcp.example.com/ssh-mcp/`（经网关 nginx 子路径；内网直连则是
`http://<网关机>:8808/`），粘贴个人 token 登录（**仅 admin 可进入**）：

- 服务器表格：新增 / 编辑 / 删除；编辑时凭据字段留空 = 保持原凭据；
  「测试连接」用表单配置建一次性 SSH 连接验证，保存前就能确认凭据正确
- 「成员与 Token」：增删成员、查看与重置 token、切换 admin 标志，保存即热生效
- 最近审计记录展示（只读）

## 成员接入

MCP 端点 URL 二选一：**经网关（推荐）** `https://mcp.example.com/ssh-mcp/mcp`，
或内网直连 `http://<网关机>:8808/mcp`。URL 写法约定见工作空间根 CLAUDE.md
「网关子路径统一约定」。

### Claude Code

项目根目录 `.mcp.json`（或 `claude mcp add` 命令）：

```json
{
  "mcpServers": {
    "ssh": {
      "type": "http",
      "url": "https://mcp.example.com/ssh-mcp/mcp",
      "headers": { "Authorization": "Bearer ${SSHMCP_TOKEN}" }
    }
  }
}
```

把个人 token 放进环境变量 `SSHMCP_TOKEN`，避免提交进 git。配置格式以
[官方文档](https://docs.claude.com/en/docs/claude-code/mcp) 为准。

### Codex

`~/.codex/config.toml`（字段名以官方文档为准）：

```toml
[mcp_servers.ssh]
url = "https://mcp.example.com/ssh-mcp/mcp"
http_headers = { "Authorization" = "Bearer <个人token>" }
```

### 使用示例

> 帮我看下 web-1 的磁盘占用情况
>
> 把这段脚本上传到 db-1 的 /tmp/backup.sh 并执行
>
> 读一下 web-1 的 /etc/nginx/nginx.conf

## 开发

```bash
uv sync
uv run pytest            # 单元测试（Fake SSH 层 + in-memory Client）
uv run ruff check .
```

## 已知边界

- 目标服务器为 Linux（健康检查解析 /proc 与 free/df 输出）
- `exec_command` 超时会中断命令；`nohup`/`setsid` 启动的进程可能继续在远端运行
- 文件操作有大小上限（见 `config.yaml` 的 `limits`）。**上传**尤其注意：内容经 MCP
  请求体传输，传输层对请求体有 4MiB 硬上限（base64 还会放大 ~4/3），因此上传上限
  默认 2MiB；更大的文件请走 scp/rsync。下载上限 10MiB（响应体不受此约束）
- 配置文件由网页保存时会重写整个 YAML（注释会丢失）；`${ENV}` 引用会原样保留
- 审计为本地 SQLite 库（默认保留 30 天，`audit.retention_days` 可调），如需防篡改请外接日志采集
