# Sandboxing

Isolate tool execution in SaCode CLI.

## Overview

SaCode provides sandboxing capabilities through Docker container isolation (`@sacode/container`). This allows safe execution of AI-generated code and commands without risking the host system.

## How sandboxing works

```
┌─────────────────────────────────────────────────┐
│                   Host System                    │
│                                                  │
│  ┌───────────────────────────────────────────┐  │
│  │           Docker Container                │  │
│  │  ┌─────────┐  ┌─────────┐  ┌───────────┐ │  │
│  │  │  Files  │  │ Browser │  │   Shell   │ │  │
│  │  │ System  │  │ Control │  │ Commands  │ │  │
│  │  └─────────┘  └─────────┘  └───────────┘ │  │
│  │                                           │  │
│  │  Resource Limits:                         │  │
│  │  - CPU: 1.0 cores                         │  │
│  │  - Memory: 512MB                          │  │
│  │  - Network: isolated                      │  │
│  └───────────────────────────────────────────┘  │
│                                                  │
└──────────────────────────────────────────────────┘
```

## Container configuration

```typescript
import { ContainerManager } from "@sacode/container";

const container = new ContainerManager({
  image: "sacode-agent:latest",
  sandbox: true,
  resourceLimits: {
    cpu: "1.0",
    memory: "512m",
  },
});

await container.start();
```

## Resource limits

| Resource       | Default     | Description                         |
| -------------- | ----------- | ----------------------------------- |
| **CPU**        | `1.0` cores | Maximum CPU allocation              |
| **Memory**     | `512m`      | Maximum memory allocation           |
| **Network**    | Isolated    | Container network isolation         |
| **Filesystem** | Scoped      | Only allowed directories accessible |

## Security boundaries

| Boundary        | Description                       |
| --------------- | --------------------------------- |
| **File access** | Restricted to `allowedDirs`       |
| **Network**     | Container network namespace       |
| **Process**     | Isolated process tree             |
| **Resources**   | CPU and memory limits via cgroups |

## When to use sandboxing

| Scenario                          | Recommendation        |
| --------------------------------- | --------------------- |
| **Running untrusted code**        | ✅ Always use sandbox |
| **Testing AI-generated scripts**  | ✅ Use sandbox        |
| **Production deployments**        | ✅ Use sandbox        |
| **Development with trusted code** | ⚠️ Optional           |
| **Read-only operations**          | ❌ Not needed         |

## Docker setup

Ensure Docker is installed and running:

Terminal window

```bash
# Check Docker
docker --version

# Build SaCode container image
pnpm docker:build

# Start with sandbox
pnpm docker:up
```

## Next steps

- **[Execute shell commands](/docs/cli/tutorials/shell-commands/)** — Shell capabilities
- **[File management](/docs/cli/tutorials/file-management/)** — File operations
- **[Container package](/docs/architecture/modules.md)** — Container architecture
