// 工作台布局存档：分格树（split-tree 语义）+ 每格会话/工具栏 + 任务列宽。
// 落盘键 `sacode.layout.<workspace>`（契约 §6）。纯函数，读写 localStorage
// 收口在 save/load，形状校验失败整档作废，不半修复。
import { leaves, validateTree, type SplitNode } from './split-tree.ts';

export type ToolsTabId = 'files' | 'changes' | 'terminal' | 'preview';
export type PaneMode = 'empty' | 'create' | 'chat';

export interface SavedPaneTools {
  open: boolean;
  tab: ToolsTabId;
  width: number;
  treeWidth: number;
}

export interface SavedPane {
  conversationId: string | null;
  title: string;
  mode: PaneMode;
  tools: SavedPaneTools;
}

export interface SavedWorkbench {
  version: 1;
  tree: SplitNode;
  /** 按槽号索引，允许空洞（关闭叶后槽号不重排） */
  slots: (SavedPane | null)[];
  focusSlot: number;
  taskColWidth?: number;
}

export const TOOLS_TAB_IDS: readonly ToolsTabId[] = ['files', 'changes', 'terminal', 'preview'];

export const TOOLS_WIDTH_DEFAULT = 520;
export const TOOLS_WIDTH_MIN = 240;
export const TOOLS_TREE_DEFAULT = 190;
export const TOOLS_TREE_MIN = 120;

export const TASK_COL_WIDTH_DEFAULT = 232;
export const TASK_COL_WIDTH_MIN = 184;
export const TASK_COL_WIDTH_MAX = 420;

const MAX_SLOTS = 32;

export function layoutStorageKey(workspace: string): string {
  return `sacode.layout.${workspace || 'default'}`;
}

const isToolsTab = (value: unknown): value is ToolsTabId =>
  typeof value === 'string' && (TOOLS_TAB_IDS as readonly string[]).includes(value);

const isPaneMode = (value: unknown): value is PaneMode =>
  value === 'empty' || value === 'create' || value === 'chat';

const clampNumber = (value: unknown, min: number, max: number, fallback: number): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
};

function restoreTools(raw: unknown): SavedPaneTools {
  const value = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    open: value.open === true,
    tab: isToolsTab(value.tab) ? value.tab : 'files',
    width: Math.round(clampNumber(value.width, TOOLS_WIDTH_MIN, 2000, TOOLS_WIDTH_DEFAULT)),
    treeWidth: Math.round(clampNumber(value.treeWidth, TOOLS_TREE_MIN, 640, TOOLS_TREE_DEFAULT)),
  };
}

function restorePane(raw: unknown): SavedPane | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  return {
    conversationId: typeof value.conversationId === 'string' && value.conversationId ? value.conversationId : null,
    title: typeof value.title === 'string' && value.title ? value.title : '空格',
    mode: isPaneMode(value.mode) ? value.mode : 'empty',
    tools: restoreTools(value.tools),
  };
}

/** 坏档（手改/旧格式/形状不符）返回 null，调用方回退默认布局。 */
export function restoreWorkbench(raw: string | null): SavedWorkbench | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const value = parsed as Record<string, unknown>;
  if (value.version !== 1) return null;
  const tree = validateTree(value.tree);
  if (!tree) return null;
  if (!Array.isArray(value.slots) || value.slots.length > MAX_SLOTS) return null;

  const used = new Set(leaves(tree));
  for (const slot of used) {
    if (slot >= MAX_SLOTS) return null;
  }
  const slots: (SavedPane | null)[] = Array.from({ length: value.slots.length }, () => null);
  for (let i = 0; i < value.slots.length; i++) {
    // 树上不存在的槽内容丢弃，避免关格后的孤儿会话复活
    slots[i] = used.has(i) ? restorePane(value.slots[i]) : null;
  }
  for (const slot of used) {
    if (!slots[slot]) slots[slot] = restorePane(null);
  }

  const focusSlot =
    typeof value.focusSlot === 'number' && Number.isSafeInteger(value.focusSlot) && used.has(value.focusSlot)
      ? value.focusSlot
      : leaves(tree)[0]!;

  const taskColWidth =
    value.taskColWidth === undefined
      ? undefined
      : Math.round(clampNumber(value.taskColWidth, TASK_COL_WIDTH_MIN, TASK_COL_WIDTH_MAX, TASK_COL_WIDTH_DEFAULT));

  return { version: 1, tree, slots, focusSlot, taskColWidth };
}

export function serializeWorkbench(value: SavedWorkbench): string {
  return JSON.stringify(value);
}

export function loadWorkbench(workspace: string): SavedWorkbench | null {
  try {
    return restoreWorkbench(localStorage.getItem(layoutStorageKey(workspace)));
  } catch {
    return null;
  }
}

export function saveWorkbench(workspace: string, value: SavedWorkbench): void {
  try {
    localStorage.setItem(layoutStorageKey(workspace), serializeWorkbench(value));
  } catch {
    /* ignore quota / private mode */
  }
}
