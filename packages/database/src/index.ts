import type { PrismaClient } from "@prisma/client";
import type { DatabaseConfig } from "./types";
import { getDatabaseManager } from "./manager";

// 导出类型
export * from "./types";

// 导出适配器
export * from "./adapter";

// 导出管理器
export { DatabaseManager, getDatabaseManager, resetDatabaseManager } from "./manager";

// 导出 Prisma 客户端类型
export type { PrismaClient } from "@prisma/client";

// 便捷函数
export async function createDatabase(config: DatabaseConfig): Promise<PrismaClient> {
  const manager = getDatabaseManager();
  await manager.connect(config);
  return manager.getClient();
}

export async function disconnectDatabase(): Promise<void> {
  const manager = getDatabaseManager();
  await manager.disconnect();
}

export function getPrismaClient(): PrismaClient {
  return getDatabaseManager().getClient();
}
