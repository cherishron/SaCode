'use strict';

// 只承载本包解析器，不接收脚本、模块路径或任意执行方法。
const { parentPort, workerData } = require('node:worker_threads');
const { previewChatGpt, ImportError } = require('./chatgpt.cjs');
if (parentPort) {
  try {
    parentPort.postMessage({ ok: true, result: previewChatGpt(workerData.text, workerData.options) });
  } catch (error) {
    parentPort.postMessage({ ok: false, code: error instanceof ImportError ? error.code : 'import-worker-failed' });
  } finally {
    parentPort.close();
  }
}
