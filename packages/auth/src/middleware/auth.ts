import type { Request, Response, NextFunction } from "express";

export interface AuthMiddlewareOptions {
  getTokenFromHeader: (req: Request) => string | null;
  verifyToken: (token: string) => { userId: string } | null;
  getUserById: (id: string) => Promise<{ id: string } | null>;
}

export function createAuthMiddleware(options: AuthMiddlewareOptions) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const token = options.getTokenFromHeader(req);

      if (!token) {
        res.status(401).json({ error: "No token provided" });
        return;
      }

      const decoded = options.verifyToken(token);

      if (!decoded) {
        res.status(401).json({ error: "Invalid token" });
        return;
      }

      const user = await options.getUserById(decoded.userId);

      if (!user) {
        res.status(401).json({ error: "User not found" });
        return;
      }

      (req as Request & { userId: string }).userId = user.id;
      next();
    } catch (error) {
      res.status(500).json({ error: "Authentication failed" });
    }
  };
}

export function extractBearerToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return null;
  }
  return authHeader.slice(7);
}
