import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url);
const source=fileURLToPath(new URL('../renderer/pages/context-meter.ts',import.meta.url));
const bundle=await build({entryPoints:[source],bundle:true,write:false,platform:'node',format:'cjs',external:['vue'],logLevel:'silent'});
const module={exports:{}};
const vue=require('vue');
runInNewContext(bundle.outputFiles[0].text,{module,exports:module.exports,require:name=>name==='vue'?{...vue,onMounted:()=>{},onBeforeUnmount:()=>{}}:require(name)});
const {ContextMeter,contextOccupancy}=module.exports;

test('只有模型容量或错误压力时保持未知，不画 0% 或计费占用',()=>{
  for(const pressure of [undefined,{contextWindow:128000},{contextWindow:128000,projectedTokens:-1},{contextWindow:0,projectedTokens:12}]){
    assert.equal(contextOccupancy(pressure),null);
    const root=ContextMeter.setup({pressure})(),trigger=root.children[0],panel=root.children[1];
    assert.equal(trigger.props['aria-label'],'上下文用量尚未提供');
    assert.equal(trigger.children[0].children[1],null);
    assert.equal(panel.children[0].children[1].children,'待接入');
  }
});

test('真实压力与容量同时具备时呈现 K 数值和环形比例',()=>{
  const root=ContextMeter.setup({pressure:{contextWindow:128000,projectedTokens:32000}})();
  assert.equal(root.children[0].props['aria-label'],'上下文已用 25% · 32K / 128K');
  assert.equal(root.children[1].children[0].children[1].children,'25%');
  assert.equal(root.children[1].children[0].children[2].children,'~32K / 128K');
});
