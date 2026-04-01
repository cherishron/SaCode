---
name: "Setup"
---

# Setup Skill

指导用户完成 SaClaw 的初始设置和配置。

## 触发条件

- 用户首次使用 SaClaw
- 用户询问如何配置 SaClaw
- 用户需要设置 API 密钥或连接

## 使用指南

### 1. 检查环境

首先检查用户的环境配置：

```
- Node.js 版本是否 >= 22
- pnpm 是否已安装
- 是否有 .env 文件
```

### 2. 配置 iFlow SDK

引导用户配置 `.env` 文件：

```env
# iFlow SDK 配置
IFLOW_ACP_URL=ws://localhost:8090/acp
IFLOW_AUTO_START=true
IFLOW_TIMEOUT=60000

# 数据库配置
DATABASE_TYPE=sqlite
DATABASE_PATH=./data/saclaw.db

# OAuth 配置 (可选)
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
```

### 3. 初始化数据库

运行数据库初始化命令：

```bash
pnpm -C packages/database prisma generate
pnpm -C packages/database prisma db push
```

### 4. 启动服务

启动开发服务器：

```bash
pnpm dev
```

### 5. 验证安装

检查服务是否正常运行：

- API 服务: http://localhost:3000/api/health
- Web UI: http://localhost:3000

## 可用工具

所有工具可用，无限制。
