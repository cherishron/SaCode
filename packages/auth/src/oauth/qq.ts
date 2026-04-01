import { OAuthService, type OAuthServiceOptions } from "./base";
import type { OAuthProfile } from "../types";

export interface QQOAuthOptions extends OAuthServiceOptions {
  provider: "qq";
}

export class QQOAuthService extends OAuthService {
  constructor(options: QQOAuthOptions) {
    super(options);
  }

  getAuthorizationUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: this.options.config.clientId,
      redirect_uri: this.options.config.callbackUrl,
      response_type: "code",
      scope: "get_user_info",
      state,
    });

    return `https://graph.qq.com/oauth2.0/authorize?${params}`;
  }

  async handleCallback(code: string, _state: string): Promise<OAuthProfile> {
    // 获取 access token
    const tokenUrl = new URL("https://graph.qq.com/oauth2.0/token");
    tokenUrl.searchParams.set("grant_type", "authorization_code");
    tokenUrl.searchParams.set("client_id", this.options.config.clientId);
    tokenUrl.searchParams.set("client_secret", this.options.config.clientSecret);
    tokenUrl.searchParams.set("code", code);
    tokenUrl.searchParams.set("redirect_uri", this.options.config.callbackUrl);

    const tokenResponse = await fetch(tokenUrl);
    const tokenText = await tokenResponse.text();

    // QQ 返回的是 callback({...}) 格式或 URL 参数格式
    let accessToken = "";
    let clientId = this.options.config.clientId;

    // 尝试解析 JSONP 格式
    const jsonpMatch = tokenText.match(/callback\((.+)\)/);
    if (jsonpMatch && jsonpMatch[1]) {
      const tokenData = JSON.parse(jsonpMatch[1]) as {
        access_token?: string;
        error?: number;
        error_description?: string;
      };
      if (tokenData.error) {
        throw new Error(`QQ OAuth error: ${tokenData.error_description ?? "Unknown error"}`);
      }
      accessToken = tokenData.access_token ?? "";
    } else {
      // 尝试解析 URL 参数格式
      const params = new URLSearchParams(tokenText);
      accessToken = params.get("access_token") ?? "";
    }

    if (!accessToken) {
      throw new Error("QQ OAuth error: No access token");
    }

    // 获取 openid
    const meUrl = new URL("https://graph.qq.com/oauth2.0/me");
    meUrl.searchParams.set("access_token", accessToken);
    meUrl.searchParams.set("unionid", "1");

    const meResponse = await fetch(meUrl);
    const meText = await meResponse.text();

    let openid = "";
    let unionid = "";

    const meJsonpMatch = meText.match(/callback\((.+)\)/);
    if (meJsonpMatch && meJsonpMatch[1]) {
      const meData = JSON.parse(meJsonpMatch[1]) as {
        openid?: string;
        unionid?: string;
        client_id?: string;
        error?: number;
        error_description?: string;
      };
      if (meData.error) {
        throw new Error(`QQ OAuth error: ${meData.error_description ?? "Unknown error"}`);
      }
      openid = meData.openid ?? "";
      unionid = meData.unionid ?? "";
      if (meData.client_id) {
        clientId = meData.client_id;
      }
    }

    if (!openid) {
      throw new Error("QQ OAuth error: No openid");
    }

    // 获取用户信息
    const userUrl = new URL("https://graph.qq.com/user/get_user_info");
    userUrl.searchParams.set("access_token", accessToken);
    userUrl.searchParams.set("oauth_consumer_key", clientId);
    userUrl.searchParams.set("openid", openid);

    const userResponse = await fetch(userUrl);
    const userData = (await userResponse.json()) as {
      ret: number;
      nickname: string;
      figureurl_qq_2?: string;
      figureurl_qq_1?: string;
      figureurl?: string;
      msg?: string;
    };

    if (userData.ret !== 0) {
      throw new Error(`QQ OAuth error: ${userData.msg ?? "Unknown error"}`);
    }

    const avatarUrl = userData.figureurl_qq_2 ?? userData.figureurl_qq_1 ?? userData.figureurl;

    const profile: OAuthProfile = {
      provider: "qq",
      id: unionid || openid,
      username: userData.nickname,
      displayName: userData.nickname,
    };

    if (avatarUrl) {
      profile.avatar = avatarUrl;
    }

    return profile;
  }
}