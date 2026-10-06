import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
const compiled=await build({entryPoints:[fileURLToPath(new URL('../renderer/pages/goal-bar.ts',import.meta.url))],bundle:true,write:false,format:'cjs',external:['vue']});
function fixture(){const mounts=[],unmounts=[];const vue={defineComponent:x=>x,ref:value=>({value}),h:(type,props,children)=>({type,props,children}),watch:()=>{},nextTick:()=>Promise.resolve(),onMounted:x=>mounts.push(x),onBeforeUnmount:x=>unmounts.push(x)};const ctx={module:{exports:{}},require:()=>vue,setInterval:()=>1,clearInterval:()=>{}};vm.runInNewContext(compiled.outputFiles[0].text,ctx);return{...ctx.module.exports,mounts,unmounts};}
const goal=(revision=1,phase='active')=>({id:'goal-1',revision,phase,objective:'验证前端',blockedReason:'',roundsDone:2,elapsedSeconds:9});
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return{promise,resolve};};
test('迟到读取不能覆盖保存结果，同帧双击只发一次 CAS',async()=>{const f=fixture(),read=deferred(),write=deferred();let calls=0;const s=f.createGoalSurface({describe:()=>read.promise,create:()=>{calls++;return write.promise;}},()=>{});const a=s.refresh(),b=s.mutate('create','正文');assert.equal(await s.mutate('create','重复'),false);assert.equal(calls,1);write.resolve(goal(2));await b;read.resolve(goal(1));await a;assert.equal(s.state.goal.revision,2);});
test('编辑从最新投影取修订，拒绝后保留原正文并允许重试',async()=>{const f=fixture();let expected;const s=f.createGoalSurface({describe:async()=>goal(7),edit:async(rev)=>{expected=rev;throw Error('stale-goal-revision');}},()=>{});await s.refresh();assert.equal(await s.mutate('edit','新正文'),false);assert.equal(expected,7);assert.equal(s.state.goal.objective,'验证前端');assert.match(s.state.error,/stale/);assert.equal(s.state.busy,false);});
test('卸载后迟到响应不更新，也不再提交变更',async()=>{const f=fixture(),read=deferred();let notices=0;const s=f.createGoalSurface({describe:()=>read.promise},()=>notices++);const pending=s.refresh();s.dispose();read.resolve(goal());await pending;assert.equal(s.state.goal,null);assert.equal(notices,0);assert.equal(await s.mutate('create','新目标'),false);});
test('空白目标在调用前拒绝',async()=>{const f=fixture();let calls=0;const s=f.createGoalSurface({create:async()=>{calls++;return goal();}},()=>{});assert.equal(await s.mutate('create',' \n '),false);assert.equal(calls,0);assert.match(s.state.error,/正文/);});
test('真实组件呈现状态、累计数和暂停/编辑/删除，明确自动驱动未接',async()=>{const f=fixture();const render=f.GoalBar.setup({adapter:{describe:async()=>goal()}});f.mounts[0]();for(let i=0;i<12;i++)await Promise.resolve();const tree=render();const text=JSON.stringify(tree);for(const label of ['验证前端','2 轮 · 9 秒','暂停','编辑','删除','自动跨轮执行尚未接通'])assert.ok(text.includes(label));assert.ok(!text.includes('完成目标'));f.unmounts[0]();});

test('目标编辑支持 Enter 保存、Shift+Enter 换行，IME 与长按不误提交',async()=>{
  const f=fixture();let saves=0;
  const render=f.GoalBar.setup({adapter:{describe:async()=>goal(),edit:async()=>{saves++;return goal(2);}}});
  f.mounts[0]();for(let i=0;i<12;i++)await Promise.resolve();
  render().children[0].children.find(v=>v.children==='编辑').props.onClick();
  const editor=render().children.find(v=>v?.type==='form').children[0].children[1];
  assert.equal(typeof editor.type,'object','目标应使用共享 InlineEditor');
  const input=editor.type.setup(editor.props,{emit:event=>editor.props['on'+event[0].toUpperCase()+event.slice(1)]?.()})();
  const key=extra=>({key:'Enter',preventDefault(){},stopPropagation(){},...extra});
  for(const extra of [{shiftKey:true},{isComposing:true},{keyCode:229},{repeat:true}])input.props.onKeydown(key(extra));
  assert.equal(saves,0);
  input.props.onKeydown(key({}));
  input.props.onKeydown(key({}));
  assert.equal(saves,1,'同帧按键保存只提交一次 CAS');
  for(let i=0;i<12;i++)await Promise.resolve();
  assert.equal(render().children.some(v=>v?.type==='form'),false);
  f.unmounts[0]();
});
