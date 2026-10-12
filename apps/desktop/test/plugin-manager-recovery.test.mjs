// 只驱动产品适配器的清单读取，不启动 Host、插件安装或公共 vendor 构建。
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';

const compiled=await build({entryPoints:[fileURLToPath(new URL('../renderer/pages/plugin-manager-adapter.ts',import.meta.url))],bundle:true,write:false,format:'cjs'});
const context={module:{exports:{}},setTimeout,clearTimeout};
vm.runInNewContext(compiled.outputFiles[0].text,context);
const {createPluginManagerAdapter}=context.module.exports;
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
const tick=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
const inventory=(revision,enabled=false)=>({available:true,revision,packages:[{name:'local-plugin',installed:true,optional:false,enabled,rows:[]}]});
function fixture(describe,extra={}){
  let reads=0;const faces={describe:()=>{reads++;return describe(reads);},...extra};
  return{adapter:createPluginManagerAdapter(faces),reads:()=>reads};
}

test('启停后清单回读失败，下一次 read 必须重试而不是把旧缓存当成最新结果',async()=>{
  const f=fixture(async n=>{if(n===2)throw Error('describe-offline');return inventory(n,true);},{setEnabled:async()=>{}});
  try{
    await f.adapter.read();await f.adapter.dispatch({kind:'enable-package',name:'local-plugin',enabled:true});
    await assert.rejects(f.adapter.read(),/describe-offline/);
    await tick();const next=await f.adapter.read();assert.equal(f.reads(),3);assert.equal(next.packages[0].enabled,true);
  }finally{f.adapter.dispose();}
});
test('初次读取失败保留拒绝且释放在途状态，第二次读取可以成功',async()=>{
  const f=fixture(async n=>{if(n===1)throw Error('first-read-failed');return inventory(n);});
  try{await assert.rejects(f.adapter.read(),/first-read-failed/);await tick();assert.equal((await f.adapter.read()).available,true);assert.equal(f.reads(),2);}
  finally{f.adapter.dispose();}
});
test('坏清单整份拒收，随后重读不沿用旧修订',async()=>{
  const revisions=[];const f=fixture(async n=>n===2?{available:true,revision:2,packages:'broken'}:inventory(n),{setEnabled:async(_name,_enabled,revision)=>revisions.push(revision)});
  try{
    await f.adapter.read();await f.adapter.dispatch({kind:'enable-package',name:'local-plugin',enabled:true});
    await assert.rejects(f.adapter.read(),/plugin-inventory-rejected/);
    await tick();await f.adapter.read();assert.equal(f.reads(),3);
    await f.adapter.dispatch({kind:'enable-package',name:'local-plugin',enabled:true});assert.deepEqual(revisions,[1,3]);
  }finally{f.adapter.dispose();}
});
test('有旧缓存时并发 read 也必须等待同一趟刷新，不提前返回旧清单',async()=>{
  const wait=deferred();const f=fixture(n=>n===1?Promise.resolve(inventory(1)):wait.promise);
  try{
    await f.adapter.read();const refresh=f.adapter.dispatch({kind:'refresh'});let settled=false;
    const read=f.adapter.read().then(value=>{settled=true;return value;});await tick();
    assert.equal(settled,false);assert.equal(f.reads(),2);
    wait.resolve(inventory(2,true));await refresh;assert.equal((await read).packages[0].enabled,true);assert.equal(f.reads(),2);
  }finally{f.adapter.dispose();}
});
test('多个首次 read 共用一次 Host 读取，不因读取订阅重复发请求',async()=>{
  const wait=deferred(),f=fixture(()=>wait.promise);
  try{
    const a=f.adapter.read(),b=f.adapter.read(),c=f.adapter.read();await tick();assert.equal(f.reads(),1);
    wait.resolve(inventory(1));const values=await Promise.all([a,b,c]);assert.equal(values.length,3);assert.equal(f.reads(),1);
  }finally{f.adapter.dispose();}
});
test('显式刷新发生在读取在途时，仍须追加一次读取而不是丢掉刷新意图',async()=>{
  const wait=deferred(),f=fixture(n=>n===1?wait.promise:Promise.resolve(inventory(n,true)));
  try{
    const a=f.adapter.read(),refresh=f.adapter.dispatch({kind:'refresh'});wait.resolve(inventory(1));
    await refresh;assert.equal((await a).packages[0].enabled,true);assert.equal(f.reads(),2);
  }finally{f.adapter.dispose();}
});
test('刷新在途期间启停完成，旧读取不能吞掉变更后的重读',async()=>{
  const wait=deferred();let enabled=false;
  const f=fixture(n=>n===2?wait.promise:Promise.resolve(inventory(n,enabled)),{setEnabled:async()=>{enabled=true;}});
  try{
    await f.adapter.read();const refresh=f.adapter.dispatch({kind:'refresh'});
    await f.adapter.dispatch({kind:'enable-package',name:'local-plugin',enabled:true});
    wait.resolve(inventory(2,false));await refresh;const value=await f.adapter.read();
    assert.equal(value.packages[0].enabled,true);assert.equal(f.reads(),3);
  }finally{f.adapter.dispose();}
});
test('卸载后迟到读取拒绝，不修改重开后的清单和修订',async()=>{
  const wait=deferred(),revisions=[];
  const f=fixture(n=>n===1?wait.promise:Promise.resolve(inventory(n,true)),{setEnabled:async(_name,_enabled,revision)=>revisions.push(revision)});
  try{
    const old=f.adapter.read();const rejected=assert.rejects(old,/plugin-read-stale/);
    f.adapter.dispose();const reopened=f.adapter.read();wait.resolve(inventory(1,false));await rejected;
    assert.equal((await reopened).packages[0].enabled,true);
    assert.equal((await f.adapter.read()).packages[0].enabled,true);
    await f.adapter.dispatch({kind:'enable-package',name:'local-plugin',enabled:false});assert.deepEqual(revisions,[2]);
  }finally{f.adapter.dispose();}
});
test('无在途读取时重开保留已核缓存，不平白新增 Host 请求',async()=>{
  const f=fixture(async n=>inventory(n));
  try{await f.adapter.read();f.adapter.dispose();await f.adapter.read();assert.equal(f.reads(),1);}
  finally{f.adapter.dispose();}
});
test('并发读取失败交还每个调用方，重试后只发一趟新读取',async()=>{
  const wait=deferred(),f=fixture(n=>n===1?wait.promise:Promise.resolve(inventory(n)));
  try{
    const a=assert.rejects(f.adapter.read(),/shared-read-failed/),b=assert.rejects(f.adapter.read(),/shared-read-failed/);
    wait.reject(Error('shared-read-failed'));await Promise.all([a,b]);await tick();
    assert.equal(f.reads(),1);await f.adapter.read();assert.equal(f.reads(),2);
  }finally{f.adapter.dispose();}
});
test('旧实例失败清理不能清除重开实例正在等待的新读取',async()=>{
  const oldWait=deferred(),newWait=deferred(),f=fixture(n=>n===1?oldWait.promise:newWait.promise);
  try{
    const old=assert.rejects(f.adapter.read(),/old-host-failure/);f.adapter.dispose();
    const current=f.adapter.read();oldWait.reject(Error('old-host-failure'));await old;await tick();
    const joined=f.adapter.read();assert.equal(f.reads(),2);
    newWait.resolve(inventory(2,true));assert.equal((await current).packages[0].enabled,true);
    assert.equal((await joined).packages[0].enabled,true);assert.equal(f.reads(),2);
  }finally{f.adapter.dispose();}
});
