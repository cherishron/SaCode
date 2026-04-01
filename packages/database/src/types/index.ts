import { z } from "zod";

export const DatabaseTypeSchema = z.enum(["sqlite", "mysql", "postgres"]);
export type DatabaseType = z.infer<typeof DatabaseTypeSchema>;

export interface DatabaseConfig {
  type: DatabaseType;
  // SQLite
  path?: string;
  // MySQL / PostgreSQL
  host?: string;
  port?: number;
  database?: string;
  username?: string;
  password?: string;
}

export interface DatabaseAdapter {
  type: DatabaseType;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  getPrismaClient(): unknown;
}
