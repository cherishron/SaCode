# Troubleshooting

Common issues and solutions for SaCode CLI.

## Installation issues

### Node.js version too old

**Symptom:** TypeScript compilation errors or runtime failures.

**Solution:** Ensure Node.js 22+ is installed.

Terminal window

```bash
node --version
```

If below 22, upgrade via your package manager or [nvm](https://github.com/nvm-sh/nvm).

### pnpm not found

**Symptom:** `pnpm: command not found`

**Solution:** Install pnpm globally:

Terminal window

```bash
npm install -g pnpm
```

### Dependency installation fails

**Symptom:** `pnpm install` fails with network or resolution errors.

**Solution:**

Terminal window

```bash
# Clear pnpm store
pnpm store prune

# Retry with verbose output
pnpm install --reporter=append-only
```

## Database issues

### Prisma Client not generated

**Symptom:** `@prisma/client` import errors.

**Solution:**

Terminal window

```bash
pnpm -C packages/database prisma generate
```

### Database migration fails

**Symptom:** `prisma migrate dev` fails with schema errors.

**Solution:**

Terminal window

```bash
# Reset database (WARNING: deletes all data)
pnpm -C packages/database prisma migrate reset

# Or push schema directly (development only)
pnpm -C packages/database prisma db push --force-reset
```

### SQLite file not found

**Symptom:** `SQLITE_CANTOPEN` error.

**Solution:** Ensure the database directory exists:

Terminal window

```bash
mkdir -p data
```

## AI Provider issues

### API key not working

**Symptom:** `401 Unauthorized` or `Invalid API key` errors.

**Solution:**

1. Verify the API key in your `.env` file
2. Check the key is active in your provider's dashboard
3. Test with a direct curl request:

Terminal window

```bash
curl https://api.openai.com/v1/models \
  -H "Authorization: Bearer $OPENAI_API_KEY"
```

### Model not found

**Symptom:** `model_not_found` error.

**Solution:** Check `AI_MODEL` matches your provider's available models. Use `sacode model list` to see configured models.

### Request timeout

**Symptom:** Requests timeout after 60 seconds.

**Solution:** Increase `AI_TIMEOUT` in your `.env`:

Terminal window

```env
AI_TIMEOUT=120000
```

## IM Platform issues

### Telegram bot won't connect

**Symptom:** Connection refused or 401 errors.

**Solution:**

1. Verify `TELEGRAM_BOT_TOKEN` is correct
2. Check the bot is enabled in BotFather
3. Test with: `curl https://api.telegram.org/bot<TOKEN>/getMe`

### Discord bot offline

**Symptom:** Bot shows as offline in Discord.

**Solution:**

1. Verify `DISCORD_BOT_TOKEN` is correct
2. Check bot permissions in Discord Developer Portal
3. Ensure the `bot` scope is enabled

### 钉钉 AI Card not streaming

**Symptom:** Messages send but don't update in real-time.

**Solution:**

1. Verify `DINGTALK_APP_KEY`, `DINGTALK_APP_SECRET`, and `robotCode` are correct
2. Check `cardTemplateId` is configured
3. Ensure `streamingEnabled: true` in the adapter config

## CLI issues

### Command not found

**Symptom:** `sacode: command not found`

**Solution:** Use `pnpm cli` from the project root, or install globally:

Terminal window

```bash
pnpm add -g @sacode/cli
```

### Chat mode hangs

**Symptom:** `sacode chat` starts but doesn't respond.

**Solution:**

1. Check AI Provider is configured (`AI_PROVIDER` and API key)
2. Run with debug mode: `sacode chat -d`
3. Check network connectivity to the AI provider

### Session not found

**Symptom:** `sacode chat -s <id>` fails with session not found.

**Solution:** List available sessions first:

Terminal window

```bash
sacode session list
```

## Server issues

### Port already in use

**Symptom:** `EADDRINUSE` error on startup.

**Solution:** Use a different port:

Terminal window

```bash
sacode start -p 3001
```

Or kill the process using the port:

Terminal window

```bash
# Windows
netstat -ano | findstr :3000
taskkill /PID <PID> /F

# macOS/Linux
lsof -i :3000
kill -9 <PID>
```

### WebSocket connection failed

**Symptom:** Web UI shows "Disconnected" or connection errors.

**Solution:**

1. Ensure the API server is running (`sacode start --api`)
2. Check `BASE_URL` in the web configuration
3. Verify no firewall is blocking the port

## Performance issues

### High memory usage

**Symptom:** Process uses more than 512MB RAM at idle.

**Solution:**

1. Check for memory leaks in plugins
2. Reduce `MEMORY_MAX_MESSAGES`
3. Use Redis backend for cache instead of memory

### Slow response times

**Symptom:** AI responses take more than 10 seconds.

**Solution:**

1. Check network latency to AI provider
2. Use a faster model (e.g., `gpt-4o-mini` instead of `gpt-4o`)
3. Enable caching (`CACHE_BACKEND=redis`)

## Getting help

If your issue isn't covered here:

1. Check the [FAQ](/docs/resources/faq/) for common questions
2. Search existing [GitHub Issues](https://github.com/STAND-ALONE/SaCode/issues)
3. Run diagnostics: `sacode status diagnose`
4. Open a new issue with:
   - Error message
   - Steps to reproduce
   - Environment info (`node --version`, `pnpm --version`, OS)
   - `sacode status diagnose` output

## Next steps

- **[FAQ](/docs/resources/faq/)** — Frequently asked questions
- **[Configuration reference](/docs/reference/configuration/)** — All settings
- **[Contribution guide](/docs/CONTRIBUTING.md)** — How to contribute fixes
