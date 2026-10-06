// 模型中心四页测试：槽位注册、纯函数校验、代码安全（无 eval/动态 import/localStorage）。
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';

const here=dirname(fileURLToPath(import.meta.url));
const pages=join(here,'..','renderer','pages');
const bundle=async(fn)=>{const r=await build({entryPoints:[join(pages,fn)],bundle:true,write:false,format:'cjs',logLevel:'warning'});return r.outputFiles[0].text;};
const run=async(code)=>{const ctx={module:{exports:{}},queueMicrotask,AggregateError,console,URL};vm.runInNewContext(code,ctx);return ctx.module.exports;};
const read=fn=>readFileSync(join(pages,fn),'utf8');

// --- 槽位注册测试 ---
test('createModelCenterAssembly 注册四页到 model-center.tab 列表槽位',async()=>{
  const code=await bundle('client-slots.ts');
  const {SlotCore,ClientScope,createModelCenterAssembly}=await run(code);
  const asm=createModelCenterAssembly();
  const slots=asm.slots;
  // root 已声明
  assert.equal(slots.declaration('root').spec.kind,'single');
  // model-center.tab 已声明为 list
  const tabDecl=slots.declaration('model-center.tab');
  assert.equal(tabDecl.spec.kind,'list');
  assert.equal(tabDecl.spec.scope,'root');
  // 四页都在列表里
  const entries=slots.entriesOfSlot('model-center.tab');
  assert.equal(entries.length,4);
  const ids=entries.map(e=>e.options.id).sort();
  assert.deepEqual(Array.from(ids),['budget-stats','custom-models','migration','provider-settings']);
  asm.dispose();
});

test('卸载单页后列表数量减少，其余页不受影响',async()=>{
  const code=await bundle('client-slots.ts');
  const {createModelCenterAssembly}=await run(code);
  const asm=createModelCenterAssembly();
  const before=asm.slots.entriesOfSlot('model-center.tab').length;
  asm.unload('ui-migration');
  const after=asm.slots.entriesOfSlot('model-center.tab');
  assert.equal(after.length,before-1);
  assert.equal(after.some(e=>e.options.id==='migration'),false);
  asm.dispose();
});

test('装配卸载后注册失败',async()=>{
  const code=await bundle('client-slots.ts');
  const {createModelCenterAssembly}=await run(code);
  const asm=createModelCenterAssembly();
  asm.dispose();
  assert.throws(()=>asm.install('ui-test',()=>{}),/disposed/);
});

// --- provider-settings 校验测试 ---
test('provider-settings validateProvider：ID 格式与重复检查',async()=>{
  const code=await bundle('provider-settings.ts');
  const {validateProvider}=await run(code);
  const prov=[{id:'step',name:'Step',baseUrl:'https://api.step.com/v1',protocol:'openai-completions',keyConfigured:true,declared:false,sortOrder:0,enabled:true,transport:'direct'}];
  assert.equal(validateProvider({id:'new',name:'',baseUrl:'',protocol:'openai-completions',key:'',declared:false,sortOrder:0,enabled:true,transport:'direct'},prov,false),'显示名称不能为空');
  assert.equal(validateProvider({id:'Step',name:'X',baseUrl:'https://a.com',protocol:'openai-completions',key:'',declared:false,sortOrder:0,enabled:true,transport:'direct'},prov,false),'ID 只能以小写字母开头，包含小写字母、数字和短横线');
  assert.equal(validateProvider({id:'step',name:'X',baseUrl:'https://a.com',protocol:'openai-completions',key:'',declared:false,sortOrder:0,enabled:true,transport:'direct'},prov,false),'已有供应商使用了这个 ID');
});

test('provider-settings validateProvider：URL 校验与密钥格式',async()=>{
  const code=await bundle('provider-settings.ts');
  const {validateProvider}=await run(code);
  const base={id:'p',name:'P',protocol:'openai-completions',declared:false,sortOrder:0,enabled:true,transport:'direct'};
  assert.notEqual(validateProvider({...base,baseUrl:'http://api.example.com/v1',key:'x'},[],false),'');
  assert.equal(validateProvider({...base,baseUrl:'https://api.example.com/v1',key:'x'},[],false),'');
  assert.equal(validateProvider({...base,baseUrl:'http://127.0.0.1:8000/v1',key:'x'},[],false),'');
  assert.notEqual(validateProvider({...base,baseUrl:'http://127.0.0.1:8000/v1',key:''},[],false),'');
  assert.notEqual(validateProvider({...base,baseUrl:'https://u:p@api.com/v1',key:'x'},[],false),'');
});

// --- custom-models 校验测试 ---
test('custom-models validateCustom：基本校验',async()=>{
  const code=await bundle('custom-models.ts');
  const {validateCustom}=await run(code);
  const custom=[{id:'c',name:'C',category:'coding',requires:['text-output'],mode:'weighted',bindings:[],dailyTokens:-1,monthlyTokens:-1,dailyAmountMicro:-1,monthlyAmountMicro:-1,maxOutputTokens:-1,probeMaxPerDay:3}];
  assert.equal(validateCustom({id:'new',name:'',description:'',enabled:true,category:'coding',requires:['text-output'],bindings:[],mode:'weighted',params:'',modalityBudget:'',dailyTokens:-1,monthlyTokens:-1,dailyAmountMicro:-1,monthlyAmountMicro:-1,maxOutputTokens:-1,probeEnabled:true,probeMaxPerDay:3},custom,false),'名称不能为空');
  assert.equal(validateCustom({id:'Bad',name:'X',description:'',enabled:true,category:'coding',requires:['text-output'],bindings:[],mode:'weighted',params:'',modalityBudget:'',dailyTokens:-1,monthlyTokens:-1,dailyAmountMicro:-1,monthlyAmountMicro:-1,maxOutputTokens:-1,probeEnabled:true,probeMaxPerDay:3},custom,false),'ID 只能以小写字母开头，包含小写字母、数字和短横线');
  assert.equal(validateCustom({id:'new',name:'X',description:'',enabled:true,category:'coding',requires:[],bindings:[],mode:'weighted',params:'',modalityBudget:'',dailyTokens:-1,monthlyTokens:-1,dailyAmountMicro:-1,monthlyAmountMicro:-1,maxOutputTokens:-1,probeEnabled:true,probeMaxPerDay:3},custom,false),'至少选择一项能力要求');
});

test('custom-models validateCustom：绑定权重与重复',async()=>{
  const code=await bundle('custom-models.ts');
  const {validateCustom}=await run(code);
  const d={id:'n',name:'N',description:'',enabled:true,category:'coding',requires:['text-output'],mode:'weighted',params:'',modalityBudget:'',dailyTokens:-1,monthlyTokens:-1,dailyAmountMicro:-1,monthlyAmountMicro:-1,maxOutputTokens:-1,probeEnabled:true,probeMaxPerDay:3};
  const b1={providerId:'p',modelId:'m',enabled:true,order:0,weight:1,priceInMicro:-1,priceOutMicro:-1,priceCacheReadMicro:-1,priceCacheWriteMicro:-1,priceVersion:0,currency:''};
  assert.equal(validateCustom({...d,bindings:[b1]},[],false),'');
  assert.notEqual(validateCustom({...d,bindings:[{...b1,weight:0}]},[],false),'');
  assert.notEqual(validateCustom({...d,bindings:[{...b1,weight:1001}]},[],false),'');
  assert.equal(validateCustom({...d,bindings:[b1,{...b1,order:1}]},[],false),'绑定列表存在重复');
});

// --- budget-stats 格式化测试 ---
test('budget-stats formatMicro 与 formatTokens',async()=>{
  const code=await bundle('budget-stats.ts');
  const {formatMicro,formatTokens,verdictLabel}=await run(code);
  assert.equal(formatMicro(-1),'未设置');
  assert.equal(formatMicro(500),'500 微');
  assert.equal(formatMicro(5000),'5 毫');
  assert.equal(formatTokens(-1),'未设置');
  assert.equal(formatTokens(500),'500');
  assert.equal(formatTokens(5000),'5K');
  assert.equal(formatTokens(5000000),'5M');
  assert.equal(verdictLabel('recorded'),'已计量');
  assert.equal(verdictLabel('over-budget'),'超出预算');
  assert.equal(verdictLabel('unknown'),'未计量');
});

// --- migration 校验测试 ---
test('migration validateItems：格式与重复',async()=>{
  const code=await bundle('migration.ts');
  const {validateItems}=await run(code);
  assert.equal(validateItems(['step/gpt-4','step/gpt-3.5']),'');
  assert.notEqual(validateItems([]),'');
  assert.notEqual(validateItems(['bad','step/gpt-4']),'');
  assert.notEqual(validateItems(['step/gpt-4','step/gpt-4']),'');
  assert.notEqual(validateItems(['step/gpt-4/extra']),'');
});

test('migration buildExport：输出合法 JSON',async()=>{
  const code=await bundle('migration.ts');
  const {buildExport}=await run(code);
  const customs=[{id:'c1',name:'C1',description:'',enabled:true,category:'coding',mode:'weighted',bindingsCount:2}];
  const out=buildExport(customs);
  const parsed=JSON.parse(out);
  assert.equal(parsed.format,'sacode-custom-migration');
  assert.equal(parsed.version,1);
  assert.equal(parsed.customs.length,1);
  assert.equal(parsed.customs[0].id,'c1');
});

// --- 代码安全测试 ---
test('四页与装配均无 eval/动态 import/localStorage',()=>{
  const files=['provider-settings.ts','custom-models.ts','budget-stats.ts','migration.ts','client-slots.ts'];
  for(const f of files){
    const src=read(f).split('\n').filter(line=>!line.trimStart().startsWith('//')).join('\n');
    assert.equal(/new Function\(|\beval\(/.test(src),false,`${f} 不能运行时求值`);
    assert.equal(/import\s*\(/.test(src),false,`${f} 不能有动态 import`);
    assert.equal(/localStorage|sessionStorage|indexedDB/.test(src),false,`${f} 不能存浏览器本地`);
  }
});

test('四页均无 ipcRenderer 引用',()=>{
  const files=['provider-settings.ts','custom-models.ts','budget-stats.ts','migration.ts'];
  for(const f of files){
    const src=read(f);
    assert.equal(/ipcRenderer/.test(src),false,`${f} 不能直接引用 ipcRenderer`);
  }
});
