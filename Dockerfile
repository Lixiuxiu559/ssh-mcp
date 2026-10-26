# ---------- 运行时镜像 ----------
# 基础镜像可用 --build-arg BASE_IMAGE=... 覆盖：
#   默认 daocloud 源（同时提供 amd64 / arm64，适合跨架构构建）
#   ACR 的 base/python:3.12-slim 目前只有 arm64，构建 amd64 镜像时不可用
ARG BASE_IMAGE=docker.m.daocloud.io/library/python:3.12-slim
FROM ${BASE_IMAGE}

WORKDIR /app

ENV PYTHONUNBUFFERED=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never

# uv 用于按 uv.lock 精确还原依赖（从 PyPI 安装，避免依赖 ghcr.io 镜像）
RUN pip install --no-cache-dir uv

# 先只装依赖（源码不变时可复用这层缓存）
COPY pyproject.toml uv.lock README.md ./
RUN uv sync --frozen --no-dev --no-install-project

# 源码 + 已构建好的前端静态产物（webui 编译结果在 src/ssh_mcp/web/static/，镜像无需 Node）
COPY src/ ./src/
RUN uv sync --frozen --no-dev

# 非 root 运行；uid/gid 1000 为默认值，compose 可用 DOCKER_UID/DOCKER_GID 覆盖成宿主用户
RUN useradd --create-home --uid 1000 appuser \
    && mkdir -p /data && chown -R appuser:appuser /data

# asyncssh 建连时用 getpass.getuser() 推断本地用户名，精简镜像里没有 USER/LOGNAME 会直接报错
ENV USER=appuser \
    LOGNAME=appuser

ENV PATH="/app/.venv/bin:$PATH"

# 工作目录设为 /data：config.yaml 里的相对路径（audit/、keys/）都会落在挂载卷内
WORKDIR /data

USER appuser

EXPOSE 8808

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD ["/app/.venv/bin/python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8808/healthz').read()"]

CMD ["ssh-mcp", "--config", "/data/config.yaml", "--host", "0.0.0.0"]
