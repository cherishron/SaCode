// 目标栏位于队列之后、输入框之前；业务状态与 CAS 均来自仓颉。
import {defineComponent,h,ref,watch,onMounted,onBeforeUnmount,type PropType} from 'vue';
import {InlineEditor} from './inline-editor';
export type Goal={id:string;revision:number;phase:string;objective:string;blockedReason:string;roundsDone:number;elapsedSeconds:number;noProgressStreak?:number;remainingRounds?:number;remainingSeconds?:number;activation?:string;pendingTurnCount?:number};
export type GoalAdapter={describe:()=>Promise<Goal>;create:(text:string)=>Promise<Goal>;edit:(revision:number,text:string)=>Promise<Goal>;pause:(revision:number)=>Promise<Goal>;resume:(revision:number)=>Promise<Goal>;clear:(revision:number)=>Promise<Goal>};
export function createGoalSurface(adapter:GoalAdapter,changed:()=>void){
  const state={goal:null as Goal|null,busy:false,error:'',loaded:false};let epoch=0,disposed=false,reading=false;
  const notify=()=>{if(!disposed)changed();};
  async function refresh(){if(disposed||state.busy||reading)return;reading=true;const read=++epoch;try{const goal=await adapter.describe();if(!disposed&&read===epoch){state.goal=goal;state.loaded=true;notify();}}catch(e){if(!disposed&&read===epoch){state.error=String((e as Error).message||e);notify();}}finally{reading=false;}}
  async function mutate(action:'create'|'edit'|'pause'|'resume'|'clear',text=''){
    if(disposed||state.busy)return false;
    if((action==='create'||action==='edit')&&!text.trim()){state.error='请输入目标正文。';notify();return false;}
    const goal=state.goal;if(action!=='create'&&!goal?.id)return false;
    state.busy=true;state.error='';const write=++epoch;notify();
    try{const result=action==='create'?await adapter.create(text):action==='edit'?await adapter.edit(goal!.revision,text):await adapter[action](goal!.revision);
      if(disposed||write!==epoch)return false;state.goal=result;state.loaded=true;return true;
    }catch(e){if(!disposed&&write===epoch)state.error=String((e as Error).message||e);return false;}
    finally{if(!disposed&&write===epoch){state.busy=false;notify();}}
  }
  return{state,refresh,mutate,dispose(){disposed=true;++epoch;}};
}
function phaseLabel(goal:Goal){
  if(goal.phase==='active'&&goal.activation==='disarmed')return '待继续';
  return ({active:'已启用',paused:'已暂停',blocked:'受阻',complete:'已完成'} as Record<string,string>)[goal.phase]||goal.phase;
}
function autoNote(goal:Goal){
  if(goal.phase==='active'&&goal.activation==='disarmed')return '目标已启用，但尚未授权自动续跑。点继续后才会推进。';
  if(goal.phase==='active')return '正在自动推进。暂停将在下一轮边界生效。';
  return '';
}
function pendingCount(goal:Goal){
  const value=goal.pendingTurnCount;
  return typeof value==='number'&&Number.isSafeInteger(value)&&value>0?value:0;
}
export const GoalBar=defineComponent({name:'SaCodeGoalBar',props:{adapter:{type:Object as PropType<GoalAdapter>,required:true},editRequest:Number,hideCreate:Boolean},setup(props){
  const version=ref(0),editing=ref(false),expanded=ref(false),draft=ref(''),surface=createGoalSurface(props.adapter,()=>version.value++);let timer:ReturnType<typeof setInterval>;
  onMounted(()=>{void surface.refresh();timer=setInterval(()=>void surface.refresh(),2000);});
  onBeforeUnmount(()=>{clearInterval(timer);surface.dispose();});
  const begin=()=>{draft.value=surface.state.goal?.objective||'';editing.value=true;};
  watch(()=>props.editRequest,()=>{if(!surface.state.busy)begin();});
  const save=async()=>{const current=surface.state.goal,edit=!!current?.id&&['active','paused','blocked','complete'].includes(current.phase);if(await surface.mutate(edit?'edit':'create',draft.value))editing.value=false;};
  const button=(text:string,click:()=>void)=>h('button',{type:'button',disabled:surface.state.busy,onClick:click},text);
  const iconButton=(label:string,path:string,click:()=>void)=>h('button',{class:'goal-icon-action',type:'button',disabled:surface.state.busy,'aria-label':label,title:label,onClick:click},[h('svg',{width:16,height:16,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor','stroke-width':1.6,'stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true'},[h('path',{d:path})])]);
  return()=>{void version.value;const {goal,busy,error,loaded}=surface.state;
    const pending=goal?pendingCount(goal):0;
    // 已完成但仍有未消费补充时也保留目标栏：没有后续自动轮次，必须让人看见待处理数量。
    const visible=!!goal?.id&&(['active','paused','blocked'].includes(goal.phase)||(goal.phase==='complete'&&pending>0));
    if(!loaded&&!error)return null;
    // 无目标且允许隐藏时不能整组件卸载：编辑请求（editRequest）由本组件的 watch 接收，
    // 一旦卸载，「＋→设置目标」递增的计数器无人监听，界面永远无反应。
    // 保留隐藏挂载点，watch 触发后 editing 置位即原地展开编辑器。
    if(props.hideCreate&&!visible&&!editing.value&&!error)return h('section',{class:'goal-root goal-dormant','data-goal-bar':'dormant','aria-hidden':'true',style:'display:none'});
    const canPause=!!(visible&&goal!.phase==='active'&&goal!.activation!=='disarmed');
    const canResume=!!(visible&&goal!.phase!=='complete'&&!canPause);
    const remaining=visible&&goal!.remainingRounds!=null?` · 剩余 ${goal!.remainingRounds} 轮`:'';
    const note=visible?autoNote(goal!):'';
    return h('section',{class:'goal-root','data-goal-bar':'','aria-label':'持续目标','aria-busy':busy},[
      visible?h('div',{class:'goal-header'},[h('button',{class:'goal-summary',type:'button',title:goal!.objective,'aria-label':expanded.value?'收起目标正文':'展开目标正文','aria-expanded':expanded.value,onClick:()=>expanded.value=!expanded.value},[h('svg',{width:16,height:16,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor','aria-hidden':'true'},[h('circle',{cx:12,cy:12,r:8}),h('circle',{cx:12,cy:12,r:3})]),h('span',{},goal!.objective)]),h('span',{class:'goal-phase'},phaseLabel(goal!)),...(pending?[h('span',{class:'goal-pending',title:`有 ${pending} 条补充输入已入队，尚未被轮次消费`,style:'flex:none;white-space:nowrap;font-size:11px;color:var(--text-muted);font-variant-numeric:tabular-nums'},`待处理 ${pending}`)]:[]),h('span',{class:'goal-metrics',title:`${goal!.roundsDone} 轮 · 运行时长 ${goal!.elapsedSeconds} 秒${remaining}`},[h('span',{class:'goal-metrics-full'},`${goal!.roundsDone} 轮 · 运行时长 ${goal!.elapsedSeconds} 秒${remaining}`),h('span',{class:'goal-metrics-compact','aria-label':`运行时长 ${goal!.elapsedSeconds} 秒`},`${Math.floor(goal!.elapsedSeconds/60)}:${String(goal!.elapsedSeconds%60).padStart(2,'0')}`)]),
        ...(canPause?[iconButton('暂停目标','M8 5v14M16 5v14',()=>void surface.mutate('pause'))]:canResume?[iconButton('继续目标','M8 5l11 7-11 7z',()=>void surface.mutate('resume'))]:[]),iconButton('编辑目标','M15 4l5 5M4 20l4-1L20 7l-3-3L5 16z',begin),iconButton('删除目标','M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5M14 11v5',async()=>{if(await surface.mutate('clear'))editing.value=false;})]):loaded&&!editing.value?button('设置持续目标',begin):null,
      visible&&expanded.value?h('p',{class:'goal-objective'},goal!.objective):null,
      visible&&note?h('p',{class:'goal-note'},note):null,
      visible&&pending?h('p',{class:'goal-note goal-pending-note',role:'status'},`有 ${pending} 条补充输入待处理（尚未执行）。`):null,
      visible&&goal!.blockedReason?h('p',{class:'goal-error'},goal!.blockedReason):null,
      editing.value?h('form',{class:'goal-editor',onSubmit:(e:Event)=>{e.preventDefault();void save();}},[
        h('label',{},['目标正文',h(InlineEditor,{value:draft.value,label:'目标正文',maxlength:8000,busy,onChange:(text:string)=>draft.value=text,onSave:()=>void save(),onCancel:()=>editing.value=false})]),
        h('div',{class:'goal-actions'},[h('button',{type:'submit',disabled:busy||!draft.value.trim()},busy?'保存中…':'保存'),button('取消',()=>editing.value=false)]),
      ]):null,
      error?h('p',{class:'goal-error',role:'alert'},error):null,
    ]);
  };
}});
