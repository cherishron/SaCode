import type { PrismaClient } from "@prisma/client";
import type { DatabaseAdapter, DatabaseConfig } from "./types";
import { SQLiteAdapter, MySQLAdapter, PostgreSQLAdapter } from "./adapter";

export class DatabaseManager {
  private adapter: DatabaseAdapter | null = null;

  async connect(config: DatabaseConfig): Promise<void> {
    if (this.adapter) {
      await this.disconnect();
    }

    switch (config.type) {
      case "sqlite":
        this.adapter = new SQLiteAdapter(config);
        break;
      case "mysql":
        this.adapter = new MySQLAdapter(config);
        break;
      case "postgres":
        this.adapter = new PostgreSQLAdapter(config);
        break;
      default:
        throw new Error(`Unsupported database type: ${config.type}`);
    }

    await this.adapter.connect();
  }

  async disconnect(): Promise<void> {
    if (this.adapter) {
      await this.adapter.disconnect();
      this.adapter = null;
    }
  }

  isConnected(): boolean {
    return this.adapter?.isConnected() ?? false;
  }

  getClient(): PrismaClient {
    if (!this.adapter) {
      throw new Error("Database not connected. Call connect() first.");
    }
    return this.adapter.getPrismaClient() as PrismaClient;
  }

  getAdapter(): DatabaseAdapter | null {
    return this.adapter;
  }
}

// 单例实例
let instance: DatabaseManager | null = null;

export function getDatabaseManager(): DatabaseManager {
  if (!instance) {
    instance = new DatabaseManager();
  }
  return instance;
}

export function resetDatabaseManager(): void {
  instance = null;
}
