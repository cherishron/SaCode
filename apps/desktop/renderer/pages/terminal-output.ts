import {defineComponent,h,ref,watch,onBeforeUnmount} from 'vue';
import {ExecutionTask} from './execution-task';
import {createTerminalOutput} from './terminal-output-state';
export const TerminalOutput=defineComponent({name:'SaCodeTerminalOutput',props:{active:Boolean,sessionId:String,read:Function,executionApi:Object},setup(props){
  const revision=ref(0),view=createTerminalOutput(cursor=>props.read!(cursor),()=>props.sessionId||'',()=>revision.value++);
  watch(()=>[props.active,props.sessionId],()=>{view.reset();if(props.active&&props.sessionId)void view.load();},{immediate:true});
  onBeforeUnmount(()=>view.dispose());
  return()=>{void revision.value;const s=view.state;return h('section',{class:'terminal-output'},[
    props.executionApi?h(ExecutionTask,{active:props.active,sessionId:props.sessionId,api:props.executionApi}):null,
    h('header',{class:'terminal-output-heading'},[h('h2',{},'终端输出'),h('button',{class:'btn',disabled:s.busy,onClick:()=>view.load(true)},'刷新')]),
    h('p',{class:'note'},'当前会话已落盘的执行输出；按记录顺序显示。'),
    s.busy?h('p',{class:'note',role:'status'},'读取中…'):null,
    s.error?h('p',{class:'note',role:'alert'},'读取失败：'+s.error):null,
    s.loaded&&!s.rows.length?h('div',{class:'empty-card'},[h('h3',{},'暂无终端输出'),h('p',{class:'note'},'执行记录保存后，可在这里查看；恢复页面不会运行命令。')]):null,
    s.rows.map(row=>h('details',{class:'terminal-output-record',key:row.seq,open:true},[
      h('summary',{},[h('span',{class:'terminal-output-title'},[h('svg',{class:'terminal-output-chevron',width:14,height:14,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor','aria-hidden':'true'},h('path',{d:'M9 5l7 7-7 7'})),row.jobId]),h('small',{},'#'+row.seq+' · 已落盘输出')]),
      h('pre',{tabindex:0},row.text),row.truncated?h('p',{class:'note'},'此条输出超过 8 KiB，显示内容已截断。'):null,
    ])),
    s.malformed?h('p',{class:'note',role:'alert'},'有 '+s.malformed+' 条损坏输出记录，未作为正常结果展示。'):null,
    s.omitted?h('p',{class:'note'},'页面保留最近 128 条已读取输出；省略了 '+s.omitted+' 条较早记录，刷新可从头读取。'):null,
    s.more?h('button',{class:'btn',disabled:s.busy,onClick:()=>view.load()},'加载后续输出'):null,
    h('p',{class:'note'},'以下为旧终端记录回放；交互 PTY 与实时流尚未接入。'),
  ]);};
}});
