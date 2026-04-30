import { Hono } from "hono";
import bcrypt from "bcryptjs";
import {
  GitHubOAuthService,
  GoogleOAuthService,
  WeChatOAuthService,
  QQOAuthService,
  WeWorkOAuthService,
  LocalAuthService,
  type UserWithPassword,
} from "@sacode/auth";
import { getPrismaClient } from "@sacode/database";
import { randomBytes } from "crypto";
import { authMiddleware, extractBearerToken } from "../middleware/auth";

type Variables = {
  userId: string;
};

const router = new Hono<{ Variables: Variables }>();

function getJwtConfig() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("JWT_SECRET environment variable is required in production");
    }
    console.warn("WARNING: Using default JWT secret. Set JWT_SECRET in production.");
  }
  return {
    secret: secret || "SACODE-dev-secret-change-in-production",
    expiresIn: process.env.JWT_EXPIRES_IN || "7d",
  };
}

function createLocalAuthService(): LocalAuthService {
  const prisma = getPrismaClient();
  const jwtConfig = getJwtConfig();

  return new LocalAuthService({
    config: {
      jwt: jwtConfig,
      bcrypt: { rounds: 10 },
      session: { enabled: true },
    },
    getUserByUsername: async (username: string) => {
      return prisma.user.findUnique({ where: { username } });
    },
    getUserByEmail: async (email: string) => {
      return prisma.user.findUnique({ where: { email } });
    },
    getUserWithPassword: async (usernameOrEmail: string) => {
      return prisma.user.findFirst({
        where: {
          OR: [{ username: usernameOrEmail }, { email: usernameOrEmail }],
        },
      }) as Promise<UserWithPassword | null>;
    },
    createUser: async (input) => {
      return prisma.user.create({
        data: {
          username: input.username,
          email: input.email ?? null,
          password: input.password,
        },
      });
    },
    createSession: async (userId: string, token: string, expiresAt: Date) => {
      await prisma.session.create({
        data: { userId, token, expiresAt },
      });
    },
  });
}

function generateState(): string {
  return randomBytes(16).toString("hex");
}

const oauthServices = new Map<string, unknown>();

function createTokenGenerator() {
  const service = createLocalAuthService();
  return (userId: string) => service.generateToken(userId);
}

function getOAuthService(provider: string): unknown {
  if (oauthServices.has(provider)) {
    return oauthServices.get(provider);
  }

  const config = {
    clientId: process.env[`${provider.toUpperCase()}_CLIENT_ID`] || "",
    clientSecret: process.env[`${provider.toUpperCase()}_CLIENT_SECRET`] || "",
    callbackUrl: `${process.env.BASE_URL || "http://localhost:3000"}/api/auth/oauth/${provider}/callback`,
  };

  const prisma = getPrismaClient();
  const generateToken = createTokenGenerator();

  const serviceOptions = {
    provider,
    config,
    findUserByOAuth: async (prov: string, oauthId: string) => {
      return prisma.user.findFirst({
        where: { oauthProvider: prov, oauthId },
      });
    },
    createUser: async (profile: { provider: string; id: string; username?: string; email?: string; avatar?: string; displayName?: string }) => {
      return prisma.user.create({
        data: {
          username: profile.username || profile.displayName || `user_${profile.id.slice(0, 8)}`,
          email: profile.email ?? null,
          avatar: profile.avatar ?? null,
          oauthProvider: profile.provider,
          oauthId: profile.id,
        },
      });
    },
    createSession: async (userId: string, token: string, expiresAt: Date) => {
      await prisma.session.create({
        data: { userId, token, expiresAt },
      });
    },
    generateToken,
  };

  let service: unknown;

  switch (provider) {
    case "github":
      service = new GitHubOAuthService({ ...serviceOptions, provider: "github" } as never);
      break;
    case "google":
      service = new GoogleOAuthService({ ...serviceOptions, provider: "google" } as never);
      break;
    case "wechat":
      service = new WeChatOAuthService({ ...serviceOptions, provider: "wechat" } as never);
      break;
    case "qq":
      service = new QQOAuthService({ ...serviceOptions, provider: "qq" } as never);
      break;
    case "wework":
      service = new WeWorkOAuthService({
        ...serviceOptions,
        provider: "wework",
        corpId: process.env.WEWORK_CORP_ID || "",
        agentId: process.env.WEWORK_AGENT_ID || "",
      } as never);
      break;
    default:
      throw new Error(`Unsupported OAuth provider: ${provider}`);
  }

  oauthServices.set(provider, service);
  return service;
}

// POST /api/auth/register
router.post("/register", async (c) => {
  try {
    const { username, email, password } = await c.req.json();

    if (!username || !password) {
      return c.json({ error: "Username and password are required" }, 400);
    }

    const service = createLocalAuthService();
    const result = await service.register(username, password, email);

    if (!result.success) {
      return c.json({ error: result.error }, 400);
    }

    return c.json({
      success: true,
      user: result.user,
      token: result.token,
    }, 201);
  } catch (error) {
    console.error("Register error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// POST /api/auth/login
router.post("/login", async (c) => {
  try {
    const { username, password } = await c.req.json();

    if (!username || !password) {
      return c.json({ error: "Username and password are required" }, 400);
    }

    const service = createLocalAuthService();
    const result = await service.login(username, password);

    if (!result.success) {
      return c.json({ error: result.error }, 401);
    }

    return c.json({
      success: true,
      user: result.user,
      token: result.token,
    });
  } catch (error) {
    console.error("Login error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// POST /api/auth/logout
router.post("/logout", authMiddleware, async (c) => {
  try {
    const userId = c.get("userId");
    const token = extractBearerToken(c.req.header("Authorization"));

    if (token) {
      const prisma = getPrismaClient();
      await prisma.session.deleteMany({
        where: { userId, token },
      });
    }

    return c.json({ success: true });
  } catch (error) {
    console.error("Logout error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// GET /api/auth/me
router.get("/me", authMiddleware, async (c) => {
  try {
    const userId = c.get("userId");
    const prisma = getPrismaClient();

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        email: true,
        avatar: true,
        createdAt: true,
      },
    });

    if (!user) {
      return c.json({ error: "User not found" }, 404);
    }

    return c.json(user);
  } catch (error) {
    console.error("Get user error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// PUT /api/auth/password
router.put("/password", authMiddleware, async (c) => {
  try {
    const userId = c.get("userId");
    const { currentPassword, newPassword } = await c.req.json();

    if (!currentPassword || !newPassword) {
      return c.json({ error: "Current password and new password are required" }, 400);
    }

    if (newPassword.length < 6) {
      return c.json({ error: "New password must be at least 6 characters" }, 400);
    }

    const prisma = getPrismaClient();

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.password) {
      return c.json({ error: "User not found or no password set (OAuth user)" }, 404);
    }

    const valid = await bcrypt.compare(currentPassword, user.password);
    if (!valid) {
      return c.json({ error: "Current password is incorrect" }, 401);
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({
      where: { id: userId },
      data: { password: hashedPassword },
    });

    const token = extractBearerToken(c.req.header("Authorization"));
    if (token) {
      await prisma.session.deleteMany({
        where: { userId, NOT: { token } },
      });
    }

    return c.json({ success: true, message: "Password updated successfully" });
  } catch (error) {
    console.error("Password change error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// PUT /api/auth/profile
router.put("/profile", authMiddleware, async (c) => {
  try {
    const userId = c.get("userId");
    const { username, email } = await c.req.json();

    const prisma = getPrismaClient();

    const updateData: { username?: string; email?: string | null } = {};

    if (username !== undefined) {
      if (typeof username !== "string" || username.length < 2 || username.length > 50) {
        return c.json({ error: "Username must be between 2 and 50 characters" }, 400);
      }

      if (username) {
        const existing = await prisma.user.findFirst({
          where: { username, NOT: { id: userId } },
        });
        if (existing) {
          return c.json({ error: "Username already taken" }, 409);
        }
      }
      updateData.username = username;
    }

    if (email !== undefined) {
      if (email && typeof email === "string") {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
          return c.json({ error: "Invalid email format" }, 400);
        }

        const existing = await prisma.user.findFirst({
          where: { email, NOT: { id: userId } },
        });
        if (existing) {
          return c.json({ error: "Email already in use" }, 409);
        }
      }
      updateData.email = email || null;
    }

    if (Object.keys(updateData).length === 0) {
      return c.json({ error: "No fields to update" }, 400);
    }

    const user = await prisma.user.update({
      where: { id: userId },
      data: updateData,
      select: {
        id: true,
        username: true,
        email: true,
      },
    });

    return c.json(user);
  } catch (error) {
    console.error("Profile update error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

export default router;
