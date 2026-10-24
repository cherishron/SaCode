/**
 * 内存滑动窗口限流。登录接口使用：按“账号 + 来源 IP” 5 次/15 分钟。
 * 不采用永久锁定，避免被恶意永久锁死合法账号。
 */
export class SlidingWindowLimiter {
  private hits = new Map<string, number[]>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  allow(key: string): boolean {
    const now = Date.now();
    const arr = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (arr.length >= this.max) {
      this.hits.set(key, arr);
      return false;
    }
    arr.push(now);
    this.hits.set(key, arr);
    return true;
  }

  reset(key: string): void {
    this.hits.delete(key);
  }
}
