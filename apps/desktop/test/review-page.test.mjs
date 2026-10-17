import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';

const entry=fileURLToPath(new URL('../renderer/pages/review-page.ts',import.meta.url));
const bundle=await build({entryPoints:[entry],bundle:true,write:false,format:'cjs',platform:'node',external:['vue']});
const module={exports:{}};
vm.runInNewContext(bundle.outputFiles[0].text,{module,exports:module.exports,require:createRequire(import.meta.url)});
const {ReviewPage}=module.exports;
const vue=createRequire(import.meta.url)('vue');

test('差异审查组合真实草稿和当前会话 Git 数据，并保留范围边界',()=>{
  const editor={state:{path:'src/a.cj'}};
  const status=async()=>({sessionId:'s1',directory:'D:/work',output:'',exitCode:0,truncated:false,failure:'',diagnostic:''});
  const diff=async(path,scope)=>({sessionId:'s1',directory:'D:/work',path,scope,output:'',exitCode:0,truncated:false,failure:'',diagnostic:''});
  const emitted=[];
  const render=ReviewPage.setup({editor,revision:3,sessionId:'s1',directory:'D:/work',configured:true,active:true,status,diff},{emit:(...args)=>emitted.push(args)});
  const root=render();
  assert.equal(root.type,'section');
  assert.match(root.children[1].children,/尚未将文件变化归属到具体 Agent 任务/);
  const editorNode=root.children[2],gitNode=root.children[3];
  assert.equal(editorNode.props.editor,editor);
  assert.equal(editorNode.props.revision,3);
  assert.equal(editorNode.props.diffOnly,true);
  assert.equal(gitNode.props.sessionId,'s1');
  assert.equal(gitNode.props.directory,'D:/work');
  assert.equal(gitNode.props.active,true);
  assert.equal(gitNode.props.status,status);
  assert.equal(gitNode.props.diff,diff);
  gitNode.props.onOpen('src/a.cj');
  gitNode.props.onBrowse('src/');
  gitNode.props.onChoose();
  assert.deepEqual(emitted,[['open','src/a.cj'],['browse','src/'],['choose']]);
});

test('仅在编辑器写后回读确认成功时通知 Git 差异页刷新',async()=>{
  const editor={state:{path:'src/a.cj',saveRevision:0}};
  const props=vue.reactive({editor,revision:3,sessionId:'s1',directory:'D:/work',configured:true,active:true,
    status:async()=>({sessionId:'s1',directory:'D:/work',output:'',exitCode:0,truncated:false,failure:'',diagnostic:''}),
    diff:async(path,scope)=>({sessionId:'s1',directory:'D:/work',path,scope,output:'',exitCode:0,truncated:false,failure:'',diagnostic:''})});
  const scope=vue.effectScope();
  const render=scope.run(()=>ReviewPage.setup(props,{emit:()=>{}}));
  try{
    assert.equal(render().children[3].props.refreshSignal,0);
    editor.state.saveRevision=1;props.revision++;
    await vue.nextTick();
    assert.equal(render().children[3].props.refreshSignal,1);
    props.revision++;
    await vue.nextTick();
    assert.equal(render().children[3].props.refreshSignal,1);
    editor.state.saveRevision=2;props.revision++;
    await vue.nextTick();
    assert.equal(render().children[3].props.refreshSignal,2);
  }finally{scope.stop();}
});
