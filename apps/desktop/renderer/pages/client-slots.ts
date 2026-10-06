import { defineComponent, h, onBeforeUnmount, ref, type Component, type PropType } from 'vue';
import { ClientScope, SlotCore, type Entry, type OwnerProps } from './slot-core';
export { ClientScope, SlotCore } from './slot-core';
import * as providerSettings from './provider-settings';
import * as customModels from './custom-models';
import * as budgetStats from './budget-stats';
import * as migration from './migration';
export { createModelCenterAdapters } from './model-center-adapter';

type RenderOptions = { only?: string; entryKey?: string; fallback?: unknown };

// Vue 只负责绑定注册表快照和 h()；所有会话业务数据由宿主投影经 owner 传入。
export function createSlotRenderer(core: SlotCore) {
  function render(authority: Entry | null, key: string, owner: OwnerProps, sessionId: string | undefined, options: RenderOptions = {}): unknown {
    core.assertAuthority(authority, key);
    const spec = core.declaration(key).spec;
    if (spec?.scope === 'session' && !sessionId) return options.fallback ?? null;
    const selected = core.dispatch(authority, key, owner, options);
    if (!selected.length) return options.fallback ?? null;
    return selected.map(({ entry, matched }) => h(entry.component as Component, {
      key: entry.sequence + ':' + (spec?.scope === 'root' ? 'root' : sessionId ?? 'none'),
      owner, sessionId: spec?.scope === 'root' ? undefined : sessionId, matched,
      renderSlot: (child: string, props: OwnerProps, opts?: RenderOptions) => render(entry, child, props, sessionId, opts),
    }));
  }
  return defineComponent({
    name: 'SaCodeSlotOutlet',
    props: { owner: { type: Object as PropType<OwnerProps>, required: true }, sessionId: String },
    setup(props) {
      const revision = ref(core.getRevision());
      const unsubscribe = core.subscribeMutations(() => { revision.value = core.getRevision(); });
      onBeforeUnmount(unsubscribe);
      return () => { void revision.value; return render(null, 'root', props.owner, props.sessionId) as ReturnType<typeof h>; };
    },
  });
}

export function createConversationAssembly() {
  const slots = new SlotCore();
  const scopes = new Map<string, ClientScope>();
  let disposed = false;
  function install(name: string, setup: (scope: ClientScope) => void): ClientScope {
    if (disposed) throw Error('client-assembly-disposed');
    if (scopes.has(name)) throw Error('client-plugin-duplicate:' + name);
    const scope = new ClientScope(name, slots);
    scopes.set(name, scope);
    try { scope.apply(setup); } catch (error) { scopes.delete(name); throw error; }
    return scope;
  }
  function unload(name: string): void { const scope = scopes.get(name); scopes.delete(name); scope?.dispose(); }
  function installConversation(): ClientScope {
    return install('ui-conversation', scope => {
      scope.register({ name: 'root', children: { 'conversation.view': { kind: 'list', scope: 'session' } } },
        defineComponent({
          name: 'SaCodeConversationSlotHost',
          props: ['owner', 'renderSlot'],
          setup: props => () => props.renderSlot('conversation.view', props.owner, { only: props.owner.activeView ?? 'chat' }),
        }));
    });
  }
  installConversation();
  function installChat(): ClientScope {
    return install('ui-chat', scope => {
      scope.inject('conversation.view', child => {
        child.register({ name: 'conversation.view', id: 'chat', order: 0, label: '聊天' },
          defineComponent({ name: 'SaCodeChatView', props: ['owner'], setup: props => () => props.owner.transcript }));
      });
    });
  }
  installChat();
  const Outlet = createSlotRenderer(slots);
  return Object.freeze({
    slots, Outlet, install, unload, installConversation, installChat,
    dispose: () => {
      if (disposed) return; disposed = true;
      const errors: unknown[] = [];
      for (const name of [...scopes.keys()].reverse()) { try { unload(name); } catch (error) { errors.push(error); } }
      if (errors.length) throw new AggregateError(errors, 'client-assembly-cleanup-failed');
    },
  });
}

// 模型中心装配：独立 SlotCore，四页通过 'model-center.tab' 列表槽位贡献注册。
export function createModelCenterAssembly() {
  const slots = new SlotCore();
  const scopes = new Map<string, ClientScope>();
  let disposed = false;
  function install(name: string, setup: (scope: ClientScope) => void): ClientScope {
    if (disposed) throw Error('model-center-disposed');
    if (scopes.has(name)) throw Error('model-center-duplicate:' + name);
    const scope = new ClientScope(name, slots);
    scopes.set(name, scope);
    try { scope.apply(setup); } catch (error) { scopes.delete(name); throw error; }
    return scope;
  }
  function unload(name: string): void { const scope = scopes.get(name); scopes.delete(name); scope?.dispose(); }

  // 宿主声明 root（single）+ 子槽位 model-center.tab（list）
  install('ui-model-center-host', scope => {
    scope.register({ name: 'root', children: { 'model-center.tab': { kind: 'list', scope: 'root' } } },
      defineComponent({
        name: 'SaCodeModelCenterHost',
        props: ['owner', 'renderSlot'],
        setup: props => {
          const active = ref('provider-settings');
          const tabs = [['provider-settings','供应商'],['custom-models','自定义模型'],['budget-stats','费用统计'],['migration','迁移']];
          return () => h('div', { class: 'model-center' }, [
            h('h2', '模型中心'),
            h('nav', { class: 'model-center-tabs', 'aria-label': '模型中心分类' }, tabs.map(([id,label]) =>
              h('button', { type: 'button', 'aria-pressed': active.value === id, 'data-model-center-tab': id,
                onClick: () => { active.value = id; } }, label))),
            h('div', { class: 'model-center-page' }, props.renderSlot('model-center.tab', {
              ...props.owner, adapter: props.owner?.adapters?.[active.value],
            }, { only: active.value })),
          ]);
        },
      }));
  });

  // 四页依次注入 model-center.tab 列表
  install('ui-provider-settings', providerSettings.install);
  install('ui-custom-models', customModels.install);
  install('ui-budget-stats', budgetStats.install);
  install('ui-migration', migration.install);

  const Outlet = createSlotRenderer(slots);
  return Object.freeze({
    slots, Outlet, install, unload,
    dispose: () => {
      if (disposed) return; disposed = true;
      const errors: unknown[] = [];
      for (const name of [...scopes.keys()].reverse()) { try { unload(name); } catch (error) { errors.push(error); } }
      if (errors.length) throw new AggregateError(errors, 'model-center-cleanup-failed');
    },
  });
}
