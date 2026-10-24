// 工具卡复制按钮验收：展开后结果区底部有"复制结果"按钮，
// 点击后写剪贴板并短暂显示"已复制"；全失败时显示"复制失败"；
// 降级异常时 textarea 在 finally 中移除。
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {readFileSync} from 'node:fs';

const compiled=await build({entryPoints:[fileURLToPath(new URL('../renderer/pages/tool-card.ts',import.meta.url))],bundle:true,write:false,format:'cjs',external:['vue']});
const tick=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};

function fixture(opts={}){
  const{clipboard=true,execOk=true,execThrows=false}=opts;
  const vue={defineComponent:x=>x,ref:v=>({value:v}),h:(type,props,children)=>({type,props,children})};
  const stateDot={StateDot:{name:'StateDot',setup:()=>()=>({type:'span',props:{class:'state-dot'},children:[]})}};
  const writes=[];
  const appended=[],removed=[];
  const nav=clipboard?{clipboard:{writeText:async t=>{writes.push(t);}}}:{};
  const ctx={
    module:{exports:{}},
    require:m=>m==='vue'?vue:m.includes('state-dot')?stateDot:{},
    navigator:nav,
    document:{
      createElement:()=>({
        style:{},value:'',
        select(){if(execThrows)throw new Error('select failed');},
      }),
      body:{
        appendChild(n){appended.push(n);},
        removeChild(n){removed.push(n);return n;},
      },
      execCommand(){return execOk;},
    },
    setTimeout:(fn,ms)=>{return ms;},
    clearTimeout(){},
  };
  const foldContext={window:{}};
  vm.runInNewContext(readFileSync(new URL('../renderer/msgfold.js',import.meta.url),'utf8'),foldContext);
  ctx.SaCodeMsgFold=foldContext.window.SaCodeMsgFold;
  vm.runInNewContext(compiled.outputFiles[0].text,ctx);
  const ToolCard=ctx.module.exports.ToolCard;
  const setup=ToolCard.setup({message:opts.message||{id:'msg-1',content:'工具执行成功：3 个文件已更新',toolCall:{id:'call-1',callId:'c1',name:'edit_file',arguments:'{"path":"a.txt"}',status:'completed',result:'工具执行成功：3 个文件已更新'}}});
  return{setup,writes,appended,removed};
}

function flatten(tree){if(Array.isArray(tree))return tree.flatMap(flatten);if(!tree||typeof tree!=='object')return[];return[tree,...flatten(tree.children)];}
const text=tree=>Array.isArray(tree)?tree.map(text).join(''):tree&&typeof tree==='object'?text(tree.children):typeof tree==='string'?tree:'';

async function expandAndCopy(setup){
  const tree1=setup();
  const toggle=flatten(tree1).find(n=>n.props?.class==='tool-toggle');
  toggle.props.onClick();
  await tick();
  const tree2=setup();
  const copyBtn=flatten(tree2).find(n=>n.type==='button'&&text(n)==='复制结果');
  assert.ok(copyBtn,'展开后应有"复制结果"按钮');
  await copyBtn.props.onClick();
  await tick();
  return setup();
}

test('抓取卡默认内联前500字，展开还原正文且保留不可信与HTTP状态',()=>{
  const content=JSON.stringify({result:{externalContent:true,url:'https://example.com',status:404,body:'字'.repeat(501)+'<script>外部文本</script>'}});
  const {setup}=fixture({message:{id:'web-1',content,toolCall:{id:'c',callId:'c',name:'web_fetch',status:'completed',arguments:'{"url":"https://example.com"}'}}});
  let tree=setup();assert.match(text(tree),/网页抓取/);assert.match(text(tree),/HTTP 404/);assert.match(text(tree),/外部不可信/);
  assert.equal(flatten(tree).find(n=>n.props?.class==='tool-body').children,'字'.repeat(500)+'…');
  flatten(tree).find(n=>n.props?.class==='tool-toggle').props.onClick();tree=setup();
  assert.match(text(tree),/<script>外部文本<\/script>/);assert.ok(!flatten(tree).some(n=>n.props?.innerHTML));
});
test('搜索卡内联查询及来源标题URL摘要日期，危险来源只作文本不提供可执行链接',()=>{
  const content=JSON.stringify({externalContent:true,sources:[{url:'javascript:alert(1)',title:'<img src=x>',snippet:'合成摘要',publishedAt:'2026-10-21'}],content:'搜索正文'});
  const {setup}=fixture({message:{content,toolCall:{name:'web_search',status:'completed',arguments:'{"queries":["仓颉 SDK"]}'}}});
  const tree=setup();for(const value of ['网络搜索','仓颉 SDK','<img src=x>','合成摘要','2026-10-21','搜索正文'])assert.ok(text(tree).includes(value));
  assert.ok(!flatten(tree).some(n=>n.type==='a'||n.type==='img'||n.props?.innerHTML));
});

test('展开后结果区底部有复制结果按钮',async()=>{
  const{setup}=fixture();
  const tree1=setup();
  const toggle=flatten(tree1).find(n=>n.props?.class==='tool-toggle');
  toggle.props.onClick();
  await tick();
  const tree2=setup();
  const buttons=flatten(tree2).filter(n=>n.type==='button');
  const copyBtn=buttons.find(n=>text(n)==='复制结果');
  assert.ok(copyBtn,'展开后应有"复制结果"按钮');
  assert.match(copyBtn.props.class,/btn-copy/);
});

test('点击复制结果写入剪贴板并显示已复制',async()=>{
  const{setup,writes}=fixture({clipboard:true});
  const tree3=await expandAndCopy(setup);
  assert.equal(writes.length,1,'应调用 clipboard.writeText 一次');
  assert.equal(writes[0],'工具执行成功：3 个文件已更新','复制的应是结果正文');
  const copiedBtn=flatten(tree3).find(n=>n.type==='button'&&text(n)==='已复制');
  assert.ok(copiedBtn,'复制后按钮应显示"已复制"');
  assert.equal(copiedBtn.props['data-copy-state'],'copied');
});

test('无 clipboard API 时退化到 execCommand 兜底并显示已复制',async()=>{
  const{setup}=fixture({clipboard:false,execOk:true});
  const tree3=await expandAndCopy(setup);
  assert.ok(flatten(tree3).some(n=>n.type==='button'&&text(n)==='已复制'),'兜底路径也应显示已复制');
});

test('clipboard+降级均失败时显示复制失败',async()=>{
  const{setup}=fixture({clipboard:false,execOk:false});
  const tree3=await expandAndCopy(setup);
  const failedBtn=flatten(tree3).find(n=>n.type==='button'&&text(n)==='复制失败');
  assert.ok(failedBtn,'全失败时应显示"复制失败"');
  assert.equal(failedBtn.props['data-copy-state'],'failed');
});

test('降级异常时 textarea 在 finally 中移除',async()=>{
  const{setup,appended,removed}=fixture({clipboard:false,execThrows:true});
  // copyResult 会传播异常（finally 只保证清理，不吞异常）
  const tree1=setup();
  const toggle=flatten(tree1).find(n=>n.props?.class==='tool-toggle');
  toggle.props.onClick();
  await tick();
  const tree2=setup();
  const copyBtn=flatten(tree2).find(n=>n.type==='button'&&text(n)==='复制结果');
  await copyBtn.props.onClick().catch(()=>{});
  await tick();
  assert.equal(appended.length,1,'应 appendChild 一次');
  assert.equal(removed.length,1,'应 removeChild 一次（finally 保证，即使 select 抛异常）');
  assert.equal(appended[0],removed[0],'移除的应是同一个 textarea');
});

test('工具调用展开控件是折叠图标而非中文文字，随状态切换 chevron',()=>{
  const{setup}=fixture();
  const find=()=>flatten(setup()).find(n=>n.props?.class==='tool-toggle');
  const path=()=>flatten(find()).find(n=>n.type==='path')?.props?.d;
  const folded=find();
  assert.ok(flatten(folded).some(n=>n.type==='svg'),'控件应是 svg 折叠图标');
  assert.equal(text(folded),'','控件不应再有中文文字节点');
  assert.equal(folded.props['aria-label'],'展开');
  assert.equal(folded.props['aria-expanded'],false);
  assert.equal(path(),'M3.5 6L8 10.5L12.5 6','折叠态为 chevron-down');
  folded.props.onClick();
  const expanded=find();
  assert.equal(expanded.props['aria-label'],'收起');
  assert.equal(expanded.props['aria-expanded'],true);
  assert.equal(path(),'M3.5 10.5L8 6L12.5 10.5','展开态为 chevron-up');
});
