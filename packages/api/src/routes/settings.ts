import { Hono } from "hono";
import { getPrismaClient } from "@sacode/database";
import { authMiddleware } from "../middleware/auth";
import { encryptApiKey, decryptApiKey, encryptOAuthSecret, decryptOAuthSecret } from "../utils/encryption";

type Variables = {
  userId: string;
};

const router = new Hono<{ Variables: Variables }>();
const prisma = getPrismaClient();

const AI_PROVIDERS = [
  { id: "openai", name: "OpenAI", defaultBaseUrl: "https://api.openai.com/v1" },
  { id: "anthropic", name: "Anthropic", defaultBaseUrl: "https://api.anthropic.com" },
  { id: "deepseek", name: "DeepSeek", defaultBaseUrl: "https://api.deepseek.com/v1" },
  { id: "moonshot", name: "Moonshot", defaultBaseUrl: "https://api.moonshot.cn/v1" },
  { id: "zhipu", name: "智谱 AI", defaultBaseUrl: "https://open.bigmodel.cn/api/paas/v4" },
  { id: "google", name: "Google AI", defaultBaseUrl: "https://generativelanguage.googleapis.com/v1" },
  { id: "azure", name: "Azure OpenAI", defaultBaseUrl: "" },
] as const;

function maskApiKey(key: string | null): string {
  if (!key) return "";
  if (key.length <= 8) return "***";
  return `${key.slice(0, 4)}${"*".repeat(Math.min(key.length - 8, 20))}${key.slice(-4)}`;
}

const encryptKey = encryptApiKey;
const decryptKey = decryptApiKey;

// GET /api/settings/providers
router.get("/providers", (c) => {
  return c.json({
    providers: AI_PROVIDERS.map((p) => ({
      id: p.id,
      name: p.name,
      defaultBaseUrl: p.defaultBaseUrl,
    })),
  });
});

// GET /api/settings/keys
router.get("/keys", authMiddleware, async (c) => {
  try {
    const keys = await prisma.apiKey.findMany({
      orderBy: { createdAt: "asc" },
    });

    return c.json({
      keys: keys.map((k) => ({
        id: k.id,
        provider: k.provider,
        name: k.name,
        maskedKey: maskApiKey(decryptKey(k.apiKey)),
        baseUrl: k.baseUrl,
        enabled: k.enabled,
        lastUsedAt: k.lastUsedAt?.toISOString() || null,
        createdAt: k.createdAt.toISOString(),
        updatedAt: k.updatedAt.toISOString(),
      })),
    });
  } catch (error) {
    console.error("Get API keys error:", error);
    return c.json({ error: "获取 API 密钥失败" }, 500);
  }
});

// GET /api/settings/keys/:provider
router.get("/keys/:provider", authMiddleware, async (c) => {
  try {
    const provider = c.req.param("provider");

    const key = await prisma.apiKey.findUnique({
      where: { provider },
    });

    if (!key) {
      return c.json({ error: "未找到该提供商的配置" }, 404);
    }

    return c.json({
      id: key.id,
      provider: key.provider,
      name: key.name,
      maskedKey: maskApiKey(decryptKey(key.apiKey)),
      baseUrl: key.baseUrl,
      enabled: key.enabled,
      lastUsedAt: key.lastUsedAt?.toISOString() || null,
      createdAt: key.createdAt.toISOString(),
      updatedAt: key.updatedAt.toISOString(),
    });
  } catch (error) {
    console.error("Get API key error:", error);
    return c.json({ error: "获取 API 密钥失败" }, 500);
  }
});

// POST /api/settings/keys
router.post("/keys", authMiddleware, async (c) => {
  try {
    const { provider, apiKey, baseUrl, name, enabled } = await c.req.json();

    const validProvider = AI_PROVIDERS.find((p) => p.id === provider);
    if (!validProvider) {
      return c.json({ error: "不支持的提供商" }, 400);
    }

    if (!apiKey || typeof apiKey !== "string") {
      return c.json({ error: "API 密钥不能为空" }, 400);
    }

    const encryptedKey = encryptKey(apiKey);
    const displayName = name || validProvider.name;

    const result = await prisma.apiKey.upsert({
      where: { provider },
      create: {
        provider,
        name: displayName,
        apiKey: encryptedKey,
        baseUrl: baseUrl || validProvider.defaultBaseUrl || null,
        enabled: enabled !== undefined ? enabled : true,
      },
      update: {
        name: displayName,
        apiKey: encryptedKey,
        baseUrl: baseUrl !== undefined ? baseUrl : undefined,
        enabled: enabled !== undefined ? enabled : undefined,
      },
    });

    return c.json({
      success: true,
      key: {
        id: result.id,
        provider: result.provider,
        name: result.name,
        maskedKey: maskApiKey(apiKey),
        baseUrl: result.baseUrl,
        enabled: result.enabled,
        createdAt: result.createdAt.toISOString(),
        updatedAt: result.updatedAt.toISOString(),
      },
    });
  } catch (error) {
    console.error("Save API key error:", error);
    return c.json({ error: "保存 API 密钥失败" }, 500);
  }
});

// PATCH /api/settings/keys/:provider
router.patch("/keys/:provider", authMiddleware, async (c) => {
  try {
    const provider = c.req.param("provider");
    const { apiKey, baseUrl, name, enabled } = await c.req.json();

    const existing = await prisma.apiKey.findUnique({
      where: { provider },
    });

    if (!existing) {
      return c.json({ error: "未找到该提供商的配置" }, 404);
    }

    const updateData: {
      name?: string;
      apiKey?: string;
      baseUrl?: string | null;
      enabled?: boolean;
    } = {};

    if (name !== undefined) updateData.name = name;
    if (apiKey !== undefined) updateData.apiKey = encryptKey(apiKey);
    if (baseUrl !== undefined) updateData.baseUrl = baseUrl;
    if (enabled !== undefined) updateData.enabled = enabled;

    const result = await prisma.apiKey.update({
      where: { provider },
      data: updateData,
    });

    return c.json({
      success: true,
      key: {
        id: result.id,
        provider: result.provider,
        name: result.name,
        maskedKey: maskApiKey(apiKey ? apiKey : decryptKey(result.apiKey)),
        baseUrl: result.baseUrl,
        enabled: result.enabled,
        updatedAt: result.updatedAt.toISOString(),
      },
    });
  } catch (error) {
    console.error("Update API key error:", error);
    return c.json({ error: "更新 API 密钥失败" }, 500);
  }
});

// DELETE /api/settings/keys/:provider
router.delete("/keys/:provider", authMiddleware, async (c) => {
  try {
    const provider = c.req.param("provider");

    const existing = await prisma.apiKey.findUnique({
      where: { provider },
    });

    if (!existing) {
      return c.json({ error: "未找到该提供商的配置" }, 404);
    }

    await prisma.apiKey.delete({
      where: { provider },
    });

    return c.json({ success: true, message: "API 密钥已删除" });
  } catch (error) {
    console.error("Delete API key error:", error);
    return c.json({ error: "删除 API 密钥失败" }, 500);
  }
});

// POST /api/settings/keys/:provider/test
router.post("/keys/:provider/test", authMiddleware, async (c) => {
  try {
    const provider = c.req.param("provider");

    const key = await prisma.apiKey.findUnique({
      where: { provider },
    });

    if (!key || !key.enabled) {
      return c.json({ error: "未找到有效的 API 密钥配置" }, 404);
    }

    const decryptedKey = decryptKey(key.apiKey);
    const baseUrl = key.baseUrl || AI_PROVIDERS.find((p) => p.id === provider)?.defaultBaseUrl;

    await prisma.apiKey.update({
      where: { provider },
      data: { lastUsedAt: new Date() },
    });

    let testResult = { success: false, message: "暂不支持该提供商的连接测试" };

    if (provider === "openai" || provider === "deepseek" || provider === "moonshot") {
      try {
        const response = await fetch(`${baseUrl}/models`, {
          headers: {
            Authorization: `Bearer ${decryptedKey}`,
          },
        });

        if (response.ok) {
          testResult = { success: true, message: "连接成功" };
        } else {
          const errorData = await response.json().catch(() => ({}));
          testResult = {
            success: false,
            message: `连接失败: ${errorData.error?.message || response.statusText}`,
          };
        }
      } catch (fetchError) {
        testResult = { success: false, message: `网络错误: ${(fetchError as Error).message}` };
      }
    } else if (provider === "anthropic") {
      try {
        const response = await fetch(`${baseUrl}/v1/messages`, {
          method: "POST",
          headers: {
            "x-api-key": decryptedKey,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "claude-3-haiku-20240307",
            max_tokens: 1,
            messages: [{ role: "user", content: "hi" }],
          }),
        });

        if (response.ok || response.status === 400) {
          testResult = { success: true, message: "连接成功" };
        } else {
          const errorData = await response.json().catch(() => ({}));
          testResult = {
            success: false,
            message: `连接失败: ${errorData.error?.message || response.statusText}`,
          };
        }
      } catch (fetchError) {
        testResult = { success: false, message: `网络错误: ${(fetchError as Error).message}` };
      }
    }

    return c.json(testResult);
  } catch (error) {
    console.error("Test API key error:", error);
    return c.json({ error: "测试连接失败" }, 500);
  }
});

// POST /api/settings/keys/:provider/verify
router.post("/keys/:provider/verify", authMiddleware, async (c) => {
  try {
    const provider = c.req.param("provider");
    const { apiKey } = await c.req.json();

    if (!apiKey) {
      return c.json({ valid: false, message: "API 密钥不能为空" }, 400);
    }

    let valid = false;
    let message = "";

    switch (provider) {
      case "openai":
        valid = apiKey.startsWith("sk-");
        message = valid ? "格式正确" : "OpenAI API Key 应以 sk- 开头";
        break;
      case "anthropic":
        valid = apiKey.startsWith("sk-ant-");
        message = valid ? "格式正确" : "Anthropic API Key 应以 sk-ant- 开头";
        break;
      case "deepseek":
        valid = apiKey.startsWith("sk-");
        message = valid ? "格式正确" : "DeepSeek API Key 应以 sk- 开头";
        break;
      case "moonshot":
        valid = apiKey.startsWith("sk-");
        message = valid ? "格式正确" : "Moonshot API Key 应以 sk- 开头";
        break;
      case "zhipu":
        valid = apiKey.length >= 20;
        message = valid ? "格式正确" : "智谱 AI API Key 长度不足";
        break;
      case "google":
        valid = apiKey.startsWith("AI");
        message = valid ? "格式正确" : "Google AI API Key 应以 AI 开头";
        break;
      default:
        valid = apiKey.length >= 10;
        message = valid ? "格式可能正确" : "API Key 长度不足";
    }

    return c.json({ valid, message });
  } catch (error) {
    console.error("Verify API key error:", error);
    return c.json({ error: "验证失败" }, 500);
  }
});

// ============================================
// OAuth 配置管理
// ============================================

const OAUTH_PROVIDERS = [
  { id: "github", name: "GitHub", requiresCallback: true },
  { id: "google", name: "Google", requiresCallback: true },
  { id: "wechat", name: "微信", requiresCallback: true },
  { id: "qq", name: "QQ", requiresCallback: true },
  { id: "wework", name: "企业微信", requiresCallback: true, requiresCorpId: true, requiresAgentId: true },
] as const;

// GET /api/settings/oauth/providers
router.get("/oauth/providers", (c) => {
  return c.json({
    providers: OAUTH_PROVIDERS.map((p) => ({
      id: p.id,
      name: p.name,
      requiresCallback: p.requiresCallback,
      requiresCorpId: p.requiresCorpId || false,
      requiresAgentId: p.requiresAgentId || false,
    })),
  });
});

// GET /api/settings/oauth
router.get("/oauth", authMiddleware, async (c) => {
  try {
    const configs = await prisma.oAuthConfig.findMany({
      orderBy: { createdAt: "asc" },
    });

    return c.json({
      configs: configs.map((co) => ({
        id: co.id,
        provider: co.provider,
        name: co.name,
        maskedClientId: maskApiKey(decryptKey(co.clientId)),
        maskedClientSecret: co.clientSecret ? "***" : "",
        callbackUrl: co.callbackUrl,
        corpId: co.corpId,
        agentId: co.agentId,
        enabled: co.enabled,
        createdAt: co.createdAt.toISOString(),
        updatedAt: co.updatedAt.toISOString(),
      })),
    });
  } catch (error) {
    console.error("Get OAuth configs error:", error);
    return c.json({ error: "获取 OAuth 配置失败" }, 500);
  }
});

// GET /api/settings/oauth/:provider
router.get("/oauth/:provider", authMiddleware, async (c) => {
  try {
    const provider = c.req.param("provider");

    const config = await prisma.oAuthConfig.findUnique({
      where: { provider },
    });

    if (!config) {
      return c.json({ error: "未找到该提供商的配置" }, 404);
    }

    return c.json({
      id: config.id,
      provider: config.provider,
      name: config.name,
      maskedClientId: maskApiKey(decryptKey(config.clientId)),
      callbackUrl: config.callbackUrl,
      corpId: config.corpId,
      agentId: config.agentId,
      enabled: config.enabled,
      createdAt: config.createdAt.toISOString(),
      updatedAt: config.updatedAt.toISOString(),
    });
  } catch (error) {
    console.error("Get OAuth config error:", error);
    return c.json({ error: "获取 OAuth 配置失败" }, 500);
  }
});

// POST /api/settings/oauth
router.post("/oauth", authMiddleware, async (c) => {
  try {
    const { provider, clientId, clientSecret, callbackUrl, corpId, agentId, name, enabled } = await c.req.json();

    const validProvider = OAUTH_PROVIDERS.find((p) => p.id === provider);
    if (!validProvider) {
      return c.json({ error: "不支持的 OAuth 提供商" }, 400);
    }

    if (!clientId || !clientSecret) {
      return c.json({ error: "Client ID 和 Client Secret 不能为空" }, 400);
    }

    if (provider === "wework" && !corpId) {
      return c.json({ error: "企业微信需要提供 CorpID" }, 400);
    }

    const encryptedClientId = encryptKey(clientId);
    const encryptedClientSecret = encryptKey(clientSecret);
    const displayName = name || validProvider.name;
    const defaultCallbackUrl = `${process.env.BASE_URL || "http://localhost:3000"}/api/auth/oauth/${provider}/callback`;

    const result = await prisma.oAuthConfig.upsert({
      where: { provider },
      create: {
        provider,
        name: displayName,
        clientId: encryptedClientId,
        clientSecret: encryptedClientSecret,
        callbackUrl: callbackUrl || defaultCallbackUrl,
        corpId: corpId || null,
        agentId: agentId || null,
        enabled: enabled !== undefined ? enabled : true,
      },
      update: {
        name: displayName,
        clientId: encryptedClientId,
        clientSecret: encryptedClientSecret,
        callbackUrl: callbackUrl !== undefined ? callbackUrl : undefined,
        corpId: corpId !== undefined ? corpId : undefined,
        agentId: agentId !== undefined ? agentId : undefined,
        enabled: enabled !== undefined ? enabled : undefined,
      },
    });

    return c.json({
      success: true,
      config: {
        id: result.id,
        provider: result.provider,
        name: result.name,
        maskedClientId: maskApiKey(clientId),
        callbackUrl: result.callbackUrl,
        corpId: result.corpId,
        agentId: result.agentId,
        enabled: result.enabled,
        createdAt: result.createdAt.toISOString(),
        updatedAt: result.updatedAt.toISOString(),
      },
    });
  } catch (error) {
    console.error("Save OAuth config error:", error);
    return c.json({ error: "保存 OAuth 配置失败" }, 500);
  }
});

// PATCH /api/settings/oauth/:provider
router.patch("/oauth/:provider", authMiddleware, async (c) => {
  try {
    const provider = c.req.param("provider");
    const { clientId, clientSecret, callbackUrl, corpId, agentId, name, enabled } = await c.req.json();

    const existing = await prisma.oAuthConfig.findUnique({
      where: { provider },
    });

    if (!existing) {
      return c.json({ error: "未找到该提供商的配置" }, 404);
    }

    const updateData: {
      name?: string;
      clientId?: string;
      clientSecret?: string;
      callbackUrl?: string | null;
      corpId?: string | null;
      agentId?: string | null;
      enabled?: boolean;
    } = {};

    if (name !== undefined) updateData.name = name;
    if (clientId !== undefined) updateData.clientId = encryptKey(clientId);
    if (clientSecret !== undefined) updateData.clientSecret = encryptKey(clientSecret);
    if (callbackUrl !== undefined) updateData.callbackUrl = callbackUrl;
    if (corpId !== undefined) updateData.corpId = corpId;
    if (agentId !== undefined) updateData.agentId = agentId;
    if (enabled !== undefined) updateData.enabled = enabled;

    const result = await prisma.oAuthConfig.update({
      where: { provider },
      data: updateData,
    });

    return c.json({
      success: true,
      config: {
        id: result.id,
        provider: result.provider,
        name: result.name,
        maskedClientId: maskApiKey(clientId ? clientId : decryptKey(result.clientId)),
        callbackUrl: result.callbackUrl,
        corpId: result.corpId,
        agentId: result.agentId,
        enabled: result.enabled,
        updatedAt: result.updatedAt.toISOString(),
      },
    });
  } catch (error) {
    console.error("Update OAuth config error:", error);
    return c.json({ error: "更新 OAuth 配置失败" }, 500);
  }
});

// DELETE /api/settings/oauth/:provider
router.delete("/oauth/:provider", authMiddleware, async (c) => {
  try {
    const provider = c.req.param("provider");

    const existing = await prisma.oAuthConfig.findUnique({
      where: { provider },
    });

    if (!existing) {
      return c.json({ error: "未找到该提供商的配置" }, 404);
    }

    await prisma.oAuthConfig.delete({
      where: { provider },
    });

    return c.json({ success: true, message: "OAuth 配置已删除" });
  } catch (error) {
    console.error("Delete OAuth config error:", error);
    return c.json({ error: "删除 OAuth 配置失败" }, 500);
  }
});

// POST /api/settings/oauth/:provider/toggle
router.post("/oauth/:provider/toggle", authMiddleware, async (c) => {
  try {
    const provider = c.req.param("provider");
    const { enabled } = await c.req.json();

    const existing = await prisma.oAuthConfig.findUnique({
      where: { provider },
    });

    if (!existing) {
      return c.json({ error: "未找到该提供商的配置" }, 404);
    }

    const result = await prisma.oAuthConfig.update({
      where: { provider },
      data: { enabled: enabled !== undefined ? enabled : !existing.enabled },
    });

    return c.json({
      success: true,
      config: {
        id: result.id,
        provider: result.provider,
        name: result.name,
        enabled: result.enabled,
        updatedAt: result.updatedAt.toISOString(),
      },
    });
  } catch (error) {
    console.error("Toggle OAuth config error:", error);
    return c.json({ error: "切换 OAuth 配置状态失败" }, 500);
  }
});

export default router;
