# Uninstall

How to uninstall SaCode CLI and clean up all related data.

## Remove CLI

### If installed globally

Terminal window

```bash
pnpm remove -g @sacode/cli
```

### If running from source

Simply delete the project directory:

Terminal window

```bash
rm -rf /path/to/SaCode
```

## Clean up data

### Remove database

Terminal window

```bash
# SQLite (default)
rm -rf ./data/

# MySQL/PostgreSQL
# Drop the database manually via your database client
```

### Remove configuration

Terminal window

```bash
rm -rf ./.sacode/
rm -f ./.env
```

### Remove node_modules

Terminal window

```bash
rm -rf node_modules/
rm -rf packages/*/node_modules/
```

### Remove build artifacts

Terminal window

```bash
rm -rf packages/*/dist/
```

## Full cleanup script

Terminal window

```bash
# Remove all SaCode data
rm -rf ./data/
rm -rf ./.sacode/
rm -f ./.env
rm -rf node_modules/
rm -rf packages/*/node_modules/
rm -rf packages/*/dist/
```

## Next steps

- **[Installation](/docs/get-started/installation/)** — Reinstall SaCode
- **[Troubleshooting](/docs/resources/troubleshooting/)** — If you're uninstalling due to issues
