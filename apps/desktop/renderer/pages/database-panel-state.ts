// F16 独立前端状态机；通道由后续 IPC 适配层注入，不访问驱动或存储。
export type DatabaseEngine = 'postgresql' | 'mysql' | 'dm';
export type DatabasePhase = 'disconnected' | 'connecting' | 'connected' | 'disconnecting' | 'querying' | 'error';
export type ConnectionSpec = {
  engine: DatabaseEngine; host: string; port: number; database: string; user: string;
  credentialRef: string; tlsMode: 'verify-full'; readonly: true;
  connectTimeoutMs: number; statementTimeoutMs: number;
};
export type DatabaseColumn = { name: string; type: string };
export type DatabaseResult = {
  columns: DatabaseColumn[]; rows: unknown[]; affectedRows?: number;
  cursorId?: string; truncated: boolean; elapsedMs?: number;
};
export type DatabaseChannels = {
  connect: (request: { sessionId: string; projectId: string; spec: ConnectionSpec }) => Promise<{ ok: boolean; connectionId?: string; failureKind?: string }>;
  disconnect: (connectionId: string) => Promise<{ ok: boolean; failureKind?: string }>;
  query: (request: { connectionId: string; sql: string; params: unknown[]; opts: { readonly: true; maxRows: number; maxBytes: number; statementTimeoutMs: number; cursorBatch: number } }) => Promise<DatabaseResult & { failureKind?: string }>;
  cursorFetch: (request: { cursorId: string; offset: number; limit: number }) => Promise<DatabaseResult & { failureKind?: string }>;
  cursorClose: (cursorId: string) => Promise<unknown>;
};
export const databaseChannelHint = '数据库通道未接通：preload.cjs 尚未接入 database/* IPC。';
const failureMessages: Record<string, string> = {
  auth: '数据库认证失败，请检查独立凭据。', network: '数据库网络连接失败。',
  tls: 'TLS 证书校验失败；不会关闭校验绕过。', 'server-refused': '数据库服务拒绝连接。',
  'driver-load': '所选引擎驱动未安装或加载失败。', timeout: '数据库请求超时，未自动重试。',
  cancelled: '数据库请求已取消。', 'bad-spec': '连接配置无效。',
  'approval-required': '此 SQL 需要写入审批，请转到执行审阅；当前面板不执行写入。',
  'readonly-required': '服务端拒绝此 SQL：无法确认只读，请转到执行审阅。',
};
// 不回显异常正文：驱动错误可能包含口令、连接串或 SQL 字面值。
function failureMessage(kind?: string): string {
  return kind && failureMessages[kind] || '数据库操作失败或结果未知，请核验连接；不会自动重放请求。';
}
export function defaultConnectionSpec(): ConnectionSpec {
  return { engine: 'postgresql', host: 'localhost', port: 5432, database: '', user: '', credentialRef: '',
    tlsMode: 'verify-full', readonly: true, connectTimeoutMs: 10000, statementTimeoutMs: 30000 };
}
export function createDatabasePanel(getChannels: () => DatabaseChannels | null, context: () => { sessionId: string; projectId: string }, changed: () => void) {
  const state = {
    phase: 'disconnected' as DatabasePhase, connectionId: null as string | null,
    target: null as ConnectionSpec | null, result: null as DatabaseResult | null,
    pages: [] as DatabaseResult[], pageIndex: 0, pageSize: 100, error: '', busy: false,
  };
  let epoch = 0, disposed = false;
  const notify = () => { if (!disposed) changed(); };
  const current = (ticket: number) => !disposed && ticket === epoch;
  function reset() {
    ++epoch;
    Object.assign(state, { phase: 'disconnected', connectionId: null, target: null, result: null, pages: [], pageIndex: 0, error: '', busy: false });
    notify();
  }
  async function release(channels: DatabaseChannels, id: string) {
    try { await channels.disconnect(id); } catch { /* 清理失败不假报断开。 */ }
  }
  async function closeCursor(channels: DatabaseChannels, cursorId?: string) {
    if (cursorId) { try { await channels.cursorClose(cursorId); } catch { /* 不重放查询。 */ } }
  }
  async function connect(draft: ConnectionSpec) {
    if (disposed || state.busy || state.connectionId) return;
    const channels = getChannels(), owner = context();
    if (!channels) { state.error = databaseChannelHint; notify(); return; }
    if (!owner.sessionId || !owner.projectId || !['postgresql', 'mysql', 'dm'].includes(draft.engine) ||
      !draft.host.trim() || !draft.database.trim() || !draft.user.trim() ||
      !Number.isInteger(draft.port) || draft.port < 1 || draft.port > 65535) {
      state.phase = 'error'; state.error = '请填写会话、项目和有效的连接目标（端口 1–65535）。'; notify(); return;
    }
    // 白名单拷贝：即使调用方夹带 password，也不能进入连接请求或状态。
    const spec: ConnectionSpec = { engine: draft.engine, host: draft.host.trim(), port: draft.port,
      database: draft.database.trim(), user: draft.user.trim(), credentialRef: draft.credentialRef.trim(),
      tlsMode: 'verify-full', readonly: true, connectTimeoutMs: 10000, statementTimeoutMs: 30000 };
    const ticket = ++epoch;
    state.busy = true; state.phase = 'connecting'; state.error = ''; notify();
    try {
      const reply = await channels.connect({ ...owner, spec });
      if (!current(ticket)) { if (reply.ok && reply.connectionId) await release(channels, reply.connectionId); return; }
      if (!reply.ok || !reply.connectionId) { state.phase = 'error'; state.error = failureMessage(reply.failureKind); return; }
      state.connectionId = reply.connectionId; state.target = spec; state.phase = 'connected';
    } catch { if (current(ticket)) { state.phase = 'error'; state.error = failureMessage(); } }
    finally { if (current(ticket)) { state.busy = false; notify(); } }
  }
  async function disconnect() {
    if (disposed || state.busy || !state.connectionId) return;
    const channels = getChannels();
    if (!channels) { state.error = databaseChannelHint; notify(); return; }
    const ticket = ++epoch, id = state.connectionId;
    state.busy = true; state.phase = 'disconnecting'; state.error = ''; notify();
    try {
      await closeCursor(channels, state.result?.cursorId);
      const reply = await channels.disconnect(id);
      if (!current(ticket)) return;
      if (!reply.ok) { state.phase = 'error'; state.error = failureMessage(reply.failureKind); return; }
      reset();
    } catch { if (current(ticket)) { state.phase = 'error'; state.error = failureMessage(); } }
    finally { if (current(ticket)) { state.busy = false; notify(); } }
  }
  function validResult(reply: DatabaseResult): boolean {
    return Array.isArray(reply.columns) && reply.columns.every(c => c && typeof c.name === 'string' && typeof c.type === 'string') &&
      Array.isArray(reply.rows) && reply.rows.length <= state.pageSize;
  }
  // 不按 SQL 字符串前缀推断授权；所有文本只进入服务端强制只读 query。
  async function execute(sql: string, mode: 'readonly' | 'write' = 'readonly') {
    if (disposed || state.busy) return;
    if (mode !== 'readonly') { state.error = failureMessages['approval-required']; notify(); return; }
    if (!state.connectionId || !sql.trim()) { state.error = '请先连接数据库并输入 SQL。'; notify(); return; }
    const channels = getChannels();
    if (!channels) { state.error = databaseChannelHint; notify(); return; }
    const ticket = ++epoch, connectionId = state.connectionId;
    state.busy = true; state.phase = 'querying'; state.error = '';
    const oldCursor = state.result?.cursorId;
    state.result = null; state.pages = []; state.pageIndex = 0; notify();
    try {
      await closeCursor(channels, oldCursor);
      if (!current(ticket)) return;
      const reply = await channels.query({ connectionId, sql, params: [], opts: {
        readonly: true, maxRows: 10000, maxBytes: 4 * 1024 * 1024, statementTimeoutMs: 30000, cursorBatch: state.pageSize,
      } });
      if (!current(ticket)) { await closeCursor(channels, reply.cursorId); return; }
      if (reply.failureKind || !validResult(reply)) { state.phase = 'error'; state.error = failureMessage(reply.failureKind); await closeCursor(channels, reply.cursorId); return; }
      state.result = reply; state.pages = [reply]; state.phase = 'connected';
    } catch { if (current(ticket)) { state.phase = 'error'; state.error = failureMessage(); } }
    finally { if (current(ticket)) { state.busy = false; notify(); } }
  }
  async function nextPage() {
    if (disposed || state.busy || !state.result) return;
    if (state.pageIndex + 1 < state.pages.length) { state.result = state.pages[++state.pageIndex]; notify(); return; }
    const cursorId = state.result.cursorId, channels = getChannels();
    if (!cursorId || state.result.rows.length < state.pageSize || (state.pageIndex + 1) * state.pageSize >= 10000) return;
    if (!channels) { state.error = databaseChannelHint; notify(); return; }
    const ticket = epoch, offset = (state.pageIndex + 1) * state.pageSize;
    state.busy = true; state.phase = 'querying'; state.error = ''; notify();
    try {
      const reply = await channels.cursorFetch({ cursorId, offset, limit: state.pageSize });
      if (!current(ticket)) { await closeCursor(channels, reply.cursorId); return; }
      if (reply.failureKind || !validResult(reply)) { state.phase = 'error'; state.error = failureMessage(reply.failureKind); return; }
      const page = { ...reply, cursorId: reply.cursorId || cursorId };
      state.pages.push(page); state.pageIndex++; state.result = page; state.phase = 'connected';
    } catch { if (current(ticket)) { state.phase = 'error'; state.error = failureMessage(); } }
    finally { if (current(ticket)) { state.busy = false; notify(); } }
  }
  function previousPage() {
    if (!disposed && !state.busy && state.pageIndex > 0) { state.result = state.pages[--state.pageIndex]; notify(); }
  }
  // 切换任务立即失效旧回执，并仅清理本面板拥有的连接。
  function detach() {
    const channels = getChannels(), id = state.connectionId, cursorId = state.result?.cursorId;
    reset();
    if (channels && id) void closeCursor(channels, cursorId).then(() => release(channels, id));
  }
  function dispose() { detach(); disposed = true; ++epoch; }
  return { state, connect, disconnect, execute, nextPage, previousPage, detach, dispose };
}
