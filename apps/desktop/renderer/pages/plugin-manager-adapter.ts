// 插件管理器的仓颉适配器：read/dispatch/subscribe 三件套全部落在 window.sacode 的有限通道上。
// 这里没有「发任意方法」的通路，也不在渲染层保存第二份插件真源——每个事实都来自 Host，
// 每次动作之后与安装轮询之后都重新读一遍（对齐上游 manager-store 的收束规则：
// “Every fact comes from the Host”）。通道缺失时fail-loud，绝不用本地状态冒充后端。
import type { Adapter, Command, Install, Package, Phase, Row, Snapshot } from './plugin-manager';

export interface InventoryPackageRow {
  rowId: string; title?: string | null; moduleName?: string | null; entryId?: string | null;
  description?: string | null; descriptionZhCN?: string | null; enabled: boolean;
  phase: string | null; readOnlyReason?: string | null;
}
export interface InventoryPackage {
  name: string; title?: string | null; version?: string | null; description?: string | null;
  descriptionZhCN?: string | null; installed: boolean; optional: boolean; enabled: boolean;
  readOnlyReason?: string | null; error?: { code: string; reason?: string | null } | null; rows: InventoryPackageRow[];
}
export interface InventoryView { available: boolean; revision: number; packages: InventoryPackage[] }
export interface RegistryView { registry: string | null; fallbackRegistries: string[]; resolved: string | null }
export interface SubjectView { status: 'accepted' | 'refused'; name?: string | null; host?: string | null; version?: string | null; description?: string | null; problem?: string | null; reason?: string | null }
export interface RunView { jobId: string; command: string; cwd: string; output: string; exitCode?: number | null }
export interface IncompatibleView { name: string; version: string; runtimeVersion: string; peers: Record<string, string> }
export interface FailureView { code?: string | null; reason?: string | null; kind?: string | null; failedAt?: 'registry' | 'spec-host' | null; pendingBuilds?: string[] | null; incompatible?: IncompatibleView[] | null }
export interface InstallProgressView {
  requestId: string;
  phase: 'checking' | 'installing' | 'applying' | 'cancelled' | 'done' | 'failed' | 'unknown';
  subject?: { name?: string | null; host?: string | null; version?: string | null; description?: string | null } | null;
  runs?: RunView[] | null; registries?: string[] | null; total?: number | null; failure?: FailureView | null;
  installed?: string | null; restartRequired?: boolean | null; approvedBuilds?: string[] | null;
}
export interface InstallStartRequest { spec: string; registry: string; requestId: string; approvedBuilds: string[] }
// 通道面：一个动作一条通道，形状由主进程与宿主守卫；缺通道就在这里fail-loud。
export interface PluginFaces {
  describe(): Promise<unknown>;
  setEnabled(name: string, enabled: boolean, expectedRevision: number): Promise<unknown>;
  setRowEnabled(entryId: string, enabled: boolean, expectedRevision: number): Promise<unknown>;
  remove(name: string, expectedRevision: number): Promise<unknown>;
  registries(): Promise<unknown>;
  inspect(spec: string, registry: string): Promise<unknown>;
  installStart(request: InstallStartRequest): Promise<unknown>;
  installProgress(requestId: string): Promise<unknown>;
  installCancel(requestId: string): Promise<unknown>;
}
export interface SacodePluginManager { adapter: Adapter; unwired: string[] }

const PHASES: ReadonlySet<string> = new Set(['pending', 'loading', 'active', 'failed', 'unloading']);
const REASONS: Readonly<Record<string, string>> = {
  'plugin-unavailable': '本部署没有可管理的插件档案，无法安装或启停插件。',
  'plugin-not-found': '插件或组件不存在，可能已被其他入口移除。',
  'plugin-read-only': '这个插件由当前配置提供，不能在此停用或移除。',
  'plugin-conflict': '插件档案已被其他入口改过，请重新读取后再试。',
  'plugin-rejected': '宿主拒绝了这个操作，请核对插件名称与安装来源。',
  'plugin-install-lost': '安装结果尚未确认，请核对安装状态后再试。',
  'plugin-channel-missing': '对应的仓颉通道尚未接入，界面不会用本地状态代替。',
};
const REFUSAL_PROBLEMS: Readonly<Record<string, string>> = {
  'already-installed': '这个插件已经安装。',
  shipped: '这个插件由当前配置提供，不能重复安装。',
  'not-found': '没有找到相关插件，请核对包名或地址。',
  'no-matching-version': '没有匹配的版本，请换个版本范围或安装源。',
  invalid: '这个插件包名或地址不合法。',
  unknown: '无法识别这个插件，请核对包名或地址。',
};
const POLL_MS = 750, MAX_POLLS = 800;

const isStr = (v: unknown, max: number): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;
const isBool = (v: unknown): v is boolean => typeof v === 'boolean';
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const optStr = (v: unknown, max: number): string | undefined => (v == null ? undefined : isStr(v, max) ? v : reject('plugin-inventory-rejected'));
const optBool = (v: unknown): boolean | undefined => (v == null ? undefined : isBool(v) ? v : reject('plugin-inventory-rejected'));
const reject = (code: string): never => { throw Object.assign(new Error(code), { code }); };
const failureOf = (e: unknown): { code: string; reason: string } => {
  // 不能用 instanceof Error：跨 realm／跨 IPC 边界回来的对象带的是另一个构造函数，
  // 认不出来就会把宿主的错误码降级成一句「传输失败」，页面再也分不出是哪种拒绝。
  const raw = typeof (e as any)?.message === 'string' ? (e as any).message : String(e ?? '');
  const m = /^(-?\d+)\s+(\S+)/.exec(raw.trim());
  if (m) return { code: m[2], reason: REASONS[m[2]] || m[2] };
  return { code: 'plugin-transport-failed', reason: REASONS['plugin-transport-failed'] || raw };
};
const newRequestId = (): string => {
  const c: any = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return 'p' + c.randomUUID();
  return 'p' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
};

// 逐字段校验：载荷缺字段、类型不符、出现重名包或重复 entryId 都整份拒收。
// 不猜、不补默认值——猜出来的清单就是伪造快照。
const normalizeRow = (raw: any): InventoryPackageRow => {
  if (!raw || typeof raw !== 'object') reject('plugin-inventory-rejected');
  if (!isStr(raw.rowId, 214)) reject('plugin-inventory-rejected');
  if (!isBool(raw.enabled)) reject('plugin-inventory-rejected');
  if (raw.phase != null && (typeof raw.phase !== 'string' || !PHASES.has(raw.phase))) reject('plugin-inventory-rejected');
  return {
    rowId: raw.rowId, title: optStr(raw.title, 214), moduleName: optStr(raw.moduleName, 214), entryId: optStr(raw.entryId, 214),
    description: optStr(raw.description, 2000), descriptionZhCN: optStr(raw.descriptionZhCN, 2000),
    enabled: raw.enabled, phase: raw.phase ?? null, readOnlyReason: optStr(raw.readOnlyReason, 400),
  };
};
const normalizePackage = (raw: any): InventoryPackage => {
  if (!raw || typeof raw !== 'object') reject('plugin-inventory-rejected');
  if (!isStr(raw.name, 214)) reject('plugin-inventory-rejected');
  for (const key of ['installed', 'optional', 'enabled']) if (!isBool(raw[key])) reject('plugin-inventory-rejected');
  if (!Array.isArray(raw.rows)) reject('plugin-inventory-rejected');
  const rows = raw.rows.map(normalizeRow);
  const entries = new Set<string>();
  for (const row of rows) {
    if (row.entryId) { if (entries.has(row.entryId)) reject('plugin-inventory-rejected'); entries.add(row.entryId); }
  }
  const error = raw.error == null ? null : raw.error && typeof raw.error === 'object' && isStr(raw.error.code, 64)
    ? { code: raw.error.code, reason: optStr(raw.error.reason, 2000) } : reject('plugin-inventory-rejected');
  return {
    name: raw.name, title: optStr(raw.title, 214), version: optStr(raw.version, 64), description: optStr(raw.description, 2000),
    descriptionZhCN: optStr(raw.descriptionZhCN, 2000), installed: raw.installed, optional: raw.optional, enabled: raw.enabled,
    readOnlyReason: optStr(raw.readOnlyReason, 400), error, rows,
  };
};
export const normalizeInventory = (raw: unknown): InventoryView => {
  if (!raw || typeof raw !== 'object') reject('plugin-inventory-rejected');
  const view = raw as Record<string, unknown>;
  if (!isBool(view.available) || !isInt(view.revision) || !Array.isArray(view.packages)) reject('plugin-inventory-rejected');
  const packages = view.packages.map(normalizePackage);
  const names = new Set<string>();
  for (const p of packages) { if (names.has(p.name)) reject('plugin-inventory-rejected'); names.add(p.name); }
  return { available: view.available, revision: view.revision, packages };
};
export const normalizeRegistries = (raw: unknown): RegistryView => {
  if (!raw || typeof raw !== 'object') reject('plugin-registries-rejected');
  const view = raw as Record<string, unknown>;
  const url = (v: unknown): string | null => (v == null ? null : isStr(v, 300) && /^https?:\/\/\S+$/.test(v) ? v : reject('plugin-registries-rejected'));
  if (!Array.isArray(view.fallbackRegistries)) reject('plugin-registries-rejected');
  return { registry: url(view.registry), fallbackRegistries: view.fallbackRegistries.map(url), resolved: url(view.resolved) };
};
export const normalizeSubject = (raw: unknown): SubjectView => {
  if (!raw || typeof raw !== 'object') reject('plugin-inspect-rejected');
  const view = raw as Record<string, unknown>;
  if (view.status !== 'accepted' && view.status !== 'refused') reject('plugin-inspect-rejected');
  if (view.status === 'refused') {
    if (!isStr(view.problem, 64)) reject('plugin-inspect-rejected');
    return { status: 'refused', problem: view.problem, reason: optStr(view.reason, 2000) };
  }
  if (!isStr(view.name, 214)) reject('plugin-inspect-rejected');
  const host = optStr(view.host, 300);
  return { status: 'accepted', name: view.name, host, version: optStr(view.version, 64), description: optStr(view.description, 2000) };
};
export const normalizeProgress = (raw: unknown): InstallProgressView => {
  if (!raw || typeof raw !== 'object') reject('plugin-install-progress-rejected');
  const view = raw as Record<string, unknown>;
  if (!isStr(view.requestId, 128)) reject('plugin-install-progress-rejected');
  if (!isStr(view.phase, 32) || !['checking', 'installing', 'applying', 'cancelled', 'done', 'failed', 'unknown'].includes(view.phase)) reject('plugin-install-progress-rejected');
  const runs = view.runs == null ? [] : Array.isArray(view.runs) ? view.runs.map((r: any) => {
    if (!r || typeof r !== 'object' || !isStr(r.jobId, 128) || !isStr(r.command, 4000) || !isStr(r.cwd, 4000) || !isStr(r.output, 262144)) reject('plugin-install-progress-rejected');
    if (r.exitCode != null && !isInt(r.exitCode) && r.exitCode !== null) reject('plugin-install-progress-rejected');
    return { jobId: r.jobId, command: r.command, cwd: r.cwd, output: r.output, exitCode: r.exitCode ?? undefined };
  }) : reject('plugin-install-progress-rejected');
  const registries = view.registries == null ? null : Array.isArray(view.registries) ? view.registries.map((u: unknown) => isStr(u, 300) ? u : reject('plugin-install-progress-rejected')) : reject('plugin-install-progress-rejected');
  const failure = view.failure == null ? null : (() => {
    const f = view.failure as Record<string, unknown>;
    if (typeof f !== 'object') reject('plugin-install-progress-rejected');
    if (f.failedAt != null && f.failedAt !== 'registry' && f.failedAt !== 'spec-host') reject('plugin-install-progress-rejected');
    const incompatible = f.incompatible == null ? null : Array.isArray(f.incompatible) ? f.incompatible.map((p: any) => {
      if (!p || typeof p !== 'object' || !isStr(p.name, 214) || !isStr(p.version, 64) || !isStr(p.runtimeVersion, 64) || !p.peers || typeof p.peers !== 'object') reject('plugin-install-progress-rejected');
      const peers: Record<string, string> = {};
      for (const [k, v] of Object.entries(p.peers)) peers[k] = isStr(v, 300) ? v : reject('plugin-install-progress-rejected');
      return { name: p.name, version: p.version, runtimeVersion: p.runtimeVersion, peers };
    }) : reject('plugin-install-progress-rejected');
    return {
      code: optStr(f.code, 64), reason: optStr(f.reason, 2000), kind: optStr(f.kind, 64), failedAt: f.failedAt ?? undefined,
      pendingBuilds: f.pendingBuilds == null ? undefined : Array.isArray(f.pendingBuilds) ? f.pendingBuilds.map((b: unknown) => isStr(b, 214) ? b : reject('plugin-install-progress-rejected')) : reject('plugin-install-progress-rejected'),
      incompatible: incompatible ?? undefined,
    };
  })();
  const subject = view.subject == null ? null : (() => {
    const s = view.subject as Record<string, unknown>;
    if (typeof s !== 'object') reject('plugin-install-progress-rejected');
    return { name: optStr(s.name, 214), host: optStr(s.host, 300), version: optStr(s.version, 64), description: optStr(s.description, 2000) };
  })();
  return {
    requestId: view.requestId, phase: view.phase as InstallProgressView['phase'], subject,
    runs, registries, total: view.total == null ? null : isInt(view.total) ? view.total : reject('plugin-install-progress-rejected'),
    failure, installed: optStr(view.installed, 214), restartRequired: optBool(view.restartRequired),
    approvedBuilds: view.approvedBuilds == null ? undefined : Array.isArray(view.approvedBuilds) ? view.approvedBuilds.map((b: unknown) => isStr(b, 214) ? b : reject('plugin-install-progress-rejected')) : reject('plugin-install-progress-rejected'),
  };
};

const registryLabel = (url: string): string => (url ? '来自 ' + url.replace(/^https?:\/\//, '').replace(/\/+$/, '') : '默认安装源');
const mapRegistries = (view: RegistryView): { name: string; url: string }[] => {
  const out: { name: string; url: string }[] = [], seen = new Set<string>();
  for (const url of [view.registry ?? '', ...view.fallbackRegistries]) {
    if (seen.has(url)) continue;
    seen.add(url);
    out.push({ name: registryLabel(url), url });
  }
  return out;
};
const PENDING: ReadonlySet<string> = new Set(['checking', 'starting', 'running', 'cancelling', 'applying', 'unconfirmed']);
const HOST_PHASE: Readonly<Record<string, Phase>> = {
  checking: 'checking', installing: 'running', applying: 'applying', cancelled: 'idle', done: 'done', failed: 'failed', unknown: 'unknown',
};
const mapPackage = (p: InventoryPackage): Package => ({
  name: p.name, title: p.title || p.name.replace(/^@[^/]+\//, ''), description: p.description ?? undefined,
  descriptionZhCN: p.descriptionZhCN ?? undefined, version: p.version ?? undefined, installed: p.installed, enabled: p.enabled,
  optional: p.optional, readOnlyReason: p.readOnlyReason ?? undefined, error: p.error ? p.error.reason || p.error.code : undefined,
  rows: p.rows.map((r): Row => ({
    id: r.rowId, moduleName: r.moduleName ?? undefined, entryId: r.entryId ?? undefined, name: r.title || r.rowId,
    description: r.description ?? undefined, descriptionZhCN: r.descriptionZhCN ?? undefined, enabled: r.enabled,
    phase: r.phase, readOnlyReason: r.readOnlyReason ?? undefined,
  })),
});

export const createPluginManagerAdapter = (faces: PluginFaces, unwired: string[] = []): Adapter => {
  let view: InventoryView | null = null, revision = -1, available = false, dirty = true, disposed = false;
  let inFlight: Promise<void> | undefined, rerun = false;
  let install: Install = { open: false, spec: '', phase: 'idle', registry: '', registries: [], runs: [] };
  let requestId = '', confirm = '', notice = '', highlight = '', polls = 0, acknowledged = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const busy = new Set<string>(), listeners = new Set<() => void>();
  // dispose 只是「当前视图走了」：停表、清订阅。这个实例由 app 单例持有，
  // 标签页关掉再打开会被同一个实例再次挂载，所以下一次 read/dispatch 要能重新武装——
  // 否则重开标签页后页面会永远停在「无法读取全部插件」。
  const arm = (): void => { disposed = false; };
  const missing = (capability: string): never => reject('plugin-channel-missing:' + capability);
  const notify = (): void => { for (const fn of [...listeners]) { try { fn(); } catch { /* 订阅方异常不能拖死轮询 */ } } };
  const patch = (next: Partial<Install>): void => { install = { ...install, ...next }; };
  const idle = (keep?: { spec?: string; registry?: string; registries?: { name: string; url: string }[] }): Install => ({
    open: false, spec: keep?.spec ?? '', phase: 'idle', registry: keep?.registry ?? '', registries: keep?.registries ?? [], runs: [],
  });
  const stopPolling = (): void => { if (timer) { clearTimeout(timer); timer = undefined; } };
  const snapshot = (): Snapshot => ({
    available, packages: view ? view.packages.map(mapPackage) : [], busy: [...busy], install: { ...install, runs: install.runs.map(r => ({ ...r })) },
    notice: notice || undefined, confirm: confirm || undefined, highlight: highlight || undefined, unwired: unwired.slice(),
  });

  const readInventory = async (): Promise<void> => {
    const next = normalizeInventory(await faces.describe());
    view = next; revision = next.revision; available = next.available;
    if (!next.available) { stopPolling(); patch({ phase: 'idle', runs: [] }); requestId = ''; }
  };
  const load = (): Promise<void> => {
    if (inFlight) { rerun = true; return inFlight; }
    const run = (async () => { do { rerun = false; await readInventory(); } while (rerun && !disposed); })();
    inFlight = run;
    void run.finally(() => { if (inFlight === run) inFlight = undefined; });
    return run;
  };
  const read = async (): Promise<Snapshot> => {
    arm();
    if (dirty || !view) { dirty = false; await load(); }
    return snapshot();
  };
  const settle = (next: InstallProgressView): void => {
    const phase = HOST_PHASE[next.phase];
    patch({
      phase, runs: next.runs ?? [], attempts: next.registries && next.registries.length ? { registries: next.registries, total: next.total ?? next.registries.length } : undefined,
      failure: next.failure ? { reason: next.failure.reason || REASONS[next.failure.code || ''] || '插件安装失败，原因见安装详情', code: next.failure.code ?? undefined, kind: next.failure.kind ?? undefined, failedAt: next.failure.failedAt, pendingBuilds: next.failure.pendingBuilds, incompatible: next.failure.incompatible } : undefined,
      installed: next.installed ?? undefined, restartRequired: next.restartRequired ?? undefined, approvedBuilds: next.approvedBuilds ?? undefined,
      subject: next.subject ? { name: next.subject.name || install.subject?.name || '', description: next.subject.description ?? undefined, version: next.subject.version ?? undefined, host: next.subject.host ?? undefined } : undefined,
    });
    if (next.phase === 'cancelled') { const keep = install.spec; install = idle({ spec: keep, registry: install.registry, registries: install.registries }); notice = '安装已取消。'; }
    if (next.phase === 'unknown') notice = '后端当前没有这个安装任务。';
  };
  const tick = async (): Promise<void> => {
    if (disposed || !requestId) return;
    polls += 1;
    let next: InstallProgressView;
    try { next = normalizeProgress(await faces.installProgress(requestId)); }
    catch (e) {
      // 传输失败不等于安装失败：只能标「未确认」，等核对，不替宿主下结论
      stopPolling(); patch({ phase: 'unconfirmed', failure: { reason: failureOf(e).reason, uncertainty: 'result' } }); notify(); return;
    }
    if (next.requestId !== requestId) { stopPolling(); patch({ phase: 'unconfirmed', failure: { reason: '后端回报的安装任务与当前对话框不一致。', uncertainty: 'result' } }); notify(); return; }
    settle(next); notify();
    if (PENDING.has(install.phase) && polls < MAX_POLLS) { timer = setTimeout(() => void tick(), POLL_MS); return; }
    stopPolling();
    if (polls >= MAX_POLLS) { patch({ phase: 'unconfirmed', failure: { reason: '安装轮询超过上限，结果尚未确认。', uncertainty: 'result' } }); notify(); return; }
    requestId = '';
    dirty = true;
    try { await load(); } catch { /* 清单读失败由页面重试路径处理 */ }
    if (install.installed && install.phase === 'done') highlight = install.installed;
    notify();
  };
  const startPolling = (): void => { stopPolling(); polls = 0; timer = setTimeout(() => void tick(), POLL_MS); };
  const startInstall = async (spec: string, approvedBuilds: string[]): Promise<void> => {
    const id = newRequestId();
    // 只清这一趟的运行痕迹：检查得到的主题要留在「正在启动安装」那一屏上，
    // 清掉它会让用户在等首帧进度时看不到自己到底在装什么。
    patch({ phase: 'starting', runs: [], attempts: undefined, failure: undefined, installed: undefined, restartRequired: false, approvedBuilds: approvedBuilds.slice() });
    requestId = id; acknowledged = false;
    try { await faces.installStart({ spec, registry: install.registry, requestId: id, approvedBuilds: approvedBuilds.slice() }); }
    catch (e) {
      // 启动帧没发出去：请求是否被接收尚未确认，交给核对，不宣称失败
      stopPolling(); patch({ phase: 'unconfirmed', failure: { reason: failureOf(e).reason, uncertainty: 'acceptance' } }); notify(); return;
    }
    // 启动帧拿到应答即视为宿主已接收这个请求：此后的取消等的是「停没停」，不是「收没收到」
    acknowledged = true;
    startPolling();
  };
  const readRegistries = async (): Promise<void> => {
    try { install = { ...install, registries: mapRegistries(normalizeRegistries(await faces.registries())) }; }
    catch { /* 安装源读不到不致命：选择器退化成「默认安装源」，不伪造源列表 */ }
  };
  const setEnabled = async (name: string, enabled: boolean): Promise<void> => {
    if (unwired.includes('enable')) missing('enable');
    if (!isStr(name, 214) || !isBool(enabled)) reject('plugin-rejected');
    busy.add(name);
    try {
      await faces.setEnabled(name, enabled, revision);
      dirty = true;
      if (revision >= 0) revision += 1;
    } catch (e) { dirty = true; await load().catch(() => undefined); throw Object.assign(new Error(failureOf(e).reason), { code: failureOf(e).code }); }
    finally { busy.delete(name); }
  };

  const dispatch = async (command: Command): Promise<void> => {
    arm();
    switch (command.kind) {
      case 'refresh': dirty = true; await load(); return;
      case 'edit-spec': patch({ spec: command.text, inputError: undefined }); return;
      case 'choose-registry': patch({ registry: command.url }); return;
      case 'open-install': {
        if (requestId) { patch({ open: true }); return; }
        // 新对话框从上次用过的安装源起步；spec 保留，便于「返回编辑」与重跑同一条规格
        install = idle({ spec: install.spec, registry: install.registry, registries: install.registries });
        patch({ open: true });
        await readRegistries();
        return;
      }
      case 'close-install': {
        const pending = requestId !== '' && PENDING.has(install.phase) && install.phase !== 'checking';
        patch({ open: false });
        // 关窗不等于放过在途任务：pending 相位下关窗即请求取消（与「取消安装并关闭」的措辞一致）。
        // 取消请求本身失败不了关窗，相位保持不变，留给「核对安装状态」。
        if (pending) void faces.installCancel(requestId).then(() => { patch({ phase: 'cancelling' }); notify(); }, () => notify());
        return;
      }
      case 'dismiss-notice': notice = ''; return;
      case 'cancel-confirm': confirm = ''; return;
      case 'change-registry': install = idle({ spec: install.spec, registry: install.registry, registries: install.registries }); return;
      case 'use-github-mirror': {
        const mirror = install.registries.find(r => /npmmirror\.com/.test(r.url));
        install = idle({ spec: '', registry: mirror ? mirror.url : install.registry, registries: install.registries });
        return;
      }
      case 'edit-install': patch({ phase: 'idle', inputError: undefined, failure: undefined }); return;
      case 'run-install': {
        if (unwired.includes('install')) missing('install');
        const spec = install.spec.trim();
        if (!spec) { patch({ phase: 'idle', inputError: '请先填写插件包名、Git 仓库地址或本地目录路径。' }); return; }
        const listed = (view?.packages || []).find(p => p.name === spec);
        if (listed) { patch({ phase: 'idle', inputError: listed.installed ? '这个插件已经安装。' : '这个插件由当前配置提供，不能重复安装。' }); return; }
        patch({ phase: 'checking', inputError: undefined, subject: undefined, runs: [], attempts: undefined, failure: undefined, installed: undefined, restartRequired: false, approvedBuilds: [] });
        let inspected: SubjectView;
        try { inspected = normalizeSubject(await faces.inspect(spec, install.registry)); }
        catch (e) { patch({ phase: 'idle', inputError: failureOf(e).reason }); return; }
        if (inspected.status === 'refused') { patch({ phase: 'idle', inputError: REFUSAL_PROBLEMS[inspected.problem || ''] || inspected.reason || '无法识别这个插件，请核对包名或地址。' }); return; }
        patch({ subject: { name: inspected.name || spec, description: inspected.description ?? undefined, version: inspected.version ?? undefined, host: inspected.host ?? undefined } });
        await startInstall(spec, []);
        return;
      }
      case 'approve-builds': {
        if (unwired.includes('install')) missing('install');
        const builds = install.failure?.pendingBuilds;
        if (install.phase !== 'failed' || !builds || !builds.length) reject('plugin-rejected');
        await startInstall(install.spec, builds);
        return;
      }
      case 'cancel-install': {
        if (!requestId) { patch({ phase: 'idle' }); return; }
        try { await faces.installCancel(requestId); }
        catch (e) { stopPolling(); patch({ phase: install.phase === 'applying' ? 'applying' : 'unconfirmed', failure: { reason: failureOf(e).reason, uncertainty: acknowledged ? 'cancellation' : 'acceptance' } }); return; }
        patch({ phase: 'cancelling' });
        return;
      }
      case 'reconcile-install': {
        if (!requestId) { patch({ phase: 'unknown', failure: undefined }); return; }
        await tick();
        return;
      }
      case 'enable-installed': {
        const name = install.installed;
        if (!name) return;
        patch({ enabling: true });
        try { await setEnabled(name, true); } finally { patch({ enabling: false }); }
        highlight = name;
        return;
      }
      case 'enable-package': await setEnabled(command.name, command.enabled); return;
      case 'enable-row': {
        if (unwired.includes('enable')) missing('enable');
        if (!isStr(command.entryId, 214) || !isBool(command.enabled)) reject('plugin-rejected');
        busy.add(command.entryId);
        try {
          await faces.setRowEnabled(command.entryId, command.enabled, revision);
          dirty = true;
          if (revision >= 0) revision += 1;
        } catch (e) { dirty = true; await load().catch(() => undefined); throw Object.assign(new Error(failureOf(e).reason), { code: failureOf(e).code }); }
        finally { busy.delete(command.entryId); }
        return;
      }
      case 'uninstall': confirm = isStr(command.name, 214) ? command.name : reject('plugin-rejected'); return;
      case 'confirm-uninstall': {
        if (unwired.includes('uninstall')) missing('uninstall');
        const name = confirm || (isStr(command.name, 214) ? command.name : reject('plugin-rejected'));
        busy.add(name);
        try {
          await faces.remove(name, revision);
          dirty = true;
          if (revision >= 0) revision += 1;
        } catch (e) { dirty = true; await load().catch(() => undefined); throw Object.assign(new Error(failureOf(e).reason), { code: failureOf(e).code }); }
        finally { busy.delete(name); }
        confirm = ''; highlight = '';
        return;
      }
      default: reject('plugin-command-unknown');
    }
  };

  return {
    read,
    dispatch,
    subscribe(invalidate: () => void) { listeners.add(invalidate); return () => { listeners.delete(invalidate); }; },
    dispose() { disposed = true; stopPolling(); listeners.clear(); },
  } as Adapter & { dispose(): void };
};

// 出厂绑定：只认 preload 顶层 key 里真实存在的函数；缺通道时整体返回 null，
// 页面据此保持 unconnected，而不是拿一个只会报错的适配器假装已接后端。
export const createSacodePluginManagerAdapter = (api: any): SacodePluginManager | null => {
  if (!api || typeof api.pluginsDescribe !== 'function') return null;
  const faces: PluginFaces = {
    describe: () => api.pluginsDescribe(),
    setEnabled: (name, enabled, expectedRevision) => api.pluginsSetEnabled(name, enabled, expectedRevision),
    setRowEnabled: (entryId, enabled, expectedRevision) => api.pluginsSetRowEnabled(entryId, enabled, expectedRevision),
    remove: (name, expectedRevision) => api.pluginsUninstall(name, expectedRevision),
    registries: () => api.pluginsRegistries(),
    inspect: (spec, registry) => api.pluginsInspect(spec, registry),
    installStart: (request) => api.pluginsInstall(request),
    installProgress: (requestId) => api.pluginsInstallPoll(requestId),
    installCancel: (requestId) => api.pluginsInstallCancel(requestId),
  };
  const unwired: string[] = [];
  if (typeof api.pluginsSetEnabled !== 'function' || typeof api.pluginsSetRowEnabled !== 'function') unwired.push('enable');
  if (typeof api.pluginsUninstall !== 'function') unwired.push('uninstall');
  if (typeof api.pluginsInspect !== 'function' || typeof api.pluginsInstall !== 'function' || typeof api.pluginsInstallPoll !== 'function') unwired.push('install');
  return { adapter: createPluginManagerAdapter(faces, unwired), unwired };
};
