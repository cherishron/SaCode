import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../host-bridge.cjs',import.meta.url),'utf8');
function fixture(){
 const children=[];
 const spawn=()=>{
  const child=new EventEmitter();child.exitCode=null;child.signalCode=null;child.pid=children.length+1;
  child.stdin=new EventEmitter();child.stdin.destroyed=false;child.stdin.writableEnded=false;
  child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.writes=[];
  child.callbacks=[];child.stdin.write=(body,done)=>{child.writes.push(body);if(child.delayWrites)child.callbacks.push(done);else done?.();};
  child.stdin.end=()=>{child.stdin.writableEnded=true;child.exitCode=0;child.emit('exit',0,null);};
  child.kill=()=>{child.signalCode='SIGTERM';child.emit('exit',null,'SIGTERM');};
  queueMicrotask(()=>child.emit('spawn'));children.push(child);return child;
 };
 const context={module:{exports:{}},require:name=>{assert.equal(name,'node:child_process');return{spawn};},process:{env:{},stderr:{write(){}}},setTimeout,clearTimeout};
 vm.runInNewContext(source,context);
 return{bridge:new context.module.exports.HostBridge('host'),children};
}
test('旧进程退出和管道错误不能打掉重启后的在途请求',async()=>{
 const {bridge,children}=fixture();await bridge.start('.');const old=children[0];
 await bridge.stop();await bridge.start('.');const current=children[1];
 const response=bridge.request('session/projection');
 old.emit('exit',1,null);old.stdin.emit('error',{code:'EPIPE'});
 current.stdout.emit('data',JSON.stringify({id:1,result:{ok:true}})+'\n');
 assert.equal((await response).ok,true);assert.equal(bridge.failure,null);await bridge.stop();
});
test('重启丢弃旧连接通知，旧 stdout 不能污染新报文缓冲',async()=>{
 const {bridge,children}=fixture();await bridge.start('.');const old=children[0];
 old.stdout.emit('data','{"method":"approval/asked","params":{"source":"model"}}\n');
 await bridge.stop();await bridge.start('.');
 assert.equal(bridge.notifications.length,0);
 old.stdout.emit('data','{"method":"old-event"');
 const response=bridge.request('session/projection');
 children[1].stdout.emit('data',JSON.stringify({id:1,result:{ok:true}})+'\n');
 assert.equal((await response).ok,true);assert.equal(bridge.buf,'');await bridge.stop();
});
test('活动连接不能被 start 替换而留下孤儿 Host',async()=>{
 const {bridge,children}=fixture();await bridge.start('.');
 await assert.rejects(async()=>bridge.start('.'),/host-already-running/);
 assert.equal(children.length,1);assert.equal(bridge.proc,children[0]);await bridge.stop();
});
test('当前连接真实断开仍须立即拒绝在途和后续请求',async()=>{
 const {bridge,children}=fixture();await bridge.start('.');
 const response=bridge.request('session/projection');children[0].exitCode=1;children[0].emit('exit',1,null);
 await assert.rejects(response,/host-gone: exit code 1/);
 await assert.rejects(bridge.request('session/projection'),/host-gone: exit code 1/);
 assert.equal(bridge.pending.size,0);await bridge.stop();
});
test('旧请求的迟到写错误不能打掉新连接请求',async()=>{
 const {bridge,children}=fixture();await bridge.start('.');const old=children[0];old.delayWrites=true;
 const failed=bridge.request('session/projection');
 const rejection=assert.rejects(failed,/host-gone/);await bridge.stop();await rejection;
 await bridge.start('.');const response=bridge.request('session/projection');
 old.callbacks[0]({code:'EPIPE'});
 children[1].stdout.emit('data',JSON.stringify({id:2,result:{ok:true}})+'\n');
 assert.equal((await response).ok,true);assert.equal(bridge.failure,null);await bridge.stop();
});
test('未创建进程的 spawn 错误允许显式重试，不重放旧请求',async()=>{
 const {bridge,children}=fixture();const first=bridge.start('.');const old=children[0];old.pid=undefined;
 old.emit('error',Error('ENOENT'));await assert.rejects(first,/ENOENT/);
 await bridge.start('.');assert.equal(children.length,2);assert.equal(children[1].writes.length,0);await bridge.stop();
});
