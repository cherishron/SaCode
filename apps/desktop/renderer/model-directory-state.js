(function (root) {
  'use strict';
  function createModelDirectory(api) {
    let snapshot = { current: null, groups: [], failures: [], status: 'idle', pending: null, error: null, routable: null };
    const listeners = new Set();
    let revision = 0, seq = 0;
    const publish = next => { snapshot = next; for (const fn of listeners) fn(); };
    const apply = view => {
      revision = view.revision;
      const groups = (view.providers || []).map(p => ({
        id: p.id, name: p.name || p.id, credentialKind: 'api-key',
        models: (p.models || []).map(m => ({ id: m.id, name: m.name || m.id, image: m.image === true, contextWindow: m.contextWindow })),
      }));
      const chosen = view.defaultProviderId && view.defaultModel ? { provider: view.defaultProviderId, model: view.defaultModel } : null;
      const routable = groups.some(g => chosen && g.id === chosen.provider && g.models.some(m => m.id === chosen.model));
      const chosenModel = chosen && groups.find(g => g.id === chosen.provider)
        && groups.find(g => g.id === chosen.provider).models.find(m => m.id === chosen.model);
      publish({ current: chosen, groups, failures: [], status: 'ready', pending: null, error: null, routable, contextWindow: chosenModel ? chosenModel.contextWindow : '' });
    };
    return {
      getSnapshot: () => snapshot,
      subscribe(invalidate) { listeners.add(invalidate); return () => listeners.delete(invalidate); },
      async load() {
        const generation = ++seq;
        publish({ ...snapshot, status: 'loading' });
        try {
          const view = await api.modelsDescribe();
          if (generation === seq) apply(view);
        } catch (e) {
          if (generation === seq) publish({ ...snapshot, status: 'error', error: String((e && e.message) || e) });
        }
      },
      async select(value) {
        if (!value || !value.provider || !value.model) throw Error('bad-model-selection');
        const generation = ++seq;
        publish({ ...snapshot, status: 'selecting', pending: value });
        try {
          const view = await api.modelsSetDefault(value.provider, value.model, revision);
          if (generation === seq) apply(view);
        } catch (e) {
          if (generation === seq) publish({ ...snapshot, status: 'error', pending: null, error: String((e && e.message) || e) });
          throw e;
        }
      },
    };
  }
  root.SaCodeModelDirectory = { createModelDirectory };
})(globalThis);
