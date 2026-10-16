import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtempSync,mkdirSync,writeFileSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
const here=dirname(fileURLToPath(import.meta.url)),require=createRequire(import.meta.url);

test('真实 Electron：目标和队列的多行编辑、输入法、取消、尺寸与保存锁',{timeout:40000},async()=>{
  const base=join(here,'../../../target/tmp/inline-editor');mkdirSync(base,{recursive:true});
  const dir=mkdtempSync(join(base,'run-'));mkdirSync(join(dir,'user-data'));
  const result=await build({stdin:{contents:"export {GoalBar} from './goal-bar';export {QueueDock} from './queue-dock';",resolveDir:join(here,'../renderer/pages'),loader:'ts'},bundle:true,format:'iife',globalName:'EditorPages',outfile:join(dir,'pages.js'),metafile:true,plugins:[{name:'vue-runtime',setup(b){b.onResolve({filter:/^vue$/},()=>({path:'vue',namespace:'runtime'}));b.onLoad({filter:/.*/,namespace:'runtime'},()=>({contents:'module.exports=globalThis.Vue;',loader:'js'}));}}]});
  assert.ok(Object.keys(result.metafile.inputs).some(p=>p.endsWith('inline-editor.ts')),'两页产物必须包含共享编辑器');
  const file=p=>pathToFileURL(p).href;
  writeFileSync(join(dir,'fixture.css'),'body{margin:0;padding:24px;background:var(--surface-2);color:var(--text);font:13px/1.5 sans-serif}main{max-width:100%;margin:auto}.goal-root{margin-bottom:12px}');
  writeFileSync(join(dir,'fixture.html'),`<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self'"><link rel="stylesheet" href="${file(join(here,'../renderer/goal-bar.css'))}"><link rel="stylesheet" href="${file(join(here,'../renderer/product-design.css'))}"><link rel="stylesheet" href="${file(join(here,'../renderer/queue-dock.css'))}"><link rel="stylesheet" href="fixture.css"><div id="fixture"></div><script src="${file(join(here,'../renderer/vendor/vue.runtime.global.prod.js'))}"></script><script src="pages.js"></script><script src="checks.js"></script>`);
  writeFileSync(join(dir,'checks.js'),`(async()=>{
    const {createApp,h,nextTick}=Vue,checks=[];let edits=0,queued=0,release;
    const goal={id:'g',revision:1,phase:'active',objective:'验证长目标正文在窄窗下不能挤走暂停编辑删除按钮。'.repeat(8),roundsDone:0,elapsedSeconds:0,blockedReason:''};
    const app=createApp({render:()=>h('main',{},[h(EditorPages.GoalBar,{adapter:{describe:async()=>goal,edit:async(_,text)=>{edits++;await new Promise(done=>release=done);return {...goal,revision:2,objective:text};}}}),h(EditorPages.QueueDock,{rows:[{id:'q',content:[{type:'text',text:'排队原文'}]}],pending:[],mutable:true,updateQueue:async(_,action)=>{queued++;if(action.content[0].text!=='排队新文\\n第二行')throw Error('正文损坏');}})])});
    app.mount('#fixture');
    const wait=async()=>{await nextTick();await new Promise(done=>setTimeout(done,60));await nextTick();};
    const check=(value,label)=>{if(!value)throw Error(label);checks.push(label);};
    const key=(node,extra)=>node.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true,...extra}));
    await wait();
    window.__visualReady=true;while(!window.__visualCaptured)await new Promise(done=>setTimeout(done,30));
    const panel=document.querySelector('main');
    for(const width of [720,320]){
      panel.style.width=width+'px';await wait();
      const root=document.querySelector('.goal-root').getBoundingClientRect(),buttons=[...document.querySelectorAll('.goal-icon-action')].map(n=>n.getBoundingClientRect());
      check(buttons.length===3&&buttons.every(r=>r.left>=root.left&&r.right<=root.right),'目标图标在 '+width+'px 列内');
      check(buttons.every(r=>Math.abs(r.top-buttons[0].top)<1),'目标图标在 '+width+'px 同行');
      check(buttons[2].right>root.right-20,'删除图标靠右 '+width);
      check(document.querySelector('.goal-summary span').scrollWidth>document.querySelector('.goal-summary span').clientWidth,'长目标正文省略 '+width);
    }
    document.querySelector('.goal-summary').click();await wait();check(document.querySelector('.goal-objective').textContent===goal.objective,'展开完整长目标');
    document.querySelector('.goal-summary').click();await wait();check(!document.querySelector('.goal-objective'),'收起长目标');
    panel.style.width='720px';await wait();document.querySelector('.goal-header button:nth-last-child(2)').click();await wait();
    let input=document.querySelector('.goal-editor textarea');check(!!input,'目标多行编辑');check(document.activeElement===input,'目标自动聚焦');
    input.value='新目标\\n约束';input.dispatchEvent(new Event('input',{bubbles:true}));await wait();
    for(const extra of [{isComposing:true},{keyCode:229},{shiftKey:true},{repeat:true}])key(input,extra);
    await wait();check(edits===0,'IME、换行和长按不提交');
    key(input,{});key(input,{});await wait();check(edits===1&&input.readOnly,'保存锁只提交一次');release();await wait();check(!document.querySelector('.goal-editor textarea'),'保存成功关闭编辑');
    document.querySelector('.goal-header button:nth-last-child(2)').click();await wait();input=document.querySelector('.goal-editor textarea');
    input.value='长文 '.repeat(120);input.dispatchEvent(new Event('input',{bubbles:true}));await wait();
    input.style.width='500px';await wait();const wide=parseFloat(input.style.height);input.style.width='150px';await wait();check(parseFloat(input.style.height)>wide,'变窄自动增高 '+JSON.stringify({wide,height:input.style.height,width:input.clientWidth,scroll:input.scrollHeight}));check(input.clientHeight<=160,'长文高度有界');
    key(input,{key:'Escape'});await wait();check(!document.querySelector('.goal-editor textarea')&&edits===1,'Escape 不保存且取消');
    document.querySelector('button[aria-label="编辑排队消息"]').click();await wait();input=document.querySelector('.queue-editor');check(document.activeElement===input,'队列自动聚焦');
    input.value='排队新文\\n第二行';input.dispatchEvent(new Event('input',{bubbles:true}));await wait();key(input,{isComposing:true});await wait();check(queued===0,'队列 IME 不误提交');key(input,{});await wait();check(queued===1&&!document.querySelector('.queue-editor'),'队列保存完整多行');
    app.unmount();check(!document.querySelector('textarea'),'卸载清理编辑器');window.__result={ok:true,checks};
  })().catch(error=>{window.__result={ok:false,error:String(error.stack||error)};});`);
  writeFileSync(join(dir,'main.cjs'),`const {app,BrowserWindow,nativeTheme}=require('electron');const {writeFileSync}=require('node:fs');
    app.setPath('userData',${JSON.stringify(join(dir,'user-data'))});
    app.whenReady().then(async()=>{const win=new BrowserWindow({show:false,width:900,height:700,webPreferences:{backgroundThrottling:false,offscreen:true}});await win.loadFile(${JSON.stringify(join(dir,'fixture.html'))});
      const end=Date.now()+25000;let captured=false;while(Date.now()<end){
        if(!captured&&await win.webContents.executeJavaScript('window.__visualReady===true')){
          const colors=[];
          for(const theme of ['light','dark']){nativeTheme.themeSource=theme;
            for(const width of [720,320]){await win.webContents.executeJavaScript('document.querySelector("main").style.width="'+width+'px"');await new Promise(done=>setTimeout(done,100));
              colors.push({theme,width,background:await win.webContents.executeJavaScript('getComputedStyle(document.body).backgroundColor')});
              writeFileSync(${JSON.stringify(dir)}+'/'+theme+'-'+width+'.png',(await win.webContents.capturePage()).toPNG());
            }
          }
          if(colors[0].background===colors[2].background)throw Error('亮暗主题背景未变化');
          writeFileSync(${JSON.stringify(dir)}+'/visual-proof.json',JSON.stringify(colors,null,2));
          nativeTheme.themeSource='light';captured=true;await win.webContents.executeJavaScript('window.__visualCaptured=true');
        }
const result=await win.webContents.executeJavaScript('window.__result');if(result){console.log('EDITOR_RESULT '+JSON.stringify(result));app.exit(result.ok?0:1);return;}await new Promise(done=>setTimeout(done,100));}console.error('编辑器验收超时');app.exit(1);
    }).catch(error=>{console.error(error);app.exit(1);});`);
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
  const child=spawn(require('electron'),['--no-sandbox','--disable-gpu','--user-data-dir='+join(dir,'user-data'),join(dir,'main.cjs')],{env,windowsHide:true});
  let output='';child.stdout.on('data',data=>output+=data);child.stderr.on('data',data=>output+=data);
  const timeout=setTimeout(()=>child.kill(),30000);
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);}).finally(()=>clearTimeout(timeout));
  assert.equal(code,0,output);const line=output.split(/\r?\n/).find(line=>line.startsWith('EDITOR_RESULT '));assert.ok(line,output);
  const record=JSON.parse(line.slice(14));assert.equal(record.ok,true);assert.equal(record.checks.length,22,output);console.log('目标栏截图目录：'+dir);
});
