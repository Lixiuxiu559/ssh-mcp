# ssh-mcp 开发指引（0.2.0）

本服务是独立 Python FastMCP 仓库。本地前端采用 Modern Professional（专业极简控制台），提供用户名密码登录、独立 MCP token 与双审计。
工作空间的统一规范适用于新改动；本文件列出服务内部边界与可直接使用的命令。

## Git 分支

日常开发使用已有 `dev` 分支，`main` 保持稳定；创建其他分支需用户允许，合并、推送与发布按用户授权执行。

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
webui/             React / Mantine 9 / lucide 图标 / Modern Professional组件
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

本服务前端基于 **Mantine 9 组件库** 实现 Modern Professional（专业极简控制台）；界面组件优先使用 Mantine（AppShell、Table、Modal、Tabs、Pagination、Select、FileButton 等），图标统一 lucide-react，通过 Mantine 的 leftSection/rightSection/icon 传入。
不引入其他 UI 库；禁止恢复 Tailwind、Base UI、TanStack Table、Ant Design、玻璃拟态或混合旧主题。
配色使用 Mantine 默认值：主色为默认 `blue`，暗色为默认近黑表面，不做品牌色定制；仅暗色文字色阶在 `src/theme.ts` 提亮（dark[0] 纯白、[1]/[2] 依次减弱），保证黑底可读性。字体为系统字体栈；圆角与字号等非颜色项同文件覆盖。
主题仅 light/dark 两态（默认 light），由 MantineProvider 管理，localStorage 键 `mantine-color-scheme-value`；`index.html` 内联引导脚本负责首帧防闪烁，并把旧 `linkage-theme` 偏好做一次性迁移；根节点 `data-mantine-color-scheme` 输出实际主题。
Mantine 之外的全局样式集中在 `src/global.css`，仅放少量辅助类（mono、排序按钮重置、审计详情网格等）。
表格排序由 `components/DataTable.tsx` 内置轻量实现，不引入表格库。前后端契约变更必须同步 types 与 API 测试。
总览使用现有管理API展示真实统计与最近事件，不模拟在线状态或趋势。
服务器连接结果来自本页手动检测，不代表持续健康监测；详情用独立内容页展示配置路径。
API使用相对路径和人员Cookie，写请求带X-CSRF-Token；不要将MCP token放入localStorage。

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
