import {defineComponent,h,ref,watch,onBeforeUnmount} from 'vue';
import {createReviewWriteback} from './review-writeback-state';
const phaseName:Record<string,string>={'awaiting-approval':'等待确认',applying:'正在写回',completed:'写回完成',cancelled:'已取消','partial-cancelled':'部分写回，后续已取消',conflict:'存在冲突','partial-conflict':'部分写回，遇到冲突',unknown:'结果未知，需核对','not-attempted':'尚未尝试',writing:'正在提交',applied:'已写回'};
export const ReviewWriteback=defineComponent({
 name:'SaCodeReviewWriteback',props:{task:Object,review:Object,api:Object,sessionId:String,active:Boolean},
 setup(props){
  const revision=ref(0),selected=ref<string[]>([]);
  const write=createReviewWriteback(props.api,()=>props.sessionId||'',()=>revision.value++);
  watch(()=>[props.sessionId,props.task],()=>{write.reset();selected.value=[];});
  watch(()=>props.active,value=>{if(!value)write.suspend();});onBeforeUnmount(()=>write.suspend());
  return()=>{void revision.value;const s=write.state,review=props.review as any;
   const available=props.active&&props.api&&review?.sourceIdentity&&review.files.length>0;
   return h('section',{'aria-label':'任务差异写回'},[
    h('h3',{},'写回原项目'),
    h('p',{class:'note'},'选择文件后先生成完整提案。确认仅授权本批写回，不执行暂存、提交或推送；部分成功和未知结果需逐项核对。'),
    !review?.sourceIdentity?h('p',{class:'note'},'旧差异记录缺少源目录身份，仅允许预览。'):null,
    ...(review?.files||[]).map((row:any)=>h('label',{class:'row',key:row.path},[
     h('input',{type:'checkbox',checked:selected.value.includes(row.path),disabled:!available||!!s.busy||!!s.plan,onChange:(event:any)=>{selected.value=event.target.checked?[...selected.value,row.path]:selected.value.filter(p=>p!==row.path);}}),row.path,
    ])),
    h('button',{class:'btn',disabled:!available||!!s.busy||!!s.plan||!selected.value.length,onClick:()=>write.prepare(props.task,review,selected.value)},'生成写回提案'),
    s.plan?h('article',{},[
     h('p',{},'批次：'+s.plan.applyId),
     h('details',{open:true},[h('summary',{},'完整审批提案'),h('pre',{tabindex:0},s.plan.approvalArguments)]),
     h('button',{class:'btn',disabled:!props.active||!!s.busy||s.status?.phase!=='awaiting-approval',onClick:()=>write.approve()},'确认并写回所选文件'),
     h('button',{class:'btn',disabled:!props.active||!!s.busy,onClick:()=>write.refresh()},'刷新写回结果'),
     h('button',{class:'btn',disabled:!props.active||!!s.busy||(!!s.status&&s.status.phase!=='applying'),onClick:()=>write.refresh(true)},'停止后续文件'),
     h('p',{role:'status'},s.status?'状态：'+(phaseName[s.status.phase]||s.status.phase):'等待核对服务端结果'),
     ...(s.status?.files||[]).map((row:any)=>h('p',{key:row.path},row.path+' · '+(phaseName[row.phase]||row.phase))),
     s.status?.phase==='awaiting-approval'?h('button',{class:'btn',disabled:!!s.busy,onClick:()=>write.reset()},'重新选择文件'):null,
    ]):null,
    s.busy?h('p',{role:'status'},'正在处理…'):null,
    s.error?h('p',{role:'alert'},s.error):null,
   ]);
  };
 }
});
