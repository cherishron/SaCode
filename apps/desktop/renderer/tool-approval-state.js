// 工具审批：发号、应答、调用。审批凭据只认工单号，不认自报字符串。
// 模型来源的审批委托给 ModelApproval.answer 做过期判定与路由。
// 经典脚本（CSP script-src 'self'）。

(function (root) {
  'use strict';

  function createToolApprovalAssembly(deps) {
    const {
      api, ref,
      turn, approval, error, outcome, outcomeKind,
      fileEditor,
      getSessionGeneration, getPollGeneration,
      modelApprovalsSuppressed, selectedScrollId, modelTurnRequestId,
      cleanErr, refreshTools, refresh,
    } = deps;

    async function askTool(t) {
      if (t.needsApproval && (turn.value.running || approval.value)) {
        error.value = '请先处理当前任务和审批请求。'; return;
      }
      if (fileEditor.state.busy) { error.value = '文件编辑正在处理工具请求，请稍后重试。'; return; }
      const generation = getSessionGeneration();
      outcome.value = '';
      outcomeKind.value = '';
      if (!t.needsApproval) {
        await callTool(t.name, 0);
        return;
      }
      try {
        const a = await api.approvalAsk(t.name);
        if (generation !== getSessionGeneration()) return;
        approval.value = { name: t.name, description: t.description, approvalId: a.approvalId };
      } catch (e) {
        if (generation !== getSessionGeneration()) return;
        approval.value = null;
        outcomeKind.value = 'outcome outcome-denied';
        outcome.value = '发号失败：' + cleanErr(e);
      }
    }

    async function answerTool(approvalAnswer) {
      if (fileEditor.state.busy) return;
      const generation = getSessionGeneration();
      const a = approval.value;
      approval.value = null;
      if (!a) return;
      if (a.source === 'model') {
        const epoch = getPollGeneration();
        const current = () => generation === getSessionGeneration() && epoch === getPollGeneration() && !modelApprovalsSuppressed.value && turn.value.running && a.sessionId === String(selectedScrollId.value) && a.turnRequestId === modelTurnRequestId.value;
        try {
          const result = await root.SaCodeModelApproval.answer(api, a, approvalAnswer, current);
          if (!current() || result.stale) return;
          if (!result.accepted) { outcomeKind.value = 'outcome outcome-denied'; outcome.value = '模型审批工单已失效：' + result.state; }
        } catch (e) { if (current()) { outcomeKind.value = 'outcome outcome-denied'; outcome.value = '应答失败：' + cleanErr(e); } }
        return;
      }
      try {
        const r = await api.approvalAnswer(a.approvalId, approvalAnswer);
        if (generation !== getSessionGeneration()) return;
        if (!r.accepted) {
          outcomeKind.value = 'outcome outcome-denied';
          outcome.value = '应答未被接受：工单状态 ' + r.state;
          return;
        }
      } catch (e) {
        if (generation !== getSessionGeneration()) return;
        outcomeKind.value = 'outcome outcome-denied';
        outcome.value = '应答失败：' + cleanErr(e);
        return;
      }
      await callTool(a.name, a.approvalId);
    }

    async function callTool(name, approvalId) {
      if (fileEditor.state.busy) return;
      const generation = getSessionGeneration();
      if (!name) return;
      const args = name === 'read' ? 'sacode-tool.txt' : 'sacode-tool.txt hello-from-renderer';
      try {
        const r = await api.toolCall(name, args, approvalId || 0);
        if (generation !== getSessionGeneration()) return;
        outcomeKind.value = '';
        outcome.value = '结果：' + r.result;
      } catch (e) {
        if (generation !== getSessionGeneration()) return;
        outcomeKind.value = 'outcome outcome-denied';
        outcome.value = '被拒：' + cleanErr(e);
      }
      await refreshTools();
      await refresh();
    }

    return { askTool, answerTool, callTool };
  }

  root.SaCodeToolApproval = { createToolApprovalAssembly };
})(globalThis);
