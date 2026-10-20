import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
const compiled=await build({entryPoints:[fileURLToPath(new URL('../../renderer/pages/user-question-card.ts',import.meta.url))],bundle:true,write:false,format:'cjs',external:['vue']});
const flatten=node=>Array.isArray(node)?node.flatMap(flatten):node&&typeof node==='object'?[node,...flatten(node.children)]:[];
const tick=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
function fixture(answer=async()=>({accepted:true})){
  const unmounts=[],calls=[];
  const vue={defineComponent:x=>x,h:(type,props,children)=>({type,props,children}),ref:value=>({value}),onBeforeUnmount:fn=>unmounts.push(fn)};
  const ctx={module:{exports:{}},require:()=>vue};vm.runInNewContext(compiled.outputFiles[0].text,ctx);
  const options=[{id:'a',label:'甲'},{id:'b',label:'乙'}];
  const props={sessionId:'s1',card:{id:'question-1',sessionId:'s1',status:'pending',questions:[{id:'single',question:'单选',type:'single',options,allowCustom:true},{id:'multi',question:'多选',type:'multi',options},{id:'confirm',question:'确认',type:'confirm'},{id:'text',question:'输入',type:'input'}]},answer:async(...args)=>{calls.push(args);return answer(...args);}};
  const render=ctx.module.exports.UserQuestionCard.setup(props);
  const nodes=()=>flatten(render());
  return {props,render,nodes,calls,unmounts,submit:()=>nodes().find(n=>n.type==='form').props.onSubmit({preventDefault(){}})};
}
function fill(f){
  const inputs=f.nodes().filter(n=>n.type==='input');
  inputs.find(n=>n.props.name==='question-1-single'&&n.props.value==='a').props.onChange({target:{checked:true}});
  inputs.find(n=>n.props.name==='question-1-multi'&&n.props.value==='a').props.onChange({target:{checked:true}});
  inputs.find(n=>n.props.name==='question-1-multi'&&n.props.value==='b').props.onChange({target:{checked:true}});
  inputs.find(n=>n.props.name==='question-1-confirm'&&n.props.value==='no').props.onChange({target:{checked:true}});
  f.nodes().filter(n=>n.type==='textarea').find(n=>n.props['aria-label'].startsWith('输入')).props.onInput({target:{value:'自定义正文'}});
}
test('单选、多选、确认与输入提交原会话，防止同帧重复提交',async()=>{
  let resolve;const f=fixture(()=>new Promise(r=>resolve=r));fill(f);f.submit();f.submit();
  assert.equal(f.calls.length,1);assert.equal(f.calls[0][0],'s1');assert.equal(f.calls[0][1],'question-1');
  const answers=JSON.parse(JSON.stringify(f.calls[0][2]));
  assert.deepEqual(answers[1].selectedIds,['a','b']);assert.deepEqual(answers[2].selectedIds,['no']);assert.equal(answers[3].text,'自定义正文');
  resolve({accepted:true});await tick();f.submit();assert.equal(f.calls.length,1);assert.match(JSON.stringify(f.render()),/已提交/);
});
test('取消无需填写答案，失败保留选择并呈现真实原因',async()=>{
  const cancelled=fixture();cancelled.nodes().find(n=>n.type==='button'&&n.children==='取消本次任务').props.onClick();await tick();
  assert.equal(cancelled.calls[0][3],true);assert.equal(cancelled.calls[0][2].length,0);
  const failed=fixture(async()=>{throw Error('question-invalid-selection');});fill(failed);failed.submit();await tick();
  assert.match(JSON.stringify(failed.render()),/question-invalid-selection/);
  assert.equal(failed.nodes().find(n=>n.type==='input'&&n.props.value==='a').props.checked,true);
});
test('其他会话、历史终态及卸载后不提交，迟到应答不污染新组件',async()=>{
  const f=fixture();fill(f);f.props.sessionId='s2';f.submit();assert.equal(f.calls.length,0);
  f.props.sessionId='s1';f.props.card.status='unknown';f.submit();assert.equal(f.calls.length,0);
  let resolve;const pending=fixture(()=>new Promise(r=>resolve=r));fill(pending);pending.submit();pending.unmounts[0]();
  const fresh=fixture();resolve({accepted:true});await tick();assert.doesNotMatch(JSON.stringify(fresh.render()),/已提交/);
  pending.submit();assert.equal(pending.calls.length,1);
});
