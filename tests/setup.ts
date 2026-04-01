/**
 * Vitest 测试设置文件
 * 在所有测试运行前执行
 */

import { beforeAll, afterAll, vi } from "vitest";

// Mock WebSocket for Node.js environment
class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = MockWebSocket.OPEN;
  onopen: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;

  constructor(_url: string | URL) {
    setTimeout(() => {
      this.onopen?.(new Event("open"));
    }, 0);
  }

  send(_data: string): void {}
  close(_code?: number, _reason?: string): void {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.(new CloseEvent("close", { code: _code ?? 1000, reason: _reason ?? "" }));
  }
}

// 设置全局 WebSocket mock
if (typeof globalThis.WebSocket === "undefined") {
  (globalThis as unknown as Record<string, unknown>).WebSocket = MockWebSocket;
}

// Mock fetch for tests
const originalFetch = global.fetch;

beforeAll(() => {
  // 设置测试环境变量
  process.env.NODE_ENV = "test";
  process.env.DATABASE_TYPE = "sqlite";
  process.env.DATABASE_PATH = ":memory:";
  process.env.JWT_SECRET = "test-jwt-secret";
  process.env.SESSION_SECRET = "test-session-secret";
});

afterAll(() => {
  // 恢复 fetch
  global.fetch = originalFetch;
});

// 导出测试工具函数
export { MockWebSocket };

/**
 * 创建模拟的 IM 消息
 */
export function createMockMessage(overrides?: Partial<{
  id: string;
  platform: string;
  channelId: string;
  userId: string;
  content: string;
  timestamp: number;
}>): {
  id: string;
  platform: string;
  channelId: string;
  userId: string;
  content: string;
  timestamp: number;
} {
  return {
    id: `msg_${Date.now()}`,
    platform: "test",
    channelId: "test-channel",
    userId: "test-user",
    content: "test message",
    timestamp: Date.now(),
    ...overrides,
  };
}

/**
 * 创建模拟的会话
 */
export function createMockSession(overrides?: Partial<{
  id: string;
  channelId: string;
  platform: string;
  status: string;
  messageCount: number;
}>): {
  id: string;
  channelId: string;
  platform: string;
  status: string;
  messageCount: number;
  createdAt: Date;
  updatedAt: Date;
} {
  return {
    id: `session_${Date.now()}`,
    channelId: "test-channel",
    platform: "test",
    status: "active",
    messageCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

/**
 * 等待指定毫秒
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 模拟 fetch 响应
 */
export function mockFetchResponse<T>(data: T, ok = true): void {
  global.fetch = vi.fn().mockResolvedValue({
    ok,
    json: async () => data,
    text: async () => JSON.stringify(data),
  });
}

/**
 * 恢复 fetch
 */
export function restoreFetch(): void {
  global.fetch = originalFetch;
}
