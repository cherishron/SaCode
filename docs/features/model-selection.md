# Model selection

Choose the best model for your needs in SaCode CLI.

## Overview

SaCode supports 5 AI providers with multiple models each. The `ModelManager` in `@sacode/core` handles model selection, capability matching, and load balancing.

## Supported providers and models

| Provider      | Models                                   | Capabilities                |
| ------------- | ---------------------------------------- | --------------------------- |
| **OpenAI**    | `gpt-4o`, `gpt-4-turbo`, `gpt-3.5-turbo` | Streaming, Tools, Vision    |
| **Anthropic** | `claude-3-5-sonnet`, `claude-3-opus`     | Streaming, Tool Use, Vision |
| **DeepSeek**  | `deepseek-chat`, `deepseek-coder`        | Streaming, Tools            |
| **Moonshot**  | `moonshot-v1-8k`, `moonshot-v1-32k`      | Streaming, Tools            |
| **智谱**      | `glm-4`, `glm-4-flash`                   | Streaming, Tools            |

## Selecting a model

### Via CLI

Terminal window

```bash
# List available models
sacode model list

# Set default model
sacode model set gpt-4o

# Check current model
sacode model current
```

### Via configuration

Terminal window

```env
AI_PROVIDER=openai
AI_MODEL=gpt-4o
```

### Via API

Terminal window

```bash
curl http://localhost:3000/api/models
```

## Model configuration

Fine-tune model parameters:

Terminal window

```bash
sacode model configure gpt-4o -t 0.7 -m 4096 -p 0.9
```

| Parameter       | Range           | Default          | Description                |
| --------------- | --------------- | ---------------- | -------------------------- |
| **Temperature** | 0.0 - 2.0       | 1.0              | Creativity vs determinism  |
| **Max tokens**  | 1 - model limit | Provider default | Maximum output length      |
| **Top-p**       | 0.0 - 1.0       | 1.0              | Nucleus sampling threshold |

## Capability matching

The `ModelManager` can automatically select models based on required capabilities:

```typescript
const modelManager = new ModelManager({
  models: [
    { id: "gpt-4", provider: "openai", capabilities: ["chat", "code"] },
    { id: "claude-3", provider: "anthropic", capabilities: ["chat", "analysis"] },
  ],
  strategy: "capability-match",
});

const model = modelManager.selectFor(["code"]);
// Returns: gpt-4
```

## Load balancing

When multiple models are available, the manager can distribute requests:

| Strategy           | Description                                   |
| ------------------ | --------------------------------------------- |
| `capability-match` | Select model based on required capabilities   |
| `round-robin`      | Distribute evenly across models               |
| `cost-optimized`   | Choose cheapest model that meets requirements |

## Next steps

- **[Model routing](/docs/features/model-routing/)** — Smart message routing
- **[Configuration reference](/docs/reference/configuration/)** — All settings
- **[CLI cheatsheet](/docs/cli/cli-reference.md#model-management)** — Model commands
