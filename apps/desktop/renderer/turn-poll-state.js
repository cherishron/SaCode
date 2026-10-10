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
