import { OAuthService, type OAuthServiceOptions } from "./base";
import type { OAuthProfile } from "../types";

export interface WeWorkOAuthOptions extends OAuthServiceOptions {
  provider: "wework";
}

export class WeWorkOAuthService extends OAuthService {
  private corpId: string;
  private agentId: string;

  constructor(options: WeWorkOAuthOptions & { corpId: string; agentId: string }) {
    super(options);
    this.corpId = options.corpId;
    this.agentId = options.agentId;
  }

  getAuthorizationUrl(state: string): string {
    const params = new URLSearchParams({
      appid: this.corpId,
      agentid: this.agentId,
      redirect_uri: this.options.config.callbackUrl,
      response_type: "code",
      scope: "snsapi_privateinfo",
      state,
    });

    return `https://open.work.weixin.qq.com/wwopen/sso/qrConnect?${params}`;
  }

  async handleCallback(code: string, _state: string): Promise<OAuthProfile> {
    // 获取 access token (企业微信需要先获取企业 access_token)
    const tokenUrl = new URL("https://qyapi.weixin.qq.com/cgi-bin/gettoken");
    tokenUrl.searchParams.set("corpid", this.corpId);
    tokenUrl.searchParams.set("corpsecret", this.options.config.clientSecret);

    const tokenResponse = await fetch(tokenUrl);
    const tokenData = (await tokenResponse.json()) as {
      access_token?: string;
      errcode?: number;
      errmsg?: string;
    };

    if (tokenData.errcode || !tokenData.access_token) {
      throw new Error(
        `WeWork OAuth error: ${tokenData.errmsg || "No access token"}`
      );
    }

    // 获取用户信息
    const userUrl = new URL("https://qyapi.weixin.qq.com/cgi-bin/user/getuserinfo");
    userUrl.searchParams.set("access_token", tokenData.access_token);
    userUrl.searchParams.set("code", code);

    const userResponse = await fetch(userUrl);
    const userData = (await userResponse.json()) as {
      UserId?: string;
      OpenId?: string;
      DeviceId?: string;
      errcode?: number;
      errmsg?: string;
    };

    if (userData.errcode) {
      throw new Error(`WeWork OAuth error: ${userData.errmsg}`);
    }

    const userId = userData.UserId || userData.OpenId;
    if (!userId) {
      throw new Error("WeWork OAuth error: No user id");
    }

    // 获取详细用户信息
    const detailUrl = new URL("https://qyapi.weixin.qq.com/cgi-bin/user/get");
    detailUrl.searchParams.set("access_token", tokenData.access_token);
    detailUrl.searchParams.set("userid", userId);

    const detailResponse = await fetch(detailUrl);
    const detailData = (await detailResponse.json()) as {
      userid: string;
      name?: string;
      avatar?: string;
      email?: string;
      mobile?: string;
      errcode?: number;
      errmsg?: string;
    };

    const profile: OAuthProfile = {
      provider: "wework",
      id: userId,
      username: userId,
    };

    if (detailData.name) {
      profile.displayName = detailData.name;
      profile.username = detailData.name;
    }
    if (detailData.avatar) {
      profile.avatar = detailData.avatar;
    }
    if (detailData.email) {
      profile.email = detailData.email;
    }

    return profile;
  }
}
