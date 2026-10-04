// 官方整页几何的真实 Electron 验收；独立空日志启动，不把旧工作台当成通过条件。
const {mkdirSync,writeFileSync}=require('node:fs');
const {join}=require('node:path');
module.exports=async function({win,nativeTheme,outDir,bridge}) {
  mkdirSync(outDir,{recursive:true});
  // 初始隐藏窗口不会持续产生活跃动画帧；整页验收显示窗口但不抢焦点。
  win.showInactive();
  const js=code=>win.webContents.executeJavaScript(code,true);
  async function waitFor(probe) {
    for(let i=0;i<120;i++) {if(await js(probe)) return;await new Promise(r=>setTimeout(r,50));}
    throw new Error('整页状态未就绪：'+probe);
  }
  await waitFor("!!document.querySelector('#composer') && document.querySelector('.app').dataset.catalogReady==='true'");
  const reports=[];
  async function check(name,source) {
    const checks=await js(source),failed=Object.keys(checks).filter(k=>!checks[k]);
    reports.push({name,checks,failed});console.log('FRAME '+(failed.length?'FAIL':'PASS')+' '+name+' '+failed.join(','));
  }
  const typography=await js("Object.fromEntries(['body','.hero-heading','.nav-label','#composer'].map(s=>[s,getComputedStyle(document.querySelector(s)).fontFamily]))");
  console.log('FRAME 字体',JSON.stringify(typography));
  // 计算样式只能证明声明，实际字形可能仍回退；记录 Chromium 真正使用的字体。
  win.webContents.debugger.attach('1.3');
  let platformFonts;
  try {
    await win.webContents.debugger.sendCommand('DOM.enable');
    await win.webContents.debugger.sendCommand('CSS.enable');
    const document=await win.webContents.debugger.sendCommand('DOM.getDocument');
    platformFonts={};
    for(const selector of ['.hero-heading','.new-session .nav-label','.brand']) {
      const node=await win.webContents.debugger.sendCommand('DOM.querySelector',{nodeId:document.root.nodeId,selector});
      platformFonts[selector]=(await win.webContents.debugger.sendCommand('CSS.getPlatformFontsForNode',{nodeId:node.nodeId})).fonts;
    }
  } finally {win.webContents.debugger.detach();}
  writeFileSync(join(outDir,'platform-fonts.json'),JSON.stringify(platformFonts,null,2));
  console.log('FRAME 实际字体',JSON.stringify(platformFonts));
  const chineseGlyphs=['.hero-heading','.new-session .nav-label'].every(selector=>platformFonts[selector].some(font=>font.familyName==='Microsoft YaHei' && font.glyphCount>0));
  if(process.platform==='win32') {
    reports.push({name:'Windows 实际中文字形',checks:{yahei:chineseGlyphs},failed:chineseGlyphs?[]:['yahei']});
    console.log('FRAME '+(chineseGlyphs?'PASS':'FAIL')+' Windows 实际中文字形');
  }
  await check('中文界面字体',"['body','.hero-heading','.nav-label','#composer'].every(s=>getComputedStyle(document.querySelector(s)).fontFamily.includes('Microsoft YaHei')) ? {sansSerif:true} : {sansSerif:false}");
  await check('空会话',`(()=>({empty:document.querySelector('.app').dataset.emptyConversation==='true',noSyntheticMessages:document.querySelectorAll('[data-msg-id]').length===0,noPlaceholderSession:document.querySelectorAll('[data-sidebar-session]').length===0,hero:!!document.querySelector('.hero-heading'),rightClosed:document.querySelector('.side').hidden,diagnosticsHidden:!document.querySelector('#developer-diagnostics').open,brand:document.querySelector('.brand').textContent==='SaCode'}))()`);
  await check('无账号本地启动',"(()=>({localComposer:!!document.querySelector('#composer'),noAccountActions:![...document.querySelectorAll('button,a')].some(e=>/登录|注册|账号绑定|充值|订阅/.test(e.textContent)),noCredentialGate:!document.querySelector('input[type=password],#sign-in,#api-key')}))()");
  // 连续增长/清空覆盖真实输入事件和自动高度测量，防止偶发留住旧草稿高度。
  for(let i=0;i<12;i++) {
    await js("(async()=>{const n=document.querySelector('#composer');n.value='输入高度检查\\n'.repeat(30);n.dispatchEvent(new Event('input',{bubbles:true}));await Vue.nextTick();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));n.value='';n.dispatchEvent(new Event('input',{bubbles:true}));})()");
    await waitFor("Math.abs(document.querySelector('#composer').getBoundingClientRect().height-52)<1");
  }
  await check('草稿重复收缩',"(()=>({emptyDraft:document.querySelector('#composer').value==='',heroFloor:Math.abs(document.querySelector('#composer').getBoundingClientRect().height-52)<1}))()");
  for(const theme of ['light','dark']) {
    nativeTheme.themeSource=theme;
    for(const width of [860,1023,1024,1100,1600]) {
      win.setContentSize(width,800);
      // Windows 的分数 DPR 会量化奇数尺寸，以实际内容宽度判断断点。
      await waitFor(`Math.abs(innerWidth-${width})<=1`);
      const actualWidth=await js('innerWidth');
      await js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
      await check(theme+'-'+width,`(()=>{
        const rect=s=>document.querySelector(s).getBoundingClientRect(),equal=(a,b)=>Math.abs(a-b)<1;
        const nav=rect('.navigation'),center=rect('.conversation-center'),card=rect('.composer-card'),hero=rect('.hero-heading');
        return {sidebar:equal(nav.width,${actualWidth<1024?(process.platform==='win32'?0:56):280}),caption:equal(center.top,40),centerAfterSidebar:equal(nav.right,center.left),rightClosed:document.querySelector('.side').hidden,heroAxis:equal((hero.left+hero.right)/2,(card.left+card.right)/2),composerWithinCenter:card.left>=center.left&&card.right<=center.right,settingsAtBottom:${actualWidth<1024&&process.platform==='win32'?"document.querySelector('#open-settings').getClientRects().length===0":"rect('#open-settings').bottom>=innerHeight-12"},noOverflow:document.documentElement.scrollWidth<=innerWidth&&document.documentElement.scrollHeight<=innerHeight};
      })()`);
      writeFileSync(join(outDir,`empty-${theme}-${width}.png`),(await win.webContents.capturePage()).toPNG());
    }
  }
  win.setContentSize(1100,800);await waitFor('innerWidth===1100');
  if(process.platform==='win32') await check('Windows 展开导航节奏',"(()=>{const box=s=>document.querySelector(s).getBoundingClientRect(),css=s=>getComputedStyle(document.querySelector(s)),brand=box('.sidebar-brand-row'),create=box('.new-session'),panel=box('.nav-panel'),heading=box('.workspace-heading');return {rootInset:css('.navigation').paddingTop==='6px' && css('.navigation').gap==='0px',brandRow:Math.abs(brand.height-40)<1 && Math.abs(brand.top-46)<1,newSession:Math.abs(create.height-38)<1 && css('.new-session').padding==='8px 12px',brandToCreate:Math.abs(create.top-brand.bottom-8)<1,createToPanel:Math.abs(panel.top-create.bottom-12)<1,panelRow:Math.abs(panel.height-36)<1 && css('.nav-panel').padding==='7px 8px',workspaceHeader:Math.abs(heading.height-36)<1 && Math.abs(heading.top-panel.bottom-10)<1,headerToRows:Math.abs(box('.sidebar-session-list').top-heading.bottom-4)<1,brandSpacing:css('.brand').gap==='8px',newSessionIcons:css('.new-session').gap==='6px'}})()");
  await js("document.querySelector('#open-settings').click()");
  await waitFor("!!document.querySelector('.settings-dialog[open]')");
  await check('设置面板留白',"(()=>{const r=document.querySelector('.settings-dialog').getBoundingClientRect();return {width:Math.abs(r.width-800)<1,height:Math.abs(r.height-720)<1,captionClearance:r.top>=40,bottomClearance:innerHeight-r.bottom>=40}})()");
  await js("document.querySelector('.settings-close').click()");
  await js("document.querySelector('#toggle-sidebar').click()");
  await waitFor("document.querySelector('.app').dataset.sidebarCollapsed==='true'");
  await check('手动折叠',`(()=>{const toggle=document.querySelector('#toggle-sidebar').getBoundingClientRect(),create=document.querySelector('#sidebar-new-session').getBoundingClientRect();return {track:Math.abs(document.querySelector('.navigation').getBoundingClientRect().width-${process.platform==='win32'?0:56})<1,captionToggle:${process.platform==='win32'?"Math.abs(toggle.left-12)<1 && Math.abs(toggle.top-6)<1 && Math.abs(toggle.width-28)<1":"true"},captionNewSession:${process.platform==='win32'?"Math.abs(create.left-48)<1 && Math.abs(create.top-6)<1 && Math.abs(create.width-28)<1":"true"}}})()`);
  await js("document.querySelector('#toggle-sidebar').click()");
  await waitFor("document.querySelector('.app').dataset.sidebarCollapsed==='false'");
  await js("document.querySelector('#toggle-side').click()");
  await waitFor("!document.querySelector('.side').hidden");
  await check('可选右栏',`(()=>{const rect=s=>document.querySelector(s).getBoundingClientRect(),center=rect('.conversation-center'),side=rect('.side');return {minimumCenter:Math.abs(center.width-400)<1,rightShrinks:Math.abs(side.width-420)<1,adjacent:Math.abs(center.right-side.left)<1,handle:!!document.querySelector('#rightbar-divider')}})()`);
  await js("document.querySelector('#sidebar-divider').dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true}))");
  await waitFor("Math.abs(document.querySelector('.navigation').getBoundingClientRect().width-420)<1");
  await check('左栏展开挤退右栏',"(()=>({sideHidden:document.querySelector('.side').hidden,centerProtected:document.querySelector('.conversation-center').getBoundingClientRect().width>=400}))()");
  await js("document.querySelector('#sidebar-divider').dispatchEvent(new KeyboardEvent('keydown',{key:'Home',bubbles:true}))");
  await waitFor("!document.querySelector('.side').hidden");
  await js("document.querySelector('#close-side').click()");
  await waitFor("document.querySelector('.side').hidden");
  await check('关闭右栏回焦',"(()=>({focusReturned:document.activeElement.id==='toggle-side',rightClosed:document.querySelector('.side').hidden}))()");
  await js("(async()=>{const n=document.querySelector('#composer');n.value='整页验收的真实用户消息';n.dispatchEvent(new Event('input',{bubbles:true}));await Vue.nextTick();document.querySelector('#send').click();})()");
  await waitFor("document.querySelector('.app').dataset.emptyConversation==='false' && [...document.querySelectorAll('[data-msg-id]')].some(n=>n.textContent==='整页验收的真实用户消息')");
  await check('真实消息进入会话布局',"(()=>({heroGone:!document.querySelector('.hero-heading'),header:!document.querySelector('#current-session-title').hidden,docked:document.querySelector('.composer').getBoundingClientRect().bottom>=innerHeight-1,diagnosticsAbsentFromConversation:!document.querySelector('.conversation #run-turn')}))()");
  for(let i=0;i<12;i++) {
    await js("(async()=>{const n=document.querySelector('#composer');n.value='会话草稿高度检查\\n'.repeat(30);n.dispatchEvent(new Event('input',{bubbles:true}));await Vue.nextTick();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));n.value='';n.dispatchEvent(new Event('input',{bubbles:true}));})()");
    await waitFor("Math.abs(document.querySelector('#composer').getBoundingClientRect().height-36)<1");
  }
  await check('会话草稿重复收缩',"(()=>({dockedFloor:Math.abs(document.querySelector('#composer').getBoundingClientRect().height-36)<1}))()");
  writeFileSync(join(outDir,'active-conversation.png'),(await win.webContents.capturePage()).toPNG());
  // 项目行来自真实核心记录；不在渲染层伪造一条工作区事实。
  const fixtureWorkspace=join(outDir,'SaCode 工作区排版检查');
  mkdirSync(fixtureWorkspace,{recursive:true});
  await bridge.request('workspace/set-directory',{directory:fixtureWorkspace});
  await js("document.querySelector('#open-workspace').click()");
  await waitFor("!!document.querySelector('.workspace-folder') && !!document.querySelector('.workspace-dialog[open]')");
  await js("document.querySelector('.workspace-dialog .dialog-header button').click()");
  await check('工作区与会话行',"(()=>{const row=document.querySelector('.workspace-folder'),sessions=[...document.querySelectorAll('.sidebar-session')],box=e=>e.getBoundingClientRect();return {projectHeight:Math.abs(box(row).height-34)<1,sessionHeight:sessions.length>0 && sessions.every(e=>Math.abs(box(e).height-32)<1),leadingIcons:[row,...sessions].every(e=>Math.abs(box(e.querySelector('svg')).width-16)<1 && Math.abs(box(e.querySelector('svg')).height-16)<1),sessionTitleGap:sessions.every(e=>Math.abs(box(e.querySelector('span')).left-box(e.querySelector('svg')).right-4)<1),projectTitleGap:Math.abs(box(row.querySelector('span')).left-box(row.querySelector('svg')).right-6)<1}})()");
  writeFileSync(join(outDir,'workspace-session-rows.png'),(await win.webContents.capturePage()).toPNG());
  await waitFor("!!document.querySelector('[data-sidebar-session][aria-current=page]') && !document.querySelector('#sidebar-new-session').disabled");
  const priorSession=await js("document.querySelector('[data-sidebar-session][aria-current=page]').dataset.sidebarSession");
  await js("document.querySelector('#sidebar-new-session').click()");
  await waitFor(`document.querySelector('.app').dataset.emptyConversation==='true' && !document.querySelector('#sidebar-new-session').disabled && document.querySelector('[data-sidebar-session][aria-current=page]').dataset.sidebarSession!==${JSON.stringify(priorSession)}`);
  await check('新会话与切换',"(()=>({emptyRestored:!!document.querySelector('.hero-heading'),catalogUpdated:document.querySelectorAll('[data-sidebar-session]').length>=2,selectedOne:document.querySelectorAll('[data-sidebar-session][aria-current=page]').length===1}))()");
  for(let i=0;i<6;i++) await bridge.request('session/create',{title:`未绑定工作区 ${i+1}`});
  await js("document.querySelector('#open-catalog').click()");
  await waitFor("!!document.querySelector('.workspace-overflow') && !document.querySelector('#refresh-catalog').disabled");
  await js("document.querySelector('.catalog-dialog .dialog-header button').click()");
  await check('真实工作区归属分组',`(()=>{const groups=[...document.querySelectorAll('[data-workspace-group]')],bound=groups.find(e=>e.dataset.workspaceGroup===${JSON.stringify(fixtureWorkspace)}),unbound=groups.find(e=>e.dataset.workspaceGroup==='');return {boundSession:!!bound && [...bound.querySelectorAll('[data-sidebar-session]')].some(e=>e.dataset.sidebarSession===${JSON.stringify(priorSession)}),unboundSeparate:!!unbound && ![...unbound.querySelectorAll('[data-sidebar-session]')].some(e=>e.dataset.sidebarSession===${JSON.stringify(priorSession)}),idleQuota:!!unbound && unbound.querySelectorAll('[data-sidebar-session]').length===5,overflowHeight:!!unbound && Math.abs(unbound.querySelector('.workspace-overflow').getBoundingClientRect().height-28)<1}})()`);
  await js("document.querySelector('.workspace-overflow').click()");
  await check('分组会话展开与收起',"(()=>({expanded:document.querySelector('.workspace-overflow').getAttribute('aria-expanded')==='true',allUnbound:document.querySelector('[data-workspace-group=\"\"]').querySelectorAll('[data-sidebar-session]').length===7}))()");
  await js("document.querySelector('.workspace-overflow').click()");
  await check('分组会话恢复五条',"(()=>({collapsed:document.querySelector('.workspace-overflow').getAttribute('aria-expanded')==='false',five:document.querySelector('[data-workspace-group=\"\"]').querySelectorAll('[data-sidebar-session]').length===5}))()");
  writeFileSync(join(outDir,'workspace-groups.png'),(await win.webContents.capturePage()).toPNG());
  await checkConversationScroll({js,waitFor,check});
  await require('./test-support/models-page-smoke.cjs')({win,waitFor,check,outDir});
  await require('./test-support/plugins-page-smoke.cjs')({win,waitFor,check,outDir});
  await require('./test-support/plugin-configuration-smoke.cjs')({win,waitFor,check,outDir});
  await require('./test-support/subagent-settings-smoke.cjs')({win,waitFor,check,outDir});
  await require('./test-support/plugin-manager-smoke.cjs')({win,waitFor,check,outDir});
  await require('./test-support/model-select-smoke.cjs')({win,waitFor,check,outDir});
  writeFileSync(join(outDir,'reports.json'),JSON.stringify(reports,null,2));
  return reports.every(r=>!r.failed.length);
};

// 原生 Chromium 的滚动与 ResizeObserver 验收；fixture 只测试 UI 阅读控制器，不冒充核心消息。
async function checkConversationScroll({js,waitFor,check}) {
  await js(`(()=>{
    const host=document.createElement('div');host.id='scroll-fixture';
    Object.assign(host.style,{position:'fixed',left:'10px',top:'50px',width:'240px',height:'240px',overflow:'auto',overflowAnchor:'none',zIndex:99});
    const content=document.createElement('div');host.append(content);
    for(let i=0;i<20;i++){const row=document.createElement('p');row.dataset.msgId='fixture-'+i;row.textContent='滚动阅读位置 '+i;row.style.height='60px';content.append(row);}
    document.body.append(host);
    window.scrollFixture={host,content,owner:SaCodeConversationScroll.attach(host,{session:'fixture-a',lastUser:'u1'})};
  })()`);
  await waitFor("scrollFixture.host.scrollTop>500 && scrollFixture.host.dataset.followingTail==='true'");
  await check('滚动首次打开跟随尾部',"(()=>{const n=scrollFixture.host;return {atFloor:Math.abs(n.scrollHeight-n.clientHeight-n.scrollTop)<1}})()");
  await js("scrollFixture.host.scrollTop=200");
  await waitFor("scrollFixture.host.dataset.followingTail==='false'");
  await js("scrollFixture.savedTop=scrollFixture.host.scrollTop;scrollFixture.content.lastElementChild.style.height='500px'");
  await new Promise(r=>setTimeout(r,120));
  await check('上翻后增长不抢阅读位置',"({preserved:Math.abs(scrollFixture.host.scrollTop-scrollFixture.savedTop)<1})");
  await js("scrollFixture.anchor=scrollFixture.content.children[3];scrollFixture.offset=scrollFixture.anchor.getBoundingClientRect().top-scrollFixture.host.getBoundingClientRect().top;scrollFixture.content.firstElementChild.style.height='160px'");
  await waitFor("Math.abs(scrollFixture.anchor.getBoundingClientRect().top-scrollFixture.host.getBoundingClientRect().top-scrollFixture.offset)<1");
  await check('布局变化补偿消息锚点',"({anchorRetained:Math.abs(scrollFixture.anchor.getBoundingClientRect().top-scrollFixture.host.getBoundingClientRect().top-scrollFixture.offset)<1})");
  await js("scrollFixture.restoreTop=scrollFixture.host.scrollTop;scrollFixture.owner.update({session:'fixture-b',lastUser:'u2'})");
  await waitFor("scrollFixture.host.dataset.followingTail==='true'");
  await js("scrollFixture.owner.update({session:'fixture-a',lastUser:'u1'})");
  await waitFor("scrollFixture.host.dataset.followingTail==='false' && Math.abs(scrollFixture.host.scrollTop-scrollFixture.restoreTop)<1");
  await check('会话切换恢复阅读位置',"({restored:Math.abs(scrollFixture.host.scrollTop-scrollFixture.restoreTop)<1})");
  await js("scrollFixture.owner.update({session:'fixture-a',lastUser:'u3'})");
  await waitFor("scrollFixture.host.dataset.followingTail==='true'");
  await check('发送新输入恢复尾部',"({atFloor:Math.abs(scrollFixture.host.scrollHeight-scrollFixture.host.clientHeight-scrollFixture.host.scrollTop)<1})");
  await js("scrollFixture.content.lastElementChild.style.height='650px'");
  // ResizeObserver 与动画帧异步结算；等待可观察终态，超时仍判失败。
  await waitFor("scrollFixture.host.dataset.followingTail==='true' && Math.abs(scrollFixture.host.scrollHeight-scrollFixture.host.clientHeight-scrollFixture.host.scrollTop)<1");
  await check('尾部跟随流式增高',"({atFloor:Math.abs(scrollFixture.host.scrollHeight-scrollFixture.host.clientHeight-scrollFixture.host.scrollTop)<1})");
  await js("scrollFixture.host.scrollTop=100");
  await waitFor("scrollFixture.host.dataset.followingTail==='false'");
  await js("SaCodeConversationScroll.toBottom(scrollFixture.host)");
  await check('显式返回最新',"({following:scrollFixture.host.dataset.followingTail==='true',atFloor:Math.abs(scrollFixture.host.scrollHeight-scrollFixture.host.clientHeight-scrollFixture.host.scrollTop)<1})");
  await js("scrollFixture.owner.dispose();scrollFixture.host.remove();delete window.scrollFixture");
  // 再穿过真实 userSend/核心投影，验证产品宿主和浮动按钮的接线。
  for(let i=0;i<5;i++) {
    await js(`(()=>{const input=document.querySelector('#composer');input.value=${JSON.stringify(Array.from({length:32},(_,j)=>`会话滚动验收 ${i+1} · 第 ${j+1} 行`).join('\n'))};input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await waitFor("!document.querySelector('#send').disabled");
    const count=await js("document.querySelectorAll('[data-msg-id]').length");
    await js("document.querySelector('#send').click()");
    try {await waitFor(`document.querySelectorAll('[data-msg-id]').length>${count} && document.querySelector('#send').getAttribute('aria-busy')!=='true'`);}
    catch(e) {console.log('SCROLL_SEND_STATE',await js("({error:document.querySelector('#error')?.textContent,draft:document.querySelector('#composer').value.length,disabled:document.querySelector('#send').disabled,messages:document.querySelectorAll('[data-msg-id]').length})"));throw e;}
  }
  await js("document.querySelectorAll('.btn-fold').forEach(b=>b.click())");
  await waitFor("(()=>{const n=document.querySelector('.conversation-scroll');return n.scrollHeight-n.clientHeight>200 && Math.abs(n.scrollHeight-n.clientHeight-n.scrollTop)<1})()");
  await js("document.querySelector('.conversation-scroll').scrollTop=100");
  await waitFor("!!document.querySelector('#scroll-to-bottom')");
  await check('真实会话回到最新按钮',"(()=>{const b=document.querySelector('#scroll-to-bottom').getBoundingClientRect(),n=document.querySelector('.conversation-scroll').getBoundingClientRect();return {width:Math.abs(b.width-34)<1,height:Math.abs(b.height-34)<1,insideViewport:b.left>=n.left&&b.right<=n.right&&b.bottom<=n.bottom,reading:document.querySelector('.conversation-scroll').dataset.followingTail==='false'}})()");
  await check('正文输入区共用滚动宿主',"(()=>{const scroller=document.querySelector('.conversation-scroll'),seat=document.querySelector('.composer-seat'),card=document.querySelector('.composer-card').getBoundingClientRect(),viewport=scroller.getBoundingClientRect(),latest=document.querySelector('#scroll-to-bottom').getBoundingClientRect();return {shared:seat.parentElement===scroller,sticky:getComputedStyle(seat).position==='sticky',inputVisible:card.top>=viewport.top&&card.bottom<=viewport.bottom,buttonClearsComposer:latest.bottom<=seat.getBoundingClientRect().top-15}})()");
  await js("(()=>{const n=document.querySelector('#composer');n.value='输入区增长与阅读锚点\\n'.repeat(24);n.dispatchEvent(new Event('input',{bubbles:true}));})()");
  await waitFor("document.querySelector('#composer').getBoundingClientRect().height>200");
  await check('长草稿更新浮动控件位置',"(()=>{const seat=document.querySelector('.composer-seat'),button=document.querySelector('#scroll-to-bottom').getBoundingClientRect(),scroller=document.querySelector('.conversation-scroll').getBoundingClientRect();return {composerVisible:seat.getBoundingClientRect().bottom<=scroller.bottom+1,buttonClearsComposer:button.bottom<=seat.getBoundingClientRect().top-15,readingPreserved:Math.abs(document.querySelector('.conversation-scroll').scrollTop-100)<1}})()");
  await js("(()=>{const n=document.querySelector('#composer');n.value='';n.dispatchEvent(new Event('input',{bubbles:true}));})()");
  await waitFor("document.querySelector('#composer').getBoundingClientRect().height<100");
  const current=await js("(async()=>{const c=await window.dsh.sessionCatalog();return c.entries.find(e=>e.current).id})()");
  await js("document.querySelectorAll('.workspace-overflow[aria-expanded=false]').forEach(b=>b.click())");
  const other=await js(`[...document.querySelectorAll('[data-sidebar-session]')].find(n=>n.dataset.sidebarSession!==${JSON.stringify(current)}).dataset.sidebarSession`);
  await js(`document.querySelector('[data-sidebar-session="'+${JSON.stringify(other)}+'"]').click()`);
  await waitFor(`document.querySelector('[data-sidebar-session][aria-current=page]')?.dataset.sidebarSession===${JSON.stringify(other)} && !document.querySelector('#sidebar-new-session').disabled`);
  await js(`document.querySelector('[data-sidebar-session="'+${JSON.stringify(current)}+'"]').click()`);
  await waitFor(`document.querySelector('[data-sidebar-session][aria-current=page]')?.dataset.sidebarSession===${JSON.stringify(current)} && !document.querySelector('#sidebar-new-session').disabled && !!document.querySelector('#scroll-to-bottom')`);
  await check('真实会话切换保留阅读位置',"({restored:Math.abs(document.querySelector('.conversation-scroll').scrollTop-100)<1})");
  await js("document.querySelector('#scroll-to-bottom').click()");
  await waitFor("!document.querySelector('#scroll-to-bottom')");
  await check('真实会话返回尾部',"(()=>{const n=document.querySelector('.conversation-scroll');return {following:n.dataset.followingTail==='true',atFloor:Math.abs(n.scrollHeight-n.clientHeight-n.scrollTop)<1}})()");
};
