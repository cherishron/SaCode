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
  await check('中文界面字体',"['body','.hero-heading','.nav-label','#composer'].every(s=>getComputedStyle(document.querySelector(s)).fontFamily.includes('Microsoft YaHei')) ? {sansSerif:true} : {sansSerif:false}");
  await check('空会话',`(()=>({empty:document.querySelector('.app').dataset.emptyConversation==='true',noSyntheticMessages:document.querySelectorAll('[data-msg-id]').length===0,noPlaceholderSession:document.querySelectorAll('[data-sidebar-session]').length===0,hero:!!document.querySelector('.hero-heading'),rightClosed:document.querySelector('.side').hidden,diagnosticsHidden:!document.querySelector('#developer-diagnostics').open,brand:document.querySelector('.brand').textContent==='SaCode'}))()`);
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
        return {sidebar:equal(nav.width,${actualWidth<1024?56:280}),caption:equal(center.top,40),centerAfterSidebar:equal(nav.right,center.left),rightClosed:document.querySelector('.side').hidden,heroAxis:equal((hero.left+hero.right)/2,(card.left+card.right)/2),composerWithinCenter:card.left>=center.left&&card.right<=center.right,settingsAtBottom:rect('#open-settings').bottom>=innerHeight-12,noOverflow:document.documentElement.scrollWidth<=innerWidth&&document.documentElement.scrollHeight<=innerHeight};
      })()`);
      writeFileSync(join(outDir,`empty-${theme}-${width}.png`),(await win.webContents.capturePage()).toPNG());
    }
  }
  win.setContentSize(1100,800);await waitFor('innerWidth===1100');
  await js("document.querySelector('#open-settings').click()");
  await waitFor("!!document.querySelector('.settings-dialog[open]')");
  await check('设置面板留白',"(()=>{const r=document.querySelector('.settings-dialog').getBoundingClientRect();return {width:Math.abs(r.width-800)<1,height:Math.abs(r.height-720)<1,captionClearance:r.top>=40,bottomClearance:innerHeight-r.bottom>=40}})()");
  await js("document.querySelector('.settings-close').click()");
  await js("document.querySelector('#toggle-sidebar').click()");
  await waitFor("document.querySelector('.app').dataset.sidebarCollapsed==='true'");
  await check('手动折叠',"(()=>({rail:Math.abs(document.querySelector('.navigation').getBoundingClientRect().width-56)<1}))()");
  await js("document.querySelector('.brand').click()");
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
  writeFileSync(join(outDir,'reports.json'),JSON.stringify(reports,null,2));
  return reports.every(r=>!r.failed.length);
};
