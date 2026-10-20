// F08 Git 写面板状态机：只经有限通道发起计划、观察与写操作提案。
// 不拼接 shell 字符串，不接收 approvalId，不把 prepared/未核对结果当成成功。
export type GitReply = {
  sessionId?: string;
  directory?: string;
  output?: string;
  exitCode?: number;
  truncated?: boolean;
  failure?: string;
  diagnostic?: string;
  observationId?: string;
  head?: string | null;
  branch?: string;
  phase?: string;
  outcome?: string;
  reason?: string;
  verified?: boolean;
  newCommit?: string;
  actionId?: string;
  revision?: number;
  proposalDigest?: string;
  approvalBody?: string;
  force?: boolean;
};

export type GitStatusEntry = {
  path: string;
  oldPath?: string;
  x: string;
  y: string;
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
  conflicted: boolean;
  partial: boolean;
  stageable: boolean;
  unstageable: boolean;
};

export type GitPushTargetView = { remote: string; ref: string; headOid: string };
export type GitCommitProposal = { actionId: string; revision: number; proposalDigest: string; approvalBody: string };

export type GitWritePanelState = {
  statusWired: boolean;
  pushTargetWired: boolean;
  writeWired: boolean;
  missing: string[];
  loaded: boolean;
  truncated: boolean;
  busy: boolean;
  entries: GitStatusEntry[];
  branch: string;
  stagePaths: string[];
  unstagePaths: string[];
  commitMessage: string;
  commitArmed: boolean;
  commitProposal: GitCommitProposal | null;
  pushTarget: GitPushTargetView | null;
  pushArmed: boolean;
  pushBusy: boolean;
  lastAction: { status: 'succeeded' | 'unknown'; kind: 'commit' | 'push'; newCommit?: string } | null;
  notice: string;
  error: string;
};

type GitWriteChannels = {
  status?: (sessionId: string, directory: string) => Promise<GitReply>;
  pushTarget?: (sessionId: string, directory: string) => Promise<GitReply>;
  observe?: (sessionId: string, directory: string) => Promise<GitReply>;
  stage?: (request: { sessionId: string; directory: string; observationId: string; paths: string[] }) => Promise<GitReply>;
  unstage?: (request: { sessionId: string; directory: string; observationId: string; paths: string[] }) => Promise<GitReply>;
  commit?: (request: { sessionId: string; directory: string; observationId: string; message: string }) => Promise<GitReply>;
  push?: (request: { sessionId: string; directory: string; observationId: string; remote: string; ref: string; headOid: string }) => Promise<GitReply>;
};

const HOST_CHANNELS: ReadonlyArray<readonly [string, keyof GitWriteChannels]> = [
  ['workspaceGitStatus', 'status'],
  ['workspaceGitPushTarget', 'pushTarget'],
  ['workspaceGitObserve', 'observe'],
  ['workspaceGitStage', 'stage'],
  ['workspaceGitUnstage', 'unstage'],
  ['workspaceGitCommit', 'commit'],
  ['workspaceGitPush', 'push'],
];

export const GIT_WRITE_CHANNEL_NAMES = [
  'workspaceGitObserve',
  'workspaceGitStage',
  'workspaceGitUnstage',
  'workspaceGitCommit',
  'workspaceGitPush',
];

export function resolveGitWriteChannels(host: any) {
  const source = host && typeof host === 'object' ? host : {};
  const channels: GitWriteChannels = {};
  const missing: string[] = [];
  for (const [hostName, shortName] of HOST_CHANNELS) {
    // 动态取用：宿主对象替换同名方法后无需重建面板。
    if (typeof source[hostName] === 'function') {
      (channels as any)[shortName] = (...args: any[]) => source[hostName](...args);
    } else if (typeof source[shortName] === 'function') {
      (channels as any)[shortName] = (...args: any[]) => source[shortName](...args);
    } else {
      missing.push(hostName);
    }
  }
  return {
    channels,
    missing,
    statusWired: typeof channels.status === 'function',
    pushTargetWired: typeof channels.pushTarget === 'function',
    writeWired: GIT_WRITE_CHANNEL_NAMES.every((name) => !missing.includes(name)),
  };
}

export function channelsMissingText(missing: string[]): string {
  const names = [...new Set((missing || []).filter(Boolean))];
  if (!names.length) return '';
  return `Git 通道未接通：${names.join('、')}。当前只展示可用的只读信息；不会伪造暂存、提交或推送结果。`;
}

const ERROR_TEXT: Record<string, string> = {
  'git-unavailable': '未找到可用的 Git（git-unavailable）。',
  'not-a-repository': '当前目录不是 Git 仓库（not-a-repository）。',
  'workspace-changed': '工作区已变化（workspace-changed）；请刷新后重试。',
  'git-observation-stale': 'Git 观察已过期（git-observation-stale）；请刷新后重新确认。',
  'git-index-busy': 'Git 索引正被占用（git-index-busy）；请稍后重试。',
  'git-index-format-unsupported': '当前 Git 索引格式不受支持（git-index-format-unsupported）。',
  'git-conflict': '存在未解决冲突（git-conflict）。',
  'git-provider-unavailable': 'Git 执行提供方不可用（git-provider-unavailable）。',
  'not-authorized': '未获得该项 Git 操作的独立授权（not-authorized）。',
  'persistence-failed': '授权或结果持久化失败（persistence-failed）；请刷新核对。',
  'git-timeout': 'Git 操作超时（git-timeout）；请核对实际状态。',
  'git-outcome-unknown': 'Git 操作结果未知（git-outcome-unknown）；请刷新并核对实际状态，不会自动重放。',
  'git-unknown': '操作未完成（git-unknown）；请刷新后核对实际状态。',
};

export function errorText(code: string): string {
  const raw = String(code || '').trim();
  if (!raw) return ERROR_TEXT['git-unknown'];
  for (const key of Object.keys(ERROR_TEXT)) {
    if (raw === key || raw.includes(key)) return ERROR_TEXT[key];
  }
  if (/^\{|jsonrpc|"error"\s*:/i.test(raw)) return ERROR_TEXT['git-unknown'];
  return raw;
}

export function checkedGitPath(path: string): string {
  if (typeof path !== 'string' || !path
    || path.startsWith('/') || /^[A-Za-z]:/.test(path) || path.includes('\\')
    || /[\u0000-\u001f\u007f]/.test(path)) {
    throw Error('Git 路径无效；只能选择当前工作区中的普通文件。');
  }
  const parts = path.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) throw Error('Git 路径包含空段或越界段。');
  if (parts.some((part) => part.toLowerCase() === '.git')) throw Error('Git 路径不能指向 .git 元数据。');
  return path;
}

export function parsePorcelainStatus(output: string, truncated = false): { entries: GitStatusEntry[]; branch: string } {
  if (truncated) throw Error('Git 状态输出已截断，清单不完整。');
  const parts = String(output || '').split('\0');
  if (parts.length && parts[parts.length - 1] === '') parts.pop();
  const entries: GitStatusEntry[] = [];
  let branch = '';
  for (let i = 0; i < parts.length; i++) {
    const record = parts[i];
    if (!record) continue;
    if (record.startsWith('## ')) {
      branch = record.slice(3);
      continue;
    }
    if (record.length < 4 || record[2] !== ' ') throw Error('Git 状态格式无效。');
    const x = record[0];
    const y = record[1];
    const path = checkedGitPath(record.slice(3));
    const conflicted = x === 'U' || y === 'U' || (x === 'A' && y === 'A') || (x === 'D' && y === 'D');
    const staged = !conflicted && x !== ' ' && x !== '?';
    const unstaged = !conflicted && y !== ' ' && y !== '?';
    const untracked = x === '?' && y === '?';
    const partial = staged && unstaged;
    let oldPath: string | undefined;
    if (x === 'R' || x === 'C' || y === 'R' || y === 'C') {
      if (++i >= parts.length) throw Error('Git 重命名记录不完整。');
      oldPath = checkedGitPath(parts[i]);
    }
    entries.push({
      path,
      oldPath,
      x,
      y,
      staged,
      unstaged,
      untracked,
      conflicted,
      partial,
      stageable: !conflicted && !partial && (unstaged || untracked) && !path.endsWith('/'),
      unstageable: !conflicted && staged && !path.endsWith('/'),
    });
  }
  return { entries, branch };
}

function missingNotice(missing: string[]): string {
  return missing.length
    ? `Git 通道未接通：${missing.join('、')}。当前只展示可用的只读信息；不会伪造暂存、提交或推送结果。`
    : '';
}

function validOid(value: any): boolean {
  return typeof value === 'string' && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(value);
}

function parsePushTarget(output: string): GitPushTargetView {
  const lines = String(output || '').replace(/\r/g, '').split('\n');
  while (lines.length && !lines[lines.length - 1]) lines.pop();
  if (lines.length !== 3) throw Error('宿主返回的 Git 推送目标格式无效。');
  const [remote, ref, headOid] = lines;
  if (!remote || remote === '.' || remote.startsWith('.') || remote.startsWith('/')
    || remote.startsWith('-') || remote.startsWith('+') || remote.includes('..')
    || /[\u0000-\u0020\u007f:@\\]/.test(remote)) {
    throw Error('Git 推送远端包含无法安全展示的字符；已拒绝。');
  }
  if (lines.some((line) => line.startsWith('+')) || /--force\b|force-with-lease|--mirror\b|--all\b/i.test(output)) {
    throw Error('检测到强推或批量推送标记；本面板不提供强推。');
  }
  if (!/^refs\/heads\/[A-Za-z0-9._/-]+$/.test(ref) || ref.includes('..') || ref.endsWith('/')) {
    throw Error('Git 推送目标分支无效。');
  }
  const branchParts = ref.slice('refs/heads/'.length).split('/');
  if (branchParts.some((part) => !part || part.startsWith('.') || part.startsWith('-')
    || part.endsWith('.') || part.endsWith('.lock'))) {
    throw Error('Git 推送目标分支包含不安全的分段。');
  }
  if (!validOid(headOid)) throw Error('Git 推送目标 HEAD OID 无效。');
  return { remote, ref, headOid };
}

export function createGitWritePanel(channels: GitWriteChannels, identity: () => { sessionId: string; directory: string }, changed: () => void) {
  const source = channels && typeof channels === 'object' ? channels : {};
  const wired = {
    status: typeof source.status === 'function',
    pushTarget: typeof source.pushTarget === 'function',
    observe: typeof source.observe === 'function',
    stage: typeof source.stage === 'function',
    unstage: typeof source.unstage === 'function',
    commit: typeof source.commit === 'function',
    push: typeof source.push === 'function',
  };
  const missing = HOST_CHANNELS.filter(([, shortName]) => !wired[shortName]).map(([hostName]) => hostName);
  const writeWired = GIT_WRITE_CHANNEL_NAMES.every((name) => !missing.includes(name));
  const state: GitWritePanelState = {
    statusWired: wired.status,
    pushTargetWired: wired.pushTarget,
    writeWired,
    missing,
    loaded: false,
    truncated: false,
    busy: false,
    entries: [],
    branch: '',
    stagePaths: [],
    unstagePaths: [],
    commitMessage: '',
    commitArmed: false,
    commitProposal: null,
    pushTarget: null,
    pushArmed: false,
    pushBusy: false,
    lastAction: null,
    notice: missingNotice(missing),
    error: '',
  };
  let disposed = false;
  let generation = 0;
  let epoch = 0;

  const notify = () => {
    if (!disposed) changed();
  };
  const messageOf = (error: any): string => errorText(String((error && error.message) || error || 'git-unknown'));
  const assertIdentity = (reply: any, what: string) => {
    if (!reply || typeof reply !== 'object') throw Error(`${what}回执无效。`);
    const who = identity();
    if (reply.sessionId !== who.sessionId || reply.directory !== who.directory) {
      throw Error(`${what}回执已不属于当前会话或工作区。`);
    }
  };
  const failureOf = (reply: any): string => errorText(reply.failure || reply.diagnostic || 'git-unknown');
  const stagedEntries = () => state.entries.filter((entry) => entry.staged && !entry.conflicted);
  const hasConflicts = () => state.entries.some((entry) => entry.conflicted);

  async function observe(): Promise<string> {
    if (!wired.observe) throw Error('Git 观察通道未接通；不会伪造写操作结果。');
    const who = identity();
    const reply: any = await source.observe!(who.sessionId, who.directory);
    assertIdentity(reply, 'Git 观察');
    if (reply.failure || (typeof reply.exitCode === 'number' && reply.exitCode !== 0)) throw Error(failureOf(reply));
    if (reply.truncated) throw Error('Git 观察输出不完整（已截断）。');
    const observationId = String(reply.observationId || '');
    if (!observationId) throw Error('Git 观察回执缺少 observationId；写操作已取消。');
    return observationId;
  }

  async function refresh(clearNotice = true): Promise<void> {
    if (disposed) return;
    const ticket = ++epoch;
    if (clearNotice) {
      state.notice = '';
      state.lastAction = null;
    }
    state.error = '';
    state.commitArmed = false;
    state.commitProposal = null;
    state.pushArmed = false;
    state.pushTarget = null;
    if (!wired.status) {
      state.loaded = false;
      state.truncated = false;
      state.entries = [];
      state.branch = '';
      state.busy = false;
      state.notice = missingNotice(missing);
      notify();
      return;
    }
    state.busy = true;
    state.loaded = false;
    state.truncated = false;
    state.entries = [];
    state.branch = '';
    notify();
    try {
      const who = identity();
      const reply: any = await source.status!(who.sessionId, who.directory);
      if (disposed || ticket !== epoch) return;
      assertIdentity(reply, 'Git 状态');
      if (reply.failure || (typeof reply.exitCode === 'number' && reply.exitCode !== 0)) throw Error(failureOf(reply));
      if (reply.truncated) {
        state.truncated = true;
        state.loaded = false;
        state.entries = [];
        state.error = 'Git 状态输出已截断，清单不完整；为避免遗漏，暂存、提交和推送均已禁用。';
        return;
      }
      const parsed = parsePorcelainStatus(reply.output || '', false);
      state.entries = parsed.entries;
      state.branch = parsed.branch;
      state.loaded = true;
      const stageable = new Set(parsed.entries.filter((entry) => entry.stageable).map((entry) => entry.path));
      const unstageable = new Set(parsed.entries.filter((entry) => entry.unstageable).map((entry) => entry.path));
      state.stagePaths = state.stagePaths.filter((path) => stageable.has(path));
      state.unstagePaths = state.unstagePaths.filter((path) => unstageable.has(path));
    } catch (error) {
      if (!disposed && ticket === epoch) {
        state.error = messageOf(error);
        state.loaded = false;
        state.truncated = false;
        state.entries = [];
        state.branch = '';
      }
    } finally {
      if (!disposed && ticket === epoch) {
        state.busy = false;
        notify();
      }
    }
  }

  function toggleStagePath(path: string, checked: boolean): void {
    if (disposed) return;
    const entry = state.entries.find((item) => item.path === path);
    const next = new Set(state.stagePaths);
    if (checked && entry && entry.stageable && state.loaded && !state.truncated && !state.busy) next.add(path);
    else next.delete(path);
    state.stagePaths = [...next];
    notify();
  }

  function toggleUnstagePath(path: string, checked: boolean): void {
    if (disposed) return;
    const entry = state.entries.find((item) => item.path === path);
    const next = new Set(state.unstagePaths);
    if (checked && entry && entry.unstageable && state.loaded && !state.truncated && !state.busy) next.add(path);
    else next.delete(path);
    state.unstagePaths = [...next];
    notify();
  }

  function selectAllStage(): void {
    if (disposed || !state.loaded || state.truncated || state.busy) return;
    state.stagePaths = state.entries.filter((entry) => entry.stageable).map((entry) => entry.path);
    notify();
  }

  function selectAllUnstage(): void {
    if (disposed || !state.loaded || state.truncated || state.busy) return;
    state.unstagePaths = state.entries.filter((entry) => entry.unstageable).map((entry) => entry.path);
    notify();
  }

  function clearSelection(): void {
    if (disposed) return;
    state.stagePaths = [];
    state.unstagePaths = [];
    notify();
  }

  function setCommitMessage(value: string): void {
    if (disposed) return;
    state.commitMessage = String(value == null ? '' : value).slice(0, 4000);
    state.commitArmed = false;
    state.commitProposal = null;
    notify();
  }

  function canArmCommit(): boolean {
    return state.writeWired && state.loaded && !state.truncated && !state.busy
      && !hasConflicts() && stagedEntries().length > 0 && state.commitMessage.trim().length > 0;
  }

  function armCommit(checked: boolean): void {
    if (disposed) return;
    state.commitArmed = !!checked && canArmCommit();
    notify();
  }

  async function stageSelected(): Promise<void> {
    if (disposed) return;
    if (!wired.observe || !wired.stage) {
      state.error = 'Git 写操作通道未接通；不会伪造暂存结果。';
      notify();
      return;
    }
    if (state.busy) return;
    const paths = [...state.stagePaths];
    if (!paths.length) {
      state.error = '先选择至少一个可暂存文件。';
      notify();
      return;
    }
    if (!state.loaded || state.truncated) {
      state.error = 'Git 状态不完整（不完整或已截断），不能暂存。';
      notify();
      return;
    }
    const byPath = new Map(state.entries.map((entry) => [entry.path, entry]));
    for (const path of paths) {
      const entry = byPath.get(path);
      if (!entry || !entry.stageable) {
        state.error = `路径 ${path} 已不在可暂存的当前变更中；请刷新后重试。`;
        notify();
        return;
      }
    }
    const generationAtStart = generation;
    state.lastAction = null;
    state.busy = true;
    state.error = '';
    state.notice = '';
    notify();
    try {
      const who = identity();
      const observationId = await observe();
      if (disposed || generation !== generationAtStart) return;
      const reply: any = await source.stage!({
        sessionId: who.sessionId,
        directory: who.directory,
        observationId,
        paths: paths.map(checkedGitPath),
      });
      if (disposed || generation !== generationAtStart) return;
      if (reply && reply.failure) throw Error(failureOf(reply));
      if (!reply || reply.outcome !== 'succeeded') throw Error(errorText((reply && reply.reason) || 'git-unknown'));
      state.stagePaths = [];
      await refresh(false);
      if (disposed || generation !== generationAtStart) return;
      state.notice = `已暂存 ${paths.length} 个路径；请重新核对索引差异后再提交。`;
    } catch (error) {
      if (!disposed && generation === generationAtStart) state.error = messageOf(error);
    } finally {
      if (!disposed && generation === generationAtStart) {
        state.busy = false;
        notify();
      }
    }
  }

  async function unstageSelected(): Promise<void> {
    if (disposed) return;
    if (!wired.observe || !wired.unstage) {
      state.error = 'Git 取消暂存通道未接通；不会伪造取消暂存结果。';
      notify();
      return;
    }
    if (state.busy) return;
    const paths = [...state.unstagePaths];
    if (!paths.length) {
      state.error = '先选择至少一个已暂存文件。';
      notify();
      return;
    }
    if (!state.loaded || state.truncated) {
      state.error = 'Git 状态不完整（不完整或已截断），不能取消暂存。';
      notify();
      return;
    }
    const byPath = new Map(state.entries.map((entry) => [entry.path, entry]));
    for (const path of paths) {
      const entry = byPath.get(path);
      if (!entry || !entry.unstageable) {
        state.error = `路径 ${path} 已不在已暂存列表中；请刷新后重试。`;
        notify();
        return;
      }
    }
    const generationAtStart = generation;
    state.lastAction = null;
    state.busy = true;
    state.error = '';
    state.notice = '';
    notify();
    try {
      const who = identity();
      const observationId = await observe();
      if (disposed || generation !== generationAtStart) return;
      const reply: any = await source.unstage!({
        sessionId: who.sessionId,
        directory: who.directory,
        observationId,
        paths: paths.map(checkedGitPath),
      });
      if (disposed || generation !== generationAtStart) return;
      if (reply && reply.failure) throw Error(failureOf(reply));
      if (!reply || reply.outcome !== 'succeeded') throw Error(errorText((reply && reply.reason) || 'git-unknown'));
      state.unstagePaths = [];
      await refresh(false);
      if (disposed || generation !== generationAtStart) return;
      state.notice = `取消暂存 ${paths.length} 个路径；文件内容未修改，仅撤销索引标记。`;
    } catch (error) {
      if (!disposed && generation === generationAtStart) state.error = messageOf(error);
    } finally {
      if (!disposed && generation === generationAtStart) {
        state.busy = false;
        notify();
      }
    }
  }

  async function commit(): Promise<void> {
    if (disposed) return;
    if (!wired.observe || !wired.commit) {
      state.error = 'Git 提交通道未接通；不会伪造提交结果。';
      notify();
      return;
    }
    if (state.busy) return;
    if (state.truncated) {
      state.commitArmed = false;
      state.error = 'Git 状态不完整（已截断），不能提交。';
      notify();
      return;
    }
    if (!state.loaded) {
      state.commitArmed = false;
      state.error = 'Git 状态尚未成功读取，不能提交。';
      notify();
      return;
    }
    if (hasConflicts()) {
      state.commitArmed = false;
      state.error = '存在未解决冲突，不能提交。';
      notify();
      return;
    }
    const staged = stagedEntries();
    if (!staged.length) {
      state.commitArmed = false;
      state.error = '当前没有已暂存内容，不能提交。';
      notify();
      return;
    }
    const message = state.commitMessage.trim();
    if (!message) {
      state.error = '提交说明不能为空。';
      notify();
      return;
    }
    if (!state.commitArmed) {
      state.error = '请先勾选“确认提交审批”；提交需要独立审批。';
      notify();
      return;
    }
    const generationAtStart = generation;
    state.lastAction = null;
    state.busy = true;
    state.error = '';
    state.notice = '';
    notify();
    try {
      const who = identity();
      const observationId = await observe();
      if (disposed || generation !== generationAtStart) return;
      const reply: any = await source.commit!({
        sessionId: who.sessionId,
        directory: who.directory,
        observationId,
        message,
      });
      if (disposed || generation !== generationAtStart) return;
      if (reply && reply.failure) throw Error(failureOf(reply));
      if (reply && (reply.phase === 'prepared' || (!reply.outcome && reply.actionId))) {
        state.commitProposal = {
          actionId: String(reply.actionId || ''),
          revision: Number(reply.revision || 1),
          proposalDigest: String(reply.proposalDigest || ''),
          approvalBody: String(reply.approvalBody || ''),
        };
        state.commitArmed = false;
        state.notice = '已生成提交提案，等待独立审批；批准前不会执行提交。';
        return;
      }
      if (reply && reply.outcome === 'succeeded') {
        if (reply.verified === true && validOid(reply.newCommit)) {
          state.lastAction = { status: 'succeeded', kind: 'commit', newCommit: String(reply.newCommit) };
          state.commitProposal = null;
          state.commitArmed = false;
          state.commitMessage = '';
          await refresh(false);
          if (disposed || generation !== generationAtStart) return;
          state.notice = `提交已完成：${reply.newCommit}；不会自动推送。`;
        } else {
          state.lastAction = { status: 'unknown', kind: 'commit', newCommit: validOid(reply.newCommit) ? String(reply.newCommit) : undefined };
          state.commitArmed = false;
          state.notice = '提交结果未核对（git-outcome-unknown）；请刷新并核对 HEAD，不会自动重复提交。';
        }
        return;
      }
      throw Error(errorText((reply && reply.reason) || 'git-unknown'));
    } catch (error) {
      if (!disposed && generation === generationAtStart) {
        state.commitArmed = false;
        state.error = messageOf(error);
      }
    } finally {
      if (!disposed && generation === generationAtStart) {
        state.busy = false;
        notify();
      }
    }
  }

  async function preparePush(): Promise<void> {
    if (disposed) return;
    if (!wired.pushTarget) {
      state.error = 'Git 推送目标通道未接通；不会伪造推送预览。';
      notify();
      return;
    }
    if (state.busy || state.pushBusy) return;
    const generationAtStart = generation;
    state.pushBusy = true;
    state.error = '';
    state.notice = '';
    state.pushTarget = null;
    state.pushArmed = false;
    notify();
    try {
      const who = identity();
      const reply: any = await source.pushTarget!(who.sessionId, who.directory);
      if (disposed || generation !== generationAtStart) return;
      assertIdentity(reply, 'Git 推送目标');
      if (reply.failure || (typeof reply.exitCode === 'number' && reply.exitCode !== 0)) throw Error(failureOf(reply));
      if (reply.truncated) throw Error('Git 推送目标输出已截断，不能作为预览。');
      if (reply.force) throw Error('宿主返回了强推标记；本面板不提供强推。');
      const parsed = parsePushTarget(reply.output || '');
      state.pushTarget = parsed;
      state.pushArmed = false;
      state.notice = `推送预览已读取：仅推送 ${parsed.headOid} 到 ${parsed.remote} · ${parsed.ref}；不提供强推。`;
    } catch (error) {
      if (!disposed && generation === generationAtStart) {
        state.error = messageOf(error);
        state.pushTarget = null;
      }
    } finally {
      if (!disposed && generation === generationAtStart) {
        state.pushBusy = false;
        notify();
      }
    }
  }

  function armPush(checked: boolean): void {
    if (disposed) return;
    state.pushArmed = !!checked && !!state.pushTarget && state.writeWired && state.loaded
      && !state.truncated && !state.busy && !state.pushBusy;
    notify();
  }

  async function push(): Promise<void> {
    if (disposed) return;
    if (!wired.push || !wired.observe || !wired.pushTarget) {
      state.error = 'Git 推送通道未接通；不会伪造推送结果。';
      notify();
      return;
    }
    if (state.busy) return;
    const preview = state.pushTarget;
    if (!preview) {
      state.error = '请先读取并核对推送预览。';
      notify();
      return;
    }
    if (!state.pushArmed) {
      state.error = '请先勾选“确认推送审批”；推送需要独立审批。';
      notify();
      return;
    }
    const generationAtStart = generation;
    state.lastAction = null;
    state.busy = true;
    state.error = '';
    state.notice = '';
    notify();
    try {
      const who = identity();
      const latest: any = await source.pushTarget!(who.sessionId, who.directory);
      if (disposed || generation !== generationAtStart) return;
      assertIdentity(latest, 'Git 推送目标');
      if (latest.failure || (typeof latest.exitCode === 'number' && latest.exitCode !== 0)) throw Error(failureOf(latest));
      if (latest.truncated) throw Error('Git 推送目标输出已截断，不能推送。');
      if (latest.force) {
        state.pushTarget = null;
        state.pushArmed = false;
        throw Error('宿主返回了强推标记；本面板不提供强推。');
      }
      const now = parsePushTarget(latest.output || '');
      if (now.remote !== preview.remote || now.ref !== preview.ref || now.headOid !== preview.headOid) {
        state.pushTarget = null;
        state.pushArmed = false;
        throw Error('Git 推送目标已变化；请重新读取推送预览并再次确认。');
      }
      const observationId = await observe();
      if (disposed || generation !== generationAtStart) return;
      const reply: any = await source.push!({
        sessionId: who.sessionId,
        directory: who.directory,
        observationId,
        remote: preview.remote,
        ref: preview.ref,
        headOid: preview.headOid,
      });
      if (disposed || generation !== generationAtStart) return;
      if (reply && reply.failure) throw Error(failureOf(reply));
      if (reply && (reply.phase === 'prepared' || (!reply.outcome && reply.actionId))) {
        state.pushArmed = false;
        state.notice = '已生成推送提案，等待独立审批；批准前不会访问远端。';
        return;
      }
      if (reply && reply.outcome === 'succeeded') {
        if (reply.verified === true) {
          state.lastAction = { status: 'succeeded', kind: 'push' };
          state.pushArmed = false;
          await refresh(false);
          if (disposed || generation !== generationAtStart) return;
          state.notice = `推送已完成：${preview.headOid} → ${preview.remote} · ${preview.ref}。`;
        } else {
          state.lastAction = { status: 'unknown', kind: 'push' };
          state.pushArmed = false;
          state.notice = '推送结果未确认（git-outcome-unknown）；请核对远端，不会自动重推。';
        }
        return;
      }
      throw Error(errorText((reply && reply.reason) || 'git-unknown'));
    } catch (error) {
      if (!disposed && generation === generationAtStart) {
        state.error = messageOf(error);
        state.pushArmed = false;
      }
    } finally {
      if (!disposed && generation === generationAtStart) {
        state.busy = false;
        notify();
      }
    }
  }

  function reset(): void {
    if (disposed) return;
    ++epoch;
    ++generation;
    state.loaded = false;
    state.truncated = false;
    state.busy = false;
    state.entries = [];
    state.branch = '';
    state.stagePaths = [];
    state.unstagePaths = [];
    state.commitMessage = '';
    state.commitArmed = false;
    state.commitProposal = null;
    state.pushTarget = null;
    state.pushArmed = false;
    state.pushBusy = false;
    state.lastAction = null;
    state.error = '';
    state.notice = missingNotice(missing);
    notify();
  }

  return {
    state,
    refresh,
    toggleStagePath,
    toggleUnstagePath,
    selectAllStage,
    selectAllUnstage,
    clearSelection,
    setCommitMessage,
    armCommit,
    stageSelected,
    unstageSelected,
    commit,
    preparePush,
    armPush,
    push,
    reset,
    dispose(): void {
      disposed = true;
      ++epoch;
      ++generation;
    },
  };
}
