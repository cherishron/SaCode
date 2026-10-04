// 会话模型选择的界面状态均派生自共享目录；不持有第二份已保存选择。
import {defineComponent,h,ref,computed,watch,nextTick,onMounted,onBeforeUnmount,useId,type PropType} from 'vue';
import {rankByName} from './rank-by-name';
export interface Selection {provider:string;model:string;reasoningEffort?:string}
export interface Model {id:string;name:string;reasoning?:{defaultEffort?:string;efforts:{id:string;name:string}[]}}
export interface Group {id:string;name:string;credentialKind?:'api-key'|'account';models:readonly Model[]}
export interface Snapshot {current:Selection|null;retainedEffort?:string;routable:boolean|null;groups:Group[];failures:{provider:string;name:string;message:string}[];status:'idle'|'loading'|'ready'|'selecting'|'error';pending:Selection|null;error:string|null}
export interface Directory {getSnapshot():Snapshot;subscribe(invalidate:()=>void):()=>void;load():Promise<void>;select(value:Selection):Promise<void>}
const empty=():Snapshot=>({current:null,routable:null,groups:[],failures:[],status:'idle',pending:null,error:null});
const el=(tag:string,cls:string,children:any,props:any={})=>h(tag,{class:'model-select-'+cls,...props},children);
let instance=0;
export const Select=defineComponent({name:'SaCodeModelSelect',props:{directory:Object as PropType<Directory>,locked:Boolean},setup(props){
  const uid='model-select-'+useId()+'-'+(++instance),snapshot=ref<Snapshot>(props.directory?.getSnapshot()||empty()),open=ref(false),pane=ref<'root'|'model'|'effort'>('root'),query=ref(''),highlight=ref(0),toast=ref('');
  const trigger=ref<HTMLButtonElement|null>(null),panel=ref<HTMLDivElement|null>(null),search=ref<HTMLInputElement|null>(null);
  const toastNode=ref<HTMLParagraphElement|null>(null);
  let off:(()=>void)|undefined,disposed=false,frame=0,observer:ResizeObserver|null=null,lastAction:'load'|'select'='load',toastTimer:ReturnType<typeof setTimeout>|undefined,rootFrom:'model'|'effort'='model';
  const groups=computed(()=>snapshot.value.groups.filter(g=>g.credentialKind!=='account'&&g.id!=='deepseek-account'));
  const choices=computed(()=>groups.value.flatMap(g=>g.models.map(m=>({group:g,model:m}))));
  const current=computed(()=>choices.value.find(c=>c.group.id===snapshot.value.current?.provider&&c.model.id===snapshot.value.current?.model));
  const reasoning=computed(()=>current.value?.model.reasoning),effectiveEffort=computed(()=>snapshot.value.current?.reasoningEffort??reasoning.value?.defaultEffort);
  const effortLabel=computed(()=>reasoning.value?(reasoning.value.efforts.find(e=>e.id===effectiveEffort.value)?.name||effectiveEffort.value||'默认'):snapshot.value.retainedEffort);
  const effortChoices=computed(()=>reasoning.value?[...reasoning.value.defaultEffort===undefined?[{id:undefined,name:'默认'}]:[],...reasoning.value.efforts]:[]);
  const showSearch=computed(()=>choices.value.length>4);
  const filtered=computed(()=>groups.value.map(g=>({...g,models:rankByName(g.models,showSearch.value?query.value.trim():'')})).filter(g=>g.models.length));
  const visible=computed(()=>filtered.value.flatMap(g=>g.models.map(m=>({group:g,model:m}))));
  const busy=computed(()=>props.locked||snapshot.value.pending!==null||snapshot.value.status==='selecting');
  const caption=computed(()=>current.value?.model.name||snapshot.value.current?.model||(snapshot.value.status==='loading'?'正在加载模型…':'请选择模型'));
  const place=()=>{frame=0;if(!open.value||!trigger.value||!panel.value)return;const a=trigger.value.getBoundingClientRect(),p=panel.value.getBoundingClientRect(),margin=12,gap=6,above=a.top-gap-margin,below=innerHeight-a.bottom-gap-margin,up=above>=p.height||above>=below;
    panel.value.style.maxHeight=Math.max(40,Math.min(innerHeight-margin*2,up?above:below))+'px';const height=Math.min(p.height,parseFloat(panel.value.style.maxHeight));panel.value.style.left=Math.max(margin,Math.min(a.left,innerWidth-margin-p.width))+'px';panel.value.style.top=Math.max(margin,Math.min(up?a.top-gap-height:a.bottom+gap,innerHeight-margin-height))+'px';};
  const placeToast=()=>{if(!toast.value||!toastNode.value||!trigger.value)return;const a=trigger.value.getBoundingClientRect(),p=toastNode.value.getBoundingClientRect();toastNode.value.style.left=Math.max(12,Math.min(a.left,innerWidth-p.width-12))+'px';toastNode.value.style.top=Math.max(12,a.top-p.height-8)+'px';};
  const schedule=()=>{if(!frame)frame=requestAnimationFrame(()=>{place();placeToast();});};
  const focusPane=()=>void nextTick(()=>{if(pane.value==='model'&&showSearch.value)search.value?.focus();else if(pane.value==='root')panel.value?.querySelector<HTMLButtonElement>(`[data-model-root=${rootFrom}]`)?.focus();else (panel.value?.querySelector<HTMLButtonElement>('[data-selected=true]')||panel.value?.querySelector<HTMLButtonElement>('[role=menuitem]'))?.focus();});
  const close=(restore=true)=>{open.value=false;if(restore)void nextTick(()=>trigger.value?.focus({preventScroll:true}));};
  const drill=(value:'root'|'model'|'effort')=>{if(value!=='root')rootFrom=value;pane.value=value;highlight.value=0;focusPane();schedule();};
  const load=async()=>{if(!props.directory)return;lastAction='load';try{await props.directory.load();}catch{/* 目录错误由共享快照提供。 */}if(!disposed)snapshot.value=props.directory.getSnapshot();};
  const choose=async(value:Selection)=>{if(!props.directory||busy.value)return;lastAction='select';toast.value='';try{await props.directory.select(value);if(!disposed){snapshot.value=props.directory.getSnapshot();if(snapshot.value.error)throw Error(snapshot.value.error);close();}}catch(e){if(!disposed){toast.value='模型操作失败：'+((e as Error).message||'请重试');clearTimeout(toastTimer);toastTimer=setTimeout(()=>toast.value='',6000);}}};
  const chooseModel=(c:{group:Group;model:Model})=>void choose({provider:c.group.id,model:c.model.id,...c.model.reasoning?.defaultEffort===undefined?{}:{reasoningEffort:c.model.reasoning.defaultEffort}});
  const outside=(event:PointerEvent)=>{if(open.value&&event.target instanceof Node&&!trigger.value?.contains(event.target)&&!panel.value?.contains(event.target))close(false);};
  const escape=(event:KeyboardEvent)=>{if(!open.value||event.key!=='Escape')return;event.preventDefault();event.stopImmediatePropagation();if(pane.value!=='root')drill('root');else close();};
  onMounted(()=>{off=props.directory?.subscribe(()=>{snapshot.value=props.directory!.getSnapshot();});observer=new ResizeObserver(schedule);if(panel.value)observer.observe(panel.value);if(trigger.value)observer.observe(trigger.value);window.addEventListener('resize',schedule);window.addEventListener('scroll',schedule,true);document.addEventListener('pointerdown',outside,true);document.addEventListener('keydown',escape,true);});
  onBeforeUnmount(()=>{disposed=true;off?.();observer?.disconnect();cancelAnimationFrame(frame);clearTimeout(toastTimer);window.removeEventListener('resize',schedule);window.removeEventListener('scroll',schedule,true);document.removeEventListener('pointerdown',outside,true);document.removeEventListener('keydown',escape,true);if(panel.value?.matches(':popover-open'))panel.value.hidePopover();if(toastNode.value?.matches(':popover-open'))toastNode.value.hidePopover();});
  watch(toast,async value=>{await nextTick();if(disposed||!toastNode.value)return;const shown=toastNode.value.matches(':popover-open');if(value){if(!shown)toastNode.value.showPopover();placeToast();}else if(shown)toastNode.value.hidePopover();},{flush:'post'});
  watch(open,async value=>{await nextTick();if(disposed||!panel.value)return;if(value){pane.value='root';query.value='';panel.value.showPopover();place();focusPane();void load();}else if(panel.value.matches(':popover-open'))panel.value.hidePopover();},{flush:'post'});
  watch([pane,query,filtered],()=>{highlight.value=Math.min(highlight.value,Math.max(0,visible.value.length-1));schedule();},{flush:'post'});
  const key=(event:KeyboardEvent)=>{if(event.isComposing||event.keyCode===229)return;
    if(event.key==='Tab'&&event.shiftKey){event.preventDefault();pane.value==='root'?close():drill('root');return;}
    if(pane.value==='model'&&showSearch.value){if(['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();if(!busy.value&&visible.value.length)highlight.value=(highlight.value+(event.key==='ArrowDown'?1:-1)+visible.value.length)%visible.value.length;search.value?.focus();return;}if(event.target instanceof HTMLInputElement&&(event.key==='Enter'||event.key==='Tab')){if(visible.value[highlight.value]){event.preventDefault();chooseModel(visible.value[highlight.value]);}return;}}
    const rows=Array.from(panel.value?.querySelectorAll<HTMLButtonElement>('[role=menuitem]:not(:disabled)')||[]);if(!rows.length)return;const index=rows.indexOf(document.activeElement as HTMLButtonElement);
    if(['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();rows[(index+(event.key==='ArrowDown'?1:-1)+rows.length)%rows.length].focus();}else if(event.key==='Tab'){event.preventDefault();if(pane.value==='root')close();else drill('root');}
  };
  const row=(text:string,onClick:()=>void,selected=false,props:any={})=>el('button','row',[el('span','rowLabel',text),selected?el('span','check','✓',{'aria-hidden':true}):null],{type:'button',role:'menuitem',disabled:busy.value,'data-selected':selected,onClick,...props});
  return()=>el('div','root',[
    el('button','trigger',[el('span','caption',caption.value),effortLabel.value?el('span','effort',effortLabel.value):null,el('span','chevron',busy.value?'…':'⌄',{'aria-hidden':true})],{ref:trigger,type:'button','aria-label':snapshot.value.current?'选择模型，当前 '+caption.value+(effortLabel.value?'，推理等级 '+effortLabel.value:''):'请选择模型','aria-expanded':open.value,'aria-controls':uid,'aria-haspopup':'menu',disabled:!props.directory||props.locked,title:!props.directory?'模型选择接口尚未接入':undefined,onClick:()=>open.value=!open.value}),
    el('div','menu',[
      snapshot.value.status==='loading'?el('p','status','正在刷新模型列表…',{role:'status'}):null,
      lastAction==='load'&&snapshot.value.error?el('div','error',[snapshot.value.error,row('重新加载',()=>void load())],{role:'alert'}):null,
      ...snapshot.value.failures.map(f=>el('p','warning',`${f.name} 加载失败：${f.message}`,{key:f.provider,role:'status'})),
      pane.value==='root'?[row('模型 · '+caption.value,()=>drill('model'),false,{'data-model-root':'model'}),reasoning.value?row('推理等级 · '+(effortLabel.value||'默认'),()=>drill('effort'),false,{'data-model-root':'effort'}):null]:[
        row('返回',()=>drill('root'),false,{'data-model-back':''}),
        pane.value==='model'?[
          showSearch.value?el('div','search',[el('input','searchInput',null,{ref:search,type:'search',value:query.value,placeholder:'搜索模型…','aria-label':'搜索模型','aria-controls':uid+'-results','aria-activedescendant':visible.value.length?uid+'-choice-'+highlight.value:undefined,onInput:(e:Event)=>{query.value=(e.target as HTMLInputElement).value;highlight.value=0;}}),query.value?row('清除搜索',()=>{query.value='';void nextTick(()=>search.value?.focus());}):null]):null,
          !visible.value.length?el('p','status',query.value?'没有匹配的模型。':'没有可用的模型。'):null,
          el('div','groups',filtered.value.map(g=>el('section','group',[el('h3','provider',g.name),...g.models.map(m=>{const index=visible.value.findIndex(c=>c.group.id===g.id&&c.model.id===m.id);return row(m.name,()=>chooseModel({group:g,model:m}),snapshot.value.current?.provider===g.id&&snapshot.value.current.model===m.id,{id:uid+'-choice-'+index,key:JSON.stringify([g.id,m.id]),'data-model-provider':g.id,'data-model-id':m.id,'data-highlighted':showSearch.value&&highlight.value===index});})],{key:g.id})),{id:uid+'-results'}),
        ]:effortChoices.value.length?effortChoices.value.map(e=>row(e.name,()=>snapshot.value.current&&void choose({...snapshot.value.current,reasoningEffort:e.id}),effectiveEffort.value===e.id,{key:e.id||'default','data-effort-id':e.id||'default'})):el('p','status','当前模型未提供推理等级。'),
      ],
    ],{ref:panel,id:uid,popover:'manual',role:'menu','aria-label':'模型与推理等级',onKeydown:key}),
    el('p','toast',toast.value,{ref:toastNode,popover:'manual',role:'alert'}),
  ]);
}});
