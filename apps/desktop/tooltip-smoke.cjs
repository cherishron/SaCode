// 在真实 Electron 窗口验收提示浮层；夹具只测试 UI，不写会话事实。
const {writeFileSync}=require('node:fs');
const {join}=require('node:path');
module.exports=async function tooltipSmoke({win,js,waitFor,outDir,theme,width,height}) {
  const checks={},metrics={};
  // 时间等待不保证 Chromium 已绘制；先启动动画帧，再等真实动画结束并提交下一帧。
  const painted=async selector=>js(`(async()=>{await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));await Promise.all(document.querySelector(${JSON.stringify(selector)}).getAnimations().map(a=>a.finished.catch(()=>{})));await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));})()`);
  const tip=selector=>`(()=>{const n=document.querySelector(${JSON.stringify(selector)}),id=n?.getAttribute('aria-describedby')?.split(' ').at(-1);return id?document.getElementById(id):null;})()`;
  const move=async selector=>{
    const rect=await js(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()`);
    win.webContents.sendInputEvent({type:'mouseMove',x:Math.round(rect.x),y:Math.round(rect.y)});
  };
  const clear=async()=>{await move('#send');await js("document.querySelector('#composer').focus();document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");};
  await clear();
  await move('#markdown-layout-fixture .code-wrap');
  await waitFor(`!!${tip('#markdown-layout-fixture .code-wrap')} && ${tip('#markdown-layout-fixture .code-wrap')}.style.visibility==='visible'`);
  Object.assign(checks,await js(`(()=>{const node=document.querySelector('#markdown-layout-fixture .code-wrap'),t=${tip('#markdown-layout-fixture .code-wrap')},r=t.getBoundingClientRect(),a=node.getBoundingClientRect(),css=getComputedStyle(t);return {hoverLabel:t.textContent==='自动换行',bodyPortal:t.parentElement===document.body&&t.matches(':popover-open'),topGap:Math.abs(a.top-r.bottom-8)<1,tooltipType:css.fontSize==='13px'&&css.lineHeight==='20px',tooltipInsets:css.padding==='3px 7px',tooltipRadius:css.borderTopLeftRadius==='8px',tooltipPalette:css.backgroundColor==='${theme==='dark'?'rgb(67, 69, 74)':'rgb(44, 44, 46)'}'&&css.color==='rgb(255, 255, 255)',anchorRadius:getComputedStyle(node).borderTopLeftRadius==='8px',noNativeTitle:!node.hasAttribute('title'),noPageOverflow:document.documentElement.scrollWidth<=innerWidth};})()`));
  await new Promise(resolve=>setTimeout(resolve,180));
  await painted('.sacode-tooltip');
  writeFileSync(join(outDir,`sacode-tooltip-code-${theme}-${width}x${height}.png`),(await win.webContents.capturePage()).toPNG());
  await clear();
  await js("document.querySelector('#markdown-layout-fixture .code-wrap').focus()");
  win.webContents.sendInputEvent({type:'keyDown',keyCode:'Tab'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Tab'});
  await waitFor(`!!${tip('#markdown-layout-fixture .code-copy')}`);
  checks.keyboardFocus=await js(`document.activeElement===document.querySelector('#markdown-layout-fixture .code-copy') && !!${tip('#markdown-layout-fixture .code-copy')}`);
  await clear();
  checks.escapeDismissed=await js("!document.querySelector('.sacode-tooltip')");
  await js("document.querySelector('#open-settings').click()");
  await waitFor("!!document.querySelector('.settings-dialog[open]')");
  await js("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Shift',bubbles:true}));document.querySelector('#font-increase').focus()");
  await waitFor(`!!${tip('#font-increase')}`);
  Object.assign(checks,await js(`(()=>{const t=${tip('#font-increase')},r=t.getBoundingClientRect();t.style.pointerEvents='auto';const hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);t.style.pointerEvents='';return {aboveModal:hit===t||t.contains(hit),modalFocusPreserved:document.activeElement===document.querySelector('#font-increase'),modalPortal:t.parentElement===document.querySelector('.settings-dialog[open]')&&t.matches(':popover-open')};})()`));
  await new Promise(resolve=>setTimeout(resolve,180));
  await painted('.sacode-tooltip');
  Object.assign(checks,await js(`(()=>{const t=${tip('#font-increase')},css=getComputedStyle(t);return {modalPalette:css.backgroundColor==='${theme==='dark'?'rgb(67, 69, 74)':'rgb(44, 44, 46)'}'&&css.color==='rgb(255, 255, 255)',modalOpaque:Number(css.opacity)>=.99};})()`));
  metrics.modal=await js(`(()=>{const t=${tip('#font-increase')},css=getComputedStyle(t);return {background:css.backgroundColor,opacity:css.opacity,animations:t.getAnimations().map(a=>({time:a.currentTime,state:a.playState,duration:a.effect.getTiming().duration})),text:t.textContent};})()`);
  await js("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
  writeFileSync(join(outDir,`sacode-tooltip-modal-${theme}-${width}x${height}.png`),(await win.webContents.capturePage()).toPNG());
  await js("document.querySelector('.settings-dialog .dialog-header button').click()");
  await clear();await move('#open-settings');await waitFor(`!!${tip('#open-settings')}`);
  checks.shortcutCaps=await js(`(()=>{const t=${tip('#open-settings')},k=t.querySelector('.tooltip-keys');return t.textContent==='设置Ctrl+,' && Math.abs(k.getBoundingClientRect().height-16)<1&&getComputedStyle(k).gap==='2px';})()`);
  await clear();
  await js("(()=>{const root=document.createElement('div');root.id='tooltip-test-fixture';document.body.append(root);window.__tooltipOptions=Vue.reactive({label:'长中文提示与窗口边缘。'.repeat(5)+'a'.repeat(120),side:'bottom',delayMs:100,focusDelayMs:100,maxWidth:240,openOnClick:true,disabled:false});window.__tooltipApp=Vue.createApp({setup:()=>()=>SaCodeTooltip.wrap(Vue.h('button',{id:'tooltip-test-anchor',type:'button',disabled:__tooltipOptions.disabled,style:{position:'fixed',right:'4px',bottom:'4px',width:'24px',height:'24px',padding:0}},'?'),{...__tooltipOptions})});__tooltipApp.mount(root);})()");
  try {
    await move('#tooltip-test-anchor');checks.hoverDelayed=await js(`!${tip('#tooltip-test-anchor')}`);await move('#send');
    await new Promise(resolve=>setTimeout(resolve,150));checks.hoverDelayCancelled=await js(`!${tip('#tooltip-test-anchor')}`);
    await js("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Shift',bubbles:true}));document.querySelector('#tooltip-test-anchor').focus()");
    checks.focusDelayed=await js(`!${tip('#tooltip-test-anchor')}`);await js("document.querySelector('#composer').focus()");
    await new Promise(resolve=>setTimeout(resolve,150));checks.focusDelayCancelled=await js(`!${tip('#tooltip-test-anchor')}`);
    await js("__tooltipOptions.delayMs=0;__tooltipOptions.focusDelayMs=0;Vue.nextTick()");
    await js("document.querySelector('#tooltip-test-anchor').click()");await waitFor(`!!${tip('#tooltip-test-anchor')}`);
    Object.assign(checks,await js(`(()=>{const t=${tip('#tooltip-test-anchor')},r=t.getBoundingClientRect(),a=document.querySelector('#tooltip-test-anchor').getBoundingClientRect();return {flippedAtBottom:t.dataset.side==='top'&&Math.abs(a.top-r.bottom-8)<1,viewportSafe:r.left>=12&&r.right<=innerWidth-12+1&&r.top>=12&&r.bottom<=innerHeight-12+1,widthCapped:r.width<=240+1,pinned:t.dataset.pinned==='true'&&getComputedStyle(t).pointerEvents==='auto'};})()`));
    await new Promise(resolve=>setTimeout(resolve,180));
    await js("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
    writeFileSync(join(outDir,`sacode-tooltip-edge-${theme}-${width}x${height}.png`),(await win.webContents.capturePage()).toPNG());
    win.setContentSize(width+40,height+20);
    await waitFor(`innerWidth===${width+40} && (()=>{const t=${tip('#tooltip-test-anchor')};return t&&Math.abs(t.getBoundingClientRect().right-(innerWidth-12))<1&&Math.abs(document.querySelector('#tooltip-test-anchor').getBoundingClientRect().top-t.getBoundingClientRect().bottom-8)<1;})()`);
    checks.liveResize=await js(`!!${tip('#tooltip-test-anchor')}`);
    win.setContentSize(width,height);await waitFor(`innerWidth===${width} && (()=>{const t=${tip('#tooltip-test-anchor')};return t&&Math.abs(t.getBoundingClientRect().right-(innerWidth-12))<1;})()`);
    win.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});
    await waitFor(`!${tip('#tooltip-test-anchor')}`);
    checks.pinnedEscape=await js(`!${tip('#tooltip-test-anchor')}`);
    await js("document.querySelector('#tooltip-test-anchor').click()");await waitFor(`!!${tip('#tooltip-test-anchor')}`);
    await js("document.querySelector('#composer').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}))");
    checks.outsideDismissed=await js(`!${tip('#tooltip-test-anchor')}`);
    await js("document.querySelector('#tooltip-test-anchor').click()");await waitFor(`!!${tip('#tooltip-test-anchor')}`);
    await js("__tooltipOptions.disabled=true;Vue.nextTick()");checks.disabledWithdraws=await js(`!${tip('#tooltip-test-anchor')}`);
    await js("__tooltipOptions.disabled=false;Vue.nextTick()");await js("document.querySelector('#tooltip-test-anchor').click()");await waitFor(`!!${tip('#tooltip-test-anchor')}`);
    await js("__tooltipApp.unmount();document.querySelector('#tooltip-test-fixture').remove()");checks.unmountCleanup=await js("!document.querySelector('.sacode-tooltip')");
  } finally {await js("if(document.querySelector('#tooltip-test-fixture')){__tooltipApp.unmount();document.querySelector('#tooltip-test-fixture').remove()}delete window.__tooltipApp;delete window.__tooltipOptions;");}
  await clear();
  await js("(()=>{const root=document.createElement('div');root.id='tooltip-nested-fixture';document.body.append(root);window.__tooltipNested=Vue.createApp({setup:()=>()=>SaCodeTooltip.wrap(Vue.h('div',{id:'tooltip-outer',tabindex:0,style:{position:'fixed',left:'4px',top:'100px',width:'100px',height:'56px',padding:'16px',boxSizing:'border-box'}},[SaCodeTooltip.wrap(Vue.h('button',{id:'tooltip-inner',type:'button',style:{width:'24px',height:'24px',padding:0}},'?'),{label:'内层提示'})]),{label:'外层提示'})});__tooltipNested.mount(root);})()");
  try {
    await move('#tooltip-outer');await waitFor(`!!${tip('#tooltip-outer')}`);
    await move('#tooltip-inner');await waitFor(`!!${tip('#tooltip-inner')}`);
    checks.nestedSuppression=await js(`!${tip('#tooltip-outer')} && document.querySelectorAll('.sacode-tooltip').length===1`);
    await move('#tooltip-outer');await waitFor(`!!${tip('#tooltip-outer')}`);
    checks.nestedRestoration=await js(`!${tip('#tooltip-inner')} && document.querySelectorAll('.sacode-tooltip').length===1`);
  } finally {await js("__tooltipNested.unmount();document.querySelector('#tooltip-nested-fixture').remove();delete window.__tooltipNested;");}
  checks.nestedCleanup=await js("!document.querySelector('.sacode-tooltip')");
  await clear();
  return {checks,metrics,failed:Object.keys(checks).filter(key=>!checks[key]),theme,width,height,surface:'tooltip'};
};
