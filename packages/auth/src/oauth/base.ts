import type { OAuthProfile, OAuthProvider, OAuthConfig } from "../types";

export interface OAuthServiceOptions {
  provider: OAuthProvider;
  config: OAuthConfig;
  findUserByOAuth: (
    provider: OAuthProvider,
    oauthId: string
  ) => Promise<{ id: string } | null>;
  createUser: (profile: OAuthProfile) => Promise<{ id: string }>;
  createSession: (userId: string, token: string, expiresAt: Date) => Promise<void>;
  generateToken: (userId: string) => { token: string; expiresAt: Date };
}

export abstract class OAuthService {
  protected options: OAuthServiceOptions;

  constructor(options: OAuthServiceOptions) {
    this.options = options;
  }

  abstract getAuthorizationUrl(state: string): string;
  abstract handleCallback(code: string, state: string): Promise<OAuthProfile>;

  getCallbackUrl(): string {
    return this.options.config.callbackUrl;
  }

  getProvider(): OAuthProvider {
    return this.options.provider;
  }

  async authenticate(profile: OAuthProfile): Promise<{
    userId: string;
    isNewUser: boolean;
    token: string;
  }> {
    // 查找现有用户
    let user = await this.options.findUserByOAuth(profile.provider, profile.id);
    let isNewUser = false;

    if (!user) {
      // 创建新用户
      user = await this.options.createUser(profile);
      isNewUser = true;
    }

    // 创建会话
    const { token, expiresAt } = this.options.generateToken(user.id);
    await this.options.createSession(user.id, token, expiresAt);

    return {
      userId: user.id,
      isNewUser,
      token,
    };
  }
}
