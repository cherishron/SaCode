// 对照冻结 DSH ui-settings-models 的提供商列表与编辑流程；业务数据只经宿主适配器读写。
import { defineComponent, h, ref, onMounted, onBeforeUnmount, type PropType } from 'vue';

export type Protocol = 'openai-completions' | 'openai-responses' | 'anthropic-messages';
export interface Model { id: string; name: string; contextWindow: string; maxTokens: string; image: boolean }
export interface Provider {
  id: string; name: string; baseUrl: string; protocol: Protocol; models: Model[]; keyConfigured: boolean;
  declared?: boolean; defaultModels?: Model[]; modelsCustomized?: boolean; credentialWritable?: boolean;
}
export interface Draft extends Provider { key: string }
export interface Adapter {
  load(): Promise<{ providers: Provider[]; catalog: Provider[]; revision: string; writable: boolean }>;
  save(draft: Draft, expectedRevision: string): Promise<void>;
  remove(id: string, expectedRevision: string): Promise<void>;
  listModels(draft: Draft): Promise<Model[]>;
  subscribe?(invalidate: () => void): () => void;
}
const labels: Record<Protocol, string> = {
  'openai-completions': 'OpenAI Chat Completions',
  'openai-responses': 'OpenAI Responses',
  'anthropic-messages': 'Anthropic Messages',
};
const blankModel = (): Model => ({ id: '', name: '', contextWindow: '', maxTokens: '', image: false });
const blank = (): Draft => ({ id: '', name: '', baseUrl: '', protocol: 'openai-completions', models: [], keyConfigured: false, key: '', declared: true, modelsCustomized: true });
const clone = (p: Provider): Draft => ({ ...p, models: p.models.map(m => ({ ...m })), key: '' });
const unavailable = '模型管理后端尚未接入，配置不会保存。';
const el = (tag: string, cls: string, children: any, props: any = {}) => h(tag, { class: 'models-' + cls, ...props }, children);

export function validateDraft(d: Draft, providers: Provider[], editing: boolean): string {
  if (!/^[a-z][a-z0-9-]*$/.test(d.id)) return 'Provider ID 需以小写字母开头，之后可用小写字母、数字和短横线。';
  if (!editing && providers.some(p => p.id === d.id)) return '已有提供商使用了这个 ID。';
  try { const u = new URL(d.baseUrl); if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.search || u.hash) return '请输入有效的 HTTP 或 HTTPS 地址。'; }
  catch { return '请输入有效的 HTTP 或 HTTPS 地址。'; }
  if (/[\x00-\x20\x7f]/.test(d.key)) return '该 API 密钥格式错误，请检查。';
  if (d.declared && !d.models.length) return '自定义模型 API 至少需要一个模型。';
  const ids = new Set<string>();
  for (let i = 0; i < d.models.length; i++) {
    const m = d.models[i], prefix = '模型 ' + (i + 1) + '：';
    if (!m.id.trim()) return prefix + '模型 ID 不能为空。';
    if (ids.has(m.id.trim())) return prefix + '模型 ID 不能重复。';
    ids.add(m.id.trim());
    for (const value of [m.contextWindow, m.maxTokens]) if (value && (!/^\d+(?:\.\d+)?[kKmM]?$/.test(value) || parseFloat(value) <= 0)) return prefix + '容量需为正数，可加 K 或 M 后缀。';
  }
  return '';
}

export const Page = defineComponent({
  name: 'SaCodeModelsPage',
  props: { adapter: Object as PropType<Adapter> },
  setup(props) {
    const providers = ref<Provider[]>([]), catalog = ref<Provider[]>([]);
    const editing = ref<string | null>(null), editor = ref<Draft>(blank());
    const addOpen = ref(false), mode = ref<'catalog' | 'custom'>('custom');
    const custom = ref<Draft>(blank()), adopted = ref<Draft>(blank());
    const busy = ref(false), loading = ref(false), failure = ref(''), saved = ref('');
    const writable = ref(!props.adapter), revision = ref(''), expectedRevision = ref(''), deleteRevision = ref(''), loadReady = ref(false);
    const deleting = ref<Provider | null>(null), fetching = ref(false), candidates = ref<Model[]>([]);
    const selected = ref<string[]>([]), search = ref(''), expanded = ref<string[]>([]);
    let loadGeneration = 0, disposed = false;
    const reload = async () => {
      if (!props.adapter) return false;
      const generation = ++loadGeneration;
      loading.value = true;
      try {
        const s = await props.adapter.load();
        if (disposed || generation !== loadGeneration) return false;
        providers.value = s.providers.filter(p => p.id !== 'deepseek-account');
        catalog.value = s.catalog.filter(p => p.id !== 'deepseek-account');
        revision.value = s.revision; writable.value = s.writable; loadReady.value = true; return true;
      }
      catch { if (!disposed && generation === loadGeneration) { failure.value = '加载提供商目录失败，请重试。'; writable.value = false; loadReady.value = false; } return false; }
      finally { if (!disposed && generation === loadGeneration) loading.value = false; }
    };
    let unsubscribe: (() => void) | undefined;
    onMounted(() => { unsubscribe = props.adapter?.subscribe?.(() => { void reload(); }); void reload(); });
    onBeforeUnmount(() => { disposed = true; loadGeneration++; unsubscribe?.(); });
    const current = () => editing.value ? editor.value : mode.value === 'custom' ? custom.value : adopted.value;
    const mutationError = (error: unknown, fallback: string) => {
      const code = String((error as {code?: string})?.code || '');
      if (code === 'model-conflict') return '这张卡片打开期间，这些设置已被其他地方改动。请关闭后重新打开，在当前值上编辑。';
      if (code === 'model-read-only') return '当前部署的设置文档为只读。';
      return fallback;
    };
    const close = () => { if (busy.value) return; editing.value = null; addOpen.value = false; failure.value = ''; candidates.value = []; expanded.value = []; if (props.adapter) void reload(); };
    const save = async () => {
      if (busy.value || !writable.value) return;
      const d = current(), invalid = validateDraft(d, providers.value, editing.value !== null);
      failure.value = invalid;
      if (invalid) return;
      if (!props.adapter) { failure.value = unavailable; return; }
      busy.value = true;
      try {
        await props.adapter.save({ ...d, models: d.models.map(m => ({ ...m })) }, expectedRevision.value);
        d.key = '';
        if (!await reload()) { failure.value = '配置已写入，但目录刷新失败，请重试加载。'; return; }
        saved.value = '已保存 ' + (d.name || d.id) + '。'; closeAfterSave();
      }
      catch (e) { failure.value = mutationError(e, '保存失败，草稿已保留，请重试。'); }
      finally { busy.value = false; }
    };
    const closeAfterSave = () => { editing.value = null; addOpen.value = false; custom.value = blank(); adopted.value = blank(); };
    const fetchModels = async () => {
      if (busy.value || !writable.value) return;
      if (!current().baseUrl) { failure.value = '请先填写 API 地址，再获取。'; return; }
      if (!props.adapter) { failure.value = unavailable; return; }
      busy.value = true; failure.value = '';
      try { candidates.value = await props.adapter.listModels(current()); selected.value = []; search.value = ''; fetching.value = true; }
      catch { failure.value = '获取模型失败，已有模型与草稿已保留。'; }
      finally { busy.value = false; }
    };
    const remove = async () => {
      if (busy.value || !writable.value) return;
      if (!deleting.value || !props.adapter) { failure.value = unavailable; return; }
      busy.value = true;
      try { await props.adapter.remove(deleting.value.id, deleteRevision.value); if (await reload()) { deleting.value = null; saved.value = '提供商已删除。'; } }
      catch (e) { failure.value = mutationError(e, '删除失败，提供商配置仍保留，请重试。'); }
      finally { busy.value = false; }
    };
    const button = (text: string, action: () => void, cls = 'secondaryButton', more: any = {}) => el('button', cls, text, { type: 'button', disabled: busy.value, onClick: action, ...more });
    const input = (label: string, value: string, update: (s: string) => void, attrs: any = {}) => el('label', 'field', [
      el('span', 'fieldLabel', label), el('input', 'input', null, { value, disabled: busy.value || !writable.value, 'aria-label': label, onInput: (e: Event) => update((e.target as HTMLInputElement).value), ...attrs }),
    ]);
    const renderEditor = (d: Draft, customMode: boolean) => el('div', 'editor', [
      customMode ? input('Provider ID', d.id, v => d.id = v, { readonly: editing.value !== null, placeholder: 'my-provider' }) : el('div', 'editorHeader', [el('span', 'editorTitle', d.name || d.id), el('span', 'editorRoute', d.id)]),
      customMode ? el('p', 'advancedHint', '以小写字母开头的标识，在请求中唯一标识该提供商，并用于派生凭据名。') : null,
      customMode ? input('显示名称', d.name, v => d.name = v, { placeholder: d.id || '显示名称' }) : null,
      input('API 地址', d.baseUrl, v => d.baseUrl = v, { placeholder: 'https://gateway.example/v1', type: 'url' }),
      customMode ? el('label', 'field', [el('span', 'fieldLabel', 'API 协议'), el('select', 'input', Object.entries(labels).map(([v, label]) => h('option', { value: v }, label)), { value: d.protocol, disabled: busy.value || !writable.value, 'aria-label': 'API 协议', onChange: (e: Event) => d.protocol = (e.target as HTMLSelectElement).value as Protocol })]) : null,
      input('API 密钥', d.key, v => d.key = v, { type: 'password', autocomplete: 'off', spellcheck: false, disabled: busy.value || !writable.value || d.credentialWritable === false, placeholder: d.credentialWritable === false ? '由启动环境提供（只读）' : d.keyConfigured ? '已配置——输入新值可替换' : '输入 API 密钥' }),
      el('section', 'modelCatalog', [
        el('div', 'modelListHead', [el('span', 'modelCatalogTitle', '模型目录'), button(busy.value ? '正在询问提供商…' : '获取可用模型', fetchModels, 'linkButton', { disabled: busy.value || !writable.value })]),
        !customMode ? el('div', 'modelListHead', [el('p', 'modelEmpty', d.modelsCustomized ? '已自定义模型目录' : '正在使用适配器默认模型'), button('恢复默认模型', () => { d.models = (d.defaultModels || []).map(m => ({ ...m })); d.modelsCustomized = false; }, 'linkButton', { disabled: busy.value || !writable.value || !d.defaultModels })]) : null,
        el('div', 'modelList', d.models.map((m, i) => el('div', 'modelEntry', [
          el('div', 'modelRow', [
            input('模型 ID ' + (i + 1), m.id, v => { m.id = v; d.modelsCustomized = true; }, { placeholder: '模型 ID' }),
            input('显示名称 ' + (i + 1), m.name, v => { m.name = v; d.modelsCustomized = true; }, { placeholder: '留空时使用模型 ID' }),
            button('⌄', () => { const id = String(i); expanded.value = expanded.value.includes(id) ? expanded.value.filter(x => x !== id) : [...expanded.value, id]; }, 'iconButton', { 'aria-label': '模型选项 ' + (i + 1), 'aria-expanded': expanded.value.includes(String(i)) }),
            button('×', () => { d.models.splice(i, 1); d.modelsCustomized = true; }, 'iconButton', { 'aria-label': '删除模型 ' + (i + 1), disabled: busy.value || !writable.value }),
          ]),
          el('div', 'modelAdvanced', [input('上下文窗口', m.contextWindow, v => { m.contextWindow = v; d.modelsCustomized = true; }, { placeholder: '使用提供商默认值' }), input('最大输出 token 数', m.maxTokens, v => { m.maxTokens = v; d.modelsCustomized = true; }, { placeholder: '使用提供商默认值' }),
            el('fieldset', 'modelInputTypes', [h('legend', '输入类型'), h('label', [h('input', { type: 'checkbox', checked: true, disabled: true }), '文本']), h('label', [h('input', { type: 'checkbox', checked: m.image, disabled: busy.value || !writable.value, onChange: (e: Event) => { m.image = (e.target as HTMLInputElement).checked; d.modelsCustomized = true; } }), '图片'])]),
          ], { hidden: !expanded.value.includes(String(i)) }),
        ], { key: i }))),
        !d.models.length ? el('p', 'modelEmpty', '模型选择器中将不显示任何模型；目录外 ID 仍可直接发送。') : null,
        button('＋ 添加模型', () => { d.models.push(blankModel()); d.modelsCustomized = true; }, 'addModelButton', { disabled: busy.value || !writable.value }),
      ]),
      failure.value ? el('p', 'error', failure.value, { role: 'alert' }) : null,
      el('div', 'editorActions', [button('取消', close), button(busy.value ? '保存中…' : editing.value ? '保存' : '创建提供商', save, 'primaryButton', { disabled: busy.value || !writable.value })]),
    ]);
    return () => el('div', 'section', [
      el('h2', 'title', '模型'), el('p', 'intro', '管理模型提供商及其 API 密钥。'),
      !props.adapter ? el('p', 'notice', unavailable, { role: 'status' }) : null,
      props.adapter && loadReady.value && !loading.value && !writable.value ? el('p', 'notice', '当前部署的设置文档为只读。', { role: 'status' }) : null,
      loading.value ? el('p', 'notice', '正在加载提供商目录…') : null,
      props.adapter && !loading.value && !loadReady.value ? button('重试加载目录', reload) : null,
      saved.value ? el('p', 'savedNotice', saved.value, { role: 'status', 'aria-live': 'polite' }) : null,
      !addOpen.value && !editing.value && failure.value ? el('div', 'error', [failure.value, button('重试', reload)]) : null,
      el('ul', 'rows', providers.value.map(p => el('li', 'rowCard', [
        el('div', 'rowHead', [el('span', 'rowIdentity', [el('span', 'rowName', p.name || p.id), p.declared ? el('span', 'rowTag', '自定义') : null, el('span', 'credentialDot ' + (p.keyConfigured ? 'models-credentialDotConfigured' : 'models-credentialDotMissing'), null, { 'aria-label': p.keyConfigured ? 'API 密钥已配置' : 'API 密钥缺失', title: p.keyConfigured ? 'API 密钥已配置' : 'API 密钥缺失' })]),
          el('span', 'rowActions', [button('编辑', () => { editing.value = p.id; editor.value = clone(p); expectedRevision.value = revision.value; failure.value = ''; saved.value = ''; }, 'secondaryButton', { 'aria-label': '编辑 ' + (p.name || p.id) }), button('删除', () => { deleting.value = p; deleteRevision.value = revision.value; failure.value = ''; }, 'dangerButton', { 'aria-label': '删除 ' + (p.name || p.id), disabled: busy.value || !writable.value })])]),
        editing.value === p.id ? renderEditor(editor.value, p.declared === true) : null,
      ], { key: p.id }))),
      el('div', 'addBlock', addOpen.value ? [el('div', 'addCard', [
        el('div', 'addModes', [el('div', 'modeSwitch', ['catalog', 'custom'].map(m => button(m === 'catalog' ? '第三方模型提供商' : '自定义模型 API', () => { mode.value = m as 'catalog' | 'custom'; failure.value = ''; }, 'modeButton', { 'aria-pressed': mode.value === m, disabled: busy.value || (m === 'catalog' && !catalog.value.length) }))),
          el('p', 'advancedHint', mode.value === 'catalog' ? '从内置目录中选择提供商，填入其 API 密钥即可使用。' : '连接中转站、自部署服务或其他兼容 OpenAI / Anthropic 协议的接口，需填写 API 地址、协议和模型。')]),
        el('div', 'addPanel', [el('label', 'field', [el('span', 'fieldLabel', '提供商'), el('select', 'input', [h('option', { value: '' }, '选择提供商'), ...catalog.value.filter(p => !providers.value.some(v => v.id === p.id)).map(p => h('option', { value: p.id }, p.name || p.id))], { value: adopted.value.id, disabled: busy.value, 'aria-label': '提供商', onChange: (e: Event) => { const p = catalog.value.find(p => p.id === (e.target as HTMLSelectElement).value); if (p) adopted.value = clone(p); } })]), renderEditor(adopted.value, false)], { hidden: mode.value !== 'catalog' }),
        el('div', 'addPanel', [renderEditor(custom.value, true)], { hidden: mode.value !== 'custom' }),
      ])] : [button('＋ 添加模型提供商', () => { addOpen.value = true; expectedRevision.value = revision.value; mode.value = catalog.value.length ? 'catalog' : 'custom'; failure.value = ''; saved.value = ''; }, 'addButton', { id: 'models-add-provider', disabled: busy.value || !writable.value })]),
      deleting.value ? h((window as any).SaCodeDialog, { open: true, title: '删除 ' + (deleting.value.name || deleting.value.id) + '？', onClose: () => { if (!busy.value) deleting.value = null; } }, () => [el('p', 'intro', deleting.value?.credentialWritable === false ? '此操作会移除提供商配置；由启动环境提供的凭证将会保留。' : '此操作会移除提供商配置和存储的 API 密钥。'), failure.value ? el('p', 'error', failure.value, { role: 'alert' }) : null, el('div', 'editorActions', [button('取消', () => deleting.value = null), button(busy.value ? '正在删除…' : '确认删除', remove, 'dangerButton', { disabled: busy.value || !writable.value })])]) : null,
      fetching.value ? h((window as any).SaCodeDialog, { open: true, title: '选择要添加的模型', onClose: () => fetching.value = false }, () => [
        input('搜索模型', search.value, v => search.value = v),
        !candidates.value.length ? el('p', 'notice', '该提供商没有列出任何模型，请手动添加。') : null,
        el('div', 'fetchActions', [button('全选', () => selected.value = candidates.value.map(m => m.id)), button('取消全选', () => selected.value = [])]),
        el('div', 'fetchList', candidates.value.filter(m => (m.id + m.name).toLowerCase().includes(search.value.toLowerCase())).map(m => h('label', { class: 'models-fetchRow' }, [h('input', { type: 'checkbox', checked: selected.value.includes(m.id), onChange: (e: Event) => { selected.value = (e.target as HTMLInputElement).checked ? [...selected.value, m.id] : selected.value.filter(id => id !== m.id); } }), m.name || m.id]))),
        el('div', 'editorActions', [button('取消', () => fetching.value = false), button('添加所选', () => { const d = current(); d.models.push(...candidates.value.filter(m => selected.value.includes(m.id) && !d.models.some(v => v.id === m.id)).map(m => ({ ...m }))); d.modelsCustomized = true; fetching.value = false; }, 'primaryButton', { disabled: !selected.value.length || !writable.value })]),
      ]) : null,
    ]);
  },
});
