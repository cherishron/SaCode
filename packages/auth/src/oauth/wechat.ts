import { OAuthService, type OAuthServiceOptions } from "./base";
import type { OAuthProfile } from "../types";

export interface WeChatOAuthOptions extends OAuthServiceOptions {
  provider: "wechat";
}

export class WeChatOAuthService extends OAuthService {
  constructor(options: WeChatOAuthOptions) {
    super(options);
  }

  getAuthorizationUrl(state: string): string {
    const params = new URLSearchParams({
      appid: this.options.config.clientId,
      redirect_uri: this.options.config.callbackUrl,
      response_type: "code",
      scope: "snsapi_login",
      state,
    });

    return `https://open.weixin.qq.com/connect/qrconnect?${params}#wechat_redirect`;
  }

  async handleCallback(code: string, _state: string): Promise<OAuthProfile> {
    // 获取 access token
    const tokenUrl = new URL("https://api.weixin.qq.com/sns/oauth2/access_token");
    tokenUrl.searchParams.set("appid", this.options.config.clientId);
    tokenUrl.searchParams.set("secret", this.options.config.clientSecret);
    tokenUrl.searchParams.set("code", code);
    tokenUrl.searchParams.set("grant_type", "authorization_code");

    const tokenResponse = await fetch(tokenUrl);
    const tokenData = (await tokenResponse.json()) as {
      access_token?: string;
      openid?: string;
      errcode?: number;
      errmsg?: string;
    };

    if (tokenData.errcode || !tokenData.access_token) {
      throw new Error(
        `WeChat OAuth error: ${tokenData.errmsg || "No access token"}`
      );
    }

    // 获取用户信息
    const userUrl = new URL("https://api.weixin.qq.com/sns/userinfo");
    userUrl.searchParams.set("access_token", tokenData.access_token);
    userUrl.searchParams.set("openid", tokenData.openid!);

    const userResponse = await fetch(userUrl);
    const userData = (await userResponse.json()) as {
      openid: string;
      nickname: string;
      headimgurl: string;
      unionid?: string;
    };

    return {
      provider: "wechat",
      id: userData.unionid || userData.openid,
      username: userData.nickname,
      avatar: userData.headimgurl,
      displayName: userData.nickname,
    };
  }
}
