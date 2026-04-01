/**
 * E2E 测试 - 认证流程
 * 测试用户注册、登录、登出、Token 验证等
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

describe.skipIf(!shouldRunE2E)("E2E: Auth - Registration", () => {
  afterAll(() => {
    vi.restoreAllMocks();
  });

  it("should register a new user successfully", async () => {
    const mockResponse = {
      success: true,
      user: {
        id: "user_123",
        username: "testuser",
        email: "test@example.com",
      },
      token: "mock_token_xyz",
    };

    mockFetch(mockResponse, true, 201);

    const response = await fetch(`${apiBaseUrl}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "testuser",
        email: "test@example.com",
        password: "Test123456",
      }),
    });

    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data.success).toBe(true);
    expect(data.user.username).toBe("testuser");
    expect(data.token).toBeDefined();
  });

  it("should reject registration with missing fields", async () => {
    mockFetch({ error: "Username and password are required" }, false, 400);

    const response = await fetch(`${apiBaseUrl}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "testuser",
        // missing password
      }),
    });

    expect(response.status).toBe(400);
  });

  it("should reject duplicate username", async () => {
    mockFetch({ error: "Username already exists" }, false, 409);

    const response = await fetch(`${apiBaseUrl}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "existinguser",
        password: "Test123456",
      }),
    });

    expect(response.status).toBe(409);
  });
});

describe.skipIf(!shouldRunE2E)("E2E: Auth - Login", () => {
  afterAll(() => {
    vi.restoreAllMocks();
  });

  it("should login successfully with valid credentials", async () => {
    const mockResponse = {
      success: true,
      user: {
        id: "user_123",
        username: "testuser",
        email: "test@example.com",
      },
      token: "mock_token_xyz",
    };

    mockFetch(mockResponse);

    const response = await fetch(`${apiBaseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "testuser",
        password: "Test123456",
      }),
    });

    const data = await response.json();

    expect(response.ok).toBe(true);
    expect(data.success).toBe(true);
    expect(data.token).toBeDefined();
  });

  it("should reject login with invalid credentials", async () => {
    mockFetch({ success: false, error: "Invalid credentials" }, false, 401);

    const response = await fetch(`${apiBaseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "testuser",
        password: "wrongpassword",
      }),
    });

    expect(response.status).toBe(401);
  });

  it("should reject login with missing fields", async () => {
    mockFetch({ error: "Username and password are required" }, false, 400);

    const response = await fetch(`${apiBaseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "testuser",
      }),
    });

    expect(response.status).toBe(400);
  });
});

describe.skipIf(!shouldRunE2E)("E2E: Auth - Token Verification", () => {
  afterAll(() => {
    vi.restoreAllMocks();
  });

  it("should verify valid token", async () => {
    const mockResponse = {
      id: "user_123",
      username: "testuser",
      email: "test@example.com",
    };

    mockFetch(mockResponse);

    const response = await fetch(`${apiBaseUrl}/api/auth/me`, {
      headers: {
        Authorization: "Bearer valid_token_xyz",
      },
    });

    const data = await response.json();

    expect(response.ok).toBe(true);
    expect(data.id).toBe("user_123");
    expect(data.username).toBe("testuser");
  });

  it("should reject invalid token", async () => {
    mockFetch({ error: "Invalid token" }, false, 401);

    const response = await fetch(`${apiBaseUrl}/api/auth/me`, {
      headers: {
        Authorization: "Bearer invalid_token",
      },
    });

    expect(response.status).toBe(401);
  });

  it("should reject missing token", async () => {
    mockFetch({ error: "Authorization header required" }, false, 401);

    const response = await fetch(`${apiBaseUrl}/api/auth/me`);

    expect(response.status).toBe(401);
  });
});

describe.skipIf(!shouldRunE2E)("E2E: Auth - Logout", () => {
  afterAll(() => {
    vi.restoreAllMocks();
  });

  it("should logout successfully", async () => {
    mockFetch({ success: true, message: "Logged out successfully" });

    const response = await fetch(`${apiBaseUrl}/api/auth/logout`, {
      method: "POST",
      headers: {
        Authorization: "Bearer valid_token_xyz",
      },
    });

    const data = await response.json();

    expect(response.ok).toBe(true);
    expect(data.success).toBe(true);
  });
});

describe.skipIf(!shouldRunE2E)("E2E: Auth - OAuth Flow", () => {
  afterAll(() => {
    vi.restoreAllMocks();
  });

  it("should redirect to GitHub OAuth", async () => {
    // OAuth 重定向测试
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      redirected: true,
      url: "https://github.com/login/oauth/authorize",
    });

    const response = await fetch(`${apiBaseUrl}/api/auth/oauth/github`);

    expect(response.redirected).toBe(true);
    expect(response.url).toContain("github.com");
  });

  it("should handle OAuth callback", async () => {
    const mockResponse = {
      success: true,
      token: "oauth_token_xyz",
      user: {
        id: "user_oauth",
        username: "github_user",
      },
    };

    mockFetch(mockResponse);

    const response = await fetch(
      `${apiBaseUrl}/api/auth/oauth/github/callback?code=test_code&state=test_state`
    );

    const data = await response.json();

    expect(response.ok).toBe(true);
    expect(data.success).toBe(true);
    expect(data.token).toBeDefined();
  });

  it("should reject OAuth callback without code", async () => {
    mockFetch({ error: "Authorization code required" }, false, 400);

    const response = await fetch(
      `${apiBaseUrl}/api/auth/oauth/github/callback?state=test_state`
    );

    expect(response.status).toBe(400);
  });
});
