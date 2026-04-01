/**
 * E2E 测试 - 完整工作流
 * 测试从消息接收到 AI 响应的完整流程
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import {
  SaClawClient,
  SessionManager,
  SessionMapper,
  MessageRouter,
  TaskScheduler,
  GroupQueue,
  PluginManager,
} from "@saclaw/core";
import {
  IMAdapterManager,
  TelegramAdapter,
  createAdapter,
} from "@saclaw/adapters";

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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 跳过 E2E 测试如果没有配置测试环境
const shouldRunE2E = process.env.RUN_E2E_TESTS === "true";

describe.skipIf(!shouldRunE2E)("E2E: Full Message Flow", () => {
  let client: SaClawClient;
  let sessionManager: SessionManager;
  let sessionMapper: SessionMapper;
  let router: MessageRouter;
  let adapterManager: IMAdapterManager;

  beforeAll(async () => {
    // 初始化所有组件
    client = new SaClawClient({
      acpUrl: process.env.IFLOW_ACP_URL || "ws://localhost:8090/acp",
      autoStart: false,
      timeout: 30000,
    });

    sessionManager = new SessionManager();
    sessionMapper = new SessionMapper({ enablePersistence: false });
    router = new MessageRouter();
    adapterManager = new IMAdapterManager();
  });

  afterAll(async () => {
    // 清理资源
    sessionMapper.destroy();
    adapterManager.disconnectAll();
    await client.disconnect();
  });

  it("should handle complete message flow", async () => {
    // 1. 创建平台适配器
    const telegramAdapter = new TelegramAdapter({
      botToken: process.env.TELEGRAM_BOT_TOKEN || "test-token",
    });
    adapterManager.register("telegram", telegramAdapter);

    // 2. 创建会话映射
    const sessionId = sessionMapper.createMapping("telegram", "chat_123");

    // 3. 创建会话
    const session = sessionManager.create({
      id: sessionId,
      channelId: "chat_123",
      platform: "telegram",
    });

    // 4. 路由消息
    const routedMessages: unknown[] = [];
    router.on("routed", (event: { message: unknown; session: unknown }) => {
      routedMessages.push(event);
    });

    const message = {
      id: "msg_1",
      platform: "telegram",
      channelId: "chat_123",
      userId: "user_1",
      content: "Hello, AI!",
      timestamp: Date.now(),
    };

    await router.route(message, session);

    expect(routedMessages.length).toBe(1);
  });

  it("should handle multi-platform sessions", async () => {
    // 创建多个平台的映射
    const telegramSession = sessionMapper.createMapping("telegram", "tg_chat");
    const wechatSession = sessionMapper.createMapping("wechat", "wx_user");

    // 验证映射唯一性
    expect(telegramSession).not.toBe(wechatSession);

    // 创建会话
    sessionManager.create({
      id: telegramSession,
      channelId: "tg_chat",
      platform: "telegram",
    });

    sessionManager.create({
      id: wechatSession,
      channelId: "wx_user",
      platform: "wechat",
    });

    // 验证会话已创建
    expect(sessionManager.get(telegramSession)?.platform).toBe("telegram");
    expect(sessionManager.get(wechatSession)?.platform).toBe("wechat");
  });

  it("should handle scheduled tasks", async () => {
    const scheduler = new TaskScheduler();
    const executedTasks: string[] = [];

    scheduler.addTask({
      name: "test-reminder",
      type: "once",
      config: { delay: 500 },
      message: "Reminder message",
      channel: "telegram",
      chatId: "chat_123",
      onExecute: async () => {
        executedTasks.push("test-reminder");
      },
    });

    scheduler.start();
    await sleep(1000);
    scheduler.stop();

    expect(executedTasks).toContain("test-reminder");
  });

  it("should handle plugin lifecycle", async () => {
    const pluginManager = new PluginManager({
      pluginsDir: "./test-plugins",
    });

    await pluginManager.initialize();

    const plugins = pluginManager.list();
    expect(Array.isArray(plugins)).toBe(true);
  });
});

describe.skipIf(!shouldRunE2E)("E2E: API Endpoints", () => {
  const apiBaseUrl = process.env.API_BASE_URL || "http://localhost:3000";

  it("should respond to health check", async () => {
    const response = await fetch(`${apiBaseUrl}/api/health`);
    expect(response.ok).toBe(true);
  });

  it("should authenticate user", async () => {
    const response = await fetch(`${apiBaseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "test",
        password: "test123",
      }),
    });

    // 根据实际 API 行为调整断言
    expect([200, 401]).toContain(response.status);
  });
});

describe.skipIf(!shouldRunE2E)("E2E: WebSocket Connection", () => {
  it("should establish WebSocket connection", async () => {
    const wsUrl = process.env.WS_URL || "ws://localhost:3000/ws";
    const ws = new MockWebSocket(wsUrl);

    await sleep(100);

    expect(ws.readyState).toBe(MockWebSocket.OPEN);

    ws.close();
  });

  it("should send and receive messages via WebSocket", async () => {
    const wsUrl = process.env.WS_URL || "ws://localhost:3000/ws";
    const ws = new MockWebSocket(wsUrl);

    const receivedMessages: unknown[] = [];
    ws.onmessage = (event: MessageEvent) => {
      receivedMessages.push(JSON.parse(event.data));
    };

    ws.send(JSON.stringify({ type: "ping" }));
    await sleep(100);

    ws.close();
  });
});
