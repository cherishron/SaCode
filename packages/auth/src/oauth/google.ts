import { OAuthService, type OAuthServiceOptions } from "./base";
import type { OAuthProfile } from "../types";

export interface GoogleOAuthOptions extends OAuthServiceOptions {
  provider: "google";
}

export class GoogleOAuthService extends OAuthService {
  constructor(options: GoogleOAuthOptions) {
    super(options);
  }

  getAuthorizationUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: this.options.config.clientId,
      redirect_uri: this.options.config.callbackUrl,
      response_type: "code",
      scope: "openid email profile",
      state,
    });

    return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  }

  async handleCallback(code: string, _state: string): Promise<OAuthProfile> {
    // 获取 access token
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: this.options.config.clientId,
        client_secret: this.options.config.clientSecret,
        code,
        grant_type: "authorization_code",
        redirect_uri: this.options.config.callbackUrl,
      }),
    });

    const tokenData = (await tokenResponse.json()) as {
      access_token?: string;
      error?: string;
    };

    if (tokenData.error || !tokenData.access_token) {
      throw new Error(`Google OAuth error: ${tokenData.error || "No access token"}`);
    }

    // 获取用户信息
    const userResponse = await fetch(
      "https://www.googleapis.com/oauth2/v2/userinfo",
      {
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
        },
      }
    );

    const userData = (await userResponse.json()) as {
      id: string;
      email: string;
      picture: string;
      name: string;
    };

    return {
      provider: "google",
      id: userData.id,
      email: userData.email,
      avatar: userData.picture,
      displayName: userData.name,
    };
  }
}
