// Types
export * from "./types";

// Manager
export { MemoryManager, createMemoryManager } from "./manager";
export type { MemoryCompactCallback } from "./manager";

// Enhanced Manager (SQLite + Vector Search)
export {
  EnhancedMemoryManager,
  createEnhancedMemoryManager,
  OpenAIEmbeddingService,
  createOpenAIEmbeddingService,
  EnhancedMemoryConfigSchema,
} from "./enhanced";
export type {
  EnhancedMemoryConfig,
  MemoryEntry,
  MemorySearchResult,
  EmbeddingService,
} from "./enhanced";
