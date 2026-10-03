// 真 Electron 窗口的几何验收与截图，不用源码字符串代替视觉证据。
const { mkdirSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
module.exports = async function layoutSmoke({ win, nativeTheme, outDir }) {
  mkdirSync(outDir, { recursive: true });
  const js = (source) => win.webContents.executeJavaScript(source, true);
  for (let i = 0; i < 100; i++) {
    if (await js("!!document.querySelector('#tool-write')")) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  await js("document.querySelector('#tool-write').click()");
  for (let i = 0; i < 100; i++) {
    if (await js("!!document.querySelector('#approval')")) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  const reports = [];
  for (const theme of ["light", "dark"]) {
    nativeTheme.themeSource = theme;
    for (const [width, height] of [[880, 640], [1100, 720], [1440, 900]]) {
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
    }
  }
  writeFileSync(join(outDir, "layout-report.json"), JSON.stringify(reports, null, 2));
  return reports.every((r) => r.failed.length === 0);
};
