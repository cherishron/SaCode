import {defineComponent,h,ref,watch,onBeforeUnmount} from 'vue';
import {createExecutionArtifacts} from './execution-artifacts-state';

const phaseLabel:Record<string,string>={'awaiting-approval':'等待审批',admitted:'已准入',starting:'启动中',running:'运行中',stopping:'停止中',exited:'已退出',unknown:'结果未确认','cancelled-before-start':'启动前已取消'};
const reportLabel:Record<string,string>={passed:'通过','passed-with-skips':'通过（含跳过）',failed:'失败',cancelled:'已取消',incomplete:'输出不完整',unknown:'未能判定',running:'运行中'};
const reasonLabel:Record<string,string>={'build-succeeded':'构建退出成功，且完整输出已确认','nonzero-exit-code':'进程退出码非零','test-summary-has-failures':'测试摘要包含失败或错误','execution-cancelled':'任务被取消','cancelled-before-start':'任务在启动前取消','execution-timed-out':'任务超时','output-truncated':'输出达到上限并被截断','output-not-complete':'尚未确认完整输出','output-pages-remaining':'还有未读取的输出分页','output-pagination-unknown':'分页状态未知','no-unambiguous-test-summary':'没有唯一且完整的测试摘要','no-tests-executed':'没有实际通过的测试用例','process-not-successful':'进程未报告成功','execution-result-unknown':'执行结果无法确认','execution-not-terminal':'执行尚未结束','invalid-execution-identity-or-result':'执行身份或结果无效','unsupported-test-command':'此执行类型没有构建/测试判定','test-summary-command-mismatch':'摘要格式与执行命令不匹配','invalid-exit-facts':'退出事实无法解析','incomplete-exit-facts':'退出事实字段不完整'};
function exitFacts(text:string){try{const value=JSON.parse(text);return value&&typeof value==='object'&&!Array.isArray(value)?value:null;}catch(_){return null;}}
function preview(text:string){return text.length<=16000?text:text.slice(0,8000)+'\n\n…中间内容已折叠；原始输出仍保存在执行日志中…\n\n'+text.slice(-8000);}

export const ArtifactsPage=defineComponent({
 name:'SaCodeArtifactsPage',props:{active:Boolean,sessionId:String,api:Object},
 setup(props){
  const revision=ref(0),view=createExecutionArtifacts(props.api,()=>props.sessionId||'',()=>revision.value++);
  watch(()=>props.sessionId,()=>{view.reset();if(props.active&&props.sessionId)void view.load();},{immediate:true});
  watch(()=>props.active,active=>{if(active&&props.sessionId&&!view.state.loaded&&!view.state.busy)void view.load();},{immediate:true});
  onBeforeUnmount(()=>view.dispose());
  return()=>{void revision.value;const s=view.state,r=s.report,t=s.detail,facts=t?exitFacts(t.result):null;const status=r?(reportLabel[r.status]||r.status):'';
   const rows=[...s.rows].reverse();
   return h('section',{class:'side-section artifacts-page','aria-label':'产物'},[
    h('header',{class:'row spread'},[h('h2',{},'产物'),h('button',{class:'btn',disabled:!!s.busy||!props.sessionId,onClick:()=>view.load()},s.busy==='list'?'正在读取…':'刷新')]),
    h('p',{class:'note'},'读取当前会话由 Host 持久化的执行记录。构建/测试摘要从原提案、完整输出与退出事实重建；不会扫描磁盘猜测文件，也不会把未完成输出判成通过。'),
    s.error?h('div',{class:'resource-error',role:'alert'},[h('strong',{},'产物读取失败'),h('p',{class:'note'},s.error),h('button',{class:'btn',disabled:!!s.busy,onClick:()=>s.selectedId?view.open(s.selectedId):view.load()},'重试')]):null,
    s.loaded&&!s.rows.length?h('p',{class:'note'},'当前会话还没有持久执行记录。'):null,
    ...rows.map(row=>h('button',{class:'btn artifact-row',key:row.executionId,'aria-pressed':s.selectedId===row.executionId,disabled:!!s.busy,onClick:()=>view.open(row.executionId)},[
     h('span',{},row.executionId+' · '+(phaseLabel[row.phase]||row.phase)),h('small',{},row.taskId+' · 修订 '+row.revision),
    ])),
    s.more?h('button',{class:'btn',disabled:!!s.busy,onClick:()=>view.load(true)},s.busy==='list'?'正在读取…':'加载更早记录'):null,
    r&&t?h('article',{class:'execution-state artifact-detail','data-artifact-execution':t.executionId},[
     h('h3',{},(r.kind==='build'?'构建报告':r.kind==='test'?'测试报告':'执行记录')+' · '+(r.kind?status:'输出预览')),
     h('p',{class:'note'},(reasonLabel[r.reason]||r.reason)+' · '+t.executionId+' · 任务 '+t.taskId+' · 修订 '+t.revision),
     r.kind&&r.summary?h('p',{class:'note'},'共 '+r.summary.total+' 项 · 通过 '+r.summary.passed+' · 跳过 '+r.summary.skipped+' · 失败 '+r.summary.failed+' · 错误 '+r.summary.errors):null,
     facts?h('p',{class:'note'},'退出码 '+(Number.isSafeInteger(facts.exitCode)?facts.exitCode:'未知')+' · '+(facts.timedOut?'已超时':'未超时')+' · '+(facts.cancelObserved?'已取消':'未取消')+' · '+(facts.outputComplete?'执行器报告输出完整':'执行器未确认输出完整')):h('p',{class:'note'},'没有可核对的退出事实。'),
     h('p',{class:'note'},'stdout '+(s.capture?.stdout?.eof?'EOF 已确认':'EOF 未确认')+' · stderr '+(s.capture?.stderr?.eof?'EOF 已确认':'EOF 未确认')+' · '+((s.capture?.stdout?.truncated||s.capture?.stderr?.truncated)?'输出已截断':'未发现截断')),
     h('details',{},[h('summary',{},'预览标准输出'),h('pre',{tabindex:0},preview(s.stdout||'（没有标准输出）'))]),
     h('details',{},[h('summary',{},'预览标准错误'),h('pre',{tabindex:0},preview(s.stderr||'（没有标准错误）'))]),
     h('p',{class:'note'},'此报告是对持久执行记录的只读投影，不复制或改写执行日志。要登记磁盘文件产物，仍需由任务提供可验证的路径与内容身份。'),
    ]):null,
   ]);
  };
 },
});
