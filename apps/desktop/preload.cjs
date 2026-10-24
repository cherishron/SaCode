const { contextBridge, ipcRenderer } = require("electron");
// 只暴露固定动作：方法名与宿主路径都留在主进程，渲染层拼不出任意方法或参数结构。
// 没有通用的 request(everything) 通道——那等于把宿主协议面整个交给网页。
// 新域只接受普通数据对象与逐字段闭集；校验错误不包含请求值。
const ipcBad = () => { throw new TypeError('preload:invalid-arguments'); };
const ipcText = (max = 256, min = 1) => value => typeof value === 'string' && value.length >= min && value.length <= max && !value.includes('\0');
const ipcInt = (min, max = Number.MAX_SAFE_INTEGER) => value => Number.isSafeInteger(value) && value >= min && value <= max;
const ipcEnum = (...values) => value => values.includes(value);
const ipcArray = (check, max) => value => Array.isArray(value) && value.length <= max && Array.from(value).every(check);
const ipcObject = (required, optional = {}) => value => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  if (proto !== null && Object.getPrototypeOf(proto) !== null) return false;
  const fields = { ...required, ...optional };
  if (Reflect.ownKeys(value).some(key => typeof key !== 'string' || !Object.hasOwn(fields, key) || !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'))) return false;
  return Object.keys(required).every(key => Object.hasOwn(value, key) && required[key](value[key])) &&
    Object.keys(optional).every(key => !Object.hasOwn(value, key) || optional[key](value[key]));
};
const ipcRecord = (check, max = 256) => value => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  if (proto !== null && Object.getPrototypeOf(proto) !== null) return false;
  return Reflect.ownKeys(value).length <= max && Reflect.ownKeys(value).every(key =>
    typeof key === 'string' && /^[A-Za-z0-9_.:/-]{1,128}$/.test(key) && !['__proto__', 'prototype', 'constructor'].includes(key) &&
    Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value') && check(value[key]));
};
const ipcId = ipcText();
const ipcSid = { sessionId: ipcId };
const ipcOwner = { ...ipcSid, projectId: ipcId, browserId: ipcId, tabId: ipcId };
const ipcDigest = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
// 语音：录音身份只接受安全字符集的不透明 id；WAV 以有界 base64 传输（≤8 MiB 解码）。
const ipcVoiceId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value);
const ipcVoiceAudio = value => typeof value === 'string' && value.length <= 11800000 &&
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value);
const ipcFile = ipcObject({ path: value => ipcText(1024)(value) && !/[:\x00-\x1f\x7f]/.test(value) &&
  value.replace(/\\/g, '/').split('/').every(part => part && part !== '.' && part !== '..' && !/[. ]$/.test(part)), digest: ipcDigest });
const ipcBinding = { ...ipcSid, workspace: ipcText(32768), workspaceRevision: ipcInt(0) };
const ipcMapping = ipcObject({}, {
  titleMode: ipcEnum('keep', 'custom', 'prefix', 'source', 'filename'), displayTitle: ipcText(512, 0),
  prefix: ipcText(512, 0), titlePrefix: ipcText(512, 0), workspaceMode: ipcEnum('none', 'current'),
  conflictPolicy: ipcEnum('skip', 'new-copy'), updatePolicy: ipcEnum('new-only', 'allow-updates'),
  credentialBindings: ipcRecord(ipcId),
});
const ipcTarget = ipcObject({ scope: ipcEnum('user', 'project') });
const ipcPlan = { ...ipcSid, previewToken: ipcId };
const ipcPlanOptions = { mapping: ipcMapping, target: ipcTarget };
const ipcSource = ipcEnum('chatgpt-export', 'sacode-migrate', 'text-file');
const ipcMessage = ipcObject({ role: ipcEnum('user', 'assistant'), text: ipcText(1048576, 0) });
const ipcCandidateMeta = { candidateId: ipcId, title: ipcText(512, 0) };
const ipcPreview = value => {
  const common = { ...ipcSid, sourceId: ipcSource, kind: ipcEnum('conversation', 'knowledge', 'config'), mapping: ipcMapping, target: ipcTarget };
  if (!value || typeof value !== 'object') return false;
  // 分支也封闭：配置包不得混入会话候选，知识候选不得携带工具/审批历史。
  const conversation = ipcObject({ ...common, candidates: ipcArray(ipcObject({ sourceKey: ipcText(512), messages: ipcArray(ipcMessage, 10000) }, ipcCandidateMeta), 2000) });
  const knowledge = ipcObject({ ...common, candidates: ipcArray(ipcObject({ sourceKey: ipcText(512), content: ipcText(65536, 0) }, ipcCandidateMeta), 200) });
  const config = ipcObject({ ...common, payload: ipcObject({ kind: ipcEnum('config'), text: ipcText(8388608) }) });
  // 先校验数据描述符，再读分支字段，不执行来自渲染层的访问器。
  if (conversation(value) && value.kind === 'conversation' && value.sourceId === 'chatgpt-export') {
    return value.candidates.reduce((count, item) => count + item.messages.length, 0) <= 10000;
  }
  if (knowledge(value) && value.kind === 'knowledge' && value.sourceId === 'text-file') return true;
  return config(value) && value.kind === 'config' && value.sourceId === 'sacode-migrate' && value.target.scope === 'user';
};
const ipcSshArguments = value => {
  if (!ipcText(131072)(value)) return false;
  try { return ipcObject({ host: ipcText(253), command: ipcText(65536), user: ipcText(256, 0), port: ipcInt(1, 65535), timeoutMs: ipcInt(1, 300000), connectTimeoutSec: ipcInt(1, 60) })(JSON.parse(value)); } catch { return false; }
};
// MCP 服务器名与工具名共用同一套安全字符集（与 Host mcp_rpc.cj 的字节白名单一致）。
const ipcMcpName = value => typeof value === 'string' && /^[A-Za-z0-9_.-]{1,128}$/.test(value);
const ipcConnectionOwner = { ...ipcSid, scope: ipcEnum('user', 'project') };
const ipcConnectionDefinition = value => {
  const common = { id: v => typeof v === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(v), title: ipcText(600), enabled: v => typeof v === 'boolean' };
  const target = { host: ipcText(253), port: ipcInt(1, 65535), user: ipcText(256), credentialRef: v => typeof v === 'string' && /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(v) };
  const ssh = ipcObject({ ...common, kind: ipcEnum('ssh'), spec: ipcObject(target) });
  const database = ipcObject({ ...common, kind: ipcEnum('database'), spec: ipcObject({ ...target, engine: ipcEnum('postgresql', 'mysql', 'dm'), database: ipcText(256), tlsMode: ipcEnum('verify-full') }) });
  const envRef = ipcObject({ key: target.credentialRef, credentialRef: target.credentialRef });
  const stdio = ipcObject({ ...common, kind: ipcEnum('mcp'), spec: ipcObject({ transport: ipcEnum('stdio'), command: ipcText(4096), args: ipcArray(ipcText(4096, 0), 100), envRefs: ipcArray(envRef, 128) }) });
  const http = ipcObject({ ...common, kind: ipcEnum('mcp'), spec: ipcObject({ transport: ipcEnum('http'), endpoint: ipcText(4096), credentialRef: target.credentialRef }) });
  return ssh(value) || database(value) || stdio(value) || http(value);
};
// 只把 Electron 的缺 handler 错误转成明确提示；真实拒绝/失败不吞掉、不重试。
const ipcChecked = (channel, check, payload) => {
  if (!check(payload)) ipcBad();
  return ipcRenderer.invoke(channel, payload).catch(error => {
    if (typeof error?.message === 'string' && error.message.includes(`No handler registered for '${channel}'`)) {
      throw new Error(`通道未接通：preload.cjs 对应主进程 IPC 尚未接入（${channel}）。`);
    }
    throw error;
  });
};
contextBridge.exposeInMainWorld("sacode", {
  connectionList: request => ipcChecked('sacode:connectionList', ipcObject(ipcConnectionOwner), request),
  connectionSave: request => ipcChecked('sacode:connectionSave', ipcObject({ ...ipcConnectionOwner, revision: ipcInt(0), definition: ipcConnectionDefinition }), request),
  connectionControl: request => ipcChecked('sacode:connectionControl', ipcObject({ ...ipcConnectionOwner, revision: ipcInt(0), id: ipcText(80), action: ipcEnum('enable', 'disable', 'remove') }), request),
  browserViewOpen: request => ipcChecked('sacode:browserViewOpen', ipcObject({ ...ipcSid, projectId: ipcText(32768) }), request),
  browserViewDescribe: request => ipcChecked('sacode:browserViewDescribe', ipcObject({ ...ipcSid, projectId: ipcText(32768) }), request),
  browserViewBack: request => ipcChecked('sacode:browserViewBack', ipcObject({ ...ipcSid, projectId: ipcText(32768) }), request),
  browserViewForward: request => ipcChecked('sacode:browserViewForward', ipcObject({ ...ipcSid, projectId: ipcText(32768) }), request),
  browserViewReload: request => ipcChecked('sacode:browserViewReload', ipcObject({ ...ipcSid, projectId: ipcText(32768) }), request),
  browserViewClose: request => ipcChecked('sacode:browserViewClose', ipcObject({ ...ipcSid, projectId: ipcText(32768) }), request),
  browserViewNavigate: request => ipcChecked('sacode:browserViewNavigate', ipcObject({ ...ipcSid, projectId: ipcText(32768), url: value => {
    if (!ipcText(8192)(value) || /[\x00-\x20\x7f]/.test(value)) return false;
    try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password; } catch { return false; }
  } }), request),
  browserViewLayout: request => ipcChecked('sacode:browserViewLayout', ipcObject({ ...ipcSid, projectId: ipcText(32768), visible: value => typeof value === 'boolean', bounds: ipcObject({ x: ipcInt(0,32768), y: ipcInt(0,32768), width: ipcInt(0,32768), height: ipcInt(0,32768) }) }), request),
  browserNavigate: request => ipcChecked('sacode:browserNavigate', ipcObject({ ...ipcOwner, url: value => {
    if (!ipcText(8192)(value)) return false;
    try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password; } catch { return false; }
  } }), request),
  browserScreenshot: request => ipcChecked('sacode:browserScreenshot', ipcObject(ipcOwner), request),
  browserClick: request => ipcChecked('sacode:browserClick', ipcObject({ ...ipcOwner, x: ipcInt(0, 32767), y: ipcInt(0, 32767) }), request),
  browserInput: request => ipcChecked('sacode:browserInput', ipcObject({ ...ipcOwner, text: ipcText(65536, 0) }), request),
  browserScroll: request => ipcChecked('sacode:browserScroll', ipcObject({ ...ipcOwner, deltaX: ipcInt(-32767, 32767), deltaY: ipcInt(-32767, 32767) }), request),
  browserClose: request => ipcChecked('sacode:browserClose', ipcObject(ipcOwner), request),
  databaseConnect: request => ipcChecked('sacode:databaseConnect', ipcObject({ ...ipcSid, projectId: ipcId, spec: ipcObject({
    engine: ipcEnum('postgresql', 'mysql', 'dm'), host: ipcText(253), port: ipcInt(1, 65535), database: ipcText(256), user: ipcText(256), credentialRef: ipcId,
    tlsMode: ipcEnum('verify-full'), readonly: ipcEnum(true), connectTimeoutMs: ipcInt(1, 300000), statementTimeoutMs: ipcInt(1, 300000),
  }) }), request),
  databaseDisconnect: connectionId => ipcChecked('sacode:databaseDisconnect', ipcObject({ connectionId: ipcId }), { connectionId }),
  databaseQuery: request => ipcChecked('sacode:databaseQuery', ipcObject({ connectionId: ipcId, sql: ipcText(1048576),
    params: ipcArray(value => value === null || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value) || ipcText(65536, 0)(value), 1000),
    opts: ipcObject({ readonly: ipcEnum(true), maxRows: ipcInt(1, 10000), maxBytes: ipcInt(1, 16777216), statementTimeoutMs: ipcInt(1, 300000), cursorBatch: ipcInt(1, 10000) }),
  }), request),
  importSources: sessionId => ipcChecked('sacode:importSources', ipcObject(ipcSid), { sessionId }),
  importPickFile: (sessionId, sourceId) => ipcChecked('sacode:importPickFile', ipcObject({ ...ipcSid, sourceId: ipcSource }), { sessionId, sourceId }),
  importPreview: request => ipcChecked('sacode:importPreview', ipcPreview, request),
  importPlan: request => ipcChecked('sacode:importPlan', ipcObject(ipcPlan, ipcPlanOptions), request),
  importConfirm: request => ipcChecked('sacode:importConfirm', ipcObject({ ...ipcSid, planHash: ipcDigest, decisions: ipcRecord(ipcEnum('append', 'overwrite', 'skip', 'dismiss'), 2000) }), request),
  importApply: request => ipcChecked('sacode:importApply', value => ipcObject({ ...ipcSid, jobId: ipcId })(value) || ipcObject({ ...ipcSid, planHash: ipcDigest, requestId: ipcText(200) }, { selection: ipcObject({ itemIds: ipcArray(ipcId, 2000) }) })(value), request),
  importDescribe: request => ipcChecked('sacode:importDescribe', ipcObject({ ...ipcSid, jobId: ipcId }, { offset: ipcInt(0), limit: ipcInt(1, 200) }), request),
  importCancel: (sessionId, jobId) => ipcChecked('sacode:importCancel', ipcObject({ ...ipcSid, jobId: ipcId }), { sessionId, jobId }),
  // sessionId 在 terminal 域是 Host 铸造的 PTY 身份，不冒充工作台会话或改写成 terminalId。
  terminalCreate: request => ipcChecked('sacode:terminalCreate', ipcObject({ cwd: ipcText(32768), env: ipcRecord(ipcText(32768, 0)), cols: ipcInt(1, 32767), rows: ipcInt(1, 32767) }), request),
  terminalInput: (sessionId, data) => ipcChecked('sacode:terminalInput', ipcObject({ ...ipcSid, data: value => {
    if (typeof value !== 'string' || value.length > 5464 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) return false;
    return value.length / 4 * 3 - (value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0) <= 4096;
  } }), { sessionId, data }),
  terminalResize: (sessionId, cols, rows) => ipcChecked('sacode:terminalResize', ipcObject({ ...ipcSid, cols: ipcInt(1, 32767), rows: ipcInt(1, 32767) }), { sessionId, cols, rows }),
  terminalInterrupt: sessionId => ipcChecked('sacode:terminalInterrupt', ipcObject(ipcSid), { sessionId }),
  terminalDescribe: (sessionId, limit) => ipcChecked('sacode:terminalDescribe', ipcObject(ipcSid, { limit: ipcInt(1, 262144) }), { sessionId, ...(limit === undefined ? {} : { limit }) }),
  terminalClose: sessionId => ipcChecked('sacode:terminalClose', ipcObject(ipcSid), { sessionId }),
  // 交互终端直播：cursor 是 Host 侧环的单调块号；kill 停自有进程树，close 只拆视图。
  // 与既有 terminalOutput（session/terminal-output 只读回放）不同名，避免两条车道混淆。
  terminalPtyOutput: (sessionId, cursor) => ipcChecked('sacode:terminalPtyOutput', ipcObject({ ...ipcSid, cursor: ipcInt(0) }), { sessionId, cursor }),
  terminalKill: sessionId => ipcChecked('sacode:terminalKill', ipcObject(ipcSid), { sessionId }),
  compactRun: (sessionId, requestId) => ipcChecked('sacode:compactRun', ipcObject({ ...ipcSid, requestId: ipcText(128) }), { sessionId, requestId }),
  compactDescribe: sessionId => ipcChecked('sacode:compactDescribe', ipcObject(ipcSid), { sessionId }),
  securityScan: request => ipcChecked('sacode:securityScan', ipcObject({ ...ipcSid, requestId: ipcId, scope: ipcArray(ipcFile, 10000) }), request),
  securityDescribe: sessionId => ipcChecked('sacode:securityDescribe', ipcObject(ipcSid), { sessionId }),
  securityFreshness: (sessionId, scanId) => ipcChecked('sacode:securityFreshness', ipcObject({ ...ipcSid, scanId: ipcId }), { sessionId, scanId }),
  securityFixDraft: (sessionId, scanId, findingIds) => ipcChecked('sacode:securityFixDraft', ipcObject({ ...ipcSid, scanId: ipcId, findingIds: ipcArray(ipcId, 10000) }), { sessionId, scanId, findingIds }),
  sshExec: request => ipcChecked('sacode:sshExec', ipcObject({ ...ipcSid, arguments: ipcSshArguments, approvalId: ipcInt(1) }), request),
  sshDescribe: sessionId => ipcChecked('sacode:sshDescribe', ipcObject(ipcSid), { sessionId }),
  // MCP 桌面 IPC：六个动词对应 Host mcp_rpc.cj 的 list/connect/disconnect/tools/call/status。
  // connect 与 call 必须携带审批票（approvalId），与 Host 侧 ApprovalDesk.consumeExactForCall 一致。
  // 渲染层只能给出扁平参数，主进程负责打包成 Host 期望的嵌套 args JSON 字符串。
  mcpList: sessionId => ipcChecked('sacode:mcpList', ipcObject(ipcSid), { sessionId }),
  mcpConnect: request => ipcChecked('sacode:mcpConnect', ipcObject({
    ...ipcSid, name: ipcMcpName, command: ipcText(1024), args: ipcArray(ipcText(32768), 100), approvalId: ipcInt(1),
  }, { timeoutMs: ipcInt(1, 30000) }), request),
  mcpDisconnect: (sessionId, name) => ipcChecked('sacode:mcpDisconnect', ipcObject({ ...ipcSid, name: ipcMcpName }), { sessionId, name }),
  mcpTools: (sessionId, name) => ipcChecked('sacode:mcpTools', ipcObject({ ...ipcSid, name: ipcMcpName }), { sessionId, name }),
  mcpCall: request => ipcChecked('sacode:mcpCall', ipcObject({
    ...ipcSid, name: ipcMcpName, toolName: ipcMcpName, approvalId: ipcInt(1),
  }, { argumentsJson: ipcText(65536) }), request),
  mcpStatus: (sessionId, name) => ipcChecked('sacode:mcpStatus', ipcObject({ ...ipcSid, name: ipcMcpName }), { sessionId, name }),
  // 语音：录制由桌面采集层完成（WAV），主进程写本会话隔离目录后再由宿主按固定命名导入登记；
  // 转写走独立审批票（渲染层先经 approvalAsk 取票），与 Host voice_rpc.cj 一致。
  // 渲染层给不出任意落盘路径、URL 或外部执行参数。
  voiceDescribe: (sessionId, operationId) => ipcChecked('sacode:voiceDescribe', ipcObject(ipcSid, { operationId: ipcId }),
    operationId === undefined ? { sessionId } : { sessionId, operationId }),
  voiceRecord: (sessionId, requestId, recordingId, wavBase64, durationMs) => ipcChecked('sacode:voiceRecord',
    ipcObject({ ...ipcSid, requestId: ipcText(128), recordingId: ipcVoiceId, wavBase64: ipcVoiceAudio }, { durationMs: ipcInt(0, 600000) }),
    { sessionId, requestId, recordingId, wavBase64, ...(durationMs === undefined ? {} : { durationMs }) }),
  voiceTranscribe: (sessionId, requestId, recordingId, language, approvalId) => ipcChecked('sacode:voiceTranscribe',
    ipcObject({ ...ipcSid, requestId: ipcText(128), recordingId: ipcVoiceId, language: ipcEnum('zh', 'auto') }, { approvalId: ipcInt(1) }),
    { sessionId, requestId, recordingId, language, ...(approvalId === undefined ? {} : { approvalId }) }),
  voiceTranscribeCancel: (sessionId, operationId) => ipcChecked('sacode:voiceTranscribeCancel', ipcObject({ ...ipcSid, operationId: ipcId }), { sessionId, operationId }),
  automationTick: (sessionId, scopeId) => ipcChecked('sacode:automationTick', ipcObject({ ...ipcSid, scopeId: ipcId }), { sessionId, scopeId }),
  automationDescribeExecution: request => ipcChecked('sacode:automationDescribeExecution', ipcObject({ ...ipcSid, scopeId: ipcId, taskId: ipcText(80) }, { fireId: ipcId }), request),
  knowledgeIndexBuild: request => ipcChecked('sacode:knowledgeIndexBuild', ipcObject({ ...ipcBinding, indexRevision: ipcInt(0), files: ipcArray(ipcFile, 10000) }), request),
  knowledgeSearch: request => ipcChecked('sacode:knowledgeSearch', ipcObject({ ...ipcBinding, indexRevision: ipcInt(0), query: ipcText(2048, 0) }, { limit: ipcInt(1, 12) }), request),
  knowledgeDescribeIndex: request => ipcChecked('sacode:knowledgeDescribeIndex', ipcObject(ipcBinding), request),
  automationList: (sessionId,scope) => ipcRenderer.invoke('sacode:automationList',{sessionId,scope}),
  automationSave: (sessionId,scope,definition,revision) => ipcRenderer.invoke('sacode:automationSave',{sessionId,scope,definition,revision}),
  automationControl: (sessionId,scope,id,action,revision) => ipcRenderer.invoke('sacode:automationControl',{sessionId,scope,id,action,revision}),
  knowledgeList: (sessionId, scope, query) => ipcRenderer.invoke('sacode:knowledgeList', {sessionId,scope,query}),
  knowledgeImport: (sessionId, scope, id, title, path, revision) => ipcRenderer.invoke('sacode:knowledgeImport', {sessionId,scope,id,title,path,revision}),
  knowledgeReference: (sessionId, scope, id, revision) => ipcRenderer.invoke('sacode:knowledgeReference', {sessionId,scope,id,revision}),
  knowledgeSave: (sessionId, scope, id, title, content, revision) => ipcRenderer.invoke('sacode:knowledgeSave', {sessionId,scope,id,title,content,revision}),
  knowledgeRemove: (sessionId, scope, id, revision) => ipcRenderer.invoke('sacode:knowledgeRemove', {sessionId,scope,id,title:'',content:'',revision}),
  projection: () => ipcRenderer.invoke("sacode:projection"),
  acpDelegationList: (sessionId) => ipcRenderer.invoke('sacode:acpDelegationList', { sessionId }),
  acpDelegationDescribe: (sessionId, delegationId) => ipcRenderer.invoke('sacode:acpDelegationDescribe', { sessionId, delegationId }),
  acpDelegationCreate: (sessionId, taskId, requestId, peerId, taskText) => ipcRenderer.invoke('sacode:acpDelegationCreate', {sessionId, taskId, requestId, peerId, taskText}),
  acpDelegationPoll: (sessionId, delegationId) => ipcRenderer.invoke('sacode:acpDelegationPoll', {sessionId, delegationId}),
  acpDelegationAnswer: (sessionId, delegationId, approvalId, decision, optionId) => ipcRenderer.invoke('sacode:acpDelegationAnswer', {sessionId, delegationId, approvalId, decision, optionId}),
  acpDelegationCancel: (sessionId, delegationId, revision) => ipcRenderer.invoke('sacode:acpDelegationCancel', {sessionId, delegationId, revision}),
  acpDelegationClose: (sessionId, delegationId, revision) => ipcRenderer.invoke('sacode:acpDelegationClose', {sessionId, delegationId, revision}),
  acpSettingsDescribe: (sessionId, peerId) => ipcRenderer.invoke('sacode:acpSettingsDescribe', {sessionId,...(peerId===undefined?{}:{peerId})}),
  acpSettingsSetEnabled: (sessionId, enabled, revision, peerId) => ipcRenderer.invoke('sacode:acpSettingsSetEnabled', {sessionId, enabled, revision,...(peerId===undefined?{}:{peerId})}),
  acpProviderProbe: (sessionId, peerId) => ipcRenderer.invoke('sacode:acpProviderProbe', {sessionId,...(peerId===undefined?{}:{peerId})}),
  acpDiagnosticsDescribe: (sessionId, peerId) => ipcRenderer.invoke('sacode:acpDiagnosticsDescribe', {sessionId,...(peerId===undefined?{}:{peerId})}),
  acpDiagnosticsKeep: (sessionId, diagnosticId, revision, peerId) => ipcRenderer.invoke('sacode:acpDiagnosticsKeep', {sessionId, diagnosticId, revision,...(peerId===undefined?{}:{peerId})}),
  teamApprovalAnswer: (teamSessionId, memberId, approvalId, decision) => ipcRenderer.invoke('sacode:teamApprovalAnswer', {teamSessionId, memberId, approvalId, decision}),
  teamDescribe: (teamSessionId) => ipcRenderer.invoke('sacode:teamDescribe', {teamSessionId}),
  teamMemberCreate: (teamSessionId, name, role) => ipcRenderer.invoke('sacode:teamMemberCreate', {teamSessionId, name, role}),
  teamMessageSend: (teamSessionId, target, text) => ipcRenderer.invoke('sacode:teamMessageSend', {teamSessionId, target, text}),
  teamMessageBroadcast: (teamSessionId, text) => ipcRenderer.invoke('sacode:teamMessageBroadcast', {teamSessionId, text}),
  teamTaskCreate: (teamSessionId, title, dependencies) => ipcRenderer.invoke('sacode:teamTaskCreate', {teamSessionId, title, dependencies}),
  teamTaskAssign: (teamSessionId, taskId, memberId) => ipcRenderer.invoke('sacode:teamTaskAssign', {teamSessionId, taskId, memberId}),
  teamTaskClaim: (teamSessionId, taskId) => ipcRenderer.invoke('sacode:teamTaskClaim', {teamSessionId, taskId}),
  teamTaskComplete: (teamSessionId, taskId, result) => ipcRenderer.invoke('sacode:teamTaskComplete', {teamSessionId, taskId, result}),
  teamMemberStop: (teamSessionId, memberId) => ipcRenderer.invoke('sacode:teamMemberStop', {teamSessionId, memberId}),
  executionPropose: (sessionId, taskId, requestId, proposal) => ipcRenderer.invoke("sacode:executionPropose", {sessionId, taskId, requestId, proposal}),
  executionAuthorize: (sessionId, executionId, revision, proposalDigest, approvalId) => ipcRenderer.invoke("sacode:executionAuthorize", {sessionId, executionId, revision, proposalDigest, approvalId}),
  executionStart: (sessionId, executionId, revision) => ipcRenderer.invoke("sacode:executionStart", {sessionId, executionId, revision}),
  executionList: (sessionId, cursor, limit) => ipcRenderer.invoke("sacode:executionList", {sessionId, cursor, limit}),
  executionReviewFile: (sessionId, executionId, revision, path, side) => ipcRenderer.invoke("sacode:executionReviewFile", {sessionId, executionId, revision, path, side}),
  executionReviewPrepare: (sessionId, executionId, revision, requestId, paths) => ipcRenderer.invoke("sacode:executionReviewPrepare", {sessionId, executionId, revision, requestId, paths}),
  executionReviewApply: (sessionId, applyId, approvalId) => ipcRenderer.invoke("sacode:executionReviewApply", {sessionId, applyId, approvalId}),
  executionReviewApplyDescribe: (sessionId, applyId) => ipcRenderer.invoke("sacode:executionReviewApplyDescribe", {sessionId, applyId}),
  executionReviewApplyStop: (sessionId, applyId) => ipcRenderer.invoke("sacode:executionReviewApplyStop", {sessionId, applyId}),
  executionDescribe: (sessionId, executionId) => ipcRenderer.invoke("sacode:executionDescribe", {sessionId, executionId}),
  executionOutput: (sessionId, executionId, cursor, limit) => ipcRenderer.invoke("sacode:executionOutput", {sessionId, executionId, cursor, limit}),
  executionStop: (sessionId, executionId, revision) => ipcRenderer.invoke("sacode:executionStop", {sessionId, executionId, revision}),
  userSend: (text, receiptIds) => ipcRenderer.invoke("sacode:userSend", { text, receiptIds }),
  // 附件：字节只以 base64 过界一次，落盘、内容寻址 id 与暂存凭证都由核心铸造，
  // 渲染层既拿不到宿主路径，也没通路自报「我上传过这个 id」。
  attachmentUpload: (kind, name, mediaType, data) => ipcRenderer.invoke("sacode:attachmentUpload", { kind, name, mediaType, data }),
  attachmentImageRead: (sessionId, attachmentId) => ipcRenderer.invoke("sacode:attachmentImageRead", { sessionId, attachmentId }),
  goalDescribe: (sessionId) => ipcRenderer.invoke("sacode:goalDescribe", { sessionId }),
  goalCreate: (sessionId, objective) => ipcRenderer.invoke("sacode:goalCreate", { sessionId, objective }),
  goalEdit: (sessionId, revision, objective) => ipcRenderer.invoke("sacode:goalEdit", { sessionId, revision, objective }),
  goalPause: (sessionId, revision) => ipcRenderer.invoke("sacode:goalPause", { sessionId, revision }),
  goalResume: (sessionId, revision) => ipcRenderer.invoke("sacode:goalResume", { sessionId, revision }),
  goalClear: (sessionId, revision) => ipcRenderer.invoke("sacode:goalClear", { sessionId, revision }),
  toolsList: () => ipcRenderer.invoke("sacode:toolsList"),
  toolCall: (name, args, approvalId) => ipcRenderer.invoke("sacode:toolCall", { name, args, approvalId }),
  approvalAsk: (name, args) => ipcRenderer.invoke("sacode:approvalAsk", args === undefined ? { name } : { name, args }),
  approvalAnswer: (approvalId, decision) => ipcRenderer.invoke("sacode:approvalAnswer", { approvalId, decision }),
  turnStart: (limit) => ipcRenderer.invoke("sacode:turnStart", { limit }),
  // 产品路径起轮：负载是空的，渲染层改不动它，也未配置时由核心显式失败
  taskStart: (customModelId) => ipcRenderer.invoke("sacode:taskStart", { customModelId }),
  ledgerStats: () => ipcRenderer.invoke("sacode:ledgerStats"),
  // 运行中消息队列：条目由核心铸造，界面只能排、只能改自己那一条，拿不到通用转发
  queueDescribe: () => ipcRenderer.invoke("sacode:queueDescribe"),
  queueEnqueue: (text, rpcId, receiptIds, accelerated = false) => ipcRenderer.invoke("sacode:queueEnqueue", { text, rpcId, receiptIds, ...(accelerated === false ? {} : { accelerated }) }),
  queueUpdate: (itemId, kind, text) => ipcRenderer.invoke("sacode:queueUpdate", { itemId, kind, text }),
  turnPoll: () => ipcRenderer.invoke("sacode:turnPoll"),
  turnCancel: () => ipcRenderer.invoke("sacode:turnCancel"),
  // 提示词增强：负载里只有一个草稿字段。用哪颗模型、哪个端点、哪份凭据都由宿主在
  // 点击那一刻自己定——渲染层既说不出 model，也说不出 baseUrl，更没有报凭据的位置。
  promptEnhance: (draft) => ipcRenderer.invoke("sacode:promptEnhance", { draft }),
  promptPoll: () => ipcRenderer.invoke("sacode:promptPoll"),
  promptCancel: () => ipcRenderer.invoke("sacode:promptCancel"),
  usageStatus: () => ipcRenderer.invoke("sacode:usageStatus"),
  usageSetBudget: (budget) => ipcRenderer.invoke("sacode:usageSetBudget", { budget }),
  appVersion: () => ipcRenderer.invoke("sacode:appVersion"),
  autoLaunchGet: () => ipcRenderer.invoke("sacode:autoLaunchGet"),
  autoLaunchSet: (enabled) => ipcRenderer.invoke("sacode:autoLaunchSet", { enabled }),
  appearanceGet: () => ipcRenderer.invoke("sacode:appearanceGet"),
  // 使用提醒：读取/取下一条/回复后提醒/改隐藏开关，四个固定动作，不开放任意方法通道。
  // 取提示与回复后提醒不带参数——比例读数由核心算，渲染层没有可填的分子分母。
  tipsGet: () => ipcRenderer.invoke("sacode:tipsGet"),
  tipsStartup: () => ipcRenderer.invoke("sacode:tipsStartup"),
  tipsAfterReply: () => ipcRenderer.invoke("sacode:tipsAfterReply"),
  tipsSetHidden: (hidden) => ipcRenderer.invoke("sacode:tipsSetHidden", { hidden }),
  globalAppearanceGet: () => ipcRenderer.invoke("sacode:globalAppearanceGet"),
  globalAppearanceSetTheme: (theme) => ipcRenderer.invoke("sacode:globalAppearanceSetTheme", { theme }),
  globalAppearanceSetFontSize: (fontSize) => ipcRenderer.invoke("sacode:globalAppearanceSetFontSize", { fontSize }),
  globalAppearanceSetBusySend: (busySend) => ipcRenderer.invoke("sacode:globalAppearanceSetBusySend", { busySend }),
  sessionCatalog: () => ipcRenderer.invoke("sacode:sessionCatalog"),
  sessionRename: (sessionId, title, expectedRevision) => ipcRenderer.invoke("sacode:sessionRename", { sessionId, title, expectedRevision }),
  sessionArchive: (sessionId, archived, expectedRevision) => ipcRenderer.invoke("sacode:sessionArchive", { sessionId, archived, expectedRevision }),
  userQuestionAnswer: (sessionId, questionId, answers, cancelled) => ipcRenderer.invoke("sacode:userQuestionAnswer", { sessionId, questionId, answers, cancelled }),
  // 已落盘事件流（轨迹视图）：只回放 durable 事件，cursor 之后 limit 之内。
  terminalOutput: (sessionId, cursor, limit) => ipcRenderer.invoke("sacode:terminalOutput", { sessionId, cursor, limit }),
  sessionEvents: (sessionId, cursor, limit) => ipcRenderer.invoke("sacode:sessionEvents", { sessionId, cursor, limit }),
  requestTrace: (sessionId, beforeSeq, limit) => ipcRenderer.invoke("sacode:requestTrace", { sessionId, beforeSeq, limit }),
  sessionCreate: (title) => ipcRenderer.invoke("sacode:sessionCreate", { title }),
  sessionSelect: (sessionId) => ipcRenderer.invoke("sacode:sessionSelect", { sessionId }),
  // 清空会话日志真源：只收会话身份，基线（标题/目录/模式/权限/主题）由宿主保留。
  sessionClear: (sessionId) => ipcRenderer.invoke("sacode:sessionClear", { sessionId }),
  workspaceGet: () => ipcRenderer.invoke("sacode:workspaceGet"),
  workspaceGitStatus: (sessionId, directory) => ipcRenderer.invoke('sacode:workspaceGitStatus', {sessionId,directory}),
  workspaceGitDiff: (sessionId, directory, path, scope) => ipcRenderer.invoke('sacode:workspaceGitDiff', {sessionId,directory,path,scope}),
  workspaceGitPushTarget: (sessionId, directory) => ipcRenderer.invoke('sacode:workspaceGitPushTarget', {sessionId,directory}),
  workspaceChoose: () => ipcRenderer.invoke("sacode:workspaceChoose"),
  workspaceRecent: () => ipcRenderer.invoke('sacode:workspaceRecent'),
  workspaceSelectRecent: (recentId, sessionId) => ipcRenderer.invoke('sacode:workspaceSelectRecent', {recentId,sessionId}),
  // path 为空串时列工作区根；目录树展开时按相对子路径取子目录。
  workspaceFiles: (path) => ipcRenderer.invoke("sacode:workspaceFiles", { path: path || "" }),
  // 会话级隔离工作树：进入/描述/退出/清理四个固定动作，没有 worktreeRequest 之类的转发口。
  // name 与 reference 只能二选一（渲染层说不出第三个键），退出动作只有 keep/remove，
  // 删除还要在主进程过一道确认与三重保护，桌面递不出 force，也递不出目录。
  worktreeDescribe: () => ipcRenderer.invoke("sacode:worktreeDescribe", {}),
  worktreeEnter: (name, reference) => ipcRenderer.invoke("sacode:worktreeEnter", reference ? { reference } : { name }),
  worktreeExit: (name, action, discardChanges) => ipcRenderer.invoke("sacode:worktreeExit", { name, action, discardChanges }),
  worktreeCleanup: () => ipcRenderer.invoke("sacode:worktreeCleanup", {}),
  appearanceSetTheme: (theme) => ipcRenderer.invoke("sacode:appearanceSetTheme", { theme }),
  globalSettingsGet: () => ipcRenderer.invoke("sacode:globalSettingsGet"),
  profileGet: () => ipcRenderer.invoke('sacode:profileGet'),
  profileUpdate: (nickname, expectedRevision) => ipcRenderer.invoke('sacode:profileUpdate', { nickname, expectedRevision }),
  globalSettingsSet: (key, value) => ipcRenderer.invoke("sacode:globalSettingsSet", { key, value }),
  // 模型配置面：一个动作一条通道，字段形状由主进程守卫，渲染层拼不出任意宿主方法。
  modelsDescribe: () => ipcRenderer.invoke("sacode:modelsDescribe"),
  modelsCatalog: () => ipcRenderer.invoke("sacode:modelsCatalog"),
  modelsCreateInstance: (catalogId, expectedRevision) => ipcRenderer.invoke("sacode:modelsCreateInstance", { catalogId, expectedRevision }),
  modelsSaveCredential: (providerId, key, expectedRevision) => ipcRenderer.invoke('sacode:modelsSaveCredential', { providerId, key, expectedRevision }),
  modelsSave: (draft, key, expectedRevision) => ipcRenderer.invoke("sacode:modelsSave", { draft, key, expectedRevision }),
  modelsRemove: (id, expectedRevision) => ipcRenderer.invoke("sacode:modelsRemove", { id, expectedRevision }),
  modelsSetDefault: (providerId, model, expectedRevision) => ipcRenderer.invoke("sacode:modelsSetDefault", { providerId, model, expectedRevision }),
  // 供应商单列写：拖动排序与启停都不重写整条记录（内置供应商拒绝整条 update，但不拒绝这两列）。
  modelsSort: (providerId, sortOrder, expectedRevision) => ipcRenderer.invoke("sacode:modelsSort", { providerId, sortOrder, expectedRevision }),
  modelsSetEnabled: (providerId, enabled, expectedRevision) => ipcRenderer.invoke("sacode:modelsSetEnabled", { providerId, enabled, expectedRevision }),
  modelsList: (request) => ipcRenderer.invoke("sacode:modelsList", { baseUrl: request.baseUrl, apiKey: request.apiKey }),
  // 第 3 层自定义模型与模型目录写面：一个动作一条通道，字段形状由主进程守卫
  // （customs-guard.cjs），渲染层拼不出任意宿主方法，也没有「发任意请求」的通道。
  customsDescribe: () => ipcRenderer.invoke("sacode:customsDescribe"),
  customsUpsert: (draft, expectedRevision) => ipcRenderer.invoke("sacode:customsUpsert", { draft, expectedRevision }),
  customsRemove: (customId, expectedRevision) => ipcRenderer.invoke("sacode:customsRemove", { customId, expectedRevision }),
  bindingUpsert: (customId, binding, expectedRevision) => ipcRenderer.invoke("sacode:bindingUpsert", { customId, binding, expectedRevision }),
  bindingRemove: (customId, providerId, modelId, expectedRevision) => ipcRenderer.invoke("sacode:bindingRemove", { customId, providerId, modelId, expectedRevision }),
  bindingReorder: (customId, keys, expectedRevision) => ipcRenderer.invoke("sacode:bindingReorder", { customId, keys, expectedRevision }),
  modelPull: (providerId, expectedRevision, operationId) => ipcRenderer.invoke("sacode:modelPull", { providerId, expectedRevision, ...(operationId === undefined ? {} : { operationId }) }),
  modelPullDescribe: (operationId) => ipcRenderer.invoke("sacode:modelPullDescribe", { operationId }),
  modelPullCancel: (operationId) => ipcRenderer.invoke("sacode:modelPullCancel", { operationId }),
  modelUpstreamUpsert: (providerId, modelId, expectedRevision) => ipcRenderer.invoke("sacode:modelUpstreamUpsert", { providerId, modelId, expectedRevision }),
  customImportNew: (items, expectedRevision) => ipcRenderer.invoke("sacode:customImportNew", { items, expectedRevision }),
  customImportInto: (customId, items, expectedRevision) => ipcRenderer.invoke("sacode:customImportInto", { customId, items, expectedRevision }),
  // 插件清单：逐字段校验通道（缺通道时适配器保持 unconnected，不冒充本地状态）
  pluginsDescribe: () => ipcRenderer.invoke("sacode:pluginsDescribe"),
  pluginsSetEnabled: (name, enabled, expectedRevision) => ipcRenderer.invoke("sacode:pluginsSetEnabled", { name, enabled, expectedRevision }),
  pluginsSetRowEnabled: (entryId, enabled, expectedRevision) => ipcRenderer.invoke("sacode:pluginsSetRowEnabled", { entryId, enabled, expectedRevision }),
  pluginsUninstall: (name, expectedRevision) => ipcRenderer.invoke("sacode:pluginsUninstall", { name, expectedRevision }),
  pluginsRegistries: () => ipcRenderer.invoke("sacode:pluginsRegistries"),
  pluginsInspect: (spec, registry) => ipcRenderer.invoke("sacode:pluginsInspect", { spec, registry }),
  pluginsInstall: (request) => ipcRenderer.invoke("sacode:pluginsInstall", { spec: request?.spec, registry: request?.registry, requestId: request?.requestId, approvedBuilds: request?.approvedBuilds }),
  pluginsInstallPoll: (requestId) => ipcRenderer.invoke("sacode:pluginsInstallPoll", { requestId }),
  pluginsInstallCancel: (requestId) => ipcRenderer.invoke("sacode:pluginsInstallCancel", { requestId }),
  // 网络搜索设置面：3 条固定动作，修订号屏障与补丁键位由主进程守卫（web-settings-ipc.cjs）。
  // 密钥只走独立凭证通道；设置快照里永远不出现密钥本体。
  webSettingsDescribe: () => ipcRenderer.invoke("sacode:webSettingsDescribe"),
  webSettingsApply: (expectedRevision, patch) => ipcRenderer.invoke("sacode:webSettingsApply", { expectedRevision, patch }),
  webSettingsSetCredential: (providerId, key) => ipcRenderer.invoke("sacode:webSettingsSetCredential", { providerId, key }),
  // LSP 语义工具（L1）：7 个固定动作，位置是 0 起始行 + UTF-16 列。
  // 没有 request(method, params) 这种万能通道——渲染层拼不出第四个键，也说不出动词之外的路径。
  lspDefine: (path, line, character, documentVersion) => ipcRenderer.invoke("sacode:lspDefine", documentVersion === undefined ? { path, line, character } : { path, line, character, documentVersion }),
  lspLookup: (path, line, character, documentVersion) => ipcRenderer.invoke("sacode:lspLookup", documentVersion === undefined ? { path, line, character } : { path, line, character, documentVersion }),
  lspReferences: (path, line, character, includeDeclaration, documentVersion) => ipcRenderer.invoke("sacode:lspReferences", { path, line, character, ...(includeDeclaration === undefined ? {} : { includeDeclaration }), ...(documentVersion === undefined ? {} : { documentVersion }) }),
  lspImplementation: (path, line, character, documentVersion) => ipcRenderer.invoke("sacode:lspImplementation", documentVersion === undefined ? { path, line, character } : { path, line, character, documentVersion }),
  lspCallHierarchy: (path, line, character, direction, documentVersion) => ipcRenderer.invoke("sacode:lspCallHierarchy", documentVersion === undefined ? { path, line, character, direction } : { path, line, character, direction, documentVersion }),
  lspDiagnostics: (path, documentVersion) => ipcRenderer.invoke("sacode:lspDiagnostics", documentVersion === undefined ? { path } : { path, documentVersion }),
  lspRename: (path, line, character, newName, documentVersion) => ipcRenderer.invoke("sacode:lspRename", documentVersion === undefined ? { path, line, character, newName } : { path, line, character, newName, documentVersion }),
  // Next SDK 页面工具：列出与调用
  pageToolsList: () => ipcRenderer.invoke("sacode:pageToolsList"),
  pageToolCall: (name, args) => ipcRenderer.invoke("sacode:pageToolCall", { name, args }),
  approvalSetMode: (mode) => ipcRenderer.invoke("sacode:approvalSetMode", { mode }),
  approvalGetMode: () => ipcRenderer.invoke("sacode:approvalGetMode"),
  // 计划模式与计划审阅（方案 B 独立通道）：进/退 + 答复，逐字段在 main.cjs 校验。
  planSetMode: (active) => ipcRenderer.invoke("sacode:planSetMode", { active }),
  planGetMode: () => ipcRenderer.invoke("sacode:planGetMode"),
  planReviewAnswer: (sessionId, planId, decision, feedback, cancelled) => ipcRenderer.invoke("sacode:planReviewAnswer", { sessionId, planId, decision, feedback, cancelled }),
});
