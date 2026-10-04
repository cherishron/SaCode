// 冻结 ui-settings-plugins / ui-settings-plugin-inventory 的页面结构；Host 状态只读。
import { defineComponent, h, ref, computed, watch, onMounted, onBeforeUnmount, nextTick, useId, type PropType, type Component } from 'vue';
export interface PluginEntry {
  moduleName: string; entryId: string | null; title?: string; description?: string; metadataError?: string;
  enabled: boolean; condition?: string; phase: 'pending' | 'loading' | 'active' | 'failed' | 'unloading' | null;
}
export interface Preset { id: string; name: string; isDefault?: boolean; broken?: string; rows: PluginEntry[] }
export interface Snapshot { entries: PluginEntry[]; presets: Preset[] }
export interface Adapter { list(): Promise<Snapshot>; subscribe?(invalidate: () => void): () => void }
export interface Tab { id: string; label: string; order: number; component: Component; props?: Record<string, unknown> }
export interface Tool { name: string; description?: string; needsApproval?: boolean }
const el = (tag: string, cls: string, children: any, props: any = {}) => h(tag, { class: 'plugins-' + cls, ...props }, children);
const phases = { pending: '等待依赖', loading: '加载中', active: '运行中', failed: '启动失败', unloading: '卸载中' };
// Vue useId 的序号仅在应用内唯一；插件/Next SDK 可挂载独立应用，需补组件实例序号。
let pageInstance = 0;
const title = (e: PluginEntry) => e.title || e.moduleName.replace(/^@[^/]+\//, '').replace(/^cordis(?:-plugin-|:)/, '').replace(/^sacode-(?:host-|client-)?/, '');
const matches = (e: PluginEntry, query: string) => [e.moduleName, e.entryId, title(e), e.description].some(v => v?.toLocaleLowerCase().includes(query));

export const Inventory = defineComponent({
  name: 'SaCodePluginInventory',
  props: { adapter: Object as PropType<Adapter>, clientSync: { type: String, default: 'idle' }, retryClient: Function as PropType<() => void> },
  setup(props) {
    const snapshot = ref<Snapshot>({ entries: [], presets: [] }), status = ref<'loading' | 'error' | 'ready' | 'unconnected'>('unconnected');
    const query = ref(''), chosen = ref(''), expanded = ref<string | null>(null);
    let generation = 0, disposed = false, off: (() => void) | undefined;
    const reload = async () => {
      if (!props.adapter) return;
      const request = ++generation; status.value = 'loading';
      try { const value = await props.adapter.list(); if (!disposed && request === generation) { snapshot.value = value; status.value = 'ready'; } }
      catch { if (!disposed && request === generation) status.value = 'error'; }
    };
    onMounted(() => { off = props.adapter?.subscribe?.(() => { void reload(); }); void reload(); });
    onBeforeUnmount(() => { disposed = true; generation++; off?.(); });
    const selected = computed(() => snapshot.value.presets.find(p => p.id === chosen.value) || snapshot.value.presets.find(p => p.isDefault) || snapshot.value.presets[0]);
    const normalized = computed(() => query.value.trim().toLocaleLowerCase());
    const button = (text: string, action: () => void, attrs: any = {}) => el('button', 'button', text, { type: 'button', onClick: action, ...attrs });
    const card = (entry: PluginEntry, key: string, preset?: Preset) => {
      const inPresets = snapshot.value.presets.filter(p => p.rows.some(r => r.moduleName === entry.moduleName && r.enabled));
      const state = entry.phase === 'failed' ? '启动失败' : entry.enabled ? '已启用' : preset ? '已停用' : inPresets.length ? '预设中启用' : entry.condition ? '条件启用' : '已停用';
      const open = expanded.value === key, detailId = 'plugin-details-' + encodeURIComponent(key);
      const facts = [['完整名称', entry.moduleName], ['配置状态', state], ['运行状态', entry.phase ? phases[entry.phase] : '未运行'], ...(entry.condition ? [['禁用条件', entry.condition]] : []), ...(preset ? [['来自', preset.name]] : [])];
      return el('article', 'card', [
        el('button', 'cardContent', [
          el('span', 'cardMainRow', [el('strong', 'cardTitle', title(entry)), el('span', 'cardTrailing', [
            state !== '已启用' ? el('span', 'tag', state, { 'data-kind': entry.phase === 'failed' ? 'failed' : 'neutral' }) : null,
            entry.phase ? el('span', 'phaseDot', null, { role: 'img', 'aria-label': phases[entry.phase], title: phases[entry.phase], 'data-phase': entry.phase }) : null,
            el('span', 'chevron', '⌄', { 'aria-hidden': 'true' }),
          ])]),
          entry.description ? el('span', 'cardDescription', entry.description) : null,
          entry.entryId && entry.entryId.replace(/^include:/, '') !== title(entry) ? el('code', 'identity', entry.entryId.replace(/^include:/, '')) : null,
        ], { type: 'button', 'aria-expanded': open, 'aria-controls': detailId, 'aria-label': title(entry) + ', ' + (entry.entryId ? entry.entryId + ', ' : '') + state, onClick: () => expanded.value = open ? null : key }),
        entry.metadataError ? el('p', 'failure', '包元信息错误：' + entry.metadataError, { role: 'status' }) : null,
        open ? el('div', 'cardDetails', [entry.entryId ? el('code', 'identity', entry.entryId) : null,
          el('dl', 'facts', facts.flatMap(([label, value]) => [h('dt', label), h('dd', value)])),
          !preset && inPresets.length ? el('div', 'enabledIn', ['启用于 ', ...inPresets.map(p => button(p.name, () => { chosen.value = p.id; expanded.value = null; }, { 'aria-label': '去预设分组查看 ' + p.name }))]) : null,
        ], { id: detailId }) : null,
      ], { key, 'data-plugin-module': entry.moduleName, 'data-failed': entry.phase === 'failed' });
    };
    return () => {
      const presets = snapshot.value.presets;
      const entries = snapshot.value.entries.filter(e => matches(e, normalized.value)).slice().sort((a, b) => Number(b.phase === 'failed') - Number(a.phase === 'failed'));
      const rows = selected.value?.rows.filter(e => matches(e, normalized.value)) || [];
      const other = presets.filter(p => p.id !== selected.value?.id && p.rows.some(e => matches(e, normalized.value)));
      const noMatch = !entries.length && !rows.length && !other.length;
      return el('div', 'inventory', [
        props.clientSync === 'syncing' ? el('p', 'status', '正在同步本页面的插件…', { role: 'status' }) : null,
        props.clientSync === 'failed' ? el('div', 'failure', [el('p', 'status', '本页面的插件未能完成同步；服务端的启用状态保持不变。', { role: 'alert' }), button('重试本页面同步', () => props.retryClient?.(), { disabled: !props.retryClient })]) : null,
        status.value === 'unconnected' ? el('p', 'status', '插件清单接口尚未接入，不能据此判断已安装或已启用的插件。', { role: 'status' }) : null,
        status.value === 'loading' ? el('div', 'cards', [el('span', 'status', '正在读取插件…', { role: 'status' }), ...[0,1,2,3].map(i => el('div', 'skeletonCard', [el('span', 'skeletonBar', null), el('span', 'skeletonBar', null)], { key: i, 'aria-hidden': 'true' }))]) : null,
        status.value === 'error' ? el('div', 'failure', [el('p', 'status', '暂时无法读取插件。', { role: 'alert' }), button('重试', reload)]) : null,
        status.value === 'ready' ? el('div', 'catalog', [
          el('label', 'search', [el('span', 'searchIcon', '⌕', { 'aria-hidden': 'true' }), el('input', 'searchInput', null, { type: 'search', placeholder: '搜索插件', 'aria-label': '搜索插件', value: query.value, onInput: (e: Event) => query.value = (e.target as HTMLInputElement).value })]),
          !snapshot.value.entries.length && !presets.length ? el('p', 'status', '暂无插件。') : noMatch ? el('p', 'status', '没有匹配的插件。') : null,
          presets.length ? el('section', 'group', [el('header', 'groupHeader', [el('div', 'groupText', [el('h3', 'groupTitle', '会话插件'), el('p', 'status', '由 Agent 预设按会话组成')]),
            el('select', 'presetSelect', presets.map(p => h('option', { value: p.id }, p.name + (p.broken ? '（加载失败）' : p.isDefault ? '（默认）' : ''))), { 'aria-label': '选择要查看的 Agent 预设', value: selected.value?.id, onChange: (e: Event) => { chosen.value = (e.target as HTMLSelectElement).value; expanded.value = null; } })]),
            selected.value?.broken ? el('p', 'failure', selected.value.broken, { role: 'alert' }) : null,
            el('div', 'cards', rows.map((r, i) => card(r, 'preset:' + selected.value!.id + ':' + i, selected.value))),
            normalized.value && other.length ? el('div', 'otherMatches', ['其他预设中还有匹配：', ...other.map(p => button(p.name, () => chosen.value = p.id))]) : null,
          ]) : null,
          snapshot.value.entries.length ? el('section', 'group', [el('header', 'groupHeader', [el('div', 'groupText', [el('h3', 'groupTitle', '全局插件'), el('p', 'status', '系统与所有会话共用')]), el('span', 'count', entries.length + ' 个' + (entries.some(e => e.phase === 'failed') ? ' · ' + entries.filter(e => e.phase === 'failed').length + ' 个失败' : ''))]), el('div', 'cards', entries.map((e, i) => card(e, 'global:' + (e.entryId || e.moduleName) + ':' + i)))]) : null,
        ]) : null,
      ], { 'aria-busy': status.value === 'loading' });
    };
  },
});

export const Page = defineComponent({
  name: 'SaCodePluginsPage',
  props: { adapter: Object as PropType<Adapter>, tabs: Array as PropType<Tab[]>, tools: Array as PropType<Tool[]> },
  setup(props) {
    const uid = 'plugins-' + useId() + '-' + (++pageInstance);
    const rows = computed(() => (props.tabs || [
      { id:'configuration',label:'插件配置',order:10,component:(window as any).SaCodeConfiguration.Page },
      { id: 'inventory', label: '插件列表', order: 20, component: Inventory, props: { adapter: props.adapter } },
    ]).slice().sort((a,b) => a.order - b.order || a.id.localeCompare(b.id)));
    const chosen = ref(''), visited = ref<string[]>([]);
    const active = computed(() => rows.value.find(t => t.id === chosen.value)?.id || rows.value[0]?.id);
    watch(active, id => { if (id && !visited.value.includes(id)) visited.value.push(id); }, { immediate: true });
    const select = (id: string) => { chosen.value = id; };
    const key = (event: KeyboardEvent, index: number) => {
      const size = rows.value.length; let next: number;
      if (event.key === 'ArrowRight') next = (index+1)%size; else if (event.key === 'ArrowLeft') next = (index-1+size)%size;
      else if (event.key === 'Home') next = 0; else if (event.key === 'End') next = size-1; else return;
      event.preventDefault(); select(rows.value[next].id); void nextTick(() => document.getElementById(uid + '-tab-' + rows.value[next].id)?.focus());
    };
    return () => el('div', 'section', [el('h2', 'heading', '内置插件'), el('p', 'intro', '查看内置部署的插件列表'),
      rows.value.length > 1 ? el('div', 'tabs', rows.value.map((t,i) => el('button', 'tab', t.label, { key:t.id, id:uid+'-tab-'+t.id, type:'button', role:'tab', 'aria-controls':uid+'-panel-'+t.id, 'aria-selected':active.value===t.id, tabindex:active.value===t.id?0:-1, onClick:()=>select(t.id), onKeydown:(e:KeyboardEvent)=>key(e,i) })), { role:'tablist', 'aria-label':'插件视图' }) : null,
      !rows.value.length ? el('p', 'status', '本部署没有开放任何插件视图。') : rows.value.filter(t => active.value===t.id || visited.value.includes(t.id)).map(t => el('div', 'panel', [h(t.component,t.props || {})], { key:t.id,id:uid+'-panel-'+t.id, hidden:active.value!==t.id,...(rows.value.length>1?{role:'tabpanel','aria-labelledby':uid+'-tab-'+t.id}:{}) })),
      props.tools?.length ? el('section', 'coreTools', [el('h3', 'groupTitle', '当前核心工具'), ...props.tools.map(t => h('article', { class:'settings-tool', key:t.name,'data-tool-name':t.name }, [h('h3',({read:'读取文件',write:'写入文件'} as Record<string,string>)[t.name] || t.name), h('p',{class:'note'},t.description || '核心未提供说明'),h('span',{class:'badge'},t.needsApproval?'需一次性审批':'免审批')]))]) : null,
    ]);
  },
});
