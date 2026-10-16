// LSP 语义工具（L1）：7 个动作、7 条通道，method 名在主进程写死。
// 键集是 verb 的函数：渲染层说不出第四个键，更没有「发任意 method」的通路。
// 没有语言插件时宿主如实回 error（data.reason=lsp-no-server + 非语义线索），
// 主进程不在此把失败改写成空数组——空数组会被界面读成「这个符号没有定义」。

const lspKeyGuard = {
  path: (v) => typeof v === "string" && v.trim().length > 0 && v.length <= 1000,
  line: (v) => Number.isSafeInteger(v) && v >= 0,
  character: (v) => Number.isSafeInteger(v) && v >= 0,
  documentVersion: (v) => Number.isSafeInteger(v) && v >= 0,
  direction: (v) => v === "incoming" || v === "outgoing",
  includeDeclaration: (v) => typeof v === "boolean",
  newName: (v) => typeof v === "string" && v.trim().length > 0 && v.length <= 500,
};

function lspArguments(args, extras) {
  if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("bad arguments");
  const allowed = new Set(["path", ...extras]);
  for (const key of Object.keys(args)) {
    if (!allowed.has(key)) throw new Error("bad arguments");
    if (!lspKeyGuard[key]) throw new Error("bad arguments");
    if (!lspKeyGuard[key](args[key])) throw new Error("bad arguments");
  }
  if (!lspKeyGuard.path(args.path)) throw new Error("bad arguments");
  for (const key of ["line", "character", "direction", "newName"]) {
    if (extras.includes(key) && !Object.hasOwn(args, key)) throw new Error("bad arguments");
  }
  const params = { path: args.path };
  for (const key of extras) { if (args[key] !== undefined) params[key] = args[key]; }
  return params;
}

const lspActions = [
  ['lspDefine', 'lsp/define', ['line', 'character', 'documentVersion']],
  ['lspLookup', 'lsp/lookup', ['line', 'character', 'documentVersion']],
  ['lspReferences', 'lsp/references', ['line', 'character', 'includeDeclaration', 'documentVersion']],
  ['lspImplementation', 'lsp/implementation', ['line', 'character', 'documentVersion']],
  ['lspCallHierarchy', 'lsp/call-hierarchy', ['line', 'character', 'direction', 'documentVersion']],
  ['lspDiagnostics', 'lsp/diagnostics', ['documentVersion']],
  ['lspRename', 'lsp/rename', ['line', 'character', 'newName', 'documentVersion']],
];

function registerLspIpc(ipcMain, request) {
  for (const [action, method, extras] of lspActions) {
    ipcMain.handle(`sacode:${action}`, async (_e, args) => {
      const params = lspArguments(args, extras);
      return request(method, params);
    });
  }
}

module.exports = { registerLspIpc };
