// 第 3 层自定义模型与模型目录写面：字段守卫在主进程（customs-guard.cjs），
// 第 3 层文档不认识 baseUrl 与凭据，草稿里出现它们一律拒收。

function registerCustomsIpc(ipcMain, request, customsGuard, isStr) {
  const operationIdOf = (args) => {
    const id = args && args.operationId;
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,96}$/.test(id)) throw new Error('bad-model-pull-operation');
    return id;
  };
  // IPC 的 Error 自定义字段不保证跨进程保留；关联操作用纯数据回执传递结果与收束事实。
  const operationReceipt = (view) => ({ pullOperation: view });
  ipcMain.handle("sacode:modelPullDescribe", async (_e, args) => {
    const operationId = operationIdOf(args);
    try { return await request("model/pull/describe", { operationId }); }
    catch (error) {
      if (error?.message === '-32020 model-pull-operation-unknown') {
        return { operationId, status: 'unknown', settled: false, error: 'model-pull-operation-unknown' };
      }
      throw error;
    }
  });
  ipcMain.handle("sacode:modelPullCancel", async (_e, args) => {
    const operationId = operationIdOf(args);
    try { return await request("model/pull/cancel", { operationId }); }
    catch (error) {
      if (error?.message === '-32020 model-pull-operation-unknown') {
        return { operationId, status: 'unknown', settled: false, error: 'model-pull-operation-unknown', cancelRequested: false };
      }
      throw error;
    }
  });
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
    const expectedRevision = customsGuard.sanitizeRevision(args.expectedRevision);
    const operationId = args.operationId === undefined ? undefined : operationIdOf(args);
    // 模型发现是网络动作（Host fetch GET /models），不能用通用 5s 投影超时——
    // 新Host默认网络总预算20s，30s桥等待留收尾余量；它仍不等同磁盘提交时限或已取消。
    // 旧两参调用保持兼容，带operationId的新调用将状态作为纯数据返回。
    // 诊断与边界见 docs/interfaces/model-pull-lifecycle-2026-10-17.md。
    const PULL_TIMEOUT_MS = 30000;
    try {
      const result = await request("model/pull", { providerId, expectedRevision, ...(operationId ? { operationId } : {}) }, PULL_TIMEOUT_MS);
      if (!operationId) return result; // 旧两参数调用保留供应商视图返回形状。
      if (result?.operationId !== operationId) {
        return operationReceipt({ operationId, providerId, status: 'unknown', settled: false, error: 'model-pull-result-mismatch' });
      }
      return operationReceipt({ operationId, providerId, status: 'succeeded', settled: true, view: result, error: '' });
    } catch (error) {
      // 超时只代表桥停止等待，不能证明失败，也不代表取消。
      // 全局 revision 可由其他写入推进；相同模型清单也可能幂等而不推进。
      // 未取得本次请求的关联结果前，一律保留未知状态，不凭目录猜成功、不盲重发。
      if (operationId && error?.data?.operationId === operationId && error.data.providerId === providerId) {
        return operationReceipt(error.data);
      }
      if (!error || error.message !== "timeout: model/pull") throw error;
      if (operationId) {
        try {
          const outcome = await request("model/pull/describe", { operationId });
          if (outcome?.operationId === operationId && outcome.providerId === providerId) return operationReceipt(outcome);
        } catch { /* 原操作查不到或Host断开，一律未知；绝不重发 model/pull。 */ }
        return operationReceipt({ operationId, providerId, status: 'unknown', settled: false, error: 'model-pull-timeout-unknown' });
      }
      throw new Error("model-pull-timeout-unknown: 等待模型列表超时，拉取结果尚未确认，后台可能仍在处理；请稍后刷新核对，不要立即重复拉取");
    }
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
