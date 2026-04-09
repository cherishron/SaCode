# Manage context and memory

Learn how to manage conversation memory and context in SaCode CLI.

## Overview

SaCode provides a multi-layered memory system through `MemoryManager` and `EnhancedMemoryManager` in `@sacode/core`. This system manages conversation history, context windows, and persistent memory.

## Memory layers

| Layer                   | Description                             | Backend         |
| ----------------------- | --------------------------------------- | --------------- |
| **Conversation memory** | Short-term chat history                 | In-memory       |
| **Session memory**      | Persistent session context              | Database        |
| **Vector memory**       | Semantic search over past conversations | Embedding model |

## Using memory in chat

The AI model automatically uses conversation memory to maintain context across messages:

Terminal window

```bash
sacode chat -m "记住我喜欢用 TypeScript"
sacode chat -m "我刚才说了什么编程语言偏好？"
```

## Memory API

```typescript
import { MemoryManager } from "@sacode/core";

const memory = new MemoryManager();

// Add to memory
await memory.add(sessionId, { role: "user", content: "I prefer TypeScript" });

// Retrieve memory
const history = await memory.get(sessionId);

// Clear memory
await memory.clear(sessionId);
```

## Enhanced memory with vector search

```typescript
import { EnhancedMemoryManager } from "@sacode/core";

const enhancedMemory = new EnhancedMemoryManager({
  backend: "sqlite",
  embeddingModel: "default",
});

// Store with embedding
await enhancedMemory.store(sessionId, "User prefers TypeScript for web development");

// Semantic search
const results = await enhancedMemory.search(sessionId, "programming language preferences");
```

## Context window management

SaCode manages the AI model's context window automatically:

- Messages are accumulated within the session
- When the context approaches the model's limit, older messages are trimmed
- The system message and recent messages are always preserved

## Configuration

Terminal window

```env
# Memory backend
MEMORY_BACKEND=memory  # memory | sqlite

# Maximum messages per session
MEMORY_MAX_MESSAGES=100

# Enable vector embeddings
MEMORY_ENABLE_EMBEDDINGS=false
```

## Next steps

- **[Session management](/docs/cli/tutorials/session-management/)** — Manage conversation sessions
- **[Memory management API](/docs/api/memory.md)** — REST API for memory
- **[Model configuration](/docs/configuration/model-configuration/)** — Tune model parameters
