(function (root) {
  'use strict';
  function createTurnPoll({ poll, getGeneration, getEpoch, invalidate, getApprovalContext, selectProposal,
    turn, usage, approval, error, queueRows, refresh, refreshTools, refreshQueue, showContextTip, startTask }) {
    let timer = null;
    function stop() {
      invalidate();
      if (timer !== null) { clearInterval(timer); timer = null; }
    }
    function start() {
      stop();
      const generation = getGeneration(), epoch = getEpoch();
      const current = () => generation === getGeneration() && epoch === getEpoch();
      let polling = false;
      timer = setInterval(async () => {
        if (polling) return;
        polling = true;
        try {
          const p = await poll();
          if (!current()) return;
          const context = getApprovalContext();
          if (!context.suppressed) {
            const proposal = selectProposal(p.approvalRequests, context.sessionId, p.running && p.turnRequestId === context.requestId, context.requestId);
            if (proposal && !approval.value) approval.value = proposal;
          }
          for (const frame of p.frames) {
            const i = frame.indexOf(':');
            const kind = i < 0 ? frame : frame.slice(0, i);
            const body = i < 0 ? '' : frame.slice(i + 1);
            if (kind === 'projection' && body === 'todos') await refresh();
            else if (kind === 'projection' && body === 'queue') { await refresh(); await refreshQueue(); }
            else if (kind === 'text') turn.value.text += body;
            else if (kind === 'usage') turn.value.text += '\n[usage ' + body + ']';
            else if (kind === 'tool-call-delta') turn.value.text += '\n[tool-call ' + body + ']';
          }
          if (!current()) return;
          turn.value.running = p.running;
          if (p.settled) {
            if (approval.value?.source === 'model') approval.value = null;
            turn.value.settled = true;
            turn.value.finishReason = p.finishReason || '';
            turn.value.cancelled = !!p.cancelled;
            turn.value.interrupted = !!p.interrupted;
            turn.value.delivered = p.delivered || 0;
            usage.value = { used: p.used, budget: p.budget, over: !!p.over, verdict: p.usageVerdict || '' };
            // 轮次是在线路之后失败的，原因只落在 finishReason 里；界面原来只显示
            // 「已中断」三个字，用户既不知道发生了什么，也不知道该去看哪里。
            // 这里把 error:<形态>:<原因> 翻成人话，与发送/增强两处用同一套说法。
            if (!turn.value.cancelled && turn.value.interrupted) {
              const raw = String(turn.value.finishReason || '');
              if (raw.startsWith('error:')) {
                const reason = raw.slice('error:'.length);
                const transport = {
                  'http-request-error:tls-certificate-expired': '连接时收到的证书被判为过期。请检查系统时间与 API 地址；这不等于目标服务的证书一定过期。',
                  'http-request-error:tls-certificate-rejected': '连接时证书验证未通过。请检查系统时间、API 地址及证书配置，不要关闭证书校验。',
                  'http-request-error:tls-alpn-unsupported': 'HTTPS 应用协议协商失败。请检查客户端协议配置。',
                  'http-request-error:tls-anchor-missing': '本机信任根里没有这家模型服务的证书颁发机构，请求在 TLS 校验阶段就被拒。请先更新 Windows 根证书，或换一家已被信任的供应商。',
                  'http-request-error:tls-handshake-rejected': 'HTTPS 握手未完成。请检查 API 地址及客户端 TLS 配置；请求尚未进入密钥认证阶段。',
                  'http-request-error:dns-failed': '解析不到这家模型服务的域名。请检查 API 地址是否写错。',
                  'http-request-error:connection-refused': '连接被拒绝，地址或端口不通。请检查 API 地址。',
                  'http-request-error:connection-reset': '连接被中途断开。请稍后重试。',
                  'http-request-error:timeout': '连接模型服务超时。请稍后重试。',
                  'http-request-error': '连不上模型服务。请检查 API 地址与网络。',
                }[reason];
                if (transport) error.value = transport;
                else if (reason.startsWith('http-status:')) error.value = '模型服务拒绝了这次请求（常见于密钥或模型名不对）：' + reason.slice('http-status:'.length) + '。';
                else error.value = '这一轮没能完成：' + reason + '。';
              }
            }
            void showContextTip();
            stop();
            await refresh();
            await refreshTools();
            await refreshQueue();
            if (!turn.value.cancelled && queueRows.value.length) {
              await startTask();
              await refresh();
              await refreshQueue();
            }
          }
        } catch (e) {
          if (!current()) return;
          if (approval.value?.source === 'model') approval.value = null;
          error.value = String(e.message || e);
          stop();
        } finally { polling = false; }
      }, 60);
    }
    return { start, stop };
  }
  root.SaCodeTurnPoll = { createTurnPoll };
})(globalThis);
