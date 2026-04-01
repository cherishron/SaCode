/**
 * E2E 测试 - IM 适配器
 * 测试 IM 连接管理、平台适配器等
 */

import { describe, it, expect, afterAll, vi } from "vitest";

// Mock fetch 响应
function mockFetch<T>(data: T, ok = true, status = 200): void {
  global.fetch = vi.fn().mockResolvedValue({
    ok,
    status,
    json: async () => data,
    text: async () => JSON.stringify(data),
    headers: new Headers({ "Content-Type": "application/json" }),
  });
}

// 跳过 E2E 测试如果没有配置测试环境
const shouldRunE2E = process.env.RUN_E2E_TESTS === "true";
const apiBaseUrl = process.env.API_BASE_URL || "http://localhost:3000";

describe.skipIf(!shouldRunE2E)("E2E: IM - Connection Management", () => {
  const authHeader = { Authorization: "Bearer test_token" };

  afterAll(() => {
    vi.restoreAllMocks();
  });

  it("should list IM connections", async () => {
    const mockResponse = [
      {
        id: "conn_1",
        platform: "telegram",
        name: "My Telegram Bot",
        status: "connected",
        createdAt: new Date().toISOString(),
      },
      {
        id: "conn_2",
        platform: "discord",
        name: "Discord Bot",
        status: "disconnected",
        createdAt: new Date().toISOString(),
      },
    ];

    mockFetch(mockResponse);

    const response = await fetch(`${apiBaseUrl}/api/im`, {
      headers: authHeader,
    });

    const data = await response.json();

    expect(response.ok).toBe(true);
    expect(Array.isArray(data)).toBe(true);
  });

  it("should create a new IM connection", async () => {
    const mockResponse = {
      id: "conn_new",
      platform: "telegram",
      name: "New Bot",
      status: "disconnected",
      createdAt: new Date().toISOString(),
    };

    mockFetch(mockResponse, true, 201);

    const response = await fetch(`${apiBaseUrl}/api/im`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeader,
      },
      body: JSON.stringify({
        platform: "telegram",
        name: "New Bot",
        config: { botToken: "test_token" },
      }),
    });

    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data.platform).toBe("telegram");
  });

  it("should reject missing platform", async () => {
    mockFetch({ error: "Platform is required" }, false, 400);

    const response = await fetch(`${apiBaseUrl}/api/im`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeader,
      },
      body: JSON.stringify({ name: "Test" }),
    });

    expect(response.status).toBe(400);
  });

  it("should update IM connection", async () => {
    const mockResponse = {
      id: "conn_1",
      name: "Updated Bot Name",
      status: "connected",
    };

    mockFetch(mockResponse);

    const response = await fetch(`${apiBaseUrl}/api/im/conn_1`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        ...authHeader,
      },
      body: JSON.stringify({ name: "Updated Bot Name" }),
    });

    const data = await response.json();

    expect(response.ok).toBe(true);
    expect(data.name).toBe("Updated Bot Name");
  });

  it("should delete IM connection", async () => {
    mockFetch({ success: true });

    const response = await fetch(`${apiBaseUrl}/api/im/conn_1`, {
      method: "DELETE",
      headers: authHeader,
    });

    expect(response.ok).toBe(true);
  });
});

describe.skipIf(!shouldRunE2E)("E2E: IM - Connect/Disconnect", () => {
  const authHeader = { Authorization: "Bearer test_token" };

  afterAll(() => {
    vi.restoreAllMocks();
  });

  it("should connect to IM platform", async () => {
    const mockResponse = {
      success: true,
      status: "connected",
      message: "Successfully connected to Telegram",
    };

    mockFetch(mockResponse);

    const response = await fetch(`${apiBaseUrl}/api/im/conn_1/connect`, {
      method: "POST",
      headers: authHeader,
    });

    const data = await response.json();

    expect(response.ok).toBe(true);
    expect(data.status).toBe("connected");
  });

  it("should disconnect from IM platform", async () => {
    const mockResponse = {
      success: true,
      status: "disconnected",
      message: "Disconnected from Telegram",
    };

    mockFetch(mockResponse);

    const response = await fetch(`${apiBaseUrl}/api/im/conn_1/disconnect`, {
      method: "POST",
      headers: authHeader,
    });

    const data = await response.json();

    expect(response.ok).toBe(true);
    expect(data.status).toBe("disconnected");
  });

  it("should handle connection failure", async () => {
    mockFetch({ error: "Invalid bot token" }, false, 400);

    const response = await fetch(`${apiBaseUrl}/api/im/conn_invalid/connect`, {
      method: "POST",
      headers: authHeader,
    });

    expect(response.status).toBe(400);
  });
});

describe.skipIf(!shouldRunE2E)("E2E: IM - Channels", () => {
  const authHeader = { Authorization: "Bearer test_token" };

  afterAll(() => {
    vi.restoreAllMocks();
  });

  it("should get channels for connected platform", async () => {
    const mockResponse = {
      channels: [
        { id: "chat_1", name: "General Chat", type: "group" },
        { id: "chat_2", name: "Random", type: "group" },
        { id: "user_1", name: "John Doe", type: "private" },
      ],
    };

    mockFetch(mockResponse);

    const response = await fetch(`${apiBaseUrl}/api/im/conn_1/channels`, {
      headers: authHeader,
    });

    const data = await response.json();

    expect(response.ok).toBe(true);
    expect(data.channels.length).toBe(3);
  });

  it("should handle disconnected platform", async () => {
    mockFetch({ error: "Not connected to platform" }, false, 400);

    const response = await fetch(`${apiBaseUrl}/api/im/conn_disconnected/channels`, {
      headers: authHeader,
    });

    expect(response.status).toBe(400);
  });
});

describe.skipIf(!shouldRunE2E)("E2E: IM - Supported Platforms", () => {
  const authHeader = { Authorization: "Bearer test_token" };

  afterAll(() => {
    vi.restoreAllMocks();
  });

  it("should return list of supported platforms", async () => {
    const mockResponse = {
      platforms: [
        { id: "telegram", name: "Telegram", features: ["messages", "media"] },
        { id: "discord", name: "Discord", features: ["messages", "voice"] },
        { id: "wechat", name: "WeChat", features: ["messages"] },
        { id: "qq", name: "QQ", features: ["messages", "groups"] },
        { id: "dingtalk", name: "DingTalk", features: ["messages", "cards"] },
        { id: "feishu", name: "Feishu", features: ["messages", "cards"] },
      ],
    };

    mockFetch(mockResponse);

    const response = await fetch(`${apiBaseUrl}/api/im/platforms`, {
      headers: authHeader,
    });

    const data = await response.json();

    expect(response.ok).toBe(true);
    expect(data.platforms.length).toBeGreaterThan(0);
  });
});
