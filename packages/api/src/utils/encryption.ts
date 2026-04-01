import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const SALT_LENGTH = 32;

/**
 * 获取加密密钥
 * 生产环境必须设置 ENCRYPTION_KEY 环境变量
 */
function getEncryptionKey(): Buffer {
  const secret = process.env.ENCRYPTION_KEY;
  
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("ENCRYPTION_KEY environment variable is required in production");
    }
    console.warn("⚠️  WARNING: Using default encryption key. Set ENCRYPTION_KEY in production.");
  }
  
  // 使用 scrypt 派生密钥，确保密钥长度正确
  const password = secret || "saclaw-default-encryption-key-change-in-production";
  const salt = "saclaw-encryption-salt"; // 固定盐值用于密钥派生
  
  return scryptSync(password, salt, 32);
}

/**
 * 加密敏感数据
 * 使用 AES-256-GCM 算法，提供认证加密
 * 
 * @param plaintext 明文
 * @returns Base64 编码的密文（包含 IV 和 AuthTag）
 */
export function encrypt(plaintext: string): string {
  if (!plaintext) return "";
  
  const key = getEncryptionKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  
  let encrypted = cipher.update(plaintext, "utf-8", "base64");
  encrypted += cipher.final("base64");
  
  const authTag = cipher.getAuthTag();
  
  // 格式: iv:authTag:encrypted (都是 base64)
  return `${iv.toString("base64")}:${authTag.toString("base64")}:${encrypted}`;
}

/**
 * 解密敏感数据
 * 
 * @param ciphertext Base64 编码的密文
 * @returns 明文
 */
export function decrypt(ciphertext: string): string {
  if (!ciphertext) return "";
  
  try {
    // 检查是否是旧格式（纯 base64，无冒号分隔）
    if (!ciphertext.includes(":")) {
      // 向后兼容：旧的 base64 编码格式
      console.warn("⚠️  Detected legacy encryption format, migrating...");
      return Buffer.from(ciphertext, "base64").toString("utf-8");
    }
    
    const key = getEncryptionKey();
    const parts = ciphertext.split(":");
    
    if (parts.length !== 3) {
      throw new Error("Invalid ciphertext format");
    }
    
    const [ivBase64, authTagBase64, encrypted] = parts;
    const iv = Buffer.from(ivBase64!, "base64");
    const authTag = Buffer.from(authTagBase64!, "base64");
    
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encrypted!, "base64", "utf-8");
    decrypted += decipher.final("utf-8");
    
    return decrypted;
  } catch (error) {
    console.error("Decryption failed:", error);
    return "";
  }
}

/**
 * 加密 API Key（语义化别名）
 */
export const encryptApiKey = encrypt;

/**
 * 解密 API Key（语义化别名）
 */
export const decryptApiKey = decrypt;

/**
 * 加密 OAuth Secret
 */
export const encryptOAuthSecret = encrypt;

/**
 * 解密 OAuth Secret
 */
export const decryptOAuthSecret = decrypt;
