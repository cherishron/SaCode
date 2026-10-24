// 配置视图合成取样：只渲染，确认前退出，不保存、不启动Host或访问网络。
import React from 'react';
import { Box } from 'ink';
import { render } from 'ink-testing-library';
import { writeFileSync } from 'node:fs';
import { ConfigurationDialog } from '../../src/configuration-dialog.mjs';
import { SelectionDialog } from '../../src/dialogs.mjs';
const wait = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms));
const frames = {};
for (const columns of [80, 48]) {
  const view = { providers: [{ id: 'existing', name: '演示供应商' }], writable: true, revision: 2, defaultProviderId: 'existing', defaultModel: 'demo-model' };
  const client = { async request() { throw new Error('渲染取样不允许发请求'); } };
  const app = render(React.createElement(Box, { width: columns }, React.createElement(ConfigurationDialog, {
    client, view, compact: columns < 64, onClose() {}, onSaved() { throw new Error('不应保存'); },
  })));
  try {
    await wait(100);
    frames[`${columns}-initial`] = app.lastFrame();
    for (const input of ['new-provider', '\r', 'http://external.invalid', '\r']) { app.stdin.write(input); await wait(); }
    frames[`${columns}-validation-error`] = app.lastFrame();
    for (const input of ['\x15', 'http://127.0.0.1:1', '\r', 'local-model', '\r']) { app.stdin.write(input); await wait(); }
    frames[`${columns}-hidden-key`] = app.lastFrame();
    app.stdin.write('\r'); await wait();
    frames[`${columns}-review`] = app.lastFrame();
  } finally { app.unmount(); app.cleanup(); }
  const model = render(React.createElement(Box, { width: columns }, React.createElement(SelectionDialog, {
    title: '选择模型 · 仅本进程', compact: columns < 64, items: [
      { id: '', label: '宿主默认路由', description: '已配置不代表可用；本次不联网测试' },
      { id: 'coding', label: '编程模型 · coding', description: '已启用，1个启用绑定；凭据/连通性未验证' },
    ], selected: 1,
  })));
  try { await wait(); frames[`${columns}-model-state`] = model.lastFrame(); }
  finally { model.unmount(); model.cleanup(); }
}
if (!process.argv[2]) throw new Error('指定target/tmp内输出路径');
writeFileSync(process.argv[2], JSON.stringify(frames, null, 2));
console.log(`配置取样${Object.keys(frames).length}帧，未写配置/启动Host/访问网络`);
