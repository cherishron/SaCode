// 真 Electron 窗口的几何验收与截图，不用源码字符串代替视觉证据。
const { mkdirSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
module.exports = async function layoutSmoke({ win, nativeTheme, outDir, expectedReadPath }) {
  mkdirSync(outDir, { recursive: true });
  const js = (source) => win.webContents.executeJavaScript(source, true);
  let toolsReady = false;
  for (let i = 0; i < 100; i++) {
    if (await js("!!document.querySelector('#tool-write')")) { toolsReady = true; break; }
    await new Promise((r) => setTimeout(r, 50));
  }
  if (!toolsReady) throw new Error("布局验收失败：工具列表未加载");
  // 业务组件验收显式打开可选侧栏与诊断；默认产品布局由 frame-smoke 独立检查。
  await js("document.querySelector('#toggle-side').click();document.querySelector('#developer-diagnostics').open=true");
  await js("document.querySelector('#tool-write').click()");
  let approvalReady = false;
  for (let i = 0; i < 100; i++) {
    if (await js("!!document.querySelector('#approval')")) { approvalReady = true; break; }
    await new Promise((r) => setTimeout(r, 50));
  }
  if (!approvalReady) throw new Error("布局验收失败：审批卡未加载");
  // 使用真实工具生成文件与读取事实，再保留另一张待审批工单覆盖侧栏状态。
  await js("document.querySelector('#allow-once').click()");
  const waitFor = async (probe) => {
    for (let i=0; i<100; i++) {
      if (await js(probe)) return;
      await new Promise(r=>setTimeout(r,50));
    }
    throw new Error('布局验收状态未就绪：'+probe);
  };
  await waitFor("document.querySelector('#outcome')?.textContent.startsWith('结果：')");
  await js("document.querySelector('#tool-read').click()");
  await waitFor("!!document.querySelector('#preview-text')");
  await js("document.querySelector('#tool-write').click()");
  await waitFor("!!document.querySelector('#approval')");
  // 通过真实核心创建多条会话，覆盖长中文标题与多卡片的栅格。
  await js("window.dsh.sessionCreate('布局检查：'+'长会话标题'.repeat(10))");
  await js("window.dsh.sessionCreate('布局检查：文档整理')");
  // 通过界面发送真实长中文消息，覆盖用户气泡宽度与展开折行。
  await js("(async()=>{const n=document.querySelector('#composer');n.value='长中文消息与输入对齐。'.repeat(35);n.dispatchEvent(new Event('input',{bubbles:true}));await Vue.nextTick();document.querySelector('#send').click();})()");
  await waitFor("[...document.querySelectorAll('.msg-text')].some(e=>e.textContent.startsWith('长中文消息与输入对齐。'))");
  const reports = [];
  for (const theme of ["light", "dark"]) {
    await js("document.querySelector('#open-settings').focus();document.querySelector('#open-settings').click()");
    await waitFor("!!document.querySelector('.settings-dialog[open]')");
    await js(`document.querySelector('#theme-${theme}').click()`);
    await waitFor(`document.querySelector('#theme-${theme}').getAttribute('aria-pressed')==='true' && !document.querySelector('#theme-${theme}').disabled`);
    if(nativeTheme.themeSource!==theme) throw new Error('全局主题未驱动窗口：'+theme);
    await js("document.querySelector('.settings-dialog .dialog-header button').click()");
    for (const [width, height] of [[860, 600], [880, 640], [1100, 720], [1440, 900]]) {
      win.setContentSize(width, height);
      // 非空草稿才有可用发送动作；不提交，只验输入与键盘焦点。
      await js("(()=>{const n=document.querySelector('#composer');n.value='布局验收草稿';n.dispatchEvent(new Event('input',{bubbles:true}));})()");
      // 等库的主题/启用态颜色过渡完成，再比较最终色值与截图。
      await new Promise((r) => setTimeout(r, 500));
      const sendBefore=await js("(()=>{const r=document.querySelector('#send').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};})()");
      win.webContents.focus();
      await waitFor("document.hasFocus()");
      win.webContents.sendInputEvent({type:'mouseMove',x:Math.round(sendBefore.x+sendBefore.width/2),y:Math.round(sendBefore.y+sendBefore.height/2)});
      await js("document.querySelector('#composer').focus()");
      const composerFocus=await js("getComputedStyle(document.querySelector('.composer-card')).outlineStyle==='solid' && getComputedStyle(document.querySelector('#composer')).outlineStyle==='none'");
      // 真实 Tab 进入按钮，验证键盘焦点而非鼠标模式下的脚本 focus。
      win.webContents.sendInputEvent({type:'keyDown',keyCode:'Tab'});
      win.webContents.sendInputEvent({type:'keyUp',keyCode:'Tab'});
      await waitFor("document.activeElement.id==='send' && document.querySelector('#send').matches(':hover')");
      // 主题过渡可能直到绘制帧才启动，固定毫秒等待不能证明 TinyVue 已到终态。
      await js("(async()=>{await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));await Promise.all(['#run-turn','#send'].flatMap(s=>document.querySelector(s).getAnimations()).map(a=>a.finished.catch(()=>{})));await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));})()");
      const report = await js(`(() => {
        const box = (s) => document.querySelector(s).getBoundingClientRect();
        const equal = (a, b) => Math.abs(a-b) < 1;
        const main = box('.conversation'), composer = box('.composer'), side = box('.side');
        const input = box('#budget-input'), apply = box('#apply-budget');
        const draft = box('#composer'), send = box('#send');
        const controls = ['#run-turn','#run-turn-2','#stop-turn','#apply-budget','#allow-once','#deny'];
        const checks = {
          brand: document.title.startsWith('SaCode') && document.querySelector('.brand').textContent === 'SaCode',
          logo: document.querySelector('.brand img').naturalWidth > 0,
          noPageOverflow: document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight,
          columns: equal(main.left,box('.conversation-center').left) && equal(main.right,box('.conversation-center').right) && composer.left>=main.left && composer.right<=main.right && equal(main.right,side.left),
          budgetRow: equal(input.top, apply.top) && equal(input.height, apply.height),
          composerStack: draft.bottom<send.top && send.right<box('.composer-card').right && send.bottom<box('.composer-card').bottom,
          composerFocusRing: ${composerFocus},
          controlHeights: controls.every(s => equal(box(s).height, 36)),
          stateGeometry: equal(send.width,${sendBefore.width}) && equal(send.height,${sendBefore.height}) && document.querySelector('#send').matches(':hover') && document.activeElement.id==='send' && getComputedStyle(document.querySelector('#send')).outlineStyle!=='none',
          standardRadius: controls.every(s => getComputedStyle(document.querySelector(s)).borderTopLeftRadius==='12px') && getComputedStyle(document.querySelector('#budget-input')).borderTopLeftRadius==='12px',
          navigationRadius: [...document.querySelectorAll('.nav-item')].every(e=>getComputedStyle(e).borderTopLeftRadius==='12px'),
          composerRadius: getComputedStyle(document.querySelector('.composer-card')).borderTopLeftRadius==='28px',
          contentTypography: getComputedStyle(document.querySelector('#composer')).fontSize==='14px' && getComputedStyle(document.querySelector('#composer')).lineHeight==='24px' && [...document.querySelectorAll('.msg-text')].every(e=>getComputedStyle(e).fontSize==='14px' && getComputedStyle(e).lineHeight===(e.closest('[data-role=user]')?'22px':'24px')),
          inputElevation: ['.composer-card','#budget-input'].every(s=>{const style=getComputedStyle(document.querySelector(s));return style.borderTopWidth==='0px' && style.boxShadow!=='none';}),
          // Chromium 在分数 DPR 下将实体边框量化为整数设备像素。
          warningBorder: equal(parseFloat(getComputedStyle(document.querySelector('#approval')).borderTopWidth),Math.max(1,Math.floor(devicePixelRatio))/devicePixelRatio),
          inputStrokeRebind: (()=>{const node=document.querySelector('#budget-input'),before=getComputedStyle(node).boxShadow;node.style.setProperty('--elevation-stroke-color','var(--accent)');try{return getComputedStyle(node).boxShadow!==before;}finally{node.style.removeProperty('--elevation-stroke-color');}})(),
          bubbleRadius: document.querySelectorAll('.tr-bubble__box').length>0 && [...document.querySelectorAll('.tr-bubble__box')].every(e=>getComputedStyle(e).borderTopLeftRadius==='20px'),
          groupedRadius: ['#tool-write','#approval'].every(s=>getComputedStyle(document.querySelector(s)).borderTopLeftRadius==='16px'),
          cornerCurve: !CSS.supports('corner-shape','superellipse(1.5)') || getComputedStyle(document.querySelector('#run-turn')).cornerShape==='superellipse(1.5)',
          sendGeometry:equal(send.width,34)&&equal(send.height,34)&&getComputedStyle(document.querySelector('#send')).borderTopLeftRadius==='999px'&&(!CSS.supports('corner-shape','round')||getComputedStyle(document.querySelector('#send')).cornerShape==='round'),
          sendGlyph:equal(box('#send svg').width,16)&&equal(box('#send svg').height,16),
          sendPalette:getComputedStyle(document.querySelector('#send')).backgroundColor==='${theme==='dark'?'rgb(65, 118, 230)':'rgb(122, 170, 255)'}'&&getComputedStyle(document.querySelector('#send')).color==='rgb(255, 255, 255)',
          composerRow:getComputedStyle(document.querySelector('.composer-controls')).padding==='2px 8px 6px'&&getComputedStyle(document.querySelector('.composer-card')).gap==='12px'&&getComputedStyle(document.querySelector('#composer')).padding==='4px 8px 0px 14px',
          circularStatus: !!document.querySelector('.pending-dot') && (!CSS.supports('corner-shape','round') || getComputedStyle(document.querySelector('.pending-dot')).cornerShape==='round'),
          primaryPalette: (()=>{const style=getComputedStyle(document.querySelector('#run-turn'));return style.backgroundColor==='${theme==='dark'?'rgb(126, 160, 255)':'rgb(36, 85, 230)'}'&&style.borderTopColor===style.backgroundColor&&style.color==='${theme==='dark'?'rgb(16, 19, 26)':'rgb(255, 255, 255)'}';})(),
          icons: [...document.querySelectorAll('.nav-symbol')].filter(e=>e.getClientRects().length).every(e => equal(e.getBoundingClientRect().width,18) && equal(e.getBoundingClientRect().height,18)),
          approvalFits: box('#approval').right <= side.right && box('#approval').left >= side.left,
          messageContentLoaded: document.querySelectorAll('.msg-text').length > 0,
          messageLabels: [...document.querySelectorAll('.tr-bubble')].every(e => {
            const label=e.querySelector('.msg-role'), text=e.querySelector('.msg-text');
            if (!label || !text) return false;
            return label.getBoundingClientRect().bottom <= text.getBoundingClientRect().top;
          }),
          chineseNavigation: [...document.querySelectorAll('.nav-item')].every(e => /[\\u4e00-\\u9fff]/.test(e.getAttribute('aria-label'))),
          noEval: typeof window.require === 'undefined',
        };
        const palette = (s) => { const style=getComputedStyle(document.querySelector(s));
          return [style.backgroundColor,style.color,style.borderTopColor]; };
        return { width:innerWidth, height:innerHeight, stateFacts:{before:${JSON.stringify(sendBefore)},after:{width:send.width,height:send.height},hover:document.querySelector('#send').matches(':hover'),focus:document.activeElement.id,outline:getComputedStyle(document.querySelector('#send')).outlineStyle}, cornerShapeSupported:CSS.supports('corner-shape','superellipse(1.5)'), checks, primary:[palette('#run-turn'),palette('#send')], failed:Object.keys(checks).filter(k => !checks[k]) };
      })()`);
      report.theme = theme;
      reports.push(report);
      writeFileSync(join(outDir, `sacode-${theme}-${width}x${height}.png`), (await win.webContents.capturePage()).toPNG());
      console.log(`LAYOUT ${report.failed.length ? "FAIL" : "PASS"} ${theme} ${width}x${height} ${report.failed.join(',')}`);
      await js("(()=>{const n=[...document.querySelectorAll('.msg-text')].find(e=>e.textContent.startsWith('长中文消息与输入对齐。'));if(n.dataset.foldState==='folded')n.closest('.tr-bubble').querySelector('.btn-fold').click();})()");
      await js("(()=>{const n=document.querySelector('.conversation-scroll');n.scrollTop=n.scrollHeight;})()");
      await js("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
      const userReport=await js(`(()=>{
        const n=[...document.querySelectorAll('.msg-text')].find(e=>e.textContent.startsWith('长中文消息与输入对齐。'));
        const body=n.closest('.tr-bubble__body'),group=n.closest('.tr-bubble'),box=e=>e.getBoundingClientRect();
        const checks={
          actualLongMessage:n.textContent==='长中文消息与输入对齐。'.repeat(35),
          visibleBubble:getComputedStyle(group.querySelector('.tr-bubble__box')).backgroundColor!==getComputedStyle(document.querySelector('.conversation')).backgroundColor,
          rightAligned:Math.abs(box(body).right-box(group).right)<1,
          widthBounded:box(body).width<=box(group).width*.702+1,
          wraps:box(n).height>44 && n.scrollWidth<=n.clientWidth,
          compactToggle:getComputedStyle(group.querySelector('.btn-fold')).borderTopLeftRadius==='8px',
          noPageOverflow:document.documentElement.scrollWidth<=innerWidth,
        };
        return {checks,failed:Object.keys(checks).filter(k=>!checks[k])};
      })()`);
      Object.assign(userReport,{theme,width,height,surface:'long-user'});reports.push(userReport);
      writeFileSync(join(outDir,`sacode-long-user-${theme}-${width}x${height}.png`),(await win.webContents.capturePage()).toPNG());
      console.log(`LAYOUT ${userReport.failed.length?'FAIL':'PASS'} long-user ${theme} ${width}x${height} ${userReport.failed.join(',')}`);
      await js("document.querySelector('.conversation-scroll').scrollTop=0");
      // 排版夹具只挂载实际正文渲染器，不伪造核心消息或会话事实。
      const wideHead=Array.from({length:10},(_,i)=>'列'+i).join('|'),wideRow=Array.from({length:10},(_,i)=>'长表格内容'+i).join('|');
      const markdownText='# 中文标题\n\n正文 **强调** 与 `行内代码`。\n\n1. 第一项\n   - 嵌套项\n2. 第二项\n\n> 引用正文\n\n```js\nconst 内容 = "'+ '长代码内容'.repeat(80)+'";\n```\n\n| 名称 | 值 |\n| :--- | ---: |\n| 项目 | 内容 |\n\n|'+wideHead+'|\n|'+Array(10).fill('---').join('|')+'|\n|'+wideRow+'|';
      await js(`(()=>{const n=document.createElement('div');n.id='markdown-layout-fixture';document.querySelector('.conversation-scroll').append(n);Vue.render(Vue.h('div',{class:'msg-text markdown-body'},SaCodeMarkdown.render(${JSON.stringify(markdownText)})),n);n.scrollIntoView();})()`);
      await js("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
      const codeSource=await js("document.querySelector('#markdown-layout-fixture pre').textContent");
      const toolbarReport=await js(`(()=>{
        const root=document.querySelector('#markdown-layout-fixture .markdown-code-card'),header=root.querySelector('.code-toolbar'),language=root.querySelector('.code-language'),actions=root.querySelector('.code-actions'),pre=root.querySelector('pre'),buttons=[...root.querySelectorAll('.code-action')];
        const box=e=>e.getBoundingClientRect(),center=e=>box(e).top+box(e).height/2;
        const checks={defaultWrapped:root.dataset.codeWrap==='true' && getComputedStyle(pre).whiteSpace==='pre-wrap' && pre.scrollWidth<=pre.clientWidth+1,headerInsets:getComputedStyle(header).padding==='10px 18px 8px 22px',headerType:getComputedStyle(header).fontSize==='11px'&&getComputedStyle(header).lineHeight==='18px',centered:Math.abs(center(language)-center(actions))<1&&buttons.every(b=>Math.abs(center(b)-center(actions))<1),buttonSize:buttons.every(b=>Math.abs(box(b).width-24)<1&&Math.abs(box(b).height-24)<1),iconSize:buttons.every(b=>Math.abs(box(b.querySelector('svg')).width-14)<1&&Math.abs(box(b.querySelector('svg')).height-14)<1),actionGap:getComputedStyle(actions).gap==='4px',sourceIntact:pre.textContent===${JSON.stringify(codeSource)},noPageOverflow:document.documentElement.scrollWidth<=innerWidth};
        return {checks,failed:Object.keys(checks).filter(k=>!checks[k])};
      })()`);
      // 在真实渲染组件上截取 Clipboard API 的写入参数，不改用户系统剪贴板。
      await js("window.__toolbarClipboardDescriptor=Object.getOwnPropertyDescriptor(navigator,'clipboard');Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.__toolbarCopiedText=text;}}})");
      try {
        await js("document.querySelector('#markdown-layout-fixture .code-copy').click()");
        await waitFor("document.querySelector('#markdown-layout-fixture .code-copy').getAttribute('aria-label')==='已复制' || !!document.querySelector('#markdown-layout-fixture .code-copy-error')");
        toolbarReport.checks.copyPayload=await js(`window.__toolbarCopiedText===${JSON.stringify(codeSource)}`);
        toolbarReport.checks.copyFeedback=await js("document.querySelector('#markdown-layout-fixture .code-copy').getAttribute('aria-label')==='已复制'");
        await js("document.querySelector('#markdown-layout-fixture .code-toolbar').scrollIntoView({block:'center'});new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
        writeFileSync(join(outDir,`sacode-code-toolbar-${theme}-${width}x${height}.png`),(await win.webContents.capturePage()).toPNG());
      } finally {await js("if(window.__toolbarClipboardDescriptor)Object.defineProperty(navigator,'clipboard',window.__toolbarClipboardDescriptor);else delete navigator.clipboard;delete window.__toolbarClipboardDescriptor;delete window.__toolbarCopiedText;");}
      toolbarReport.failed=Object.keys(toolbarReport.checks).filter(k=>!toolbarReport.checks[k]);
      // 长代码内滚动时实际测量吸顶位置，不仅检查 position 属性。
      toolbarReport.checks.stickyHeader=await js("(()=>{const fixture=document.querySelector('#markdown-layout-fixture'),root=fixture.querySelector('.markdown-code-card'),header=root.querySelector('.code-toolbar'),scroll=document.querySelector('.conversation-scroll'),spacer=document.createElement('div');spacer.id='code-sticky-spacer';spacer.style.height=scroll.clientHeight+'px';fixture.append(spacer);scroll.scrollTop+=header.getBoundingClientRect().top-scroll.getBoundingClientRect().top+60;const r=header.getBoundingClientRect(),s=scroll.getBoundingClientRect(),edge=s.top+parseFloat(getComputedStyle(scroll).paddingTop);return getComputedStyle(header).position==='sticky' && root.getBoundingClientRect().top<edge && Math.abs(r.top-edge)<1 && r.bottom<=s.bottom;})()");
      await js("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
      toolbarReport.metrics=await js("(()=>{const h=document.querySelector('#markdown-layout-fixture .code-toolbar'),s=document.querySelector('.conversation-scroll');return {headerTop:h.getBoundingClientRect().top,viewportTop:s.getBoundingClientRect().top,scrollTop:s.scrollTop,ancestors:[h.parentElement,h.parentElement.parentElement,h.parentElement.parentElement.parentElement].map(n=>({class:n.className,overflowX:getComputedStyle(n).overflowX,overflowY:getComputedStyle(n).overflowY,top:n.getBoundingClientRect().top,bottom:n.getBoundingClientRect().bottom}))};})()");
      writeFileSync(join(outDir,`sacode-code-sticky-${theme}-${width}x${height}.png`),(await win.webContents.capturePage()).toPNG());
      await js("document.querySelector('#code-sticky-spacer').remove()");
      toolbarReport.failed=Object.keys(toolbarReport.checks).filter(k=>!toolbarReport.checks[k]);
      Object.assign(toolbarReport,{theme,width,height,surface:'code-toolbar'});reports.push(toolbarReport);
      console.log(`LAYOUT ${toolbarReport.failed.length?'FAIL':'PASS'} code-toolbar ${theme} ${width}x${height} ${toolbarReport.failed.join(',')}`);
      await js("document.querySelector('#markdown-layout-fixture .code-wrap').click();new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
      const markdownReport=await js(`(()=>{
        const n=document.querySelector('#markdown-layout-fixture .markdown-body'),pre=n.querySelector('pre'),box=e=>e.getBoundingClientRect();
        const children=[...n.children];
        const checks={
          semanticBlocks:!!n.querySelector('h1') && !!n.querySelector('ol ul') && !!n.querySelector('blockquote') && !!n.querySelector('table'),
          verticalRhythm:children.slice(1).every((e,i)=>Math.abs(box(e).top-box(children[i]).bottom-16)<1),
          sharedLeftAxis:children.every(e=>Math.abs(box(e).left-box(n).left)<1),
          codeScroll:pre.scrollWidth>pre.clientWidth && getComputedStyle(pre).overflowX==='auto',
          codeHighlight:!!pre.querySelector('span[style]') && !![...pre.querySelectorAll('span')].find(e=>e.style.color==='var(--shiki-token-keyword)' && getComputedStyle(e).color==='${theme==='dark'?'rgb(250, 162, 193)':'rgb(214, 51, 108)'}'),
          codeInsets:getComputedStyle(pre).padding==='6px 22px 20px' && getComputedStyle(pre).borderBottomLeftRadius==='16px',
          codeType:getComputedStyle(pre).fontSize==='11px'&&getComputedStyle(pre).lineHeight==='19px'&&getComputedStyle(pre.querySelector('code')).fontSize==='11px',
          headingType:getComputedStyle(n.querySelector('h1')).fontSize==='21px'&&getComputedStyle(n.querySelector('h1')).lineHeight==='30px',
          tableType:getComputedStyle(n.querySelector('table')).fontSize==='13px'&&getComputedStyle(n.querySelector('table')).lineHeight==='22px'&&getComputedStyle(n.querySelector('th')).fontWeight==='500',
          tableFill:Math.abs(box(n.querySelector('.table-fill')).width-box(n.querySelector('.table-fill table')).width)<1,
          tableAlign:getComputedStyle(n.querySelector('th')).textAlign==='left' && getComputedStyle(n.querySelector('th:nth-child(2)')).textAlign==='right',
          wideTableBounded:n.querySelector('.table-wide').scrollWidth>n.querySelector('.table-wide').clientWidth && box(n.querySelector('.table-wide')).right<=box(n).right+1,
          nestedIndent:box(n.querySelector('ul')).left>box(n.querySelector('ol')).left,
          noPageOverflow:document.documentElement.scrollWidth<=innerWidth,
        };return {checks,failed:Object.keys(checks).filter(k=>!checks[k])};
      })()`);
      Object.assign(markdownReport,{theme,width,height,surface:'markdown'});reports.push(markdownReport);
      await js("document.querySelector('#markdown-layout-fixture pre').scrollIntoView({block:'center'})");
      writeFileSync(join(outDir,`sacode-markdown-${theme}-${width}x${height}.png`),(await win.webContents.capturePage()).toPNG());
      console.log(`LAYOUT ${markdownReport.failed.length?'FAIL':'PASS'} markdown ${theme} ${width}x${height} ${markdownReport.failed.join(',')}`);
      const tooltipReport=await require('./tooltip-smoke.cjs')({win,js,waitFor,outDir,theme,width,height});reports.push(tooltipReport);
      console.log(`LAYOUT ${tooltipReport.failed.length?'FAIL':'PASS'} tooltip ${theme} ${width}x${height} ${tooltipReport.failed.join(',')}`);
      const tableRestHeight=await js("document.querySelector('#markdown-layout-fixture .table-wide').getBoundingClientRect().height");
      await js("(()=>{const n=document.querySelector('#markdown-layout-fixture .table-wide');n.focus();n.scrollIntoView({block:'center'});})()");
      // 等滚动和焦点样式完成绘制，避免几何已更新而截图仍是上一帧。
      await js("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
      const wideTableReport=await js(`(()=>{
        const n=document.querySelector('#markdown-layout-fixture .table-wide'),before=n.textContent;n.scrollLeft=100;
        const rect=n.getBoundingClientRect(),scroll=document.querySelector('.conversation-scroll').getBoundingClientRect();
        const barHeight=n.offsetHeight-n.clientHeight;
        const checks={keyboardScroll:n.matches(':focus-visible') && getComputedStyle(n).overflowX==='scroll' && n.scrollLeft>0,sourceUnchanged:n.textContent===before,tenColumns:n.querySelectorAll('th').length===10,contained:document.documentElement.scrollWidth<=innerWidth,stableHeight:Math.abs(rect.height-${tableRestHeight})<1,visible:rect.top>=scroll.top && rect.bottom<=scroll.bottom,scrollbarFivePixels:Math.abs(barHeight-5)<1};
        return {checks,failed:Object.keys(checks).filter(k=>!checks[k]),metrics:{before:${tableRestHeight},after:rect.height,scrollbarWidth:getComputedStyle(n).scrollbarWidth,scrollbarColor:getComputedStyle(n).scrollbarColor,barHeight:getComputedStyle(n,'::-webkit-scrollbar').height,actualBarHeight:barHeight}};
      })()`);
      Object.assign(wideTableReport,{theme,width,height,surface:'wide-table'});reports.push(wideTableReport);
      await js("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
      writeFileSync(join(outDir,`sacode-wide-table-${theme}-${width}x${height}.png`),(await win.webContents.capturePage()).toPNG());
      console.log(`LAYOUT ${wideTableReport.failed.length?'FAIL':'PASS'} wide-table ${theme} ${width}x${height} ${wideTableReport.failed.join(',')}`);
      await js("(()=>{const n=document.querySelector('#markdown-layout-fixture');Vue.render(null,n);n.remove();document.querySelector('.conversation-scroll').scrollTop=0;})()");
      const streamingText='## 流式标题\n\n正文 **强调**。\n\n- 第一项\n- 第二项\n\n```js\nconst 内容 = "'+ '流式长代码'.repeat(80)+'";\n```';
      const streamingEvents=await js("document.querySelector('#count-events').textContent");
      // 临时挂载真实流式组件与 TinyRobot 投影组件；不调用模型、不造会话事件。
      await js("(()=>{const n=document.createElement('div');n.id='streaming-layout-fixture';document.querySelector('#messages').append(n);foldOpen.ids.add('layout-stream-message');})()");
      let streamUnwrapped=false;
      for (const partial of [streamingText.slice(0,10),streamingText.slice(0,62),streamingText]) {
        await js(`(()=>{const n=document.querySelector('#streaming-layout-fixture');Vue.render(Vue.h('div',{},[
          Vue.h(SaCodeMarkdown.Stream,{text:${JSON.stringify(partial)},running:true}),
          Vue.h(TR.BubbleProvider,{contentRendererMatches:[TEXT_MATCH]},()=>[Vue.h(TR.BubbleList,{messages:[{id:'layout-stream-message',role:'assistant',content:${JSON.stringify(partial)},sourceRole:'assistant/message'}],roleConfigs:FOLD.roleConfigs(),autoScroll:false})]),
        ]),n);})()`);
        await js("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
        if(!streamUnwrapped && await js("document.querySelectorAll('#streaming-layout-fixture .code-wrap').length===2")) {
          await js("document.querySelectorAll('#streaming-layout-fixture .code-wrap').forEach(n=>n.click());new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
          streamUnwrapped=true;
        }
      }
      const streamingReport=await js(`(()=>{
        const root=document.querySelector('#streaming-layout-fixture'),live=root.querySelector('#stream .markdown-body'),saved=root.querySelector('.tr-bubble .markdown-body'),box=e=>e.getBoundingClientRect();
        const checks={
          sameContent:live.textContent===saved.textContent,
          sharedLeftAxis:Math.abs(box(live).left-box(saved).left)<1,
          sharedRightAxis:Math.abs(box(live).right-box(saved).right)<1,
          sameBlockHeight:Math.abs(box(live).height-box(saved).height)<1,
          semanticBlocks:!!live.querySelector('h2') && !!live.querySelector('ul') && !!live.querySelector('pre'),
          codeScroll:[live,saved].every(n=>{const p=n.querySelector('pre');return p.scrollWidth>p.clientWidth && getComputedStyle(p).overflowX==='auto';}),
          wrapChoiceSurvivesGrowth:[live,saved].every(n=>n.querySelector('.markdown-code-card').dataset.codeWrap==='false'),
          sameHighlight:[live,saved].every(n=>!!n.querySelector('pre.shiki span[style]')) && live.querySelector('pre code').textContent===saved.querySelector('pre code').textContent,
          noPageOverflow:document.documentElement.scrollWidth<=innerWidth,
          noSessionWrite:document.querySelector('#count-events').textContent===${JSON.stringify(streamingEvents)},
        };return {checks,failed:Object.keys(checks).filter(k=>!checks[k])};
      })()`);
      Object.assign(streamingReport,{theme,width,height,surface:'streaming-markdown'});reports.push(streamingReport);
      await js("(()=>{const s=document.querySelector('.conversation-scroll'),n=document.querySelector('#streaming-layout-fixture h2');s.scrollTop+=n.getBoundingClientRect().top-s.getBoundingClientRect().top-12;})()");
      await waitFor("(()=>{const n=document.querySelector('#streaming-layout-fixture h2').getBoundingClientRect(),s=document.querySelector('.conversation-scroll').getBoundingClientRect();return n.top>=s.top && n.bottom<=s.bottom;})()");
      await js("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
      writeFileSync(join(outDir,`sacode-streaming-markdown-${theme}-${width}x${height}.png`),(await win.webContents.capturePage()).toPNG());
      console.log(`LAYOUT ${streamingReport.failed.length?'FAIL':'PASS'} streaming-markdown ${theme} ${width}x${height} ${streamingReport.failed.join(',')}`);
      await js("(()=>{const n=document.querySelector('#streaming-layout-fixture');Vue.render(null,n);n.remove();foldOpen.ids.delete('layout-stream-message');document.querySelector('.conversation-scroll').scrollTop=0;})()");
      const draftEvents=await js("document.querySelector('#count-events').textContent");
      await js("(()=>{const n=document.querySelector('#composer');n.value='自动增长输入与按钮对齐\\n'.repeat(30);n.dispatchEvent(new Event('input',{bubbles:true}));})()");
      await waitFor("(()=>{const n=document.querySelector('#composer');return n.scrollHeight>n.clientHeight && n.getBoundingClientRect().height>36;})()");
      const draftReport=await js(`(()=>{
        const n=document.querySelector('#composer'),card=document.querySelector('.composer-card'),send=document.querySelector('#send'),scroll=document.querySelector('.conversation-scroll'),box=e=>e.getBoundingClientRect();
        const checks={
          capped:Math.abs(box(n).height-Math.min(340,innerHeight-360))<1,
          internalScroll:n.scrollHeight>n.clientHeight && getComputedStyle(n).overflowY==='auto',
          conversationSpace:box(scroll).height>=80,
          controlsInside:box(send).right<box(card).right && box(send).bottom<box(card).bottom && box(n).bottom<box(send).top,
          noPageOverflow:document.documentElement.scrollHeight<=innerHeight && document.documentElement.scrollWidth<=innerWidth,
          noSessionWrite:document.querySelector('#count-events').textContent===${JSON.stringify(draftEvents)},
        };return {checks,failed:Object.keys(checks).filter(k=>!checks[k])};
      })()`);
      Object.assign(draftReport,{theme,width,height,surface:'long-draft'});reports.push(draftReport);
      await js("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
      writeFileSync(join(outDir,`sacode-long-draft-${theme}-${width}x${height}.png`),(await win.webContents.capturePage()).toPNG());
      console.log(`LAYOUT ${draftReport.failed.length?'FAIL':'PASS'} long-draft ${theme} ${width}x${height} ${draftReport.failed.join(',')}`);
      await js("(()=>{const n=document.querySelector('#composer');n.value='';n.dispatchEvent(new Event('input',{bubbles:true}));})()");
      await waitFor("Math.abs(document.querySelector('#composer').getBoundingClientRect().height-36)<1");
      draftReport.checks.emptySendDisabled=await js("document.querySelector('#send').disabled && getComputedStyle(document.querySelector('#send')).opacity==='0.4'");
      draftReport.failed=Object.keys(draftReport.checks).filter(key=>!draftReport.checks[key]);
      await js("document.querySelector('#detail-write').focus(); document.querySelector('#detail-write').click()");
      await new Promise((r) => setTimeout(r, 50));
      const dialogReport = await js(`(() => {
        const dialog = document.querySelector('dialog[open]');
        if (!dialog) return { checks:{opened:false}, failed:['opened'] };
        const box = dialog.getBoundingClientRect(), header = dialog.querySelector('.dialog-header');
        const fields = dialog.querySelector('.detail-fields');
        const keys = [...fields.querySelectorAll('dt')].map(e => e.getBoundingClientRect());
        const values = [...fields.querySelectorAll('dd')].map(e => e.getBoundingClientRect());
        const equal = (a,b) => Math.abs(a-b)<1;
        const checks = {
          opened: true,
          elevation: getComputedStyle(dialog).borderTopWidth==='0px' && getComputedStyle(dialog).boxShadow!=='none',
          fits: box.left>=0 && box.top>=0 && box.right<=innerWidth && box.bottom<=innerHeight,
          centered: equal(box.left+box.width/2,innerWidth/2),
          noOverflow: dialog.scrollWidth<=dialog.clientWidth,
          alignedFields: keys.length===4 && values.length===4 && keys.every((key,i) =>
            equal(key.left,keys[0].left) && equal(values[i].left,values[0].left) && equal(key.top,values[i].top)),
          controlHeight: equal(header.querySelector('button').getBoundingClientRect().height,36),
          focusInside: dialog.contains(document.activeElement),
        };
        return { checks, failed:Object.keys(checks).filter(k => !checks[k]) };
      })()`);
      dialogReport.theme = theme; dialogReport.width = width; dialogReport.height = height; dialogReport.surface = 'tool-detail';
      reports.push(dialogReport);
      writeFileSync(join(outDir, `sacode-detail-${theme}-${width}x${height}.png`), (await win.webContents.capturePage()).toPNG());
      console.log(`LAYOUT ${dialogReport.failed.length ? "FAIL" : "PASS"} tool-detail ${theme} ${width}x${height} ${dialogReport.failed.join(',')}`);
      await js("document.querySelector('dialog[open] .dialog-header button').click()");
      await js("document.querySelector('#side-tab-guide').click()");
      await new Promise((r) => setTimeout(r, 50));
      const guideReport = await js(`(() => {
        const box = e => e.getBoundingClientRect();
        const side = document.querySelector('.side'), tabs = [...document.querySelectorAll('.side-tab')];
        const content = document.querySelector('.side-content'), cards = [...document.querySelectorAll('.guide-card')];
        const checks = {
          visible: !document.querySelector('#side-page-guide').hidden && document.querySelector('#side-page-inspect').hidden,
          tabAlignment: Math.abs(box(tabs[0]).top-box(tabs[1]).top)<1 && Math.abs(box(tabs[0]).height-box(tabs[1]).height)<1,
          contentFits: content.scrollWidth<=content.clientWidth && box(content).bottom<=box(side).bottom+1,
          cardAlignment: cards.length===5 && cards.every(e => Math.abs(box(e).left-box(cards[0]).left)<1 && Math.abs(box(e).right-box(cards[0]).right)<1),
          approvalVisible: document.querySelector('#side-tab-inspect').getAttribute('aria-label').includes('待审批') && !!document.querySelector('.pending-dot') && !!document.querySelector('#guide-approval'),
          noPageOverflow: document.documentElement.scrollWidth<=innerWidth && document.documentElement.scrollHeight<=innerHeight,
        };
        return { checks, contentWidth:content.clientWidth, scrollWidth:content.scrollWidth,
          contentBottom:box(content).bottom, sideBottom:box(side).bottom,
          failed:Object.keys(checks).filter(k=>!checks[k]) };
      })()`);
      Object.assign(guideReport, { theme, width, height, surface:'guide' });
      reports.push(guideReport);
      writeFileSync(join(outDir, `sacode-guide-${theme}-${width}x${height}.png`), (await win.webContents.capturePage()).toPNG());
      console.log(`LAYOUT ${guideReport.failed.length ? "FAIL" : "PASS"} guide ${theme} ${width}x${height} ${guideReport.failed.join(',')}`);
      await js("document.querySelector('#guide-approval').click()");
      await js("document.querySelector('#side-tab-preview').click()");
      await new Promise(r=>setTimeout(r,50));
      const previewReport = await js(`(() => {
        const content=document.querySelector('.side-content'), path=document.querySelector('#preview-path'), text=document.querySelector('#preview-text');
        const box=e=>e.getBoundingClientRect();
        const checks={
          visible: !document.querySelector('#side-page-preview').hidden,
          actualRead: path.textContent===${JSON.stringify(expectedReadPath)} && text.textContent==='hello-from-renderer',
          aligned: Math.abs(box(path).left-box(text).left)<1 && Math.abs(box(path).right-box(text).right)<1,
          noOverflow: content.scrollWidth<=content.clientWidth,
          focusable: text.tabIndex===0,
        };
        return {checks,failed:Object.keys(checks).filter(k=>!checks[k])};
      })()`);
      Object.assign(previewReport,{theme,width,height,surface:'preview'}); reports.push(previewReport);
      writeFileSync(join(outDir,
        `sacode-preview-${theme}-${width}x${height}.png`), (await win.webContents.capturePage()).toPNG());
      console.log(`LAYOUT ${previewReport.failed.length ? "FAIL" : "PASS"} preview ${theme} ${width}x${height} ${previewReport.failed.join(',')}`);
      await js("document.querySelector('#side-tab-inspect').click()");
      await js("document.querySelector('#split-side').click()");
      // 独立视觉压力 fixture，不伪造核心失败或写会话日志；仅验证共享错误样式。
      await js("(() => {const error=document.createElement('p'); error.id='layout-error-fixture';error.className='error';error.textContent=('错误详情：'+ '长路径和返回信息'.repeat(30)+'\\n').repeat(40);document.querySelector('.conversation').append(error);})()");
      await new Promise(r=>setTimeout(r,50));
      const errorReport = await js(`(() => {
        const error=document.querySelector('#layout-error-fixture'), scroll=document.querySelector('.conversation-scroll');
        const composer=document.querySelector('.composer'), buttons=[...document.querySelectorAll('.turn-actions button')];
        const checks={
          constrained: error.getBoundingClientRect().height<=121 && error.scrollHeight>error.clientHeight,
          conversationVisible: scroll.getBoundingClientRect().height>=64,
          buttonsPreserved: buttons.every(e=>Math.abs(e.getBoundingClientRect().height-36)<1),
          paddingAligned: getComputedStyle(error).paddingLeft===getComputedStyle(composer).paddingLeft,
          noPageOverflow: document.documentElement.scrollWidth<=innerWidth && document.documentElement.scrollHeight<=innerHeight,
        };
        return {checks,failed:Object.keys(checks).filter(k=>!checks[k])};
      })()`);
      Object.assign(errorReport,{theme,width,height,surface:'long-error-fixture'}); reports.push(errorReport);
      writeFileSync(join(outDir, `sacode-error-${theme}-${width}x${height}.png`), (await win.webContents.capturePage()).toPNG());
      console.log(`LAYOUT ${errorReport.failed.length ? "FAIL" : "PASS"} long-error ${theme} ${width}x${height} ${errorReport.failed.join(',')}`);
      await js("document.querySelector('#layout-error-fixture').remove()");
      await js("document.querySelector('#open-settings').click()");
      for (const page of ['general','models','plugins']) {
        await js(`document.querySelector('#settings-tab-${page}').click()`);
        await new Promise(r=>setTimeout(r,50));
        const settingsReport = await js(`(() => {
          const dialog=document.querySelector('.settings-dialog[open]'), panel=document.querySelector('#settings-page-${page}'), r=dialog.getBoundingClientRect();
          const tabs=[...dialog.querySelectorAll('.settings-tab')], controls=[...dialog.querySelectorAll('.btn')].filter(e=>e.getClientRects().length>0);
          const cubes=[...panel.querySelectorAll('.theme-choice')], cubeRows=new Map();
          for(const cube of cubes){const rect=cube.getBoundingClientRect(),key=Math.round(rect.top);if(!cubeRows.has(key))cubeRows.set(key,[]);cubeRows.get(key).push(rect);}
          const checks={
            visible: !!dialog && !panel.hidden,
            fits: r.left>=0 && r.top>=0 && r.right<=innerWidth+1 && r.bottom<=innerHeight+1,
            noOverflow: dialog.scrollWidth<=dialog.clientWidth,
            controlsAligned: controls.every(e=>Math.abs(e.getBoundingClientRect().height-36)<1) && tabs.every(e=>Math.abs(e.getBoundingClientRect().height-40)<1 && Math.abs(e.getBoundingClientRect().left-tabs[0].getBoundingClientRect().left)<1),
            panelFrame:Math.abs(r.width-Math.min(800,innerWidth-48))<1 && Math.abs(r.height-Math.min(800,innerHeight-80))<1,
            navWidth:Math.abs(dialog.querySelector('.settings-nav').getBoundingClientRect().width-188)<1,
            columnsAligned:Math.abs(dialog.querySelector('.settings-nav').getBoundingClientRect().right-dialog.querySelector('.settings-content').getBoundingClientRect().left)<1,
            navStack:getComputedStyle(dialog.querySelector('.settings-tabs')).flexDirection==='column' && getComputedStyle(dialog.querySelector('.settings-tabs')).gap==='4px',
            headerFrame:Math.abs(dialog.querySelector('.settings-header').getBoundingClientRect().height-54)<1 && Math.abs(dialog.querySelector('.settings-close').getBoundingClientRect().width-28)<1 && Math.abs(dialog.querySelector('.settings-close').getBoundingClientRect().height-28)<1,
            optionsInsets:getComputedStyle(dialog.querySelector('.settings-options')).padding==='0px 24px 24px',
            navIcons:tabs.every(e=>{const i=e.querySelector('.settings-nav-icon').getBoundingClientRect(),label=e.querySelector('.settings-nav-label').getBoundingClientRect();return Math.abs(i.width-16)<1 && Math.abs(i.height-16)<1 && Math.abs((i.top+i.bottom)-(label.top+label.bottom))<1 && Math.abs(label.left-i.right-8)<1;}),
            generalRows: '${page}'!=='general' || (getComputedStyle(panel).gap==='0px' && !panel.querySelector('[id^="settings-budget"]')),
            ...('${page}'==='general'?{
              themeOrder:cubes.map(e=>e.id).join(',')==='theme-light,theme-dark,theme-system',
              themeSelected:cubes.filter(e=>e.getAttribute('aria-pressed')==='true').length===1 && document.querySelector('#theme-${theme}').getAttribute('aria-pressed')==='true',
              settingsModulePalette:[panel.querySelector('.theme-choice[aria-pressed=true]'),panel.querySelector('.font-stepper'),panel.querySelector('.settings-fixed-value')].every(e=>getComputedStyle(e).backgroundColor===('${theme}'==='dark'?'rgb(53, 54, 56)':'rgb(249, 250, 251)')),
              themeColumns:cubes.length===3 && cubes.every(e=>getComputedStyle(e).flexDirection==='column' && getComputedStyle(e).alignItems==='center' && getComputedStyle(e).gap==='4px'),
              themeRowAlignment:[...cubeRows.values()].every(row=>row.every(rect=>Math.abs(rect.height-row[0].height)<1 && rect.left>=panel.getBoundingClientRect().left && rect.right<=panel.getBoundingClientRect().right+1)),
              themeInsets:cubes.every(e=>getComputedStyle(e).padding==='20px 32px' && getComputedStyle(e).borderTopLeftRadius==='20px'),
              themeIconLabel:cubes.every(e=>{const icon=e.querySelector('.theme-icon').getBoundingClientRect(),label=e.querySelector('.theme-label').getBoundingClientRect();return Math.abs(icon.width-16)<1 && Math.abs(icon.height-16)<1 && Math.abs((icon.left+icon.right)-(label.left+label.right))<1 && Math.abs(label.top-icon.bottom-4)<1;}),
              themeGap:getComputedStyle(panel.querySelector('.theme-choices')).gap==='8px',
            }:{}),
          };
          return {checks,failed:Object.keys(checks).filter(k=>!checks[k])};
        })()`);
        Object.assign(settingsReport,{theme,width,height,surface:'settings-'+page}); reports.push(settingsReport);
        writeFileSync(join(outDir, `sacode-settings-${page}-${theme}-${width}x${height}.png`),(await win.webContents.capturePage()).toPNG());
        console.log(`LAYOUT ${settingsReport.failed.length ? "FAIL" : "PASS"} settings-${page} ${theme} ${width}x${height} ${settingsReport.failed.join(',')}`);
      }
      // 长内容只作为几何压力样本，不虚构工具或配置能力。
      const longSettingsReport = await js(`(() => {
        const dialog=document.querySelector('.settings-dialog[open]'), body=dialog.querySelector('.dialog-body'), header=dialog.querySelector('.dialog-header');
        const fixture=document.createElement('p'); fixture.id='layout-settings-fixture'; fixture.className='note';
        fixture.textContent=('长配置说明：'+ '目录与工具说明'.repeat(30)+'\\n').repeat(60);
        fixture.style.whiteSpace='pre-wrap'; body.append(fixture);
        const nav=dialog.querySelector('.settings-nav'),title=dialog.querySelector('.settings-title'),list=dialog.querySelector('.settings-tabs');
        const navBefore=nav.getBoundingClientRect(), titleBefore=title.getBoundingClientRect();
        const before=header.getBoundingClientRect(); body.scrollTop=body.scrollHeight;
        const contentScroll=body.scrollTop;
        const navFixture=document.createElement('div');navFixture.id='layout-nav-fixture';navFixture.textContent=('导航长度压力样本\\n').repeat(80);navFixture.style.whiteSpace='pre-wrap';list.append(navFixture);list.scrollTop=list.scrollHeight;
        const after=header.getBoundingClientRect(), close=header.querySelector('button').getBoundingClientRect(), rect=dialog.getBoundingClientRect();
        const checks={
          bodyScrolls: body.scrollHeight>body.clientHeight && body.scrollTop>0,
          headerStays: Math.abs(before.top-after.top)<1 && after.top>=rect.top && close.bottom<=rect.bottom,
          dialogDoesNotScroll: dialog.scrollHeight<=dialog.clientHeight+1,
          noHorizontalOverflow: body.scrollWidth<=body.clientWidth && rect.right<=innerWidth+1,
          navStays:Math.abs(navBefore.top-nav.getBoundingClientRect().top)<1 && Math.abs(titleBefore.top-title.getBoundingClientRect().top)<1,
          navScrolls:list.scrollHeight>list.clientHeight && list.scrollTop>0,
          independentScroll:Math.abs(body.scrollTop-contentScroll)<1,
        };
        navFixture.remove();list.scrollTop=0;
        return {checks,failed:Object.keys(checks).filter(k=>!checks[k])};
      })()`);
      Object.assign(longSettingsReport,{theme,width,height,surface:'long-settings'}); reports.push(longSettingsReport);
      writeFileSync(join(outDir, `sacode-long-settings-${theme}-${width}x${height}.png`),(await win.webContents.capturePage()).toPNG());
      console.log(`LAYOUT ${longSettingsReport.failed.length ? "FAIL" : "PASS"} long-settings ${theme} ${width}x${height} ${longSettingsReport.failed.join(',')}`);
      await js("document.querySelector('#layout-settings-fixture').remove(); document.querySelector('.settings-dialog .dialog-body').scrollTop=0");
      await js("document.querySelector('.settings-dialog .dialog-header button').click()");
      await js("document.querySelector('#open-settings').focus();document.querySelector('#open-settings').click();document.querySelector('#settings-tab-general').click()");
      await waitFor("document.querySelector('.settings-dialog[open]') && document.querySelector('#font-value').textContent==='14'");
      await js("(()=>{const n=document.querySelector('#composer');n.value='字号变化与高度适配\\n'.repeat(5);n.dispatchEvent(new Event('input',{bubbles:true}));})()");
      const typographyText='# 一级\n\n## 二级\n\n### 三级\n\n#### 四级\n\n##### 五级\n\n###### 六级\n\n`行内代码`\n\n```js\nconst x = 1;\n```\n\n| 名称 | 值 |\n| --- | --- |\n| 项目 | 内容 |';
      await js(`(()=>{const n=document.createElement('div');n.id='font-markdown-fixture';document.querySelector('.conversation-scroll').append(n);Vue.render(Vue.h(SaCodeMarkdown.Body,{text:${JSON.stringify(typographyText)}}),n);})()`);
      for(const size of [10,22,14]) {
        let current=Number(await js("document.querySelector('#font-value').textContent"));
        while(current!==size) {
          const next=current+(current<size?1:-1);
          await js(`document.querySelector('#font-${current<size?'increase':'decrease'}').click()`);
          await waitFor(`document.querySelector('#font-value').textContent==='${next}' && !document.querySelector('.font-settings').getAttribute('aria-busy').includes('true')`);
          current=next;
        }
        await waitFor(`Math.abs(document.querySelector('#composer').getBoundingClientRect().height-${(size+10)*6+4})<1`);
        await js(`document.querySelector('#font-${size===22?'decrease':'increase'}').focus()`);
        const fontReport=await js(`(()=>{
          const n=document.querySelector('#composer'),row=document.querySelector('.font-row'),control=document.querySelector('.font-control'),step=document.querySelector('.font-stepper'),dialog=document.querySelector('.settings-dialog[open]'),box=e=>e.getBoundingClientRect();
          const texts=[...document.querySelectorAll('#messages .msg-text')];
          const markdown=document.querySelector('#font-markdown-fixture');
          const checks={
            sharedAxis:getComputedStyle(n).fontSize==='${size}px' && texts.every(e=>getComputedStyle(e).fontSize==='${size}px'),
            lineAxis:getComputedStyle(n).lineHeight==='${size+10}px' && texts.every(e=>getComputedStyle(e).lineHeight===(e.closest('[data-role=user]')?'${size+8}px':'${size+10}px')),
            draftResized:Math.abs(box(n).height-${(size+10)*6+4})<1,
            rowAligned:Math.abs((box(row).top+box(row).bottom)/2-(box(control).top+box(control).bottom)/2)<1,
            fixedControl:Math.abs(box(step).height-36)<1 && Math.abs(box(step).width-72)<1 && getComputedStyle(document.querySelector('#send')).fontSize==='13px',
            focusReveals:getComputedStyle(document.querySelector('.font-arrows')).opacity==='1',
            contained:box(control).right<=box(dialog).right && dialog.scrollWidth<=dialog.clientWidth && document.documentElement.scrollWidth<=innerWidth,
            markdownHeadingScale:[...markdown.querySelectorAll('h1,h2,h3,h4,h5,h6')].every((e,i)=>getComputedStyle(e).fontSize===([21,19,18,14,14,14][i]+${size-14})+'px' && getComputedStyle(e).lineHeight===([30,28,26,24,24,24][i]+${size-14})+'px'),
            markdownTableScale:getComputedStyle(markdown.querySelector('table')).fontSize==='${size<=14?size-1:size-2}px' && getComputedStyle(markdown.querySelector('table')).lineHeight==='${(size<=14?size-1:size-2)+9}px',
            fixedCodeType:getComputedStyle(markdown.querySelector('pre code')).fontSize==='11px' && getComputedStyle(markdown.querySelector('pre')).lineHeight==='19px' && getComputedStyle(markdown.querySelector('p code')).fontSize==='12px',
          };return {checks,failed:Object.keys(checks).filter(k=>!checks[k])};
        })()`);
        Object.assign(fontReport,{theme,width,height,surface:'font-'+size});reports.push(fontReport);
        writeFileSync(join(outDir,`sacode-font-${size}-${theme}-${width}x${height}.png`),(await win.webContents.capturePage()).toPNG());
        console.log(`LAYOUT ${fontReport.failed.length?'FAIL':'PASS'} font-${size} ${theme} ${width}x${height} ${fontReport.failed.join(',')}`);
      }
      await js("(()=>{const n=document.querySelector('#font-markdown-fixture');Vue.render(null,n);n.remove();})()");
      await js("(()=>{const n=document.querySelector('#composer');n.value='';n.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('.settings-dialog .dialog-header button').click();})()");
      await js("document.querySelector('#open-catalog').focus(); document.querySelector('#open-catalog').click()");
      await waitFor("!!document.querySelector('.catalog-dialog[open] #catalog-root')");
      const catalogReport = await js(`(() => {
        const dialog=document.querySelector('.catalog-dialog[open]'), rect=dialog.getBoundingClientRect();
        const cards=[...dialog.querySelectorAll('.catalog-card')], box=e=>e.getBoundingClientRect();
        const name=document.querySelector('#new-session-title'), create=document.querySelector('#create-session');
        const checks={
          actualCatalog: cards.length>=3 && cards.some(e=>e.dataset.sessionId==='current'),
          fits: rect.left>=0 && rect.top>=0 && rect.right<=innerWidth+1 && rect.bottom<=innerHeight+1,
          cardAlignment: cards.length>0 && cards.every(e=>Math.abs(box(e).left-box(cards[0]).left)<1 && Math.abs(box(e).right-box(cards[0]).right)<1),
          titleAndBadgeCentered: cards.every(e=>{const title=box(e.querySelector('h3')), badge=box(e.querySelector('.badge'));return Math.abs(title.top+title.height/2-badge.top-badge.height/2)<1;}),
          noOverflow: dialog.scrollWidth<=dialog.clientWidth && cards.every(e=>e.scrollWidth<=e.clientWidth),
          refreshHeight: Math.abs(box(document.querySelector('#refresh-catalog')).height-36)<1,
          createRowAligned: Math.abs(box(name).top-box(create).top)<1 && Math.abs(box(name).height-36)<1 && Math.abs(box(create).height-36)<1,
          selectionControlHeights: [...dialog.querySelectorAll('.catalog-select')].every(e=>Math.abs(box(e).height-36)<1),
          longTitleBounded: cards.some(e=>{const title=e.querySelector('h3');return title.scrollWidth>title.clientWidth && title.title===title.textContent && getComputedStyle(title).textOverflow==='ellipsis';}),
        };
        return {checks,failed:Object.keys(checks).filter(k=>!checks[k])};
      })()`);
      Object.assign(catalogReport,{theme,width,height,surface:'catalog'}); reports.push(catalogReport);
      writeFileSync(join(outDir, `sacode-catalog-${theme}-${width}x${height}.png`),(await win.webContents.capturePage()).toPNG());
      console.log(`LAYOUT ${catalogReport.failed.length ? "FAIL" : "PASS"} catalog ${theme} ${width}x${height} ${catalogReport.failed.join(',')}`);
      await js("document.querySelector('.catalog-dialog .dialog-header button').click()");
      await js("document.querySelector('#open-workspace').focus();document.querySelector('#open-workspace').click()");
      await waitFor("!!document.querySelector('.workspace-dialog[open] #workspace-directory')");
      // 等待新弹窗完成绘制，避免截图捕获上一帧的会话列表。
      await js("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
      const workspaceReport=await js(`(()=>{
        const dialog=document.querySelector('.workspace-dialog[open]'), panel=dialog.querySelector('.workspace-panel'), directory=document.querySelector('#workspace-directory');
        const box=e=>e.getBoundingClientRect(), rect=box(dialog), controls=[...dialog.querySelectorAll('.btn')];
        const checks={
          actualDirectory: directory.textContent.length>0,
          surfaceRadius: getComputedStyle(dialog).borderTopLeftRadius==='28px' && getComputedStyle(panel).borderTopLeftRadius==='20px',
          fits:rect.left>=0 && rect.top>=0 && rect.right<=innerWidth+1 && rect.bottom<=innerHeight+1,
          controls:controls.length===2 && controls.every(e=>Math.abs(box(e).height-36)<1),
          aligned:Math.abs(box(directory).left-box(panel.querySelector('.badge')).left)<1,
          wrappedPath:directory.textContent.includes('长中文目录与空格路径') && box(directory).height>parseFloat(getComputedStyle(directory).lineHeight)*1.5,
          toolbarCentered:Math.abs(box(dialog.querySelector('.catalog-toolbar h2')).top+box(dialog.querySelector('.catalog-toolbar h2')).height/2-box(document.querySelector('#choose-workspace')).top-box(document.querySelector('#choose-workspace')).height/2)<1,
          noOverflow:dialog.scrollWidth<=dialog.clientWidth && panel.scrollWidth<=panel.clientWidth,
        };
        return {checks,failed:Object.keys(checks).filter(k=>!checks[k])};
      })()`);
      Object.assign(workspaceReport,{theme,width,height,surface:'workspace'});reports.push(workspaceReport);
      writeFileSync(join(outDir,`sacode-workspace-${theme}-${width}x${height}.png`),(await win.webContents.capturePage()).toPNG());
      console.log(`LAYOUT ${workspaceReport.failed.length ? 'FAIL':'PASS'} workspace ${theme} ${width}x${height} ${workspaceReport.failed.join(',')}`);
      await js("document.querySelector('.workspace-dialog .dialog-header button').click()");
      await js("document.querySelector('#side-tab-preview').click(); document.querySelector('#preview-float').focus(); document.querySelector('#preview-float').click()");
      await new Promise(r=>setTimeout(r,50));
      const floatReport = await js(`(() => {
        const dialog=document.querySelector('.floating-preview[open]'), box=dialog.getBoundingClientRect(), text=document.querySelector('#float-preview-text');
        const checks={
          visible: !!dialog,
          fits: box.left>=0 && box.top>=0 && box.right<=innerWidth+1 && box.bottom<=innerHeight+1,
          noOverflow: dialog.scrollWidth<=dialog.clientWidth,
          sameSnapshot: text.textContent===document.querySelector('#preview-text').textContent,
          nonModal: dialog.getAttribute('aria-modal')==='false',
          controlHeight: Math.abs(dialog.querySelector('.dialog-header button').getBoundingClientRect().height-36)<1,
        };
        return {checks,failed:Object.keys(checks).filter(k=>!checks[k])};
      })()`);
      Object.assign(floatReport,{theme,width,height,surface:'floating'}); reports.push(floatReport);
      writeFileSync(join(outDir, `sacode-floating-${theme}-${width}x${height}.png`), (await win.webContents.capturePage()).toPNG());
      console.log(`LAYOUT ${floatReport.failed.length ? "FAIL" : "PASS"} floating ${theme} ${width}x${height} ${floatReport.failed.join(',')}`);
      await js("document.querySelector('.floating-preview .dialog-header button').click(); document.querySelector('#side-tab-inspect').click()");
      await new Promise(r=>setTimeout(r,50));
      const splitReport = await js(`(() => {
        const primary=document.querySelector('.side-primary'), secondary=document.querySelector('.side-secondary'), divider=document.querySelector('#pane-divider');
        const box=e=>e.getBoundingClientRect(), a=box(primary), b=box(secondary), d=box(divider);
        const checks={
          bothPanes: !!primary && !!secondary,
          aligned: Math.abs(a.left-b.left)<1 && Math.abs(a.right-b.right)<1,
          separated: a.bottom<=d.top+1 && d.bottom<=b.top+1,
          balanced: Math.abs(a.height-b.height)<1,
          independentScroll: getComputedStyle(primary).overflowY==='auto' && getComputedStyle(secondary).overflowY==='auto',
          sameSnapshot: document.querySelector('#split-preview-text').textContent === document.querySelector('#preview-text').textContent,
          noPageOverflow: document.documentElement.scrollWidth<=innerWidth && document.documentElement.scrollHeight<=innerHeight,
        };
        return {checks,failed:Object.keys(checks).filter(k=>!checks[k])};
      })()`);
      Object.assign(splitReport,{theme,width,height,surface:'split'}); reports.push(splitReport);
      writeFileSync(join(outDir, `sacode-split-${theme}-${width}x${height}.png`), (await win.webContents.capturePage()).toPNG());
      console.log(`LAYOUT ${splitReport.failed.length ? "FAIL" : "PASS"} split ${theme} ${width}x${height} ${splitReport.failed.join(',')}`);
      await js("document.querySelector('#split-side').click()");
    }
  }
  writeFileSync(join(outDir, "layout-report.json"), JSON.stringify(reports, null, 2));
  return reports.every((r) => r.failed.length === 0);
};
