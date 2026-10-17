import {defineComponent,h,ref,watch,onBeforeUnmount} from 'vue';
import {createExecutionTask,executionProviderNotice,executionWorkspaceSnapshot} from './execution-task-state';
import {createExecutionHistory} from './execution-history';
import {buildTestReport} from './build-test-report.mjs';
export type ExecutionPreset={id:string;kind?:string;title:string;summary:string;executable:string;argv:string[];timeoutMs?:number;outputLimit?:number};
const labels:Record<string,string>={'awaiting-approval':'等待审批',admitted:'已准入',starting:'启动中',running:'运行中',stopping:'停止中',exited:'已退出',unknown:'无法确认状态','cancelled-before-start':'启动前已取消'};
export const ExecutionTask=defineComponent({name:'SaCodeExecutionTask',props:{active:Boolean,sessionId:String,api:Object,showTestReport:Boolean,preset:{type:Object,default:null}},setup(props){
 const revision=ref(0),executable=ref(''),argv=ref('[]'),lookup=ref(''),timeout=ref(30000),limit=ref(8192),formError=ref('');let prepared:{body:string;id:string}|null=null;
 const view=createExecutionTask(props.api as any,()=>props.sessionId||'',()=>revision.value++);
 const history=createExecutionHistory(props.api,()=>props.sessionId||'',()=>revision.value++);
 watch(()=>[props.active,props.sessionId,(props.preset as ExecutionPreset|null)?.id],()=>{
  view.reset();history.reset();prepared=null;formError.value='';executable.value='';argv.value='[]';lookup.value='';
  const preset=props.preset as ExecutionPreset|null;
  if(props.active&&props.sessionId){
   const sessionId=props.sessionId,presetId=preset?.id;
   void view.workspace().then(()=>{if(presetId&&props.active&&props.sessionId===sessionId&&(props.preset as ExecutionPreset|null)?.id===presetId&&view.state.workspace)propose();});
   if(!preset)void history.load();
  }
 },{immediate:true});
 onBeforeUnmount(()=>{view.dispose();history.dispose();});
 function propose(){try{
  const preset=props.preset as ExecutionPreset|null;
  const args=preset?preset.argv:JSON.parse(argv.value),command=preset?preset.executable:executable.value.trim();
  const timeoutMs=preset?.timeoutMs??timeout.value,outputLimit=preset?.outputLimit??limit.value;
  if(!command.trim()||!Array.isArray(args)||args.some(a=>typeof a!=='string'))throw Error('程序不能为空；参数应为 JSON 字符串数组');
  if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>300000||!Number.isSafeInteger(outputLimit)||outputLimit<1||outputLimit>65536)throw Error('超时需在 1–300000 ms，单流输出限额需在 1–65536 字节');
  if(preset&&(!preset.id||preset.id.length>128||/\s/.test(preset.id)))throw Error('授权操作身份无效');
  const ws=view.state.workspace;if(!ws)throw Error('先读取当前工作区');
  const body=JSON.stringify({cwd:ws.directory,workspaceRevision:ws.revision,executable:command,argv:args,timeoutMs,outputLimit});
  if(preset)prepared={body,id:preset.id};else if(!prepared||prepared.body!==body)prepared={body,id:globalThis.crypto.randomUUID()};
  formError.value='';void view.propose('task-'+prepared.id,'request-'+prepared.id,prepared.body);
 }catch(e){formError.value=String((e as Error).message||e);}}
 async function readAllOutput(){let pages=0;while(pages<128){const before=view.state.cursor;await view.output();pages++;if(view.state.error||!view.state.more||view.state.cursor<=before)break;}}
 const field=(title:string,value:any,update:(v:any)=>void,type='text')=>h('label',{class:'execution-field'},[h('span',{},title),h('input',{class:'input',type,value,disabled:!!view.state.busy,onInput:(e:any)=>update(type==='number'?Number(e.target.value):e.target.value)})]);
 return()=>{void revision.value;const s=view.state,t=s.task,snapshot=t?executionWorkspaceSnapshot(t):null;return h('section',{class:'execution-task'},[
  h('header',{class:'row spread'},[h('h2',{},(props.preset as ExecutionPreset|null)?.title||(props.showTestReport?'构建与测试任务':'持久任务')),h('button',{class:'btn',disabled:!!s.busy,onClick:()=>view.workspace()},'读取工作区')]),
  s.workspace?h('p',{class:'note'},s.workspace.directory+' · 修订 '+s.workspace.revision):h('p',{class:'note'},'请先配置当前会话工作区。'),
  props.preset?h('section',{class:'execution-action-summary'},[h('h3',{},'独立授权提案'),h('p',{class:'note'},(props.preset as ExecutionPreset).summary),h('p',{class:'note'},'提案仅记录命令，不会执行。批准与启动是两个独立动作。'),h('pre',{tabindex:0},JSON.stringify({executable:(props.preset as ExecutionPreset).executable,argv:(props.preset as ExecutionPreset).argv},null,2))]):null,
  props.preset?null:h('section',{'aria-label':'持久执行任务'},[
   h('div',{class:'row'},[h('h3',{},'任务记录'),h('button',{class:'btn',disabled:history.state.busy,onClick:()=>history.load()},history.state.busy?'正在读取…':'刷新记录')]),
   h('p',{class:'note'},'恢复记录不会启动命令或继承审批；选择记录查看提案、输出与退出事实。'),
   history.state.error?h('p',{class:'resource-error',role:'alert'},history.state.error):null,
   history.state.loaded&&!history.state.rows.length?h('p',{class:'note'},'当前会话暂无执行任务'):null,
   ...history.state.rows.map(row=>h('button',{class:'btn',key:row.executionId,disabled:!!s.busy,onClick:()=>view.describe(row.executionId)},row.executionId+' · '+(labels[row.phase]||row.phase))),
   history.state.more?h('button',{class:'btn',disabled:history.state.busy,onClick:()=>history.load(true)},'加载更多记录'):null,
  ]),
  props.preset?null:h('details',{open:!t},[h('summary',{},'创建执行提案'),h('div',{class:'execution-form'},[
   field('可执行程序',executable.value,v=>executable.value=v),
   h('label',{class:'execution-field'},[h('span',{},'参数（JSON 数组）'),h('textarea',{class:'input',value:argv.value,disabled:!!s.busy,onInput:(e:any)=>argv.value=e.target.value})]),
   field('超时（ms）',timeout.value,v=>timeout.value=v,'number'),field('每个输出流的上限（字节）',limit.value,v=>limit.value=v,'number'),
   h('button',{class:'btn btn-primary',disabled:!!s.busy||!s.workspace,onClick:propose},'保存提案'),
  ])]),
  props.preset?null:h('div',{class:'row'},[h('input',{class:'input',placeholder:'执行身份，例如 execution-2','aria-label':'执行身份',value:lookup.value,onInput:(e:any)=>lookup.value=e.target.value}),h('button',{class:'btn',disabled:!!s.busy||!lookup.value.trim(),onClick:()=>view.describe(lookup.value.trim())},'读取任务')]),
  s.busy?h('p',{role:'status',class:'note'},'正在处理…'):null,
  s.error||formError.value?h('p',{role:'alert',class:'note'},s.error||formError.value):null,
  t?h('article',{class:'execution-state'},[
   h('h3',{},labels[t.phase]||t.phase),h('p',{class:'note'},t.executionId+' · 修订 '+t.revision),
   h('details',{open:t.phase==='awaiting-approval'},[h('summary',{},'完整提案与审批绑定'),h('pre',{tabindex:0},t.proposal),h('p',{class:'note'},'SHA256 '+t.proposalDigest)]),
   snapshot?h('section',{'aria-label':'私有工作区快照'},[
    h('h4',{},'本次执行使用私有副本'),
    h('dl',{},[h('dt',{},'原工作区'),h('dd',{},snapshot.sourceDirectory),h('dt',{},'执行目录'),h('dd',{},snapshot.executionDirectory),h('dt',{},'快照摘要'),h('dd',{},snapshot.manifestDigest),...(snapshot.toolBinding?(()=>{const tool=JSON.parse(snapshot.toolBinding);return[h('dt',{},'实际执行程序'),h('dd',{},tool.executable),h('dt',{},'程序 SHA256'),h('dd',{},tool.sha256)];})():[]),h('dt',{},'复制范围'),h('dd',{},snapshot.entryCount+' 项 · '+snapshot.byteCount+' 字节'),h('dt',{},'排除路径'),h('dd',{},snapshot.excluded.join('、')||'无')]),
    h('p',{class:'note'},'批准仅适用于此提案及此快照；任务结果需经差异审查后另行授权写回原工作区。')
   ]):null,
   h('div',{class:'row'},[
    h('button',{class:'btn',disabled:!!s.busy,onClick:()=>view.describe(t.executionId)},'刷新状态'),
    t.phase==='awaiting-approval'?h('button',{class:'btn',disabled:!!s.busy,onClick:()=>view.approve()},'批准此提案一次'):null,
    h('button',{class:'btn',disabled:!!s.busy||t.phase!=='admitted'||!t.providerAvailable,onClick:()=>view.start()},'启动'),
    ['awaiting-approval','admitted','starting','running','stopping'].includes(t.phase)?h('button',{class:'btn',disabled:!!s.busy,onClick:()=>view.stop()},t.phase==='awaiting-approval'||t.phase==='admitted'?'取消提案':'停止任务'):null,
   ]),
   !t.providerAvailable?h('p',{class:'note'},executionProviderNotice(t.providerReason)+'审批和取消不表示命令已执行。'):null,
   t.result?h('details',{open:true},[h('summary',{},'退出与结算事实'),h('pre',{tabindex:0},t.result)]):null,
   h('button',{class:'btn',disabled:!!s.busy,onClick:()=>props.showTestReport?void readAllOutput():void view.output()},props.showTestReport?(s.more?'继续读取并更新报告':'读取完整输出并生成报告'):(s.more?'读取后续输出':'读取已保存输出')),
   (['stdout','stderr'] as const).map(channel=>h('section',{},[h('h4',{},channel==='stdout'?'标准输出':'标准错误'),h('pre',{tabindex:0},s[channel]||'暂无输出'),h('p',{class:'note'},s.capture[channel].end?(s.capture[channel].eof?'已观察到 EOF':'采集结束，未确认 EOF')+(s.capture[channel].truncated?' · 达到限额，输出截断':''):'未收到采集结束记录')])),
   props.showTestReport?(()=>{const r=buildTestReport(t,{stdout:s.stdout,stderr:s.stderr,capture:s.capture,more:s.more});const status=({passed:'通过',failed:'失败',cancelled:'已取消',incomplete:'输出不完整',unknown:'结果未确认',running:'运行中'} as Record<string,string>)[r.status]||r.status;const reason=({'passed':'退出码、摘要及完整输出一致','passed-with-skips':'报告包含跳过用例','nonzero-exit-code':'进程退出码非零','test-summary-has-failures':'测试摘要包含失败或错误','execution-cancelled':'执行已取消','cancelled-before-start':'执行启动前取消','execution-timed-out':'执行超时','output-truncated':'输出达到限额并被截断','output-not-complete':'尚未确认完整输出','output-pages-remaining':'还有未读取的输出分页','output-pagination-unknown':'无法确认输出分页已读完','no-unambiguous-test-summary':'未识别到唯一且完整的测试摘要','no-tests-executed':'没有实际通过的测试用例','process-not-successful':'进程未报告成功','execution-result-unknown':'持久执行结果未知','execution-not-terminal':'执行尚未结束','invalid-exit-facts':'退出事实格式无效','incomplete-exit-facts':'退出事实字段不完整','invalid-execution-identity-or-result':'任务身份或结果无效','unsupported-test-command':'执行命令不是已识别的测试入口','test-summary-command-mismatch':'测试摘要格式与执行命令不匹配','build-succeeded':'构建退出成功且完整输出已确认'} as Record<string,string>)[r.reason]||r.reason;return h('section',{class:'execution-state execution-report','data-report-status':r.status,'data-execution-id':r.executionId,'aria-label':'构建测试报告'},[h('h4',{},(r.kind==='build'?'构建报告 · ':'测试报告 · ')+status),h('p',{class:'note'},reason),r.summary?h('p',{class:'note'},'共 '+r.summary.total+' 项 · 通过 '+r.summary.passed+' · 跳过 '+r.summary.skipped+' · 失败 '+r.summary.failed+' · 错误 '+r.summary.errors):h('p',{class:'note'},r.kind==='build'?'构建退出事实和完整输出已确认。':'未取得可核对的测试摘要；进程退出码单独不构成测试通过。'),h('p',{class:'note'},'执行 '+r.executionId+' · 修订 '+r.revision+' · 退出码 '+(r.exitCode===null?'未知':r.exitCode)),h('p',{class:'note'},'stdout '+(r.integrity.stdoutEof?'EOF 已确认':'EOF 未确认')+' · stderr '+(r.integrity.stderrEof?'EOF 已确认':'EOF 未确认')+' · '+(r.integrity.truncated?'输出已截断':'未发现截断')+' · '+(r.integrity.paginationKnown?(r.integrity.more?'还有未读取分页':'分页已读完'):'分页状态未知'))]);})():null,
   h('p',{class:'note'},'关闭标签只结束页面消费。退出码、输出完整性与测试报告分别验收。'),
  ]):null,
 ]);};
}});
