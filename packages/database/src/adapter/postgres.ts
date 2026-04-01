import { PrismaClient } from "@prisma/client";
import type { DatabaseAdapter, DatabaseConfig } from "../types";

export class PostgreSQLAdapter implements DatabaseAdapter {
  readonly type = "postgres" as const;
  private client: PrismaClient | null = null;
  private config: DatabaseConfig;

  constructor(config: DatabaseConfig) {
    this.config = config;
  }

  async connect(): Promise<void> {
    if (this.client) {
      return;
    }

    const { host = "localhost", port = 5432, database, username, password } = this.config;

    const databaseUrl = `postgresql://${username}:${password}@${host}:${port}/${database}`;

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
