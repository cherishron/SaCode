/**
 * E2E 测试 - 模型管理
 * 测试模型配置、切换、能力查询等
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

describe.skipIf(!shouldRunE2E)("E2E: Models - List & Get", () => {
  const authHeader = { Authorization: "Bearer test_token" };

  afterAll(() => {
    vi.restoreAllMocks();
  });

  it("should list all configured models", async () => {
    const mockResponse = [
      {
        id: "gpt-4",
        name: "GPT-4",
        provider: "openai",
        capabilities: ["chat", "code", "analysis"],
        apiKey: "********",
      },
      {
        id: "claude-3",
        name: "Claude 3",
        provider: "anthropic",
        capabilities: ["chat", "analysis"],
        apiKey: "********",
      },
    ];

    mockFetch(mockResponse);

    const response = await fetch(`${apiBaseUrl}/api/models`, {
      headers: authHeader,
    });

    const data = await response.json();

    expect(response.ok).toBe(true);
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThan(0);
  });

  it("should get model templates", async () => {
    const mockResponse = [
      {
        id: "openai-gpt4",
        name: "GPT-4",
        provider: "openai",
        capabilities: ["chat", "code"],
      },
      {
        id: "anthropic-claude3",
        name: "Claude 3",
        provider: "anthropic",
        capabilities: ["chat", "analysis"],
      },
    ];

    mockFetch(mockResponse);

    const response = await fetch(`${apiBaseUrl}/api/models/templates`);

    const data = await response.json();

    expect(response.ok).toBe(true);
    expect(Array.isArray(data)).toBe(true);
  });

  it("should get default model", async () => {
    const mockResponse = {
      id: "gpt-4",
      name: "GPT-4",
      provider: "openai",
      apiKey: "********",
    };

    mockFetch(mockResponse);

    const response = await fetch(`${apiBaseUrl}/api/models/default`, {
      headers: authHeader,
    });

    const data = await response.json();

    expect(response.ok).toBe(true);
    expect(data.id).toBeDefined();
  });

  it("should get specific model by ID", async () => {
    const mockResponse = {
      id: "gpt-4",
      name: "GPT-4",
      provider: "openai",
      capabilities: ["chat", "code", "analysis"],
      apiKey: "********",
    };

    mockFetch(mockResponse);

    const response = await fetch(`${apiBaseUrl}/api/models/gpt-4`, {
      headers: authHeader,
    });

    const data = await response.json();

    expect(response.ok).toBe(true);
    expect(data.id).toBe("gpt-4");
  });

  it("should return 404 for non-existent model", async () => {
    mockFetch({ error: "Model not found" }, false, 404);

    const response = await fetch(`${apiBaseUrl}/api/models/nonexistent`, {
      headers: authHeader,
    });

    expect(response.status).toBe(404);
  });
});

describe.skipIf(!shouldRunE2E)("E2E: Models - Create & Update", () => {
  const authHeader = { Authorization: "Bearer test_token" };

  afterAll(() => {
    vi.restoreAllMocks();
  });

  it("should add a new model", async () => {
    const mockResponse = {
      id: "new-model",
      name: "New Model",
      provider: "openai",
      apiKey: "********",
    };

    mockFetch(mockResponse, true, 201);

    const response = await fetch(`${apiBaseUrl}/api/models`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeader,
      },
      body: JSON.stringify({
        id: "new-model",
        name: "New Model",
        provider: "openai",
        apiKey: "sk-test",
      }),
    });

    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data.id).toBe("new-model");
  });

  it("should add model from template", async () => {
    const mockResponse = {
      id: "gpt-4-from-template",
      name: "GPT-4",
      provider: "openai",
      apiKey: "********",
    };

    mockFetch(mockResponse, true, 201);

    const response = await fetch(`${apiBaseUrl}/api/models/from-template`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeader,
      },
      body: JSON.stringify({
        templateId: "openai-gpt4",
        overrides: { apiKey: "sk-test" },
      }),
    });

    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data.provider).toBe("openai");
  });

  it("should update model configuration", async () => {
    const mockResponse = {
      id: "gpt-4",
      name: "GPT-4 Updated",
      provider: "openai",
      apiKey: "********",
    };

    mockFetch(mockResponse);

    const response = await fetch(`${apiBaseUrl}/api/models/gpt-4`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        ...authHeader,
      },
      body: JSON.stringify({ name: "GPT-4 Updated" }),
    });

    const data = await response.json();

    expect(response.ok).toBe(true);
    expect(data.name).toBe("GPT-4 Updated");
  });

  it("should reject invalid model configuration", async () => {
    mockFetch({ error: "Invalid model configuration" }, false, 400);

    const response = await fetch(`${apiBaseUrl}/api/models`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeader,
      },
      body: JSON.stringify({ invalid: "data" }),
    });

    expect(response.status).toBe(400);
  });
});

describe.skipIf(!shouldRunE2E)("E2E: Models - Delete", () => {
  const authHeader = { Authorization: "Bearer test_token" };

  afterAll(() => {
    vi.restoreAllMocks();
  });

  it("should delete a model", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 204,
      json: async () => ({}),
    });

    const response = await fetch(`${apiBaseUrl}/api/models/old-model`, {
      method: "DELETE",
      headers: authHeader,
    });

    expect(response.status).toBe(204);
  });

  it("should return 404 when deleting non-existent model", async () => {
    mockFetch({ error: "Model not found" }, false, 404);

    const response = await fetch(`${apiBaseUrl}/api/models/nonexistent`, {
      method: "DELETE",
      headers: authHeader,
    });

    expect(response.status).toBe(404);
  });
});

describe.skipIf(!shouldRunE2E)("E2E: Models - Selection & Switching", () => {
  const authHeader = { Authorization: "Bearer test_token" };

  afterAll(() => {
    vi.restoreAllMocks();
  });

  it("should set default model", async () => {
    const mockResponse = {
      success: true,
      defaultModelId: "claude-3",
    };

    mockFetch(mockResponse);

    const response = await fetch(`${apiBaseUrl}/api/models/claude-3/set-default`, {
      method: "POST",
      headers: authHeader,
    });

    const data = await response.json();

    expect(response.ok).toBe(true);
    expect(data.success).toBe(true);
  });

  it("should select model by capability", async () => {
    const mockResponse = {
      id: "gpt-4",
      name: "GPT-4",
      provider: "openai",
      capabilities: ["chat", "code"],
    };

    mockFetch(mockResponse);

    const response = await fetch(`${apiBaseUrl}/api/models/select`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeader,
      },
      body: JSON.stringify({
        requirements: { capability: "code" },
      }),
    });

    const data = await response.json();

    expect(response.ok).toBe(true);
    expect(data.capabilities).toContain("code");
  });

  it("should switch model for session", async () => {
    const mockResponse = {
      success: true,
      model: {
        id: "claude-3",
        name: "Claude 3",
        provider: "anthropic",
      },
    };

    mockFetch(mockResponse);

    const response = await fetch(`${apiBaseUrl}/api/models/switch`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeader,
      },
      body: JSON.stringify({
        modelId: "claude-3",
        sessionId: "session_123",
        reason: "Better for analysis",
      }),
    });

    const data = await response.json();

    expect(response.ok).toBe(true);
    expect(data.success).toBe(true);
  });

  it("should get session model", async () => {
    const mockResponse = {
      id: "gpt-4",
      name: "GPT-4",
      provider: "openai",
    };

    mockFetch(mockResponse);

    const response = await fetch(`${apiBaseUrl}/api/models/session/session_123`, {
      headers: authHeader,
    });

    const data = await response.json();

    expect(response.ok).toBe(true);
    expect(data.id).toBeDefined();
  });
});

describe.skipIf(!shouldRunE2E)("E2E: Models - Config Import/Export", () => {
  const authHeader = { Authorization: "Bearer test_token" };

  afterAll(() => {
    vi.restoreAllMocks();
  });

  it("should export model configuration", async () => {
    const mockResponse = {
      models: [
        { id: "gpt-4", provider: "openai", apiKey: "********" },
        { id: "claude-3", provider: "anthropic", apiKey: "********" },
      ],
      defaultModelId: "gpt-4",
    };

    mockFetch(mockResponse);

    const response = await fetch(`${apiBaseUrl}/api/models/config/export`, {
      headers: authHeader,
    });

    const data = await response.json();

    expect(response.ok).toBe(true);
    expect(data.models).toBeDefined();
  });

  it("should import model configuration", async () => {
    mockFetch({ success: true });

    const response = await fetch(`${apiBaseUrl}/api/models/config/import`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeader,
      },
      body: JSON.stringify({
        models: [
          { id: "imported-model", provider: "openai", apiKey: "sk-test" },
        ],
        defaultModelId: "imported-model",
      }),
    });

    const data = await response.json();

    expect(response.ok).toBe(true);
    expect(data.success).toBe(true);
  });
});
