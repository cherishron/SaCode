import { Router, type Request, type Response } from "express";
import bcrypt from "bcryptjs";
import {
  createAuthMiddleware,
  extractBearerToken,
  GitHubOAuthService,
  GoogleOAuthService,
  WeChatOAuthService,
  QQOAuthService,
  WeWorkOAuthService,
  LocalAuthService,
  type UserWithPassword,
} from "@SACODE/auth";
import { getPrismaClient } from "@SACODE/database";
import { randomBytes } from "crypto";

const router = Router();

// 获取 JWT 配置
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

// 创建 LocalAuthService 实例
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

// 生成 OAuth state
function generateState(): string {
  return randomBytes(16).toString("hex");
}

// OAuth 服务实例缓存
const oauthServices = new Map<string, unknown>();

// 创建 Token 生成函数（使用 LocalAuthService）
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

// 认证中间件
const authMiddleware = createAuthMiddleware({
  getTokenFromHeader: extractBearerToken,
  verifyToken: (token: string) => {
    const service = createLocalAuthService();
    return service.verifyToken(token);
  },
  getUserById: async (id: string) => {
    const prisma = getPrismaClient();
    return prisma.user.findUnique({ where: { id } });
  },
});

// POST /api/auth/register
router.post("/register", async (req: Request, res: Response) => {
  try {
    const { username, email, password } = req.body;

    if (!username || !password) {
      res.status(400).json({ error: "Username and password are required" });
      return;
    }

    const service = createLocalAuthService();
    const result = await service.register(username, password, email);

    if (!result.success) {
      res.status(400).json({ error: result.error });
      return;
    }

    res.status(201).json({
      success: true,
      user: result.user,
      token: result.token,
    });
  } catch (error) {
    console.error("Register error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/auth/login
router.post("/login", async (req: Request, res: Response) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      res.status(400).json({ error: "Username and password are required" });
      return;
    }

    const service = createLocalAuthService();
    const result = await service.login(username, password);

    if (!result.success) {
      res.status(401).json({ error: result.error });
      return;
    }

    res.json({
      success: true,
      user: result.user,
      token: result.token,
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/auth/logout
router.post("/logout", authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = (req as Request & { userId: string }).userId;
    const token = extractBearerToken(req);

    if (token) {
      const prisma = getPrismaClient();
      await prisma.session.deleteMany({
        where: { userId, token },
      });
    }

    res.json({ success: true });
  } catch (error) {
    console.error("Logout error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/auth/me
router.get("/me", authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = (req as Request & { userId: string }).userId;
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
      res.status(404).json({ error: "User not found" });
      return;
    }

    res.json(user);
  } catch (error) {
    console.error("Get user error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// PUT /api/auth/password - 修改密码
router.put("/password", authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = (req as Request & { userId: string }).userId;
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      res.status(400).json({ error: "Current password and new password are required" });
      return;
    }

    if (newPassword.length < 6) {
      res.status(400).json({ error: "New password must be at least 6 characters" });
      return;
    }

    const prisma = getPrismaClient();

    // 查找用户
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.password) {
      res.status(404).json({ error: "User not found or no password set (OAuth user)" });
      return;
    }

    // 验证当前密码
    const valid = await bcrypt.compare(currentPassword, user.password);
    if (!valid) {
      res.status(401).json({ error: "Current password is incorrect" });
      return;
    }

    // 更新密码
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({
      where: { id: userId },
      data: { password: hashedPassword },
    });

    // 删除所有其他会话（可选的安全措施）
    const token = extractBearerToken(req);
    if (token) {
      await prisma.session.deleteMany({
        where: { userId, NOT: { token } },
      });
    }

    res.json({ success: true, message: "Password updated successfully" });
  } catch (error) {
    console.error("Password change error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// PUT /api/auth/profile - 更新个人资料
router.put("/profile", authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = (req as Request & { userId: string }).userId;
    const { username, email } = req.body;

    const prisma = getPrismaClient();

    // 构建更新数据
    const updateData: { username?: string; email?: string | null } = {};

    if (username !== undefined) {
      // 验证用户名
      if (typeof username !== "string" || username.length < 2 || username.length > 50) {
        res.status(400).json({ error: "Username must be between 2 and 50 characters" });
        return;
      }

      // 检查用户名是否已被使用
      if (username) {
        const existing = await prisma.user.findFirst({
          where: { username, NOT: { id: userId } },
        });
        if (existing) {
          res.status(409).json({ error: "Username already taken" });
          return;
        }
      }
      updateData.username = username;
    }

    if (email !== undefined) {
      // 验证邮箱格式
      if (email && typeof email === "string") {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
          res.status(400).json({ error: "Invalid email format" });
          return;
        }

        // 检查邮箱是否已被使用
        const existing = await prisma.user.findFirst({
          where: { email, NOT: { id: userId } },
        });
        if (existing) {
          res.status(409).json({ error: "Email already in use" });
          return;
        }
      }
      updateData.email = email || null;
    }

    if (Object.keys(updateData).length === 0) {
      res.status(400).json({ error: "No fields to update" });
      return;
    }

    // 更新用户
    const user = await prisma.user.update({
      where: { id: userId },
      data: updateData,
      select: {
        id: true,
        username: true,
        email: true,
        avatar: true,
        createdAt: true,
      },
    });

    res.json({ success: true, user });
  } catch (error) {
    console.error("Profile update error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/auth/avatar - 上传头像
router.post("/avatar", authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = (req as Request & { userId: string }).userId;
    const { avatar } = req.body;

    if (!avatar) {
      res.status(400).json({ error: "Avatar is required" });
      return;
    }

    // 验证是否为 Base64 图片数据
    const base64Regex = /^data:image\/(png|jpeg|jpg|gif|webp);base64,/;
    if (!base64Regex.test(avatar)) {
      res.status(400).json({ error: "Invalid avatar format. Must be a base64 encoded image" });
      return;
    }

    // 限制图片大小 (Base64 编码后约 2MB)
    const maxBase64Size = 2 * 1024 * 1024 * 1.37; // Base64 编码会增加约 37%
    if (avatar.length > maxBase64Size) {
      res.status(400).json({ error: "Avatar image too large. Maximum size is 2MB" });
      return;
    }

    const prisma = getPrismaClient();

    // 更新用户头像
    const user = await prisma.user.update({
      where: { id: userId },
      data: { avatar },
      select: {
        id: true,
        username: true,
        email: true,
        avatar: true,
        createdAt: true,
      },
    });

    res.json({ success: true, user });
  } catch (error) {
    console.error("Avatar upload error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /api/auth/avatar - 删除头像
router.delete("/avatar", authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = (req as Request & { userId: string }).userId;
    const prisma = getPrismaClient();

    const user = await prisma.user.update({
      where: { id: userId },
      data: { avatar: null },
      select: {
        id: true,
        username: true,
        email: true,
        avatar: true,
        createdAt: true,
      },
    });

    res.json({ success: true, user });
  } catch (error) {
    console.error("Avatar delete error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/auth/oauth/:provider - OAuth 跳转
router.get("/oauth/:provider", async (req: Request, res: Response) => {
  try {
    const { provider } = req.params;

    const service = getOAuthService(provider) as {
      getAuthorizationUrl: (state: string) => string;
    };

    const state = generateState();
    const prisma = getPrismaClient();

    // 存储 state 到数据库（5分钟过期）
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
    await prisma.oAuthState.create({
      data: { state, provider, expiresAt },
    });

    // 清理过期的 state
    await prisma.oAuthState.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });

    const authUrl = service.getAuthorizationUrl(state);
    res.redirect(authUrl);
  } catch (error) {
    console.error("OAuth redirect error:", error);
    res.status(500).json({ error: "OAuth failed" });
  }
});

// GET /api/auth/oauth/:provider/callback - OAuth 回调
router.get("/oauth/:provider/callback", async (req: Request, res: Response) => {
  try {
    const { provider } = req.params;
    const { code, state } = req.query;

    if (!code || typeof code !== "string") {
      res.status(400).json({ error: "Missing authorization code" });
      return;
    }

    const prisma = getPrismaClient();

    // 验证 state（从数据库获取）
    const stateData = await prisma.oAuthState.findUnique({
      where: { state: state as string },
    });

    if (!stateData || stateData.provider !== provider) {
      res.status(400).json({ error: "Invalid state" });
      return;
    }

    // 删除已使用的 state
    await prisma.oAuthState.delete({ where: { state: state as string } });

    const service = getOAuthService(provider) as {
      handleCallback: (code: string, state: string) => Promise<{
        provider: string;
        id: string;
        username?: string;
        email?: string;
        avatar?: string;
        displayName?: string;
      }>;
    };

    const profile = await service.handleCallback(code, state as string);

    // 查找或创建用户
    let user = await prisma.user.findFirst({
      where: { oauthProvider: profile.provider, oauthId: profile.id },
    });

    let isNewUser = false;

    if (!user) {
      user = await prisma.user.create({
        data: {
          username: profile.username || profile.displayName || `user_${profile.id.slice(0, 8)}`,
          email: profile.email,
          avatar: profile.avatar,
          oauthProvider: profile.provider,
          oauthId: profile.id,
        },
      });
      isNewUser = true;
    }

    // 创建会话和生成 token
    const generateToken = createTokenGenerator();
    const { token, expiresAt } = generateToken(user.id);
    await prisma.session.create({
      data: { userId: user.id, token, expiresAt },
    });

    // 重定向到前端，携带 token
    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
    const redirectUrl = `${frontendUrl}/auth/callback?token=${token}&isNewUser=${isNewUser}`;
    res.redirect(redirectUrl);
  } catch (error) {
    console.error("OAuth callback error:", error);
    res.status(500).json({ error: "OAuth authentication failed" });
  }
});

export default router;
