import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
const bundled=await build({entryPoints:[fileURLToPath(new URL('../renderer/pages/file-editor-state.ts',import.meta.url))],bundle:true,write:false,format:'cjs'});
const ctx={module:{exports:{}}};vm.runInNewContext(bundled.outputFiles[0].text,ctx);
const {createFileEditor,draftDiff}=ctx.module.exports;
test('保存审批收到审查过的路径和正文快照',async()=>{const f=fixture();let proposal;f.api.ask=async(path,text)=>{proposal={path,text};return{approvalId:1}};const e=createFileEditor(f.api,()=>{});await e.open('quoted name.txt');e.edit('中文 "正文"\n');e.review();await e.save();assert.deepEqual(proposal,{path:'quoted name.txt',text:'中文 "正文"\n'});assert.equal(f.disk,proposal.text);});
function fixture(){let disk='原始\n内容\n',writes=0,asks=0;const api={read:async()=>({result:disk}),ask:async()=>{asks++;return{approvalId:1}},answer:async()=>({accepted:true}),write:async(_p,text)=>{writes++;disk=text;return{result:'ok:fixture'}}};return{api,get disk(){return disk},set disk(v){disk=v},get writes(){return writes},get asks(){return asks}};}
test('审查之前不写盘，取消审查保留草稿，明确确认后才保存',async()=>{const f=fixture(),e=createFileEditor(f.api,()=>{});await e.open('a.txt');e.edit('修改\n正文');await e.save();assert.equal(f.writes,0);e.review();assert.equal(f.asks,0);e.cancelReview();assert.equal(e.state.draft,'修改\n正文');e.review();await e.save();assert.equal(f.writes,1);assert.equal(e.dirty(),false);assert.equal(f.disk,'修改\n正文');});
test('外部修改与审批拒绝都保留草稿，禁止覆盖',async()=>{for(const mode of ['conflict','denied']){const f=fixture(),e=createFileEditor(f.api,()=>{});await e.open('a.txt');e.edit('用户草稿');e.review();if(mode==='conflict')f.disk='外部新版本';else f.api.answer=async()=>({accepted:false});await e.save();assert.equal(f.writes,0);assert.equal(e.state.draft,'用户草稿');assert.ok(e.state.error);if(mode==='conflict')assert.equal(f.asks,0);}});
test('未保存文件不能被另一资源覆盖，截断与二进制不能整文件编辑',async()=>{const f=fixture(),e=createFileEditor(f.api,()=>{});await e.open('a.txt');e.edit('待保存');await e.open('b.txt');assert.equal(e.state.path,'a.txt');assert.equal(e.reset(),false);e.discard();assert.equal(e.reset(),true);for(const text of ['text\n[read-truncated:offset=0,lines=1/3]','a\0b','a'.repeat(65537)]){f.disk=text;await e.open('x');assert.equal(e.state.loaded,false);assert.ok(e.state.error);}});
test('切换读取与卸载丢弃迟到正文，失败不留旧文件',async()=>{let resolve;const api={...fixture().api,read:()=>new Promise(done=>resolve=done)};let changed=0;const e=createFileEditor(api,()=>changed++);const reading=e.open('a');e.dispose();const count=changed;resolve({result:'late'});await reading;assert.equal(e.state.loaded,false);assert.equal(changed,count);});
test('审批回执迟到且页面已卸载时，不启动写入',async()=>{const f=fixture();let resolve;f.api.answer=()=>new Promise(done=>resolve=done);const e=createFileEditor(f.api,()=>{});await e.open('a');e.edit('draft');e.review();const pending=e.save();while(!resolve)await new Promise(done=>setTimeout(done,0));e.dispose();resolve({accepted:true});await pending;assert.equal(f.writes,0);});
test('差异保留真实空行与行号，并限制大变更输出',()=>{const d=draftDiff('前\n旧\n后\n','前\n新\n后\n');assert.equal(d.removed,1);assert.equal(d.added,1);assert.equal(d.rows.find(r=>r.kind==='remove').old,2);assert.equal(d.rows.find(r=>r.kind==='add').next,2);assert.ok(draftDiff('x\n'.repeat(500),'y\n'.repeat(500)).rows.length<=200);assert.equal(draftDiff('same','same').added,0);});
test('真实 Host：一次审批保存空白与中文，外部冲突拒绝且磁盘不变',async()=>{
  const dir=mkdtempSync(fileURLToPath(new URL('../.tmp-test/editor-',import.meta.url)));const project=join(dir,'project');mkdirSync(project);const path=join(project,'actual.txt');writeFileSync(path,'初始正文\n');writeFileSync(join(dir,'session.log'),'');
  const {HostBridge}=createRequire(import.meta.url)('../host-bridge.cjs');const b=new HostBridge(process.env.SACODE_HOST||fileURLToPath(new URL('../dist/host/bin/sacode-host.exe',import.meta.url)),{...process.env,TEMP:dir,TMP:dir,SACODE_USER_SETTINGS_DIR:join(dir,'settings')});
  await b.start(dir);
  try{await b.request('workspace/set-directory',{directory:project});let race=false;const e=createFileEditor({read:path=>b.request('extension/call',{name:'read',args:JSON.stringify({path})}),ask:(path,content)=>b.request('approval/ask',{name:'write',args:JSON.stringify({path,content})}),answer:(id,decision)=>b.request('approval/answer',{approvalId:id,decision}),write:(relative,content,id)=>{if(race){race=false;writeFileSync(path,'审批期间外部修改');}return b.request('extension/call',{name:'write',args:JSON.stringify({path:relative,content}),approvalId:id});}},()=>{});
    await e.open('actual.txt');assert.equal(e.state.loaded,true);e.edit('  中文 空白\n\n结尾\n');e.review();await e.save();assert.equal(e.state.error,'');assert.equal(readFileSync(path,'utf8'),'  中文 空白\n\n结尾\n');e.edit('下一份草稿');e.review();writeFileSync(path,'第三方修改');await e.save();assert.match(e.state.error,/外部修改/);assert.equal(readFileSync(path,'utf8'),'第三方修改');assert.equal(e.state.draft,'下一份草稿');
    e.discard();await e.open('actual.txt');e.edit('不能覆盖');e.review();race=true;await e.save();assert.match(e.state.error,/fs-stale-version/);assert.equal(readFileSync(path,'utf8'),'审批期间外部修改');assert.equal(e.state.draft,'不能覆盖');
    e.discard();await e.open('actual.txt');e.edit('');e.review();await e.save();assert.equal(e.state.error,'');assert.equal(readFileSync(path,'utf8'),'');
  }finally{b.stop();}
});
