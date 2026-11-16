# ssh-mcp 开发指引（0.2.0）

本服务是独立 Python FastMCP 仓库。本地前端采用 Ant Design 6 控制台规范，提供用户名密码登录、独立 MCP token 与双审计。
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
webui/             React / Ant Design v6 / OPPO Sans / lucide 图标
web/static/        随源码、wheel、sdist和镜像交付的前端构建产物
```

## 必须保留的业务边界

- 所有启用人员同权，不增加admin角色或隐藏权限。网页登录只用密码与会话，MCP只用独立token。
- 不开放默认账号。首次用户需要本机setup.key；密码不由旧token派生。
- 实际旧token仅首次幂等迁移；常规更新与重启不失效，删除后不能通过重启或再次导入复活。
- 人员停用/改密码撤销网页会话；停用创建者不级联删除token。新token一次展示明文，列表和日志不泄露secret。
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

本服务前端基于 **Ant Design v6**，字体使用 **OPPO Sans 4.0**。优先使用组件库的 Layout、Menu、Form、Input、Upload、Table、Modal、Tabs、Descriptions、Empty、Statistic 等原生组件。公共业务组件仅封装已有行为，不实现另一套组件库皮肤。
应用壳、主题 Provider、会话/导航、登录账号、总览、成员/Token 功能页和审计工具栏来自 MCP 工作空间的 `design-system/react/` 权威源；服务内副本独立运行。工作空间开发时先改公共源，再运行 `node design-system/scripts/sync-ui.mjs --write` 和 `--check`；本服务只适配品牌、导航、服务器字段与 SSH 领域交互。独立克隆本服务仍可直接构建，不需要父目录。
配色采用 Ant Design 默认蓝色与默认浅深算法，由 ConfigProvider 的 design token 管理，CSS 使用 --ant-* 语义变量；布局样式集中于 src/global.css。
OPPO Sans 官方原始可变 TTF 和授权原文保存在 webui/public/assets/fonts/，随构建产物交付，禁止修改或子集化字体；README 提供字体声明与授权原文入口。
账号菜单仅展示当前用户身份、个人资料、修改密码与退出登录，不提供快速前往、GitHub 或关于；个人资料与密码复用现有用户管理 API，改密成功后回到登录页。GitHub 仓库入口仅保留在登录首页页脚，以新标签页打开项目源码。侧栏底部使用紧凑网关状态条，点击重新检查；检查中与未知状态有明确反馈，侧栏收起后用图标及提示表达完整状态。主题只保留顶栏切换入口，菜单内不重复放主题控件。
主题保留 light/dark，默认 light。localStorage 键为 ssh-mcp-theme，首次读取兼容旧 mantine-color-scheme-value 和 linkage-theme；index.html 负责首帧主题，根节点 data-theme 输出实际主题。
所有表格列表统一使用 AppTable（DataTable 内部复用），表头与正文统一居中，块级头像、标签和操作布局也须居中。分页规则由公共组件维护：默认每页 10 条，仅提供 10 / 20 / 50，切换大小回到第一页。后端分页复用 useListPagination，只向组件提供当前页、总数与加载状态，不在页面重复绘制分页控件。排序继续使用 Ant Design Table，前后端契约变更同步 types 与 API 测试。
成员启用/禁用在列表开关中直接保存；删除成员须确认，撤销其网页会话，保留历史审计及其创建的 MCP Token。最后一个启用成员不可禁用或删除；有其他启用成员时允许操作当前账号，成功后退出登录。
页面面向桌面浏览器，工作区内边距 16px 20px。一级菜单页不重复显示菜单名称或空标题行，PageHeading 仅保留读屏标题；新增、刷新和导出等操作放在内容面板工具栏。详情页保留资源名称和返回入口。登录前首页保留用户确认的双栏设计、原有展示文案、连接示意和登录卡片比例；技术迁移不得擅自重排该页面。首次服务器与 Token 配置采用两栏工作区，区块通过间距和底色组织，避免交叉分隔线。PEM 上传位于网关私钥路径输入框右侧。
Token 管理只展示启用/禁用与删除。列表开关直接保存状态；删除后从管理列表移除并立即失效，保留身份库中的失效标记和历史审计，旧已吊销项按已删除处理。
Token 配置预览和模板使用 https://ssh.example.com/mcp 示例地址；新 Token 创建后的实际接入配置使用当前网关地址。一次性秘密值提示、错误反馈和危险操作确认必须保留。
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
关键认证还验证真实HTTP握手、会话与token删除。测试运行数据必须用临时目录，不加载真实config.yaml。

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
