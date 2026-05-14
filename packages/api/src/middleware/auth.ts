import { createAuthMiddleware, extractBearerToken, LocalAuthService } from "@sacode/auth";
import { getPrismaClient } from "@sacode/database";

// 获取 JWT 配置
function getJwtConfig() {
  const secret = process.env.JWT_SECRET || "SACODE-dev-secret-change-in-production";
  return { secret, expiresIn: "7d" };
}

// 创建 LocalAuthService 用于 token 验证
function createAuthService(): LocalAuthService {
  const prisma = getPrismaClient();
  return new LocalAuthService({
    config: { jwt: getJwtConfig(), bcrypt: { rounds: 10 }, session: { enabled: true } },
    getUserByUsername: async () => null,
    getUserByEmail: async () => null,
    getUserWithPassword: async () => null,
    createUser: async () => { throw new Error("Not implemented"); },
    createSession: async () => { /* no-op */ },
  });
}

// 统一的认证中间件
export const authMiddleware = createAuthMiddleware({
  getTokenFromHeader: extractBearerToken,
  verifyToken: (token: string) => {
    const service = createAuthService();
    return service.verifyToken(token);
  },
  getUserById: async (id: string) => {
    const prisma = getPrismaClient();
    return prisma.user.findUnique({ where: { id } });
  },
});