const archiveKey = (workspace: string) => `sacode.session.archived.${workspace}`;

export function readArchivedSessions(storage: Pick<Storage, 'getItem'>, workspace: string): Set<string> {
  try {
    const value: unknown = JSON.parse(storage.getItem(archiveKey(workspace)) || '[]');
    return new Set(Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : []);
  } catch {
    return new Set();
  }
}

export function setSessionArchived(storage: Pick<Storage, 'getItem' | 'setItem'>, workspace: string, id: string, archived: boolean): void {
  const ids = readArchivedSessions(storage, workspace);
  if (archived) ids.add(id);
  else ids.delete(id);
  storage.setItem(archiveKey(workspace), JSON.stringify([...ids]));
}

export function updateUnreadSessions(
  previousStatuses: Map<string, string>,
  unread: Set<string>,
  sessions: ReadonlyArray<{ id: string; status: string }>,
  visibleIds: ReadonlySet<string>,
): void {
  const ids = new Set(sessions.map((session) => session.id));
  for (const id of previousStatuses.keys()) if (!ids.has(id)) previousStatuses.delete(id);
  for (const id of unread) if (!ids.has(id) || visibleIds.has(id)) unread.delete(id);
  for (const session of sessions) {
    const previous = previousStatuses.get(session.id);
    if (previous && ['running', 'pending', 'ready', 'retrying'].includes(previous)
      && ['completed', 'failed', 'cancelled'].includes(session.status)
      && !visibleIds.has(session.id)) unread.add(session.id);
    previousStatuses.set(session.id, session.status);
  }
}
