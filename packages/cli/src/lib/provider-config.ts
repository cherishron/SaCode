import type { ProviderConfig } from "@sacode/core";
import { loadProviderStore, providerConfigFromStore } from "./provider-store.js";

const DEFAULT_MODEL = "gpt-4o";

export function getProviderConfigFromEnv(env: NodeJS.ProcessEnv = process.env): ProviderConfig {
  const providerType = (env.AI_PROVIDER ?? "openai") as ProviderConfig["type"];

  const baseConfig = {
    type: providerType,
    apiKey: "",
    model: env.AI_MODEL ?? DEFAULT_MODEL,
  } as const;

  switch (providerType) {
    case "anthropic":
      return {
        ...baseConfig,
        type: "anthropic",
        apiKey: env.ANTHROPIC_API_KEY ?? "",
        model: env.ANTHROPIC_MODEL ?? env.AI_MODEL ?? DEFAULT_MODEL,
        ...(env.ANTHROPIC_BASE_URL && { baseUrl: env.ANTHROPIC_BASE_URL }),
      };
    case "deepseek":
      return {
        ...baseConfig,
        type: "deepseek",
        apiKey: env.DEEPSEEK_API_KEY ?? "",
        model: env.DEEPSEEK_MODEL ?? env.AI_MODEL ?? DEFAULT_MODEL,
      };
    case "moonshot":
      return {
        ...baseConfig,
        type: "moonshot",
        apiKey: env.MOONSHOT_API_KEY ?? "",
        model: env.MOONSHOT_MODEL ?? env.AI_MODEL ?? DEFAULT_MODEL,
      };
    case "zhipu":
      return {
        ...baseConfig,
        type: "zhipu",
        apiKey: env.ZHIPU_API_KEY ?? "",
        model: env.ZHIPU_MODEL ?? env.AI_MODEL ?? DEFAULT_MODEL,
      };
    case "openai":
    default:
      return {
        ...baseConfig,
        type: "openai",
        apiKey: env.OPENAI_API_KEY ?? "",
        model: env.OPENAI_MODEL ?? env.AI_MODEL ?? DEFAULT_MODEL,
        ...(env.OPENAI_BASE_URL && { baseUrl: env.OPENAI_BASE_URL }),
      };
  }
}

export async function resolveProviderConfig(
  env: NodeJS.ProcessEnv = process.env,
): Promise<ProviderConfig> {
  const storeConfig = providerConfigFromStore(await loadProviderStore(), env);
  if (storeConfig?.apiKey) {
    return storeConfig;
  }

  return getProviderConfigFromEnv(env);
}
