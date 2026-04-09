# Model routing

Smart routing with rule engine for messages across channels and providers.

## Overview

SaCode's `SmartRouter` provides rule-based message routing through a configurable rule engine. Messages are evaluated against conditions and routed to the appropriate channel, provider, or handler.

## How routing works

```
Message → Evaluate Rules (by priority) → Execute Actions
```

Rules are evaluated in priority order (highest first). The first matching rule's actions are executed.

## Rule structure

```typescript
interface RoutingRule {
  id: string;
  name: string;
  priority: number;
  enabled: boolean;
  conditions: Condition[];
  actions: Action[];
}
```

### Conditions

| Field            | Operator | Value      | Example           |
| ---------------- | -------- | ---------- | ----------------- |
| `user.tier`      | `eq`     | `vip`      | VIP users         |
| `platform`       | `eq`     | `telegram` | Telegram messages |
| `message.length` | `gt`     | `1000`     | Long messages     |

### Actions

| Type       | Description        | Example                         |
| ---------- | ------------------ | ------------------------------- |
| `route`    | Route to a channel | Route to `premium-support`      |
| `model`    | Select a model     | Use `gpt-4` for complex queries |
| `provider` | Select a provider  | Route to Anthropic              |

## Example rules

Terminal window

```typescript
const router = new SmartRouter();

// VIP users get premium model
router.addRule({
  id: "vip-priority",
  name: "VIP 优先",
  priority: 100,
  enabled: true,
  conditions: [{ field: "user.tier", operator: "eq", value: "vip" }],
  actions: [{ type: "model", model: "gpt-4" }],
});

// Telegram messages use faster model
router.addRule({
  id: "telegram-fast",
  name: "Telegram 快速响应",
  priority: 50,
  enabled: true,
  conditions: [{ field: "platform", operator: "eq", value: "telegram" }],
  actions: [{ type: "model", model: "gpt-4o-mini" }],
});
```

## Managing routing rules via CLI

Rules are managed through the REST API:

Terminal window

```bash
# List rules
curl http://localhost:3000/api/routing/rules

# Add a rule
curl -X POST http://localhost:3000/api/routing/rules \
  -H "Content-Type: application/json" \
  -d '{"name": "VIP", "priority": 100, ...}'

# Evaluate a rule
curl -X POST http://localhost:3000/api/routing/evaluate \
  -H "Content-Type: application/json" \
  -d '{"user": {"tier": "vip"}, "platform": "telegram"}'
```

## Next steps

- **[Model selection](/docs/features/model-selection/)** — Choose the best model
- **[SmartRouter tests](/docs/architecture/modules.md)** — Router architecture
- **[Routing API](/docs/api/routing.md)** — REST API documentation
