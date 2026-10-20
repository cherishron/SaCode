// F14 前端投影；固定动作由后续 preload 适配层注入，不持有外部网页 DOM。
export type BrowserAction = 'navigate' | 'back' | 'forward' | 'reload';
export type BrowserPhase = 'idle' | 'loading' | 'ready' | 'error' | 'unknown';
export type BrowserPage = {
  browserId: string; tabId: string; url: string; title: string;
  canGoBack: boolean; canGoForward: boolean;
  controlState: 'running' | 'background' | 'stopped' | 'unknown';
};
export type BrowserReply = { ok: boolean; page?: BrowserPage; failureKind?: string };
export type BrowserTarget = { sessionId: string; projectId: string; browserId: string; tabId: string };
// 临时前端适配契约，不宣称为已存在的 IPC；授权及逐跳范围核验由后端负责。
export type BrowserChannels = {
  browserNavigate: (request: BrowserTarget & { url: string }) => Promise<BrowserReply>;
  browserBack: (request: BrowserTarget) => Promise<BrowserReply>;
  browserForward: (request: BrowserTarget) => Promise<BrowserReply>;
  browserReload: (request: BrowserTarget) => Promise<BrowserReply>;
};
export type BrowserHistoryEntry = { id: number; action: BrowserAction; outcome: 'confirmed' | 'failed' | 'unknown' };
export const browserChannelHint = 'preload.cjs 尚未添加 browser* IPC';
const failures: Record<string, string> = {
  'approval-required': '此操作需要精确工单授权；前端不会自报批准。',
  'approval-mode-denied': '当前权限模式拒绝浏览器操作。',
  'browser-provider-unavailable': '浏览器 provider 未就绪，不能导航。',
  'browser-session-changed': '浏览器所属会话已变更，请重新选择目标。',
  'browser-persistence-failed': '操作持久化失败，控制已冻结，请核验实际页面。',
};
function safeUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    return url.href;
  } catch { return null; }
}
export function createBrowserPanel(getChannels: () => BrowserChannels | null, target: () => BrowserTarget, changed: () => void) {
  const state = { phase: 'idle' as BrowserPhase, page: null as BrowserPage | null, busy: false, error: '', history: [] as BrowserHistoryEntry[] };
  let epoch = 0, disposed = false, sequence = 0;
  const notify = () => { if (!disposed) changed(); };
  function reset() {
    ++epoch; state.phase = 'idle'; state.page = null; state.busy = false; state.error = ''; state.history = []; notify();
  }
  function record(action: BrowserAction, outcome: BrowserHistoryEntry['outcome']) {
    state.history = [...state.history, { id: ++sequence, action, outcome }].slice(-100);
  }
  async function perform(action: BrowserAction, input = '') {
    if (disposed || state.busy) return;
    const channels = getChannels();
    if (!channels) { state.error = browserChannelHint; notify(); return; }
    const owner = { ...target() };
    if (!owner.sessionId || !owner.projectId || !owner.browserId || !owner.tabId) {
      state.error = '请先由宿主建立获准的浏览器实例并选择标签页。'; notify(); return;
    }
    const url = action === 'navigate' ? safeUrl(input.trim()) : null;
    if (action === 'navigate' && !url) { state.error = '仅接受不含用户名和密码的完整 HTTP(S) URL。'; notify(); return; }
    if (action === 'back' && !state.page?.canGoBack || action === 'forward' && !state.page?.canGoForward) return;
    const ticket = ++epoch;
    state.busy = true; state.phase = 'loading'; state.error = ''; notify();
    try {
      const reply = action === 'navigate' ? await channels.browserNavigate({ ...owner, url: url! }) :
        action === 'back' ? await channels.browserBack(owner) :
        action === 'forward' ? await channels.browserForward(owner) : await channels.browserReload(owner);
      if (disposed || ticket !== epoch) return;
      const latest = target();
      if (Object.keys(owner).some(key => owner[key as keyof BrowserTarget] !== latest[key as keyof BrowserTarget])) { reset(); return; }
      if (!reply.ok) {
        state.phase = 'error'; state.error = failures[reply.failureKind || ''] || '浏览器操作被拒绝或失败，请核验实际页面。'; record(action, 'failed'); return;
      }
      const page = reply.page;
      if (!page || page.browserId !== owner.browserId || page.tabId !== owner.tabId ||
        typeof page.url !== 'string' || !safeUrl(page.url) || typeof page.title !== 'string' ||
        typeof page.canGoBack !== 'boolean' || typeof page.canGoForward !== 'boolean' ||
        !['running', 'background', 'stopped', 'unknown'].includes(page.controlState)) {
        state.phase = 'unknown'; state.error = '未收到匹配目标的有效页面回执；导航结果未知。'; record(action, 'unknown'); return;
      }
      // URL/标题只采纳已确认页面，不使用输入地址冒充导航结果。
      state.page = { browserId: page.browserId, tabId: page.tabId, url: page.url, title: page.title,
        canGoBack: page.canGoBack, canGoForward: page.canGoForward, controlState: page.controlState };
      state.phase = 'ready'; record(action, 'confirmed');
    } catch {
      if (!disposed && ticket === epoch) {
        state.phase = 'unknown'; state.error = '浏览器响应丢失，操作结果未知；不会自动重试。'; record(action, 'unknown');
      }
    } finally { if (!disposed && ticket === epoch) { state.busy = false; notify(); } }
  }
  function dispose() { disposed = true; ++epoch; }
  return { state, perform, reset, dispose };
}
