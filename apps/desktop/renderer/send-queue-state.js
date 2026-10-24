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

    const turnState = root.SaCodeTurnPoll.createTurnState(turn);
    let queueReadSequence = 0;
    function resetSession() {
      queueReadSequence++;
      stopPolling();
      turnState.reset();
      approval.value=null;
      queuePending.value=[];
      modelApprovalsSuppressed.value=false;
      modelTurnRequestId.value=null;
    }
    async function refreshQueue() {
      const generation = getSessionGeneration(), sequence = ++queueReadSequence;
      const current = () => generation === getSessionGeneration() && sequence === queueReadSequence;
      try {
        const view = await api.queueDescribe();
        if (!current()) return false;
        if (!view || !Array.isArray(view.nextTurn)) throw new Error('bad-queue-view');
        const rows = view.nextTurn.map(projectQueueRow);
        const admitted = new Set(rows.map(row => row.source.rpcId));
        queueRows.value = rows;
        queuePending.value = queuePending.value.filter(item => !admitted.has(item.requestId));
        if (error.value.startsWith('队列读取失败：')) error.value = '';
        return true;
      } catch (e) {
        if (current()) error.value = '队列读取失败：' + cleanErr(e);
        return false;
      }
    }

    async function updateQueue(id, action) {
      const generation = getSessionGeneration();
      const text = action.kind === 'edit' ? (action.content || []).map(block => block.type === 'text' ? block.text || '' : '').join('') : '';
      await api.queueUpdate(id, action.kind, text);
      if (generation !== getSessionGeneration()) return;
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

    // 传输层失败现在带稳定原因（见 core/src/transport_failure.cj 的 transportReason）。
    // 「连不上模型」一栏原来把 TLS 锚缺失、对端拒绝握手和真的断网写成一件事，
    // 用户拿不到任何可操作的方向；这里按真实原因给说法，不再笼统劝「再试一次」。
    const transportText = (raw, saved) => {
      const tail = saved ? '消息已存入会话，' : '';
      if (raw.includes('tls-certificate-expired')) return `连接时收到的证书被判为过期：${tail}请检查系统时间与 API 地址；这不等于目标服务的证书一定过期。`;
      if (raw.includes('tls-certificate-rejected')) return `连接时证书验证未通过：${tail}请检查系统时间、API 地址及证书配置，不要关闭证书校验。`;
      if (raw.includes('tls-alpn-unsupported')) return `HTTPS 应用协议协商失败：${tail}请检查客户端协议配置。`;
      if (raw.includes('tls-anchor-missing')) return `本机信任根里没有这家模型服务的证书颁发机构，请求在 TLS 校验阶段就被拒：${tail}请先更新 Windows 根证书或换一家已被信任的供应商。`;
      if (raw.includes('tls-handshake-rejected')) return `HTTPS 握手未完成：${tail}请检查 API 地址及客户端 TLS 配置；请求尚未进入密钥认证阶段。`;
      if (raw.includes('dns-failed')) return `解析不到这家模型服务的域名：${tail}请检查 API 地址是否写错。`;
      if (raw.includes('connection-refused')) return `连接被拒绝，地址或端口不通：${tail}请检查 API 地址。`;
      if (raw.includes('connection-reset')) return `连接被中途断开：${tail}请稍后重试。`;
      if (raw.includes('timeout')) return `连接模型服务超时：${tail}请稍后重试。`;
      return `连不上模型服务：${tail}请检查 API 地址与网络。`;
    };

    // 路由拒绝有十种码（apps/host/src/model_routing.cj 抛出），每一种都能指到一处具体配置。
    // 界面只给一句「路由被拒」等于把自查路径堵死，这里逐条说清楚该去看哪里。
    const routeRejectText = (detail, saved) => {
      const tail = saved ? '消息已存入会话，' : '';
      const reasons = {
        'credential-unconfigured': `绑定的提供商没有可用密钥：${tail}请到设置 → 模型给该提供商填入 API 密钥。`,
        'custom-model-not-found': `这个自定义模型已经不在清单里：${tail}发送入口已改回默认模型，请直接重试。`,
        'custom-model-disabled': `这个自定义模型已被停用：${tail}请到自定义模型清单里重新启用。`,
        'provider-missing': `绑定的提供商已被删除：${tail}请重新编辑这个自定义模型的绑定。`,
        'provider-disabled': `绑定的提供商已被停用：${tail}请到设置 → 模型重新启用该提供商。`,
        'upstream-model-missing': `绑定的模型已不在该提供商的清单里：${tail}请检查两边的模型名是否一致。`,
        'capability-unsatisfied': `绑定的上游模型能力尚未确认或不满足要求：${tail}请到模型中心 → 供应商 → 编辑，确认该上游模型可用及文本输出、流式、工具调用；只在服务实际支持时声明。`,
        'no-enabled-binding': `这个自定义模型还没有可用绑定：${tail}请先给它加一条绑定并启用。`,
        'budget-exhausted': `预算已用满：${tail}请新建会话或调整预算。`,
        'route-cooling': `该路由正在冷却中：${tail}请稍候再试。`,
      };
      const reason = reasons[detail.slice('route-rejected:'.length)];
      return reason || `自定义模型路由被拒（${detail}）：${tail}请检查该自定义模型的绑定与凭据。`;
    };

    const turnStartFailure = (code, raw = '') => ({
      'model-not-configured': '还没有配置模型：消息已存入会话，请到设置 → 模型添加提供商并设为默认。',
      'model-credential-unavailable': '提供商还没有可用凭据：消息已存入会话，请到设置 → 模型填入 API 密钥。',
      'model-image-not-supported': '当前模型未声明支持图片：会话已保留，请选择支持图片的模型后重试。',
      'over-budget': '本轮额度已用满：消息已存入会话，请新建会话继续。',
      'turn-in-flight': '上一轮还在执行，请稍候。',
      'already-owned': '会话正被另一个入口占用，请稍候再试。',
      'session-owner-unknown': '无法确认会话写锁归属，尚未起轮；请检查其他窗口或存储权限。',
      'session-storage-unavailable': '会话目录无法写入，尚未起轮；请检查存储路径及访问权限。',
      'replay-rejected': '会话日志回放被拒，消息未起轮；请检查会话文件是否完整。',
      'provider-init-failed': transportText(raw, true),
      'flush-failed': '会话未能落盘，消息只在内存里可见。',
      'custom-model-not-found': '这个自定义模型已经不在清单里：消息已存入会话，发送入口已改回默认模型，请直接重试。',
      'bad-custom-model-id': '宿主没能认出这个自定义模型身份：消息已存入会话，请重新选择模型后重试。',
    })[code] || (code.startsWith('route-rejected:') || code === 'route-rejected'
      ? routeRejectText(code === 'route-rejected' ? '' : code, true)
      : '起轮失败：' + code);

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
      if (sendBusy.value) {
        // 不静默丢弃：发送忙碌时按偏好入队或给明确提示，不能让消息消失无反应。
        // 直接调 submitBusyDraft 而非 enqueueDraft——enqueueDraft 的 finally 会把 sendBusy
        // 重置为 false，而此处 sendBusy 由外层 send 持有，不能被内层错误释放。
        if (globalAppearance.value.busySend === 'queue' || globalAppearance.value.busySend === 'steer') {
          try { await submitBusyDraft(accelerated); } catch (e) { if (getSessionGeneration() === getSessionGeneration()) error.value = '发送补充失败：' + cleanErr(e); }
        } else {
          error.value = '正在发送上一条消息，请稍后。';
        }
        return;
      }
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
        const outcome = await startTask();
        // 在途回执不是新轮：本次发送未送达当前轮次，待处理数只作提示，不能当成 delivered。
        if (outcome === 'in-flight') {
          const pending = turn.value.pendingTurnCount;
          error.value = pending > 0
            ? `目标回合仍在执行，本次发送未开启新轮；有 ${pending} 条补充待处理（尚未送达）。`
            : '目标回合仍在执行，本次发送未开启新轮；消息已存入会话，尚未送达当前轮次。';
        }
      } catch (e) {
        if (generation !== getSessionGeneration() || ticket !== getSendTicket()) return;
        const failure = cleanErr(e);
        error.value = acknowledged ? '消息已发送，暂时无法刷新会话。'
          : failure.includes('session-storage-unavailable') ? '会话目录无法写入，消息未保存；已保留草稿，请检查存储路径及访问权限。'
          : failure.includes('session-owner-unknown') ? '无法确认会话写锁归属，消息未保存；已保留草稿。'
          : failure.includes('already-owned') ? '会话正在由另一写者使用，消息未保存；已保留草稿。'
          : text.length > 8000 ? '消息最多支持 8000 个字符，请缩短后重试。' : '消息发送失败，请稍后重试。';
      } finally { if (generation === getSessionGeneration() && ticket === getSendTicket()) sendBusy.value = false; }
    }

    // Host 的普通成功回执是 {started,limit,epoch,provider,goal}，不带 pendingTurnCount；
    // 只有 goal 句柄已在跑时的幂等回执才带它（且 limit=0，表示本条 RPC 未开新轮）。
    function inFlightReceipt(started) {
      return !!started && started.goal === true && started.limit === 0
        && typeof started.pendingTurnCount === 'number' && Number.isSafeInteger(started.pendingTurnCount)
        && started.pendingTurnCount >= 0;
    }

    async function startTask() {
      if (approval.value || turn.value.running) { error.value = '请先处理当前任务和审批请求。'; return 'skipped'; }
      stopPolling();
      const generation = getSessionGeneration();
      modelApprovalsSuppressed.value = false;
      error.value = '';
      turnState.start();
      try {
        const started = await api.taskStart(selectedCustomModel.value || undefined);
        if (generation !== getSessionGeneration()) return 'superseded';
        const goalInFlight = inFlightReceipt(started);
        // 在途回执说明已有一轮在执行，本条补充仍待处理：待处理数不是 delivered，
        // 也不能覆盖 modelTurnRequestId——那是正在执行轮的审批身份，不是这次本地包装的假 id。
        turnState.started(goalInFlight,started.pendingTurnCount);
        if (goalInFlight) {
          await refreshQueue();
          if (generation !== getSessionGeneration()) return 'superseded';
        } else {
          modelTurnRequestId.value = started.turnRequestId;
        }
        startPolling();
        return goalInFlight ? 'in-flight' : 'started';
      } catch (e) {
        if (generation !== getSessionGeneration()) return 'superseded';
        modelTurnRequestId.value = null;
        const text = String(cleanErr(e));
        // 保留冒号后的 detail：-32040 route-rejected:credential-unconfigured 这类错误，
        // 只取到「route-rejected」等于把原因全扔了，用户既没法自查也没法自救
        // （2026-10-12 实测：路由拒绝码有十种，界面此前一律显示同一句「起轮失败：route-rejected」）。
        const code = text.match(/-?\d+\s+([a-z][a-z0-9:_-]*)/i);
        const detail = code ? code[1] : text;
        if (detail === 'custom-model-not-found' || detail.startsWith('route-rejected:custom-model-not-found')) selectedCustomModel.value = '';
        error.value = turnStartFailure(detail, text);
        turnState.running(false);
        return 'failed';
      }
    }

    async function runTurn(limit) {
      if (fileEditor.state.busy) { error.value = '文件正在读取或保存，请稍后执行。'; return; }
      const generation = getSessionGeneration();
      error.value = '';
      turnState.start();
      try {
        await api.turnStart(limit);
        if (generation !== getSessionGeneration()) return;
        startPolling();
      } catch (e) {
        if (generation !== getSessionGeneration()) return;
        error.value = String(e.message || e);
        turnState.running(false);
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

    return { resetSession, send, enqueueDraft, submitBusyDraft, startTask, runTurn, cancelTurn, imageDraftAllowed, turnStartFailure, cleanErr, refreshQueue, updateQueue };
  }

  root.SaCodeSendQueue = { createSendQueueAssembly };
})(globalThis);
