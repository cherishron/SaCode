import { OAuthService, type OAuthServiceOptions } from "./base";
import type { OAuthProfile } from "../types";

export interface GitHubOAuthOptions extends OAuthServiceOptions {
  provider: "github";
}

export class GitHubOAuthService extends OAuthService {
  constructor(options: GitHubOAuthOptions) {
    super(options);
  }

  getAuthorizationUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: this.options.config.clientId,
      redirect_uri: this.options.config.callbackUrl,
      scope: "read:user user:email",
      state,
    });

    return `https://github.com/login/oauth/authorize?${params}`;
  }

  async handleCallback(code: string, _state: string): Promise<OAuthProfile> {
    // 获取 access token
    const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        client_id: this.options.config.clientId,
        client_secret: this.options.config.clientSecret,
        code,
        redirect_uri: this.options.config.callbackUrl,
      }),
    });

    const tokenData = (await tokenResponse.json()) as {
      access_token?: string;
      error?: string;
    };

    if (tokenData.error || !tokenData.access_token) {
      throw new Error(`GitHub OAuth error: ${tokenData.error || "No access token"}`);
    }

    // 获取用户信息
    const userResponse = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        Accept: "application/vnd.github.v3+json",
      },
    });

    const userData = (await userResponse.json()) as {
      id: number;
      login: string;
      email: string | null;
      avatar_url: string;
      name: string | null;
    };

    const profile: OAuthProfile = {
      provider: "github",
      id: String(userData.id),
      username: userData.login,
      avatar: userData.avatar_url,
    };
    if (userData.email !== null) {
      profile.email = userData.email;
    }
    if (userData.name !== null) {
      profile.displayName = userData.name;
    }
    return profile;
  }
}
