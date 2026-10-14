'use strict';

const { Worker } = require('node:worker_threads');
const { ImportError, prepareExisting, limitsFor } = require('./chatgpt.cjs');

// 取消/超时等待自有工作线程退出再结算，不终止任何外部进程。
function previewChatGptAsync(text, options = {}) {
  return new Promise((resolve, reject) => {
    const fail = code => reject(new ImportError(code));
    if (!options || typeof options !== 'object' || Array.isArray(options)) return fail('import-invalid-options');
    const { signal, timeoutMs = 30000, existing, limits } = options;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) return fail('import-invalid-timeout');
    if (signal !== undefined && (!signal || typeof signal.addEventListener !== 'function' || typeof signal.removeEventListener !== 'function')) return fail('import-invalid-signal');
    if (signal?.aborted) return fail('import-cancelled');
    if (typeof text !== 'string') return fail('import-invalid-input');
    let boundedLimits, summaries;
    try {
      boundedLimits = limitsFor(limits);
      if (Buffer.byteLength(text, 'utf8') > boundedLimits.bytes) return fail('import-input-limit');
      summaries = prepareExisting(existing, signal);
    } catch (error) { return fail(error instanceof ImportError ? error.code : 'import-invalid-options'); }
    let worker;
    try {
      worker = new Worker(require.resolve('./chatgpt-worker.cjs'), {
        workerData: { text, options: { existing: summaries, limits: boundedLimits } },
        resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 }
      });
    } catch { return fail('import-worker-failed'); }
    let outcome, stopping = false;
    const stop = code => {
      if (stopping) return;
      stopping = true;
      outcome = { code };
      // terminate 的错误只映射固定码，避免泄露内部路径或原始输入。
      worker.terminate().catch(() => { outcome = { code: 'import-worker-failed' }; });
    };
    const abort = () => stop('import-cancelled');
    const timer = setTimeout(() => stop('import-timeout'), timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    worker.on('message', message => {
      if (stopping) return;
      if (!message || typeof message.ok !== 'boolean') return stop('import-worker-failed');
      outcome = message.ok ? { result: message.result } : { code: /^import-[a-z-]+$/.test(message.code) ? message.code : 'import-worker-failed' };
    });
    worker.on('error', () => { if (!stopping) outcome = { code: 'import-worker-failed' }; });
    worker.on('exit', exitCode => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (!outcome || (!stopping && exitCode !== 0)) return fail('import-worker-failed');
      if (outcome.code) return fail(outcome.code);
      resolve(outcome.result);
    });
  });
}
module.exports = { previewChatGptAsync };
