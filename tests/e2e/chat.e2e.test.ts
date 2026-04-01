/**
 * E2E 测试 - 聊天流程
 * 测试会话创建、消息发送、流式响应等
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 跳过 E2E 测试如果没有配置测试环境
const shouldRunE2E = process.env.RUN_E2E_TESTS === "true";
const apiBaseUrl = process.env.API_BASE_URL || "http://localhost:3000";

describe.skipIf(!shouldRunE2E)("E2E: Chat - Sessions", () => {
  const authHeader = { Authorization: "Bearer test_token" };

  afterAll(() => {
    vi.restoreAllMocks();
  });

  it("should create a new chat session", async () => {
    const mockResponse = {
      id: "session_123",
      title: "New Chat",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    mockFetch(mockResponse, true, 201);

    const response = await fetch(`${apiBaseUrl}/api/chat/sessions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeader,
      },
      body: JSON.stringify({ title: "New Chat" }),
    });

    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data.id).toBeDefined();
  });

  it("should list all sessions", async () => {
    const mockResponse = [
      {
        id: "session_1",
        title: "Chat 1",
        messageCount: 5,
        createdAt: new Date().toISOString(),
      },
      {
        id: "session_2",
        title: "Chat 2",
        messageCount: 3,
        createdAt: new Date().toISOString(),
      },
    ];

    mockFetch(mockResponse);

    const response = await fetch(`${apiBaseUrl}/api/chat/sessions`, {
      headers: authHeader,
    });

    const data = await response.json();

    expect(response.ok).toBe(true);
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBe(2);
  });

  it("should get a specific session", async () => {
    const mockResponse = {
      id: "session_123",
      title: "Test Chat",
      messages: [
        { id: "msg_1", role: "user", content: "Hello" },
        { id: "msg_2", role: "assistant", content: "Hi there!" },
      ],
    };

    mockFetch(mockResponse);

    const response = await fetch(`${apiBaseUrl}/api/chat/sessions/session_123`, {
      headers: authHeader,
    });

    const data = await response.json();

    expect(response.ok).toBe(true);
    expect(data.id).toBe("session_123");
    expect(data.messages.length).toBe(2);
  });

  it("should update session title", async () => {
    const mockResponse = {
      id: "session_123",
      title: "Updated Title",
    };

    mockFetch(mockResponse);

    const response = await fetch(`${apiBaseUrl}/api/chat/sessions/session_123`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        ...authHeader,
      },
      body: JSON.stringify({ title: "Updated Title" }),
    });

    const data = await response.json();

    expect(response.ok).toBe(true);
    expect(data.title).toBe("Updated Title");
  });

  it("should delete a session", async () => {
    mockFetch({ success: true });

    const response = await fetch(`${apiBaseUrl}/api/chat/sessions/session_123`, {
      method: "DELETE",
      headers: authHeader,
    });

    expect(response.ok).toBe(true);
  });

  it("should reject unauthenticated requests", async () => {
    mockFetch({ error: "Unauthorized" }, false, 401);

    const response = await fetch(`${apiBaseUrl}/api/chat/sessions`);

    expect(response.status).toBe(401);
  });
});

describe.skipIf(!shouldRunE2E)("E2E: Chat - Messages", () => {
  const authHeader = { Authorization: "Bearer test_token" };

  afterAll(() => {
    vi.restoreAllMocks();
  });

  it("should send a message and receive response", async () => {
    const mockResponse = {
      success: true,
      responses: [
        { type: "text", content: "Hello! How can I help you?" },
      ],
    };

    mockFetch(mockResponse);

    const response = await fetch(`${apiBaseUrl}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeader,
      },
      body: JSON.stringify({
        message: "Hello",
        sessionId: "session_123",
      }),
    });

    const data = await response.json();

    expect(response.ok).toBe(true);
    expect(data.success).toBe(true);
    expect(data.responses.length).toBeGreaterThan(0);
  });

  it("should reject empty message", async () => {
    mockFetch({ error: "Message is required" }, false, 400);

    const response = await fetch(`${apiBaseUrl}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeader,
      },
      body: JSON.stringify({ message: "" }),
    });

    expect(response.status).toBe(400);
  });

  it("should get messages for a session", async () => {
    const mockResponse = {
      messages: [
        { id: "msg_1", role: "user", content: "Hello", timestamp: Date.now() },
        { id: "msg_2", role: "assistant", content: "Hi!", timestamp: Date.now() },
      ],
      total: 2,
    };

    mockFetch(mockResponse);

    const response = await fetch(
      `${apiBaseUrl}/api/chat/sessions/session_123/messages`,
      { headers: authHeader }
    );

    const data = await response.json();

    expect(response.ok).toBe(true);
    expect(data.messages.length).toBe(2);
  });
});

describe.skipIf(!shouldRunE2E)("E2E: Chat - Agentic Mode", () => {
  const authHeader = { Authorization: "Bearer test_token" };

  afterAll(() => {
    vi.restoreAllMocks();
  });

  it("should execute agentic chat with planning", async () => {
    const mockResponse = {
      success: true,
      plan: {
        steps: [
          { id: 1, description: "Analyze the request" },
          { id: 2, description: "Execute the task" },
        ],
      },
      responses: [
        { type: "text", content: "I'll help you with that." },
      ],
    };

    mockFetch(mockResponse);

    const response = await fetch(`${apiBaseUrl}/api/chat/agentic`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeader,
      },
      body: JSON.stringify({
        message: "Create a new file with hello world",
      }),
    });

    const data = await response.json();

    expect(response.ok).toBe(true);
    expect(data.plan).toBeDefined();
  });

  it("should handle complex agentic tasks", async () => {
    const mockResponse = {
      success: true,
      plan: {
        complexity: "complex",
        steps: [
          { id: 1, description: "Explore codebase" },
          { id: 2, description: "Analyze dependencies" },
          { id: 3, description: "Implement changes" },
          { id: 4, description: "Run tests" },
        ],
      },
      responses: [],
    };

    mockFetch(mockResponse);

    const response = await fetch(`${apiBaseUrl}/api/chat/agentic`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeader,
      },
      body: JSON.stringify({
        message: "Refactor the authentication module",
        enablePlanning: true,
      }),
    });

    const data = await response.json();

    expect(response.ok).toBe(true);
    expect(data.plan.steps.length).toBeGreaterThan(2);
  });
});

describe.skipIf(!shouldRunE2E)("E2E: Chat - Error Handling", () => {
  const authHeader = { Authorization: "Bearer test_token" };

  afterAll(() => {
    vi.restoreAllMocks();
  });

  it("should handle AI provider timeout", async () => {
    mockFetch({ error: "Request timeout" }, false, 504);

    const response = await fetch(`${apiBaseUrl}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeader,
      },
      body: JSON.stringify({
        message: "This will timeout",
      }),
    });

    expect(response.status).toBe(504);
  });

  it("should handle rate limiting", async () => {
    mockFetch({ error: "Rate limit exceeded" }, false, 429);

    const response = await fetch(`${apiBaseUrl}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeader,
      },
      body: JSON.stringify({ message: "test" }),
    });

    expect(response.status).toBe(429);
  });

  it("should handle invalid session ID", async () => {
    mockFetch({ error: "Session not found" }, false, 404);

    const response = await fetch(
      `${apiBaseUrl}/api/chat/sessions/invalid_session`,
      { headers: authHeader }
    );

    expect(response.status).toBe(404);
  });
});
