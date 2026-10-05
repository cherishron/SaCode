import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../renderer/conversation-scroll.js',import.meta.url),'utf8');
function fixture(){
 const callbacks=new Map(),events=new Map();let id=0;
 const node={scrollTop:0,scrollHeight:1000,clientHeight:200,dataset:{},children:[],parentElement:{style:{setProperty(){}}},querySelector:()=>null,querySelectorAll:()=>[],getBoundingClientRect:()=>({top:0}),addEventListener:(type,cb)=>events.set(type,cb),removeEventListener:type=>events.delete(type)};
 const root={};vm.runInNewContext(source,{window:root,requestAnimationFrame:cb=>{callbacks.set(++id,cb);return id},cancelAnimationFrame:n=>callbacks.delete(n),ResizeObserver:class{observe(){}disconnect(){}}});
 const owner=root.SaCodeConversationScroll.attach(node,{session:'test',lastUser:'u1'});
 const flush=()=>{for(const [key,cb] of [...callbacks]){callbacks.delete(key);cb();}};
 flush();return {node,owner,events,flush};
}
test('布局定位待执行时，延迟自动滚动不应解除尾部跟随',()=>{
 const {node,owner,events,flush}=fixture();assert.equal(node.scrollTop,800);
 owner.update({session:'test',lastUser:'u2'});
 // 草稿收缩导致浏览器先夹紧位置，正文展开随后扩大底部；scroll 事件晚于布局变化到达。
 node.scrollTop=600;node.scrollHeight=1800;events.get('scroll')();
 flush();assert.equal(node.dataset.followingTail,'true');assert.equal(node.scrollTop,1600);
 owner.dispose();
});
test('用户滚轮撤销待执行定位，仍能上翻并保持阅读位置',()=>{
 const {node,owner,events,flush}=fixture();owner.update({session:'test',lastUser:'u1'});
 events.get('wheel')();node.scrollTop=100;events.get('scroll')();flush();
 assert.equal(node.dataset.followingTail,'false');assert.equal(node.scrollTop,100);owner.dispose();
});
