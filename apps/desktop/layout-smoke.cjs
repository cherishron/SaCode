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
  await js("(()=>{const n=document.querySelector('#composer');n.value='长中文消息与输入对齐。'.repeat(35);n.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#send').click();})()");
  await waitFor("[...document.querySelectorAll('.msg-text')].some(e=>e.textContent.startsWith('长中文消息与输入对齐。'))");
  const reports = [];
  for (const theme of ["light", "dark"]) {
    nativeTheme.themeSource = theme;
    for (const [width, height] of [[860, 600], [880, 640], [1100, 720], [1440, 900]]) {
      win.setContentSize(width, height);
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
      const report = await js(`(() => {
        const box = (s) => document.querySelector(s).getBoundingClientRect();
        const equal = (a, b) => Math.abs(a-b) < 1;
        const main = box('.conversation'), composer = box('.composer'), side = box('.side');
        const input = box('#budget-input'), apply = box('#apply-budget');
        const draft = box('#composer'), send = box('#send');
        const controls = ['#run-turn','#run-turn-2','#stop-turn','#apply-budget','#allow-once','#deny','#send'];
        const checks = {
          brand: document.title.startsWith('SaCode') && document.querySelector('.brand').textContent === 'SaCode',
          logo: document.querySelector('.brand img').naturalWidth > 0,
          noPageOverflow: document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight,
          columns: equal(main.left, composer.left) && equal(main.right, composer.right) && equal(main.right, side.left),
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
          cornerCurve: !CSS.supports('corner-shape','superellipse(1.5)') || getComputedStyle(document.querySelector('#send')).cornerShape==='superellipse(1.5)',
          circularStatus: !!document.querySelector('.pending-dot') && (!CSS.supports('corner-shape','round') || getComputedStyle(document.querySelector('.pending-dot')).cornerShape==='round'),
          primaryPalette: ['backgroundColor','color','borderTopColor'].every(key =>
            getComputedStyle(document.querySelector('#run-turn'))[key] === getComputedStyle(document.querySelector('#send'))[key]),
          icons: [...document.querySelectorAll('.nav-symbol')].every(e => equal(e.getBoundingClientRect().width,18) && equal(e.getBoundingClientRect().height,18)),
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
      const draftEvents=await js("document.querySelector('#count-events').textContent");
      await js("(()=>{const n=document.querySelector('#composer');n.value='自动增长输入与按钮对齐\\n'.repeat(30);n.dispatchEvent(new Event('input',{bubbles:true}));})()");
      await waitFor("(()=>{const n=document.querySelector('#composer');return n.scrollHeight>n.clientHeight && n.getBoundingClientRect().height>36;})()");
      const draftReport=await js(`(()=>{
        const n=document.querySelector('#composer'),card=document.querySelector('.composer-card'),send=document.querySelector('#send'),scroll=document.querySelector('.conversation-scroll'),box=e=>e.getBoundingClientRect();
        const checks={
          capped:Math.abs(box(n).height-Math.min(348,innerHeight-360))<1,
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
          const input=document.querySelector('#settings-budget-input'), apply=document.querySelector('#settings-budget-apply');
          const checks={
            visible: !!dialog && !panel.hidden,
            fits: r.left>=0 && r.top>=0 && r.right<=innerWidth+1 && r.bottom<=innerHeight+1,
            noOverflow: dialog.scrollWidth<=dialog.clientWidth,
            controlsAligned: controls.every(e=>Math.abs(e.getBoundingClientRect().height-36)<1) && tabs.every(e=>Math.abs(e.getBoundingClientRect().top-tabs[0].getBoundingClientRect().top)<1),
            budgetAligned: '${page}'!=='general' || (Math.abs(input.getBoundingClientRect().top-apply.getBoundingClientRect().top)<1 && Math.abs(input.getBoundingClientRect().height-36)<1),
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
        const before=header.getBoundingClientRect(); body.scrollTop=body.scrollHeight;
        const after=header.getBoundingClientRect(), close=header.querySelector('button').getBoundingClientRect(), rect=dialog.getBoundingClientRect();
        const checks={
          bodyScrolls: body.scrollHeight>body.clientHeight && body.scrollTop>0,
          headerStays: Math.abs(before.top-after.top)<1 && after.top>=rect.top && close.bottom<=rect.bottom,
          dialogDoesNotScroll: dialog.scrollHeight<=dialog.clientHeight+1,
          noHorizontalOverflow: body.scrollWidth<=body.clientWidth && rect.right<=innerWidth+1,
        };
        return {checks,failed:Object.keys(checks).filter(k=>!checks[k])};
      })()`);
      Object.assign(longSettingsReport,{theme,width,height,surface:'long-settings'}); reports.push(longSettingsReport);
      writeFileSync(join(outDir, `sacode-long-settings-${theme}-${width}x${height}.png`),(await win.webContents.capturePage()).toPNG());
      console.log(`LAYOUT ${longSettingsReport.failed.length ? "FAIL" : "PASS"} long-settings ${theme} ${width}x${height} ${longSettingsReport.failed.join(',')}`);
      await js("document.querySelector('#layout-settings-fixture').remove(); document.querySelector('.settings-dialog .dialog-body').scrollTop=0");
      await js("document.querySelector('.settings-dialog .dialog-header button').click()");
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
