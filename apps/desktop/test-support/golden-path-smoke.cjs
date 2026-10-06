// 金路径验收：装好并配好模型后，点发送就应当自动起一轮并收到流式答复。
// 模型走仓库自带的本机 SSE 夹具（注册表允许 http://127.0.0.1 回环且免凭据），
// 提供商经真实配置面登记并经宿主落盘，不是往渲染层塞内存桩。
const { spawn } = require('node:child_process');
const { join } = require('node:path');

// 装机布局下 __dirname 落在 app.asar 里，往上推仓库路径推不出夹具（实测表现为
// 「本机 SSE 夹具启动超时」而不是「没有夹具」）。打包态取证要能把夹具指到真实文件，
// 这样这一组在安装包里照样是实跑，而不是跳过。
const FIXTURE = process.env.SACODE_SSE_FIXTURE || join(__dirname, '..', '..', '..', 'scripts', 'sse-contract-server.cjs');
const http = require('node:http');
const nap = (ms) => new Promise((r) => setTimeout(r, ms));

// 宿主侧的 provider-init 失败只给一句 http-request-error，分不清「夹具已经没了」
// 和「夹具在但请求不通」；这里从 Node 侧探一次，把端口与实际状态码写进日志。
const reach = (port) => new Promise((resolve) => {
  const req = http.request({ host: '127.0.0.1', port, path: '/v1/chat/completions', method: 'POST', headers: { 'content-type': 'application/json', 'content-length': 2 } }, (res) => {
    res.resume();
    res.on('end', () => resolve({ status: res.statusCode }));
  });
  req.on('error', (e) => resolve({ error: String(e.code || e.message) }));
  req.end('{}');
});

async function startFixture() {
  // 这一份夹具要撑住两条停滞路由（各 5 秒）加界面往返，显式声明比默认 20 秒长的看门狗；
  // 收尾仍由 stopFixture 主动终止，不靠看门狗兜底。
  // 冒烟跑在 Electron 主进程里，process.execPath 是 electron.exe：不带 ELECTRON_RUN_AS_NODE
  // 就不是纯 Node 模式，脚本压根不会监听端口（实测拿到 port 0，故障却表现为宿主的
  // provider-init 连不上）。
  const startedAt = Date.now();
  const proc = spawn(process.execPath, [FIXTURE], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', SSE_WATCHDOG_MS: '60000' },
  });
  proc.on('exit', (code, signal) => console.log('FRAME 金路径夹具退出 ' + JSON.stringify({ code, signal, afterMs: Date.now() - startedAt })));
  const port = await new Promise((res, rej) => {
    let buf = '';
    const to = setTimeout(() => rej(new Error('本机 SSE 夹具启动超时')), 8000);
    proc.stdout.on('data', (d) => {
      buf += d.toString();
      const i = buf.indexOf('\n');
      if (i >= 0) { clearTimeout(to); res(buf.slice(0, i).trim()); }
    });
    proc.stderr.on('data', (d) => process.stderr.write(`[golden-fixture] ${d}`));
    proc.on('error', (e) => { clearTimeout(to); rej(e); });
    proc.on('exit', (code) => { clearTimeout(to); rej(new Error(`夹具提前退出 code=${code}`)); });
  });
  // 端口必须是真实端口：0 会让 baseUrl 变成 127.0.0.1:0，故障点被推到几十步之外。
  if (!/^[1-9]\d*$/.test(port)) { stopFixture(proc); throw new Error('本机 SSE 夹具报出的端口不可用：' + JSON.stringify(port)); }
  return { proc, port: Number(port) };
}

function stopFixture(proc) {
  for (const fn of [() => proc.stdin.write('x'), () => proc.stdin.end(), () => proc.kill()]) {
    try { fn(); } catch (_) {}
  }
}

// 界面事实从渲染层取，核心事实从宿主取；两边都在 Node 里合成断言对象，
// 免得把整段投影塞进 executeJavaScript 的字符串里。
// 注意：这里的 js() 把源码包进 async IIFE 的函数体，取返回值必须显式写 return。
const readDom = (js) => js("return ({errorText:(document.querySelector('.error')||{}).textContent||'',messages:(document.querySelector('#messages')||{}).textContent||'',usage:(document.querySelector('#turn-usage')||{}).textContent||'',aria:(document.querySelector('#send')||{}).getAttribute('aria-label')||'',draft:(document.querySelector('#composer')||{}).value||''})");

module.exports = async function ({ win, check, waitFor, bridge }) {
  const js = (source) => win.webContents.executeJavaScript(`(async()=>{${source}})()`, true);
  const fixture = await startFixture();
  try {
    // 注册表是这一轮冒烟里已被别的夹具写过的：版本从当前读数取，不假设自己是第一个写者
    const empty = await bridge.request('model/registry/describe');
    await bridge.request('model/registry/update', {
      draft: {
        id: 'golden', name: '本机夹具', baseUrl: `http://127.0.0.1:${fixture.port}/v1`,
        protocol: 'openai-completions',
        models: [{ id: 'golden-model', name: '夹具模型', contextWindow: '128k', maxTokens: '4k', image: false }],
      },
      expectedRevision: empty.revision,
    });
    const withGolden = await bridge.request('model/registry/describe');
    await bridge.request('model/registry/set-default', { providerId: 'golden', model: 'golden-model', expectedRevision: withGolden.revision });
    await js("document.querySelector('#composer').value='';document.querySelector('#composer').dispatchEvent(new Event('input',{bubbles:true}))");
    // 选择走真实入口：打开菜单会拉一次目录，选中才把默认指针写到渲染层看得见的位置
    await js("document.querySelector('.composer-controls .model-select-trigger').click()");
    await waitFor("!!document.querySelector('.composer-controls .model-select-menu')");
    await js("document.querySelector('.composer-controls [data-model-root=model]').click()");
    await waitFor("!!document.querySelector('.composer-controls [data-model-id=golden-model]')");
    await js("document.querySelector('.composer-controls [data-model-id=golden-model]').click()");
    await waitFor("document.querySelector('.composer-controls .model-select-trigger').textContent.includes('夹具模型')");

    const before = await bridge.request('session/projection');
    const usedBefore = (await bridge.request('usage/status')).used;
    console.log('FRAME 金路径发送前 ' + JSON.stringify({
      port: fixture.port,
      reachable: await reach(fixture.port),
      defaultPointer: withGolden.default ?? withGolden.pointer ?? null,
      baseUrls: (withGolden.providers || []).map((p) => p.id + '@' + p.baseUrl),
    }));
    await js("const n=document.querySelector('#composer');n.value='金路径：发一条就该自动收到答复';n.dispatchEvent(new Event('input',{bubbles:true}));await Vue.nextTick();document.querySelector('#send').click();");
    // 有界轮询而不是直接 waitFor：超时时要能把界面与核心的实际读数一起交出来，
    // 否则「没等到」这一条什么都说明不了。
    let sawReply = false;
    for (let i = 0; i < 120 && !sawReply; i++) {
      sawReply = await js("return (document.querySelector('#messages')||{}).textContent?.includes('first') || false");
      if (!sawReply) await nap(50);
    }
    const probe = await js("return ({error:(document.querySelector('.error')||{}).textContent||'',state:(document.querySelector('#turn-state')||{}).textContent||'',aria:document.querySelector('#send').getAttribute('aria-label'),busy:document.querySelector('#send').getAttribute('aria-busy')})");
    console.log('FRAME 金路径探针 ' + JSON.stringify({ sawReply, ...probe, usedBefore }));
    await waitFor("document.querySelector('#send').getAttribute('aria-label')==='发送消息'");
    const after = await bridge.request('session/projection');
    const usedAfter = (await bridge.request('usage/status')).used;
    const dom = await readDom(js);
    const assistants = (list) => list.filter((m) => m.startsWith('assistant/message: '));
    await check('发送即自动起轮并收到真流式答复', '(' + JSON.stringify({
      userKept: dom.messages.includes('金路径：发一条就该自动收到答复'),
      streamed: dom.messages.includes('first'),
      assistantLogged: assistants(after.messages).includes('assistant/message: first'),
      assistantGrew: assistants(after.messages).length === assistants(before.messages).length + 1,
      // 夹具这一轮的 usage 是 22：增量正好等于它，才证明账是从真流里来的
      usageFromRealStream: usedAfter - usedBefore === 22,
      noErrorNotice: dom.errorText === '',
      draftCleared: dom.draft === '',
      sendRestored: dom.aria === '发送消息',
    }) + ')');

    // 反向：撤掉配置后再发一条。消息是已发生的事实要留下，起轮必须显式报错——
    // 静默退回示例 provider 演一场假成功，比报错糟得多。
    // B：换成会拖 5 秒的路由，好让「运行中再发一条」真的落在运行期间
    const stalled = await bridge.request('model/registry/describe');
    await bridge.request('model/registry/update', {
      draft: {
        id: 'golden', name: '本机夹具', baseUrl: `http://127.0.0.1:${fixture.port}/stall`, protocol: 'openai-completions',
        models: [{ id: 'golden-model', name: '夹具模型', contextWindow: '128k', maxTokens: '4k', image: false }],
      },
      expectedRevision: stalled.revision,
    });
    await js("const n=document.querySelector('#composer');n.value='运行中的第一条';n.dispatchEvent(new Event('input',{bubbles:true}));await Vue.nextTick();document.querySelector('#send').click();");
    await waitFor("document.querySelector('#send').getAttribute('aria-label')==='停止执行'");
    await js("const n=document.querySelector('#composer');n.value='运行中排队的第二条';n.dispatchEvent(new Event('input',{bubbles:true}));await Vue.nextTick();document.querySelector('#send').click();");
    await waitFor("!!document.querySelector('[data-queue-dock]') && document.querySelector('.queue-preview').textContent.includes('运行中排队的第二条')");
    const mid = await bridge.request('session/projection');
    const midQueue = await bridge.request('queue/describe');
    // 轮次边界应当摘走恰好一条：面板清空，正文里出现这条用户消息，并自动起下一轮
    await waitFor("(document.querySelector('#messages')||{}).textContent.includes('运行中排队的第二条') && !document.querySelector('[data-queue-dock]')");
    const drained = await bridge.request('session/projection');
    const drainedQueue = await bridge.request('queue/describe');
    const users = (list) => list.filter((m) => m.startsWith('user/message: '));
    await check('运行中发送进入核心队列并在轮次边界自动送达', '(' + JSON.stringify({
      queuedInCore: midQueue.nextTurn.length === 1 && midQueue.nextTurn[0].text === '运行中排队的第二条',
      notAdmittedYet: !users(mid.messages).includes('user/message: 运行中排队的第二条'),
      notInTranscriptYet: !mid.messages.some((m) => m.includes('运行中排队的第二条')),
      admittedOnBoundary: users(drained.messages).includes('user/message: 运行中排队的第二条'),
      queueEmptied: drainedQueue.nextTurn.length === 0,
      stillOnePerTurn: users(drained.messages).filter((m) => m.includes('排队的')).length === 1,
    }) + ')');
    // 边界摘走一条后又自动起了第二轮（stall 路由 5 秒）：这一轮验「取消只撤本轮，
    // 排队条目留在核心」——上游 keepInbox 口径，停止不写 canceled splice。
    await waitFor("document.querySelector('#send').getAttribute('aria-label')==='停止执行'");
    await js("const n=document.querySelector('#composer');n.value='取消后留在队列的第三条';n.dispatchEvent(new Event('input',{bubbles:true}));await Vue.nextTick();document.querySelector('#send').click();");
    await waitFor("!!document.querySelector('.composer [data-queue-dock]') && document.querySelector('.composer .queue-preview').textContent.includes('取消后留在队列的第三条')");
    const thirdQueued = await bridge.request('queue/describe');
    // 队列投影可早于发送回执的 finally 出现；禁用按钮的 click 会被 Chromium 忽略。
    // 等发送结算、草稿清空且真实停止入口可用，再验取消的核心效果。
    await waitFor("!document.querySelector('#send').disabled && document.querySelector('#send').getAttribute('aria-label')==='停止执行' && !document.querySelector('#composer').value.trim()");
    console.log('FRAME 停止入口就绪 '+JSON.stringify(await js("return ({disabled:document.querySelector('#send').disabled,busy:document.querySelector('#send').getAttribute('aria-busy'),label:document.querySelector('#send').getAttribute('aria-label'),draft:document.querySelector('#composer').value.length})")));
    await js("document.querySelector('#send').click();");
    await waitFor("document.querySelector('#send').getAttribute('aria-label')==='发送消息'");
    const afterCancel = await bridge.request('queue/describe');
    const cancelled = await bridge.request('session/projection');
    const cancelDom = await js("return ({queued:!!document.querySelector('.composer [data-queue-dock]'),preview:(document.querySelector('.composer .queue-preview')||{}).textContent||'',transcript:(document.querySelector('#messages')||{}).textContent||'',turnState:(document.querySelector('#turn-state')||{}).textContent||''})");
    await check('按停止只撤本轮且排队条目仍留在核心', '(' + JSON.stringify({
      thirdInCoreBeforeCancel: thirdQueued.nextTurn.length === 1 && thirdQueued.nextTurn[0].text === '取消后留在队列的第三条',
      turnRecordedCancelled: cancelDom.turnState.includes('已取消'),
      keptAfterCancel: afterCancel.nextTurn.length === 1 && afterCancel.nextTurn[0].text === '取消后留在队列的第三条',
      panelStillShowsIt: cancelDom.queued && cancelDom.preview.includes('取消后留在队列的第三条'),
      neverDelivered: !users(cancelled.messages).includes('user/message: 取消后留在队列的第三条'),
    }) + ')');
    // 收尾：用面板自己的删除按钮把这条清掉，确认它确实是核心状态而不是界面残留，
    // 也给后面的夹具留一个空队列。
    await js("document.querySelector('.composer [aria-label=\"删除排队消息\"]').click();");
    await waitFor("!document.querySelector('.composer [data-queue-dock]')");
    const afterRemove = await bridge.request('queue/describe');
    const removed = await bridge.request('session/projection');
    await check('面板删除走核心操作并清空队列', '(' + JSON.stringify({
      coreQueueEmpty: afterRemove.nextTurn.length === 0 && afterRemove.nextStep.length === 0,
      stillNotDelivered: !users(removed.messages).includes('user/message: 取消后留在队列的第三条'),
    }) + ')');

    // D：换到 /tools 路由——它在 1.5 秒后抛一个 todo_write 工具调用，制造真正的步边界。
    // 运行中排一句再点「即时补充」：它要在下一次模型请求前被送成一句 user/message，
    // 面板与正文都按核心重读。这条通路上第一次有两个线程同时写同一份清单。
    const forTools = await bridge.request('model/registry/describe');
    await bridge.request('model/registry/update', {
      draft: {
        id: 'golden', name: '本机夹具', baseUrl: `http://127.0.0.1:${fixture.port}/tools`, protocol: 'openai-completions',
        models: [{ id: 'golden-model', name: '夹具模型', contextWindow: '128k', maxTokens: '4k', image: false }],
      },
      expectedRevision: forTools.revision,
    });
    await js("const n=document.querySelector('#composer');n.value='步边界前的开轮句';n.dispatchEvent(new Event('input',{bubbles:true}));await Vue.nextTick();document.querySelector('#send').click();");
    await waitFor("document.querySelector('#send').getAttribute('aria-label')==='停止执行'");
    await js("const n=document.querySelector('#composer');n.value='补充：中途换用中文';n.dispatchEvent(new Event('input',{bubbles:true}));await Vue.nextTick();document.querySelector('#send').click();");
    await waitFor("!!document.querySelector('.composer [data-queue-dock]') && document.querySelector('.composer [aria-label=\"即时补充\"]').disabled===false");
    await js("document.querySelector('.composer [aria-label=\"即时补充\"]').click();");
    // 排队为默认时，Ctrl+Enter 必须走互补的插话通路，不借助队列改送按钮。
    await js("const n=document.querySelector('#composer');n.value='快捷键补充：保留用户约束';n.dispatchEvent(new Event('input',{bubbles:true}));await Vue.nextTick();n.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',ctrlKey:true,bubbles:true,cancelable:true}));");

    await waitFor("document.querySelector('#messages').textContent.includes('补充：中途换用中文') && !document.querySelector('.composer [data-queue-dock]')");
    await waitFor("document.querySelector('#messages').textContent.includes('快捷键补充：保留用户约束')");
    const steppedQueue = await bridge.request('queue/describe');
    const stepped = await bridge.request('session/projection');
    const stillRunning = await js("return ({aria:document.querySelector('#send').getAttribute('aria-label'),dock:!!document.querySelector('.composer [data-queue-dock]')})");
    await check('即时补充在步边界送进本轮并作为用户消息落盘', '(' + JSON.stringify({
      deliveredInTranscript: users(stepped.messages).includes('user/message: 补充：中途换用中文'),
      keyboardDelivered: users(stepped.messages).includes('user/message: 快捷键补充：保留用户约束'),
      bothListsEmpty: steppedQueue.nextTurn.length === 0 && steppedQueue.nextStep.length === 0,
      noCorruptSplice: steppedQueue.bad === 0,
      panelClearedMidTurn: stillRunning.dock === false && stillRunning.aria === '停止执行',
    }) + ')');
    await waitFor("document.querySelector('#send').getAttribute('aria-label')==='发送消息'");

    const pointer = await bridge.request('model/registry/describe');
    await bridge.request('model/registry/remove', { id: 'golden', expectedRevision: pointer.revision });
    await waitFor("!document.querySelector('#sidebar-new-session').disabled");
    // 比的是「本场景开始前」：前面几步真的跑过轮次，助手条数早就不是金路径第一条之前的值了。
    const beforeRemoval = await bridge.request('session/projection');
    await js("const n=document.querySelector('#composer');n.value='撤掉配置后的消息';n.dispatchEvent(new Event('input',{bubbles:true}));await Vue.nextTick();document.querySelector('#send').click();");
    await waitFor("document.querySelector('.error')?.textContent.includes('还没有配置模型')");
    const unconfigured = await bridge.request('session/projection');
    const dom2 = await readDom(js);
    await check('缺模型配置时消息仍入会话并显式报错', '(' + JSON.stringify({
      honestNotice: dom2.errorText.includes('还没有配置模型'),
      messageKept: dom2.messages.includes('撤掉配置后的消息'),
      noFakeAssistant: assistants(unconfigured.messages).length === assistants(beforeRemoval.messages).length,
    }) + ')');
  } finally {
    stopFixture(fixture.proc);
  }
};
