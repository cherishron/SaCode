// 真 Electron 窗口的几何验收与截图，不用源码字符串代替视觉证据。
const { mkdirSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
module.exports = async function layoutSmoke({ win, nativeTheme, outDir }) {
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
  const reports = [];
  for (const theme of ["light", "dark"]) {
    nativeTheme.themeSource = theme;
    for (const [width, height] of [[860, 600], [880, 640], [1100, 720], [1440, 900]]) {
      win.setContentSize(width, height);
      // 等库的主题/启用态颜色过渡完成，再比较最终色值与截图。
      await new Promise((r) => setTimeout(r, 500));
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
          composerBottom: equal(draft.bottom, send.bottom),
          controlHeights: controls.every(s => equal(box(s).height, 36)),
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
        return { width:innerWidth, height:innerHeight, checks, primary:[palette('#run-turn'),palette('#send')], failed:Object.keys(checks).filter(k => !checks[k]) };
      })()`);
      report.theme = theme;
      reports.push(report);
      writeFileSync(join(outDir, `sacode-${theme}-${width}x${height}.png`), (await win.webContents.capturePage()).toPNG());
      console.log(`LAYOUT ${report.failed.length ? "FAIL" : "PASS"} ${theme} ${width}x${height} ${report.failed.join(',')}`);
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
    }
  }
  writeFileSync(join(outDir, "layout-report.json"), JSON.stringify(reports, null, 2));
  return reports.every((r) => r.failed.length === 0);
};
