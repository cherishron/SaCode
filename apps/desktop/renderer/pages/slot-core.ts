// 冻结 ui-slots 的普通槽位生命周期；此纯注册层不读取会话，也不发业务事件。
export type SlotKind = 'single' | 'list' | 'keyed' | 'chain';
export type SlotScope = 'root' | 'session-maybe' | 'session';
export type SlotSpec = Readonly<{ kind: SlotKind; scope: SlotScope }>;
export type OwnerProps = Readonly<Record<string, unknown>>;
export type EntryOptions = Readonly<{
  name: string; id?: string; key?: string; order?: number; priority?: number;
  label?: string | (() => string); children?: Readonly<Record<string, SlotSpec>>;
  select?: (owner: OwnerProps) => unknown | null;
}>;
export type Entry = Readonly<{ component: unknown; options: EntryOptions; registrant: string; sequence: number }>;
export type Registration = Readonly<{ entry: Entry; dispose: () => void }>;
type EntryState = { registration: Registration; active: boolean; children: string[] };
type RecordState = { spec?: SlotSpec; declarer?: Entry; epoch: number; version: number; entries: readonly Entry[] };
export type Declaration = Readonly<{ spec?: SlotSpec; epoch: number }>;

export class SlotCore {
  private records = new Map<string, RecordState>();
  private states = new WeakMap<Entry, EntryState>();
  private listeners = new Map<string, Set<() => void>>();
  private declarationListeners = new Map<string, Set<() => void>>();
  private mutations = new Set<() => void>();
  private dirty = new Set<string>();
  private queued = false;
  private sequence = 0;
  private revision = 0;
  private declarationSnapshots = new Map<string, Declaration>();
  constructor() {
    this.records.set('root', { spec: Object.freeze({ kind: 'single', scope: 'root' }), epoch: 1, version: 0, entries: Object.freeze([]) });
  }
  private record(key: string): RecordState {
    let record = this.records.get(key);
    if (!record) { record = { epoch: 0, version: 0, entries: Object.freeze([]) }; this.records.set(key, record); }
    return record;
  }
  private live(entry: Entry): EntryState {
    const state = this.states.get(entry);
    if (!state?.active) throw Error('slot-stale-registration');
    return state;
  }
  private changed(key: string): void {
    this.record(key).version++;
    this.revision++;
    this.dirty.add(key);
    // 同步观察者读到的状态必须已完成本次变更。
    for (const listener of [...this.mutations]) listener();
    if (this.queued) return;
    this.queued = true;
    queueMicrotask(() => {
      this.queued = false;
      const keys = [...this.dirty]; this.dirty.clear();
      for (const key of keys) for (const listener of [...(this.listeners.get(key) ?? [])]) listener();
    });
  }
  private declarationChanged(key: string): void {
    for (const listener of [...(this.declarationListeners.get(key) ?? [])]) listener();
  }
  getRevision(): number { return this.revision; }
  declaration(key: string): Declaration {
    const record = this.record(key);
    let snapshot = this.declarationSnapshots.get(key);
    if (!snapshot || snapshot.epoch !== record.epoch) {
      snapshot = Object.freeze({ spec: record.spec, epoch: record.epoch }); this.declarationSnapshots.set(key, snapshot);
    }
    return snapshot;
  }
  subscribe(key: string, listener: () => void): () => void {
    return this.listen(this.listeners, key, listener);
  }
  subscribeDeclaration(key: string, listener: () => void): () => void {
    return this.listen(this.declarationListeners, key, listener);
  }
  subscribeMutations(listener: () => void): () => void {
    this.mutations.add(listener); return () => { this.mutations.delete(listener); };
  }
  private listen(table: Map<string, Set<() => void>>, key: string, listener: () => void): () => void {
    let set = table.get(key); if (!set) { set = new Set(); table.set(key, set); }
    set.add(listener); const target = set;
    return () => { target.delete(listener); if (!target.size) table.delete(key); };
  }
  register(options: EntryOptions, component: unknown, registrant: string): Registration {
    const record = this.record(options.name), spec = record.spec;
    if (!spec) throw Error('slot-undeclared:' + options.name);
    const priority = options.priority ?? 0, order = options.order ?? 0;
    if (!Number.isFinite(priority) || !Number.isFinite(order)) throw Error('slot-invalid-rank');
    if (spec.kind === 'list' && typeof options.id !== 'string') throw Error('slot-list-needs-id');
    if (spec.kind === 'keyed' && typeof options.key !== 'string') throw Error('slot-keyed-needs-key');
    if (spec.kind === 'chain' && typeof options.select !== 'function') throw Error('slot-chain-needs-select');
    if (spec.kind !== 'chain' && options.select !== undefined) throw Error('slot-unexpected-select');
    if (record.entries.some(entry => (entry.options.priority ?? 0) === priority &&
      (spec.kind === 'single' || spec.kind === 'list' && entry.options.id === options.id || spec.kind === 'keyed' && entry.options.key === options.key))) {
      throw Error('slot-occupancy-conflict:' + options.name);
    }
    const children: Record<string, SlotSpec> = Object.create(null);
    for (const [key, child] of Object.entries(options.children ?? {})) {
      if (!key || this.record(key).spec) throw Error('slot-declaration-conflict:' + key);
      if (!['single', 'list', 'keyed', 'chain'].includes(child.kind) || !['root', 'session-maybe', 'session'].includes(child.scope)) throw Error('slot-invalid-spec');
      children[key] = Object.freeze({ kind: child.kind, scope: child.scope });
    }
    // 注册前完整验证，失败不留下半张 children 声明表。
    const frozenOptions = Object.freeze({ ...options, children: Object.freeze(children) });
    const entry: Entry = Object.freeze({ component, options: frozenOptions, registrant, sequence: ++this.sequence });
    const registration = Object.freeze({ entry, dispose: () => { this.remove(entry); } });
    this.states.set(entry, { registration, active: true, children: Object.keys(children) });
    record.entries = Object.freeze([...record.entries, entry].sort((a, b) =>
      (a.options.priority ?? 0) - (b.options.priority ?? 0) ||
      (spec.kind === 'list' ? (a.options.order ?? 0) - (b.options.order ?? 0) : 0) || a.sequence - b.sequence));
    for (const [key, child] of Object.entries(children)) {
      const childRecord = this.record(key);
      childRecord.spec = child; childRecord.declarer = entry; childRecord.epoch++;
    }
    // 所有兄弟声明同时可见，之后才通知注入者。
    try {
      this.changed(options.name);
      for (const key of Object.keys(children)) this.changed(key);
      for (const key of Object.keys(children)) this.declarationChanged(key);
    } catch (error) {
      // 声明观察者初始化失败时，注册者尚未拿到 disposer，框架负责回滚。
      this.remove(entry); throw error;
    }
    return registration;
  }
  private remove(entry: Entry): void {
    const state = this.states.get(entry);
    if (!state?.active) return;
    state.active = false;
    const record = this.record(entry.options.name);
    record.entries = Object.freeze(record.entries.filter(item => item !== entry));
    const errors: unknown[] = [];
    for (const key of state.children) { try { this.collapse(key, entry); } catch (error) { errors.push(error); } }
    try { this.changed(entry.options.name); } catch (error) { errors.push(error); }
    if (errors.length) throw new AggregateError(errors, 'slot-cleanup-failed');
  }
  private collapse(key: string, declarer: Entry): void {
    const record = this.record(key);
    if (record.declarer !== declarer) return;
    // 先撤销声明，阻止清理回调向即将销毁的槽位追加贡献。
    record.spec = undefined; record.declarer = undefined; record.epoch++;
    const errors: unknown[] = [];
    for (const entry of [...record.entries]) { try { this.remove(entry); } catch (error) { errors.push(error); } }
    try { this.changed(key); } catch (error) { errors.push(error); }
    try { this.declarationChanged(key); } catch (error) { errors.push(error); }
    if (errors.length) throw new AggregateError(errors, 'slot-collapse-failed');
  }
  entries(key: string): readonly Entry[] {
    return this.record(key).entries;
  }
  entriesOfSlot(key: string): readonly Entry[] {
    const record = this.record(key);
    if (!record.spec) return Object.freeze([]);
    const all = record.entries;
    if (record.spec.kind === 'chain') return Object.freeze(all);
    const winners = new Map<string, Entry>();
    for (const entry of all) {
      const cell = record.spec.kind === 'list' ? entry.options.id! : record.spec.kind === 'keyed' ? entry.options.key! : '';
      if (!winners.has(cell)) winners.set(cell, entry);
    }
    return Object.freeze([...winners.values()]);
  }
  assertAuthority(authority: Entry | null, key: string): void {
    if (key === 'root') { if (authority !== null) throw Error('slot-ownership'); }
    else {
      if (!authority) throw Error('slot-ownership');
      this.live(authority);
      if (this.record(key).declarer !== authority) throw Error('slot-ownership');
    }
  }
  dispatch(authority: Entry | null, key: string, owner: OwnerProps, opts: { only?: string; entryKey?: string } = {}): readonly Readonly<{ entry: Entry; matched?: unknown }>[] {
    this.assertAuthority(authority, key);
    const kind = this.record(key).spec?.kind;
    const entries = [...this.entriesOfSlot(key)];
    if (kind === 'list') entries.sort((a, b) => (a.options.order ?? 0) - (b.options.order ?? 0) || a.sequence - b.sequence);
    if (kind === 'chain') {
      for (const entry of entries) {
        const matched = entry.options.select!(owner);
        if (matched !== null) return Object.freeze([Object.freeze({ entry, matched })]);
      }
      return Object.freeze([]);
    }
    return Object.freeze(entries.filter(entry =>
      (kind !== 'list' || opts.only === undefined || entry.options.id === opts.only) &&
      (kind !== 'keyed' || entry.options.key === opts.entryKey)).map(entry => Object.freeze({ entry })));
  }
}

// 客户端插件作用域拥有注册、订阅及 effect；失败或卸载沿同一轴清理。
// 完整 Service/Factory/Store 装配仍由后续框架切片承接，不能冒称 Cordis 源码兼容。
export class ClientScope {
  private cleanups: (() => void)[] = [];
  private closed = false;
  readonly slots: Readonly<{
    register: (options: EntryOptions, component: unknown) => () => void;
    inject: (key: string, setup: (child: ClientScope) => void) => () => void;
    entries: (key: string) => readonly Entry[];
    entriesOfSlot: (key: string) => readonly Entry[];
    subscribe: (key: string, listener: () => void) => () => void;
  }>;
  constructor(readonly name: string, private readonly registry: SlotCore) {
    this.slots = Object.freeze({
      register: (options: EntryOptions, component: unknown) => this.register(options, component).dispose,
      inject: (key: string, setup: (child: ClientScope) => void) => this.inject(key, setup),
      entries: (key: string) => registry.entries(key),
      entriesOfSlot: (key: string) => registry.entriesOfSlot(key),
      subscribe: (key: string, listener: () => void) => this.effect(() => registry.subscribe(key, listener)),
    });
  }
  private check(): void { if (this.closed) throw Error('client-scope-disposed'); }
  effect(setup: () => (() => void)): () => void {
    this.check(); const cleanup = setup();
    let active = true;
    const dispose = () => { if (!active) return; active = false; cleanup(); };
    // setup 期间发生的重入卸载也必须回收刚取得的资源。
    if (this.closed) { dispose(); throw Error('client-scope-disposed'); }
    this.cleanups.push(dispose); return dispose;
  }
  register(options: EntryOptions, component: unknown): Registration {
    this.check();
    const registration = this.registry.register(options, component, this.name);
    if (this.closed) { registration.dispose(); throw Error('client-scope-disposed'); }
    this.cleanups.push(registration.dispose);
    return registration;
  }
  inject(key: string, setup: (child: ClientScope) => void): () => void {
    this.check();
    let child: ClientScope | undefined, epoch = -1;
    const refresh = () => {
      const declaration = this.registry.declaration(key);
      if (declaration.epoch === epoch) return;
      epoch = declaration.epoch; child?.dispose(); child = undefined;
      if (this.closed || !declaration.spec) return;
      const next = new ClientScope(this.name, this.registry); child = next;
      try { setup(next); } catch (error) { next.dispose(); child = undefined; throw error; }
    };
    const stop = this.registry.subscribeDeclaration(key, refresh);
    const dispose = this.effect(() => () => { stop(); child?.dispose(); child = undefined; });
    try { refresh(); } catch (error) { dispose(); throw error; }
    return dispose;
  }
  apply(setup: (scope: ClientScope) => void): void {
    this.check();
    try {
      const result: unknown = setup(this);
      // 客户端模块异步加载尚未接入此同步装配层，不能把 Promise 当成初始化成功。
      if (result !== null && typeof result === 'object' && typeof (result as { then?: unknown }).then === 'function') {
        void Promise.resolve(result).catch(() => {});
        throw Error('client-plugin-async-unsupported');
      }
    } catch (error) { this.dispose(); throw error; }
  }
  dispose(): void {
    if (this.closed) return; this.closed = true;
    const errors: unknown[] = [];
    for (const cleanup of this.cleanups.splice(0).reverse()) { try { cleanup(); } catch (error) { errors.push(error); } }
    if (errors.length) throw new AggregateError(errors, 'client-scope-cleanup-failed');
  }
}
