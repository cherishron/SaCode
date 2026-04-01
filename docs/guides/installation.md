# Installation Guide

> SaClaw installation and setup instructions

---

## System Requirements

| Requirement | Minimum | Recommended |
|-------------|---------|-------------|
| Node.js | 22.0.0 | 22.12.0+ |
| pnpm | 9.0.0 | 9.15.0+ |
| RAM | 512MB | 2GB+ |
| Disk | 500MB | 1GB+ |

---

## Quick Start

### 1. Clone Repository

```bash
git clone https://github.com/STAND-ALONE/SaClaw.git
cd SaClaw
```

### 2. Install Dependencies

```bash
pnpm install
```

### 3. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` with your configuration:

```env
# Server
PORT=3000
HOST=localhost

# Database
DATABASE_TYPE=sqlite
DATABASE_PATH=./data/saclaw.db

# AI Provider (choose one)
AI_PROVIDER=openai
OPENAI_API_KEY=sk-...

# OR
AI_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-...

# JWT Secret
JWT_SECRET=your-secret-key-here
```

### 4. Initialize Database

```bash
pnpm -C packages/database prisma generate
pnpm -C packages/database prisma db push
```

### 5. Start Server

```bash
# Development mode
pnpm dev

# Or start API and Web separately
pnpm api    # API server on port 3000
pnpm web    # Web UI on port 5173
```

### 6. Access Application

- Web UI: http://localhost:5173
- API: http://localhost:3000

---

## Docker Installation

### Using Docker Compose

```bash
# Start all services
pnpm docker:up

# Or with docker-compose directly
docker-compose up -d
```

### Building Docker Image

```bash
pnpm docker:build
```

### Docker Configuration

The `docker-compose.yml` includes:
- SaClaw API server
- SaClaw Web UI
- Redis (optional, for caching)

---

## Configuration

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | 3000 | Server port |
| `HOST` | No | localhost | Server host |
| `DATABASE_TYPE` | No | sqlite | Database type |
| `DATABASE_PATH` | No | ./data/saclaw.db | SQLite path |
| `DATABASE_URL` | No | - | MySQL/PostgreSQL URL |
| `JWT_SECRET` | Yes | - | JWT signing secret |
| `AI_PROVIDER` | No | openai | Default AI provider |

### AI Provider Configuration

| Provider | Variable | Description |
|----------|----------|-------------|
| OpenAI | `OPENAI_API_KEY` | API key |
| OpenAI | `OPENAI_MODEL` | Model (default: gpt-4o) |
| Anthropic | `ANTHROPIC_API_KEY` | API key |
| Anthropic | `ANTHROPIC_MODEL` | Model (default: claude-3-5-sonnet-latest) |
| DeepSeek | `DEEPSEEK_API_KEY` | API key |
| Moonshot | `MOONSHOT_API_KEY` | API key |
| Zhipu | `ZHIPU_API_KEY` | API key |

### OAuth Configuration

| Provider | Variables |
|----------|-----------|
| GitHub | `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` |
| Google | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` |
| WeChat | `WECHAT_APP_ID`, `WECHAT_APP_SECRET` |
| QQ | `QQ_APP_ID`, `QQ_APP_KEY` |
| WeCom | `WEWORK_CORP_ID`, `WEWORK_AGENT_ID`, `WEWORK_SECRET` |

### IM Platform Configuration

| Platform | Variables |
|----------|-----------|
| Telegram | `TELEGRAM_BOT_TOKEN` |
| Discord | `DISCORD_BOT_TOKEN` |
| DingTalk | `DINGTALK_APP_KEY`, `DINGTALK_APP_SECRET` |
| Feishu | `FEISHU_APP_ID`, `FEISHU_APP_SECRET` |
| Xiaoyi | `XIAOYI_AK`, `XIAOYI_SK`, `XIAOYI_AGENT_ID` |

---

## Database Setup

### SQLite (Development)

Default, no additional setup needed.

### MySQL

```env
DATABASE_TYPE=mysql
DATABASE_URL=mysql://user:password@localhost:3306/saclaw
```

### PostgreSQL

```env
DATABASE_TYPE=postgres
DATABASE_URL=postgresql://user:password@localhost:5432/saclaw
```

### Run Migrations

```bash
pnpm -C packages/database prisma migrate deploy
```

---

## Production Deployment

### Build for Production

```bash
pnpm build
```

### Start Production Server

```bash
pnpm start
```

### Environment Checklist

- [ ] Set `NODE_ENV=production`
- [ ] Use strong `JWT_SECRET`
- [ ] Configure production database
- [ ] Set up HTTPS
- [ ] Configure OAuth redirect URIs
- [ ] Review rate limiting settings

---

## Troubleshooting

### Port Already in Use

```bash
# Find process using port
netstat -ano | findstr :3000

# Kill process (Windows)
taskkill /PID <pid> /F
```

### Database Connection Failed

1. Check database credentials
2. Verify database server is running
3. Check firewall settings

### API Key Invalid

1. Verify API key is correct
2. Check if key has required permissions
3. Ensure key is not expired

### OAuth Not Working

1. Verify redirect URI matches configuration
2. Check OAuth app credentials
3. Review provider-specific requirements

---

## Upgrading

### Update Dependencies

```bash
pnpm update
```

### Run Migrations

```bash
pnpm -C packages/database prisma migrate deploy
```

### Clear Cache

```bash
rm -rf node_modules/.cache
```

---

*Document Version: 1.0.0*
*Last Updated: 2026-03-19*
