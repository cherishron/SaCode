import { PrismaClient } from "@prisma/client";
import type { DatabaseAdapter, DatabaseConfig } from "../types";

export class SQLiteAdapter implements DatabaseAdapter {
  readonly type = "sqlite" as const;
  private client: PrismaClient | null = null;
  private config: DatabaseConfig;

  constructor(config: DatabaseConfig) {
    this.config = config;
  }

  async connect(): Promise<void> {
    if (this.client) {
      return;
    }

    const databaseUrl = this.config.path
      ? `file:${this.config.path}`
      : "file:./data/saclaw.db";

    this.client = new PrismaClient({
      datasourceUrl: databaseUrl,
    });

    await this.client.$connect();
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.$disconnect();
      this.client = null;
    }
  }

  isConnected(): boolean {
    return this.client !== null;
  }

  getPrismaClient(): PrismaClient {
    if (!this.client) {
      throw new Error("Database not connected. Call connect() first.");
    }
    return this.client;
  }
}
