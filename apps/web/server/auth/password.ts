import { verify, hash } from '@node-rs/argon2';

// Argon2id 参数（OWASP 基线附近）；W01 在本机实测 100–300ms，超出再调。
const ARGON2_OPTS = {
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

/** 校验口令；异常（坏哈希格式等）一律返回 false，不抛。 */
export async function verifyPassword(hashStr: string, plain: string): Promise<boolean> {
  try {
    return await verify(hashStr, plain, ARGON2_OPTS);
  } catch {
    return false;
  }
}

export async function hashPassword(plain: string): Promise<string> {
  return hash(plain, ARGON2_OPTS);
}

let dummyHashPromise: Promise<string> | null = null;

/**
 * 用于不存在用户的最小代价占位哈希，避免登录时因“用户是否存在”产生可枚举的时间差。
 */
export function getDummyHash(): Promise<string> {
  if (!dummyHashPromise) {
    dummyHashPromise = hashPassword('__sacode_nonexistent_placeholder__');
  }
  return dummyHashPromise;
}
