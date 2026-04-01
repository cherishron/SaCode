import { z } from "zod";

// ============================================================================
// 用户类型
// ============================================================================

export interface User {
  id: string;
  username?: string | null;
  email?: string | null;
  avatar?: string | null;
  oauthProvider?: string | null;
  oauthId?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateUserInput {
  username?: string;
  email?: string;
  password?: string;
  avatar?: string;
  oauthProvider?: string;
  oauthId?: string;
}

export interface UpdateUserInput {
  username?: string;
  email?: string;
  avatar?: string;
}

// ============================================================================
// 会话类型
// ============================================================================

export interface AuthSession {
  id: string;
  userId: string;
  token: string;
  expiresAt: Date;
  createdAt: Date;
}

export interface CreateSessionInput {
  userId: string;
  token: string;
  expiresAt: Date;
}

// ============================================================================
// OAuth 类型
// ============================================================================

export const OAuthProviderSchema = z.enum(["github", "google", "wechat", "wework", "qq"]);
export type OAuthProvider = z.infer<typeof OAuthProviderSchema>;

export interface OAuthProfile {
  provider: OAuthProvider;
  id: string;
  username?: string;
  email?: string;
  avatar?: string;
  displayName?: string;
}

export interface OAuthConfig {
  enabled: boolean;
  clientId: string;
  clientSecret: string;
  callbackUrl: string;
}

// ============================================================================
// 认证配置
// ============================================================================

export interface AuthConfig {
  local: {
    enabled: boolean;
  };
  oauth: {
    github?: OAuthConfig;
    google?: OAuthConfig;
    wechat?: OAuthConfig;
    wework?: OAuthConfig;
    qq?: OAuthConfig;
  };
  session: {
    secret: string;
    maxAge: number; // milliseconds
  };
  jwt: {
    secret: string;
    expiresIn: string;
  };
}

// ============================================================================
// 认证结果
// ============================================================================

export interface AuthResult {
  success: boolean;
  user?: User;
  session?: AuthSession;
  token?: string;
  error?: string;
}
