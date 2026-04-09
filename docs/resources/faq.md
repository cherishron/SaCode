# Frequently asked questions

Answers to common questions about SaCode CLI.

## General

### What is SaCode?

SaCode is a multi-platform AI assistant framework based on Provider abstraction. It supports 5 AI backends (OpenAI, Anthropic, DeepSeek, Moonshot, 智谱) and 10 IM platforms (微信, QQ, Telegram, Discord, 钉钉, 飞书, 小艺, WhatsApp, Slack, Email).

### What Node.js version is required?

Node.js 22+ is required. LTS versions are recommended for stability.

### Can I use SaCode with my existing AI provider?

Yes. SaCode supports OpenAI, Anthropic, DeepSeek, Moonshot, and 智谱 out of the box. You can also use any OpenAI-compatible API by setting `OPENAI_BASE_URL`.

### Is SaCode free?

Yes, SaCode is open source under the MulanPSL-2.0 license.

## Installation

### How do I install SaCode?

See the [installation guide](/docs/get-started/installation/) for detailed steps.

### Can I use Bun instead of Node.js?

The CLI package supports Bun runtime (`bun run --hot src/cli.ts`). However, the full project uses pnpm + Node.js for workspace management.

### How do I update SaCode?

Pull the latest changes and reinstall dependencies:

Terminal window

```bash
git pull
pnpm install
pnpm build
```

## Configuration

### How do I switch AI providers?

Change the `AI_PROVIDER` environment variable and set the corresponding API key:

Terminal window

```env
AI_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-your-key
```

### How do I use a proxy for OpenAI?

Set the `OPENAI_BASE_URL` environment variable:

Terminal window

```env
OPENAI_BASE_URL=https://your-proxy-url/v1
```

### Can I use multiple AI providers simultaneously?

Yes. Configure all API keys in your `.env` file and switch between them using `sacode model set <modelId>`.

### How do I connect an IM platform?

Use the CLI:

Terminal window

```bash
sacode im connect telegram -c '{"botToken": "your-token"}'
```

Or configure via environment variables and start the server.

## Usage

### How do I start a chat?

Terminal window

```bash
sacode chat
```

### How do I schedule a recurring task?

Terminal window

```bash
sacode cron add -n "Daily Report" -m "Generate daily report" -t cron -c "0 9 * * *" --channel telegram --to "chat_123"
```

### How do I search for and install skills?

Terminal window

```bash
sacode skills search telegram
sacode skills install add-telegram
```

### How do I check system status?

Terminal window

```bash
sacode status show
sacode status health
```

## Troubleshooting

### The CLI won't start

Ensure Node.js 22+ is installed and dependencies are installed:

Terminal window

```bash
node --version  # Should be 22+
pnpm install
```

### I get "Provider not initialized" errors

Check your `.env` file has the correct API key for your selected provider.

### Database errors on startup

Initialize the database:

Terminal window

```bash
pnpm -C packages/database prisma generate
pnpm -C packages/database prisma db push
```

### IM platform won't connect

Verify the platform's credentials in your `.env` file and check the connection logs with `sacode status diagnose`.

## Next steps

- **[Troubleshooting](/docs/resources/troubleshooting/)** — Common issues and solutions
- **[Configuration reference](/docs/reference/configuration/)** — All settings
- **[CLI cheatsheet](/docs/cli/cli-reference/)** — Quick command reference
