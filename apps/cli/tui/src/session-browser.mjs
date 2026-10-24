// 会话目录是Host投影；本地过滤不扫描文件、不将标题当身份。
export function validateSessionTitle(title) {
  if (typeof title !== 'string' || /[\x00-\x1f\x7f-\x9f]/.test(title)) throw new Error('会话标题不能包含换行或控制字符');
  const trimmed = title.trim();
  if (!trimmed || Buffer.byteLength(trimmed, 'utf8') > 512) throw new Error('会话标题不能为空且UTF-8长度不能超过512字节');
  return trimmed;
}

export async function sessionEntries(client, currentSessionId) {
  const reply = await client.request('session/catalog', {}, 15000);
  if (!Array.isArray(reply?.entries)) throw new Error('会话目录响应无效');
  if (reply.entries.some((entry) => !entry || typeof entry.id !== 'string' || typeof entry.title !== 'string')) throw new Error('会话条目缺少身份或标题');
  if (currentSessionId && !reply.entries.some((entry) => entry.id === currentSessionId)) {
    // 初次启动的current尚无日志文件，不在持久目录里；修订只能取Host精确投影，不能本地猜0。
    const projection = await client.request('session/projection', { sessionId: currentSessionId }, 15000);
    if (projection?.sessionId !== currentSessionId || projection.events !== 0 || projection.durable !== 0
      || reply.entries.some((entry) => entry.current)) throw new Error('当前会话目录与持久投影不一致，请退出重开核对');
    return [...reply.entries, { id: currentSessionId, title: '当前会话', durable: projection.durable, current: true, archived: false }];
  }
  return reply.entries;
}

export function browserItems(entries, query = '', archived = false, action = 'resume') {
  const needle = query.toLocaleLowerCase();
  return entries.filter((entry) => !!entry.archived === archived && (action !== 'archive' || !entry.current))
    .filter((entry) => [entry.title, entry.id, entry.workspaceDirectory || ''].some((value) => value.toLocaleLowerCase().includes(needle)))
    .map((entry) => ({ id: entry.id, entry, label: `${entry.current ? '● 当前' : entry.archived ? '归档' : '历史'} · ${entry.title || entry.id} · ${entry.id}`,
      description: `${entry.workspaceDirectory || '尚未绑定工作区'} · ${Number.isSafeInteger(entry.durable) ? `${entry.durable}条持久事件` : '修订未知'}${entry.updatedAt ? ` · ${entry.updatedAt}` : ''}` }));
}

export function metadataConfirmation(entry, action, title) {
  if (!entry?.id || !Number.isSafeInteger(entry.durable) || entry.durable < 0) throw new Error('缺少可靠会话修订号，请重新打开会话目录');
  if (action === 'rename') title = validateSessionTitle(title);
  if (!['rename', 'archive', 'restore'].includes(action)) throw new Error('不支持的会话操作');
  if (action === 'archive' && entry.current) throw new Error('请先切换到其他会话，再归档当前会话');
  return { entry: { ...entry }, action, title };
}

export async function mutateSessionMetadata(client, confirmation) {
  const { entry, action, title } = confirmation;
  metadataConfirmation(entry, action, title);
  // 确认后复查同一修订，不将新修订自动套入旧确认。
  const entries = await sessionEntries(client, action === 'rename' && entry.current ? entry.id : undefined);
  const current = entries.find((item) => item.id === entry.id);
  if (!current || current.durable !== entry.durable || !!current.archived !== !!entry.archived) throw new Error('会话已变化，请退出确认页并重新读取目录');
  if (action === 'archive' && current.current) throw new Error('目标已成为当前会话，请先切换');
  let writing = false;
  try {
    const method = action === 'rename' ? 'session/rename' : 'session/archive';
    writing = true;
    const receipt = await client.request(method, action === 'rename'
      ? { sessionId: entry.id, expectedRevision: entry.durable, title }
      : { sessionId: entry.id, expectedRevision: entry.durable, archived: action === 'archive' }, 15000);
    if (receipt?.saved !== true || receipt.sessionId !== entry.id || !Number.isSafeInteger(receipt.revision) || receipt.revision <= entry.durable) throw new Error('unconfirmed');
    const checked = (await sessionEntries(client)).find((item) => item.id === entry.id);
    if (!checked || checked.durable !== receipt.revision || (action === 'rename' ? checked.title !== title : !!checked.archived !== (action === 'archive'))) throw new Error('readback-unconfirmed');
    return checked;
  } catch (failure) {
    const raw = String(failure?.message || '');
    // Host冲突为确定拒绝，允许重开目录；其余错误不猜“没有生效”。
    const knownRejected = /session-revision-conflict|session-resources-in-flight|turn-in-flight|bad-session-title/.test(raw);
    const error = new Error(knownRejected ? '宿主拒绝本次修改，会话修订或运行状态已变化；请重新打开目录，不自动重试'
      : '会话元信息修改未确认，可能已生效；请退出重开核对，不自动重试');
    error.outcomeUnknown = writing && !knownRejected;
    throw error;
  }
}
