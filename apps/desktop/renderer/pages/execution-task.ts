import {defineComponent,h,ref,watch,onBeforeUnmount} from 'vue';
import {createExecutionTask} from './execution-task-state';
const labels:Record<string,string>={'awaiting-approval':'等待审批',admitted:'已准入',starting:'启动中',running:'运行中',stopping:'停止中',exited:'已退出',unknown:'无法确认状态','cancelled-before-start':'启动前已取消'};
export const ExecutionTask=defineComponent({name:'SaCodeExecutionTask',props:{active:Boolean,sessionId:String,api:Object},setup(props){
 const revision=ref(0),executable=ref(''),argv=ref('[]'),lookup=ref(''),timeout=ref(30000),limit=ref(8192),formError=ref('');let prepared:{body:string;id:string}|null=null;
 const view=createExecutionTask(props.api as any,()=>props.sessionId||'',()=>revision.value++);
 watch(()=>[props.active,props.sessionId],()=>{view.reset();prepared=null;formError.value='';executable.value='';argv.value='[]';lookup.value='';if(props.active&&props.sessionId)void view.workspace();},{immediate:true});
 onBeforeUnmount(()=>view.dispose());
 function propose(){try{
  const args=JSON.parse(argv.value);if(!executable.value.trim()||!Array.isArray(args)||args.some(a=>typeof a!=='string'))throw Error('程序不能为空；参数应为 JSON 字符串数组');
  if(!Number.isSafeInteger(timeout.value)||timeout.value<1||timeout.value>300000||!Number.isSafeInteger(limit.value)||limit.value<1||limit.value>65536)throw Error('超时需在 1–300000 ms，单流输出限额需在 1–65536 字节');
  const ws=view.state.workspace;if(!ws)throw Error('先读取当前工作区');const body=JSON.stringify({cwd:ws.directory,workspaceRevision:ws.revision,executable:executable.value.trim(),argv:args,timeoutMs:timeout.value,outputLimit:limit.value});if(!prepared||prepared.body!==body)prepared={body,id:globalThis.crypto.randomUUID()};
  formError.value='';void view.propose('task-'+prepared.id,'request-'+prepared.id,prepared.body);
 }catch(e){formError.value=String((e as Error).message||e);}}
 const field=(title:string,value:any,update:(v:any)=>void,type='text')=>h('label',{class:'execution-field'},[h('span',{},title),h('input',{class:'input',type,value,disabled:!!view.state.busy,onInput:(e:any)=>update(type==='number'?Number(e.target.value):e.target.value)})]);
 return()=>{void revision.value;const s=view.state,t=s.task;return h('section',{class:'execution-task'},[
  h('header',{class:'row spread'},[h('h2',{},'持久任务'),h('button',{class:'btn',disabled:!!s.busy,onClick:()=>view.workspace()},'读取工作区')]),
  s.workspace?h('p',{class:'note'},s.workspace.directory+' · 修订 '+s.workspace.revision):h('p',{class:'note'},'请先配置当前会话工作区。'),
  h('details',{open:!t},[h('summary',{},'创建执行提案'),h('div',{class:'execution-form'},[
   field('可执行程序',executable.value,v=>executable.value=v),
   h('label',{class:'execution-field'},[h('span',{},'参数（JSON 数组）'),h('textarea',{class:'input',value:argv.value,disabled:!!s.busy,onInput:(e:any)=>argv.value=e.target.value})]),
   field('超时（ms）',timeout.value,v=>timeout.value=v,'number'),field('每个输出流的上限（字节）',limit.value,v=>limit.value=v,'number'),
   h('button',{class:'btn btn-primary',disabled:!!s.busy||!s.workspace,onClick:propose},'保存提案'),
  ])]),
  h('div',{class:'row'},[h('input',{class:'input',placeholder:'执行身份，例如 execution-2','aria-label':'执行身份',value:lookup.value,onInput:(e:any)=>lookup.value=e.target.value}),h('button',{class:'btn',disabled:!!s.busy||!lookup.value.trim(),onClick:()=>view.describe(lookup.value.trim())},'读取任务')]),
  s.busy?h('p',{role:'status',class:'note'},'正在处理…'):null,
  s.error||formError.value?h('p',{role:'alert',class:'note'},s.error||formError.value):null,
  t?h('article',{class:'execution-state'},[
   h('h3',{},labels[t.phase]||t.phase),h('p',{class:'note'},t.executionId+' · 修订 '+t.revision),
   h('details',{open:t.phase==='awaiting-approval'},[h('summary',{},'完整提案与审批绑定'),h('pre',{tabindex:0},t.proposal),h('p',{class:'note'},'SHA256 '+t.proposalDigest)]),
   h('div',{class:'row'},[
    h('button',{class:'btn',disabled:!!s.busy,onClick:()=>view.describe(t.executionId)},'刷新状态'),
    t.phase==='awaiting-approval'?h('button',{class:'btn',disabled:!!s.busy,onClick:()=>view.approve()},'批准此提案一次'):null,
    h('button',{class:'btn',disabled:!!s.busy||t.phase!=='admitted'||!t.providerAvailable,onClick:()=>view.start()},'启动'),
    ['awaiting-approval','admitted','starting','running','stopping'].includes(t.phase)?h('button',{class:'btn',disabled:!!s.busy,onClick:()=>view.stop()},t.phase==='awaiting-approval'||t.phase==='admitted'?'取消提案':'停止任务'):null,
   ]),
   !t.providerAvailable?h('p',{class:'note'},'隔离与监督探针尚未通过，启动未开放。审批和取消不表示命令已执行。'):null,
   t.result?h('details',{open:true},[h('summary',{},'退出与结算事实'),h('pre',{tabindex:0},t.result)]):null,
   h('button',{class:'btn',disabled:!!s.busy,onClick:()=>view.output()},s.more?'读取后续输出':'读取已保存输出'),
   (['stdout','stderr'] as const).map(channel=>h('section',{},[h('h4',{},channel==='stdout'?'标准输出':'标准错误'),h('pre',{tabindex:0},s[channel]||'暂无输出'),h('p',{class:'note'},s.capture[channel].end?(s.capture[channel].eof?'已观察到 EOF':'采集结束，未确认 EOF')+(s.capture[channel].truncated?' · 达到限额，输出截断':''):'未收到采集结束记录')])),
   h('p',{class:'note'},'关闭标签只结束页面消费。退出码、输出完整性与测试报告分别验收。'),
  ]):null,
 ]);};
}});
