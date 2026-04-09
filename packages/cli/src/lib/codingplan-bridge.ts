/**
 * CodingPlan 到 SaCodeClient 的桥接层
 *
 * 从 CodingPlanAccountManager 获取激活账户，
 * 映射为 SaCodeClient 配置。
 */
import { CodingPlanAccountManager } from "../auth/account-manager.js";
import type { CodingPlanAccount } from "../auth/types.js";

// CodingPlan 错误码映射
export const CODING_PLAN_ERRORS: Record<string, { message: string; suggestion: string }> = {
  coding_plan_not_subscribed: {
    message: "未订阅 CodingPlan",
    suggestion: "请前往对应厂商控制台订阅 CodingPlan 方案",
  },
  coding_plan_hour_quota_exceeded: {
    message: "5 小时滑动窗口额度已用尽",
    suggestion: "请等待额度恢复，或切换到其他账户: sacode auth switch <id>",
  },
  coding_plan_week_quota_exceeded: {
    message: "本周额度已用尽",
    suggestion: "请等待下周重置，或升级到 Pro 套餐",
  },
  coding_plan_month_quota_exceeded: {
    message: "本月额度已用尽",
    suggestion: "请等待下月重置",
  },
  coding_plan_api_key_not_allowed: {
    message: "API Key 类型错误",
    suggestion: "请使用 CodingPlan 专属 Key（非普通 API Key）。运行 sacode auth providers 查看各厂商 Key 格式",
  },
};

export interface ClientConfig {
  providerType: "openai" | "anthropic";
  apiKey: string;
  baseUrl: string;
  model?: string;
}

/**
 * 从当前激活的 CodingPlan 账户生成 SaCodeClient 配置
 */
export async function getClientConfig(): Promise<ClientConfig> {
  const manager = new CodingPlanAccountManager();
  const account = await manager.getActiveAccount();
  return mapAccountToConfig(account);
}

/**
 * 映射 CodingPlan 账户到 Client 配置
 */
export function mapAccountToConfig(account: CodingPlanAccount): ClientConfig {
  return {
    providerType: account.protocol === "anthropic" ? "anthropic" : "openai",
    apiKey: account.apiKey,
    baseUrl: account.baseUrl,
    ...(account.defaultModel != null ? { model: account.defaultModel } : {}),
  };
}

/**
 * 运行时切换账户（热切换，无需重启 CLI）
 */
export async function switchAccountRuntime(accountId: string): Promise<ClientConfig> {
  const manager = new CodingPlanAccountManager();
  await manager.switchAccount(accountId);
  const account = await manager.getActiveAccount();
  return mapAccountToConfig(account);
}

/**
 * 解析 CodingPlan 特定错误
 */
export function parseCodingPlanError(error: unknown): {
  isCodingPlanError: boolean;
  code?: string;
  message?: string;
  suggestion?: string;
} {
  // 检查各种错误格式
  const errorStr = error instanceof Error ? error.message : String(error);

  for (const [code, info] of Object.entries(CODING_PLAN_ERRORS)) {
    if (errorStr.includes(code)) {
      return { isCodingPlanError: true, code, ...info };
    }
  }

  // 检查 HTTP 状态码模式
  if (errorStr.includes("402") || errorStr.includes("quota") || errorStr.includes("insufficient")) {
    return {
      isCodingPlanError: true,
      code: "quota_exceeded",
      message: "额度不足",
      suggestion: "请检查 CodingPlan 订阅状态，或切换到其他账户",
    };
  }

  return { isCodingPlanError: false };
}
