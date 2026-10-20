// 默认沙箱、完整主进程/预加载/页面的诊断入口；输出只写调用者指定的临时根。
module.exports = async function run({desktop, output, closeAfterChecks=false, questionTest=false,imageAttachmentId}) {
  const {app} = require('electron');
  const {join} = require('node:path');
  const {writeFileSync, readFileSync, existsSync, appendFileSync} = require('node:fs');
  process.env.SACODE_DATA_DIR = join(output, 'data');
  process.env.SACODE_USER_SETTINGS_DIR = join(output, 'settings');
  process.argv.push('--session-dir='+join(output,'sessions'));
  if(questionTest){
    const fixture=await require('./question-fixture.cjs')(output);
    process.env.SACODE_PROVIDER_BASE_URL=fixture.baseUrl;process.env.SACODE_PROVIDER_MODEL='gui-question-fixture';process.env.SACODE_PROVIDER_KEY='fixture-only';
    app.on('will-quit',()=>{fixture.server.closeAllConnections();fixture.server.close();});
  }
  const errors = [];
  app.on('will-quit',()=>appendFileSync(join(output,'lifecycle.jsonl'),JSON.stringify({phase:'will-quit',pid:process.pid,time:new Date().toISOString()})+'\n'));
  app.on('browser-window-created', (_event, win) => {
    const captures=new Set();let capturing=false;
    const captureTimer=setInterval(async()=>{
      if(capturing||win.isDestroyed())return;capturing=true;
      try{
        const phase=await win.webContents.executeJavaScript('document.body?.dataset.runtimeCapture||""');
        if(/^(question-multi|question-confirm|question-settled|question-cancelled|tool-expanded|tool-image-expanded|tool-image-collapsed|metadata-renamed|metadata-archived|metadata-restored)$/.test(phase)&&!captures.has(phase)){
          const png=(await win.webContents.capturePage()).toPNG();
          writeFileSync(join(output,phase+'.png'),png);writeFileSync(join(output,phase+'-'+process.pid+'.png'),png);captures.add(phase);
          await win.webContents.executeJavaScript('document.body.dataset.runtimeCaptured='+JSON.stringify(phase));
        }
      }catch{}finally{capturing=false;}
    },50);captureTimer.unref();win.once('closed',()=>clearInterval(captureTimer));
    win.once('closed',()=>appendFileSync(join(output,'lifecycle.jsonl'),JSON.stringify({phase:'window-closed',pid:process.pid,time:new Date().toISOString()})+'\n'));
    win.webContents.on('console-message', (_e, level, message) => { if(level >= 2) errors.push(message); });
    win.webContents.on('render-process-gone', (_e, details) => errors.push('renderer-gone:'+details.reason));
    win.webContents.once('did-finish-load', async () => {
      try {
        const checks = readFileSync(join(desktop,'test/support/renderer-runtime-checks.cjs'),'utf8').replace('module.exports = ', '');
        const resultPath=join(output,'runtime-result.json');
        const previous=existsSync(resultPath)?JSON.parse(readFileSync(resultPath,'utf8')):{};
        previous.questionTest=questionTest;
        previous.imageAttachmentId=imageAttachmentId;
        const result = await win.webContents.executeJavaScript('('+checks.trim().replace(/;$/, '')+')('+JSON.stringify(previous)+')');
        writeFileSync(join(output,'runtime.png'), (await win.webContents.capturePage()).toPNG());
        const preferences=win.webContents.getLastWebPreferences();
        const sandboxConfigured=preferences.sandbox===true && !app.commandLine.hasSwitch('no-sandbox') && !app.commandLine.hasSwitch('disable-gpu-sandbox');
        writeFileSync(join(output,'runtime-result.json'), JSON.stringify({...result,sandboxConfigured,errors,ok:errors.length===0&&sandboxConfigured},null,2));
        appendFileSync(join(output,'runs.jsonl'),JSON.stringify({...result,sandboxConfigured,errors,ok:errors.length===0&&sandboxConfigured,pid:process.pid})+'\n');
        if(closeAfterChecks)setTimeout(()=>win.close(),1500);
      } catch(error) {
        writeFileSync(join(output,'runtime-result.json'), JSON.stringify({ok:false,error:String(error),errors},null,2));
      }
    });
  });
  require(join(desktop,'main.cjs'));
};
