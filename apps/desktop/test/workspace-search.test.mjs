import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {mkdtempSync,mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
const require=createRequire(import.meta.url);
const {HostBridge}=require('../host-bridge.cjs');
const code=await build({entryPoints:[fileURLToPath(new URL('../renderer/pages/workspace-search-state.ts',import.meta.url))],bundle:true,write:false,format:'cjs'});
const ctx={module:{exports:{}}};vm.runInNewContext(code.outputFiles[0].text,ctx);
const {createWorkspaceSearch}=ctx.module.exports;
const file=name=>({name,isDir:false}),dir=name=>({name,isDir:true});
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return{promise,resolve};};

test('按相对路径搜索真实层级，跳过依赖目录而不读取正文',async()=>{
  const calls=[],tree={'':[dir('src'),dir('node_modules'),file('README.md')],src:[file('app.cj'),file('test.cj')]};
  const view=createWorkspaceSearch(async path=>{calls.push(path);return{files:tree[path]};},()=>{});
  await view.search('SRC/APP');assert.deepEqual(calls,['','src']);
  assert.equal(view.state.results.length,1);assert.equal(view.state.results[0].path,'src/app.cj');assert.equal(view.state.status,'done');
});

test('取消和新查询拒绝上一请求的迟到清单，卸载不继续扫描',async()=>{
  const pending=deferred();let count=0;
  const view=createWorkspaceSearch(()=>++count===1?pending.promise:Promise.resolve({files:[file('new.cj')]}),()=>{});
  const old=view.search('old');view.cancel();await view.search('new');pending.resolve({files:[file('old.cj'),dir('extra')]});await old;
  assert.equal(view.state.results.length,1);assert.equal(view.state.results[0].path,'new.cj');assert.equal(count,2);
  const wait=deferred();let notices=0;const other=createWorkspaceSearch(()=>wait.promise,()=>notices++),run=other.search('late');other.dispose();const before=notices;wait.resolve({files:[file('late')]});await run;assert.equal(notices,before);
});

test('扫描上限和目录失败保留部分结果，不冒充完整空结果',async()=>{
  const view=createWorkspaceSearch(async path=>{if(path==='bad')throw Error('denied');return{files:[file('hit.txt'),dir('bad'),dir('deep')]};},()=>{},{directories:2,entries:20,matches:10,depth:1});
  await view.search('hit');assert.equal(view.state.results.length,1);assert.equal(view.state.errors.length,1);assert.equal(view.state.status,'partial');assert.equal(view.state.limited,true);
  const invalid=createWorkspaceSearch(async()=>({files:[dir('../outside')]}),()=>{});await invalid.search('a');assert.equal(invalid.state.errors.length,1);assert.equal(invalid.state.directories,1);
});

test('达到结果上限时不继续递归，不含匹配的查询也受目录上限约束',async()=>{
  let calls=0;const list=async()=>{calls++;return{files:[dir('nested'),file('match-a'),file('match-b')]};};
  const view=createWorkspaceSearch(list,()=>{},{directories:3,entries:100,matches:1,depth:6});await view.search('match');assert.equal(calls,1);assert.equal(view.state.results.length,1);assert.equal(view.state.status,'limited');
  const other=createWorkspaceSearch(list,()=>{},{directories:3,entries:100,matches:10,depth:6});await other.search('none');assert.equal(other.state.directories,3);assert.equal(other.state.results.length,0);assert.equal(other.state.status,'limited');
});

test('真实 Host 回放已配置工作区后，目录搜索返回磁盘文件而非模拟清单',async()=>{
  const root=mkdtempSync(join(process.env.TEMP||'D:/Temp','sacode-search-'));
  const project=join(root,'project'),session=join(root,'session');mkdirSync(project);mkdirSync(session);mkdirSync(join(project,'src'));mkdirSync(join(project,'.git'));
  writeFileSync(join(project,'src','actual.cj'),'real filesystem fixture');writeFileSync(join(project,'.git','actual-hidden.cj'),'excluded');
  // 仅播种回放夹具，不测试 workspace/set-directory 的持久写入成功。
  writeFileSync(join(session,'session.log'),'0\tworkspace/directory\t'+project.replaceAll('\\','/')+'\n');
  const host=new HostBridge(process.env.SACODE_HOST||fileURLToPath(new URL('../dist/host/bin/sacode-host.exe',import.meta.url)),{...process.env,SACODE_USER_SETTINGS_DIR:join(root,'settings')});
  try{
    await host.start(session);assert.equal((await host.request('workspace/get')).configured,true);
    const view=createWorkspaceSearch(path=>host.request('workspace/files',{path}),()=>{});await view.search('actual');
    assert.equal(view.state.status,'done');assert.equal(view.state.results.length,1);assert.equal(view.state.results[0].path,'src/actual.cj');assert.equal(view.state.results[0].size,23);
  }finally{await host.stop();}
});
