// 实际打包入口验收：独立数据目录，检查可见窗口与真实渲染控件，不读取用户数据。
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const exe = process.argv[2];
if (!exe) throw new Error('用法：node scripts/check-desktop-startup.mjs <SaCode.exe>');
const root = mkdtempSync(join(tmpdir(), 'sacode-normal-startup-'));
mkdirSync(join(root, 'user-data'));
const env = { ...process.env, SACODE_USER_SETTINGS_DIR: join(root, 'settings') };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(resolve(exe), ['--inspect=0', `--user-data-dir=${join(root, 'user-data')}`, `--session-dir=${join(root, 'session')}`], { env, windowsHide: true });
let stderr = '', ws, counter = 0, validated = false;
process.exitCode = 1;
const pending = new Map();
const timer = setTimeout(() => { console.error('STARTUP_FAIL 启动验收超时'); child.kill(); process.exitCode = 1; }, 30000);
child.on('error', error => { clearTimeout(timer); console.error(error); process.exitCode = 1; });
child.stderr.on('data', async data => {
  stderr += data;
  const url = stderr.match(/Debugger listening on (ws:\/\/[^\s]+)/)?.[1];
  if (!url || ws) return;
  ws = new WebSocket(url);
  ws.onmessage = event => {
    const message = JSON.parse(event.data);
    if (pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id); }
  };
  const evaluate = (expression, awaitPromise = false) => new Promise(resolveResult => {
    const id = ++counter;
    pending.set(id, resolveResult);
    ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise, returnByValue: true } }));
  });
  ws.onopen = async () => {
    try {
      let result;
      for (let attempt = 0; attempt < 30; attempt++) {
        const reply = await evaluate(`(async () => {
          const w = process.mainModule.require('electron').BrowserWindow.getAllWindows()[0];
          if (!w || w.webContents.isLoading()) return null;
          const page = await w.webContents.executeJavaScript('({ready:document.readyState,controls:document.querySelectorAll("button,input,textarea").length,bodyLength:document.body.innerText.length})');
          const hostReady = await w.webContents.executeJavaScript('Promise.all([window.sacode.globalSettingsGet(), window.sacode.customsDescribe()]).then(() => true)');
          return {visible:w.isVisible(),hostReady,...page};
        })()`, true);
        result = reply.result?.result?.value;
        if (result?.visible && result.hostReady && result.ready === 'complete' && result.controls > 0 && result.bodyLength > 0) break;
        await new Promise(done => setTimeout(done, 300));
      }
      if (!result?.visible || !result.hostReady || result.ready !== 'complete' || !(result.controls > 0) || !(result.bodyLength > 0)) throw new Error('界面或实际 Host 请求未就绪：' + JSON.stringify(result));
      console.log('STARTUP_PASS ' + JSON.stringify(result));
      validated = true;
      process.exitCode = 0;
    } catch (error) {
      console.error('STARTUP_FAIL ' + error.message);
      process.exitCode = 1;
    } finally {
      clearTimeout(timer);
      await evaluate("process.mainModule.require('electron').app.quit()");
      ws.close();
    }
  };
});
child.on('exit', code => {
  clearTimeout(timer);
  ws?.close();
  if (code !== 0 || !validated) { console.error('STARTUP_FAIL 主进程 rc=' + code + ' validated=' + validated); process.exitCode = 1; }
});
