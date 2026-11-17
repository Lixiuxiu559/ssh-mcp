# SSH MCP 0.3.0 Docker 发布记录

发布日期：2026-11-17。两个服务按统一版本 `0.3.0` 发布，`latest` 指向同一镜像索引。

- 镜像：`lijx559/ssh-mcp:0.3.0`、`lijx559/ssh-mcp:latest`
- 平台：`linux/amd64`、`linux/arm64`
- 索引摘要：`sha256:74af165fb12615f79dfe619bcb0e7657aed58e546f79176fabb45bfa5b819988`
- 镜像源码提交：`4dd38a02bfdd42b8c68612dd79af1a329b1e02a8`
- 原 `latest` 摘要：`sha256:c9ba2f11cd56a3a01bfcbae4e67ad7c7c413d4effffe267ddfadcc45ed65037a`

用户直接拉取镜像后，用 `docker run` 或单个 Compose 文件启动；不需要 Git、源码构建、`.env` 或独立初始化命令。首次启动缺少配置时自动生成默认配置，空身份库创建 `admin / admin`。人员、工作空间、MCP Token、加密密钥与双审计保存在数据卷。

```bash
docker pull lijx559/ssh-mcp:0.3.0
```

完整启动命令见 [README](../../README.md#quickstart)，机器可读的发布证据见 [JSON](2026-11-17-dockerhub.json)。历史版本标签保留。本次更新 `latest` 不覆盖此前的固定版本标签。

已有部署升级时沿用原数据卷或宿主目录挂载、运行 UID/GID 和环境变量配置，仅替换镜像。不要将原持久化目录换为空命名卷。工作空间授权按后台当前归属校验，旧 `auth.users` 不自动导入，不给缺少工作空间的 Token 自动授权。

## 验证

- 后端全量回归：262 项通过，Ruff 通过。
- 两种架构均通过不使用 Docker 登录凭据的匿名拉取。
- 两种架构分别验证 `docker run`、单文件 Compose，共 4 组最终发布镜像实测。
- 覆盖自动创建私有配置、非 root 运行、默认账号、修改密码、创建空间和 Token、真实 MCP 调用、容器删除重建、原凭证和双审计保留；全程无需 `.env`。
- 实测配置及 Token 加密密钥权限均为 `0600`。所有测试容器和测试卷均使用隔离名称，验收后删除。

| 平台 | Manifest 摘要 | Config 摘要 |
|---|---|---|
| `linux/amd64` | `sha256:c441d7b136cd2ff303a073e9549d7dd3bb2e0d2f77327798bb1d7b1358a06332` | `sha256:88e5a44231513778faf2c12e2451e7d233091696eb5acf5b8b9dc8e4f9789c84` |
| `linux/arm64` | `sha256:2f32011da096889ca05f891a5df2d3b5f192f35b2dd9811b114859a7a5ff8931` | `sha256:d28cfc67ede60606dbaaaec7f15123f666017fff5f15c93c1fb0aafdb6961946` |
