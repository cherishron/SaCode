// clear 命令 Electron UI 实机验收（UI-FIX-7）：真窗口、真 preload IPC、真仓颉宿主、真 session.log。
// 不装配假处理器、不绕过 main.cjs；由 test/clear-ui-acceptance.test.mjs 以
// SACODE_UI_SMOKE_SUITE=clear-acceptance 对同一个 --session-dir 分两阶段拉起整个 Electron：
//   fill-and-clear  ：种子 + 界面真实发送凑满消息面 10 条 → 输入 “/” 唤出命令菜单 →
//                     点「清空对话」→ 消息面与真源一起归零、标题基线保留；
//   reopen-and-send ：同一 session-dir 重启整个 Electron（重开应用语义）→ 消息面仍空 →
//                     再发 1 条 → 新消息进入投影与盘上日志。
// 无模型配置是本验收的正常前提：发送只要求消息入真源（session/append 不依赖供应商），
// 起轮失败由产品按真实口径显式报错（task/start 只认真实配置），不伪造模型成功。
//
// 断言口径（与实现逐条对齐过，不凭感觉写数字）：
//   · seedIfNeeded 种 5 事件：turn/start + system/developer/assistant/user 各一；
//     projection.messages 只含 surface（system/user/assistant）= 3 条，
//     消息面（conversationMessages）再滤掉 system → DOM 可见 2 条（assistant+user）。
//   · 因此凑「消息面 10 条」= 种子 2 + 界面真实发送 8；此刻 projection（surface 计数）= 3+8=11。
//   · clearSessionHistory 只保留 session/title 等 7 类基线事件：种子 5 事件一个都不保留，
//     夹具在宿主启动后 append 的 session/title 是唯一基线 → 清空后盘上 events=1、projection=0。
//   · 重开阶段的投影加载正向信号用 proj.events>=1 + data-catalog-ready=true：
//     初始 proj 是全零对象、catalog 初始 null，两个信号都到位才算「真的从盘上取回了空会话」。
const { existsSync, readFileSync } = require('node:fs');

module.exports = async function clearAcceptanceMainSmoke({ app, HOST, SESSION_DIR, SESSION_LOG, bridge, seedIfNeeded, createWindow }) {
  const phase = process.env.SACODE_CLEAR_PHASE || 'fill-and-clear';
  if (!existsSync(HOST)) {
    // 缺宿主是环境前提不是断言失败：退出码 2 让包装器把它与验收失败区分开。
    console.log(`CLEAR_UI_ACCEPTANCE FAIL 缺少自包含宿主: ${HOST}`);
    app.exit(2);
    return;
  }
  let win = null;
  let bad = 0;
  const note = (ok, line) => { if (!ok) bad += 1; console.log(`CLEAR_UI ${ok ? 'OK  ' : 'FAIL'} ${line}`); };
  const nap = (ms) => new Promise((r) => setTimeout(r, ms));
  const js = (code) => win.webContents.executeJavaScript(code, true);
  const wait = async (code, tries = 200) => {
    for (let i = 0; i < tries; i++) {
      try { if (await js(code)) return true; } catch (_) {}
      await nap(30);
    }
    return false;
  };
  const domCount = () => js("document.querySelectorAll('#messages [data-msg-id]').length").then(Number);
  const noticeTexts = () => js("JSON.stringify([...document.querySelectorAll('.note[role=status]')].map(n=>n.textContent))");
  const errorText = () => js("((document.querySelector('.error')||{}).textContent)||''");
  const currentEntry = async () => {
    const catalog = await bridge.request('session/catalog');
    return catalog.entries.find((e) => e.current) || null;
  };
  // 界面真实发送一条：先填草稿再等按钮可点——空草稿时 #send 本来就该禁用，顺序反了会死等。
  // 完成信号是双份：消息计数到位（refresh 已重投影）且 .error 出现起轮失败回执（startTask
  // 在无模型配置下显式报错并复位 turn.running，下一条发送才不会被入队分支吃掉）。
  const sendFromUi = async (text) => {
    await js(`(()=>{const n=document.querySelector('#composer');n.value=${JSON.stringify(text)};n.dispatchEvent(new Event('input',{bubbles:true}));return Vue.nextTick();})()`);
    if (!await wait("!document.querySelector('#send').disabled")) throw new Error(`草稿「${text}」填入后发送按钮长期不可点`);
    await js("document.querySelector('#send').click()");
  };

  try {
    seedIfNeeded();
    await bridge.start(SESSION_DIR);
    win = createWindow();
    if (!await wait("!!document.querySelector('#composer') && !!window.sacode", 200)) throw new Error('渲染层未就绪');

    if (phase === 'fill-and-clear') {
      // 夹具只种身份基线（标题）：对话历史全部经界面真实发送进入真源，不在宿主侧伪造消息。
      // session/catalog 每次请求都从盘上重扫（host main.cj handleRpc48），append 即持久，立即可见。
      await bridge.request('session/append', { eventType: 'session/title', data: '清空验收会话' });

      // 种子 5 事件中消息面可见的是 assistant+user 两条（system 被 conversationMessages 滤掉）。
      note(await wait("document.querySelectorAll('#messages [data-msg-id]').length===2"),
        `启动后种子消息进入消息面（实际 ${await domCount()} 条，应为 assistant+user 各一）`);

      const baseline = await bridge.request('session/projection');
      for (let i = 1; i <= 8; i++) {
        await sendFromUi(`清空验收第 ${i} 条消息`);
        // 第 1 条的双份完成信号：计数到位（refresh 已重投影）+ .error 出现起轮失败回执。
        // 后续条只等计数：上一条的 error 面板不会自动消失，「有 error」对它们是永真断言。
        const probe = i === 1
          ? `document.querySelectorAll('#messages [data-msg-id]').length===3 && ((document.querySelector('.error')||{}).textContent||'').length>0`
          : `document.querySelectorAll('#messages [data-msg-id]').length===${2 + i}`;
        if (!await wait(probe)) throw new Error(`第 ${i} 条消息发送未完成（消息面 ${await domCount()} 条，界面报错 ${(await errorText()).slice(0, 120)}）`);
      }
      note((await domCount()) === 10, `种子 2 条 + 界面真实发送 8 条凑满消息面 10 条（实际 ${await domCount()} 条）`);
      const before = await bridge.request('session/projection');
      note(Number.isSafeInteger(baseline.projection) && before.projection === baseline.projection + 8,
        `核心投影新增 8 条消息（发送前 ${baseline.projection}，发送后 ${before.projection}）`);
      note(Array.isArray(before.messageRows) && Array.from({length:8},(_,i)=>`清空验收第 ${i+1} 条消息`).every(text=>
        before.messageRows.filter(row=>row.eventType==='user/message' && row.text===text).length===1), '核心投影逐条包含 8 条新消息且不重复');

      // 命令菜单的真实入口：输入 “/” 触发 slashTrigger，菜单直接开到「可用命令」分区。
      // 先等附件按钮可用：catalogBusy 在飞时 show() 会静默返回，菜单永远不开。
      if (!await wait("!document.querySelector('.attachments-add').disabled")) throw new Error('附件菜单入口长期不可点');
      await js("(()=>{const n=document.querySelector('#composer');n.value='/';n.dispatchEvent(new Event('input',{bubbles:true}));return Vue.nextTick();})()");
      if (!await wait("(()=>{const cards=[...document.querySelectorAll('.composer-menu-popover .composer-menu-card strong')];return cards.some(s=>s.textContent==='清空对话');})()")) {
        throw new Error('命令菜单未出现「清空对话」入口');
      }
      note(true, '输入 “/” 唤出的命令菜单列出「清空对话」卡片');
      await js("(()=>{const card=[...document.querySelectorAll('.composer-menu-popover .composer-menu-card')].find(b=>b.querySelector('strong')?.textContent==='清空对话');if(!card||card.disabled)throw Error('clear-card-unavailable');card.click();return true;})()");

      const cleared = await wait("document.querySelectorAll('#messages [data-msg-id]').length===0 && [...document.querySelectorAll('.note[role=status]')].some(n=>n.textContent.includes('对话已清空'))");
      note(cleared, `点「清空对话」后消息面归零并给出成功提示（提示 ${await noticeTexts()}）`);
      note(await wait("(()=>{const p=document.querySelector('#app')?._vnode?.component?.proxy;return !p?.clearBusy;})()"), '清空流程完全结束，clearBusy 已释放');

      const after = await bridge.request('session/projection');
      note(after.projection === 0, `清空后核心投影归零（实际 ${after.projection}）`);
      const entry = await currentEntry();
      note(!!entry && entry.title === '清空验收会话', `清空后目录仍按标题列出该会话（实际 ${entry ? entry.title : '无'}）`);
      const log = readFileSync(SESSION_LOG, 'utf8');
      note(!log.includes('清空验收第'), '盘上不得残留 10 条旧对话');
      note(log.includes('清空验收会话'), '盘上保留标题基线');
    } else {
      // 重开应用语义：seedIfNeeded 幂等（session.log 已存在不重种），投影必须来自清空后的盘上事实。
      // 防假绿：初始 proj 是全零对象、catalog 初始 null——两个信号都到位才算真的从盘上取回了空会话，
      // 否则「消息面为空」会在投影尚未加载时假绿。清空后盘上基线只有 1 条 session/title。
      // （data-catalog-ready 在根元素 div.app 上，不在挂载容器 #app 上，读 proxy 同源更稳。）
      if (!await wait("(()=>{const p=document.querySelector('#app')?._vnode?.component?.proxy;return !!p?.proj&&Number(p.proj?.events)>=1&&!!p?.catalog;})()")) {
        throw new Error('重开后渲染层投影未加载，无法判空');
      }
      note(true, '重开后渲染层已从盘上取回投影（events>=1 且 catalog 就绪）');
      if (!await wait("!!document.querySelector('.tips-bar')")) console.log('CLEAR_UI_WARN 未等到启动提醒条，继续按投影判据验收');
      await nap(600);
      note((await domCount()) === 0, `重开后消息面仍为空（实际 ${await domCount()} 条）`);
      const reopened = await bridge.request('session/projection');
      note(reopened.projection === 0, `重开后核心投影仍为 0（实际 ${reopened.projection}）`);
      note(!readFileSync(SESSION_LOG, 'utf8').includes('清空验收第'), '重开回放后盘上依旧没有旧对话');
      const entry = await currentEntry();
      note(!!entry && entry.title === '清空验收会话', `重开后会话标题基线保留（实际 ${entry ? entry.title : '无'}）`);

      await sendFromUi('清空之后的新消息');
      const sent = await wait("document.querySelectorAll('#messages [data-msg-id]').length===1 && ((document.querySelector('.error')||{}).textContent||'').length>0");
      note(sent, '清空后再发 1 条新消息正常进入消息面');
      const afterSend = await bridge.request('session/projection');
      note(afterSend.projection === 1, `新消息进入核心投影（实际 ${afterSend.projection}）`);
      note(readFileSync(SESSION_LOG, 'utf8').includes('清空之后的新消息'), '新消息真实落盘');
    }

    console.log(bad === 0 ? 'CLEAR_UI_ACCEPTANCE PASS' : `CLEAR_UI_ACCEPTANCE FAIL ${bad} 项检查失败`);
    try { await bridge.stop(); } catch (_) {}
    app.exit(bad === 0 ? 0 : 1);
  } catch (error) {
    console.error('CLEAR_UI_ACCEPTANCE FAIL', error);
    try {
      console.error('CLEAR_UI_DOM', await js("JSON.stringify({messages:document.querySelectorAll('#messages [data-msg-id]').length,notices:[...document.querySelectorAll('.note[role=status]')].map(n=>n.textContent),error:((document.querySelector('.error')||{}).textContent)||'',menu:!!document.querySelector('.composer-menu-popover'),composer:(document.querySelector('#composer')||{}).value||''})"));
    } catch (_) {}
    try { await bridge.stop(); } catch (_) {}
    app.exit(1);
  }
};
