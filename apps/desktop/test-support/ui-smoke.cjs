// 桌面黄金路径验收；依赖由主进程注入，不注册产品 IPC。
const { existsSync, writeFileSync, mkdirSync } = require("node:fs");
const { join } = require("node:path");

const nap = (ms) => new Promise((r) => setTimeout(r, ms));

// 桌面黄金路径的运行时验收：真窗口里的 Vue 渲染层 → preload → IPC → 仓颉宿主 → 会话日志 → 再投影。
// 只看 DOM 里有 JSON 不算数——必须证明点击真的被核心落盘，且投影、流式、审批、取消各自有终态。
async function uiSmoke(context) {
  const { app, nativeTheme, HOST, SESSION_DIR, SESSION_LOG, bridge, seedIfNeeded, createWindow } = context;
  let win;
  let bad = 0;
  const checks = [];
  // 逐行标明成败：措辞固定打印会让人把通过读成失败（本文件第一版就这么错过一次）
  const note = (ok, line) => {
    if (!ok) bad += 1;
    checks.push({ passed: !!ok, description: line });
    console.log(`UI ${ok ? "OK  " : "FAIL"} ${line}`);
  };
  const js = (code) => win.webContents.executeJavaScript(code, true);
  const text = async (sel) => (await js(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return e ? e.textContent : ""; })()`)) || "";
  const count = async (sel) => Number(await js(`document.querySelectorAll(${JSON.stringify(sel)}).length`));
  const click = async (sel) => {
    // 常规发送路径等待真实回执；重复点击的专门验收仍在同帧直接操作按钮。
    if(sel==='#send' && !await waitFor(()=>js("!!document.querySelector('#send') && !document.querySelector('#send').disabled"))) return false;
    return js(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; e.click(); return true; })()`);
  };
  const waitFor = async (probe, tries = 120) => {
    for (let i = 0; i < tries; i++) {
      if (await probe()) return true;
      await nap(50);
    }
    return false;
  };

  if (!existsSync(HOST)) {
    console.log(`UI_SMOKE FAIL 缺少自包含宿主: ${HOST}`);
    app.exit(2);
    return;
  }
  seedIfNeeded();
  win = createWindow();

  // 0) 组件库必须真的被折叠进来：光在 package.json 里写着不算接了组件库。
  //    这条只验「产物加载到了且是可用的组件定义」，渲染语义由后面的气泡断言各自负责。
  //    判 setup 是函数而不是 typeof === "function"：库用 defineComponent + withScopeId 包装，
  //    导出的是带 setup 的选项对象（实测 typeof 为 object），按构造函数判会假红。
  //    必须轮询：窗口刚 createWindow 时文档还没装载，即时读会在旧上下文里取到 undefined。
  const trShape = () => js(
    "(() => { const T = window.TinyRobot || {};" +
    " return ['Bubble', 'BubbleList', 'BubbleProvider']" +
    " .map((k) => (T[k] && typeof T[k].setup === 'function' ? k : '缺' + k)).join(','); })()"
  );
  const trReady = await waitFor(async () => (await trShape()) === "Bubble,BubbleList,BubbleProvider");
  note(trReady, `TinyRobot 折叠产物已加载=${await trShape()}`);

  // 1) 渲染层必须由 Vue 挂出来，且消息只来自核心投影。
  //    消息面换成 BubbleList 后按「组」计：种子是 system/developer/assistant/user 四个角色，各成一组。
  const mounted = await waitFor(() => count("#messages .tr-bubble").then((n) => n >= 4));
  note(mounted, `Vue 挂载后气泡组数=${await count("#messages .tr-bubble")}（核心投影给出）`);
  // 原生 Tab/Escape 验收必须有真实窗口焦点，隐藏窗口的 hasFocus 会偶发失效。
  win.show(); win.focus(); win.webContents.focus();
  if (!await waitFor(()=>js('document.hasFocus()'))) throw new Error('UI 冒烟窗口未取得键盘焦点');
  await js("document.querySelector('#toggle-side').click();document.querySelector('#developer-diagnostics').open=true");
  const projText = await text("#count-events");
  note(/^\d+$/.test(projText.split(" ")[1] || ""), `计数条 events=${projText}`);

  // 2) 沙箱与隔离必须真生效
  const leaked = await js("typeof window.require");
  note(leaked === "undefined", `渲染层 require 类型=${leaked}（应为 undefined）`);
  const apiShape = await js(
    "['projection','userSend','toolsList','toolCall','approvalAsk','approvalAnswer','turnStart','turnPoll','turnCancel','usageStatus','usageSetBudget','appearanceGet','appearanceSetTheme','globalAppearanceGet','globalAppearanceSetTheme','globalAppearanceSetFontSize','sessionCatalog','sessionCreate','sessionSelect','workspaceGet','workspaceChoose'].map(k => typeof (window.dsh||{})[k]).join(',')"
  );
  note(apiShape === Array(21).fill("function").join(","), `preload 暴露面=${apiShape}`);
  // 暴露面必须是「恰好这些」：多出一个泛化 request 通道就等于把宿主协议面交给网页
  const apiExtra = await js("Object.keys(window.dsh||{}).filter(k => ['projection','userSend','toolsList','toolCall','approvalAsk','approvalAnswer','turnStart','turnPoll','turnCancel','usageStatus','usageSetBudget','appearanceGet','appearanceSetTheme','globalAppearanceGet','globalAppearanceSetTheme','globalAppearanceSetFontSize','sessionCatalog','sessionCreate','sessionSelect','workspaceGet','workspaceChoose'].indexOf(k) < 0).join(',')");
  note(apiExtra === "", `preload 未登记的额外键=${apiExtra || "（无）"}`);

  const catalogBefore = await bridge.request("session/catalog");
  const catalogEvents = await text('#count-events');
  await js("document.querySelector('#open-catalog').focus(); document.querySelector('#open-catalog').click()");
  note(await waitFor(()=>js("!!document.querySelector('.catalog-dialog[open] #catalog-root')")), "会话目录由真实核心加载");
  note(await js("document.querySelectorAll('.catalog-card').length") === catalogBefore.entries.length, "会话列表条数与核心目录投影一致");
  note(await text('.catalog-title') === catalogBefore.entries[0].title, "会话标题来自日志中的用户消息");
  note((await text('.catalog-meta')).includes(String(catalogBefore.entries[0].durable)), "会话列表使用落盘事件数");
  win.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});
  win.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});
  note(await waitFor(()=>js("!document.querySelector('.catalog-dialog[open]')")), "Escape 关闭会话列表");
  note(await js("document.activeElement.id === 'open-catalog'"), "会话列表关闭后恢复导航焦点");
  note(await text('#count-events') === catalogEvents, "只读会话目录不修改会话事件");

  // 工具详情只读取核心清单，模态关闭不执行工具或消费审批。
  await waitFor(() => count('#detail-write').then(n => n === 1));
  const detailEvents = await text('#count-events');
  await js("document.querySelector('#detail-write').focus(); document.querySelector('#detail-write').click()");
  note(await waitFor(() => count('dialog[open]').then(n => n === 1)), "真实工具详情弹窗已打开");
  note((await text('dialog')).includes('write') && (await text('dialog')).includes('每次执行需一次性审批'), "工具详情保留协议标识与核心授权要求");
  note(await js("document.querySelector('dialog').contains(document.activeElement)"), "打开弹窗后焦点位于模态内部");
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Tab' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Tab' });
  await nap(50);
  note(await js("document.querySelector('dialog').contains(document.activeElement)"), "Tab 不将焦点移出工具详情弹窗");
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  note(await waitFor(() => count('dialog[open]').then(n => n === 0)), "Escape 关闭工具详情");
  note(await js("document.activeElement.id === 'detail-write'"), "弹窗关闭后焦点归还详情按钮");
  note((await text('#count-events')) === detailEvents, "查看详情未新增会话事件或审批");
  await click('#side-tab-guide');
  note(await js("!document.querySelector('#side-page-guide').hidden && document.querySelector('#side-page-inspect').hidden"), "指南标签切换到独立右侧页面");
  note((await text('#guide-panel')).includes('SaCode 使用指南') && (await text('#guide-panel')).includes('真实模型任务尚未开放'), "中文指南明确当前可用操作与模型限制");
  await js("document.querySelector('#side-tab-guide').focus()");
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Home' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Home' });
  note(await waitFor(() => js("document.activeElement.id === 'side-tab-inspect' && !document.querySelector('#side-page-inspect').hidden")), "Home 切换首个标签并同步焦点");
  await click('#side-tab-preview');
  note((await text('#preview-empty')).includes('暂无读取记录'), "没有读取事实时显示文档预览空状态");
  await click('#side-tab-guide');
  await click('#open-budget');
  note(await waitFor(() => js("document.activeElement.id === 'budget-panel' && !document.querySelector('#side-page-inspect').hidden")), "预算导航恢复工具页并聚焦目标分区");
  note((await text('#count-events')) === detailEvents, "右侧页面切换未改变会话事实");
  await js("document.querySelector('#composer').focus()");
  const chord = async (keyCode,modifiers=['control']) => {
    win.webContents.focus();
    await waitFor(()=>js("document.hasFocus()"));
    win.webContents.sendInputEvent({type:'keyDown',keyCode,modifiers});
    win.webContents.sendInputEvent({type:'keyUp',keyCode,modifiers});
    await nap(50);
  };
  await chord(',');
  note(await waitFor(()=>count('.settings-dialog[open]').then(n=>n===1)), "Ctrl+, 从输入区打开设置");
  await chord('L');
  note(await js("document.querySelector('.settings-dialog').contains(document.activeElement)"), "全局聚焦快捷键不穿透设置模态");
  await chord('Escape',[]);
  note(await waitFor(()=>count('.settings-dialog[open]').then(n=>n===0)) && await js("document.activeElement.id==='composer'"), "快捷键打开的设置关闭后返回原输入焦点");
  await chord('P',['control','shift']);
  note(await waitFor(()=>js("document.activeElement.id==='preview-panel' && !document.querySelector('#side-page-preview').hidden")), "Ctrl+Shift+P 打开并聚焦文档预览");
  await chord('L');
  note(await js("document.activeElement.id==='composer'"), "Ctrl+L 从预览返回输入区");
  await click('#side-tab-inspect');
  await js("document.querySelector('#open-settings').focus(); document.querySelector('#open-settings').click()");
  note(await waitFor(()=>count('.settings-dialog[open]').then(n=>n===1)), "中文 SaCode 设置窗口打开");
  note(await js("document.activeElement.id==='settings-tab-general' && document.querySelector('.settings-tabs').getAttribute('aria-orientation')==='vertical'"), "设置打开后焦点进入当前纵向分类");
  note((await text('.language-settings'))==='语言中文' && await js("!document.querySelector('#settings-budget-panel')"), "通用设置保持中文，预算操作集中在右侧用量区");
  note(await waitFor(()=>js("document.querySelector('#theme-system').getAttribute('aria-pressed')==='true'")), "全局主题默认跟随系统");
  for (const theme of ['light','dark','system']) {
    await click('#theme-'+theme);
    note(await waitFor(()=>js(`document.querySelector('#theme-${theme}').getAttribute('aria-pressed')==='true' && document.querySelector('#appearance-note').textContent.includes('已保存')`)) && nativeTheme.themeSource===theme, `真实保存主题并驱动 Electron 主题=${theme}`);
    if (theme==='dark') {
      win.reload();
      note(await waitFor(()=>js("document.querySelector('#theme-dark')?.getAttribute('aria-pressed')==='true' && !document.querySelector('#theme-dark').disabled")) && nativeTheme.themeSource==='dark', "重载渲染层从核心恢复已保存主题");
      await js("document.querySelector('#open-settings').focus(); document.querySelector('#open-settings').click()");
    }
  }
  note(require('node:fs').readFileSync(join(SESSION_DIR,'user-settings','user-settings.log'),'utf8').includes('settings/theme\tsystem') && !require('node:fs').readFileSync(SESSION_LOG,'utf8').includes('appearance/theme'), "主题落盘到用户配置，界面不再写入会话主题");
  note(await waitFor(()=>js("document.querySelector('#font-value').textContent==='14'")), "全局正文字号默认 14");
  await click('#font-increase');
  note(await waitFor(()=>js("document.querySelector('#font-value').textContent==='15' && getComputedStyle(document.querySelector('#composer')).fontSize==='15px' && getComputedStyle(document.querySelector('#composer')).lineHeight==='25px'")), "字号控件保存后正文与输入区共用字号轴");
  note((await bridge.request('global/appearance/get')).fontSize===15 && !require('node:fs').readFileSync(SESSION_LOG,'utf8').includes('settings/font-size'), "字号保存在独立全局配置，不写会话日志");
  for(const size of [22,10,14]) {
    await js(`window.dsh.globalAppearanceSetFontSize(${size})`);win.reload();
    note(await waitFor(()=>js(`document.querySelector('#font-value').textContent==='${size}' && getComputedStyle(document.querySelector('#composer')).fontSize==='${size}px'`)), `重载从核心恢复全局字号=${size}`);
    await js("document.querySelector('#open-settings').focus();document.querySelector('#open-settings').click()");
    await waitFor(()=>js("!!document.querySelector('.settings-dialog[open]')"));
    if(size!==14) note(await js(`document.querySelector('#font-${size===22?'increase':'decrease'}').disabled`), `字号边界禁用越界按钮=${size}`);
  }
  note(await js("window.dsh.globalAppearanceSetFontSize(14.5).then(()=>false,e=>String(e.message).includes('bad-font-size'))"), "IPC 拒绝非法字号而不交给渲染层伪造配置");
  const fontLease=join(SESSION_DIR,'user-settings','user-settings.log.lease');
  require('node:fs').writeFileSync(fontLease,`writer=${process.pid}-ui-font-test`);
  try {
    await click('#theme-dark');
    note(await waitFor(()=>js("document.querySelector('#appearance-note').textContent.includes('另一入口') && document.querySelector('#theme-system').getAttribute('aria-pressed')==='true'")) && nativeTheme.themeSource==='system', "全局主题保存被拒时不改变选中态和窗口颜色");
    await click('#font-increase');
    note(await waitFor(()=>js("document.querySelector('#font-note').textContent.includes('另一入口') && document.querySelector('#font-value').textContent==='14' && getComputedStyle(document.querySelector('#composer')).fontSize==='14px'")), "字号保存被拒时保留核心读数和原排版");
  } finally {require('node:fs').unlinkSync(fontLease);}
  note(await js("window.dsh.globalAppearanceSetTheme('blue').then(()=>false,e=>String(e.message).includes('bad-theme'))") && nativeTheme.themeSource==='system', "非法主题被 IPC 拒绝且窗口主题不变");
  await bridge.request('global/appearance/set-theme',{theme:'dark'});
  await click('#font-increase');
  note(await waitFor(()=>js("document.querySelector('#font-value').textContent==='15' && document.querySelector('#theme-dark').getAttribute('aria-pressed')==='true'")) && nativeTheme.themeSource==='dark', "字号保存返回的完整用户快照同步另一入口修改的主题");
  await js("window.dsh.globalAppearanceSetFontSize(14)");
  await click('#theme-system');
  note(await waitFor(()=>js("document.querySelector('#font-value').textContent==='14' && document.querySelector('#theme-system').getAttribute('aria-pressed')==='true'")) && nativeTheme.themeSource==='system', "主题保存保持另一字段字号并恢复系统主题");
  await click('#settings-tab-models');
  note((await text('#settings-page-models')).includes('模型管理后端尚未接入') && await count('#models-add-provider')===1, "模型页展示提供商管理并如实标注后端未接入");
  await js("document.querySelector('#settings-tab-models').focus()");
  const settingsFrameBefore=await js("(()=>{const r=document.querySelector('.settings-dialog').getBoundingClientRect();return {width:r.width,height:r.height};})()");
  await chord('Down',[]);
  const settingsKeyReady=await waitFor(()=>js("document.activeElement.id==='settings-tab-plugins' && !document.querySelector('#settings-page-plugins').hidden"));
  note(settingsKeyReady, "设置分类支持键盘切换与焦点同步" + (settingsKeyReady?'':await js("JSON.stringify({focus:document.activeElement.id,selected:document.querySelector('.settings-tab[aria-selected=true]').id,hidden:document.querySelector('#settings-page-plugins').hidden})")));
  note(await js(`(()=>{const r=document.querySelector('.settings-dialog').getBoundingClientRect();return Math.abs(r.width-${settingsFrameBefore.width})<1 && Math.abs(r.height-${settingsFrameBefore.height})<1;})()`), "设置分类切换不会改变面板尺寸");
  await chord('Up',[]);
  note(await waitFor(()=>js("document.activeElement.id==='settings-tab-models' && !document.querySelector('#settings-page-models').hidden")), "纵向分类向上切换同步内容");
  await chord('Home',[]);
  note(await waitFor(()=>js("document.activeElement.id==='settings-tab-general' && !document.querySelector('#settings-page-general').hidden")), "分类 Home 返回通用页");
  await chord('End',[]);
  note(await waitFor(()=>js("document.activeElement.id==='settings-tab-plugins' && !document.querySelector('#settings-page-plugins').hidden")), "分类 End 进入最后一页");
  note(await js("(async()=>{const r=await window.dsh.toolsList();const rows=[...document.querySelectorAll('.settings-tool')];return rows.length===r.tools.length && r.tools.every(t=>rows.some(e=>e.dataset.toolName===t.name && e.textContent.includes(t.description)));})()"), "设置工具清单逐项对应核心响应");
  win.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'}); win.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});
  note(await waitFor(()=>count('.settings-dialog[open]').then(n=>n===0)) && await js("document.activeElement.id==='open-settings'"), "关闭设置后焦点返回导航按钮");

  // 3) 多行输入经 IPC 落到核心，且只算一条事件
  let beforeEvents = Number((await text("#count-events")).split(" ")[1]);
  const setDraftForSize=async(value)=>js(`(()=>{const n=document.querySelector('#composer');n.value=${JSON.stringify(value)};n.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await setDraftForSize('   \n');
  note(await waitFor(()=>js("document.querySelector('#send').disabled && getComputedStyle(document.querySelector('#send')).opacity==='0.4'")), "空白草稿保持发送禁用与四成透明度");
  await js("document.querySelector('#composer').focus()");
  win.webContents.sendInputEvent({type:'keyDown',keyCode:'Enter',modifiers:['control']});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Enter',modifiers:['control']});
  await new Promise(r=>setTimeout(r,100));
  note(Number((await text('#count-events')).split(' ')[1])===beforeEvents, "空白快捷键发送不新增会话事实");
  await setDraftForSize('自动增长输入验证\n'.repeat(5));
  note(await waitFor(()=>js("document.querySelector('#composer').getBoundingClientRect().height>36")), "多行草稿自动扩展文本域");
  await setDraftForSize('超过上限的中文草稿\n'.repeat(30));
  note(await waitFor(()=>js("(()=>{const n=document.querySelector('#composer');return n.scrollHeight>n.clientHeight && n.getBoundingClientRect().height<=Math.min(340,innerHeight-360)+1;})()")), "长草稿达到上限后内部滚动");
  await setDraftForSize('');
  const collapsedDraft=await waitFor(()=>js("Math.abs(document.querySelector('#composer').getBoundingClientRect().height-(document.querySelector('.app').dataset.emptyConversation==='true'?52:36))<1"));
  note(collapsedDraft, "删除草稿后高度回到官方对应阶段最小值"+(collapsedDraft?'':await js("(()=>{const n=document.querySelector('#composer'),s=getComputedStyle(n);return JSON.stringify({height:n.getBoundingClientRect().height,min:s.minHeight,inline:n.style.height,scroll:n.scrollHeight,value:n.value,phase:document.querySelector('.app').dataset.emptyConversation,font:s.fontSize,line:s.lineHeight});})()")));
  const draftWindowSize=win.getContentSize();
  const draftColumns=await js("({sidebarClosed:document.querySelector('.app').dataset.sidebarCollapsed==='true',rightOpen:!document.querySelector('.side').hidden})");
  try {
    win.setContentSize(1440,900);
    await waitFor(()=>js("innerWidth===1440 && innerHeight===900"));
    // 固定栏位状态，避免窄窗口自动收栏抵消输入区变窄，导致旧断言误报。
    await js("(()=>{if(!document.querySelector('.side').hidden)document.querySelector('#close-side').click();if(document.querySelector('.app').dataset.sidebarCollapsed!=='true')document.querySelector('#toggle-sidebar').click();})()");
    await waitFor(()=>js("document.querySelector('.side').hidden && document.querySelector('.app').dataset.sidebarCollapsed==='true'"));
    await setDraftForSize('窗口宽度变化应重新测量输入高度。'.repeat(10));
    await nap(50);
    const wideDraftHeight=await js("document.querySelector('#composer').getBoundingClientRect().height");
    win.setContentSize(860,600);
    const narrowResized=await waitFor(()=>js(`Math.abs(innerWidth-860)<=1 && document.querySelector('#composer').getBoundingClientRect().height>${wideDraftHeight}`));
    note(narrowResized, "窄窗口重新折行并更新草稿高度"+(narrowResized?'':await js(`(()=>{const n=document.querySelector('#composer');return JSON.stringify({viewport:innerWidth,wideHeight:${wideDraftHeight},narrowHeight:n.getBoundingClientRect().height,inputWidth:n.getBoundingClientRect().width,scrollHeight:n.scrollHeight});})()`)));
  } finally {
    win.setContentSize(...draftWindowSize);await setDraftForSize('');
    if(!draftColumns.sidebarClosed) await js("document.querySelector('#toggle-sidebar').click()");
    if(draftColumns.rightOpen) await js("document.querySelector('#toggle-side').click()");
  }
  note(Number((await text('#count-events')).split(' ')[1])===beforeEvents, "草稿高度调整不写会话日志");
  const deniedDraft='长'.repeat(8001);
  await setDraftForSize(deniedDraft);await click('#send');
  note(await waitFor(()=>js("document.querySelector('#composer').value.length===8001 && document.querySelector('.error').textContent.includes('8000') && !document.querySelector('#send').disabled")), "真实 IPC 拒绝过长消息后保留草稿并恢复发送控件");
  note(Number((await text('#count-events')).split(' ')[1])===beforeEvents, "被拒消息没有写入核心会话日志");
  const sendRequest=bridge.request.bind(bridge);let sendRequests=0;
  bridge.request=async(method,params,...rest)=>{if(method==='session/append' && params?.eventType==='user/message'){sendRequests++;await nap(200);}return sendRequest(method,params,...rest);};
  try {
    await setDraftForSize('回执前保留的原始消息');
    const pendingSend=await js("(()=>{document.querySelector('#send').click();document.querySelector('#send').click();return Vue.nextTick().then(()=>({locked:document.querySelector('#send').disabled,busy:document.querySelector('#send').getAttribute('aria-busy'),draft:document.querySelector('#composer').value,sessionLocked:document.querySelector('#sidebar-new-session').disabled}));})()");
    note(pendingSend.locked && pendingSend.busy==='true' && pendingSend.draft==='回执前保留的原始消息' && pendingSend.sessionLocked, "消息等待真实回执时保留草稿并阻止重复发送和会话切换");
    await setDraftForSize('请求期间继续编辑的新草稿');
    note(await waitFor(()=>js("document.querySelector('#messages').textContent.includes('回执前保留的原始消息') && !document.querySelector('#send').disabled && document.querySelector('#composer').value==='请求期间继续编辑的新草稿'")), "成功回执不会清空请求期间新编辑的草稿");
    note(sendRequests===1 && Number((await text('#count-events')).split(' ')[1])===beforeEvents+1, "同帧重复点击仅写入一条真实用户消息");
  } finally {bridge.request=sendRequest;await setDraftForSize('');}
  beforeEvents=Number((await text('#count-events')).split(' ')[1]);
  const typed = "第一行\n第二行 带\"引号\"";
  await js(`(() => { const t = document.getElementById('composer'); t.value = ${JSON.stringify(typed)}; t.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  await js("document.querySelector('#composer').focus()");
  const sendPoint=await js("(()=>{const r=document.querySelector('#send').getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};})()");
  win.webContents.sendInputEvent({type:'mouseMove',...sendPoint});win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...sendPoint});win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...sendPoint});
  note(await waitFor(()=>js("document.querySelector('#composer').value===''")), "真实圆形按钮点击发送已派发");
  note(await js("document.activeElement.id==='composer'"), "鼠标发送后保留输入焦点");
  const sent = await waitFor(async () => {
    const n = Number((await text("#count-events")).split(" ")[1]);
    return n === beforeEvents + 1;
  });
  note(sent, `多行消息后 events=${beforeEvents} → ${await text("#count-events")}`);
  const lastMsg = await js(`(() => { const m = document.querySelectorAll('#messages .tr-bubble'); return m[m.length - 1] ? m[m.length - 1].textContent : ''; })()`);
  note(lastMsg.includes("第一行") && lastMsg.includes("第二行") && lastMsg.includes('"引号"'), `末条消息回显=${JSON.stringify(lastMsg.slice(0, 40))}`);
  const durable = await text("#count-durable");
  const pending = await text("#count-pending");
  note(durable.split(" ")[1] === String(beforeEvents + 1) && pending.endsWith("0"), `落盘即 durable=${durable} pending=${pending}`);
  const logRaw = require("node:fs").readFileSync(SESSION_LOG, "utf8");
  note(/user\/message\t第一行\\n第二行/.test(logRaw), "多行正文按转义写成一行事件（裸换行没把日志劈开）");

  // 3a) 对话面的行为钉子：气泡外框真的出自组件库、角色与定位可断言、连续同角色合并。
  //     分组与折叠都只是这份投影之上的视图派生——这里不新增任何真源，断言读到的每个数
  //     都能回到 session.log 的那几条消息行。
  const listNodes = await count("#messages .tr-bubble-list");
  note(listNodes === 1, `BubbleList 容器数=${listNodes}（应为 1）`);
  const roleSpread = await js(
    "(() => { const m = document.querySelectorAll('#messages .tr-bubble'); const r = {};" +
    " m.forEach((e) => { const k = e.getAttribute('data-role') || '?'; r[k] = (r[k] || 0) + 1; });" +
    " return r['system'] + '/' + r['developer'] + '/' + r['assistant'] + '/' + r['user'] + '|组' + m.length; })()"
  );
  note(roleSpread === "1/1/1/1|组4", `种子角色分布=${roleSpread}`);
  // developer/message 是不变量 7 里第五类进模型历史的事件：核心认它之后，界面不许把它
  // 并入 system 显示，正文与原始前缀都要可按条追问。
  const devBubble = await js(
    "(() => { const e = document.querySelector('#messages .tr-bubble[data-role=\"developer\"]');" +
    " if (!e) return 'no-developer-group';" +
    " const t = e.querySelector('.msg-text[data-source-role]');" +
    " return ((t ? (t.textContent || '').trim() : '') === '请用中文协助完成项目任务。' ? 'visible' : 'text:' + (t ? t.textContent : ''))" +
    " + '|' + (t ? t.getAttribute('data-source-role') : 'no-source-role'); })()"
  );
  note(devBubble === "visible|developer/message", `developer 气泡=${devBubble}`);
  const placementPair = await js(
    "(() => { const q = (r) => { const e = document.querySelector('#messages .tr-bubble[data-role=\"' + r + '\"]');" +
    " return e ? e.getAttribute('data-placement') : 'missing'; };" +
    " return q('user') + '|' + q('assistant') + '|' + q('system') + '|' + q('developer'); })()"
  );
  note(placementPair === "end|start|start|start", `角色定位=${placementPair}（user 在右，其余在左）`);
  const labelShown = await text("#messages .msg-role");
  note(/^(系统|用户|助手|工具|开发者) · \d+ 条消息$/.test(labelShown), `组标签=${labelShown}`);
  // 连续同角色必须并成一组：再发一条 user，条数进组但组数不变。
  const groupsBeforeMerge = await count("#messages .tr-bubble");
  await js(`(() => { const t = document.getElementById('composer'); t.value = ${JSON.stringify("第二条 user 消息")}; t.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  note(await click("#send"), "已再发一条 user 消息");
  // 「组数不变」必须带非零前提，否则 0 === 0 会把「一个组都没渲染」喂成绿。
  const mergedIntoGroup = await waitFor(
    async () => groupsBeforeMerge >= 3 && (await count("#messages .tr-bubble")) === groupsBeforeMerge && (await text('#messages')).includes('第二条 user 消息')
  );
  note(mergedIntoGroup, `连续 user 合并：组数 ${groupsBeforeMerge} → ${await count("#messages .tr-bubble")}（应不变且 ≥ 3）`);
  const userGroupNodes = await count('#messages .tr-bubble[data-role="user"] .msg-text');
  note(userGroupNodes >= 2, `user 组内正文条数=${userGroupNodes}（合并后应 ≥ 2）`);

  // 3c) 长消息折叠：超阈值默认折起来，展开与收起都要有真实状态变化。
  //     正文尾部放一个只在原文里出现的哨兵串，判「有没有被截掉」就不用比长度。
  const tailMark = "TAIL-SENTINEL-9F2C";
  const readFold = () => js(
    "(() => { const n = document.querySelectorAll('#messages .msg-text[data-fold-state]');" +
    " const e = n[n.length - 1]; if (!e) return 'missing';" +
    " return e.getAttribute('data-fold-state') + '|' + ((e.textContent || '').includes('" + tailMark + "') ? 'has-tail' : 'no-tail'); })()"
  );
  const clickFold = (wantLabel) => js(
    "(() => { const n = document.querySelectorAll('#messages .msg-text[data-fold-state]');" +
    " const e = n[n.length - 1]; if (!e) return 'missing-node';" +
    " const b = document.querySelector('#messages [data-fold-toggle=\"' + e.getAttribute('data-msg-id') + '\"]');" +
    " if (!b) return 'no-toggle';" +
    " if (" + JSON.stringify(wantLabel) + " && b.textContent !== " + JSON.stringify(wantLabel) + ") return 'wrong-label:' + b.textContent;" +
    " b.click(); return 'ok'; })()"
  );
  await js(`(() => { const t = document.getElementById('composer'); t.value = ${JSON.stringify("长".repeat(260) + tailMark)}; t.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  note(await click("#send"), "已发一条超阈值的长消息");
  const foldedShown = await waitFor(async () => (await readFold()) === "folded|no-tail");
  note(foldedShown, `长消息折叠态=${await readFold()}（默认折起且尾部不可见）`);
  const plainNodes = await count('#messages .msg-text[data-fold-state="plain"]');
  note(plainNodes >= 3, `短正文保持 plain=${plainNodes}（未超阈值不该出现折叠按钮）`);
  const expandClicked = await clickFold("展开");
  note(expandClicked === "ok", `点展开=${expandClicked}`);
  const expandedShown = await waitFor(async () => (await readFold()) === "expanded|has-tail");
  note(expandedShown, `展开态=${await readFold()}（全文回到 DOM）`);
  const collapseClicked = await clickFold("收起");
  note(collapseClicked === "ok", `点收起=${collapseClicked}`);
  const refolded = await waitFor(async () => (await readFold()) === "folded|no-tail");
  note(refolded, `收起后回到折叠态=${await readFold()}`);

  // 3b) 组件库不是「装了就算」：类名要真的由 TinyVue 出，色值要真的从我们的令牌桥过去。
  //     桥接的反证是删掉 styles.css 末尾那一段 --tv-* 覆写 —— 那时两侧会各自解析成不同颜色。
  const tvCls = await js("(() => { const e = document.querySelector('#run-turn'); return e ? e.className : 'missing'; })()");
  note(/tiny-button/.test(tvCls), `跑一轮按钮由 TinyVue 渲染=${String(tvCls).slice(0, 48)}`);
  const bridgePair = await js(
    "(() => { const mk = (v) => { const d = document.createElement('div'); d.style.color = v; document.body.appendChild(d); const r = getComputedStyle(d).color; d.remove(); return r; }; return mk('var(--accent)') + '|' + mk('var(--tv-color-act-primary-bg)'); })()"
  );
  const [accentTok, tvTok] = String(bridgePair).split("|");
  note(accentTok === tvTok && accentTok.startsWith("rgb"), `TinyVue 主色令牌已接到本仓令牌=${accentTok} vs ${tvTok}`);
  // 判据只打「组件库渲染出来的元素」：它们的色值必须来自本仓令牌层。
  // 不扫全部元素——我们自己的 .msg-user 用的是 color-mix()，Chrome 会序列化成
  // color(srgb …)，跟任何单枚令牌的 rgb() 文本都不相等，那样只会造出假越界。
  const leakProbe = await js(
    `(() => {
      const names = ['--surface','--surface-2','--surface-3','--text','--text-muted','--border','--accent','--accent-text','--ok','--warn','--danger'];
      const mk = (v) => { const d = document.createElement('div'); d.style.color = v; document.body.appendChild(d); const r = getComputedStyle(d).color; d.remove(); return r; };
      const allowed = new Set(names.map((n) => mk('var(' + n + ')')));
      allowed.add('rgba(0, 0, 0, 0)');
      const bad = [];
      const tv = document.querySelectorAll('#app [class*="tiny-"], #app [class*="tr-bubble"]');
      tv.forEach((e) => {
        const cs = getComputedStyle(e);
        ['color','backgroundColor','borderTopColor'].forEach((p) => {
          const v = cs[p];
          if (v && !allowed.has(v)) bad.push(String(e.className).slice(0, 22) + '/' + p + '=' + v);
        });
      });
      return tv.length + '|' + bad.length + '|' + bad.slice(0, 4).join(',') + '|' + mk('var(--accent)');
    })()`
  );
  const [tvCount, leakCount, leakFirst, accentResolved] = String(leakProbe).split("|");
  note(
    Number(tvCount) > 0 && leakCount === "0",
    `组件库元素的色值全部来自本仓令牌（探到 tiny 元素 ${tvCount} 个，越界 ${leakCount} 处，首个=${leakFirst || "无"}，accent=${accentResolved}）`
  );

  // 4) 流式：完整一轮必须把核心产出的帧渲回界面并落到终态
  note(await click("#run-turn"), "已发起完整一轮");
  const settledTurn = await waitFor(async () => (await text("#turn-state")) === "状态 已完成");
  note(settledTurn, `turn 终态=${await text("#turn-state")}`);
  // 用量读数必须由核心结算帧驱动。冒烟态现在总是从一次性目录起（见 SESSION_DIR），
  // 所以这里可以钉死绝对值：全新会话的第一笔就是 12，档位停在默认 200。
  // 之前写成「12 的倍数」是被跨次累积的真实 sessionData 逼的妥协，不再需要。
  const usageShown = await waitFor(async () => (await text("#turn-usage")).includes("用量 12/200 · 已计量"));
  const usageAfterFull = await text("#turn-usage");
  note(usageShown, `用量读数=${usageAfterFull}`);
  // 干净收束后正文必须回到日志这份真源：界面上那句助手话要出自核心投影，
  // 而不是出自 turn/poll 的瞬时帧——后者重启就没有了。
  const assistantTail = await js(
    "(() => { const m = document.querySelectorAll('#messages .tr-bubble[data-role=\"assistant\"]');" +
    " if (!m.length) return 'none';" +
    " const t = (m[m.length - 1].textContent || '').trim(); return t.slice(0, 40); })()"
  );
  note(String(assistantTail).includes("你好，world"), `助手正文由投影给出=${JSON.stringify(String(assistantTail))}`);
  // 同一句话不许有两份真源：投影已给出，流式回显框必须撤掉，否则界面上出现两次
  const streamLeft = await count("#stream");
  note(streamLeft === 0, `干净收束后流式回显框数=${streamLeft}（应为 0，正文只剩投影那一份）`);
  const assistantGroupsAfterFull = await count('#messages .tr-bubble[data-role="assistant"]');
  note(assistantGroupsAfterFull === 2, `助手气泡组数=${assistantGroupsAfterFull}（种子那组 + 本轮投影新落的那组）`);

  // 5) 取消：可取消那一轮停在帧间，点停止要改终态，不能只把按钮禁用
  note(await click("#run-turn-2"), "已发起可取消一轮");
  await waitFor(async () => (await text("#turn-state")) === "状态 执行中");
  note(await js("document.querySelector('#send').getAttribute('aria-label')==='停止执行' && !!document.querySelector('#send rect') && !document.querySelector('#send').disabled"), "空草稿执行中显示可用的圆形停止动作");
  note(await click("#send"), "输入区停止动作已派发核心取消");
  const cancelled = await waitFor(async () => (await text("#turn-state")) === "状态 已取消");
  note(cancelled, `取消终态=${await text("#turn-state")}`);
  // 取消的一轮不落 assistant/message：半截正文只能继续由流式回显框呈现，
  // 且不许多出一个助手气泡冒充「助手说过完整的话」。
  const partialEcho = await text("#stream");
  note(await js("(()=>{const n=document.querySelector('#stream');return !!n && getComputedStyle(n).fontSize==='14px' && getComputedStyle(n).lineHeight==='24px';})()"), "流式正文与助手消息共享字号和行高");
  note(await js("!!document.querySelector('#stream .stream-content > .markdown-body')"), "取消后的流式正文使用共享 Markdown 组件");
  note(await js("!document.querySelector('#stream .stream-status')"), "取消后撤去流式执行提示");
  note(partialEcho.includes("你好，world"), `取消轮回显保留半截正文=${JSON.stringify(partialEcho.slice(0, 40))}`);
  const assistantGroupsAfterCancel = await count('#messages .tr-bubble[data-role="assistant"]');
  note(
    assistantGroupsAfterCancel === assistantGroupsAfterFull,
    `取消轮后助手气泡组数=${assistantGroupsAfterCancel}（应与 ${assistantGroupsAfterFull} 一致，未新增）`
  );
  // 被取消的一轮不进计量：数值必须与上一轮结算时逐字一致，只允许判决词变成 absent
  const usageAfterCancel = await text("#turn-usage");
  const cancelUnchanged = usageAfterCancel.includes(" · 未收到用量") &&
    usageAfterCancel.split(" · ")[0] === usageAfterFull.split(" · ")[0];
  note(cancelUnchanged, `取消轮不计量=${usageAfterFull} -> ${usageAfterCancel}`);
  // 预算控制面：调大必须由核心拒且停在原档；收紧后徽章档位跟着核心回的数字走。
  const setBudgetField = (v) => js(
    `(() => { const i = document.getElementById('budget-input'); i.value = ${JSON.stringify(v)};` +
    " i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()"
  );
  await setBudgetField("500");
  note(await click("#apply-budget"), "已派发调大预算");
  const widened = await waitFor(async () => (await text("#budget-note")).includes("仍停在 200"));
  note(widened, `调大预算=${await text("#budget-note")}`);
  await setBudgetField("100");
  note(await click("#apply-budget"), "已派发收紧预算");
  const tightened = await waitFor(async () => (await text("#turn-usage")).includes("/100"));
  note(tightened, `收紧后读数=${await text("#turn-usage")}`);
  // 负数在渲染层就被挡（不给「把档位改成 NaN 从而谁都拦不住」留通路）
  await setBudgetField("-1");
  note(await click("#apply-budget"), "已派发负数预算");
  const negBlocked = await waitFor(async () => (await text("#budget-note")).includes("非负整数"));
  note(negBlocked, `负数预算=${await text("#budget-note")}`);

  // 6) 审批：拒绝与允许一次都必须由核心裁决，且界面如实显示两种结果
  note(await click("#tool-write"), "已点开需审批工具");
  note(await waitFor(() => text("#approval").then((t) => t.includes("工单 #"))), "审批浮层出现且带工单号（一次性放行，无永久授权按钮）");
  const pendingApproval = await text('#approval');
  await click('#side-tab-guide');
  note(await js("!!document.querySelector('#guide-approval') && document.querySelector('#side-tab-inspect').getAttribute('aria-label').includes('待审批')"), "指南页保留待审批提示与返回入口");
  await click('#guide-approval');
  note(await waitFor(() => js("document.activeElement.id === 'tools-panel' && !document.querySelector('#side-page-inspect').hidden")) && (await text('#approval')) === pendingApproval, "指南往返保留原审批工单并聚焦工具分区");
  note(await click("#deny"), "已点拒绝");
  const denied = await waitFor(async () => (await text("#outcome")).includes("被拒"));
  note(denied, `拒绝结果=${await text("#outcome")}`);
  // 放行这条腿同样要等：askTool 现在要跑一次 approval/ask 的协议往返才拿到工单，
  // 框不是同步出现的（点完就抢点 #allow-once 会在干净会话目录下偶发抢空）。
  note(await click("#tool-write"), "已再次点开需审批工具");
  note(await waitFor(async () => (await count("#allow-once")) > 0), "第二张工单的审批卡已出现");
  const apText = await text("#approval");
  note(apText.includes("工单 #"), `审批卡带工单号=${apText.slice(0, 48)}`);
  note(await click("#allow-once"), "已允许一次");
  const allowed = await waitFor(async () => (await text("#outcome")).includes("结果：ok"));
  note(allowed, `放行结果=${await text("#outcome")}`);
  // 工具事件走的是 append 档位：实例内可见但不等于已提交，界面须把 pending 显出来
  const pendingNow = Number((await text("#count-pending")).split(" ")[1] || "0");
  note(pendingNow > 0, `工具事件先只在实例内可见（pending=${pendingNow}），未 flush 不算已提交`);
  note((await text("#tool-counters")).includes("未登记 0"), `注册表计数=${await text("#tool-counters")}`);

  // 只读工具与写侧共用同一张注册表和同一条管线，但不需要工单：点了就直接执行，
  // 且不得顺手弹出审批卡（审批面只属于真的会改盘的动作）
  note((await text("#tool-read")).includes("免审批"), `只读工具卡片标出免审批=${(await text("#tool-read")).slice(0, 40)}`);
  note(await click("#tool-read"), "已点开只读工具");
  // 断言必须分得清「成功」与「被拒」：not-found 的报错里会带上参数串，
  // 只 include 正文的话，一条失败的消息也能把这条断言喂绿。
  const readBack = await waitFor(async () => {
    const t = await text("#outcome");
    return t.startsWith("结果：") && t.includes("hello-from-renderer");
  });
  note(readBack, `只读工具直接执行并读回盘上正文=${(await text("#outcome")).slice(0, 52)}`);
  note(!(await text("#approval")).includes("工单 #"), "点只读工具不应产生审批卡");
  await click('#side-tab-preview');
  note(await waitFor(async () => (await text('#preview-text')) === 'hello-from-renderer'), "文档预览逐字显示实际读取正文");
  note((await text('#preview-path')) === 'sacode-tool.txt' && (await text('#preview-meta')).includes('19 字节'), "预览文件名与字节数来自会话读取记录");
  note(await js("document.querySelector('#preview-empty') === null && !document.querySelector('#side-page-preview').hidden"), "成功读取后预览替换空状态");
  await js("document.querySelector('#preview-float').focus(); document.querySelector('#preview-float').click()");
  note(await waitFor(() => count('.floating-preview[open]').then(n=>n===1)) && (await text('#float-preview-text')) === (await text('#preview-text')), "浮动预览显示同一份读取快照");
  const floatRect = () => js("(() => {const r=document.querySelector('.floating-preview').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};})()");
  const initialFloat = await floatRect();
  await js("document.querySelector('.floating-preview .movable-header').focus()");
  win.webContents.sendInputEvent({type:'keyDown',keyCode:'Left'}); win.webContents.sendInputEvent({type:'keyUp',keyCode:'Left'});
  note(await waitFor(async()=>Math.abs((await floatRect()).x-(initialFloat.x-16))<1), "浮动标题支持方向键移动");
  await js("document.querySelector('.floating-preview .float-resize').focus()");
  win.webContents.sendInputEvent({type:'keyDown',keyCode:'Right'}); win.webContents.sendInputEvent({type:'keyUp',keyCode:'Right'});
  note(await waitFor(async()=>Math.abs((await floatRect()).width-(initialFloat.width+16))<1), "浮动缩放控件支持方向键调整尺寸");
  const beforeMove=await floatRect(), fx=Math.round(beforeMove.x+80), fy=Math.round(beforeMove.y+24);
  win.webContents.sendInputEvent({type:'mouseDown',x:fx,y:fy,button:'left',clickCount:1}); await nap(50);
  win.webContents.sendInputEvent({type:'mouseMove',x:fx-50,y:fy-30,modifiers:['leftButtonDown']}); await nap(50);
  win.webContents.sendInputEvent({type:'mouseUp',x:fx-50,y:fy-30,button:'left',clickCount:1});
  note(await waitFor(async()=>Math.abs((await floatRect()).x-(beforeMove.x-50))<1), "真实鼠标拖动浮动标题移动预览");
  const beforeSize=await floatRect(), rx=Math.round(beforeSize.x+beforeSize.width-16), ry=Math.round(beforeSize.y+beforeSize.height-16);
  win.webContents.sendInputEvent({type:'mouseDown',x:rx,y:ry,button:'left',clickCount:1}); await nap(50);
  win.webContents.sendInputEvent({type:'mouseMove',x:rx-32,y:ry+16,modifiers:['leftButtonDown']}); await nap(50);
  win.webContents.sendInputEvent({type:'mouseUp',x:rx-32,y:ry+16,button:'left',clickCount:1});
  note(await waitFor(async()=>Math.abs((await floatRect()).width-(beforeSize.width-32))<1), "真实鼠标拖动缩放控件调整尺寸");
  const oldSize=win.getContentSize(); win.setContentSize(860,600); await nap(100);
  note(await waitFor(() => js("(() => {const r=document.querySelector('.floating-preview').getBoundingClientRect();return Math.abs(innerWidth-860)<1 && Math.abs(innerHeight-600)<1 && r.left>=16 && r.top>=16 && r.right<=innerWidth-15 && r.bottom<=innerHeight-15;})()")), "主窗口缩小时浮动预览保持可见边距");
  win.setContentSize(...oldSize); await nap(50);
  await js("document.querySelector('#composer').focus()");
  note(await js("document.activeElement.id === 'composer'"), "浮动预览允许继续聚焦会话输入");
  await js("document.querySelector('#detail-write').focus(); document.querySelector('#detail-write').click()");
  note(await waitFor(() => count('dialog[open]').then(n=>n===2)), "工具模态可叠放在浮动预览上方");
  win.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});
  win.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});
  note(await waitFor(() => count('dialog[open]').then(n=>n===1)) && await js("document.querySelector('.floating-preview').open"), "Escape 只关闭上层工具详情并保留浮动预览");
  await js("document.querySelector('.floating-preview .dialog-header button').focus()");
  win.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});
  win.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});
  note(await waitFor(() => count('.floating-preview[open]').then(n=>n===0)) && await js("document.activeElement.id === 'preview-float'"), "Escape 关闭浮动预览并归还触发焦点");
  await click('#side-tab-inspect');
  const splitEvents = await text('#count-events');
  await click('#split-side');
  note(await waitFor(() => count('.side-secondary').then(n=>n===1)) && (await text('#split-preview-text')) === 'hello-from-renderer', "拆分窗格共享同一读取投影");
  await js("document.querySelector('#pane-divider').focus()");
  win.webContents.sendInputEvent({ type:'keyDown', keyCode:'Down' });
  win.webContents.sendInputEvent({ type:'keyUp', keyCode:'Down' });
  note(await waitFor(() => js("document.querySelector('#pane-divider').getAttribute('aria-valuenow') === '55'")), "分隔条支持键盘调整窗格比例");
  const drag = await js("(() => { const d=document.querySelector('#pane-divider').getBoundingClientRect(), c=document.querySelector('.side-content').getBoundingClientRect(); return { x:Math.round(d.left+d.width/2), from:Math.round(d.top+d.height/2), to:Math.round(c.top+c.height*.7) }; })()");
  win.webContents.sendInputEvent({type:'mouseDown',x:drag.x,y:drag.from,button:'left',clickCount:1});
  await nap(50);
  win.webContents.sendInputEvent({type:'mouseMove',x:drag.x,y:drag.to,modifiers:['leftButtonDown']});
  await nap(50);
  win.webContents.sendInputEvent({type:'mouseUp',x:drag.x,y:drag.to,button:'left',clickCount:1});
  note(await waitFor(() => js("Number(document.querySelector('#pane-divider').getAttribute('aria-valuenow')) >= 68 && Number(document.querySelector('#pane-divider').getAttribute('aria-valuenow')) <= 72")), "真实鼠标拖动调整窗格比例=" + await js("document.querySelector('#pane-divider').getAttribute('aria-valuenow')"));
  const releasedRatio = await js("document.querySelector('#pane-divider').getAttribute('aria-valuenow')");
  win.webContents.sendInputEvent({type:'mouseMove',x:drag.x,y:drag.from});
  await nap(50);
  note(await js("document.querySelector('#pane-divider').getAttribute('aria-valuenow')") === releasedRatio, "松开鼠标后停止调整并清理拖动监听");
  await click('#split-side');
  note(await waitFor(() => count('.side-secondary').then(n=>n===0)) && (await text('#count-events')) === splitEvents, "合并窗格不改变会话事实");
  const keyEvents=Number((await text('#count-events')).split(' ')[1]);
  await js("(() => {const input=document.querySelector('#composer');input.value='快捷键发送验证';input.dispatchEvent(new Event('input',{bubbles:true}));input.focus();})()");
  await chord('Enter');
  note(await waitFor(async()=>Number((await text('#count-events')).split(' ')[1])===keyEvents+1) && (await text('#messages')).includes('快捷键发送验证'), "Ctrl+Enter 经核心记录且只新增一条消息");
  await click('#open-budget');
  await js("(() => {const input=document.querySelector('#budget-input');input.value='90';input.dispatchEvent(new Event('input',{bubbles:true}));})()");
  // 统计实际核心调用；延迟仅用于验收处理中状态，不替换请求或响应。
  const originalRequest=bridge.request.bind(bridge); let budgetRequests=0;
  bridge.request=async (method,...args) => { if(method==='usage/set-budget') { budgetRequests++; await nap(150); } return originalRequest(method,...args); };
  const budgetPending=await js("(() => {document.querySelector('#apply-budget').click();document.querySelector('#apply-budget').click();return window.Vue.nextTick().then(()=>({locked:document.querySelector('#budget-input').disabled && document.querySelector('#apply-budget').disabled,busy:document.querySelector('#budget-panel').getAttribute('aria-busy')}));})()");
  note(budgetPending.locked && budgetPending.busy==='true', "预算提交中锁定表单且报告忙碌状态");
  note(await waitFor(async()=> (await text('#budget-note')).includes('已收紧到 90')), "预算变更通过核心校验");
  bridge.request=originalRequest;
  note(budgetRequests===1, "同帧重复提交只产生一次真实核心预算调用");
  note(await js("!document.querySelector('#budget-input').disabled && !document.querySelector('#apply-budget').disabled"), "预算回执完成后恢复表单控件");
  note((await text('#turn-usage')).includes('/90'), "预算变更同步更新核心用量投影");

  // tool/ 行的正文必须真的在气泡里，且原始角色前缀可按条追问：默认内容渲染器链把
  // role==="tool" 交给 ToolRole，而 ToolRole 只往 provider store 登记 tool_call_results、
  // 渲染一个注释节点——照默认链走，tool 正文会直接隐身。
  const toolProbe = await js(
    "(() => { const m = document.querySelectorAll('#messages .tr-bubble[data-role=\"tool\"]');" +
    " if (!m.length) return 'no-tool-group';" +
    " const e = m[m.length - 1];" +
    " const src = e.querySelector('.msg-text[data-source-role]');" +
    " return ((e.textContent || '').trim().length > 0 ? 'visible' : 'empty')" +
    " + '|' + (src ? src.getAttribute('data-source-role') : 'no-source-role'); })()"
  );
  note(/^visible\|tool\//.test(toolProbe), `tool 气泡=${toolProbe}`);

  // 超档必须当场拦得住：把档位收到低于一次消耗，再跑一轮就该失效。
  // 这段在 bridge.stop() 之前——stop 之后宿主已死，IPC 会超时。
  await setBudgetField("5");
  note(await click("#apply-budget"), "已派发收紧到 5");
  // 收紧要等一次 IPC 往返：这里必须 waitFor，即时读文案会拿到上一步的旧值
  const tightened5 = await waitFor(async () => (await text("#budget-note")).includes("已收紧到 5"));
  note(tightened5, `收紧到 5=${await text("#budget-note")}`);
  // 收紧后 refreshUsage 读 usage/status，核心回的 verdict=over-budget
  const overTurn = await waitFor(async () => (await text("#turn-usage")).includes("已超档"));
  note(overTurn, `超档读数=${await text("#turn-usage")}`);
  const overSettled = await waitFor(async () => (await text("#turn-usage")).includes("· 超出预算"));
  note(overSettled, `超档判决=${await text("#turn-usage")}`);
  // 核心侧 -32014 是真闸门；界面这层同时要把按钮锁住，别让人连点靠错误提示循环
  const lockState = await js(
    "(() => { const e = document.getElementById('run-turn');" +
    " if (!e) return 'missing';" +
    " return e.disabled === true ? 'attr' : (/disabled/.test(e.className) ? 'cls' : 'live'); })()"
  );
  note(lockState === "attr" || lockState === "cls", `超档后 run-turn 锁定态=${lockState}`);
  note((await text("#run-turn")).includes("已超档"), `超档后按钮文案=${await text("#run-turn")}`);

  // 仅替换系统选择器交回的用户选择，目录配置和文件工具仍走真实核心。
  const workspacePickerBefore=context.chooseWorkspaceDirectory;
  const workspaceUIPath=join(SESSION_DIR,'工作区 UI 项目'); mkdirSync(workspaceUIPath);
  await js("document.querySelector('#open-workspace').focus();document.querySelector('#open-workspace').click()");
  note(await waitFor(()=>count('.workspace-dialog[open] #workspace-directory').then(n=>n===1)), "工作区窗口读取当前会话目录");
  const workspaceEventsBefore=await text('#count-events');
  context.chooseWorkspaceDirectory=async()=>({canceled:true,filePaths:[]});
  await click('#choose-workspace');
  note(await waitFor(async()=>(await text('#workspace-note')).includes('已取消选择')), "取消目录选择保留原目录");
  note(await text('#count-events')===workspaceEventsBefore, "取消选择不写会话日志");
  let workspacePickerContract=false;
  context.chooseWorkspaceDirectory=async(options)=>{workspacePickerContract=options.properties.join(',')==='openDirectory' && options.title.includes('SaCode');return {canceled:false,filePaths:[workspaceUIPath]};};
  await click('#choose-workspace');
  note(await waitFor(async()=>(await text('#workspace-note')).includes('已保存')), "项目目录经核心落盘后显示已保存");
  note(workspacePickerContract && (await text('#workspace-directory')).includes('工作区 UI 项目'), "中文工作区和系统文件夹选择契约一致");
  context.chooseWorkspaceDirectory=workspacePickerBefore;
  win.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'}); win.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});
  note(await waitFor(()=>js("!document.querySelector('.workspace-dialog[open]') && document.activeElement.id==='open-workspace'")), "工作区 Escape 关闭并恢复导航焦点");
  await click('#tool-write'); await waitFor(()=>count('#allow-once').then(n=>n===1)); await click('#allow-once');
  note(await waitFor(async()=>(await text('#outcome')).startsWith('结果：')), "所选工作区的写入仍经过一次性审批");
  note(require('node:fs').readFileSync(join(workspaceUIPath,'sacode-tool.txt'),'utf8')==='hello-from-renderer', "相对文件实际写入带空格的中文项目目录");
  // 真实移动项目文件夹，检查界面保留原路径并说明恢复方式。
  const movedWorkspacePath=join(SESSION_DIR,'工作区 UI 项目 临时移动');
  require('node:fs').renameSync(workspaceUIPath,movedWorkspacePath);
  try {
    await click('#open-workspace');
    note(await waitFor(async()=>(await text('#workspace-description')).includes('请恢复该目录')), "项目目录丢失时显示恢复提示");
    note((await text('#workspace-directory'))===workspaceUIPath && (await text('.workspace-panel .badge'))==='目录不可用', "不可用目录保留原路径并显示错误状态");
    note(await js("!document.querySelector('#choose-workspace').disabled"), "目录不可用时仍允许重新选择");
    await click('.workspace-dialog .dialog-header button');
  } finally { require('node:fs').renameSync(movedWorkspacePath,workspaceUIPath); }

  // 真实新建/切换：验证来源隔离，保留各会话尚未发送的草稿。
  await js("document.querySelector('#open-settings').focus();document.querySelector('#open-settings').click()");
  await click('#theme-dark');
  note(await waitFor(()=>js("document.querySelector('#theme-dark').getAttribute('aria-pressed')==='true' && !document.querySelector('#theme-dark').disabled")) && nativeTheme.themeSource==='dark', "切换会话前保存用户级深色主题");
  await js("document.querySelector('.settings-dialog .dialog-header button').click()");
  await bridge.request('appearance/set-theme',{theme:'light'});
  note((await js("window.dsh.appearanceGet()")).theme==='light' && nativeTheme.themeSource==='dark', "旧会话主题可读取且不会覆盖全局窗口主题");
  const oldTheme=nativeTheme.themeSource;
  const catalogRequestBefore=bridge.request.bind(bridge);
  let catalogSnapshotCaptured=false, catalogSnapshotReleased=false, delayCatalogSnapshot=true;
  bridge.request=async(method,params)=>{
    const result=await catalogRequestBefore(method,params);
    if (method==='session/projection' && delayCatalogSnapshot) {
      delayCatalogSnapshot=false; catalogSnapshotCaptured=true;
      await nap(600); catalogSnapshotReleased=true;
    }
    return result;
  };
  await js("(() => {const e=document.querySelector('#composer');e.value='原会话的延迟消息';e.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#send').click();})()");
  await waitFor(async()=>catalogSnapshotCaptured);
  const originalSessionDraft='原会话未发送草稿\n'.repeat(6);
  await js(`(()=>{const e=document.querySelector('#composer');e.value=${JSON.stringify(originalSessionDraft)};e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await waitFor(()=>js("document.querySelector('#composer').getBoundingClientRect().height>36"));
  const originalDraftHeight=await js("document.querySelector('#composer').getBoundingClientRect().height");
  await click('#open-catalog');
  await waitFor(()=>count('#new-session-title').then(n=>n===1));
  await js("(() => {const e=document.querySelector('#new-session-title');e.value='中文验收会话';e.dispatchEvent(new Event('input',{bubbles:true}));})()");
  await click('#create-session');
  note(await waitFor(()=>js("!document.querySelector('.catalog-dialog[open]')")), "新建会话保存并自动打开");
  const newEntry=(await bridge.request('session/catalog')).entries.find(item=>item.current);
  note(newEntry.title==='中文验收会话' && newEntry.id!=='current', "会话名称来自核心持久日志");
  note(await text('#current-session-title')==='中文验收会话', "主标题随实际会话切换");
  await waitFor(async()=>catalogSnapshotReleased); await nap(50);
  bridge.request=catalogRequestBefore;
  note(await count('.msg-text')===0, "旧会话延迟投影不会覆盖新会话界面");
  note(await count('.msg-text')===0, "新会话不继承原会话消息");
  note((await text('#turn-usage')).includes('0/200') && nativeTheme.themeSource===oldTheme, "新会话预算独立初始化，全局主题保持");
  note((await bridge.request('workspace/get')).configured===false, "新会话不继承旧会话项目目录");
  note(await js("document.querySelector('#composer').value === '' && document.activeElement.id==='composer'"), "新会话输入为空且焦点进入输入区");
  note(await waitFor(()=>js("Math.abs(document.querySelector('#composer').getBoundingClientRect().height-52)<1")), "新会话清空草稿并收缩到官方空会话高度");
  await js("(() => {const e=document.querySelector('#composer');e.value='只属于中文验收会话';e.dispatchEvent(new Event('input',{bubbles:true}));})()");
  await click('#send');
  note(await waitFor(async()=> (await text('#messages')).includes('只属于中文验收会话')), "新会话消息从核心重新投影");
  await js("document.querySelector('#open-catalog').click()");
  await waitFor(()=>js("!!document.querySelector('.catalog-dialog[open] [data-select-session=\"current\"]')"));
  await click('[data-select-session="current"]');
  note(await waitFor(()=>js("!document.querySelector('.catalog-dialog[open]')")), "列表可切回默认会话");
  note(await js(`document.querySelector('#composer').value===${JSON.stringify(originalSessionDraft)}`), "切回后恢复原会话草稿");
  note(await waitFor(()=>js(`Math.abs(document.querySelector('#composer').getBoundingClientRect().height-${originalDraftHeight})<1`)), "切回后重新适配长草稿高度");
  note(!(await text('#messages')).includes('只属于中文验收会话'), "新会话消息不会混入原会话");
  note((await text('#turn-usage')).includes('12/5') && nativeTheme.themeSource===oldTheme && (await bridge.request('appearance/get')).theme==='light', "原会话预算恢复，旧主题记录保留且不覆盖全局主题");
  note((await bridge.request('workspace/get')).directory.includes('工作区 UI 项目'), "切回后恢复原会话项目目录");

  await bridge.stop();
  // 退出结算后才落盘：这两条同时证明 durability 屏障与「拒绝也被记账」
  const log2 = require("node:fs").readFileSync(SESSION_LOG, "utf8");
  note(/tool\/call\twrite /.test(log2) && /tool\/result\tok:/.test(log2), "放行的工具调用与结果已由核心写进会话日志");
  note(/tool\/result\tdenied:write:approval-denied/.test(log2), "被拒的调用也按拒绝记账，不是静默成功");
  // 审批留下的可追问痕迹：谁批的、批成什么，只能从日志里的 asked/decided 回答
  note(/approval\/asked\t\d+:write/.test(log2) && /approval\/decided\t\d+:denied/.test(log2), "审批的 asked/decided 已进同一份会话日志");

  // 便携启动器不保证继承 stdout；显式 --session-dir 保留完整断言报告供验收。
  writeFileSync(join(SESSION_DIR, 'ui-smoke-report.json'), JSON.stringify({
    passed: bad === 0, failed: bad, checks, packaged: app.isPackaged, version: app.getVersion(),
  }, null, 2));
  console.log(bad === 0 ? "UI_SMOKE PASS" : `UI_SMOKE FAIL（${bad} 项不符）`);
  app.exit(bad === 0 ? 0 : 1);
}

module.exports = uiSmoke;
