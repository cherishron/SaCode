// 网络搜索设置：3 条固定动作逐条落地，逐字段校验。
// apply 只收「修订号 + 白名单键位的补丁」；密钥走独立通道，永不进入设置文档。
// 这里不是唯一一道门：补丁仍会被仓颉核心复核（web_settings.cj 的键白名单与构造校验）。

const WEB_PROVIDER_IDS = new Set(["exa", "perplexity", "deepseek-official", "tavily", "firecrawl", "parallel", "tinyfish"]);
const WEB_TOP_KEYS = new Set(["enabled", "selectedProvider", "providers"]);
const WEB_PROVIDER_KEYS = new Set(["id", "enabled", "endpoint", "credentialRef", "model", "maxTokens", "maxUses", "searchType", "highlights", "recency"]);
const WEB_STRING_KEYS = new Set(["endpoint", "credentialRef", "model", "searchType", "recency"]);

function sanitizeRevision(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("bad-web-settings-revision");
  return value;
}

function sanitizeProviderPatch(row) {
  if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error("bad-web-settings-patch");
  const keys = Object.keys(row);
  if (keys.length === 0 || keys.length > WEB_PROVIDER_KEYS.size || !Object.hasOwn(row, "id")) throw new Error("bad-web-settings-patch");
  if (typeof row.id !== "string" || !WEB_PROVIDER_IDS.has(row.id)) throw new Error("bad-web-settings-patch");
  const clean = { id: row.id };
  for (const key of keys) {
    if (key === "id") continue;
    if (!WEB_PROVIDER_KEYS.has(key)) throw new Error("bad-web-settings-patch");
    const value = row[key];
    if (key === "enabled") {
      if (typeof value !== "boolean") throw new Error("bad-web-settings-patch");
    } else if (WEB_STRING_KEYS.has(key)) {
      if (typeof value !== "string" || value.length > 1024) throw new Error("bad-web-settings-patch");
    } else if (!Number.isSafeInteger(value)) throw new Error("bad-web-settings-patch");
    clean[key] = value;
  }
  return clean;
}

function sanitizePatch(patch) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new Error("bad-web-settings-patch");
  const keys = Object.keys(patch);
  if (keys.length === 0 || keys.length > WEB_TOP_KEYS.size) throw new Error("bad-web-settings-patch");
  for (const key of keys) if (!WEB_TOP_KEYS.has(key)) throw new Error("bad-web-settings-patch");
  const clean = {};
  if (Object.hasOwn(patch, "enabled")) {
    if (typeof patch.enabled !== "boolean") throw new Error("bad-web-settings-patch");
    clean.enabled = patch.enabled;
  }
  if (Object.hasOwn(patch, "selectedProvider")) {
    const value = patch.selectedProvider;
    if (typeof value !== "string" || value.length > 64) throw new Error("bad-web-settings-patch");
    if (value !== "" && value !== "random" && !WEB_PROVIDER_IDS.has(value)) throw new Error("bad-web-settings-patch");
    clean.selectedProvider = value;
  }
  if (Object.hasOwn(patch, "providers")) {
    const rows = patch.providers;
    if (!Array.isArray(rows) || rows.length === 0 || rows.length > 16) throw new Error("bad-web-settings-patch");
    clean.providers = rows.map(sanitizeProviderPatch);
  }
  return clean;
}

function sanitizeSecret(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 8192) throw new Error("bad-web-credential");
  for (const ch of value) {
    const code = ch.codePointAt(0);
    if (code < 32 || code === 127) throw new Error("bad-web-credential");
  }
  return value;
}

function sanitizeCredentialArgs(args) {
  if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("bad-web-credential");
  for (const key of Object.keys(args)) if (key !== "providerId" && key !== "key") throw new Error("bad-web-credential");
  if (typeof args.providerId !== "string" || !WEB_PROVIDER_IDS.has(args.providerId)) throw new Error("bad-web-credential");
  return { providerId: args.providerId, key: sanitizeSecret(args.key) };
}

function registerWebSettingsIpc(ipcMain, request) {
  ipcMain.handle("sacode:webSettingsDescribe", async () => request("web/settings/describe", {}));
  ipcMain.handle("sacode:webSettingsApply", async (_e, args) => {
    if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("bad-web-settings-patch");
    for (const key of Object.keys(args)) if (key !== "expectedRevision" && key !== "patch") throw new Error("bad-web-settings-patch");
    const expectedRevision = sanitizeRevision(args.expectedRevision);
    const patch = sanitizePatch(args.patch);
    return request("web/settings/apply", { expectedRevision, patch });
  });
  ipcMain.handle("sacode:webSettingsSetCredential", async (_e, args) => {
    const { providerId, key } = sanitizeCredentialArgs(args);
    return request("web/settings/set-credential", { providerId, key });
  });
}

module.exports = { registerWebSettingsIpc };
