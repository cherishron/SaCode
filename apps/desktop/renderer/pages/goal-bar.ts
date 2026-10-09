// 目标栏承接冻结 DSH 的 Todo → Goal → Queue 顺序；业务状态与 CAS 均来自仓颉。
import {defineComponent,h,ref,watch,onMounted,onBeforeUnmount,type PropType} from 'vue';
import {InlineEditor} from './inline-editor';
export type Goal={id:string;revision:number;phase:string;objective:string;blockedReason:string;roundsDone:number;elapsedSeconds:number};
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
export const GoalBar=defineComponent({name:'SaCodeGoalBar',props:{adapter:{type:Object as PropType<GoalAdapter>,required:true},editRequest:Number,hideCreate:Boolean},setup(props){
  const version=ref(0),editing=ref(false),draft=ref(''),surface=createGoalSurface(props.adapter,()=>version.value++);let timer:ReturnType<typeof setInterval>;
  onMounted(()=>{void surface.refresh();timer=setInterval(()=>void surface.refresh(),2000);});
  onBeforeUnmount(()=>{clearInterval(timer);surface.dispose();});
  const begin=()=>{draft.value=surface.state.goal?.objective||'';editing.value=true;};
  watch(()=>props.editRequest,()=>{if(!surface.state.busy)begin();});
  const save=async()=>{const current=surface.state.goal,edit=!!current?.id&&['active','paused','blocked'].includes(current.phase);if(await surface.mutate(edit?'edit':'create',draft.value))editing.value=false;};
  const button=(text:string,click:()=>void)=>h('button',{type:'button',disabled:surface.state.busy,onClick:click},text);
  const iconButton=(label:string,path:string,click:()=>void)=>h('button',{class:'goal-icon-action',type:'button',disabled:surface.state.busy,'aria-label':label,title:label,onClick:click},[h('svg',{width:16,height:16,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor','stroke-width':1.6,'stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true'},[h('path',{d:path})])]);
  return()=>{void version.value;const {goal,busy,error,loaded}=surface.state,visible=!!goal?.id&&['active','paused','blocked'].includes(goal.phase);
    if(!loaded&&!error)return null;
    if(props.hideCreate&&!visible&&!editing.value&&!error)return null;
    return h('section',{class:'goal-root','data-goal-bar':'','aria-label':'持续目标','aria-busy':busy},[
      visible?h('div',{class:'goal-header'},[h('strong',{},'目标'),h('span',{class:'goal-phase'},({active:'已启用',paused:'已暂停',blocked:'受阻'} as Record<string,string>)[goal!.phase]||goal!.phase),h('span',{class:'goal-metrics'},`${goal!.roundsDone} 轮 · ${goal!.elapsedSeconds} 秒`),
        goal!.phase==='active'?iconButton('暂停目标','M8 5v14M16 5v14',()=>void surface.mutate('pause')):iconButton('继续目标','M8 5l11 7-11 7z',()=>void surface.mutate('resume')),iconButton('编辑目标','M15 4l5 5M4 20l4-1L20 7l-3-3L5 16z',begin),iconButton('删除目标','M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5M14 11v5',async()=>{if(await surface.mutate('clear'))editing.value=false;})]):loaded&&!editing.value?button('设置持续目标',begin):null,
      visible?h('p',{class:'goal-objective'},goal!.objective):null,
      visible?h('p',{class:'goal-note'},'目标已保存；自动跨轮执行尚未接通。暂停将在下一轮边界生效。'):null,
      visible&&goal!.blockedReason?h('p',{class:'goal-error'},goal!.blockedReason):null,
      editing.value?h('form',{class:'goal-editor',onSubmit:(e:Event)=>{e.preventDefault();void save();}},[
        h('label',{},['目标正文',h(InlineEditor,{value:draft.value,label:'目标正文',maxlength:8000,busy,onChange:(text:string)=>draft.value=text,onSave:()=>void save(),onCancel:()=>editing.value=false})]),
        h('div',{class:'goal-actions'},[h('button',{type:'submit',disabled:busy||!draft.value.trim()},busy?'保存中…':'保存'),button('取消',()=>editing.value=false)]),
      ]):null,
      error?h('p',{class:'goal-error',role:'alert'},error):null,
    ]);
  };
}});
