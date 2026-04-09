# Local development

Setting up a local development environment for SaCode.

## Prerequisites

| Tool    | Version | Purpose         |
| ------- | ------- | --------------- |
| Node.js | 22+     | Runtime         |
| pnpm    | 9+      | Package manager |
| Git     | 2.40+   | Version control |
| VS Code | Latest  | Recommended IDE |

## Setup

### Clone and install

Terminal window

```bash
git clone https://github.com/STAND-ALONE/SaCode.git
cd SaCode
pnpm install
```

### Initialize database

Terminal window

```bash
pnpm -C packages/database prisma generate
pnpm -C packages/database prisma db push
```

### Configure environment

Terminal window

```bash
cp .env.example .env
```

Edit `.env` with your AI Provider credentials.

## Development workflow

### Start all packages

Terminal window

```bash
pnpm dev
```

This starts all packages in watch mode with hot reloading.

### Start individual packages

Terminal window

```bash
# API server only
pnpm -C packages/api dev

# Web UI only
pnpm -C packages/web dev

# CLI only
pnpm cli chat
```

### Build

Terminal window

```bash
pnpm build
```

### Run tests

Terminal window

```bash
pnpm test              # Run all tests
pnpm test:watch        # Watch mode
pnpm test:coverage     # Coverage report
```

### Code quality

Terminal window

```bash
pnpm lint              # ESLint check
pnpm typecheck         # TypeScript type check
pnpm format            # Prettier formatting
```

## Debugging

### VS Code debugging

Create `.vscode/launch.json`:

Terminal window

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "node",
      "request": "launch",
      "name": "Debug API",
      "runtimeExecutable": "pnpm",
      "runtimeArgs": ["-C", "packages/api", "dev"],
      "console": "integratedTerminal"
    },
    {
      "type": "node",
      "request": "launch",
      "name": "Debug CLI",
      "runtimeExecutable": "pnpm",
      "runtimeArgs": ["cli", "chat"],
      "console": "integratedTerminal"
    }
  ]
}
```

### Debug mode

Terminal window

```bash
sacode chat -d
```

### Database debugging

Terminal window

```bash
# Open Prisma Studio (database GUI)
pnpm -C packages/database prisma studio

# Create a migration
pnpm -C packages/database prisma migrate dev --name add_new_table

# Reset database
pnpm -C packages/database prisma migrate reset
```

## Package dependency graph

```
@sacode/types (no internal deps)
    ↓
@sacode/container
    ↓
@sacode/core (depends on types, container)
    ↓
@sacode/database
    ↓
@sacode/auth (depends on database)
    ↓
@sacode/capabilities
    ↓
@sacode/adapters (depends on types)
    ↓
@sacode/api (depends on adapters, auth, core, database, capabilities)
    ↓
@sacode/web (depends on api, auth, core)
@sacode/cli (depends on core)
```

## Adding a new package

1. Create the package directory: `packages/my-package/`
2. Add `package.json` with `@sacode/my-package` name
3. Add `tsconfig.json` extending `tsconfig.base.json`
4. Add to `pnpm-workspace.yaml` if needed
5. Run `pnpm install` to link the workspace

## Next steps

- **[Contribution guide](/docs/CONTRIBUTING.md)** — How to contribute
- **[Architecture](/docs/architecture/architecture.md)** — System architecture
- **[Project documentation](/docs/PROJECT-DOCUMENTATION.md)** — Complete project docs
