import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export type ProviderAdapter = "openai-compatible" | "anthropic" | "custom-http";

export interface ModelConfigEntry {
  id: string;
  label?: string;
  capabilities: string[];
}

export interface ProviderConfigEntry {
  id: string;
  name: string;
  adapter: ProviderAdapter;
  baseUrl?: string;
  apiKeyEnv: string;
  models: ModelConfigEntry[];
}

export interface ProviderStoreData {
  providers: ProviderConfigEntry[];
  defaultModel?: string;
}

export interface ProviderStoreOptions {
  configDir?: string;
}

const DEFAULT_PROVIDERS: ProviderConfigEntry[] = [
  {
    id: "openai",
    name: "OpenAI",
    adapter: "openai-compatible",
    baseUrl: "https://api.openai.com/v1",
    apiKeyEnv: "OPENAI_API_KEY",
    models: [
      { id: "gpt-4o", label: "GPT-4o", capabilities: ["chat", "tool_calling"] },
    ],
  },
];

export function getProviderStorePath(options: ProviderStoreOptions = {}): string {
  return path.join(options.configDir ?? path.join(os.homedir(), ".sacode"), "providers.json");
}

export function createDefaultProviderStore(): ProviderStoreData {
  return {
    providers: DEFAULT_PROVIDERS,
    defaultModel: "openai/gpt-4o",
  };
}

export async function loadProviderStore(options: ProviderStoreOptions = {}): Promise<ProviderStoreData> {
  const storePath = getProviderStorePath(options);
  try {
    return normalizeProviderStore(JSON.parse(await fs.readFile(storePath, "utf-8")));
  } catch {
    return createDefaultProviderStore();
  }
}

export async function saveProviderStore(data: ProviderStoreData, options: ProviderStoreOptions = {}): Promise<void> {
  const storePath = getProviderStorePath(options);
  await fs.mkdir(path.dirname(storePath), { recursive: true });
  await fs.writeFile(storePath, `${JSON.stringify(normalizeProviderStore(data), null, 2)}\n`, "utf-8");
}

export async function setDefaultModel(modelRef: string, options: ProviderStoreOptions = {}): Promise<ProviderStoreData> {
  const data = await ensureProviderStore(options);
  const match = findModel(data, modelRef);
  if (!match) {
    throw new Error(`Model not found: ${modelRef}`);
  }

  const updated = { ...data, defaultModel: `${match.provider.id}/${match.model.id}` };
  await saveProviderStore(updated, options);
  return updated;
}

export async function upsertProviderModel(input: {
  provider: string;
  model: string;
  adapter?: ProviderAdapter;
  name?: string;
  baseUrl?: string;
  apiKeyEnv?: string;
  label?: string;
  capabilities?: string[];
  makeDefault?: boolean;
}, options: ProviderStoreOptions = {}): Promise<ProviderStoreData> {
  const data = await ensureProviderStore(options);
  const providerId = normalizeId(input.provider);
  const modelId = input.model.trim();
  if (!providerId) throw new Error("Provider id is required");
  if (!modelId) throw new Error("Model id is required");

  const providers = [...data.providers];
  const providerIndex = providers.findIndex((provider) => provider.id === providerId);
  const existingProvider = providers[providerIndex];
  const nextProvider: ProviderConfigEntry = existingProvider
    ? { ...existingProvider, models: [...existingProvider.models] }
    : {
        id: providerId,
        name: input.name ?? providerId,
        adapter: input.adapter ?? "openai-compatible",
        apiKeyEnv: input.apiKeyEnv ?? apiKeyEnvFor(providerId),
        models: [],
      };

  if (input.name) nextProvider.name = input.name;
  if (input.adapter) nextProvider.adapter = input.adapter;
  if (input.baseUrl) nextProvider.baseUrl = input.baseUrl;
  if (input.apiKeyEnv) nextProvider.apiKeyEnv = input.apiKeyEnv;

  const modelIndex = nextProvider.models.findIndex((model) => model.id === modelId);
  const model: ModelConfigEntry = {
    ...(nextProvider.models[modelIndex] ?? { id: modelId, capabilities: ["chat"] }),
    id: modelId,
    ...(input.label && { label: input.label }),
    capabilities: input.capabilities ?? nextProvider.models[modelIndex]?.capabilities ?? ["chat"],
  };

  if (modelIndex >= 0) {
    nextProvider.models[modelIndex] = model;
  } else {
    nextProvider.models.push(model);
  }

  if (providerIndex >= 0) {
    providers[providerIndex] = nextProvider;
  } else {
    providers.push(nextProvider);
  }

  const modelRef = `${providerId}/${modelId}`;
  const updated: ProviderStoreData = {
    providers,
    defaultModel: input.makeDefault === false ? data.defaultModel : modelRef,
  };
  await saveProviderStore(updated, options);
  return updated;
}

export function findModel(data: ProviderStoreData, modelRef: string): { provider: ProviderConfigEntry; model: ModelConfigEntry } | null {
  const parts = modelRef.split("/");
  if (parts.length < 2 || parts.length > 2) return null;
  const [providerId, modelId] = parts;
  if (!providerId || !modelId) return null;
  const provider = data.providers.find((item) => item.id === providerId);
  const model = provider?.models.find((item) => item.id === modelId);
  return provider && model ? { provider, model } : null;
}

export function testModelConfiguration(data: ProviderStoreData, modelRef: string): { ok: boolean; message: string } {
  const match = findModel(data, modelRef);
  if (!match) return { ok: false, message: `模型不存在: ${modelRef}` };

  const missing: string[] = [];
  if (!match.provider.adapter) missing.push("adapter");
  if (!match.provider.apiKeyEnv) missing.push("apiKeyEnv");
  if (match.provider.adapter === "openai-compatible" && !match.provider.baseUrl) missing.push("baseUrl");
  if (missing.length > 0) {
    return { ok: false, message: `模型配置不完整: ${missing.join(", ")}` };
  }

  return {
    ok: true,
    message: `模型配置可用: ${match.provider.id}/${match.model.id}\nadapter: ${match.provider.adapter}\napiKeyEnv: ${match.provider.apiKeyEnv}${match.provider.baseUrl ? `\nbaseUrl: ${match.provider.baseUrl}` : ""}`,
  };
}

export function providerConfigForModelRef(
  data: ProviderStoreData,
  modelRef: string,
  env: NodeJS.ProcessEnv = process.env,
): {
  type: "openai" | "anthropic" | "deepseek" | "moonshot" | "zhipu";
  apiKey: string;
  model: string;
  baseUrl?: string;
} | null {
  const match = findModel(data, modelRef);
  if (!match) return null;

  const type = providerTypeFor(match.provider);
  return {
    type,
    apiKey: env[match.provider.apiKeyEnv] ?? "",
    model: match.model.id,
    ...(match.provider.baseUrl && { baseUrl: match.provider.baseUrl }),
  };
}

export function providerConfigFromStore(data: ProviderStoreData, env: NodeJS.ProcessEnv = process.env): {
  type: "openai" | "anthropic" | "deepseek" | "moonshot" | "zhipu";
  apiKey: string;
  model: string;
  baseUrl?: string;
} | null {
  if (!data.defaultModel) return null;
  return providerConfigForModelRef(data, data.defaultModel, env);
}

export async function ensureProviderStore(options: ProviderStoreOptions = {}): Promise<ProviderStoreData> {
  const storePath = getProviderStorePath(options);
  try {
    await fs.access(storePath);
    return loadProviderStore(options);
  } catch {
    const data = createDefaultProviderStore();
    await saveProviderStore(data, options);
    return data;
  }
}

export function formatProviders(data: ProviderStoreData): string {
  if (data.providers.length === 0) return "未配置 Provider。";
  return [
    "已配置 Provider:",
    ...data.providers.map((provider) => [
      `- ${provider.id} (${provider.name})`,
      `  adapter: ${provider.adapter}`,
      provider.baseUrl ? `  baseUrl: ${provider.baseUrl}` : undefined,
      `  apiKeyEnv: ${provider.apiKeyEnv}`,
      `  models: ${provider.models.map((model) => model.id).join(", ") || "none"}`,
    ].filter(Boolean).join("\n")),
  ].join("\n");
}

export function formatModels(data: ProviderStoreData): string {
  const rows = data.providers.flatMap((provider) => provider.models.map((model) => {
    const fullId = `${provider.id}/${model.id}`;
    const marker = data.defaultModel === fullId ? "*" : "-";
    return `${marker} ${fullId}${model.label ? ` (${model.label})` : ""} [${model.capabilities.join(", ")}]`;
  }));
  return rows.length > 0 ? ["已配置模型:", ...rows].join("\n") : "未配置模型。";
}

function normalizeProviderStore(value: unknown): ProviderStoreData {
  if (!isRecord(value)) return createDefaultProviderStore();
  const providers = Array.isArray(value.providers)
    ? value.providers.map(normalizeProvider).filter((provider): provider is ProviderConfigEntry => provider !== null)
    : [];
  const defaultModel = typeof value.defaultModel === "string" ? value.defaultModel : undefined;
  return {
    providers,
    ...(defaultModel && { defaultModel }),
  };
}

function normalizeId(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-");
}

function apiKeyEnvFor(providerId: string): string {
  return `${providerId.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_API_KEY`;
}

function providerTypeFor(provider: ProviderConfigEntry): "openai" | "anthropic" | "deepseek" | "moonshot" | "zhipu" {
  if (provider.id === "anthropic" || provider.adapter === "anthropic") return "anthropic";
  if (provider.id === "deepseek") return "deepseek";
  if (provider.id === "moonshot") return "moonshot";
  if (provider.id === "zhipu") return "zhipu";
  return "openai";
}

function normalizeProvider(value: unknown): ProviderConfigEntry | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== "string" || typeof value.name !== "string" || typeof value.apiKeyEnv !== "string") return null;
  const adapter = isProviderAdapter(value.adapter) ? value.adapter : "openai-compatible";
  return {
    id: value.id,
    name: value.name,
    adapter,
    ...(typeof value.baseUrl === "string" && { baseUrl: value.baseUrl }),
    apiKeyEnv: value.apiKeyEnv,
    models: Array.isArray(value.models) ? value.models.map(normalizeModel).filter((model): model is ModelConfigEntry => model !== null) : [],
  };
}

function normalizeModel(value: unknown): ModelConfigEntry | null {
  if (!isRecord(value) || typeof value.id !== "string") return null;
  return {
    id: value.id,
    ...(typeof value.label === "string" && { label: value.label }),
    capabilities: Array.isArray(value.capabilities) ? value.capabilities.filter((item): item is string => typeof item === "string") : [],
  };
}

function isProviderAdapter(value: unknown): value is ProviderAdapter {
  return value === "openai-compatible" || value === "anthropic" || value === "custom-http";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export interface ProviderUpsertInput {
  id: string;
  name?: string;
  adapter?: ProviderAdapter;
  baseUrl?: string;
  apiKeyEnv?: string;
  models?: ModelConfigEntry[];
}

export async function upsertProvider(input: ProviderUpsertInput, options: ProviderStoreOptions = {}): Promise<ProviderStoreData> {
  const providerId = normalizeId(input.id);
  if (!providerId) throw new Error("Provider id is required");

  const data = await ensureProviderStore(options);
  const providers = [...data.providers];
  const providerIndex = providers.findIndex((provider) => provider.id === providerId);

  const newProvider: ProviderConfigEntry = {
    id: providerId,
    name: input.name ?? toTitleCase(providerId),
    adapter: input.adapter ?? "openai-compatible",
    baseUrl: input.baseUrl,
    apiKeyEnv: input.apiKeyEnv ?? apiKeyEnvFor(providerId),
    models: input.models ?? [],
  };

  if (providerIndex >= 0) {
    providers[providerIndex] = newProvider;
  } else {
    providers.push(newProvider);
  }

  const updated = { ...data, providers };
  await saveProviderStore(updated, options);
  return updated;
}

export async function removeProvider(providerId: string, options: ProviderStoreOptions = {}): Promise<ProviderStoreData> {
  const normalizedId = normalizeId(providerId);
  const data = await ensureProviderStore(options);
  
  const providers = data.providers.filter((provider) => provider.id !== normalizedId);
  if (providers.length === data.providers.length) {
    throw new Error(`Provider not found: ${normalizedId}`);
  }

  const defaultModel = data.defaultModel?.startsWith(`${normalizedId}/`)
    ? providers[0]?.models[0] ? `${providers[0].id}/${providers[0].models[0].id}` : undefined
    : data.defaultModel;

  const updated = { ...data, providers, ...(defaultModel && { defaultModel }) };
  await saveProviderStore(updated, options);
  return updated;
}

function toTitleCase(value: string): string {
  return value
    .split(/[-_]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
