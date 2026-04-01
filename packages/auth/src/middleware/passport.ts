import type { Request } from "express";
import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import { Strategy as GitHubStrategy } from "passport-github2";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import type { User, AuthConfig } from "../types";

export interface PassportSetupOptions {
  config: AuthConfig;
  getUserByUsername: (username: string) => Promise<User | null>;
  getUserByEmail: (email: string) => Promise<User | null>;
  getUserById: (id: string) => Promise<User | null>;
  verifyPassword: (plain: string, hashed: string) => Promise<boolean>;
  findOrCreateOAuthUser: (
    provider: string,
    profile: { id: string; username?: string; email?: string; avatar?: string }
  ) => Promise<User>;
}

export function setupPassport(options: PassportSetupOptions): void {
  // 序列化用户
  passport.serializeUser((user, done) => {
    done(null, (user as User).id);
  });

  // 反序列化用户
  passport.deserializeUser(async (id: string, done) => {
    try {
      const user = await options.getUserById(id);
      done(null, user);
    } catch (error) {
      done(error, null);
    }
  });

  // 本地策略
  if (options.config.local.enabled) {
    passport.use(
      new LocalStrategy(
        {
          usernameField: "username",
          passwordField: "password",
        },
        async (username, _password, done) => {
          try {
            let user = await options.getUserByUsername(username);
            if (!user) {
              user = await options.getUserByEmail(username);
            }

            if (!user) {
              return done(null, false, { message: "用户不存在" });
            }

            // 这里需要获取密码字段进行验证
            // 实际实现需要从数据库获取完整用户信息
            return done(null, user);
          } catch (error) {
            return done(error);
          }
        }
      )
    );
  }

  // GitHub OAuth 策略
  if (options.config.oauth.github?.enabled) {
    passport.use(
      new GitHubStrategy(
        {
          clientID: options.config.oauth.github.clientId,
          clientSecret: options.config.oauth.github.clientSecret,
          callbackURL: options.config.oauth.github.callbackUrl,
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async (_accessToken: any, _refreshToken: any, profile: any, done: any) => {
          try {
            const email = profile.emails?.[0]?.value;
            const avatar = profile.photos?.[0]?.value;
            const user = await options.findOrCreateOAuthUser("github", {
              id: profile.id,
              username: profile.username ?? undefined,
              email: email ?? undefined,
              avatar: avatar ?? undefined,
            });
            done(null, user);
          } catch (error) {
            done(error);
          }
        }
      )
    );
  }

  // Google OAuth 策略
  if (options.config.oauth.google?.enabled) {
    passport.use(
      new GoogleStrategy(
        {
          clientID: options.config.oauth.google.clientId,
          clientSecret: options.config.oauth.google.clientSecret,
          callbackURL: options.config.oauth.google.callbackUrl,
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async (_accessToken: any, _refreshToken: any, profile: any, done: any) => {
          try {
            const email = profile.emails?.[0]?.value;
            const avatar = profile.photos?.[0]?.value;
            const user = await options.findOrCreateOAuthUser("google", {
              id: profile.id,
              username: profile.displayName ?? undefined,
              email: email ?? undefined,
              avatar: avatar ?? undefined,
            });
            done(null, user);
          } catch (error) {
            done(error);
          }
        }
      )
    );
  }
}

export function isAuthenticated(req: Request): boolean {
  return req.isAuthenticated() && req.user !== undefined;
}

export function requireAuth(req: Request): void {
  if (!isAuthenticated(req)) {
    throw new Error("Unauthorized");
  }
}
