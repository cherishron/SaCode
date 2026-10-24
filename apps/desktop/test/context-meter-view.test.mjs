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
const {ContextMeter,contextOccupancy,contextReading}=module.exports;
const render=pressure=>ContextMeter.setup({pressure})();

test('两侧都没有读数时不渲染控件，不画 0% 或计费占用',()=>{
  for(const pressure of [undefined,{},{contextWindow:0},{projectedTokens:-1},{contextWindow:-5,projectedTokens:-1}]){
    assert.equal(contextReading(pressure),null);
    assert.equal(render(pressure),null);
  }
});

test('只有模型容量时如实报容量，不编造用量与比例',()=>{
  const reading=contextReading({contextWindow:128000});
  assert.equal(reading.percent,undefined);
  assert.equal(reading.usedTokens,undefined);
  const root=render({contextWindow:128000}),trigger=root.children[0],panel=root.children[1];
  assert.equal(trigger.props['aria-label'],'上下文容量 128K · 用量未提供');
  assert.equal(trigger.children[0].children[1],null,'未知用量不得画填充环');
  assert.equal(panel.children[0].children[1].children,'—');
  assert.equal(panel.children[0].children[2].children,'容量 128K · 用量未提供');
  assert.equal(panel.children[1],null,'未知比例不得画占用条');
  assert.ok(panel.children.some(node=>node&&node.children==='暂未获得当前上下文用量；数据可用后会显示占用比例。'));
});

test('只有真实用量时呈现用量并明确容量未知，不伪造百分比',()=>{
  const root=render({projectedTokens:12659}),trigger=root.children[0],panel=root.children[1];
  assert.equal(contextOccupancy({projectedTokens:12659}),null,'没有分母就没有比例');
  assert.equal(trigger.props['aria-label'],'上下文已用 ~12.7K · 容量未提供');
  assert.equal(trigger.children[0].children[1],null);
  assert.equal(panel.children[0].children[1].children,'—');
  assert.equal(panel.children[0].children[2].children,'~12.7K · 容量未提供');
  assert.equal(panel.children[1],null);
  assert.ok(panel.children.some(node=>node&&String(node.children).includes('模型容量未提供')));
});

test('真实压力与容量同时具备时呈现 K 数值和环形比例',()=>{
  const root=render({contextWindow:128000,projectedTokens:32000});
  assert.equal(root.children[0].props['aria-label'],'上下文已用 25% · 32K / 128K');
  assert.equal(root.children[1].children[0].children[1].children,'25%');
  assert.equal(root.children[1].children[0].children[2].children,'~32K / 128K');
});
