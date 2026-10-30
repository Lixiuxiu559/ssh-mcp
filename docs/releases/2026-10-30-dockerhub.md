# Docker Hub 双架构发布 · 0.2.0

2026-10-30 已公开发布 [lijx559/ssh-mcp](https://hub.docker.com/r/lijx559/ssh-mcp)。
`0.2.0` 与 `latest` 指向相同双架构索引，支持 `linux/amd64`、`linux/arm64`；固定版本适合部署，latest会随后续版本更新。

```bash
docker pull lijx559/ssh-mcp:0.2.0
```

索引：`sha256:c9ba2f11cd56a3a01bfcbae4e67ad7c7c413d4effffe267ddfadcc45ed65037a`。可按此摘要固定部署。

| 平台 | 平台镜像摘要 |
|---|---|
| `linux/amd64` | `sha256:0cd7faafe14caeee8efd3bdf93c4873661598d16874dda8fad96e7a29f8ff0d3` |
| `linux/arm64` | `sha256:d60356d14e42fe37836a87093873811cb5374eebfb005c2b304e3dfc9e1b9a46` |

源码基线：`0933116d746c21c4af18ec077806ca6610803d34`。构建源与该Git提交一致。
基础镜像索引固定为 `sha256:aa943ce411423c7582288f18707ff66eddcbaeb510502d747a72aeb34f30d159`。完整摘要与构建源指纹见 [JSON发布收据](2026-10-30-dockerhub.json)。

两个架构均实际启动验证：非root运行、静态页面与字体、初始化/Cookie/CSRF、HTTP MCP、稳定token审计、重启保留token及吊销拒绝。
远端清单平台集合与配置摘要已逐项核对，确认与本地验收镜像完全一致；Docker Hub仓库可见性已验证为公开。
镜像不包含本地运行配置、身份/审计数据库或初始化码。配置和持久化部署步骤见仓库README；本次仅发布镜像，未推送Git源码、PyPI包或GitHub Release。
