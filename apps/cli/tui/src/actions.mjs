// 仅适配已核实 Host 契约，不在 TUI 里复制业务状态机。
export async function readSession(client) {
  const [catalog, workspace, usage, projection] = await Promise.all([
    client.request("session/catalog", {}, 15000),
    client.request("workspace/get", {}, 15000),
    client.request("usage/status", {}, 15000),
    client.request("session/projection", {}, 15000),
  ]);
  const current = catalog.entries?.find((entry) => entry.current);
  return { sessionId: projection.sessionId || current?.id || "", title: current?.title || "当前会话",
    directory: workspace.directory || catalog.root || "", usage, projection };
}

export async function selectSession(client, sessionId) {
  const result = await client.request("session/select", { sessionId }, 15000);
  if (result?.selected !== true || result.id !== sessionId) throw new Error("session-selection-unconfirmed");
  const snapshot = await readSession(client);
  if (snapshot.sessionId !== sessionId) throw new Error("session-readback-mismatch");
  return snapshot;
}

export async function modelOptions(client) {
  // model/list 会访问供应商，不能拿来渲染本地选择器。
  const view = await client.request("custom/describe", {}, 15000);
  return [
    { id: "", label: "宿主默认路由（不覆盖默认配置）", description: '使用Host当前默认；配置与连通性需分别核对，不在选择时联网测试' },
    ...(Array.isArray(view?.models) ? view.models : [])
      .filter((model) => model.enabled === true && model.bindings?.some((binding) => binding.enabled === true))
      .map((model) => ({ id: model.id, label: `${model.name || model.id} · ${model.id}`,
        description: `已启用，${model.bindings.filter((binding) => binding.enabled === true).length}个启用绑定；凭据/连通性未验证，仅本进程选择` })),
  ];
}

export function toolsWithResults(projection) {
  const rows = new Map((projection?.messageRows || []).filter((row) => row.eventType === "tool/result").map((row) => [row.id, row.text]));
  return (projection?.toolCalls || []).map((call) => ({ ...call, resultText: rows.get(call.resultMessageId) }));
}
