import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const { HostBridge }=require('../host-bridge.cjs');
const host=process.env.DSH_HOST || resolve('dist/host/bin/dsh-host.exe');
function fixture(){
  const root=mkdtempSync(join(tmpdir(),'sacode-global-appearance-'));
  const settings=join(root,'用户配置');
  const env={...process.env,SACODE_USER_SETTINGS_DIR:settings,DSH_PROVIDER_BASE_URL:''};
  return {root,settings,env};
}
async function start(root,name,env){
  const session=join(root,name);mkdirSync(session);
  writeFileSync(join(session,'session.log'),'0\tuser/message\t中文任务\n');
  const bridge=new HostBridge(host,env);await bridge.start(session);
  return {bridge,session};
}
test('两个 Host 共享用户外观，跨会话与重启恢复且不覆盖另一字段',async()=>{
  const f=fixture(),a=await start(f.root,'甲',f.env),b=await start(f.root,'乙',f.env);
  try{
    const init=await a.bridge.request('initialize');
    for(const method of ['global/appearance/get','global/appearance/set-theme','global/appearance/set-font-size'])assert.ok(init.capabilities.includes(method));
    assert.deepEqual(await a.bridge.request('global/appearance/get'),{theme:'system',fontSize:14,scope:'user'});
    assert.equal((await a.bridge.request('global/appearance/set-font-size',{fontSize:22})).saved,true);
    assert.equal((await b.bridge.request('global/appearance/set-theme',{theme:'light'})).fontSize,22);
    assert.equal((await a.bridge.request('global/appearance/get')).theme,'light');
    const child=await a.bridge.request('session/create',{title:'第二个会话'});
    await a.bridge.request('session/select',{sessionId:child.id});
    assert.equal((await a.bridge.request('global/appearance/get')).fontSize,22);
    assert.equal((await b.bridge.request('session/projection')).messages.length,1);
    assert.doesNotMatch(readFileSync(join(b.session,'session.log'),'utf8'),/settings\//);
  }finally{await a.bridge.stop();await b.bridge.stop();}
  const fresh=await start(f.root,'重启',f.env);
  try{assert.deepEqual(await fresh.bridge.request('global/appearance/get'),{theme:'light',fontSize:22,scope:'user'});}
  finally{await fresh.bridge.stop();}
});
test('字体数值校验拒绝小数、字符串、布尔及越界，重复写不改配置',async()=>{
  const f=fixture(),a=await start(f.root,'输入校验',f.env);
  try{
    for(const fontSize of [9,23,14.5,'14',true,null])await assert.rejects(()=>a.bridge.request('global/appearance/set-font-size',{fontSize}),/bad-font-size/);
    assert.equal(existsSync(f.settings),false);
    await a.bridge.request('global/appearance/set-font-size',{fontSize:10});
    const path=join(f.settings,'user-settings.log'),before=readFileSync(path,'utf8');
    assert.equal((await a.bridge.request('global/appearance/set-font-size',{fontSize:10})).changed,false);
    assert.equal(readFileSync(path,'utf8'),before);
    await assert.rejects(()=>a.bridge.request('global/appearance/set-theme',{theme:'invalid'}),/bad-global-appearance-params/);
  }finally{await a.bridge.stop();}
});
test('会话写租约和损坏会话不会阻塞独立全局设置',async()=>{
  const f=fixture(),a=await start(f.root,'会话写者',f.env),b=await start(f.root,'损坏会话',f.env);
  try{
    await a.bridge.request('session/submit',{eventType:'user/message',data:'待保存'});
    assert.equal((await a.bridge.request('global/appearance/set-font-size',{fontSize:18})).saved,true);
    await b.bridge.stop();writeFileSync(join(b.session,'session.log'),'not-a-session\n');
    const broken=new HostBridge(host,f.env);await broken.start(b.session);
    try{assert.equal((await broken.request('global/appearance/get')).fontSize,18);}
    finally{await broken.stop();}
  }finally{await a.bridge.stop();await b.bridge.stop();}
});
test('配置损坏和配置租约均显式拒绝且保留原始文件',async()=>{
  const f=fixture(),a=await start(f.root,'拒绝写入',f.env);
  try{
    await a.bridge.request('global/appearance/set-font-size',{fontSize:18});
    const path=join(f.settings,'user-settings.log'),before=readFileSync(path,'utf8');
    writeFileSync(path+'.lease',`writer=${process.pid}-test-owner`);
    await assert.rejects(()=>a.bridge.request('global/appearance/set-theme',{theme:'dark'}),/settings-already-owned/);
    assert.equal(readFileSync(path,'utf8'),before);
    // 活进程凭据只由测试自身清理，不让配置写者夺取。
    require('node:fs').unlinkSync(path+'.lease');
    writeFileSync(path,'0\tsettings/font-size\t99\n');
    await assert.rejects(()=>a.bridge.request('global/appearance/get'),/settings-replay-rejected/);
    await assert.rejects(()=>a.bridge.request('global/appearance/set-font-size',{fontSize:20}),/settings-replay-rejected/);
    assert.equal(readFileSync(path,'utf8'),'0\tsettings/font-size\t99\n');
  }finally{await a.bridge.stop();}
});
test('显式用户设置目录必须为绝对路径，不跟随 Host 会话 cwd',async()=>{
  const f=fixture(),a=await start(f.root,'错误目录',{...f.env,SACODE_USER_SETTINGS_DIR:'相对配置'});
  try{
    await assert.rejects(()=>a.bridge.request('global/appearance/get'),/settings-root-not-absolute/);
    assert.equal(existsSync(join(a.session,'相对配置')),false);
  }finally{await a.bridge.stop();}
});
test('默认配置根目录由用户主目录解析，缺失用户主目录时拒绝回退 cwd',async()=>{
  const f=fixture(),home=join(f.root,'主目录');
  const a=await start(f.root,'默认目录',{...f.env,SACODE_USER_SETTINGS_DIR:'',USERPROFILE:'',HOME:home});
  try{
    await a.bridge.request('global/appearance/set-theme',{theme:'dark'});
    assert.match(readFileSync(join(home,'.sacode','user','user-settings.log'),'utf8'),/settings\/theme\tdark/);
    assert.equal(existsSync(join(a.session,'.sacode')),false);
  }finally{await a.bridge.stop();}
  const b=await start(f.root,'无主目录',{...f.env,SACODE_USER_SETTINGS_DIR:'',USERPROFILE:'',HOME:''});
  try{await assert.rejects(()=>b.bridge.request('global/appearance/get'),/settings-home-unavailable/);}
  finally{await b.bridge.stop();}
});
