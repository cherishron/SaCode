// F19 数据导入面板状态机。
// 纯逻辑，不依赖 Vue；对齐 docs/plans/2026-10-20-data-import-design-qoder.md §5.3、§6.3、§9.2。
// 约束：preload.cjs 尚未增加 import* 通道，本文件只定义通道接口；缺失时进入只读占位态，
// 不伪造 Host 计划、不假装文件已读取。真正的校验、指纹、去重与落库都在 Host。

export type ImportKind = 'conversation' | 'knowledge' | 'config';
export type ImportPhase = 'idle' | 'previewing' | 'applying' | 'completed' | 'partial' | 'cancelled' | 'failed';
export type ImportStep = 'source' | 'preview' | 'mapping' | 'decision' | 'progress' | 'report';
export type ImportAction = 'new' | 'duplicate' | 'conflict' | 'invalid' | 'skipped';
export type ImportDecision = 'append' | 'overwrite' | 'skip' | 'dismiss';
export type ImportScope = 'user' | 'project';
export type ImportJobStatus = 'created' | 'running' | 'completed' | 'partial' | 'cancelled' | 'failed' | 'interrupted';

export type ImportSource = {
  id: string;
  displayName: string;
  kinds: ImportKind[];
  formatVersion: string;
  compatibility: string;
  requiresFile: boolean;
  limits: Record<string, number>;
  mapping: string[];
  notes: string[];
};

export type ImportMapping = {
  titleMode?: 'keep' | 'prefix' | 'custom' | 'source' | 'filename';
  displayTitle?: string;
  prefix?: string;
  titlePrefix?: string;
  workspaceMode?: 'none' | 'current';
  updatePolicy?: 'new-only' | 'allow-updates';
  conflictPolicy?: 'skip' | 'new-copy';
  credentialBindings?: Record<string, string>;
};

export type ImportTarget = { scope: ImportScope };

export type ImportSelection = { itemIds: string[] };

export type LocalPreviewIssue = { index: number; code: string; message: string };

export type LocalPreviewItem = {
  candidateId: string;
  index: number;
  displayTitle: string;
  messages: number;
  textBytes: number;
  action?: ImportAction;
  reason?: string;
};

export type LocalPreview = {
  sourceId: string;
  kind: ImportKind;
  summary: { candidates: number; duplicates: number; conflicts: number; issues: number };
  items: LocalPreviewItem[];
  issues: LocalPreviewIssue[];
};

export type ImportPlanCounts = {
  total: number; new: number; duplicate: number; conflict: number; invalid: number; skipped: number;
};

export type ImportPlanItem = {
  itemId: string;
  index: number;
  displayTitle: string;
  action: ImportAction;
  dedupeKey: string;
  detail: { messages?: number; skippedMessages?: number; reason?: string };
};

export type ImportPlan = {
  planHash: string;
  sourceId: string;
  kind: ImportKind;
  target: ImportTarget;
  counts: ImportPlanCounts;
  items: ImportPlanItem[];
  issues: LocalPreviewIssue[];
  requiresConfirmation: boolean;
};

export type ImportJob = {
  jobId: string;
  requestId: string;
  sourceId: string;
  kind: ImportKind | '';
  status: ImportJobStatus;
  counts: { total: number; committed: number; duplicate: number; failed: number; remaining: number };
  current: { itemId: string; displayTitle: string } | null;
  terminal: boolean;
  createdAt: string;
  updatedAt: string;
  planHash: string;
  resumable: boolean;
};

export type ImportReportTarget = { kind: string; id: string };

export type ImportReportItem = {
  itemId: string;
  index: number;
  displayTitle: string;
  action: ImportAction | '';
  status: string;
  code: string;
  target: ImportReportTarget | null;
};

export type ImportReport = {
  format: string;
  jobId: string;
  status: ImportJobStatus;
  counts: { total: number; committed: number; duplicate: number; failed: number; skipped: number; invalid: number };
  items: ImportReportItem[];
  issues: LocalPreviewIssue[];
  nextOffset: number | null;
  complete: boolean;
};

export type ReportSummary = { applied: number; skipped: number; corrupted: number; warnings: number };

// 通道函数（由 preload.cjs 后续提供；命名以设计 §9.10 为准）。
export type ImportChannels = {
  sources: () => Promise<unknown>;
  pickFile: (sourceId: string) => Promise<unknown>;
  preview: (token: string, mapping: ImportMapping, target: ImportTarget) => Promise<unknown>;
  apply: (
    token: string,
    planHash: string,
    requestId: string,
    selection: ImportSelection,
    mapping: ImportMapping,
    target: ImportTarget,
  ) => Promise<unknown>;
  poll: (jobId: string) => Promise<unknown>;
  cancel: (jobId: string) => Promise<unknown>;
  resume: (jobId: string) => Promise<unknown>;
  report: (jobId: string, offset: number, limit: number) => Promise<unknown>;
  jobs: (limit: number) => Promise<unknown>;
  discard: (token: string) => Promise<unknown>;
};

export type ImportTimers = {
  set: (callback: () => void, delayMs: number) => unknown;
  clear: (handle: unknown) => void;
};

export type ImportPanelOptions = {
  missingChannels?: string[];
  workspaceAvailable?: () => boolean;
  timers?: ImportTimers;
  initialPollDelayMs?: number;
  maxPollDelayMs?: number;
  maxPollFailures?: number;
  requestId?: () => string;
};

export type ImportPanelState = {
  phase: ImportPhase;
  step: ImportStep;
  busy: boolean;
  error: string;
  errorCode: string;
  notice: string;
  channelsWired: boolean;
  preloadMissing: string[];
  sources: ImportSource[];
  sourcesLoaded: boolean;
  sourcesLoading: boolean;
  sourcesError: string;
  sourceId: string;
  kind: ImportKind | '';
  token: string;
  localPreview: LocalPreview | null;
  plan: ImportPlan | null;
  planStale: boolean;
  mapping: ImportMapping;
  target: ImportTarget;
  decisions: Record<string, ImportDecision>;
  job: ImportJob | null;
  report: ImportReport | null;
  reportLoading: boolean;
  polling: boolean;
  pollFailures: number;
  active: boolean;
  interrupted: ImportJob[];
};

export const ALL_IMPORT_CHANNELS = [
  'importSources',
  'importPickFile',
  'importPreview',
  'importApply',
  'importPoll',
  'importCancel',
  'importResume',
  'importReport',
  'importJobs',
  'importDiscard',
] as const;

export const DESIGN_SOURCES: ImportSource[] = [
  {
    id: 'chatgpt-export',
    displayName: 'ChatGPT 导出 JSON',
    kinds: ['conversation'],
    formatVersion: 'synthetic-1',
    compatibility: 'synthetic-only',
    requiresFile: true,
    limits: { bytes: 16777216, items: 2000, nodes: 20000, messages: 10000, textBytes: 1048576 },
    mapping: ['title'],
    notes: ['仅支持结构化 JSON 数组；真实导出格式尚未验收', '不支持分享网页或 ZIP'],
  },
  {
    id: 'sacode-migrate',
    displayName: 'SaCode 迁移包',
    kinds: ['config'],
    formatVersion: 'sacode-migrate/1',
    compatibility: 'self',
    requiresFile: true,
    limits: { bytes: 8388608 },
    mapping: ['updatePolicy'],
    notes: ['仅接受 kind=config；secret-bundle 整包拒绝', '不读取密钥值；导入后需配置凭据并启用'],
  },
  {
    id: 'text-file',
    displayName: 'Markdown/TXT 知识文件',
    kinds: ['knowledge'],
    formatVersion: 'text',
    compatibility: 'text-only',
    requiresFile: true,
    limits: { bytes: 65536, items: 200 },
    mapping: ['title', 'scope'],
    notes: ['文本文件，不解析 HTML/脚本', '按一次快照批量写入；单条非法不拖垮整批'],
  },
];

export const IMPORT_ERROR_TEXT: Record<string, string> = {
  'import-input-limit': '文件或条目超过限额；请拆分后再导入。',
  'import-invalid-candidate': '有条目内容不完整，已跳过；其余条目仍可导入。',
  'import-secret-refused': '该包含有密钥/凭据，已拒绝导入。请改用不含密钥的配置包。',
  'import-plan-stale': '导入计划已变化（目标被修改）；已重新读取，请再次确认。',
  'import-revision-conflict': '目标配置已被其他窗口修改；本次未写入，请重新预览。',
  'import-job-busy': '已有导入作业在进行；请先完成或取消。',
  'import-session-changed': '会话已切换；请回到发起导入的会话继续。',
  'import-persistence-failed': '写入未完成；已提交条目保留，请查看报告后重试。',
  'turn-in-flight': '当前有任务在运行；请等待本轮结束后再导入。',
  'import-in-flight': '导入正在进行；请完成或取消后再开始新任务。',
  'import-unsupported-source': '该来源或数据类型尚未接入；请选择已登记的来源。',
  'import-request-conflict': '同一请求已用于另一个导入计划；请重新预览后再确认。',
  'import-invalid-plan': 'Host 返回的导入计划不完整；请重新预览。',
  'import-bad-args': '导入参数不完整或格式错误；请重新选择文件。',
};

export const PHASE_LABEL: Record<ImportPhase, string> = {
  idle: '待开始',
  previewing: '预览中',
  applying: '导入中',
  completed: '已完成',
  partial: '部分完成',
  cancelled: '已取消',
  failed: '失败',
};

export const STEP_LABEL: Record<ImportStep, string> = {
  source: '选择来源',
  preview: '本地预览',
  mapping: '字段映射',
  decision: '确认条目',
  progress: '导入进度',
  report: '导入报告',
};

export const STEP_ORDER: ImportStep[] = ['source', 'preview', 'mapping', 'decision', 'progress', 'report'];

export const ACTION_LABEL: Record<ImportAction, string> = {
  new: '新增',
  duplicate: '重复',
  conflict: '冲突',
  invalid: '无效',
  skipped: '跳过',
};

export const DECISION_LABEL: Record<ImportDecision, string> = {
  append: '追加新',
  overwrite: '覆盖更新',
  skip: '跳过',
  dismiss: '取消冲突',
};

export const JOB_STATUS_LABEL: Record<ImportJobStatus, string> = {
  created: '已创建',
  running: '进行中',
  completed: '已完成',
  partial: '部分完成',
  cancelled: '已取消',
  failed: '失败',
  interrupted: '已中断',
};

export function kindLabel(kind: ImportKind | ''): string {
  return kind === 'conversation' ? '会话' : kind === 'knowledge' ? '知识' : kind === 'config' ? '配置' : '未指定';
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function num(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : fallback;
}

function isKind(value: unknown): value is ImportKind {
  return value === 'conversation' || value === 'knowledge' || value === 'config';
}

function isAction(value: unknown): value is ImportAction {
  return value === 'new' || value === 'duplicate' || value === 'conflict' || value === 'invalid' || value === 'skipped';
}

function isJobStatus(value: unknown): value is ImportJobStatus {
  return value === 'created' || value === 'running' || value === 'completed' || value === 'partial'
    || value === 'cancelled' || value === 'failed' || value === 'interrupted';
}

export function isTerminalStatus(status: ImportJobStatus | ''): boolean {
  return status === 'completed' || status === 'partial' || status === 'cancelled' || status === 'failed' || status === 'interrupted';
}

export function phaseForJob(status: ImportJobStatus): ImportPhase {
  if (status === 'completed') return 'completed';
  if (status === 'partial') return 'partial';
  if (status === 'cancelled') return 'cancelled';
  if (status === 'failed' || status === 'interrupted') return 'failed';
  return 'applying';
}

export function jobNotice(status: ImportJobStatus): string {
  if (status === 'completed') return '导入完成；可查看逐项报告。';
  if (status === 'partial') return '部分条目写入成功，部分失败或未执行；已提交条目保留。';
  if (status === 'cancelled') return '已取消；已提交条目保留，未开始条目未写入。';
  if (status === 'failed') return '导入失败；未完成项可按报告重试。';
  if (status === 'interrupted') return '作业已中断；可继续导入，不会自动执行。';
  return '';
}

export function channelsMissingText(missing: string[]): string {
  const names = missing.length ? missing.join('、') : '全部 import* 通道';
  return `导入通道未接通：preload.cjs 尚未添加 import* IPC（缺少 ${names}）。组件已就绪，等待通道接线。`;
}

export function errorText(code: string): string {
  if (code && IMPORT_ERROR_TEXT[code]) return IMPORT_ERROR_TEXT[code];
  return `导入未完成（原因码：${code || 'unknown'}）。`;
}

function knownCodeIn(text: string): string {
  for (const code of Object.keys(IMPORT_ERROR_TEXT)) {
    if (text.includes(code)) return code;
  }
  return '';
}

function explainError(error: unknown): { code: string; text: string } {
  const record = asRecord(error);
  const raw = String(record?.message ?? error ?? '').trim();
  const recCode = str(record?.code);
  const match = /^([a-z][a-z0-9-]*)\s*:\s*([\s\S]*)$/i.exec(raw);
  const code = recCode || (match ? match[1] : '') || knownCodeIn(raw);
  if (code && IMPORT_ERROR_TEXT[code]) return { code, text: IMPORT_ERROR_TEXT[code] };
  // 不把原始 JSON-RPC 帧贴到界面；普通中文说明可以保留并截断。
  const friendly = raw && !/^[{[]/.test(raw) ? (raw.length > 300 ? `${raw.slice(0, 299)}…` : raw) : '';
  return { code: code || 'import-unknown', text: friendly || errorText(code || 'import-unknown') };
}

// preload 面按设计的 import* 命名解析；缺一个就整体视为未接通，避免半接线状态。
export function resolveImportChannels(host?: unknown): { channels: ImportChannels | null; missing: string[] } {
  const bridge = asRecord(host ?? (globalThis as Record<string, unknown>).sacode);
  const missing: string[] = [];
  const read = (name: string) => {
    const fn = bridge?.[name];
    if (typeof fn !== 'function') {
      missing.push(name);
      return null;
    }
    return (...args: unknown[]) => Promise.resolve(fn.apply(bridge ?? undefined, args));
  };
  const sources = read('importSources');
  const pickFile = read('importPickFile');
  const preview = read('importPreview');
  const apply = read('importApply');
  const poll = read('importPoll');
  const cancel = read('importCancel');
  const resume = read('importResume');
  const report = read('importReport');
  const jobs = read('importJobs');
  const discard = read('importDiscard');
  if (missing.length > 0 || !sources || !pickFile || !preview || !apply || !poll || !cancel || !resume || !report || !jobs || !discard) {
    return { channels: null, missing };
  }
  return { channels: { sources, pickFile, preview, apply, poll, cancel, resume, report, jobs, discard }, missing: [] };
}

export function defaultMapping(kind: ImportKind | ''): ImportMapping {
  if (kind === 'conversation') {
    return { titleMode: 'keep', displayTitle: '', prefix: '', workspaceMode: 'none', conflictPolicy: 'skip' };
  }
  if (kind === 'knowledge') {
    return { titleMode: 'source', titlePrefix: '', conflictPolicy: 'skip' };
  }
  if (kind === 'config') {
    return { updatePolicy: 'new-only', conflictPolicy: 'skip', credentialBindings: {} };
  }
  return {};
}

export function allowedDecisions(action: ImportAction, kind: ImportKind | ''): ImportDecision[] {
  if (action === 'new') return ['append', 'skip'];
  if (action === 'conflict') {
    return kind === 'config' ? ['overwrite', 'skip', 'dismiss'] : ['append', 'skip', 'dismiss'];
  }
  return ['skip'];
}

export function decisionFor(state: ImportPanelState, item: ImportPlanItem): ImportDecision {
  const explicit = state.decisions[item.itemId];
  if (explicit && allowedDecisions(item.action, state.kind).includes(explicit)) return explicit;
  return item.action === 'new' ? 'append' : 'skip';
}

export function isItemSelected(state: ImportPanelState, item: ImportPlanItem): boolean {
  const decision = decisionFor(state, item);
  return decision === 'append' || decision === 'overwrite';
}

export function selectedItemIds(state: ImportPanelState): string[] {
  if (!state.plan) return [];
  return state.plan.items.filter((item) => isItemSelected(state, item)).map((item) => item.itemId);
}

export function selectionSummary(state: ImportPanelState): {
  count: number; newCount: number; conflictAppend: number; conflictOverwrite: number;
} {
  const out = { count: 0, newCount: 0, conflictAppend: 0, conflictOverwrite: 0 };
  if (!state.plan) return out;
  for (const item of state.plan.items) {
    const decision = decisionFor(state, item);
    if (decision === 'append' && item.action === 'new') { out.count += 1; out.newCount += 1; }
    else if (decision === 'append' && item.action === 'conflict') { out.count += 1; out.conflictAppend += 1; }
    else if (decision === 'overwrite') { out.count += 1; out.conflictOverwrite += 1; }
  }
  return out;
}

export function summarizeReport(report: ImportReport | null): ReportSummary {
  const empty = { applied: 0, skipped: 0, corrupted: 0, warnings: 0 };
  if (!report) return empty;
  const { counts, items } = report;
  const derive = (statuses: string[]) => items.filter((item) => statuses.includes(item.status)).length;
  const applied = counts.committed || derive(['committed']);
  const skipped = (counts.duplicate || 0) + (counts.skipped || 0) || derive(['duplicate', 'skipped', 'unchanged']);
  const corrupted = (counts.failed || 0) + (counts.invalid || 0)
    || items.filter((item) => item.status === 'failed' || item.status === 'invalid' || item.action === 'invalid').length;
  return { applied, skipped, corrupted, warnings: report.issues.length };
}

function countPlanItems(items: ImportPlanItem[]): ImportPlanCounts {
  const counts: ImportPlanCounts = { total: items.length, new: 0, duplicate: 0, conflict: 0, invalid: 0, skipped: 0 };
  for (const item of items) {
    counts[item.action] += 1;
  }
  return counts;
}

function normalizeSource(raw: unknown): ImportSource | null {
  const record = asRecord(raw);
  if (!record) return null;
  const id = str(record.id);
  if (!id) return null;
  const kinds = Array.isArray(record.kinds)
    ? record.kinds.filter(isKind)
    : (isKind(record.kind) ? [record.kind] : []);
  const limits: Record<string, number> = {};
  const rawLimits = asRecord(record.limits);
  if (rawLimits) {
    for (const [key, value] of Object.entries(rawLimits)) {
      if (typeof value === 'number' && Number.isFinite(value)) limits[key] = value;
    }
  }
  const notes = Array.isArray(record.notes) ? record.notes.filter((note): note is string => typeof note === 'string') : [];
  const mapping = Array.isArray(record.mapping) ? record.mapping.filter((key): key is string => typeof key === 'string') : [];
  return {
    id,
    displayName: str(record.displayName) || str(record.name) || id,
    kinds,
    formatVersion: str(record.formatVersion),
    compatibility: str(record.compatibility),
    requiresFile: record.requiresFile !== false,
    limits,
    mapping,
    notes,
  };
}

function normalizeIssues(raw: unknown): LocalPreviewIssue[] {
  if (!Array.isArray(raw)) return [];
  const out: LocalPreviewIssue[] = [];
  for (const entry of raw) {
    if (typeof entry === 'string') {
      out.push({ index: -1, code: 'issue', message: entry.slice(0, 300) });
      continue;
    }
    const record = asRecord(entry);
    if (!record) continue;
    const message = str(record.message) || str(record.reason) || str(record.detail);
    if (!message && !str(record.code)) continue;
    out.push({
      index: typeof record.index === 'number' ? Math.floor(record.index) : -1,
      code: str(record.code) || 'issue',
      message: (message || str(record.code)).slice(0, 300),
    });
  }
  return out;
}

function normalizeLocalItem(raw: unknown, index: number): LocalPreviewItem | null {
  const record = asRecord(raw);
  if (!record) return null;
  const messages = typeof record.messages === 'number'
    ? num(record.messages)
    : (Array.isArray(record.messages) ? record.messages.length : num(record.messageCount));
  return {
    candidateId: str(record.candidateId) || str(record.sourceKey) || `c${index}`,
    index: typeof record.index === 'number' ? Math.floor(record.index) : index,
    displayTitle: (str(record.displayTitle) || str(record.title) || '(无标题)').slice(0, 200),
    messages,
    textBytes: num(record.textBytes ?? record.bytes),
    action: isAction(record.action) ? record.action : undefined,
    reason: str(record.reason) || str(record.detail) || '',
  };
}

function normalizePicked(raw: unknown, sourceId: string, fallbackKind: ImportKind | ''): { token: string; preview: LocalPreview } {
  const record = asRecord(raw);
  const token = str(record?.token);
  if (!token) throw Error('主进程未返回有效的导入 token。');
  const previewRaw = asRecord(record?.preview) ?? record ?? {};
  const kind = isKind(previewRaw.kind) ? previewRaw.kind : fallbackKind;
  if (!kind) throw Error('主进程未返回导入类型。');
  const summaryRaw = asRecord(previewRaw.summary) ?? {};
  const rawItems = Array.isArray(previewRaw.items)
    ? previewRaw.items
    : (Array.isArray(previewRaw.candidates) ? previewRaw.candidates : []);
  const items = rawItems.map((item, index) => normalizeLocalItem(item, index)).filter((item): item is LocalPreviewItem => !!item);
  const issues = normalizeIssues(previewRaw.issues);
  return {
    token,
    preview: {
      sourceId: str(previewRaw.sourceId) || sourceId,
      kind,
      summary: {
        candidates: num(summaryRaw.candidates, items.length),
        duplicates: num(summaryRaw.duplicates ?? summaryRaw.duplicate),
        conflicts: num(summaryRaw.conflicts ?? summaryRaw.conflict),
        issues: num(summaryRaw.issues, issues.length),
      },
      items,
      issues,
    },
  };
}

function normalizePlanItem(raw: unknown, index: number): ImportPlanItem {
  const record = asRecord(raw);
  if (!record) throw Error('import-invalid-plan: Host 计划包含无效条目。');
  const itemId = str(record.itemId);
  if (!itemId) throw Error('import-invalid-plan: Host 计划条目缺少 itemId。');
  const detail = asRecord(record.detail) ?? {};
  return {
    itemId,
    index: typeof record.index === 'number' ? Math.floor(record.index) : index,
    displayTitle: (str(record.displayTitle) || '(无标题)').slice(0, 200),
    action: isAction(record.action) ? record.action : 'invalid',
    dedupeKey: str(record.dedupeKey),
    detail: {
      messages: typeof detail.messages === 'number' ? num(detail.messages) : undefined,
      skippedMessages: typeof detail.skippedMessages === 'number' ? num(detail.skippedMessages) : undefined,
      reason: str(detail.reason) || undefined,
    },
  };
}

function normalizePlan(
  raw: unknown,
  fallbackSourceId: string,
  fallbackKind: ImportKind | '',
  fallbackTarget: ImportTarget,
): ImportPlan {
  const record = asRecord(raw);
  const planHash = str(record?.planHash);
  if (!record || !planHash) throw Error('import-invalid-plan: Host 未返回有效的 planHash。');
  const rawItems = Array.isArray(record.items) ? record.items : [];
  const items = rawItems.map((item, index) => normalizePlanItem(item, index));
  const computed = countPlanItems(items);
  const rawCounts = asRecord(record.counts) ?? {};
  const targetRaw = asRecord(record.target);
  const scope = targetRaw?.scope === 'project' ? 'project' : targetRaw?.scope === 'user' ? 'user' : fallbackTarget.scope;
  const kind = isKind(record.kind) ? record.kind : fallbackKind;
  if (!kind) throw Error('import-invalid-plan: Host 计划缺少导入类型。');
  return {
    planHash,
    sourceId: str(record.sourceId) || fallbackSourceId,
    kind,
    target: { scope },
    counts: {
      total: num(rawCounts.total, computed.total),
      new: num(rawCounts.new, computed.new),
      duplicate: num(rawCounts.duplicate, computed.duplicate),
      conflict: num(rawCounts.conflict, computed.conflict),
      invalid: num(rawCounts.invalid, computed.invalid),
      skipped: num(rawCounts.skipped, computed.skipped),
    },
    items,
    issues: normalizeIssues(record.issues),
    requiresConfirmation: record.requiresConfirmation !== false,
  };
}

function normalizeJob(raw: unknown, previous: ImportJob | null): ImportJob {
  const record = asRecord(raw);
  if (!record) throw Error('Host 未返回导入作业。');
  const status = str(record.status);
  if (!isJobStatus(status)) throw Error(`Host 返回了无法识别的作业状态：${status || '(空)'}`);
  const jobId = str(record.jobId) || previous?.jobId || '';
  if (!jobId) throw Error('Host 未返回有效的 jobId。');
  const counts = { ...(previous?.counts ?? { total: 0, committed: 0, duplicate: 0, failed: 0, remaining: 0 }) };
  const rawCounts = asRecord(record.counts);
  if (rawCounts) {
    for (const key of ['total', 'committed', 'duplicate', 'failed', 'remaining'] as const) {
      if (typeof rawCounts[key] === 'number') counts[key] = num(rawCounts[key]);
    }
  }
  let current = previous?.current ?? null;
  if ('current' in record) {
    const rawCurrent = asRecord(record.current);
    current = rawCurrent
      ? { itemId: str(rawCurrent.itemId), displayTitle: (str(rawCurrent.displayTitle) || '(无标题)').slice(0, 200) }
      : null;
  }
  if (isTerminalStatus(status)) current = null;
  const kind = isKind(record.kind) ? record.kind : (previous?.kind ?? '');
  return {
    jobId,
    requestId: str(record.requestId) || previous?.requestId || '',
    sourceId: str(record.sourceId) || previous?.sourceId || '',
    kind,
    status,
    counts,
    current,
    terminal: record.terminal === true || isTerminalStatus(status),
    createdAt: str(record.createdAt) || previous?.createdAt || '',
    updatedAt: str(record.updatedAt) || previous?.updatedAt || '',
    planHash: str(record.planHash) || previous?.planHash || '',
    resumable: record.resumable === true || status === 'interrupted',
  };
}

function normalizeReportItem(raw: unknown, index: number): ImportReportItem | null {
  const record = asRecord(raw);
  if (!record) return null;
  const itemId = str(record.itemId);
  if (!itemId) return null;
  const targetRaw = asRecord(record.target);
  return {
    itemId,
    index: typeof record.index === 'number' ? Math.floor(record.index) : index,
    displayTitle: (str(record.displayTitle) || '(无标题)').slice(0, 200),
    action: isAction(record.action) ? record.action : '',
    status: str(record.status) || 'unknown',
    code: str(record.code),
    target: targetRaw ? { kind: str(targetRaw.kind), id: str(targetRaw.id) } : null,
  };
}

function normalizeReport(raw: unknown, jobId: string): ImportReport {
  const record = asRecord(raw);
  if (!record) throw Error('Host 未返回导入报告。');
  const rawCounts = asRecord(record.counts) ?? {};
  const rawItems = Array.isArray(record.items) ? record.items : [];
  const items = rawItems.map((item, index) => normalizeReportItem(item, index)).filter((item): item is ImportReportItem => !!item);
  const status = isJobStatus(record.status) ? record.status : 'running';
  const nextOffset = typeof record.nextOffset === 'number' ? Math.max(0, Math.floor(record.nextOffset)) : null;
  return {
    format: str(record.format) || 'sacode-import-report/1',
    jobId: str(record.jobId) || jobId,
    status,
    counts: {
      total: num(rawCounts.total, items.length),
      committed: num(rawCounts.committed),
      duplicate: num(rawCounts.duplicate),
      failed: num(rawCounts.failed),
      skipped: num(rawCounts.skipped),
      invalid: num(rawCounts.invalid),
    },
    items,
    issues: normalizeIssues(record.issues),
    nextOffset,
    complete: record.complete === true || (record.complete !== false && nextOffset === null),
  };
}

function makeRequestId(options: ImportPanelOptions): string {
  if (options.requestId) return options.requestId();
  const cryptoObj = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (cryptoObj?.randomUUID) return cryptoObj.randomUUID();
  return `import-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

const defaultTimers: ImportTimers = {
  set: (callback, delayMs) => setTimeout(callback, delayMs),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

const REPORT_ITEM_CAP = 1000;

export function createImportPanel(
  channels: ImportChannels | null,
  session: () => string,
  changed: () => void,
  options: ImportPanelOptions = {},
) {
  const missing = options.missingChannels ?? (channels ? [] : [...ALL_IMPORT_CHANNELS]);
  const wired = !!channels && missing.length === 0;
  const timers = options.timers ?? defaultTimers;
  const workspaceAvailable = options.workspaceAvailable ?? (() => false);
  const initialPollDelayMs = options.initialPollDelayMs ?? 350;
  const maxPollDelayMs = options.maxPollDelayMs ?? 2000;
  const maxPollFailures = options.maxPollFailures ?? 5;

  const state: ImportPanelState = {
    phase: 'idle',
    step: 'source',
    busy: false,
    error: '',
    errorCode: '',
    notice: '',
    channelsWired: wired,
    preloadMissing: [...missing],
    sources: DESIGN_SOURCES.map((source) => ({ ...source, kinds: [...source.kinds], limits: { ...source.limits }, notes: [...source.notes], mapping: [...source.mapping] })),
    sourcesLoaded: false,
    sourcesLoading: false,
    sourcesError: '',
    sourceId: '',
    kind: '',
    token: '',
    localPreview: null,
    plan: null,
    planStale: false,
    mapping: {},
    target: { scope: 'user' },
    decisions: {},
    job: null,
    report: null,
    reportLoading: false,
    polling: false,
    pollFailures: 0,
    active: true,
    interrupted: [],
  };

  let epoch = 0;
  let disposed = false;
  let pollTimer: unknown = null;
  let pollDelay = initialPollDelayMs;
  let reportSeq = 0;

  const notify = () => { if (!disposed) changed(); };

  function setError(code: string, text?: string): void {
    state.errorCode = code;
    state.error = text || errorText(code);
  }

  function clearError(): void {
    state.error = '';
    state.errorCode = '';
  }

  function currentSource(): ImportSource | null {
    return state.sources.find((source) => source.id === state.sourceId) ?? null;
  }

  function stopPoll(): void {
    if (pollTimer !== null) {
      timers.clear(pollTimer);
      pollTimer = null;
    }
    state.polling = false;
  }

  function releaseToken(): void {
    const token = state.token;
    state.token = '';
    if (!token || !channels) return;
    try { void Promise.resolve(channels.discard(token)).catch(() => undefined); } catch { /* 释放失败不阻断界面 */ }
  }

  function clearDownstream(): void {
    stopPoll();
    state.token = '';
    state.localPreview = null;
    state.plan = null;
    state.planStale = false;
    state.decisions = {};
    state.job = null;
    state.report = null;
    state.reportLoading = false;
    state.pollFailures = 0;
    pollDelay = initialPollDelayMs;
  }

  function reset(): void {
    ++epoch;
    stopPoll();
    releaseToken();
    Object.assign(state, {
      phase: 'idle' as ImportPhase,
      step: 'source' as ImportStep,
      busy: false,
      error: '',
      errorCode: '',
      notice: '已清空本次导入；已提交的条目和作业日志不受影响。',
      sourceId: '',
      kind: '',
      localPreview: null,
      plan: null,
      planStale: false,
      mapping: {},
      target: { scope: 'user' as ImportScope },
      decisions: {},
      job: null,
      report: null,
      reportLoading: false,
      polling: false,
      pollFailures: 0,
      interrupted: [],
    });
    notify();
  }

  async function loadSources(): Promise<void> {
    if (!wired || !channels) {
      state.sources = DESIGN_SOURCES.map((source) => ({ ...source, kinds: [...source.kinds], limits: { ...source.limits }, notes: [...source.notes], mapping: [...source.mapping] }));
      state.sourcesLoaded = false;
      state.sourcesError = '';
      notify();
      return;
    }
    if (state.sourcesLoading) return;
    state.sourcesLoading = true;
    state.sourcesError = '';
    notify();
    try {
      const raw = await channels.sources();
      if (disposed) return;
      const record = asRecord(raw);
      const list = Array.isArray(raw) ? raw : (Array.isArray(record?.sources) ? record?.sources as unknown[] : null);
      if (!list) throw Error('Host 未返回来源列表。');
      state.sources = list.map(normalizeSource).filter((source): source is ImportSource => !!source);
      state.sourcesLoaded = true;
    } catch (error) {
      if (disposed) return;
      const explained = explainError(error);
      state.sourcesError = explained.text;
      state.sources = DESIGN_SOURCES.map((source) => ({ ...source, kinds: [...source.kinds], limits: { ...source.limits }, notes: [...source.notes], mapping: [...source.mapping] }));
    } finally {
      if (!disposed) {
        state.sourcesLoading = false;
        notify();
      }
    }
  }

  function selectSource(sourceId: string): void {
    const source = state.sources.find((entry) => entry.id === sourceId);
    if (!source) {
      setError('import-unsupported-source');
      notify();
      return;
    }
    if (state.sourceId === sourceId) return;
    ++epoch;
    stopPoll();
    releaseToken();
    clearDownstream();
    state.sourceId = sourceId;
    state.kind = source.kinds[0] ?? '';
    state.step = 'source';
    state.phase = 'idle';
    state.busy = false;
    clearError();
    state.notice = source.notes[0] || `已选择来源：${source.displayName}`;
    notify();
  }

  function setKind(kind: ImportKind): void {
    const source = currentSource();
    if (!source || !source.kinds.includes(kind) || state.kind === kind) return;
    ++epoch;
    stopPoll();
    releaseToken();
    clearDownstream();
    state.kind = kind;
    state.phase = 'idle';
    state.busy = false;
    clearError();
    state.notice = `导入类型：${kindLabel(kind)}。请选择文件。`;
    notify();
  }

  async function pickFile(): Promise<void> {
    if (disposed || state.busy) return;
    if (!wired || !channels) {
      setError('import-channels-missing', channelsMissingText(state.preloadMissing));
      notify();
      return;
    }
    const source = currentSource();
    if (!source) {
      setError('import-unsupported-source', '请先选择来源卡片。');
      notify();
      return;
    }
    const sid = session();
    const ticket = ++epoch;
    stopPoll();
    releaseToken();
    clearDownstream();
    state.busy = true;
    clearError();
    state.notice = '正在打开文件并本地解析…';
    state.phase = 'idle';
    notify();
    try {
      const raw = await channels.pickFile(source.id);
      if (disposed || ticket !== epoch) return;
      if (sid && session() !== sid) {
        setError('import-session-changed');
        return;
      }
      const picked = normalizePicked(raw, source.id, state.kind || source.kinds[0] || '');
      state.token = picked.token;
      state.kind = picked.preview.kind;
      state.localPreview = picked.preview;
      state.plan = null;
      state.planStale = false;
      state.decisions = {};
      state.mapping = defaultMapping(picked.preview.kind);
      state.target = { scope: 'user' };
      state.step = 'preview';
      state.phase = 'idle';
      state.notice = '本地预览完成；下一步由 Host 重新校验并生成权威计划。';
    } catch (error) {
      if (disposed || ticket !== epoch) return;
      const explained = explainError(error);
      setError(explained.code, explained.text);
      state.notice = '';
    } finally {
      if (!disposed && ticket === epoch) {
        state.busy = false;
        notify();
      }
    }
  }

  function backToSource(): void {
    if (state.busy) return;
    ++epoch;
    stopPoll();
    releaseToken();
    clearDownstream();
    state.step = 'source';
    state.phase = 'idle';
    clearError();
    state.notice = state.sourceId ? '可重新选择文件；旧 token 已释放。' : '';
    notify();
  }

  function toMapping(): void {
    if (!state.localPreview || state.busy) return;
    state.step = 'mapping';
    clearError();
    notify();
  }

  function backToPreview(): void {
    if (state.busy) return;
    state.step = 'preview';
    notify();
  }

  function setMapping(patch: ImportMapping): void {
    if (state.busy) return;
    const next: ImportMapping = { ...state.mapping };
    if (patch.titleMode && ['keep', 'prefix', 'custom', 'source', 'filename'].includes(patch.titleMode)) next.titleMode = patch.titleMode;
    if (typeof patch.displayTitle === 'string') next.displayTitle = patch.displayTitle.slice(0, 200);
    if (typeof patch.prefix === 'string') next.prefix = patch.prefix.slice(0, 50);
    if (typeof patch.titlePrefix === 'string') next.titlePrefix = patch.titlePrefix.slice(0, 50);
    if (patch.workspaceMode === 'none' || patch.workspaceMode === 'current') next.workspaceMode = patch.workspaceMode;
    if (patch.updatePolicy === 'new-only' || patch.updatePolicy === 'allow-updates') next.updatePolicy = patch.updatePolicy;
    if (patch.conflictPolicy === 'skip' || patch.conflictPolicy === 'new-copy') next.conflictPolicy = patch.conflictPolicy;
    if (patch.credentialBindings && typeof patch.credentialBindings === 'object') next.credentialBindings = { ...patch.credentialBindings };
    const before = JSON.stringify(state.mapping);
    state.mapping = next;
    if (state.plan && JSON.stringify(state.mapping) !== before) {
      state.planStale = true;
      state.notice = '字段映射已修改；必须重新预览后才能确认导入。';
    }
    notify();
  }

  function setTarget(patch: ImportTarget): void {
    if (state.busy) return;
    if (patch.scope === 'project' && !workspaceAvailable()) {
      setError('import-bad-args', '当前没有工作区，不能选择项目作用域。');
      notify();
      return;
    }
    if (patch.scope !== 'user' && patch.scope !== 'project') return;
    const changedTarget = state.target.scope !== patch.scope;
    state.target = { scope: patch.scope };
    if (state.plan && changedTarget) {
      state.planStale = true;
      state.notice = '导入目标已修改；必须重新预览后才能确认导入。';
    }
    notify();
  }

  async function previewPlan(): Promise<void> {
    if (disposed || state.busy || state.phase === 'applying') return;
    if (!wired || !channels) {
      setError('import-channels-missing', channelsMissingText(state.preloadMissing));
      notify();
      return;
    }
    if (!state.token) {
      setError('import-bad-args', '请先选择文件并完成本地预览。');
      notify();
      return;
    }
    if (!state.kind) {
      setError('import-unsupported-source');
      notify();
      return;
    }
    const sid = session();
    const ticket = ++epoch;
    state.busy = true;
    state.phase = 'previewing';
    clearError();
    state.notice = '正在由 Host 校验、计算指纹并生成计划…';
    notify();
    try {
      const raw = await channels.preview(state.token, { ...state.mapping }, { ...state.target });
      if (disposed || ticket !== epoch) return;
      if (sid && session() !== sid) {
        setError('import-session-changed');
        state.phase = 'idle';
        return;
      }
      const plan = normalizePlan(raw, state.sourceId, state.kind, state.target);
      state.plan = plan;
      state.planStale = false;
      state.decisions = {};
      for (const item of plan.items) state.decisions[item.itemId] = item.action === 'new' ? 'append' : 'skip';
      state.phase = 'idle';
      state.step = 'decision';
      state.notice = `Host 计划：新增 ${plan.counts.new} · 重复 ${plan.counts.duplicate} · 冲突 ${plan.counts.conflict} · 无效 ${plan.counts.invalid}。`;
    } catch (error) {
      if (disposed || ticket !== epoch) return;
      const explained = explainError(error);
      setError(explained.code, explained.text);
      if (state.plan) state.planStale = true;
      state.phase = 'idle';
    } finally {
      if (!disposed && ticket === epoch) {
        state.busy = false;
        notify();
      }
    }
  }

  function setDecision(itemId: string, decision: ImportDecision): void {
    if (!state.plan || state.busy) return;
    const item = state.plan.items.find((entry) => entry.itemId === itemId);
    if (!item) return;
    if (!allowedDecisions(item.action, state.kind).includes(decision)) return;
    state.decisions[itemId] = decision;
    notify();
  }

  function batchDecision(kind: 'select-new' | 'overwrite-conflicts' | 'new-copy-conflicts' | 'dismiss-conflicts' | 'skip-all'): void {
    if (!state.plan || state.busy) return;
    if ((kind === 'overwrite-conflicts' || kind === 'new-copy-conflicts') && !state.plan.items.some((item) => item.action === 'conflict')) {
      state.notice = '计划中没有冲突条目。';
      notify();
      return;
    }
    if (kind === 'overwrite-conflicts' && state.kind !== 'config') {
      state.notice = '仅配置导入支持覆盖更新；会话与知识导入只能作为新副本追加。';
      notify();
      return;
    }
    if (kind === 'new-copy-conflicts' && state.kind === 'config') {
      state.notice = '配置导入不能作为新副本追加；请选择覆盖更新或跳过。';
      notify();
      return;
    }
    for (const item of state.plan.items) {
      if (kind === 'skip-all') { state.decisions[item.itemId] = 'skip'; continue; }
      if (kind === 'select-new' && item.action === 'new') { state.decisions[item.itemId] = 'append'; continue; }
      if (kind === 'overwrite-conflicts' && item.action === 'conflict') { state.decisions[item.itemId] = 'overwrite'; continue; }
      if (kind === 'new-copy-conflicts' && item.action === 'conflict') { state.decisions[item.itemId] = 'append'; continue; }
      if (kind === 'dismiss-conflicts' && item.action === 'conflict') { state.decisions[item.itemId] = 'dismiss'; }
    }
    notify();
  }

  function backToMapping(): void {
    if (state.busy) return;
    state.step = 'mapping';
    notify();
  }

  function backToDecision(): void {
    if (state.busy || !state.plan || state.planStale) return;
    state.step = 'decision';
    notify();
  }

  function retryFromMapping(): void {
    if (state.busy) return;
    ++epoch;
    stopPoll();
    state.plan = null;
    state.planStale = true;
    state.decisions = {};
    state.job = null;
    state.report = null;
    state.reportLoading = false;
    state.phase = 'idle';
    state.step = 'mapping';
    clearError();
    state.notice = '已回到字段映射；重新预览后可再次确认。已提交条目会以重复/未变化跳过。';
    notify();
  }

  function schedulePoll(delayMs: number): void {
    stopPoll();
    if (disposed || !wired || !channels || !state.active || !state.job) return;
    const ticket = epoch;
    state.polling = true;
    pollTimer = timers.set(() => {
      pollTimer = null;
      void pollOnce(ticket);
    }, Math.max(0, delayMs));
  }

  async function pollOnce(ticket: number): Promise<void> {
    if (disposed || ticket !== epoch || !channels || !state.job) return;
    if (!state.active) {
      state.polling = false;
      state.notice = '页面不可见，轮询已暂停；回到页面后继续。';
      notify();
      return;
    }
    const previous = state.job;
    const jobId = previous.jobId;
    try {
      const raw = await channels.poll(jobId);
      if (disposed || ticket !== epoch) return;
      const job = normalizeJob(raw, previous);
      if (job.jobId !== jobId) throw Error('Host 返回了不同的 jobId。');
      state.job = job;
      state.pollFailures = 0;
      pollDelay = initialPollDelayMs;
      if (job.terminal || isTerminalStatus(job.status)) {
        finishJob(job);
        return;
      }
      state.polling = true;
      notify();
      schedulePoll(initialPollDelayMs);
    } catch (error) {
      if (disposed || ticket !== epoch) return;
      state.pollFailures += 1;
      if (state.pollFailures >= maxPollFailures) {
        stopPoll();
        state.errorCode = 'import-poll-unconfirmed';
        state.error = '无法读取导入进度（连接中断）；作业可能仍在进行。已暂停轮询，请稍后点击“继续轮询”。';
        notify();
        return;
      }
      const delay = Math.min(maxPollDelayMs, initialPollDelayMs * Math.pow(2, state.pollFailures));
      notify();
      schedulePoll(delay);
    }
  }

  function finishJob(job: ImportJob): void {
    stopPoll();
    state.job = job;
    state.busy = false;
    state.phase = phaseForJob(job.status);
    state.step = 'report';
    state.notice = jobNotice(job.status);
    clearError();
    notify();
    void loadReport(0, 100);
  }

  async function apply(): Promise<void> {
    if (disposed || state.busy || state.phase === 'applying') return;
    if (!wired || !channels) {
      setError('import-channels-missing', channelsMissingText(state.preloadMissing));
      notify();
      return;
    }
    if (!state.plan || !state.token) {
      setError('import-bad-args', '请先完成预览并确认条目。');
      notify();
      return;
    }
    if (state.planStale) {
      setError('import-plan-stale');
      notify();
      return;
    }
    const itemIds = selectedItemIds(state);
    if (itemIds.length === 0) {
      setError('import-bad-args', '请至少选择一条可导入条目。');
      notify();
      return;
    }
    const selected = state.plan.items.filter((item) => itemIds.includes(item.itemId));
    const mapping: ImportMapping = { ...state.mapping };
    if (selected.some((item) => item.action === 'conflict' && decisionFor(state, item) === 'append')) {
      mapping.conflictPolicy = 'new-copy';
    }
    if (selected.some((item) => item.action === 'conflict' && decisionFor(state, item) === 'overwrite')) {
      mapping.updatePolicy = 'allow-updates';
    }
    const sid = session();
    const requestId = makeRequestId(options);
    const ticket = ++epoch;
    stopPoll();
    state.busy = true;
    state.phase = 'applying';
    state.step = 'progress';
    state.pollFailures = 0;
    pollDelay = initialPollDelayMs;
    clearError();
    state.notice = '正在创建导入作业…';
    notify();
    try {
      const raw = await channels.apply(state.token, state.plan.planHash, requestId, { itemIds }, mapping, { ...state.target });
      if (disposed || ticket !== epoch) return;
      if (sid && session() !== sid) {
        setError('import-session-changed');
        state.phase = 'idle';
        state.step = 'decision';
        return;
      }
      const job = normalizeJob(raw, null);
      state.job = job;
      state.busy = false;
      state.notice = '导入作业已创建；正在推进…';
      notify();
      if (job.terminal || isTerminalStatus(job.status)) finishJob(job);
      else schedulePoll(0);
    } catch (error) {
      if (disposed || ticket !== epoch) return;
      const explained = explainError(error);
      setError(explained.code, explained.text);
      state.phase = 'idle';
      state.step = 'decision';
      state.busy = false;
      notify();
    }
  }

  async function cancel(): Promise<void> {
    if (disposed || state.busy || !channels || !state.job) return;
    if (state.job.terminal || isTerminalStatus(state.job.status)) return;
    const sid = session();
    const ticket = ++epoch;
    stopPoll();
    state.busy = true;
    clearError();
    state.notice = '正在请求取消；当前条目完成后停止。';
    notify();
    try {
      const raw = await channels.cancel(state.job.jobId);
      if (disposed || ticket !== epoch) return;
      if (sid && session() !== sid) {
        setError('import-session-changed');
        state.phase = 'idle';
        return;
      }
      const job = normalizeJob(raw, state.job);
      state.job = job;
      state.busy = false;
      if (job.terminal || isTerminalStatus(job.status)) {
        finishJob(job);
      } else {
        state.notice = '已请求取消；等待当前条目到达安全点。';
        notify();
        schedulePoll(initialPollDelayMs);
      }
    } catch (error) {
      if (disposed || ticket !== epoch) return;
      const explained = explainError(error);
      setError(explained.code, explained.text);
      state.busy = false;
      notify();
      schedulePoll(initialPollDelayMs);
    }
  }

  function resumePolling(): void {
    if (disposed || state.busy || !state.job) return;
    if (state.job.terminal || isTerminalStatus(state.job.status)) return;
    clearError();
    state.notice = '继续轮询导入进度…';
    pollDelay = initialPollDelayMs;
    schedulePoll(0);
    notify();
  }

  async function resume(jobId?: string): Promise<void> {
    if (disposed || state.busy) return;
    if (!wired || !channels) {
      setError('import-channels-missing', channelsMissingText(state.preloadMissing));
      notify();
      return;
    }
    const target = jobId || state.interrupted[0]?.jobId || '';
    if (!target) {
      setError('import-bad-args', '没有可继续的中断作业。');
      notify();
      return;
    }
    const previous = state.interrupted.find((job) => job.jobId === target)
      ?? (state.job?.jobId === target ? state.job : null);
    const ticket = ++epoch;
    stopPoll();
    state.busy = true;
    state.phase = 'applying';
    state.step = 'progress';
    state.pollFailures = 0;
    pollDelay = initialPollDelayMs;
    clearError();
    state.notice = '正在恢复中断的导入作业…';
    notify();
    try {
      const raw = await channels.resume(target);
      if (disposed || ticket !== epoch) return;
      const job = normalizeJob(raw, previous);
      state.job = job;
      state.busy = false;
      state.interrupted = state.interrupted.filter((entry) => entry.jobId !== target);
      state.notice = '作业已恢复；正在推进…';
      notify();
      if (job.terminal || isTerminalStatus(job.status)) finishJob(job);
      else schedulePoll(0);
    } catch (error) {
      if (disposed || ticket !== epoch) return;
      const explained = explainError(error);
      setError(explained.code, explained.text);
      state.busy = false;
      state.phase = 'idle';
      notify();
    }
  }

  async function loadReport(offset = 0, limit = 100): Promise<void> {
    if (disposed || !wired || !channels || !state.job) return;
    const jobId = state.job.jobId;
    const seq = ++reportSeq;
    state.reportLoading = true;
    notify();
    try {
      const raw = await channels.report(jobId, Math.max(0, Math.floor(offset)), Math.max(1, Math.min(200, Math.floor(limit))));
      if (disposed || seq !== reportSeq) return;
      const page = normalizeReport(raw, jobId);
      if (page.jobId !== jobId) throw Error('Host 返回了不同作业的报告。');
      const existing = offset > 0 ? state.report : null;
      let merged: ImportReport;
      if (existing && existing.jobId === jobId) {
        const seen = new Set(existing.items.map((item) => item.itemId));
        const appended = page.items.filter((item) => !seen.has(item.itemId));
        merged = {
          ...page,
          counts: { ...existing.counts, ...page.counts, total: page.counts.total || existing.counts.total },
          items: [...existing.items, ...appended].slice(0, REPORT_ITEM_CAP),
          issues: page.issues.length ? page.issues : existing.issues,
        };
      } else {
        merged = { ...page, items: page.items.slice(0, REPORT_ITEM_CAP) };
      }
      state.report = merged;
      if (offset === 0) state.step = 'report';
      // 作业状态是终态真源；报告可能滞后一拍，不能用它把 partial/失败改写成完成。
      if (!state.job?.terminal && merged.status !== 'running' && merged.status !== 'created') {
        state.phase = phaseForJob(merged.status);
      }
    } catch (error) {
      if (disposed || seq !== reportSeq) return;
      const explained = explainError(error);
      setError(explained.code, explained.text);
    } finally {
      if (!disposed && seq === reportSeq) {
        state.reportLoading = false;
        notify();
      }
    }
  }

  function loadMoreReport(): void {
    const next = state.report?.nextOffset;
    if (next === null || next === undefined || state.reportLoading) return;
    void loadReport(next, 100);
  }

  function viewReport(): void {
    if (state.report) {
      state.step = 'report';
      notify();
      return;
    }
    void loadReport(0, 100);
  }

  async function loadJobs(limit = 20): Promise<void> {
    if (disposed || !wired || !channels) return;
    try {
      const raw = await channels.jobs(Math.max(1, Math.min(100, Math.floor(limit))));
      if (disposed) return;
      const record = asRecord(raw);
      const list = Array.isArray(raw) ? raw : (Array.isArray(record?.jobs) ? record?.jobs as unknown[] : null);
      if (!list) return;
      const jobs: ImportJob[] = [];
      for (const entry of list) {
        try {
          jobs.push(normalizeJob(entry, null));
        } catch {
          // 单条作业损坏不阻断恢复入口。
        }
      }
      state.interrupted = jobs.filter((job) => job.status === 'interrupted' && job.resumable);
      notify();
    } catch {
      // 作业列表失败不阻塞新导入；不把连接错误伪装成“无中断作业”。
      state.notice = '无法读取历史导入作业；中断恢复入口暂不可用。';
      notify();
    }
  }

  function openInterruptedReport(jobId: string): void {
    const job = state.interrupted.find((entry) => entry.jobId === jobId);
    if (!job) return;
    state.job = job;
    state.phase = 'failed';
    state.step = 'report';
    state.notice = '中断作业报告：已提交条目保留，未执行条目未写入。';
    notify();
    void loadReport(0, 100);
  }

  function setActive(active: boolean): void {
    if (state.active === active) return;
    state.active = active;
    if (!active) {
      stopPoll();
      if (state.phase === 'applying' && state.job && !isTerminalStatus(state.job.status)) {
        state.notice = '页面不可见，轮询已暂停；回到页面后继续。';
      }
      notify();
      return;
    }
    if (state.phase === 'applying' && state.job && !isTerminalStatus(state.job.status)) {
      state.notice = '页面已恢复，继续轮询导入进度…';
      schedulePoll(0);
    }
    notify();
  }

  function dispose(): void {
    disposed = true;
    ++epoch;
    stopPoll();
    reportSeq += 1;
    releaseToken();
  }

  return {
    state,
    loadSources,
    selectSource,
    setKind,
    pickFile,
    backToSource,
    toMapping,
    backToPreview,
    setMapping,
    setTarget,
    previewPlan,
    setDecision,
    batchDecision,
    backToMapping,
    backToDecision,
    retryFromMapping,
    apply,
    cancel,
    resumePolling,
    resume,
    loadReport,
    loadMoreReport,
    viewReport,
    loadJobs,
    openInterruptedReport,
    setActive,
    reset,
    dispose,
  };
}
