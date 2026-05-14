import { getProviderStorePath, upsertProviderModel, type ProviderAdapter } from "./provider-store";

export type SupportedProvider = "openai" | "anthropic" | "deepseek" | "moonshot" | "zhipu";

export interface InitEnvOptions {
  provider?: SupportedProvider;
  model?: string;
  adapter?: ProviderAdapter;
  apiKeyEnv?: string;
  baseUrl?: string;
}

export interface InitEnvResult {
  path: string;
  created: boolean;
  provider: SupportedProvider;
  apiKeyEnv: string;
}

export async function initUserConfig(options: InitEnvOptions = {}): Promise<InitEnvResult> {
  const provider = options.provider ?? "openai";
  const apiKeyEnv = options.apiKeyEnv ?? apiKeyEnvFor(provider);
  await upsertProviderModel({
    provider,
    name: providerNameFor(provider),
    model: options.model ?? defaultModelFor(provider),
    adapter: options.adapter ?? adapterFor(provider),
    baseUrl: options.baseUrl,
    apiKeyEnv,
    capabilities: ["chat", "tool_calling"],
    makeDefault: true,
  });

  return { path: getProviderStorePath(), created: true, provider, apiKeyEnv };
}

export function isSupportedProvider(value: string): value is SupportedProvider {
  return ["openai", "anthropic", "deepseek", "moonshot", "zhipu"].includes(value);
}

export function apiKeyEnvFor(provider: SupportedProvider): string {
  return `${provider.toUpperCase()}_API_KEY`;
}

function defaultModelFor(provider: SupportedProvider): string {
  switch (provider) {
    case "anthropic":
      return "claude-3-5-sonnet-latest";
    case "deepseek":
      return "deepseek-chat";
    case "moonshot":
      return "moonshot-v1-8k";
    case "zhipu":
      return "glm-4-plus";
    case "openai":
    default:
      return "gpt-4o";
  }
}

function adapterFor(provider: SupportedProvider): ProviderAdapter {
  return provider === "anthropic" ? "anthropic" : "openai-compatible";
}

function providerNameFor(provider: SupportedProvider): string {
  switch (provider) {
    case "anthropic":
      return "Anthropic";
    case "deepseek":
      return "DeepSeek";
    case "moonshot":
      return "Moonshot";
    case "zhipu":
      return "Zhipu";
    case "openai":
    default:
      return "OpenAI";
  }
}
