# SaCode Web UI Dockerfile
# 静态文件服务镜像

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
