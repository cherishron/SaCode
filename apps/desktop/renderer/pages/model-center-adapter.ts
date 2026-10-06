// 模型中心只转换宿主投影；配置、修订号、凭据与计量仍由共享核心持有。
export function createModelCenterAdapters(api: any, providers: any) {
  // Vue 响应式代理不能被 Electron structured clone；提交当前编辑的纯数据快照。
  const plain = (value: any) => JSON.parse(JSON.stringify(value));
  const customView = async () => {
    const [view, registry] = await Promise.all([api.customsDescribe(), api.modelsDescribe()]);
    return { customs: view.models, providers: registry.providers, revision: view.revision, writable: view.writable };
  };
  return {
    'provider-settings': providers,
    'custom-models': {
      describe: customView,
      upsert: (draft: any, revision: number) => api.customsUpsert(plain(draft), revision),
      remove: (id: string, revision: number) => api.customsRemove(id, revision),
      bindingUpsert: (id: string, binding: any, revision: number) => api.bindingUpsert(id, plain(binding), revision),
      bindingRemove: (id: string, provider: string, model: string, revision: number) => api.bindingRemove(id, provider, model, revision),
      bindingReorder: (id: string, keys: string[], revision: number) => api.bindingReorder(id, plain(keys), revision),
    },
    'budget-stats': {
      async describe() {
        const [usage, view] = await Promise.all([api.usageStatus(), customView()]);
        return { session: usage, models: view.customs.map((m: any) => ({
          id: m.id, name: m.name, enabled: m.enabled, bindings: m.bindings,
          limits: { dailyTokens: m.dailyTokens, monthlyTokens: m.monthlyTokens,
            dailyAmountMicro: m.dailyAmountMicro, monthlyAmountMicro: m.monthlyAmountMicro,
            maxOutputTokens: m.maxOutputTokens, probeEnabled: m.probeEnabled, probeMaxPerDay: m.probeMaxPerDay },
        })), revision: view.revision, writable: view.writable };
      },
    },
    migration: {
      async describe() {
        const view = await customView();
        return { ...view, customs: view.customs.map((m: any) => ({ ...m, bindingsCount: m.bindings.length })) };
      },
      importNew: (items: string[], revision: number) => api.customImportNew(plain(items), revision),
      importInto: (id: string, items: string[], revision: number) => api.customImportInto(id, plain(items), revision),
    },
  };
}
