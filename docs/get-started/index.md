# Quickstart

Get up and running with SaCode CLI in under 5 minutes.

## Prerequisites

- **Node.js** 22+
- **pnpm** 9+
- An AI Provider API key (OpenAI, Anthropic, DeepSeek, Moonshot, or 智谱)

## Installation

Terminal window

```bash
# Clone the repository
git clone https://github.com/STAND-ALONE/SaCode.git
cd SaCode

# Install dependencies
pnpm install

# Initialize the database
pnpm -C packages/database prisma generate
pnpm -C packages/database prisma db push

# Copy environment file
cp .env.example .env
```

## Configuration

Edit your `.env` file with your AI Provider credentials:

Terminal window

```env
# Select AI Provider: openai | anthropic | deepseek | moonshot | zhipu
AI_PROVIDER=openai
OPENAI_API_KEY=sk-your-api-key-here
AI_MODEL=gpt-4o
AI_TIMEOUT=60000

# Tool loop configuration
MAX_TOOL_LOOP_ITERATIONS=10

# Agentic planning
ENABLE_AGENTIC_PLANNING=true
```

See the full [environment variables reference](/docs/configuration/environment-variables/) for all options.

## Your first session

### Interactive chat

Start an interactive chat session:

Terminal window

```bash
pnpm cli chat
```

Or send a single message:

Terminal window

```bash
pnpm cli chat -m "你好，请介绍一下你自己"
```

### Agentic mode

Enable automatic planning for complex tasks:

Terminal window

```bash
pnpm cli chat -m "帮我分析这个项目的代码结构" --agentic
```

### Check system status

View the current system status:

Terminal window

```bash
pnpm cli status show
```

### List available models

See which AI models are configured:

Terminal window

```bash
pnpm cli model list
```

## Next steps

- **[Installation](/docs/get-started/installation/)** — Detailed installation guide for all platforms
- **[Authentication](/docs/get-started/authentication/)** — Setup local auth and OAuth providers
- **[CLI cheatsheet](/docs/cli/cli-reference/)** — Quick reference for all commands
- **[Use SaCode CLI](/docs/index.md#use-sacode-cli)** — Tutorials for daily workflows
