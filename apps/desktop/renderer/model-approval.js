(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SaCodeModelApproval = api;
})(globalThis, function () {
  function takeRequests(bridge, turnRequestId) {
    const requests = [], retained = [];
    for (const message of bridge.notifications) {
      if (message.method === 'approval/asked' && message.params?.source === 'model' && (turnRequestId === undefined || !message.params.turnRequestId || message.params.turnRequestId === turnRequestId)) requests.push(message.params);
      else retained.push(message);
    }
    bridge.notifications.splice(0, bridge.notifications.length, ...retained);
    return requests;
  }
  function discardPreviousRequests(bridge, turnRequestId) {
    const retained = bridge.notifications.filter(message => !(message.method === 'approval/asked' && message.params?.source === 'model' && message.params.turnRequestId && message.params.turnRequestId !== turnRequestId));
    bridge.notifications.splice(0, bridge.notifications.length, ...retained);
  }
  function selectProposal(requests, sessionId, running, turnRequestId) {
    if (!running) return null;
    let selected = null;
    for (const value of requests || []) {
      if (!value || value.source !== 'model' || value.sessionId !== sessionId) continue;
      if (typeof value.turnRequestId !== 'string' || !value.turnRequestId) throw Error('模型审批缺少起轮请求身份');
      if (value.turnRequestId !== turnRequestId) continue;
      if (!Number.isSafeInteger(value.approvalId) || value.approvalId < 1 || typeof value.tool !== 'string' || !value.tool.trim() || typeof value.argumentsJson !== 'string') throw Error('模型审批提案身份或参数不完整');
      const args = JSON.parse(value.argumentsJson);
      if (!args || typeof args !== 'object' || Array.isArray(args)) throw Error('模型审批参数必须为对象');
      if (selected && (selected.approvalId !== value.approvalId || selected.name !== value.tool || selected.argumentsJson !== value.argumentsJson)) throw Error('模型审批提案冲突');
      selected = Object.freeze({ source: 'model', sessionId, turnRequestId, approvalId: value.approvalId, name: value.tool, argumentsJson: value.argumentsJson, displayArguments: JSON.stringify(args, null, 2) });
    }
    return selected;
  }
  async function answer(api, proposal, decision, current) {
    if (proposal?.source !== 'model' || !['allowed-once', 'denied'].includes(decision)) throw Error('无效的模型审批应答');
    if (!current()) return { stale: true };
    const result = await api.approvalAnswer(proposal.approvalId, decision);
    return current() ? result : { stale: true };
  }
  return { takeRequests, discardPreviousRequests, selectProposal, answer };
});
