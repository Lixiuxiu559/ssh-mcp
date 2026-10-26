# ssh-mcp — 开发指引

团队共享 SSH 网关 MCP 服务。本文件记录**架构地图**与**实测踩出来的非显然约束**，
改代码前请先读「关键不变量」一节。功能与部署说明见 `README.md`。

## 架构地图

```
cli.py            入口：load_dotenv → ConfigFile → create_mcp → mcp.run(transport="http")
server.py         组装：StaticTokenVerifier 认证 + lifespan + AuditMiddleware + 注册工具/路由
config.py         pydantic 配置模型、YAML 原始树读写（原子写）、${ENV} 展开、凭据类型
state.py          GatewayState：内存配置 + ConnectionPool + AuditLogger（配置热更新入口）
audit.py          SQLite 审计（中间件 + 查询 + 30 天保留）
errors.py         领域异常（SshMcpError 及其子类）
dependencies.py   get_state（工具通过 Depends 拿状态）
ssh/pool.py       asyncssh 连接池：按 alias 缓存、断线重试一次、按服务器限流
ssh/models.py     工具返回值的 pydantic 模型
tools/            inventory / exec_tool / files（各含 register(mcp)）
web/api.py        管理端 API + 静态资源路由（与 MCP 共用一套 token 认证）
web/static/       webui 构建产物（入库，部署零额外步骤）
webui/            React + TS + AntD6 前端源码；vite build → ../src/ssh_mcp/web/static/
```

请求流：`MCP/HTTP → 认证 → AuditMiddleware（无论如何都记一条）→ 工具 → ConnectionPool → asyncssh`

配置热更新：管理端写配置 → `ConfigFile.save()` 原子写回 → `state.replace_config()` /
`state.upsert_server()` → 工具下次调用即生效（无需重启）。

## 关键不变量（改代码前必读）

这些都是实际踩过坑才定下的，破坏它们会引入难查的 bug：

1. **`list_dir` 必须用 `sftp.readdir()`，不能用 `listdir()`**。
   asyncssh 的 `listdir()` 只返回文件名字符串，取不到类型/大小（曾导致 `list_dir`
   完全坏掉：`'str' object has no attribute 'filename'`）。`readdir()` 才返回带
   `filename`/`attrs` 的条目。

1b. **`_RETRYABLE` 必须是 `asyncssh.Error` 全族，不能枚举子类**。
   `ChannelOpenError`（sshd MaxSessions 打满/通道被拒）不属于
   DisconnectError/ConnectionLost/OSError，漏掉它会让坏连接永远留在池里
   反复失败（线上"SSH 一直断、重启容器才恢复"的根因，见版本记录 0.1.3）。
   新增"连接级"异常类型时先问：它是 `asyncssh.Error` 的子类吗？是则已被覆盖。

2. **测试 mock 必须对齐真实 asyncssh 行为**。上面那个 bug 之所以没被测出来，
   是因为 `conftest.py` 的 `FakeSFTP.listdir` 返回了带属性的假对象——比真实行为宽松，
   把 bug 掩盖了。同理 `open("w")` 也要检查父目录存在（真实 SFTP 会抛
   `SFTPNoSuchFile`）。**改 mock 时要问：真实 asyncssh 会怎样？**

3. **`mask_error_details=True`，所以所有面向用户的失败都必须 raise 领域异常**
   （`SshMcpError` 子类）。否则底层异常（asyncssh/SFTP/OSError）会被 FastMCP
   mask 成无用的 `Error calling tool 'xxx'`。已覆盖：路径不存在、二进制文件、
   文件过大、目录当文件读、上传父目录缺失、配置写入权限不足。

4. **`exec_command` 必须拒绝空命令**。SSH 的 `exec ""` 会开一个交互式 shell
   并永久等待 stdin，表现为"挂到超时"（曾挂满 60s，且报错是"命令超时"，
   与真实原因无关，用户无法自查）。

5. **上传上限必须低于 MCP 传输层的 4MiB 请求体硬上限**。
   `mcp` SDK 的 `DEFAULT_MAX_REQUEST_BODY_SIZE = 4MiB` 写死在传输层，FastMCP
   未暴露配置入口；base64 编码还会放大 4/3。所以 `max_upload_bytes` 默认
   **2MiB**——目的是让**超限时走我们自己的可读报错**，而不是撞传输层拿到
   不可读的 `Server returned an error response`。**调大它不会获得更大能力，
   只会让报错变差**（实测：base64 到 3MiB 即被传输层拒绝）。下载不受此限（响应体），
   保持 10MiB。大文件请走 scp/rsync。

6. **配置文件写入是"原子写"（写 `.tmp` 再 `os.replace`）**。
   因此容器部署**必须挂目录、不能挂单个文件**——单文件 bind mount 会让临时文件与
   目标落在不同文件系统，rename 必然失败。

7. **容器内 asyncssh 需要 `USER`/`LOGNAME` 环境变量**。
   `asyncssh` 建连时用 `getpass.getuser()` 推断本地用户名，精简镜像里没有这两个
   变量会直接抛 `ValueError: Unknown local username`。Dockerfile 已设。

8. **`${ENV_VAR}` 在保存时保留原文、在校验时展开**。
   原始树（`ConfigFile.raw`）存的是引用原文，绝不落盘明文；但每次 `load()` 都会
   `expand_env_vars` 校验，**缺变量直接失败**（fail-fast）。所以容器里保存配置时，
   引用到的变量必须在容器环境中存在。

9. **凭据只写不读**：`servers` CRUD 永不返回凭据内容（`list_servers` 只给
   `credential_type`）。成员 token 是例外——管理页可查看（便于运维重置）。

10. **权限模型**：管理页仅 `admin` 可进；`servers`/`audit` 的 GET 只需认证；
    写操作 + 成员管理 + 密钥上传要求 `admin`。`auth.users` 为空时自动启用内置
    引导账号 `admin/admin`（`/api/me` 返回 `default_admin` 标记），配置了成员即失效。

11. **SQLite 审计连接是惰性的**（`_connection()` 在 close 后自动重开）。
    不要假设连接常驻——测试里 lifespan 会被多次进入，连接可能已被 close。

11b. **审计是旁路不是关卡**：`AuditLogger.log` 里任何异常/取消都不能影响工具调用。
    请求被取消时（客户端断开），`finally` 里的 `await log()` 会收到 CancelledError——
    必须同步兜底落库（用写入标记防 to_thread 已写完的重复），否则出现线上那种
    "故障期间审计整段空洞"。写入失败降级为 stderr 告警。SQLite 是同步 IO，
    log 走 `asyncio.to_thread`，不要在事件循环里直接做。

## 开发命令

```bash
uv sync                                # 安装依赖
uv run pytest                          # 测试（Fake SSH 层 + in-memory Client）
uv run ruff check src tests            # lint
uv run ssh-mcp -c config.yaml          # 本地启动（默认 0.0.0.0:8808）

# 前端
cd webui && npm run build              # 构建产物直接输出到 src/ssh_mcp/web/static/
cd webui && npx tsc --noEmit           # 类型检查（改了 .tsx 必跑）

# 镜像：见下方「发布镜像」
```

**提交前**：`uv run pytest` 全绿 + `ruff check` 干净 + 改了前端要 `tsc --noEmit`。

## 发布镜像（ACR）

镜像仓库：`docker.io/lijx559/ssh-mcp`

### 1. 前置：改了前端先构建

镜像构建**不会**跑 npm——`src/ssh_mcp/web/static/` 是入库的构建产物，Dockerfile 直接
COPY 它。**改了 `webui/` 就必须先 `cd webui && npm run build`**，否则镜像里的前端还是旧的。

### 2. 登录（首次或凭据过期）

```bash
docker login docker.io
# 用户名/密码来自阿里云 ACR 控制台，不是阿里云账号密码
```

### 3. 构建并推送（一条命令）

```bash
cd ssh-mcp
docker buildx build --platform linux/amd64 \
  -t docker.io/lijx559/ssh-mcp:0.1.2 \
  --push .
```

`--push` 构建完直接推送，无需再 `docker push`。
（想先在本地跑一遍验证，可用 `--load` 代替 `--push`，验证无误后再推。）

### 4. 验证推送结果

```bash
docker buildx imagetools inspect \
  docker.io/lijx559/ssh-mcp:0.1.2 \
  --format '{{json .Image}}' \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['os'], d['architecture'])"
# 必须输出：linux amd64
```

### 5. 更新目标机（121.43.241.121）

```bash
ssh root@121.43.241.121
cd /opt/ssh-mcp
sed -i 's|base/ssh-mcp:0.1.1|base/ssh-mcp:0.1.2|' docker-compose.yml
docker compose up -d          # 自动 pull 新镜像并重建容器
docker compose ps             # 确认 healthy
```

### 关键注意（都是踩过的坑）

1. **必须 `--platform linux/amd64`**。目标机是 x86_64；在 Apple Silicon 上直接
   `docker build` 产出 arm64 镜像，推上去在目标机报 `exec format error`。
2. **基础镜像必须同时提供目标架构**。Dockerfile 的 `ARG BASE_IMAGE` 默认
   `docker.m.daocloud.io/library/python:3.12-slim`（amd64 + arm64 都有）；
   **ACR 上的 `base/python:3.12-slim` 只有 arm64**，构建 amd64 时不能用它
   （需要时用 `--build-arg BASE_IMAGE=<多架构基础镜像>` 覆盖）。
3. **ACR 端点用公网（不带 `-vpc`）**。`-vpc` 是 VPC 内网端点，只能在阿里云 VPC 内
   拉取，本地/公网会 `EOF` 失败；在 ECS 上构建时才换 `-vpc`（内网更快、免流量费）。
4. **版本号只增不覆盖**。compose 靠 tag 判断是否更新；覆盖已发布 tag 会导致目标机
   拉到缓存旧镜像。改代码 → 递增版本（0.1.1 → 0.1.2）。
5. **推送后务必第 4 步验证架构**——推错架构不会报错，只在目标机运行时才暴露。

## 测试约定

- `tests/conftest.py` 提供 `FakeConn`/`FakeSFTP`/`Harness`，monkeypatch
  `asyncssh.connect`，使连接池与"测试连接"都走假连接。
- `call(gw, "tool_name", **args)` 是调用工具的统一入口（in-memory Client）。
- 新增错误路径时，**断言错误信息可读**（含关键词），而不是只断言 `is_error`。
- 涉及文件/目录的测试，注意 `Harness.fs_files` / `fs_dirs` 要显式构造。

## 已知边界

- 目标服务器须为 Linux（健康检查解析 `/proc`、`free`/`df` 输出）
- `exec_command` 超时只中断命令本身，`nohup`/`setsid` 启动的进程可能仍在远端运行
- 网页保存配置会重写整个 YAML（**注释丢失**），`${ENV}` 引用原样保留
- 审计默认保留 30 天（`audit.retention_days`），超期在写入时顺带清理
- 文件容量：上传 2MiB / 下载 10MiB / `read_file` 1MiB / 命令输出 64KiB（各自截断）

## 版本记录

- `0.1.0` 首个可用于生产的版本
- `0.1.1` 修复：空命令挂起（不变量 4）、上传父目录缺失报错不可读（不变量 3）、
  上传上限与传输层不一致（不变量 5）；测试 mock 对齐真实 asyncssh（不变量 2）
- `0.1.2` 修复：网关子路径 `/ssh-mcp/` 下管理页白屏（Vite 根路径构建 + 网关剥前缀不匹配）——
  Vite `base: './'` + API 调用改相对路径，统一约定见工作空间根 CLAUDE.md「网关子路径统一约定」
- `0.1.3` 修复两个线上事故（同一根因，2026-09-17 example-project 部署期间发现）：
  ① 连接池自愈失效——`_RETRYABLE` 漏掉 `asyncssh.ChannelOpenError`（不是
  DisconnectError/ConnectionLost/OSError 的子类），sshd MaxSessions 打满后坏连接
  永远留在池里反复失败，表现为"SSH 一直断、重启容器才恢复"；现改为
  `_RETRYABLE = (asyncssh.Error, OSError)` 全族收编。② 故障期间审计整段漏记——
  请求在 finally 的 `await log()` 上被取消时写入被丢；现在 log 走 to_thread、
  取消时同步兜底写（带写入标记防重复）、任何写入异常降级为 stderr 告警绝不影响主流程。
  回归测试：`test_channel_open_error_triggers_reconnect`、
  `test_audit_survives_caller_cancellation`、`test_audit_log_failure_never_breaks_tool_call`
