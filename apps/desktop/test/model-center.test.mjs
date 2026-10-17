// 模型中心五页测试：槽位注册、纯函数校验、代码安全（无 eval/动态 import/localStorage）。
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
test('createModelCenterAssembly 注册五页到 model-center.tab 列表槽位',async()=>{
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
  assert.equal(entries.length,5);
  const ids=entries.map(e=>e.options.id).sort();
  assert.deepEqual(Array.from(ids),['budget-stats','custom-models','migration','model-call-log','provider-settings']);
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

test('供应商新增草稿使用自定义写接口，不误走内置启停', async()=>{
  const {createModelCenterAdapters}=await run(await bundle('model-center-adapter.ts'));
  let saved;
  const adapters=createModelCenterAdapters({modelsSave:async(d,key,revision)=>{saved={d,key,revision};},modelsSetEnabled:async()=>{assert.fail('新增不得走启停');}});
  await adapters['provider-settings'].save({id:'test',declared:false,key:'test-key',models:[{id:'grok-4.3',name:'grok-4.3'}]},0);
  assert.equal(saved.d.models[0].id,'grok-4.3');
  assert.equal(saved.key,'test-key');
});

test('模型调用日志适配器跨会话聚合、按时序倒序、并补全会话归属',async()=>{
  const {createModelCenterAdapters}=await run(await bundle('model-center-adapter.ts'));
  const api={
    sessionCatalog:async()=>({entries:[
      {id:'s1',title:'会话一'},{id:'s2',title:'会话二'},{id:'s3',title:'会话三'}
    ]}),
    requestTrace:async(sessionId)=>{
      const base=sessionId==='s1'?1000:sessionId==='s2'?2000:3000;
      return {requests:[
        {request:{time:base+20,header:{config:{provider:'p-'+sessionId,model:'m-'+sessionId}}},end:{state:'completed',durationMs:10,ttftMs:3,usageTokens:'{"total_tokens":5}'},output:'o1'},
        {request:{time:base+10,header:{config:{provider:'p-'+sessionId,model:'m-'+sessionId}}},end:{state:'completed',durationMs:8,ttftMs:2,usageTokens:'{"total_tokens":3}'},output:'o2'},
      ]};
    },
  };
  const adapters=createModelCenterAdapters(api);
  const view=await adapters['model-call-log'].describe();
  assert.equal(view.calls.length,6,'三个会话各两条共六条');
  assert.equal(view.calls[0].sessionId,'s3');
  assert.equal(view.calls[0].request.time,3020);
  assert.equal(view.calls[5].request.time,1010);
  assert.equal(view.calls[0].sessionTitle,'会话三');
  assert.equal(view.scanned,3);
});

test('模型调用日志按 last-active 覆盖最活跃会话（目录序≠活跃序，>K 时丢最惰性）',async()=>{
  const {createModelCenterAdapters}=await run(await bundle('model-center-adapter.ts'));
  const entries=[];
  for(let i=0;i<35;i++){entries.push({id:'s'+i,title:'会话'+i});}
  const api={
    sessionCatalog:async()=>({entries}),
    requestTrace:async(sessionId)=>{
      const n=Number(sessionId.slice(1));      // s0->0 … s34->34，活跃度随序号递增
      const t=n*10+1;
      return {requests:[{request:{time:t,header:{config:{provider:'p',model:'m'}}},end:{state:'completed',durationMs:1,ttftMs:1,usageTokens:'{}'},output:'o'}]};
    },
  };
  const view=await createModelCenterAdapters(api)['model-call-log'].describe();
  assert.equal(view.scanned,30,'限流取前 K=30');
  assert.equal(view.total,35);
  assert.ok(view.calls.some(c=>c.sessionId==='s34'),'最活跃的末位会话 s34 必须被覆盖（旧 first-30 会漏）');
  assert.ok(!view.calls.some(c=>c.sessionId==='s0'),'最惰性的 s0 必须被丢弃');
  assert.equal(view.calls[0].sessionId,'s34','首位＝最活跃');
  assert.equal(view.calls[0].request.time,341);
});

test('供应商新增表单提交自定义标记及用户填写的模型目录',async()=>{
  const result=await build({entryPoints:[join(pages,'provider-settings.ts')],bundle:true,write:false,format:'cjs',external:['vue']});
  const mounted=[];
  const vue={defineComponent:v=>v,ref:value=>({value}),onMounted:fn=>mounted.push(fn),onBeforeUnmount:()=>{},h:(tag,props,children)=>({tag,props,children})};
  const ctx={module:{exports:{}},require:()=>vue,URL};
  vm.runInNewContext(result.outputFiles[0].text,ctx);
  let saved;
  const render=ctx.module.exports.Page.setup({adapter:{describe:async()=>({providers:[],catalog:[],revision:0,writable:true}),save:async d=>{saved=JSON.parse(JSON.stringify(d));}}});
  await mounted[0]();
  await new Promise(resolve=>setImmediate(resolve));
  const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==='object'?[tree,...nodes(tree.children)]:[];
  const find=label=>nodes(render()).find(n=>n.props?.['aria-label']===label);
  find('添加供应商').props.onClick();
  for(const [label,value] of [['Provider ID','test'],['显示名称','测试'],['API 地址','https://example.com/v1'],['API 密钥','test-key'],['模型 ID 1','grok-4.3']]){
    const node=find(label);assert.ok(node,'表单字段 '+label);node.props.onInput({target:{value}});
  }
  const saveButton=nodes(render()).find(n=>n.tag==='button'&&n.children==='保存');
  assert.equal(saveButton.props.disabled,false,'读取完成后才允许保存');
  saveButton.props.onClick();
  await new Promise(resolve=>setImmediate(resolve));
  assert.ok(saved,JSON.stringify(nodes(render()).filter(n=>n.props?.class==='error').map(n=>n.children)));
  assert.equal(saved.declared,false);
  assert.equal(saved.models[0].id,'grok-4.3');
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
  const base={id:'p',name:'P',protocol:'openai-completions',declared:false,sortOrder:0,enabled:true,transport:'direct',models:[{id:'m',name:'',contextWindow:'',maxTokens:'',image:false}]};
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
test('五页与装配均无 eval/动态 import/localStorage',()=>{
  const files=['provider-settings.ts','custom-models.ts','budget-stats.ts','migration.ts','model-call-log.ts','client-slots.ts'];
  for(const f of files){
    const src=read(f).split('\n').filter(line=>!line.trimStart().startsWith('//')).join('\n');
    assert.equal(/new Function\(|\beval\(/.test(src),false,`${f} 不能运行时求值`);
    assert.equal(/import\s*\(/.test(src),false,`${f} 不能有动态 import`);
    assert.equal(/localStorage|sessionStorage|indexedDB/.test(src),false,`${f} 不能存浏览器本地`);
  }
});

test('五页均无 ipcRenderer 引用',()=>{
  const files=['provider-settings.ts','custom-models.ts','budget-stats.ts','migration.ts','model-call-log.ts'];
  for(const f of files){
    const src=read(f);
    assert.equal(/ipcRenderer/.test(src),false,`${f} 不能直接引用 ipcRenderer`);
  }
});
