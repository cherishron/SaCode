/**
 * 安全存储 — API Key 加密存储
 * 使用 AES-256-GCM 加密，密钥派生自机器指纹
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir, hostname, userInfo } from "os";
import { createCipheriv, createDecipheriv, randomBytes, createHash } from "crypto";

const STORE_DIR = join(homedir(), ".sacode");
const STORE_FILE = join(STORE_DIR, "codingplan.json");
const ALGORITHM = "aes-256-gcm";

/**
 * 派生加密密钥（基于机器指纹）
 */
function deriveKey(): Buffer {
  const fingerprint = `${hostname()}-${userInfo().username}-${process.platform}`;
  return createHash("sha256").update(fingerprint).digest();
}

/**
 * 加密文本
 */
export function encrypt(text: string): string {
  const key = deriveKey();
  const iv = randomBytes(16);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");

  const authTag = cipher.getAuthTag();

  return [
    iv.toString("hex"),
    authTag.toString("hex"),
    encrypted,
  ].join(":");
}

/**
 * 解密文本
 */
export function decrypt(encryptedText: string): string {
  const key = deriveKey();
  const parts = encryptedText.split(":");

  if (parts.length !== 3) {
    throw new Error("Invalid encrypted format");
  }

  const ivHex = parts[0]!;
  const authTagHex = parts[1]!;
  const encrypted = parts[2]!;

  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
}

/**
 * 读取存储文件
 */
export function readStore<T>(defaultValue: T): T {
  if (!existsSync(STORE_FILE)) {
    return defaultValue;
  }

  try {
    const content = readFileSync(STORE_FILE, "utf-8");
    return JSON.parse(content) as T;
  } catch {
    return defaultValue;
  }
}

/**
 * 写入存储文件
 */
export function writeStore(data: unknown): void {
  if (!existsSync(STORE_DIR)) {
    mkdirSync(STORE_DIR, { recursive: true });
  }

  writeFileSync(STORE_FILE, JSON.stringify(data, null, 2), "utf-8");
}

/**
 * 获取存储文件路径
 */
export function getStorePath(): string {
  return STORE_FILE;
}
