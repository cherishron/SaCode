// 模型中心只转换宿主投影；配置、修订号、凭据与计量仍由共享核心持有。
export function createModelCenterAdapters(api: any, providers: any) {
  // Vue 响应式代理不能被 Electron structured clone；提交当前编辑的纯数据快照。
  const plain = (value: any) => JSON.parse(JSON.stringify(value));
  const customView = async () => {
    const [view, registry] = await Promise.all([api.customsDescribe(), api.modelsDescribe()]);
    return { customs: view.models, providers: registry.providers, revision: view.revision, writable: view.writable };
  };

  // --- 费用三列的取数 ---
  // 账本统计走宿主 `ledger/stats` 动词（见接口变更单 §6）。动词不存在或抛错时
  // 一律回 null：**缺数据渲染成 —，不许渲染成 0**（断言 14「没有 usage 不冒充零消费」）。
  const ledgerStatsOrNull = async (): Promise<any | null> => {
    if (typeof api.ledgerStats !== 'function') return null;
    try { return await api.ledgerStats(); } catch { return null; }
  };

  // 按 currency 分组合计。跨币种**不加总**（断言 41）：多币种时 amountMicro 回 null，
  // 把明细塞进 note 让界面分列显示，界面只渲染一个数字。
  const groupByCurrency = (rows: any[]) => {
    const byCurrency = new Map<string, number>();
    for (const r of rows || []) {
      const c = typeof r.currency === 'string' ? r.currency : '';
      if (!c || typeof r.usedMicros !== 'number') continue;
      byCurrency.set(c, (byCurrency.get(c) || 0) + r.usedMicros);
    }
    const parts = Array.from(byCurrency.entries())
      .map(([currency, micro]) => ({ currency, micro }))
      .sort((a, b) => a.currency.localeCompare(b.currency));
    return { parts, single: parts.length === 1 ? parts[0] : null };
  };

  const moneyNote = (parts: { currency: string; micro: number }[]) => {
    if (parts.length === 0) return '';
    return parts.map((p) => `${p.currency} ${(p.micro / 1e6).toFixed(6)}`).join(' / ');
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
        const [usage, view, stats] = await Promise.all([api.usageStatus(), customView(), ledgerStatsOrNull()]);
        // 模型费用 = usageKind 分组里 key === 'chat' 的那一档。
        // 账本只记金额，所以这里是微分；probe / relay 各有自己的 usageKind。
        const chatGroup = groupByCurrency(((stats && stats.usageKindTotals) || [])
          .filter((r: any) => r.key === 'chat'));
        return { session: usage, models: view.customs.map((m: any) => ({
          id: m.id, name: m.name, enabled: m.enabled, bindings: m.bindings,
          limits: { dailyTokens: m.dailyTokens, monthlyTokens: m.monthlyTokens,
            dailyAmountMicro: m.dailyAmountMicro, monthlyAmountMicro: m.monthlyAmountMicro,
            maxOutputTokens: m.maxOutputTokens, probeEnabled: m.probeEnabled, probeMaxPerDay: m.probeMaxPerDay },
        })), costs: {
          model: {
            amountMicro: chatGroup.single ? chatGroup.single.micro : null,
            currency: chatGroup.single ? chatGroup.single.currency : null,
            meterSource: '上游用量',
            note: stats === null
              ? '宿主尚未提供 ledger/stats，等接口变更单 §6 接线后本列自动点亮。'
              : (chatGroup.parts.length === 0
                ? '账本里没有已结算的 chat 记录；在途预留与待核算不计入本列。'
                : (chatGroup.parts.length > 1
                  ? `跨币种分列：${moneyNote(chatGroup.parts)}；账本不跨币种相加。`
                  : `${chatGroup.parts.length} 种币种合计；待核算与在途预留不计入本列。`)),
          },
          probe: { amountMicro: null, currency: null, meterSource: '探测请求', note: '探测执行器未实现（B2 只做了调度核心），本列暂无数据源。' },
          relay: { amountMicro: null, currency: null, meterSource: '本地字节', note: '加速通道未实现（B4），本列暂无数据源。' },
        }, revision: view.revision, writable: view.writable };
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
