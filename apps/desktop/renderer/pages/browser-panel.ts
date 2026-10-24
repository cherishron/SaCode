import { defineComponent, h, ref, watch, onMounted, onBeforeUnmount, nextTick, type PropType } from 'vue';
type Owner = { sessionId: string; projectId: string };
type Page = { url: string; title: string; canGoBack: boolean; canGoForward: boolean };
type Reply = { ok: boolean; page?: Page; failureKind?: string; loading?: boolean };
type Api = Record<string, (request: object) => Promise<Reply>>;
export const BrowserPanel = defineComponent({
  name: 'SaCodeBrowserPanel',
  props: { active: Boolean, sessionId: { type: String, default: '' }, projectId: { type: String, default: '' }, api: { type: Object as PropType<Api | null>, default: null } },
  setup(props) {
    const viewport = ref<HTMLElement | null>(null), address = ref(''), page = ref<Page | null>(null), busy = ref(false), error = ref(''), ready = ref(false);
    let owner: Owner | null = null, epoch = 0, disposed = false, opening = false, frame = 0, polling = false;
    let resize: ResizeObserver, mutations: MutationObserver, timer: ReturnType<typeof setInterval>;
    let lastLayout = '';
    const identity = (): Owner => ({ sessionId: props.sessionId, projectId: props.projectId });
    const matches = (value: Owner) => value.sessionId === props.sessionId && value.projectId === props.projectId;
    const invoke = (action: string, request: object) => {
      const fn = props.api?.['browserView' + action];
      if (!fn) return Promise.reject(Error('browser-view-unavailable'));
      return fn(request);
    };
    function accept(reply: Reply) {
      if (reply.page) {
        page.value = reply.page;
        if (reply.ok && reply.page.url) address.value = reply.page.url;
      }
      if (!reply.ok) error.value = reply.failureKind === 'navigation-blocked' ? '跨站导航已拦截，请核对目标后在地址栏明确导航。' : '页面未成功加载，请核验当前页面；不会自动重试。';
    }
    function layout() {
      if (!owner || !ready.value || disposed) return;
      const node = viewport.value, rect = node?.getBoundingClientRect();
      let left = Math.max(0, rect?.x || 0), top = Math.max(0, rect?.y || 0), right = Math.min(window.innerWidth, rect ? rect.right ?? rect.x + rect.width : 0), bottom = Math.min(window.innerHeight, rect ? rect.bottom ?? rect.y + rect.height : 0);
      for (let parent = node?.parentElement; parent; parent = parent.parentElement) {
        const style = window.getComputedStyle(parent);
        if (/(auto|scroll|hidden|clip)/.test(style.overflow + style.overflowX + style.overflowY)) {
          const clip = parent.getBoundingClientRect();
          left = Math.max(left, clip.left); top = Math.max(top, clip.top); right = Math.min(right, clip.right); bottom = Math.min(bottom, clip.bottom);
        }
      }
      const overlay = [...document.querySelectorAll('dialog[open], [aria-modal="true"], [role="alertdialog"], .workbench-resource-picker, .t-popup')].some(element => element.getClientRects().length > 0);
      const visible = !!(props.active && !overlay && document.visibilityState === 'visible' && node?.getClientRects().length && rect && right > left && bottom > top);
      const bounds = visible && rect ? { x: Math.max(0, Math.ceil(left)), y: Math.max(0, Math.ceil(top)), width: Math.max(0, Math.floor(right - left)), height: Math.max(0, Math.floor(bottom - top)) } : { x: 0, y: 0, width: 0, height: 0 };
      const request = { ...owner, visible, bounds }, key = JSON.stringify(request);
      if (key === lastLayout) return;
      lastLayout = key;
      void invoke('Layout', request).catch(() => { lastLayout = ''; if (!disposed) error.value = '浏览器视图布局未确认，请重新打开面板。'; });
    }
    const schedule = () => { layout(); if (!frame) frame = requestAnimationFrame(() => { frame = 0; layout(); }); };
    const invalidate = () => { lastLayout = ''; schedule(); };
    async function sync() {
      if (disposed) return;
      if (owner && !matches(owner)) {
        const previous = owner; owner = null; ready.value = false; ++epoch; busy.value = false; opening = false; page.value = null; address.value = ''; lastLayout = '';
        await invoke('Close', previous).catch(() => {});
      }
      if (!props.active || !props.sessionId || !props.projectId) { layout(); return; }
      if (owner || opening) { schedule(); return; }
      const selected = identity(), ticket = ++epoch; opening = true; owner = selected; error.value = '';
      try {
        const reply = await invoke('Open', selected);
        if (disposed || ticket !== epoch || !matches(selected)) return;
        ready.value = true; accept(reply); await nextTick(); schedule();
      } catch { if (!disposed && ticket === epoch) { owner = null; error.value = '内置浏览器未能建立；请检查桌面主进程连接。'; } }
      finally { if (ticket === epoch) opening = false; }
    }
    async function perform(action: string) {
      if (!owner || !ready.value || busy.value || !props.active) return;
      const selected = { ...owner }, ticket = epoch;
      busy.value = true; error.value = '';
      try {
        const reply = await invoke(action, { ...selected, ...(action === 'Navigate' ? { url: address.value.trim() } : {}) });
        if (!disposed && ticket === epoch && matches(selected)) accept(reply);
      } catch { if (!disposed && ticket === epoch) error.value = '浏览器操作未确认；仅支持不含凭据的 HTTP(S) 地址，不会自动重试。'; }
      finally { if (!disposed && ticket === epoch) { busy.value = false; schedule(); } }
    }
    watch(() => [props.active, props.sessionId, props.projectId], () => { void sync(); }, { flush: 'post' });
    onMounted(() => {
      resize = new ResizeObserver(schedule); if (viewport.value) resize.observe(viewport.value);
      mutations = new MutationObserver(schedule); mutations.observe(document.documentElement, { attributes: true, childList: true, subtree: true, attributeFilter: ['open', 'hidden', 'class', 'style', 'aria-modal'] });
      window.addEventListener('resize', invalidate); document.addEventListener('scroll', schedule, true); document.addEventListener('visibilitychange', invalidate);
      timer = setInterval(async () => {
        if (!owner || !props.active || busy.value || polling) return;
        const selected = { ...owner }, ticket = epoch; polling = true;
        try { const reply = await invoke('Describe', selected); if (!disposed && ticket === epoch && matches(selected)) { accept(reply); schedule(); } }
        catch { if (!disposed && ticket === epoch) { ready.value = false; error.value = '浏览器状态连接已失效，请关闭后重新打开资源标签。'; } }
        finally { polling = false; }
      }, 750);
      void sync();
    });
    onBeforeUnmount(() => {
      disposed = true; ++epoch; clearInterval(timer); cancelAnimationFrame(frame); resize?.disconnect(); mutations?.disconnect();
      window.removeEventListener('resize', invalidate); document.removeEventListener('scroll', schedule, true); document.removeEventListener('visibilitychange', invalidate);
      if (owner) void invoke('Close', owner).catch(() => {});
    });
    return () => h('section', { class: 'browser-panel', 'aria-label': '内置浏览器', 'aria-busy': busy.value }, [
      h('header', { class: 'browser-heading' }, [h('h2', {}, '内置浏览器'), h('span', { class: 'note' }, '人工浏览 · 临时隔离会话')]),
      h('form', { class: 'browser-navigation', onSubmit: (event: Event) => { event.preventDefault(); return perform('Navigate'); } }, [
        h('label', { class: 'browser-address' }, [h('span', {}, '目标 URL'), h('input', { type: 'url', 'aria-label': '目标 URL', value: address.value, placeholder: '输入完整 HTTP(S) 地址', autocomplete: 'off', spellcheck: false, disabled: busy.value, onInput: (event: Event) => { address.value = (event.target as HTMLInputElement).value; } })]),
        h('button', { type: 'submit', class: 'btn btn-primary', disabled: !ready.value || busy.value || !address.value.trim() }, '导航'),
        ...[['Back', '后退', !page.value?.canGoBack], ['Forward', '前进', !page.value?.canGoForward], ['Reload', '刷新', !page.value?.url]].map(([action, label, unavailable]) => h('button', { type: 'button', class: 'btn', disabled: !ready.value || busy.value || unavailable, onClick: () => perform(String(action)) }, String(label))),
      ]),
      error.value ? h('p', { class: 'editor-error', role: 'alert' }, error.value) : null,
      h('p', { class: 'browser-page-status', role: 'status' }, busy.value ? '正在加载页面…' : page.value?.url ? `${page.value.title || '（无标题）'} · ${page.value.url}` : '尚未导航；输入地址后才会请求网页。'),
      h('div', { ref: viewport, class: 'browser-viewport', role: 'region', 'aria-label': '网页视图' }),
      h('p', { class: 'note' }, '网页是不可信内容，不授予 Agent 权限。仅当前明确目标同源请求放行；跨站链接需在地址栏确认。新窗口、下载与设备权限默认拒绝。切换项目或关闭资源后清除本视图登录会话。'),
    ]);
  },
});
