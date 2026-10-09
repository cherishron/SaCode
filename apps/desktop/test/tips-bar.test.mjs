import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url);
const source=fileURLToPath(new URL('../renderer/pages/tips-bar.ts',import.meta.url));
const bundle=await build({entryPoints:[source],bundle:true,write:false,platform:'node',format:'cjs',external:['vue'],logLevel:'silent'});
const module={exports:{}};
const vue=require('vue');
runInNewContext(bundle.outputFiles[0].text,{module,exports:module.exports,require:name=>name==='vue'?vue:require(name)});
const {TipsBar}=module.exports;
const render=(entry,extra={})=>TipsBar.setup({entry,onDismiss:()=>{},...extra})();

test('没有提醒或正文为空时不占位',()=>{
  for(const entry of [null,undefined,{kind:'startup',text:'',reliable:false}]){
    assert.equal(render(entry),null);
  }
});

test('启动提醒以 note 呈现正文，并带一个关掉两个入口的按钮',()=>{
  const node=render({kind:'startup',text:'把文件路径直接写进消息，我会读取。',reliable:false});
  assert.equal(node.props.class,'tips-bar tips-bar-startup');
  assert.equal(node.props.role,'note');
  assert.equal(node.props['aria-live'],'polite');
  assert.equal(node.props['data-tips-reliable'],'false');
  const [mark,text,hide]=node.children;
  assert.equal(mark.props['aria-hidden'],'true');
  assert.equal(text.children,'把文件路径直接写进消息，我会读取。');
  assert.equal(hide.props.type,'button');
  assert.equal(hide.props['aria-label'],'不再显示使用提醒');
  assert.equal(hide.children,'不再提醒');
  let fired=0;
  TipsBar.setup({entry:{kind:'startup',text:'x',reliable:false},onDismiss:()=>{fired+=1;}})().children[2].props.onClick();
  assert.equal(fired,1);
});

test('容量提醒标注为 context 类并如实带上读数是否可靠',()=>{
  const node=render({kind:'context',text:'上下文已用 96%，请尽快压缩。',reliable:true});
  assert.equal(node.props['data-tips-kind'],'context');
  assert.equal(node.props['data-tips-reliable'],'true');
  assert.equal(node.children[0].children,'!');
});

test('保存偏好期间关掉按钮，避免连点写两遍',()=>{
  const node=render({kind:'startup',text:'x',reliable:false},{busy:true});
  assert.equal(node.children[2].props.disabled,true);
});
