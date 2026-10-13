import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
const {HostBridge}=createRequire(import.meta.url)('../host-bridge.cjs');

test('CLI真实模式命令与Host共用会话事实及写租约',{timeout:30000},async t=>{
  assert.ok(process.env.SACODE_CLI,'需要本批构建的CLI');assert.ok(process.env.SACODE_HOST,'需要本批Host');
  const dir=mkdtempSync(join(tmpdir(),'sacode-mode-dual-'));
  const bridge=new HostBridge(process.env.SACODE_HOST,{...process.env,SACODE_USER_SETTINGS_DIR:join(dir,'settings')});
  t.after(()=>bridge.stop());await bridge.start(dir);
  await bridge.request('approval/set-mode',{mode:'plan'});
  const cli=(...args)=>spawnSync(process.env.SACODE_CLI,args,{cwd:dir,env:process.env,encoding:'utf8',windowsHide:true,timeout:10000});
  const read=cli('mode','get');assert.equal(read.status,0,read.stderr);assert.deepEqual(JSON.parse(read.stdout),{ok:true,mode:'plan'});
  const before=readFileSync(join(dir,'session.log'),'utf8');
  const busy=cli('mode','set','yolo');assert.equal(busy.status,5,busy.stderr);assert.equal(readFileSync(join(dir,'session.log'),'utf8'),before);
  await bridge.stop();
  for(const args of [['mode','set','invalid'],['mode','set'],['mode','get','extra']]){const rejected=cli(...args);assert.equal(rejected.status,64,rejected.stderr);}
  assert.equal(readFileSync(join(dir,'session.log'),'utf8'),before);
  const saved=cli('mode','set','build');assert.equal(saved.status,0,saved.stderr);assert.deepEqual(JSON.parse(saved.stdout),{ok:true,result:'committed'});
  const again=cli('mode','set','build');assert.equal(again.status,0,again.stderr);assert.deepEqual(JSON.parse(again.stdout),{ok:true,result:'noop'});
  await bridge.start(dir);assert.deepEqual(await bridge.request('approval/get-mode'),{ok:true,mode:'build'});
});
