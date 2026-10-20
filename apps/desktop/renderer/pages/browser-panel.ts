// F14 独立 Vue 面板；页面由主进程 WebContentsView 托管，本组件仅展示投影。
import { defineComponent, h, ref, watch, onBeforeUnmount, type PropType } from 'vue';
import { createBrowserPanel, browserChannelHint, type BrowserChannels, type BrowserAction, type BrowserPhase } from './browser-panel-state';
const phases: Record<BrowserPhase, string> = { idle: '尚未观察', loading: '操作中', ready: '已确认页面', error: '操作失败', unknown: '结果未知' };
const actions: Record<BrowserAction, string> = { navigate: '导航', back: '后退', forward: '前进', reload: '刷新' };
const outcomes = { confirmed: '已确认', failed: '失败 / 拒绝', unknown: '结果未知' };
const controls = { running: '控制中', background: '后台控制中', stopped: '已停止（宿主回执）', unknown: '控制状态未知' };
export const BrowserPanel = defineComponent({
  name: 'SaCodeBrowserPanel',
  props: {
    active: { type: Boolean, default: false },
    sessionId: { type: String, default: '' }, projectId: { type: String, default: '' },
    browserId: { type: String, default: '' }, tabId: { type: String, default: '' },
    channels: { type: Object as PropType<BrowserChannels | null>, default: null },
  },
  setup(props) {
    const revision = ref(0), address = ref('');
    const view = createBrowserPanel(() => props.channels, () => ({ sessionId: props.sessionId, projectId: props.projectId, browserId: props.browserId, tabId: props.tabId }), () => { revision.value++; });
    watch(() => [props.sessionId, props.projectId, props.browserId, props.tabId, props.channels], () => { view.reset(); address.value = ''; });
    // 隐藏或卸载不调用 stop，不把关面板当作控制已停止。
    onBeforeUnmount(() => view.dispose());
    return () => {
      void revision.value;
      const s = view.state, page = s.page;
      const available = !!props.channels && !!props.sessionId && !!props.projectId && !!props.browserId && !!props.tabId;
      return h('section', { class: 'browser-panel', 'aria-label': '内置浏览器', 'aria-busy': s.busy }, [
        h('header', {}, [h('h2', {}, '内置浏览器'), h('span', { role: 'status' }, phases[s.phase])]),
        !props.channels ? h('p', { class: 'note', role: 'status' }, browserChannelHint) : null,
        !available && props.channels ? h('p', { class: 'note' }, '等待宿主建立获准浏览器实例并选择标签页。') : null,
        h('form', { class: 'browser-navigation', onSubmit: (event: Event) => { event.preventDefault(); void view.perform('navigate', address.value); } }, [
          h('label', {}, [h('span', {}, '目标 URL'), h('input', { type: 'url', 'aria-label': '目标 URL', value: address.value, placeholder: 'https://example.com', autocomplete: 'off', spellcheck: false, disabled: s.busy,
            onInput: (event: Event) => { address.value = (event.target as HTMLInputElement).value; } })]),
          h('button', { class: 'btn btn-primary', type: 'submit', disabled: !available || s.busy || !address.value.trim() }, '导航'),
          h('button', { class: 'btn', type: 'button', disabled: !available || s.busy || !page?.canGoBack, onClick: () => void view.perform('back') }, '后退'),
          h('button', { class: 'btn', type: 'button', disabled: !available || s.busy || !page?.canGoForward, onClick: () => void view.perform('forward') }, '前进'),
          h('button', { class: 'btn', type: 'button', disabled: !available || s.busy, onClick: () => void view.perform('reload') }, '刷新'),
        ]),
        s.error ? h('p', { class: 'editor-error', role: 'alert' }, s.error) : null,
        h('section', { class: 'browser-control-status', 'aria-label': '操控状态' }, [
          h('h3', {}, '操控状态'),
          h('dl', {}, [
            h('dt', {}, '当前页面 URL'), h('dd', {}, page?.url || '尚无已确认页面 URL'),
            h('dt', {}, '页面标题'), h('dd', {}, page ? page.title || '（无标题）' : '尚无已确认标题'),
            h('dt', {}, '控制状态'), h('dd', {}, s.phase === 'unknown' || s.phase === 'error' ? '需重新核验；上次回执不代表当前状态' : page ? controls[page.controlState] : '未知，尚未收到宿主状态'),
          ]),
          page && s.phase !== 'ready' ? h('p', { class: 'note' }, '页面信息为最近一次已确认快照，不表示本次导航成功。') : null,
          h('p', { class: 'note' }, '关闭或隐藏面板不等于停止后台控制；本组件不提供或模拟停止操作。'),
        ]),
        h('div', { class: 'browser-viewport-placeholder', role: 'region', 'aria-label': '浏览器视图占位' }, [
          h('p', { class: 'note' }, '浏览器视图占位：等待主进程 WebContentsView 接线；此区域不加载网页、不持有外部页面 DOM。'),
        ]),
        h('section', { class: 'browser-screenshot-placeholder', 'aria-label': '截图预览' }, [
          h('h3', {}, '截图预览'),
          h('p', { class: 'note' }, '尚无截图。截图授权、物化及 attachmentImageRead 接线后才显示真实图片；当前不会采集或生成截图。'),
        ]),
        h('section', { class: 'browser-operation-history', 'aria-label': '操作历史' }, [
          h('h3', {}, '操作历史'),
          s.history.length ? h('ol', {}, s.history.map(entry => h('li', { key: entry.id }, `${actions[entry.action]} · ${outcomes[entry.outcome]}`))) : h('p', { class: 'note' }, '尚无操作记录。'),
          h('p', { class: 'note' }, '仅显示本面板内存中的最近 100 条操作结算，不是持久审计；不记录输入 URL、网页正文或凭据。'),
        ]),
        h('p', { class: 'note' }, '导航与操控授权、跨域及重定向范围核验由宿主执行；网页内容是不可信数据，不构成操作指令。'),
      ]);
    };
  },
});
