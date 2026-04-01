# SaCode Agent Dockerfile
#
# 专门用于运行 AI Agent 的容器镜像
# 安全优化、最小化依赖、支持沙箱模式

# ============================================================================
# Stage 1: Builder
# ============================================================================
FROM node:22-alpine AS builder

# 安装构建依赖
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    git \
    curl

WORKDIR /build

# 复制 package 文件
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json ./packages/core/
COPY packages/container/package.json ./packages/container/

# 安装 pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# 安装依赖
RUN pnpm install --frozen-lockfile

# 复制源码
COPY packages/core ./packages/core
COPY packages/container ./packages/container
COPY tsconfig.base.json ./

# 构建
RUN pnpm -C packages/core build
RUN pnpm -C packages/container build

# ============================================================================
# Stage 2: Production Runtime
# ============================================================================
FROM node:22-alpine AS runtime

# 安全标签
LABEL org.opencontainers.image.title="SaCode Agent"
LABEL org.opencontainers.image.description="SaCode AI Agent Runtime"
LABEL org.opencontainers.image.version="1.0.0"
LABEL org.opencontainers.image.vendor="STAND-ALONE"
LABEL org.opencontainers.image.source="https://github.com/STAND-ALONE/SaCode"

# 创建非 root 用户
RUN addgroup -g 1000 -S sacode && \
    adduser -u 1000 -S sacode -G sacode

# 安装运行时依赖（最小化）
RUN apk add --no-cache \
    curl \
    ca-certificates \
    tzdata \
    && rm -rf /var/cache/apk/*

# 设置时区
ENV TZ=Asia/Shanghai

# 创建目录结构
WORKDIR /app
RUN mkdir -p /app/workspace /app/output /app/logs /app/cache && \
    chown -R sacode:sacode /app

# 从构建阶段复制产物
COPY --from=builder --chown=sacode:sacode /build/packages/core/dist ./packages/core/dist
COPY --from=builder --chown=sacode:sacode /build/packages/core/package.json ./packages/core/
COPY --from=builder --chown=sacode:sacode /build/packages/container/dist ./packages/container/dist
COPY --from=builder --chown=sacode:sacode /build/packages/container/package.json ./packages/container/
COPY --from=builder --chown=sacode:sacode /build/node_modules ./node_modules
COPY --from=builder --chown=sacode:sacode /build/package.json ./

# 切换到非 root 用户
USER sacode

# 环境变量
ENV NODE_ENV=production
ENV LOG_LEVEL=info
ENV WORKDIR=/app/workspace
ENV OUTPUT_DIR=/app/output

# 健康检查
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1

# 默认入口
ENTRYPOINT ["node", "packages/container/dist/index.js"]
CMD ["--help"]

# ============================================================================
# Stage 3: Development Image (可选)
# ============================================================================
FROM runtime AS development

USER root

# 安装开发工具
RUN apk add --no-cache \
    bash \
    vim \
    htop \
    jq \
    git

# 切回非 root 用户
USER sacode

ENV NODE_ENV=development
ENV LOG_LEVEL=debug

# 开发模式入口
CMD ["node", "--inspect=0.0.0.0:9229", "packages/container/dist/index.js"]

# ============================================================================
# Stage 4: Sandbox Test Image
# ============================================================================
FROM node:22-alpine AS sandbox-test

# 完全最小化，用于测试严格沙箱模式
RUN apk add --no-cache nodejs

# 只读文件系统兼容
RUN mkdir -p /tmp/workspace && chmod 1777 /tmp/workspace

WORKDIR /tmp/workspace

# 最小化入口
ENTRYPOINT ["node", "-e", "console.log('Sandbox test ready')"]
CMD []
