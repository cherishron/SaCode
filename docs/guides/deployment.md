# 部署指南

> SACODE 生产环境部署文档

## 目录

- [环境要求](#环境要求)
- [部署方式](#部署方式)
- [Docker 部署](#docker-部署)
- [手动部署](#手动部署)
- [环境变量配置](#环境变量配置)
- [数据库配置](#数据库配置)
- [反向代理配置](#反向代理配置)
- [监控与日志](#监控与日志)
- [安全建议](#安全建议)

## 环境要求

### 服务器配置

| 配置项 | 最低要求 | 推荐配置 |
|--------|----------|----------|
| CPU | 2 核 | 4 核+ |
| 内存 | 4 GB | 8 GB+ |
| 存储 | 20 GB | 50 GB+ SSD |
| 网络 | 10 Mbps | 100 Mbps+ |

### 软件要求

| 软件 | 版本 |
|------|------|
| Node.js | >= 22.0.0 LTS |
| Docker | >= 24.0.0 (推荐) |
| Docker Compose | >= 2.20.0 |
| PostgreSQL/MySQL | >= 15 / >= 8.0 |
| Redis | >= 7.0 (可选) |
| Nginx | >= 1.24 (可选) |

## 部署方式

### 方式对比

| 方式 | 优点 | 缺点 | 适用场景 |
|------|------|------|----------|
| Docker | 环境一致、易于管理 | 需要学习 Docker | 生产环境 |
| Docker Compose | 多服务编排、简单配置 | 单机部署 | 中小规模 |
| 手动部署 | 完全控制、无依赖 | 配置复杂 | 特殊需求 |

## Docker 部署

### 1. 准备配置文件

```bash
# 克隆仓库
git clone https://github.com/STAND-ALONE/SACODE.git
cd SACODE

# 创建环境变量文件
cp .env.example .env
# 编辑 .env 文件配置环境变量
```

### 2. 构建镜像

```bash
# 构建所有镜像
pnpm docker:build

# 或分别构建
docker build -t SACODE-api --target api .
docker build -t SACODE-web --target web .
```

### 3. 使用 Docker Compose

```bash
# 启动服务
docker compose up -d

# 查看日志
docker compose logs -f

# 停止服务
docker compose down
```

### 4. Docker Compose 配置

```yaml
# docker-compose.yml
version: "3.8"

services:
  api:
    image: SACODE-api
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - DATABASE_URL=postgresql://user:pass@postgres:5432/SACODE
      - REDIS_URL=redis://redis:6379
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_started
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/api/health"]
      interval: 30s
      timeout: 10s
      retries: 3
    restart: unless-stopped

  web:
    image: SACODE-web
    ports:
      - "80:80"
    depends_on:
      - api
    restart: unless-stopped

  postgres:
    image: postgres:16-alpine
    environment:
      - POSTGRES_USER=SACODE
      - POSTGRES_PASSWORD=your_secure_password
      - POSTGRES_DB=SACODE
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U SACODE"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    volumes:
      - redis_data:/data
    restart: unless-stopped

volumes:
  postgres_data:
  redis_data:
```

### 5. 开发环境 Docker

```bash
# 使用开发配置启动（支持热重载）
docker compose -f docker-compose.yml -f docker-compose.dev.yml up
```

## 手动部署

### 1. 安装 Node.js

```bash
# 使用 nvm 安装 Node.js 22
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
nvm install 22
nvm use 22
```

### 2. 安装 pnpm

```bash
npm install -g pnpm@9
```

### 3. 安装依赖

```bash
git clone https://github.com/STAND-ALONE/SACODE.git
cd SACODE
pnpm install
```

### 4. 构建项目

```bash
pnpm build
```

### 5. 配置环境变量

```bash
cp .env.example .env
# 编辑 .env 配置生产环境变量
```

### 6. 初始化数据库

```bash
cd packages/database
pnpm prisma generate
pnpm prisma migrate deploy
```

### 7. 启动服务

使用 PM2 管理进程：

```bash
# 安装 PM2
npm install -g pm2

# 启动 API 服务
pm2 start packages/api/dist/index.js --name SACODE-api

# 启动 Web 服务
pm2 start packages/web/dist/index.js --name SACODE-web

# 保存 PM2 配置
pm2 save
pm2 startup
```

## 环境变量配置

### 核心配置

```env
# 服务配置
NODE_ENV=production
PORT=3000
HOST=0.0.0.0

# 数据库
DATABASE_TYPE=postgresql
DATABASE_URL=postgresql://user:password@localhost:5432/SACODE

# Redis (可选)
REDIS_URL=redis://localhost:6379

# JWT 配置
JWT_SECRET=your-very-secure-jwt-secret-at-least-32-chars
JWT_EXPIRES_IN=7d

# Session
SESSION_SECRET=your-very-secure-session-secret

# 前端
FRONTEND_URL=https://your-domain.com
BASE_URL=https://api.your-domain.com
```

### iFlow 配置

```env
# iFlow ACP
IFLOW_ACP_URL=ws://localhost:8090/acp
IFLOW_AUTO_START=true
IFLOW_TIMEOUT=60000
```

### OAuth 配置

```env
# GitHub OAuth
GITHUB_CLIENT_ID=your-github-client-id
GITHUB_CLIENT_SECRET=your-github-client-secret

# Google OAuth
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret

# 微信 OAuth
WECHAT_APP_ID=your-wechat-app-id
WECHAT_APP_SECRET=your-wechat-app-secret

# QQ OAuth
QQ_APP_ID=your-qq-app-id
QQ_APP_KEY=your-qq-app-key

# 企业微信 OAuth
WEWORK_CORP_ID=your-corp-id
WEWORK_AGENT_ID=your-agent-id
WEWORK_SECRET=your-secret
```

### IM 平台配置

```env
# Telegram
TELEGRAM_BOT_TOKEN=your-bot-token

# Discord
DISCORD_BOT_TOKEN=your-bot-token

# 华为小艺
XIAOYI_AK=your-access-key
XIAOYI_SK=your-secret-key
XIAOYI_AGENT_ID=your-agent-id

# 钉钉
DINGTALK_APP_KEY=your-app-key
DINGTALK_APP_SECRET=your-app-secret

# 飞书
FEISHU_APP_ID=your-app-id
FEISHU_APP_SECRET=your-app-secret
```

## 数据库配置

### PostgreSQL (推荐)

```env
DATABASE_TYPE=postgresql
DATABASE_URL=postgresql://SACODE:password@localhost:5432/SACODE
```

### MySQL

```env
DATABASE_TYPE=mysql
DATABASE_URL=mysql://SACODE:password@localhost:3306/SACODE
```

### SQLite (开发环境)

```env
DATABASE_TYPE=sqlite
DATABASE_PATH=./data/SACODE.db
```

### 数据库迁移

```bash
# 开发环境
pnpm -C packages/database prisma migrate dev

# 生产环境
pnpm -C packages/database prisma migrate deploy
```

## 反向代理配置

### Nginx 配置

```nginx
# /etc/nginx/sites-available/SACODE
server {
    listen 80;
    server_name your-domain.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name your-domain.com;

    ssl_certificate /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;

    # 前端
    location / {
        proxy_pass http://localhost:5173;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    # API
    location /api {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # WebSocket
    location /ws {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 86400;
    }
}
```

### Caddy 配置

```
# Caddyfile
your-domain.com {
    tls your-email@example.com

    # 前端
    root * /var/www/SACODE/web
    file_server

    # API
    handle /api/* {
        reverse_proxy localhost:3000
    }

    # WebSocket
    handle /ws {
        reverse_proxy localhost:3000
    }
}
```

## 监控与日志

### 健康检查

```bash
# API 健康检查
curl http://localhost:3000/api/health

# Docker 健康检查
docker compose ps
```

### 日志管理

```bash
# Docker 日志
docker compose logs -f api
docker compose logs -f web

# PM2 日志
pm2 logs SACODE-api
pm2 logs SACODE-web
```

### 监控指标

推荐使用 Prometheus + Grafana：

```yaml
# docker-compose.monitoring.yml
services:
  prometheus:
    image: prom/prometheus
    ports:
      - "9090:9090"
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml

  grafana:
    image: grafana/grafana
    ports:
      - "3001:3000"
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=admin
```

## 安全建议

### 1. 密钥安全

- 使用强密码（至少 32 字符）
- 定期轮换密钥
- 不要在代码中硬编码密钥
- 使用环境变量或密钥管理服务

### 2. 网络安全

- 启用 HTTPS
- 配置 CORS 白名单
- 使用防火墙限制访问
- 启用速率限制

### 3. 数据库安全

- 使用强密码
- 限制数据库访问 IP
- 定期备份
- 启用连接加密

### 4. 定期更新

```bash
# 更新依赖
pnpm update

# 安全审计
pnpm audit

# 修复漏洞
pnpm audit --fix
```

### 5. 备份策略

```bash
# PostgreSQL 备份
pg_dump -U SACODE SACODE > backup_$(date +%Y%m%d).sql

# 自动备份脚本
#!/bin/bash
BACKUP_DIR=/backups
DATE=$(date +%Y%m%d_%H%M%S)
pg_dump -U SACODE SACODE | gzip > $BACKUP_DIR/SACODE_$DATE.sql.gz
# 保留最近 7 天
find $BACKUP_DIR -name "*.gz" -mtime +7 -delete
```

## 故障排除

### 常见问题

**1. 容器启动失败**

```bash
# 查看日志
docker compose logs api

# 检查配置
docker compose config
```

**2. 数据库连接失败**

```bash
# 检查数据库状态
docker compose exec postgres pg_isready

# 测试连接
psql $DATABASE_URL
```

**3. 内存不足**

```bash
# 增加容器内存限制
# docker-compose.yml
services:
  api:
    deploy:
      resources:
        limits:
          memory: 2G
```

**4. 端口被占用**

```bash
# 查看端口占用
netstat -tlnp | grep 3000

# 更改端口
PORT=3001 docker compose up
```

---

*最后更新：2026-03-18*
