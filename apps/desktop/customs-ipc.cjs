// 第 3 层自定义模型与模型目录写面：字段守卫在主进程（customs-guard.cjs），
// 第 3 层文档不认识 baseUrl 与凭据，草稿里出现它们一律拒收。

function registerCustomsIpc(ipcMain, request, customsGuard, isStr) {
  ipcMain.handle("sacode:customsDescribe", async () => request("custom/describe"));

  ipcMain.handle("sacode:customsUpsert", async (_e, args) => {
    const draft = customsGuard.sanitizeDraft(args && args.draft);
    const expectedRevision = customsGuard.sanitizeRevision(args ? args.expectedRevision : undefined);
    return request("custom/upsert", { draft, expectedRevision });
  });

  ipcMain.handle("sacode:customsRemove", async (_e, args) => {
    const customId = args && args.customId;
    if (!isStr(customId) || customId.length === 0 || customId.length > 64) throw new Error("bad-custom-id");
    return request("custom/remove", { customId, expectedRevision: customsGuard.sanitizeRevision(args.expectedRevision) });
  });

  ipcMain.handle("sacode:bindingUpsert", async (_e, args) => {
    const customId = args && args.customId;
    if (!isStr(customId) || customId.length === 0 || customId.length > 64) throw new Error("bad-custom-id");
    const binding = customsGuard.sanitizeBinding(args && args.binding);
    return request("binding/upsert", { customId, binding, expectedRevision: customsGuard.sanitizeRevision(args.expectedRevision) });
  });

  ipcMain.handle("sacode:bindingRemove", async (_e, args) => {
    const customId = args && args.customId;
    const providerId = args && args.providerId;
    const modelId = args && args.modelId;
    if (!isStr(customId) || customId.length === 0 || customId.length > 64) throw new Error("bad-custom-id");
    if (!isStr(providerId) || providerId.length === 0 || providerId.length > 64) throw new Error("bad-custom-provider");
    if (!isStr(modelId) || modelId.length === 0 || modelId.length > 200) throw new Error("bad-custom-model");
    return request("binding/remove", { customId, providerId, modelId, expectedRevision: customsGuard.sanitizeRevision(args.expectedRevision) });
  });

  ipcMain.handle("sacode:bindingReorder", async (_e, args) => {
    const customId = args && args.customId;
    if (!isStr(customId) || customId.length === 0 || customId.length > 64) throw new Error("bad-custom-id");
    const keys = customsGuard.sanitizeKeyList(args && args.keys);
    return request("binding/reorder", { customId, keys, expectedRevision: customsGuard.sanitizeRevision(args.expectedRevision) });
  });

  ipcMain.handle("sacode:modelPull", async (_e, args) => {
    const providerId = args && args.providerId;
    if (!isStr(providerId) || providerId.length === 0 || providerId.length > 64) throw new Error("bad-model-provider");
    return request("model/pull", { providerId, expectedRevision: customsGuard.sanitizeRevision(args.expectedRevision) });
  });

  ipcMain.handle("sacode:modelUpstreamUpsert", async (_e, args) => {
    const providerId = args && args.providerId;
    const modelId = args && args.modelId;
    if (!isStr(providerId) || providerId.length === 0 || providerId.length > 64) throw new Error("bad-model-provider");
    if (!isStr(modelId) || modelId.length === 0 || modelId.length > 200) throw new Error("bad-model-name");
    return request("model/upstream/upsert", { providerId, modelId, expectedRevision: customsGuard.sanitizeRevision(args.expectedRevision) });
  });

  ipcMain.handle("sacode:customImportNew", async (_e, args) => {
    const items = customsGuard.sanitizeKeyList(args && args.items);
    return request("custom/import/new", { items, expectedRevision: customsGuard.sanitizeRevision(args.expectedRevision) });
  });

  ipcMain.handle("sacode:customImportInto", async (_e, args) => {
    const customId = args && args.customId;
    if (!isStr(customId) || customId.length === 0 || customId.length > 64) throw new Error("bad-custom-id");
    const items = customsGuard.sanitizeKeyList(args && args.items);
    return request("custom/import/into", { customId, items, expectedRevision: customsGuard.sanitizeRevision(args.expectedRevision) });
  });
}

module.exports = { registerCustomsIpc };
