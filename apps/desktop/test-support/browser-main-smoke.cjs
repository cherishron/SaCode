'use strict';
const http = require('node:http');
const { webContents } = require('electron');
const { join } = require('node:path');
const { writeFileSync } = require('node:fs');
module.exports = async function ({ app, bridge, seedIfNeeded, createWindow, SESSION_DIR }) {
  let win, server; const checks = [];
  const watchdog = setTimeout(() => { console.error('BROWSER_MAIN timeout'); bridge.killNow(); app.exit(2); }, 35000);
  const wait = async condition => { const until = Date.now() + 6000; while (Date.now() < until) { if (await condition()) return; await new Promise(r => setTimeout(r, 30)); } throw Error('browser-main-wait'); };
  try {
    server = http.createServer((_req, res) => { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end('<!doctype html><title>工作台浏览器实测</title><h1>真实网页内容</h1><p>人工浏览，不代表 Agent 授权。</p>'); });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const url = 'http://127.0.0.1:' + server.address().port + '/';
    seedIfNeeded(); await bridge.start(SESSION_DIR); win = createWindow(); win.setAlwaysOnTop(true); win.show(); win.focus();
    const js = code => win.webContents.executeJavaScript(code, true);
    await wait(() => js('!!document.querySelector("#add-resource")'));
    await js('document.querySelector("#toggle-side").click()');
    await js('document.querySelector("#add-resource").click()');
    await js('[...document.querySelectorAll(".workbench-resource-list button")].find(b=>b.textContent.trim()==="内置浏览器").click()');
    await wait(() => js('!!document.querySelector(".browser-navigation button[type=submit]")'));
    await js('(()=>{const i=document.querySelector(".browser-address input");i.value=' + JSON.stringify(url) + ';i.dispatchEvent(new Event("input",{bubbles:true}));return Vue.nextTick()})()');
    await wait(() => js('!document.querySelector(".browser-navigation button[type=submit]").disabled'));
    await js('document.querySelector(".browser-navigation button[type=submit]").click()');
    await wait(() => js('document.querySelector(".browser-page-status").textContent.includes("工作台浏览器实测")'));
    checks.push('正式添加资源入口导航真实网页');
    const browser = webContents.getAllWebContents().find(wc => wc.getURL() === url);
    if (!browser) throw Error('browser-webcontents-missing');
    if (!await browser.executeJavaScript('document.querySelector("h1").textContent==="真实网页内容" && typeof window.sacode==="undefined"')) throw Error('browser-isolation');
    checks.push('独立网页真实 DOM 与桥隔离');
    await browser.capturePage().then(image => writeFileSync(join(SESSION_DIR, 'web-page.png'), image.toPNG()));
    await js('document.querySelector("#open-settings").click()');
    await wait(() => js('!!document.querySelector(".settings-dialog[open]")'));
    await new Promise(r => setTimeout(r, 100));
    await win.capturePage().then(image => writeFileSync(join(SESSION_DIR, 'settings.png'), image.toPNG()));
    checks.push('工作台设置弹窗可打开');
    await js('document.querySelector(".settings-close").click()');
    await js('document.querySelector("#side-tab-files").click()');
    await js('document.querySelector("#side-tab-browser").click()');
    await wait(() => js('document.querySelector(".browser-page-status").textContent.includes("工作台浏览器实测")'));
    checks.push('切换资源后页面保留');
    await js('document.querySelector("button[aria-label=关闭内置浏览器]").click()');
    await wait(() => browser.isDestroyed()); checks.push('关闭资源销毁原生网页');
    console.log('BROWSER_MAIN PASS ' + JSON.stringify(checks));
    clearTimeout(watchdog); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); win.destroy(); await bridge.stop(); app.exit(0);
  } catch (error) {
    console.error('BROWSER_MAIN FAIL', error.stack); if (win) console.error(await win.webContents.executeJavaScript('document.body.innerText.slice(-6000)').catch(() => ''));
    server?.closeAllConnections(); server?.close(); if (win && !win.isDestroyed()) win.destroy(); bridge.killNow(); clearTimeout(watchdog); app.exit(1);
  }
};
