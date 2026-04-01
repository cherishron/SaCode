import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  LocalAuthService,
  type LocalAuthServiceOptions,
  type UserWithPassword,
} from "../local/index.js";
import type { User, AuthConfig } from "../types/index.js";
import bcrypt from "bcryptjs";

// Mock 用户数据
const mockUsers: Map<string, UserWithPassword> = new Map();

// 测试配置
const testConfig: AuthConfig = {
  local: { enabled: true },
  oauth: {},
  session: { secret: "test-secret", maxAge: 7 * 24 * 60 * 60 * 1000 },
  jwt: { secret: "test-jwt-secret", expiresIn: "7d" },
};

// Mock 选项
const createMockOptions = (): LocalAuthServiceOptions => ({
  config: testConfig,
  getUserByUsername: async (username: string) => {
    const user = Array.from(mockUsers.values()).find((u) => u.username === username);
    if (!user) return null;
    const { password, ...rest } = user;
    return rest;
  },
  getUserByEmail: async (email: string) => {
    const user = Array.from(mockUsers.values()).find((u) => u.email === email);
    if (!user) return null;
    const { password, ...rest } = user;
    return rest;
  },
  getUserWithPassword: async (usernameOrEmail: string) => {
    const user = Array.from(mockUsers.values()).find(
      (u) => u.username === usernameOrEmail || u.email === usernameOrEmail
    );
    return user || null;
  },
  createUser: async (input) => {
    const user: UserWithPassword = {
      id: `user_${Date.now()}`,
      username: input.username,
      email: input.email ?? null,
      password: input.password || "",
      avatar: input.avatar ?? null,
      oauthProvider: input.oauthProvider ?? null,
      oauthId: input.oauthId ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    mockUsers.set(user.id, user);
    const { password, ...rest } = user;
    return rest;
  },
  createSession: vi.fn(),
});

describe("LocalAuthService", () => {
  let service: LocalAuthService;
  let options: LocalAuthServiceOptions;

  beforeEach(() => {
    mockUsers.clear();
    options = createMockOptions();
    service = new LocalAuthService(options);
  });

  describe("register", () => {
    it("应该成功注册新用户", async () => {
      const result = await service.register("testuser", "password123", "test@example.com");

      expect(result.success).toBe(true);
      expect(result.user).toBeDefined();
      expect(result.user?.username).toBe("testuser");
      expect(result.token).toBeDefined();
    });

    it("应该拒绝重复的用户名", async () => {
      await service.register("testuser", "password123");

      const result = await service.register("testuser", "password456");

      expect(result.success).toBe(false);
      expect(result.error).toBe("用户名已存在");
    });

    it("应该拒绝重复的邮箱", async () => {
      await service.register("user1", "password123", "test@example.com");

      const result = await service.register("user2", "password456", "test@example.com");

      expect(result.success).toBe(false);
      expect(result.error).toBe("邮箱已被注册");
    });

    it("应该加密密码", async () => {
      await service.register("testuser", "password123");

      const user = Array.from(mockUsers.values()).find((u) => u.username === "testuser");
      expect(user?.password).not.toBe("password123");
      expect(user?.password.length).toBeGreaterThan(20);
    });
  });

  describe("login", () => {
    it("应该成功登录", async () => {
      // 先注册用户
      await service.register("testuser", "password123");

      const result = await service.login("testuser", "password123");

      expect(result.success).toBe(true);
      expect(result.user).toBeDefined();
      expect(result.user?.username).toBe("testuser");
      expect(result.token).toBeDefined();
    });

    it("应该使用邮箱登录", async () => {
      await service.register("testuser", "password123", "test@example.com");

      const result = await service.login("test@example.com", "password123");

      expect(result.success).toBe(true);
      expect(result.user?.email).toBe("test@example.com");
    });

    it("应该拒绝错误的密码", async () => {
      await service.register("testuser", "password123");

      const result = await service.login("testuser", "wrongpassword");

      expect(result.success).toBe(false);
      expect(result.error).toBe("用户名或密码错误");
    });

    it("应该拒绝不存在的用户", async () => {
      const result = await service.login("nonexistent", "password123");

      expect(result.success).toBe(false);
      expect(result.error).toBe("用户名或密码错误");
    });

    it("返回的用户不应包含密码", async () => {
      await service.register("testuser", "password123");

      const result = await service.login("testuser", "password123");

      expect(result.user).toBeDefined();
      expect((result.user as UserWithPassword).password).toBeUndefined();
    });
  });

  describe("verifyPassword", () => {
    it("应该验证正确的密码", async () => {
      const hashedPassword = await bcrypt.hash("password123", 10);
      const result = await service.verifyPassword("password123", hashedPassword);

      expect(result).toBe(true);
    });

    it("应该拒绝错误的密码", async () => {
      const hashedPassword = await bcrypt.hash("password123", 10);
      const result = await service.verifyPassword("wrongpassword", hashedPassword);

      expect(result).toBe(false);
    });
  });

  describe("generateToken", () => {
    it("应该生成有效的 token", () => {
      const { token, expiresAt } = service.generateToken("user123");

      expect(token).toBeDefined();
      expect(expiresAt).toBeInstanceOf(Date);
      expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
    });
  });

  describe("verifyToken", () => {
    it("应该验证有效的 token", () => {
      const { token } = service.generateToken("user123");
      const result = service.verifyToken(token);

      expect(result).not.toBeNull();
      expect(result?.userId).toBe("user123");
    });

    it("应该拒绝无效的 token", () => {
      const result = service.verifyToken("invalid-token");

      expect(result).toBeNull();
    });
  });
});
