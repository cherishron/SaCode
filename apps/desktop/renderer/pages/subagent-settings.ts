// 子智能体委派限制与模型授权；两命名空间分别带修订屏障，共用保存页脚。
import {defineComponent,h,ref,computed,onMounted,onBeforeUnmount,useId,type PropType} from 'vue';
export interface Route {provider:string;model:string}
export interface Candidate extends Route {providerName:string;modelName:string;available:boolean}
export interface Limits {revision:string;writable:boolean;maxDepth:{text:string;overridden:boolean};maxActiveSubagents:{text:string;overridden:boolean}}
export interface Selection {revision:string;writable:boolean;enabled:boolean;allowedModels:Route[]}
export interface Snapshot {limits:Limits|null;selection:Selection|null}
export type LimitPatch={key:string;op:'unset'}|{key:string;op:'set';value:number};
export interface Adapter {
  read():Promise<Snapshot>;catalog():Promise<{candidates:Candidate[];partial:boolean}>;
  saveLimits(patches:LimitPatch[],revision:string):Promise<Limits>;
  saveSelection(enabled:boolean,routes:Route[],revision:string):Promise<Selection>;
  subscribe?(invalidate:()=>void):()=>void;
}
const routeKey=(r:Route)=>JSON.stringify([r.provider,r.model]);
const sameRoutes=(a:Route[],b:Route[])=>JSON.stringify(a.map(routeKey).sort())===JSON.stringify(b.map(routeKey).sort());
const el=(tag:string,cls:string,children:any,props:any={})=>h(tag,{class:'subagent-'+cls,...props},children);
let instance=0;
export const Card=defineComponent({name:'SaCodeSubagentSettings',props:{adapter:Object as PropType<Adapter>},setup(props){
  const uid='subagent-'+useId()+'-'+(++instance), snapshot=ref<Snapshot>({limits:null,selection:null});
  const drafts=ref<Record<string,string>>({}),limitRevision=ref<string|null>(null),selectionRevision=ref<string|null>(null);
  const enabledDraft=ref<boolean|null>(null),routesDraft=ref<Route[]|null>(null),busy=ref(false),failure=ref(''),conflict=ref(false),loading=ref(false);
  const catalog=ref<Candidate[]>([]),catalogStatus=ref<'idle'|'loading'|'ready'|'error'>('idle'),partial=ref(false);
  let readGeneration=0,catalogGeneration=0,disposed=false,off:(()=>void)|undefined;
  const enabled=computed(()=>enabledDraft.value??snapshot.value.selection?.enabled??false);
  const routes=computed(()=>routesDraft.value??snapshot.value.selection?.allowedModels??[]);
  const loadCatalog=async()=>{if(!props.adapter)return;const token=++catalogGeneration;catalogStatus.value='loading';try{const value=await props.adapter.catalog();if(!disposed&&token===catalogGeneration){catalog.value=value.candidates.filter(r=>r.provider!=='deepseek-account');partial.value=value.partial;catalogStatus.value='ready';}}catch{if(!disposed&&token===catalogGeneration)catalogStatus.value='error';}};
  const read=async()=>{if(!props.adapter)return;const token=++readGeneration;loading.value=true;try{const value=await props.adapter.read();if(disposed||token!==readGeneration)return;
    if(selectionRevision.value!==null&&selectionRevision.value!==value.selection?.revision){
      if(value.selection&&enabled.value===value.selection.enabled&&sameRoutes(routes.value,value.selection.allowedModels)){enabledDraft.value=null;routesDraft.value=null;selectionRevision.value=null;conflict.value=false;}
      else conflict.value=true;
    }
    snapshot.value=value;if(enabled.value&&catalogStatus.value==='idle')void loadCatalog();
  }catch{if(!disposed&&token===readGeneration)failure.value='暂时无法读取子智能体设置，请重试。';}finally{if(!disposed&&token===readGeneration)loading.value=false;}};
  onMounted(()=>{off=props.adapter?.subscribe?.(()=>{void read();});void read();});
  onBeforeUnmount(()=>{disposed=true;readGeneration++;catalogGeneration++;off?.();drafts.value={};enabledDraft.value=null;routesDraft.value=null;});
  const edit=(field:string,text:string)=>{if(limitRevision.value===null)limitRevision.value=snapshot.value.limits?.revision||'';drafts.value={...drafts.value,[field]:text};failure.value='';};
  const beginSelection=()=>{if(selectionRevision.value===null){selectionRevision.value=snapshot.value.selection?.revision||'';enabledDraft.value=enabled.value;routesDraft.value=routes.value.map(r=>({...r}));}};
  const toggle=()=>{beginSelection();enabledDraft.value=!enabled.value;if(enabled.value&&catalogStatus.value==='idle')void loadCatalog();};
  const choose=(r:Route)=>{beginSelection();const key=routeKey(r);routesDraft.value=routes.value.some(v=>routeKey(v)===key)?routes.value.filter(v=>routeKey(v)!==key):[...routes.value,{provider:r.provider,model:r.model}];};
  const fields=[{key:'maxDepth' as const,label:'最大递归层级',minimum:0},{key:'maxActiveSubagents' as const,label:'子智能体并发上限',minimum:1}];
  const invalidLimits=computed(()=>fields.some(f=>{const text=drafts.value[f.key];if(text===undefined||text.trim()==='')return false;const n=Number(text);return !Number.isSafeInteger(n)||n<f.minimum||Object.is(n,-0);}));
  const plan=computed(()=>fields.flatMap<LimitPatch>(f=>{const text=drafts.value[f.key];if(text===undefined)return [];const accepted=snapshot.value.limits?.[f.key];if(!text.trim())return accepted?.overridden?[{key:f.key,op:'unset' as const}]:[];const value=Number(text);return accepted?.overridden&&accepted.text===String(value)?[]:[{key:f.key,op:'set' as const,value}];}));
  const selectionDirty=computed(()=>selectionRevision.value!==null&&(enabled.value!==snapshot.value.selection?.enabled||JSON.stringify(routes.value.map(routeKey).sort())!==JSON.stringify((snapshot.value.selection?.allowedModels||[]).map(routeKey).sort())));
  const invalidSelection=computed(()=>enabled.value&&routes.value.length===0);
  const canSave=computed(()=>!busy.value&&!invalidLimits.value&&!invalidSelection.value&&!conflict.value&&!!(plan.value.length||selectionDirty.value)&&(!plan.value.length||snapshot.value.limits?.writable)&&(!selectionDirty.value||snapshot.value.selection?.writable));
  const save=async()=>{if(!props.adapter||!canSave.value)return;busy.value=true;failure.value='';try{
    if(plan.value.length){snapshot.value={...snapshot.value,limits:await props.adapter.saveLimits(plan.value,limitRevision.value||snapshot.value.limits!.revision)};drafts.value={};limitRevision.value=null;}
    if(selectionDirty.value){snapshot.value={...snapshot.value,selection:await props.adapter.saveSelection(enabled.value,routes.value,selectionRevision.value||snapshot.value.selection!.revision)};enabledDraft.value=null;routesDraft.value=null;selectionRevision.value=null;}
  }catch(e){if((e as {code?:string})?.code==='settings-conflict')conflict.value=true;else failure.value='本部署没有接受这些值，已保留供你修改。';}finally{busy.value=false;}};
  const candidates=computed(()=>{const all=catalog.value.slice();for(const r of [...(snapshot.value.selection?.allowedModels||[]),...routes.value])if(!all.some(v=>routeKey(v)===routeKey(r)))all.push({...r,providerName:r.provider,modelName:r.model,available:false});return all;});
  const reset=()=>{if(busy.value)return;drafts.value={};limitRevision.value=null;selectionRevision.value=null;enabledDraft.value=null;routesDraft.value=null;conflict.value=false;failure.value='';void read();};
  return()=>{
    const groups=new Map<string,{name:string;rows:Candidate[]}>();for(const candidate of candidates.value){const groupKey=candidate.available?candidate.provider:'unavailable';if(!groups.has(groupKey))groups.set(groupKey,{name:candidate.available?candidate.providerName:'已保存但当前不可用',rows:[]});groups.get(groupKey)!.rows.push(candidate);}
    return el('div','form',[
      !props.adapter?el('p','notice','子智能体配置接口尚未接入。',{role:'status'}):loading.value?el('p','notice','正在读取子智能体设置…',{role:'status'}):!snapshot.value.limits&&!snapshot.value.selection?el('p','notice','该插件当前未加载，暂时无法配置。',{role:'status'}):null,
      snapshot.value.limits?el('section','section',[el('h3','heading','限制'),!snapshot.value.limits.writable?el('p','notice','委派限制为只读。'):null,...fields.map(f=>{const text=drafts.value[f.key]??snapshot.value.limits![f.key].text;const n=Number(text),invalid=text.trim()!==''&&(!Number.isSafeInteger(n)||n<f.minimum||Object.is(n,-0));return el('div','field',[
        el('div','head',[el('label','label',f.label,{for:uid+'-'+f.key}),(f.key in drafts.value?drafts.value[f.key].trim()!=='':snapshot.value.limits![f.key].overridden)?el('span','notice','已覆盖'):null,el('button','reset','恢复默认',{type:'button',disabled:busy.value||!snapshot.value.limits!.writable,onClick:()=>edit(f.key,'')})]),
        el('details','help',[el('summary','helpLabel',f.key==='maxDepth'?'关于最大递归层级':'关于子智能体并发上限'),f.key==='maxDepth'?[el('p','notice','限制 Agent 能创建多少层子智能体。'),h('table',{'aria-label':'递归层级说明'},[h('tbody',[h('tr',[h('th',{scope:'row'},'0'),h('td','禁用子智能体')]),h('tr',[h('th',{scope:'row'},'1'),h('td','仅主 Agent 可创建子智能体')])])]),el('p','notice','若工具定义了自己的最大递归层级，则优先使用工具设置。')]:el('p','notice','同一主 Agent 下，所有递归层级同时存活的子智能体总数，主 Agent 不计入。达到上限时，新的启动请求会被拒绝。')]),
        el('input','input',null,{id:uid+'-'+f.key,'aria-label':f.label,'aria-invalid':invalid,value:text,inputmode:'numeric',disabled:busy.value||!snapshot.value.limits!.writable,onInput:(e:Event)=>edit(f.key,(e.target as HTMLInputElement).value)}),invalid?el('p','invalid',`请输入不小于 ${f.minimum} 的整数。`):null,
      ],{key:f.key});})]):null,
      snapshot.value.selection?el('section','section',[el('h3','heading','模型选择'),!snapshot.value.selection.writable?el('p','notice','模型授权为只读。'):null,el('label','toggle',[el('span','label','允许 Agent 为子智能体选择模型'),el('input','switch',null,{type:'checkbox',role:'switch','aria-label':'允许 Agent 为子智能体选择模型',checked:enabled.value,disabled:busy.value||!snapshot.value.selection.writable,onChange:toggle})]),
        el('p','notice',enabled.value?'开启后，Agent 可以从下方授权模型中，为每个子智能体选择提供方、模型和推理强度。仅影响新会话。':'关闭后，子智能体使用配置的默认模型或继承父 Agent 的模型；已选模型会保留。'),
        enabled.value?[
          catalogStatus.value==='loading'?el('p','notice','正在加载模型…',{role:'status'}):catalogStatus.value==='error'?el('div','invalid',[el('p','notice','无法加载模型。',{role:'alert'}),el('button','reset','重试',{type:'button',disabled:busy.value,onClick:loadCatalog})]):null,
          partial.value?el('p','notice','部分模型提供方暂时无法加载；已保存的选择仍可移除。'):null,
          ...[...groups].map(([key,group])=>el('fieldset','models',[h('legend',group.name),...group.rows.map(r=>el('label','model',[el('input','checkbox',null,{type:'checkbox','aria-label':r.provider+'/'+r.model,checked:routes.value.some(v=>routeKey(v)===routeKey(r)),disabled:busy.value||!snapshot.value.selection!.writable,onChange:()=>choose(r)}),el('span','modelText',[el('span','modelName',r.modelName),el('span','route',r.providerName+' · '+r.provider+'/'+r.model)]),!r.available?el('span','notice','当前不可用'):null],{key:routeKey(r)}))],{key})),
          !candidates.value.length&&catalogStatus.value==='ready'?el('p','notice','当前没有模型提供方公布模型。'):null,
          invalidSelection.value?el('p','invalid','保存前请至少选择一个模型。'):null,
        ]:null,
      ]):null,
      conflict.value?el('p','invalid','设置已在其他位置更新。请放弃修改后重试。',{role:'status'}):null,
      failure.value?el('p','invalid',failure.value,{role:'status'}):null,
      failure.value||conflict.value?el('button','reset','放弃修改并重新读取',{type:'button',disabled:busy.value,onClick:reset}):null,
      snapshot.value.limits||snapshot.value.selection?el('div','footer',[el('button','save',busy.value?'保存中…':'保存',{type:'button',disabled:!canSave.value,onClick:save})]):null,
    ]);
  };
}});
