// 模型配置面：字段守卫在主进程（models-guard.cjs），凭据名由核心按 ID 派生。
// 密钥只在「写凭据」这一次调用里存在：不透传进注册表文档，不回写，不落日志。

function registerModelsIpc(ipcMain, request, modelsGuard, isStr) {
  ipcMain.handle("sacode:modelsDescribe", async () => request("model/registry/describe"));
  ipcMain.handle("sacode:modelsCatalog", async () => request("model/registry/catalog"));

  ipcMain.handle("sacode:modelsSave", async (_e, args) => {
    const draft = modelsGuard.sanitizeDraft(args && args.draft);
    const key = modelsGuard.sanitizeKey(args ? args.key : undefined);
    const expectedRevision = modelsGuard.sanitizeRevision(args ? args.expectedRevision : undefined);
    return require('./models-save.cjs').saveModelConfiguration(request, draft, key, expectedRevision);
  });

  ipcMain.handle("sacode:modelsRemove", async (_e, args) => {
    const id = args && args.id;
    if (!isStr(id) || id.length === 0 || id.length > 64) throw new Error("bad-model-id");
    return request("model/registry/remove", { id, expectedRevision: modelsGuard.sanitizeRevision(args.expectedRevision) });
  });

  ipcMain.handle("sacode:modelsSetDefault", async (_e, args) => {
    const providerId = args && args.providerId;
    const model = args && args.model;
    if (!isStr(providerId) || providerId.length === 0 || providerId.length > 64) throw new Error("bad-model-provider");
    if (!isStr(model) || model.length === 0 || model.length > 200) throw new Error("bad-model-name");
    return request("model/registry/set-default", {
      providerId, model, expectedRevision: modelsGuard.sanitizeRevision(args.expectedRevision),
    });
  });

  ipcMain.handle("sacode:modelsSort", async (_e, args) => {
    const providerId = args && args.providerId;
    const sortOrder = args && args.sortOrder;
    if (!isStr(providerId) || providerId.length === 0 || providerId.length > 64) throw new Error("bad-model-provider");
    if (typeof sortOrder !== "number" || !Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 1e9) throw new Error("bad-sort-order");
    return request("model/registry/sort", {
      providerId, sortOrder, expectedRevision: modelsGuard.sanitizeRevision(args.expectedRevision),
    });
  });

  ipcMain.handle("sacode:modelsSetEnabled", async (_e, args) => {
    const providerId = args && args.providerId;
    const enabled = args && args.enabled;
    if (!isStr(providerId) || providerId.length === 0 || providerId.length > 64) throw new Error("bad-model-provider");
    if (typeof enabled !== "boolean") throw new Error("bad-enabled-flag");
    return request("model/registry/set-enabled", {
      providerId, enabled: enabled ? "true" : "false", expectedRevision: modelsGuard.sanitizeRevision(args.expectedRevision),
    });
  });

  ipcMain.handle("sacode:modelsList", async (_e, args) => {
    const req = modelsGuard.sanitizeListRequest(args);
    return request("model/list", req);
  });
}

module.exports = { registerModelsIpc };
