# ssh-mcp 开发指引（0.2.0）

本服务是独立 Python FastMCP 仓库。当前版本实现 Linkage UI、用户名密码登录、独立 MCP token 与双审计。
工作空间的统一规范适用于新改动；本文件列出服务内部边界与可直接使用的命令。

## 分层与契约

```text
cli.py             --init / --config / --data-dir / --host / --port
config.py          Pydantic、环境变量引用、YAML原子写回、相对配置目录路径
state.py           配置热更新、连接池、身份库、审计投递与定时维护
server.py          FastMCP 4.1.4组装、生命周期、公开TokenVerifier、工具/网页路由
auth/store.py      SQLite人员、scrypt密码、会话、token验证值和审计outbox
auth/verifier.py   MCP每请求动态token验证，client_id为稳定token ID
audit.py           人员事件、MCP调用开始/结束、重试尝试、legacy保留、30天清理
web/api.py         人员Cookie会话与CSRF管理API，不能接受MCP token登录
ssh/pool.py        asyncssh缓存、并发限制、连接级故障重试一次与尝试审计
tools/             SSH清单、健康、命令、文件操作；register(mcp)
webui/             React / Tailwind4 / Base UI / TanStack Table / Linkage组件
web/static/        随源码、wheel、sdist和镜像交付的前端构建产物
```

## 必须保留的业务边界

- 所有启用人员同权，不增加admin角色或隐藏权限。网页登录只用密码与会话，MCP只用独立token。
- 不开放默认账号。首次用户需要本机setup.key；密码不由旧token派生。
- 实际旧token仅首次幂等迁移；常规更新与重启不失效，吊销后不能通过重启或再次导入复活。
- 人员停用/改密码撤销网页会话；停用创建者不级联吊销token。新token一次展示明文，列表和日志不泄露secret。
- 人员/token变更与身份审计outbox同事务，跨库投递按稳定event_id幂等，失败可重试。
- 审计在外部调用前记running，完成后记真实结果；取消与异常不能标成功；异常退出未完成记unknown。
- 保存执行时目标主机/端口/账号和token名称快照；历史记录不能随资源改名漂移。
- 双审计默认30天，维护任务无流量时也清理；不能清除身份数据。审计失败不得覆盖已发生的远端操作结果。
- 日志不保存密码、token明文、私钥和文件正文；任意命令中的业务敏感值不保证自动识别。

## SSH 与配置不变量

- `list_dir` 使用真实 `sftp.readdir()`，mock必须与asyncssh真实返回形态一致。
- `_RETRYABLE`覆盖ChannelOpenError与连接错误，确定性的SFTP权限/空间/路径错误不重试。
- 拒绝空命令；超时不能保证杀死nohup/setsid子进程，断线重试不保证外部动作仅一次。
- 面向用户失败抛领域异常，不能泄露凭据；FastMCP使用mask_error_details。
- 上传默认2MiB，要留出base64与协议请求体上限余量；下载10MiB、文本1MiB、命令输出各64KiB。
- 配置写临时文件后os.replace，挂载整个目录。`${ENV}`保存原引用，校验时展开，缺变量失败。
- 配置相对路径以config父目录解析；静态资源从Python包位置读取。不得依赖父工作空间。
- SQLite连接可在close后惰性重开，DB操作用锁并移出事件循环；不得共享网络文件系统WAL。

## 前端

使用Linkage 1.0设计：石墨窄导航、实心面板、蓝色连接/靛色调用、4/6/8圆角、36px控件和44px表格行。
令牌独立持有于webui/src/tokens.css；组件源码在components/ui。禁止恢复Ant Design、玻璃拟态或混合旧主题。
主题为light/dark/auto，localStorage键linkage-theme，根节点data-theme输出实际主题，系统偏好变化及时跟随。
API使用相对路径和人员Cookie，写请求带X-CSRF-Token；不要将MCP token放入localStorage。
Base UI负责浮层焦点与键盘交互；TanStack Table负责表格。前后端契约变更必须同步types与API测试。

## 开发验证

```bash
uv sync --locked
uv run --locked pytest
uv run --locked ruff check src tests
cd webui
npm ci
npm run typecheck
npm run build
```

改UI后必须重建web/static再打包，不在Docker里临时跑npm。测试设施为FakeSSH与FastMCP Client、HTTPX ASGI，
关键认证还验证真实HTTP握手、会话与token吊销。测试运行数据必须用临时目录，不加载真实config.yaml。

## 构建与部署

FastMCP精确固定4.1.4；升级显式修改依赖和uv.lock并回归，不在启动时更新。
源码、Docker/Compose、安装包/uvx复用一个CLI。完整启动命令和迁移步骤见README。

```bash
uv build
# 包测试在源码目录外进行
uvx --from ./dist/ssh_mcp-0.2.0-py3-none-any.whl ssh-mcp --version
# 本地镜像，架构按实际目标明确指定
docker buildx build --platform linux/amd64 -t ssh-mcp:0.2.0 --load .
```

发布前检查产物内有default_config.yaml与完整web/static；检查原始配置、密钥、data/audit/runtime和node_modules没有混入。
发布新版本不得覆盖既有tag。镜像仓库与GitHub Release上传作为显式发布任务执行，不能把本地构建当作已发布。
容器非root运行，USER/LOGNAME供asyncssh解析本地用户名，挂载目录权限必须对齐运行UID/GID。

## 回滚

迁移前正常停止并备份配置、环境引用、密钥、旧审计和身份数据库。先在副本演练；不要在真实线上调试迁移。
回滚应用时检查schema与备份兼容性，不能删除唯一身份库或重建token解决问题。
历史审计缺失token身份的记录标legacy，不根据人员名字猜测补齐。
