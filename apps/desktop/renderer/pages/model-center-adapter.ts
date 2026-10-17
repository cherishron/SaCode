// 模型中心只转换宿主投影；配置、修订号、凭据与计量仍由共享核心持有。
export function createModelCenterAdapters(api: any) {
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
      const c = typeof r?.currency === 'string' ? r.currency : '';
      const total = (byCurrency.get(c) || 0) + r?.usedMicros;
      // JSON 数字超过安全整数范围已失真，不能继续展示貌似精确的金额。
      if (!c || !Number.isSafeInteger(r?.usedMicros) || r.usedMicros < 0
          || !Number.isSafeInteger(total)) return { parts: [], single: null, invalid: true };
      byCurrency.set(c, total);
    }
    const parts = Array.from(byCurrency.entries())
      .map(([currency, micro]) => ({ currency, micro }))
      .sort((a, b) => a.currency.localeCompare(b.currency));
    return { parts, single: parts.length === 1 ? parts[0] : null, invalid: false };
  };

  const moneyNote = (parts: { currency: string; micro: number }[]) => {
    if (parts.length === 0) return '';
    return parts.map((p) => `${p.currency} ${(p.micro / 1e6).toFixed(6)}`).join(' / ');
  };

  return {
    // 供应商页适配器把页面动作逐条对到宿主动词：describe→model/registry/describe+catalog、
    // save→update（内置供应商的启停走单列 set-enabled）、remove→remove、reorder→逐条 sort、
    // pullModels→model/pull。核心拒绝带密钥槽位的整条草稿，密钥单走一个参数。
    'provider-settings': {
      async describe() {
        const [view, catalog] = await Promise.all([api.modelsDescribe(), api.modelsCatalog()]);
        return {
          providers: view.providers || [],
          catalog: Array.isArray(catalog) ? catalog : [],
          revision: view.revision,
          writable: view.writable,
          defaultProviderId: view.defaultProviderId,
          defaultModel: view.defaultModel,
        };
      },
      async save(draft: any, expectedRevision: number) {
        const { key, ...rest } = plain(draft);
        // 内置目录只写启停；凭据通过供应商身份和成功修订单独保存。
        if (draft.declared) {
          const view = await api.modelsSetEnabled(draft.id, draft.enabled !== false, expectedRevision);
          if (typeof key === 'string' && key.length) {
            try {
              await api.modelsSaveCredential(draft.id, key, view.revision);
            } catch {
              const failure: any = new Error('配置已保存，但密钥未保存。可单独重试密钥；配置已变化时请刷新重新编辑。');
              failure.configurationRevision = view.revision;
              throw failure;
            }
          }
          return;
        }
        const result = await api.modelsSave(rest, typeof key === 'string' ? key : '', expectedRevision);
        if (result?.saveStatus?.configuration === 'saved' && result.saveStatus.credential === 'failed') {
          const failure: any = new Error('配置已保存，但密钥未保存。可单独重试密钥；配置已变化时请刷新重新编辑。');
          failure.configurationRevision = result.revision;
          throw failure;
        }
      },
      saveCredential: (id: string, key: string, expectedRevision: number) => api.modelsSaveCredential(id, key, expectedRevision),
      setDefault: (id: string, model: string, expectedRevision: number) => api.modelsSetDefault(id, model, expectedRevision),
      createInstance: (catalogId: string, expectedRevision: number) => api.modelsCreateInstance(catalogId, expectedRevision),
      remove: (id: string, expectedRevision: number) => api.modelsRemove(id, expectedRevision),
      async reorder(keys: string[], expectedRevision: number) {
        // 只写真正变了位的条目：每条 sort 都会 bump 一次修订号，全量重写会让
        // 一次拖动把 N 个无关条目都卷进冲突窗口。
        const view = await api.modelsDescribe();
        if (view.revision !== expectedRevision) throw new Error('settings-conflict');
        const current = new Map((view.providers || []).map((p: any) => [p.id, p.sortOrder]));
        let revision = expectedRevision;
        for (let i = 0; i < keys.length; i++) {
          // 核心把 0 视为未指定顺序；显式顺序从 1 开始。
          if (current.get(keys[i]) === i + 1) continue;
          const after = await api.modelsSort(keys[i], i + 1, revision);
          revision = after.revision;
        }
      },
      pullModels: (providerId: string, expectedRevision: number) => api.modelPull(providerId, expectedRevision),
    },
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
        // 每个模型自己的已结算金额——预算面板「已用 / 预算」进度条的数据源。
        // `usageKindTotals` 抹掉模型维度、`providerTotals` 抹掉 usageKind，
        // 两路都回答不了「这个模型用掉多少」，所以要单独的 modelTotals 读面。
        // 一个模型只有一个币种（断言 46），所以同模型不会出现两行。
        const usedByModel = new Map<string, { usedMicros: number; currency: string }>();
        const invalidModels = new Set<string>();
        for (const r of ((stats && stats.modelTotals) || [])) {
          const id = (typeof r.customModelId === 'string' && r.customModelId)
            || (typeof r.key === 'string' ? r.key : '');
          if (!id) continue;
          if (!Number.isSafeInteger(r.usedMicros) || r.usedMicros < 0
              || typeof r.currency !== 'string' || !r.currency
              || usedByModel.has(id)) { invalidModels.add(id); continue; }
          usedByModel.set(id, {
            usedMicros: r.usedMicros,
            currency: typeof r.currency === 'string' ? r.currency : '',
          });
        }
        const usedOf = (id: string) => {
          const u = usedByModel.get(id);
          return u && !invalidModels.has(id) ? { micro: u.usedMicros, currency: u.currency } : null;
        };
        return { session: usage, models: view.customs.map((m: any) => ({
          id: m.id, name: m.name, enabled: m.enabled, bindings: m.bindings,
          used: usedOf(m.id),
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
              : (chatGroup.invalid ? '账本金额无效或超出安全整数范围，当前费用待核算。'
                : chatGroup.parts.length === 0
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
    'model-call-log': {
      async describe() {
        const catalog = await api.sessionCatalog();
        const entries = (catalog && Array.isArray(catalog.entries)) ? catalog.entries : [];
        // 全局聚合：限流扫描前 K 个会话，各取最近 50 条调用后合并取最近 N 条。
        // 目录扫描序无时间序，跨大量会话时不保证覆盖最活跃者——这是 v1 的已知限制，
        // 待目录补 last-active 时间戳后改为按时间裁剪。
        const K = 30, N = 200;
        const slice = entries.slice(0, K);
        const perSession = await Promise.all(slice.map(async (e: any) => {
          try {
            const raw = await api.requestTrace(e.id, -1, 50);
            const proj = typeof raw === 'string' ? JSON.parse(raw) : raw;
            const requests = (proj && proj.requests) || [];
            return requests.map((r: any) => Object.assign({}, r, { sessionId: e.id, sessionTitle: e.title }));
          } catch { return []; }
        }));
        let calls = perSession.flat();
        calls.sort((a: any, b: any) => Number(b.request?.time ?? 0) - Number(a.request?.time ?? 0));
        calls = calls.slice(0, N);
        return { sessions: entries.map((e: any) => ({ id: e.id, title: e.title })), calls, scanned: slice.length, total: entries.length };
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
