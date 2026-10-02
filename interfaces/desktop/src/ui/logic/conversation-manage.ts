/**
 * 会话管理动作 — 契约 §3.2（重命名 / 归档 / 恢复 / 删除）。
 *
 * Agent4 尚未提供 rename / archive / restore 端点时，走 localStorage 兜底；
 * 一旦 daemon-client 挂上同名方法（鸭子类型探测），自动切到真 API。
 * TODO(Agent4): 落地 PUT /api/desktop/conversations/:id、
 *               POST .../archive、POST .../restore 后删除 localStorage 兜底。
 */
import {
  readArchivedSessions,
  setSessionArchived,
} from './session-visibility.ts';

/** 与 useDesktopApp.titleOf 读取的键一致，保证本地重命名立即生效。 */
const titleKey = (id: string) => `sacode.session.title.${id}`;

export interface ConversationManageClient {
  deleteDesktopConversation(id: string): Promise<void>;
  /** Agent4 落地后可选出现 */
  renameDesktopConversation?(id: string, title: string): Promise<void>;
  archiveDesktopConversation?(id: string): Promise<void>;
  restoreDesktopConversation?(id: string): Promise<void>;
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function localRename(id: string, title: string, storage: StorageLike | null) {
  if (!storage) return;
  try {
    if (title) storage.setItem(titleKey(id), title);
    else storage.removeItem(titleKey(id));
  } catch {
    /* ignore quota / private mode */
  }
}

/**
 * 重命名：优先 PUT /api/desktop/conversations/:id { title }；
 * 无该方法时写 localStorage（titleOf 读取处），并打 TODO。
 */
export async function renameConversation(
  client: ConversationManageClient | null | undefined,
  id: string,
  title: string,
  storage: StorageLike | null = defaultStorage(),
): Promise<{ usedApi: boolean }> {
  const next = title.trim();
  if (client && typeof client.renameDesktopConversation === 'function') {
    await client.renameDesktopConversation(id, next);
    // API 落盘后同步本地，避免刷新前列表闪回旧题
    localRename(id, next, storage);
    return { usedApi: true };
  }
  // TODO(Agent4): 换成真 API — 当前仅本地
  localRename(id, next, storage);
  return { usedApi: false };
}

/**
 * 归档：优先 POST /api/desktop/conversations/:id/archive；
 * 无该方法时写 localStorage 归档集合。
 */
export async function archiveConversation(
  client: ConversationManageClient | null | undefined,
  id: string,
  workspace: string,
  storage: StorageLike | null = defaultStorage(),
): Promise<{ usedApi: boolean }> {
  if (client && typeof client.archiveDesktopConversation === 'function') {
    await client.archiveDesktopConversation(id);
    return { usedApi: true };
  }
  // TODO(Agent4): 换成真 API — 当前仅本地
  if (storage) setSessionArchived(storage, workspace, id, true);
  return { usedApi: false };
}

/**
 * 恢复：优先 POST /api/desktop/conversations/:id/restore；
 * 无该方法时从本地归档集合移除。
 */
export async function restoreConversation(
  client: ConversationManageClient | null | undefined,
  id: string,
  workspace: string,
  storage: StorageLike | null = defaultStorage(),
): Promise<{ usedApi: boolean }> {
  if (client && typeof client.restoreDesktopConversation === 'function') {
    await client.restoreDesktopConversation(id);
    return { usedApi: true };
  }
  // TODO(Agent4): 换成真 API — 当前仅本地
  if (storage) setSessionArchived(storage, workspace, id, false);
  return { usedApi: false };
}

/** 删除：API 已存在，直接调用。 */
export async function deleteConversation(
  client: ConversationManageClient | null | undefined,
  id: string,
): Promise<void> {
  if (!client) throw new Error('守护进程客户端不可用');
  await client.deleteDesktopConversation(id);
}

/** 读取本地归档 id 集合（API 就绪后应改读会话的 archived 字段）。 */
export function readLocalArchived(
  workspace: string,
  storage: StorageLike | null = defaultStorage(),
): Set<string> {
  if (!storage) return new Set();
  return readArchivedSessions(storage, workspace);
}
