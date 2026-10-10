// 发送/队列/轮次控制：发送消息、运行中入队、起轮、取消轮次。
// 起轮与轮询双向依赖：startTask 调 startPolling/stopPolling，
// turn-poll 结算后续队列时调 startTask——用前向声明函数解决。
// 经典脚本（CSP script-src 'self'）。

(function (root) {
  'use strict';

  function createSendQueueAssembly(deps) {
    const {
      api, ref,
      draft, error, turn, approval, sendBusy,
      queuePending, queueRows,
      fileEditor, attachments, uploads,
      selectedCustomModel, modelDirectory,
      globalAppearance,
      getSessionGeneration, getDraftRevision, getSendTicket, incrementSendTicket,
      getRpcSeq, incrementRpcSeq,
      modelApprovalsSuppressed, modelTurnRequestId,
      getPollGeneration,
      startPolling, stopPolling,
      clearEnhance, clearAttachments, removeAttachment,
      updateDraft, refresh, refreshCatalog, projectQueueRow,
    } = deps;

    async function refreshQueue() {
      const generation = getSessionGeneration();
      let view;
      try { view = await api.queueDescribe(); } catch (e) { return; }
      if (generation !== getSessionGeneration()) return;
      queueRows.value = (view.nextTurn || []).map(projectQueueRow);
      const admitted = new Set(queueRows.value.map(row => row.source.rpcId));
      queuePending.value = queuePending.value.filter(item => !admitted.has(item.requestId));
    }

    async function updateQueue(id, action) {
      const text = action.kind === 'edit' ? (action.content || []).map(block => block.type === 'text' ? block.text || '' : '').join('') : '';
      await api.queueUpdate(id, action.kind, text);
      await refreshQueue();
    }

    function cleanErr(e) {
      return String((e && e.message) || e).replace(/^Error invoking remote method '[^']+': /, '');
    }

    function imageDraftAllowed() {
      if (!attachments.value.some((a) => a.kind === 'image')) return true;
      const view = modelDirectory.getSnapshot();
      const group = view.groups.find((g) => g.id === view.current?.provider);
      const model = group?.models.find((m) => m.id === view.current?.model);
      if (view.status === 'ready' && model?.image === true) return true;
      error.value = '当前模型未声明支持图片，请选择支持图片的模型或移除图片附件。';
      return false;
    }

    const turnStartFailure = (code) => ({
      'model-not-configured': '还没有配置模型：消息已存入会话，请到设置 → 模型添加提供商并设为默认。',
      'model-credential-unavailable': '提供商还没有可用凭据：消息已存入会话，请到设置 → 模型填入 API 密钥。',
      'model-image-not-supported': '当前模型未声明支持图片：会话已保留，请选择支持图片的模型后重试。',
      'over-budget': '本轮额度已用满：消息已存入会话，请新建会话继续。',
      'turn-in-flight': '上一轮还在执行，请稍候。',
      'already-owned': '会话正被另一个入口占用，请稍候再试。',
      'replay-rejected': '会话日志回放被拒，消息未起轮；请检查会话文件是否完整。',
      'provider-init-failed': '连不上模型服务：消息已存入会话，请检查 API 地址与网络。',
      'flush-failed': '会话未能落盘，消息只在内存里可见。',
      'custom-model-not-found': '这个自定义模型已经不在清单里：消息已存入会话，发送入口已改回默认模型，请直接重试。',
    })[code] || ('起轮失败：' + code);

    async function enqueueDraft(accelerated) {
      if (globalAppearance.value.busySend !== 'queue' && globalAppearance.value.busySend !== 'steer') {
        error.value = '发送偏好尚未读取，请在设置中重新读取后再发送。'; return;
      }
      sendBusy.value = true;
      try { await submitBusyDraft(accelerated); } finally { sendBusy.value = false; }
    }

    async function submitBusyDraft(accelerated) {
      const generation = getSessionGeneration();
      const text = draft.value, revision = getDraftRevision();
      if (!text.trim()) return;
      if (text.length > 8000) { error.value = '消息最多支持 8000 个字符，请缩短后重试。'; return; }
      if (!imageDraftAllowed()) return;
      const requestId = 'r' + (incrementRpcSeq());
      error.value = '';
      if (attachments.value.some((a) => !a.receiptId)) {
        error.value = attachments.value.some((a) => (uploads.value[a.id] || {}).status === 'error')
          ? '有附件上传失败，请重试或先移除' : '附件还在上传，请等它就绪';
        return;
      }
      const receipts = attachments.value.map((a) => a.receiptId);
      const submittedIds = attachments.value.map((a) => a.id);
      queuePending.value = queuePending.value.concat([{ requestId, placement: 'queued', text, attachments: [] }]);
      try {
        await api.queueEnqueue(text, requestId, receipts, accelerated);
        queuePending.value = queuePending.value.filter((p) => p.requestId !== requestId);
        if (generation !== getSessionGeneration()) return;
        if (getDraftRevision() === revision) { clearEnhance(); updateDraft(''); }
        for (const id of submittedIds) removeAttachment(id);
        await refreshQueue();
      } catch (e) {
        queuePending.value = queuePending.value.filter((p) => p.requestId !== requestId);
        if (generation === getSessionGeneration()) error.value = '发送补充失败：' + cleanErr(e);
      }
    }

    async function send(accelerated) {
      if (fileEditor.state.busy) { error.value = '文件正在读取或保存，请稍后发送。'; return; }
      if (sendBusy.value) return;
      if (turn.value.running) { await enqueueDraft(accelerated); return; }
      const generation = getSessionGeneration();
      const text = draft.value, revision = getDraftRevision();
      if (!text.trim()) return;
      const ticket = incrementSendTicket();
      if (!imageDraftAllowed()) return;
      let acknowledged = false;
      if (attachments.value.some((a) => !a.receiptId)) {
        error.value = attachments.value.some((a) => (uploads.value[a.id] || {}).status === 'error')
          ? '有附件上传失败，请重试或先移除' : '附件还在上传，请等它就绪';
        return;
      }
      const receipts = attachments.value.map((a) => a.receiptId);
      sendBusy.value = true;
      error.value = '';
      try {
        await api.userSend(text, receipts);
        if (generation !== getSessionGeneration()) return;
        acknowledged = true;
        sendBusy.value = false;
        if (getDraftRevision() === revision) { clearEnhance(); updateDraft(''); }
        clearAttachments();
        await refresh();
        await refreshCatalog();
        await startTask();
      } catch (e) {
        if (generation !== getSessionGeneration() || ticket !== getSendTicket()) return;
        error.value = acknowledged ? '消息已发送，暂时无法刷新会话。' : text.length > 8000 ? '消息最多支持 8000 个字符，请缩短后重试。' : '消息发送失败，请稍后重试。';
      } finally { if (generation === getSessionGeneration() && ticket === getSendTicket()) sendBusy.value = false; }
    }

    async function startTask() {
      if (approval.value || turn.value.running) { error.value = '请先处理当前任务和审批请求。'; return; }
      stopPolling();
      const generation = getSessionGeneration();
      modelApprovalsSuppressed.value = false;
      modelTurnRequestId.value = null;
      error.value = '';
      turn.value = { running: true, settled: false, text: '', finishReason: '', cancelled: false, interrupted: false, delivered: 0, used: null, budget: null, verdict: '', over: false };
      try {
        const started = await api.taskStart(selectedCustomModel.value || undefined);
        if (generation !== getSessionGeneration()) return;
        modelTurnRequestId.value = started.turnRequestId;
        startPolling();
      } catch (e) {
        if (generation !== getSessionGeneration()) return;
        const text = String(cleanErr(e));
        const code = text.match(/\d+\s+([a-z][a-z0-9-]*)/);
        if (code && code[1] === 'custom-model-not-found') selectedCustomModel.value = '';
        error.value = turnStartFailure(code ? code[1] : text);
        turn.value.running = false;
      }
    }

    async function runTurn(limit) {
      if (fileEditor.state.busy) { error.value = '文件正在读取或保存，请稍后执行。'; return; }
      const generation = getSessionGeneration();
      error.value = '';
      turn.value = { running: true, settled: false, text: '', finishReason: '', cancelled: false, interrupted: false, delivered: 0, used: null, budget: null, verdict: '', over: false };
      try {
        await api.turnStart(limit);
        if (generation !== getSessionGeneration()) return;
        startPolling();
      } catch (e) {
        if (generation !== getSessionGeneration()) return;
        error.value = String(e.message || e);
        turn.value.running = false;
      }
    }

    async function cancelTurn() {
      const generation = getSessionGeneration(), epoch = getPollGeneration();
      error.value = '';
      modelApprovalsSuppressed.value = true;
      if (approval.value?.source === 'model') approval.value = null;
      try {
        await api.turnCancel();
      } catch (e) {
        if (generation === getSessionGeneration() && epoch === getPollGeneration()) error.value = String(e.message || e);
      }
    }

    return { send, enqueueDraft, submitBusyDraft, startTask, runTurn, cancelTurn, imageDraftAllowed, turnStartFailure, cleanErr, refreshQueue, updateQueue };
  }

  root.SaCodeSendQueue = { createSendQueueAssembly };
})(globalThis);
