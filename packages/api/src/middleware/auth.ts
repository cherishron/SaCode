import { createMiddleware } from "hono/factory";
import { LocalAuthService } from "@sacode/auth";
import { getPrismaClient } from "@sacode/database";

type Variables = {
  userId: string;
};

function getJwtConfig() {
  const secret = process.env.JWT_SECRET || "SACODE-dev-secret-change-in-production";
  return { secret, expiresIn: "7d" };
}

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

function extractBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return null;
  }
  return authHeader.slice(7);
}

export const authMiddleware = createMiddleware<{ Variables: Variables }>(async (c, next) => {
  const token = extractBearerToken(c.req.header("Authorization"));

  if (!token) {
    return c.json({ error: "No token provided" }, 401);
  }

  const service = createAuthService();
  const decoded = service.verifyToken(token);

  if (!decoded) {
    return c.json({ error: "Invalid token" }, 401);
  }

  const prisma = getPrismaClient();
  const user = await prisma.user.findUnique({ where: { id: decoded.userId } });

  if (!user) {
    return c.json({ error: "User not found" }, 401);
  }

  c.set("userId", user.id);
  await next();
});

export { extractBearerToken };
