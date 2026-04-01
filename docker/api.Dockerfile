# SaCode API Dockerfile
# 多阶段构建 - 优化镜像体积和构建速度

# ============================================
# Stage 1: 基础镜像
# ============================================
FROM node:22-alpine AS base

# 安装 pnpm
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

# 设置工作目录
WORKDIR /app

# ============================================
# Stage 2: 依赖安装
# ============================================
FROM base AS deps

# 复制依赖配置文件
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json ./packages/core/
COPY packages/database/package.json ./packages/database/
COPY packages/auth/package.json ./packages/auth/
COPY packages/capabilities/package.json ./packages/capabilities/
COPY packages/adapters/package.json ./packages/adapters/
COPY packages/cli/package.json ./packages/cli/
COPY packages/api/package.json ./packages/api/
COPY packages/gateway/package.json ./packages/gateway/
COPY packages/container/package.json ./packages/container/
COPY packages/web/package.json ./packages/web/

# 安装依赖
RUN pnpm install --frozen-lockfile

# ============================================
# Stage 3: 构建
# ============================================
FROM base AS builder

# 复制依赖
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages ./packages

# 复制源代码
COPY . .

# 构建所有包
RUN pnpm build

# ============================================
# Stage 4: API 服务
# ============================================
FROM node:22-alpine AS api

# 安装 pnpm
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

WORKDIR /app

# 复制构建产物
COPY --from=builder /app/package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/core ./packages/core
COPY --from=builder /app/packages/database ./packages/database
COPY --from=builder /app/packages/auth ./packages/auth
COPY --from=builder /app/packages/capabilities ./packages/capabilities
COPY --from=builder /app/packages/adapters ./packages/adapters
COPY --from=builder /app/packages/api ./packages/api
COPY --from=builder /app/packages/gateway ./packages/gateway
COPY --from=builder /app/packages/container ./packages/container

# 创建数据目录
RUN mkdir -p /app/data

# 暴露端口
EXPOSE 3000

# 健康检查
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

# 启动 API 服务
CMD ["pnpm", "--filter", "@sacode/api", "start"]

# ============================================
# Stage 5: Web 服务
# ============================================
FROM node:22-alpine AS web

# 安装 pnpm 和 serve
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate && \
    npm install -g serve

WORKDIR /app

# 复制 Web 构建产物
COPY --from=builder /app/packages/web/dist ./dist

# 暴露端口
EXPOSE 5173

# 健康检查
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:5173 || exit 1

# 启动静态文件服务
CMD ["serve", "-s", "dist", "-l", "5173"]

# ============================================
# Stage 6: 开发环境
# ============================================
FROM base AS development

# 复制所有文件
COPY . .

# 安装依赖
RUN pnpm install

# 暴露端口
EXPOSE 3000 5173

# 开发模式启动
CMD ["pnpm", "dev"]
