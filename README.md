<div align="center">

# SSH MCP

**把服务器连接、AI 工具调用与操作追溯放在一个工作台。**

[![Docker Hub](https://img.shields.io/badge/Docker_Hub-0.2.0-146ED0?logo=docker&logoColor=white)](https://hub.docker.com/r/lijx559/ssh-mcp)
[![Platforms](https://img.shields.io/badge/platforms-amd64%20%7C%20arm64-4B5FC4)](docs/releases/2026-10-30-dockerhub.md)
[![FastMCP](https://img.shields.io/badge/FastMCP-4.1.4-17242B)](https://gofastmcp.com)

**简体中文** · [English](README.en.md)

[产品能力](#features) · [Docker Compose 部署](#deploy) · [MCP 接入](#connect) · [运维](#operations)

</div>

面向个人与团队的自托管 SSH 网关。集中管理 Linux 服务器与凭据，让 MCP 客户端通过统一入口执行命令、处理文件和检查主机状态。

![SSH MCP 工作台演示](docs/images/workspace.png)

<sub>截图来自独立演示环境，不包含真实生产资源或凭据。</sub>

<a id="features"></a>

## 产品能力

| 能力 | 你可以做什么 |
|---|---|
| 服务器管理 | 按别名维护主机、端口、账号、标签与凭据，网页修改后热生效。 |
| 远程操作 | 7 个 MCP 工具覆盖命令执行、目录浏览、文本读取、文件传输与健康检查。 |
| 独立凭证 | 网页用户名/密码登录，MCP token 单独创建、启停与吊销。 |
| 双审计 | 分别追踪人员配置操作与 token 对实际 SSH 目标的调用，默认保留 30 天。 |
| 统一工作台 | Linkage 界面、浅色/深色/自动主题、命令面板与窄屏布局。 |

<a id="deploy"></a>

## Docker Compose 部署

需要 Docker Engine（或 Docker Desktop）与 Docker Compose v2。无需克隆源码，镜像已包含完整管理页面。部署机器需要能访问目标 SSH 服务器。

### 1. 准备部署目录

以下命令适用于 Linux/macOS 普通用户。`.env` 会保存端口、镜像和运行 UID/GID；后续重启继续使用相同配置。

```bash
mkdir -p ssh-mcp/runtime
cd ssh-mcp
umask 077
cat > .env <<EOF
COMPOSE_PROJECT_NAME=ssh-mcp
DOCKER_UID=$(id -u)
DOCKER_GID=$(id -g)
SSHMCP_IMAGE=lijx559/ssh-mcp:0.2.0
SSHMCP_BIND_ADDRESS=127.0.0.1
SSHMCP_PORT=8808
TZ=Asia/Shanghai
EOF
```

若以 root 部署，在 `.env` 中把 `DOCKER_UID` / `DOCKER_GID` 设为专用非 root 账号的 UID/GID，并将 `runtime/` 属主调整为相同值，例如 `chown -R 1000:1000 runtime`。镜像默认使用 UID/GID `1000:1000`。

### 2. 保存 `docker-compose.yml`

```yaml
name: ssh-mcp
services:
  ssh-mcp:
    image: ${SSHMCP_IMAGE:-lijx559/ssh-mcp:0.2.0}
    restart: unless-stopped
    user: "${DOCKER_UID:-1000}:${DOCKER_GID:-1000}"
    ports:
      - "${SSHMCP_BIND_ADDRESS:-127.0.0.1}:${SSHMCP_PORT:-8808}:8808"
    volumes:
      - ./runtime:/data
    env_file:
      - .env
    environment:
      TZ: ${TZ:-Asia/Shanghai}
    stop_grace_period: 20s
```

固定版本与 `latest` 均支持 **`linux/amd64` / `linux/arm64`**，Docker 自动选择架构。建议部署使用固定版本。也可直接下载本仓库的 [docker-compose.yml](docker-compose.yml) 与 [.env.example](.env.example)。

### 3. 初始化并启动

```bash
docker compose pull
docker compose run --rm ssh-mcp ssh-mcp --init --config /data/config.yaml
docker compose up -d
docker compose ps
curl -fsS http://127.0.0.1:8808/healthz
```

`--init` 仅首次创建空配置，不覆盖已有文件；已有部署升级时跳过初始化命令。健康接口返回 `{"ok":true}` 后，打开 **http://127.0.0.1:8808/**。

### 4. 创建首位用户

```bash
docker compose exec ssh-mcp cat /data/data/setup.key
```

把一次性初始化码填入页面，设置用户名与独立密码。初始化完成后该文件自动删除，没有默认登录账号。

在「服务器」中添加目标主机与凭据，再到「MCP Token」创建客户端专用 token。私钥与 `known_hosts` 可放在 `runtime/keys/`，配置中使用 `keys/...` 相对路径。

### Compose 配置说明

| 配置 | 默认值 | 说明 |
|---|---|---|
| `COMPOSE_PROJECT_NAME` | `ssh-mcp` | 同机多套部署使用不同项目名、宿主端口与运行目录。 |
| `SSHMCP_IMAGE` | `lijx559/ssh-mcp:0.2.0` | 固定镜像版本，升级时显式修改。 |
| `SSHMCP_BIND_ADDRESS` | `127.0.0.1` | 默认仅本机可访问；需要局域网直连时改为 `0.0.0.0`。 |
| `SSHMCP_PORT` | `8808` | 宿主端口；容器内端口仍为 `8808`。 |
| `DOCKER_UID` / `DOCKER_GID` | `1000` / `1000` | 必须对 `runtime/` 有读写权限。 |
| `./runtime:/data` | 目录挂载 | 同时持久化配置、身份、token 与审计，不能改为仅挂载单个配置文件。 |
| `env_file: .env` | `.env` | 将资源凭据注入容器；`.env` 同时参与 Compose 变量替换。 |
| `TZ` | `Asia/Shanghai` | 容器时区；审计时间以 UTC 存储。 |

配置样例见 [config.example.yaml](config.example.yaml)。实际配置为 `runtime/config.yaml`；配置中的相对路径以配置文件目录为基准。`${VARIABLE}` 从**容器环境**读取，缺少变量会报错；凭据可添加到 `.env`，不要把网页密码或 MCP token 写进该文件。网页保存配置保留环境变量引用，但会丢失 YAML 注释。

容器中的 `127.0.0.1` 指向容器自身。目标服务运行在宿主机时，Docker Desktop 可使用 `host.docker.internal`；Linux 可按环境添加 `extra_hosts: ["host.docker.internal:host-gateway"]`。连接远端资源时填写容器可达的地址。

<a id="connect"></a>

## MCP 接入

在工作台创建并保存 MCP token，然后为支持 HTTP 的客户端添加配置：

```json
{
  "mcpServers": {
    "ssh-mcp": {
      "type": "http",
      "url": "http://127.0.0.1:8808/mcp",
      "headers": {"Authorization": "Bearer <MCP_TOKEN>"}
    }
  }
}
```

上例适用于客户端和服务在同一台机器。远程接入请把 URL 换成网关的实际 HTTPS 地址；已有网关的用户无需再启动一份服务。使用 token 后可先调用 `list_servers` 获取资源名称。

| 工具 | 用途 |
|---|---|
| `list_servers` / `server_health` | 列出服务器、检查主机状态。 |
| `exec_command` | 执行远程命令，支持超时与输出截断。 |
| `list_dir` / `read_file` | 浏览目录、读取 UTF-8 文本。 |
| `upload_file` / `download_file` | 有大小上限的文件传输。 |

默认上限：上传 2 MiB、下载 10 MiB、文本读取 1 MiB、命令 stdout/stderr 各 64 KiB。SSH 实际权限由远端账号决定；未配置 `known_hosts` 时不校验主机指纹，需要校验时挂载相应文件。命令超时不保证结束 `nohup`/`setsid` 子进程，网络重试也不保证远端操作仅发生一次。

## 人员、凭证与审计

- 网页使用用户名/密码、HttpOnly Cookie 会话与 CSRF 校验；所有启用人员同权。
- MCP token 与人员账号独立：新 token 只展示一次明文，后续只显示元数据；仅用于 `/mcp`，不能登录网页。
- 重启、升级或重建容器保留有效 token；创建新 token、停用创建者不会自动吊销旧 token。密码修改或人员停用会撤销该人员会话。
- 人员审计记录登录与配置变更；MCP 审计记录 token、实际主机/端口/远端账号及命令或路径、结果和耗时。默认保留 30 天，可筛选、查看详情与导出 CSV。
- 审计不保存凭据或完整文件正文。命令可能包含业务数据，已识别凭据脱敏不能识别任意业务秘密。SQLite 审计不提供防篡改或跨系统事务保证。

<a id="operations"></a>

## 运维与升级

### 持久化位置

| 宿主路径 | 内容 |
|---|---|
| `runtime/config.yaml` | 服务与资源配置。 |
| `runtime/data/service.db` | 人员、会话与 token 验证值。 |
| `runtime/audit/audit.db` | 人员操作与 MCP 调用审计。 |
| `runtime/data/setup.key` | 仅首次初始化期间存在。 |
| `runtime/keys/` | 上传的私钥、known_hosts 等 SSH 文件。 |

这些文件与 `.env`、`backups/` 均不应提交到 Git；升级或更换容器时保留整个 `runtime/`。

```bash
docker compose logs -f --tail=100
docker compose restart
docker compose down
```

`down` 停止并移除容器，不删除宿主 `runtime/`。停止服务会中断在途调用。

### 备份与更新

先停止服务再备份完整目录，包含 SQLite 的 WAL/SHM 文件；也可使用可靠的 SQLite 在线备份方式。

```bash
mkdir -p backups
docker compose stop
(umask 077; tar -czf "backups/runtime-$(date +%Y%m%d-%H%M%S).tar.gz" runtime .env docker-compose.yml)
docker compose start
```

修改 `.env` 中的 `SSHMCP_IMAGE` 为已发布的新版本后执行：

```bash
docker compose pull
docker compose up -d
docker compose ps
```

从 0.1.x 升级时，显式配置的旧 `auth.users` token 会幂等迁移并继续用于 MCP；网页登录改用独立账号。旧审计标为 legacy，不推测缺失的 token 归属。先在备份副本演练迁移。回滚需要匹配的镜像、配置与数据备份，不要删除身份库或重建 token 来处理登录问题。

### HTTPS 与反向代理

默认端口只绑定本机，适合放在 HTTPS 反向代理后。子路径部署示例：

```nginx
location /ssh-mcp/ {
    proxy_pass http://127.0.0.1:8808/;
    proxy_http_version 1.1;
    proxy_buffering off;
    proxy_read_timeout 600s;
}
```

在 `runtime/config.yaml` 中设置 `auth.cookie_secure: true`、`auth.cookie_path: /ssh-mcp/`，重启服务后使用 `https://mcp.example.com/ssh-mcp/` 与对应的 `.../ssh-mcp/mcp`。`proxy_pass` 尾斜杠会剥除前缀；页面资源和 API 使用相对路径。

### 常见问题

| 现象 | 处理 |
|---|---|
| 无法写配置或 SQLite | 检查 `.env` 中 UID/GID 与 `runtime/` 属主；保持整个目录可写。 |
| 远程浏览器无法打开页面 | 默认仅本机监听；使用 HTTPS 反代、SSH 隧道，或显式修改绑定地址。 |
| 网页登录后 MCP 仍认证失败 | 网页账号与 MCP token 分开管理，在 MCP Token 页面创建专用凭证。 |
| 容器连不上资源 | 检查容器网络、目标地址与防火墙，避免误用容器自己的 `127.0.0.1`。 |
| 提示初始化码文件不存在 | 首位用户创建后文件会删除，使用已有用户名/密码登录。 |

## 其他启动方式

三种方式都提供完整 HTTP MCP 服务与管理界面。

<details>
<summary>源码 + uv</summary>

Python 3.10+ 与 uv；完整兼容性以锁文件与实际运行环境为准。

```bash
uv sync --locked
uv run --locked ssh-mcp --init --config ./runtime/config.yaml
uv run --locked ssh-mcp --config ./runtime/config.yaml
```

CLI 支持 `--host`、`--port`、`--config`、`--data-dir`。`--data-dir` 相对启动目录解析，只覆盖路径，不自动移动已有数据。

</details>

<details>
<summary>Python 包 / uvx</summary>

```bash
uv build
uvx --from ./dist/ssh_mcp-0.2.0-py3-none-any.whl ssh-mcp --init --config /absolute/path/ssh-mcp/config.yaml
uvx --from ./dist/ssh_mcp-0.2.0-py3-none-any.whl ssh-mcp --config /absolute/path/ssh-mcp/config.yaml
```

wheel/sdist 包含默认配置和管理页面；也可 `uv tool install` 安装本地 wheel。当前只发布了 Docker 镜像，未宣称 PyPI 包或 GitHub Release 已发布。uvx 不读取源码的 `uv.lock`；生产完整复现优先使用固定镜像或源码锁文件。运行数据放在安装缓存以外的可写目录。

</details>

<a id="development"></a>

## 开发与项目

```bash
uv sync --locked
uv run --locked pytest
uv run --locked ruff check src tests
cd webui
npm ci
npm run build
```

前端改动后必须重建静态产物。需要本地构建容器时，在仓库根目录执行：

```bash
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
```

[开发约定](CLAUDE.md) · [发布摘要](docs/releases/2026-10-30-dockerhub.md) · [反馈问题](https://github.com/Lixiuxiu559/ssh-mcp/issues)

本服务独立开发、发布和部署，与 [MCP 工作空间](https://github.com/Lixiuxiu559/mcp) 共享统一规范，运行时不依赖父目录或其他 MCP 仓库。
