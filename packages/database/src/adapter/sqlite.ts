import { createClient, type Client as LibsqlClient } from "@libsql/client";
import { PrismaLibSQL } from "@prisma/adapter-libsql";
import { PrismaClient } from "@prisma/client";
import type { DatabaseAdapter, DatabaseConfig } from "../types";

export class SQLiteAdapter implements DatabaseAdapter {
  readonly type = "sqlite" as const;
  private client: PrismaClient | null = null;
  private libsqlClient: LibsqlClient | null = null;
  private config: DatabaseConfig;

  constructor(config: DatabaseConfig) {
    this.config = config;
  }

  async connect(): Promise<void> {
    if (this.client) {
      return;
    }

    const dbPath = this.config.path ?? "./data/sacode.db";

    // libsql 使用 file: URL 格式
    const databaseUrl = dbPath.startsWith("file:") ? dbPath : `file:${dbPath}`;

    // 创建 libsql 客户端
    this.libsqlClient = createClient({
      url: databaseUrl,
    });

    // 使用 libsql 适配器包装 Prisma
    const adapter = new PrismaLibSQL(this.libsqlClient);

    this.client = new PrismaClient({
      adapter,
    } as never);

    await this.client.$connect();
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.$disconnect();
      this.client = null;
    }
    if (this.libsqlClient) {
      this.libsqlClient.close();
      this.libsqlClient = null;
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
