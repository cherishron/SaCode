/**
 * git 变更数据解析 — 变更标签优先 git（契约 §4.2）。
 *
 * 数据源是 `git status --porcelain=v1 -z` 与 `git diff` 的**原始输出**（由
 * Tauri `git_workspace_status` / `git_workspace_diff` 命令带回），本模块负责
 * 把真实字节解析成面板行。解析器与真机链路共用同一份代码，单测直接喂
 * git 产物，避免「测试另一套、线上另一套」。
 */

export interface GitStatusEntry {
  /** 工作区相对路径 */
  path: string;
  /** 重命名 / 复制的原路径（porcelain -z 下一条记录） */
  previousPath?: string;
  /** X：暂存区状态 */
  indexStatus: string;
  /** Y：工作区状态 */
  worktreeStatus: string;
  /** 面板展示用类别 */
  kind: string;
}

/** X/Y 状态码 → 变更类别（与 git status 手册的短格式一致）。 */
export function gitChangeKind(x: string, y: string): string {
  if (x === '?' || y === '?') return 'untracked';
  if (x === 'U' || y === 'U' || (x === 'A' && y === 'A') || (x === 'D' && y === 'D')) return 'conflicted';
  if (x === 'R' || y === 'R') return 'renamed';
  if (x === 'C' || y === 'C') return 'copied';
  if (x === 'A') return 'added';
  if (x === 'D' || y === 'D') return 'deleted';
  if (x === 'T' || y === 'T') return 'typechange';
  return 'modified';
}

/**
 * 解析 `git status --porcelain=v1 -z` 输出。
 *
 * 记录以 NUL 分隔；重命名 / 复制（R/C）后跟一条 origin 路径记录。
 * `--branch` 产生的 `## …` 头记录在此跳过（分支名由 Rust 侧单独给出）。
 */
export function parseGitStatusPorcelainZ(raw: string): GitStatusEntry[] {
  const records = raw.split('\0').filter((record) => record.length > 0);
  const entries: GitStatusEntry[] = [];
  for (let i = 0; i < records.length; i++) {
    const record = records[i]!;
    if (record.startsWith('## ')) continue;
    if (record.length < 3) continue;
    const x = record[0]!;
    const y = record[1]!;
    // 第 3 字符是空格；路径本身可含空格，故只截掉前缀
    const path = record.slice(3);
    if (!path) continue;
    let previousPath: string | undefined;
    if (x === 'R' || x === 'C' || y === 'R' || y === 'C') {
      previousPath = records[++i] || undefined;
    }
    entries.push({
      path,
      previousPath,
      indexStatus: x,
      worktreeStatus: y,
      kind: gitChangeKind(x, y),
    });
  }
  return entries;
}

export interface DiffStats {
  additions: number;
  deletions: number;
  binary: boolean;
}

/** 统一 diff 文本的增删行统计（跳过 +++ / --- 文件头）。 */
export function diffStats(diff: string): DiffStats {
  if (/^Binary files .+ differ$/m.test(diff) || diff.includes('GIT binary patch')) {
    return { additions: 0, deletions: 0, binary: true };
  }
  let additions = 0;
  let deletions = 0;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) additions += 1;
    else if (line.startsWith('-') && !line.startsWith('---')) deletions += 1;
  }
  return { additions, deletions, binary: false };
}

/** 变更标签行（与 getTaskChanges 的 TaskFileChange 字段对齐，便于复用同一套渲染）。 */
export interface ChangeRow {
  path: string;
  previous_path?: string;
  kind: string;
  additions: number;
  deletions: number;
  binary: boolean;
  diff: string;
}

/** git 状态条目 → 变更行；diff 由选中时懒加载填充。 */
export function gitEntryToRow(entry: GitStatusEntry): ChangeRow {
  return {
    path: entry.path,
    ...(entry.previousPath ? { previous_path: entry.previousPath } : {}),
    kind: entry.kind,
    additions: 0,
    deletions: 0,
    binary: false,
    diff: '',
  };
}

/** 把 `git diff` 文本填进变更行（懒加载后调用）。 */
export function applyDiffToRow(row: ChangeRow, diff: string, binary: boolean): ChangeRow {
  const stats = diffStats(diff);
  return {
    ...row,
    diff,
    binary: binary || stats.binary,
    additions: stats.additions,
    deletions: stats.deletions,
  };
}
