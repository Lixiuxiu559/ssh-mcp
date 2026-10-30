# ssh-mcp — SSH 链路工作台

基于 Python FastMCP 的团队 SSH 网关：集中托管 Linux 服务器连接与凭据，为 MCP 客户端提供命令执行、文件操作和健康检查。
0.2.0 将网页账号、MCP token 与操作审计分离，管理端采用 Linkage「链路工作台」设计。

## 账号、token 与首次登录

- 网页使用用户名与密码登录，所有启用用户同权，不区分管理员与普通人员。
- MCP token 在独立页面创建、命名、启停和吊销，只用于 `/mcp`，不能用它登录网页。
- 新 token 仅创建时展示一次明文；后续只能查看名称、ID、状态与脱敏前缀。请在创建后保存客户端配置。
- 网页使用 HttpOnly 会话 Cookie 和 CSRF 校验，密码修改或账号停用会撤销该账号会话。
- 首次启动没有默认账号。终端会提示一次性初始化码文件路径；在本机读取该文件，在页面中输入初始化码、用户名和独立密码。
- token 持久化在身份数据库中，重启或升级不自动失效；创建新 token 不会吊销旧 token。当前不设置自动到期；只有显式停用或吊销才拒绝调用。

## 本地源码启动

需要 Python 3.10+、uv。完整依赖兼容性以本服务锁文件与实际验证环境为准。

```bash
uv sync --locked
uv run --locked ssh-mcp --init --config ./runtime/config.yaml
uv run --locked ssh-mcp --config ./runtime/config.yaml
```

打开 `http://127.0.0.1:8808/`，按启动提示读取本地初始化码完成首位用户设置，再添加服务器和独立 MCP token。
`--init` 不覆盖已有配置。可直接复制 `config.example.yaml`，其中没有默认真实资源或凭据。

可选参数：`--host`、`--port`、`--data-dir`。后者覆盖身份与审计目录；不自动移动已有数据。
配置文件中的相对运行路径以配置所在目录解析；CLI 的 `--data-dir` 相对当前工作目录解析。

## Docker / Compose

公开镜像：[lijx559/ssh-mcp](https://hub.docker.com/r/lijx559/ssh-mcp)，固定版本 `0.2.0` 和 `latest` 均支持 `linux/amd64` / `linux/arm64`，拉取时自动选择架构。
Compose 默认拉取 `lijx559/ssh-mcp:0.2.0`，只向宿主回环地址暴露 8808。

```bash
mkdir -p runtime
# Linux 部署时确保目录由容器 UID/GID 可写；本地可指定宿主 UID/GID。
export DOCKER_UID=$(id -u)
export DOCKER_GID=$(id -g)
docker compose pull
# 仅首次部署初始化；已有配置升级时跳过此行
docker compose run --rm ssh-mcp ssh-mcp --init --config /data/config.yaml
docker compose up -d
docker compose ps
docker compose logs -f
```

Compose 将 `runtime/` 整体挂载到 `/data`。配置的原子写回要求挂目录；身份数据库、审计与上传密钥也在持久化目录中。
容器内监听 `0.0.0.0`，以非 root 用户运行并检查 `/healthz`。
`build: .` 保留为源码构建选项；本地改动使用 `docker compose up -d --build`。正式部署优先使用已发布的固定版本。

```bash
# 停止；默认不删除持久化的 runtime 目录
docker compose down
# 更新版本前备份 runtime，更新 image 标签后启动；本地源码更新则重新构建
docker compose up -d --build
```

## Python 包安装与 uvx

无需 Node.js，wheel/sdist 均包含已构建的管理界面、默认配置与 CLI。先通过 `uv build` 构建版本化发行产物：

```bash
uv build
uv tool install ./dist/ssh_mcp-0.2.0-py3-none-any.whl
ssh-mcp --init --config /absolute/path/ssh-mcp/config.yaml
ssh-mcp --config /absolute/path/ssh-mcp/config.yaml
```

从发行产物隔离运行：

```bash
uvx --from ./dist/ssh_mcp-0.2.0-py3-none-any.whl ssh-mcp --init --config /absolute/path/ssh-mcp/config.yaml
uvx --from ./dist/ssh_mcp-0.2.0-py3-none-any.whl ssh-mcp --config /absolute/path/ssh-mcp/config.yaml
```

发布后，使用者可把本地 wheel 路径替换为服务实际 Release 的版本化 wheel 下载地址，或配置团队包索引后使用 `ssh-mcp==0.2.0`。
目前不宣称该版本已发布到 PyPI 或 GitHub Release；发行地址由正式发布任务提供。
uvx 不读取源码仓库的 `uv.lock`；FastMCP 精确固定为 4.1.4，其余依赖按包约束解析，生产复现优先使用锁文件或镜像。
所有方式启动的是同一套完整 HTTP 服务，不把包安装目录或 uvx 缓存用作运行数据目录。

## 运行配置与数据

默认本地只监听 `127.0.0.1:8808`，外部访问用 `--host 0.0.0.0` 或配置显式开启。
所有配置路径应指向可写的持久化目录：

| 数据 | 默认相对于配置目录的位置 |
|---|---|
| 人员、会话与 token 验证数据 | `data/service.db` |
| 双审计数据库 | `audit/audit.db` |
| 初始化码 | 启动终端显示的位置 |
| 网页上传私钥 | `keys/` |

运行数据和秘密配置不入 Git，不打进镜像。`${ENV_VAR}` 可引用外部 SSH 凭据，缺变量立即报错；网页保存配置保留引用但会丢失 YAML 注释。
默认不会校验未配置 `known_hosts` 的目标主机指纹；需要校验时为服务器配置对应文件。

网关子路径示例：

```nginx
location /ssh-mcp/ {
    proxy_pass http://127.0.0.1:8808/;
    proxy_http_version 1.1;
    proxy_buffering off;
}
```

`proxy_pass` 尾斜杠剥除前缀，前端资源/API 使用相对路径。HTTPS 部署设置 `auth.cookie_secure: true`，
子路径部署建议设置 `auth.cookie_path: /ssh-mcp/`，本地根路径访问则用 `/`。

## MCP 接入与工具

使用后台创建的 MCP token 为客户端配置 HTTP URL，例如 `https://<host>/ssh-mcp/mcp`，认证头为 `Authorization: Bearer <MCP_TOKEN>`。
接入已部署服务无需成员再运行一份服务。

- `list_servers`、`server_health`：资源清单与 Linux 健康状态。
- `exec_command`：执行远程命令，支持超时和输出截断。
- `list_dir`、`read_file`：浏览目录和读取 UTF-8 文本。
- `upload_file`、`download_file`：有大小限制的文件传输。

默认限制：上传 2 MiB、下载 10 MiB、读取 1 MiB、命令 stdout/stderr 各 64 KiB。大文件使用 scp/rsync。
命令超时不保证结束 `nohup`/`setsid` 创建的远端进程；网络错误后的重试也不保证外部操作只执行一次。

## 两类审计

- 人员操作：登录、人员变更、密码重置、token 创建/修改/启停/吊销、服务器与密钥操作、审计导出等。
- MCP 调用：token ID 与名称快照、工具、执行时目标主机/端口/账号、命令或路径、结果、耗时与请求编号。

两类记录分别筛选、分页、查看详情并导出 CSV，默认保留 30 天，运行期间定期清理。
审计不保存密码、token 明文、私钥、上传文件正文或完整工具结果；命令里的敏感业务参数仍须按实际使用注意其记录范围。
SQLite 为本机追溯存储，不承诺防篡改或远程操作与本地审计之间的全局原子性。

## 从 0.1.x 升级

1. 停止旧实例，备份完整配置、环境变量引用、keys 与审计数据库；有 WAL 时先正常停止或使用 SQLite 备份方式。
2. 保留原配置路径和运行数据，使用新版本启动。配置中实际旧 `auth.users` token 首次迁移为独立 token，重复启动不会重新导入已吊销凭证。
3. 旧 token 继续调用 MCP；网页不再接受旧 token，也不把旧 token 当登录密码。首次用本机初始化码建立新账号。
4. 旧审计保留并标为 legacy；无法证明的历史 token 归属不会补造。停用创建者不自动停用独立 token。
5. 验证服务器清单、已有 token、登录、双审计、子路径资源与数据权限，再开放访问。

身份数据库是新结构；回滚前需恢复与旧程序兼容的配置与备份，不能删除唯一的身份库来“修复登录”。
先在副本演练迁移；本次开发不会修改线上实例或已有真实配置。

## 开发与验证

```bash
uv sync --locked
uv run --locked pytest
uv run --locked ruff check src tests
cd webui
npm ci
npm run typecheck
npm run build
```

前端使用 React、Tailwind CSS v4、项目内 shadcn/ui 风格组件、Base UI、TanStack Table，构建产物输出到 Python 包的 `web/static/`。
修改 UI 后必须重新构建再打包或构建镜像。服务自身源码、样式、组件与构建产物独立持有，不依赖父目录。
