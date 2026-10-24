// 输入区统计只呈现宿主读数；不把墙钟、金额或上下文占用冒充计量。
import {defineComponent,h,ref,watch,nextTick,onMounted,onBeforeUnmount,type PropType} from 'vue';
export type Activity={elapsedMs?:number;ttftMs?:number;tokensPerSecond?:number};
const valid=(n:any):n is number=>typeof n==='number'&&Number.isFinite(n)&&n>=0;
export function activityOf(p:any):Activity|null {
  const out:Activity={};
  for(const key of ['elapsedMs','ttftMs','tokensPerSecond'] as const)if(valid(p?.[key]))out[key]=p[key];
  return Object.keys(out).length?out:null;
}
export function duration(ms:number){const s=Math.floor(ms/1000);return s>=60?`${Math.floor(s/60)}分${s%60}秒`:`${s}秒`;}
export function compactTokens(n:number){return n>=1e6?`${Number((n/1e6).toFixed(2))}M`:n>=1000?`${Number((n/1000).toFixed(2))}K`:String(n);}
export function usageOf(status:any,ledger:any){
  // tokenTotals 是累计维度契约；旧宿主只有金额分组，不读取 providerTotals/modelTotals 猜 token。
  const candidate=ledger?.tokenTotals??(valid(ledger?.input)?ledger:null)??status?.tokenTotals??status;
  const complete=['input','cacheRead','cacheWrite','output'].every(k=>valid(candidate?.[k]));
  if(complete){const {input,cacheRead,cacheWrite,output}=candidate,total=input+cacheRead+cacheWrite+output;
    if(!Number.isSafeInteger(total))return null;
    return {total,input,cacheRead,cacheWrite,output,hit:input+cacheRead>0?cacheRead/(cacheRead+input):null};}
  return valid(status?.used)?{total:status.used,input:null,cacheRead:null,cacheWrite:null,output:null,hit:null}:null;
}
let sequence=0;
const row=(label:string,value:string)=>h('div',{class:'composer-stat-detail'},[h('dt',label),h('dd',value)]);
// 手动 top-layer popover：不锁焦点、不加遮罩；再次点击、外点及 Escape 都关闭。
export const StatPill=defineComponent({name:'SaCodeStatPill',props:{label:String,title:String,resetKey:String},setup(props,{slots}){
  const anchor=ref<HTMLButtonElement|null>(null),panel=ref<HTMLElement|null>(null),open=ref(false),id='composer-stat-'+(++sequence);let disposed=false,observer:ResizeObserver|undefined;
  const place=()=>{const a=anchor.value,p=panel.value;if(!open.value||!a||!p)return;const r=a.getBoundingClientRect();p.style.maxHeight=Math.max(40,innerHeight-24)+'px';const b=p.getBoundingClientRect();p.style.left=Math.max(12,Math.min(r.left,innerWidth-12-b.width))+'px';p.style.top=Math.max(12,Math.min(r.top-8-b.height>=12?r.top-8-b.height:r.bottom+8,innerHeight-12-b.height))+'px';};
  const sync=async()=>{await nextTick();if(disposed||!panel.value)return;const p=panel.value;if(open.value&&!p.matches(':popover-open'))p.showPopover();if(!open.value&&p.matches(':popover-open'))p.hidePopover();place();};
  const close=()=>{open.value=false;};
  const outside=(e:PointerEvent)=>{if(open.value&&!anchor.value?.contains(e.target as Node)&&!panel.value?.contains(e.target as Node))close();};
  const escape=(e:KeyboardEvent)=>{if(open.value&&e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();close();anchor.value?.focus({preventScroll:true});}};
  watch(open,()=>void sync(),{flush:'post'});watch(()=>props.resetKey,close);
  onMounted(()=>{observer=new ResizeObserver(place);if(anchor.value)observer.observe(anchor.value);if(panel.value)observer.observe(panel.value);document.addEventListener('pointerdown',outside,true);document.addEventListener('keydown',escape,true);window.addEventListener('resize',place);window.addEventListener('scroll',place,true);});
  onBeforeUnmount(()=>{disposed=true;observer?.disconnect();document.removeEventListener('pointerdown',outside,true);document.removeEventListener('keydown',escape,true);window.removeEventListener('resize',place);window.removeEventListener('scroll',place,true);if(panel.value?.matches(':popover-open'))panel.value.hidePopover();});
  return()=>h('span',{class:'composer-stat'},[h('button',{ref:anchor,type:'button',class:'composer-stat-trigger','aria-label':props.title,'aria-haspopup':'dialog','aria-expanded':open.value,'aria-controls':id,onClick:()=>{open.value=!open.value;}},props.label),h('div',{ref:panel,id,class:'composer-stat-panel',popover:'manual',role:'dialog','aria-label':props.title},[h('strong',props.title),h('dl',slots.default?.())])]);
}});
export const ActivityPill=defineComponent({name:'SaCodeActivityPill',props:{activity:Object as PropType<Activity>,resetKey:String},setup(props){return()=>{
  const a=activityOf(props.activity);if(!a)return null;
  const values=[valid(a.elapsedMs)?duration(a.elapsedMs):null,valid(a.ttftMs)?`TTFT ${(a.ttftMs/1000).toFixed(1)}s`:null,valid(a.tokensPerSecond)?`${Math.round(a.tokensPerSecond)} tok/s`:null].filter(Boolean);
  return h(StatPill,{label:values.join(' · '),title:'本轮活动统计',resetKey:props.resetKey},{default:()=>[valid(a.elapsedMs)?row('用时',duration(a.elapsedMs)):null,valid(a.ttftMs)?row('首 token 延迟',`${(a.ttftMs/1000).toFixed(1)}s`):null,valid(a.tokensPerSecond)?row('输出速度',`${Math.round(a.tokensPerSecond)} tok/s`):null]});
}}});
export const UsagePill=defineComponent({name:'SaCodeUsagePill',props:{usage:Object,resetKey:String},setup(props){return()=>{
  const u=props.usage as ReturnType<typeof usageOf>;if(!u)return null;
  const fmt=(v:number|null)=>v===null?'—':compactTokens(v);
  return h(StatPill,{label:compactTokens(u.total),title:'累计 token 用量',resetKey:props.resetKey},{default:()=>[row('缓存命中率',u.hit===null?'—':`${(u.hit*100).toFixed(1)}%`),row('未缓存输入',fmt(u.input)),row('缓存读取',fmt(u.cacheRead)),row('缓存写入',fmt(u.cacheWrite)),row('输出',fmt(u.output)),u.input===null?h('p',{class:'composer-stat-note'},'宿主尚未提供 token 明细；不从总量反推缓存命中率。'):null]});
}}});
export const ComposerStats=defineComponent({name:'SaCodeComposerStats',props:{sessionId:String,modelKey:String,activity:Object as PropType<Activity>,settled:Boolean,empty:Boolean,api:Object},setup(props){
  const usage=ref<ReturnType<typeof usageOf>>(null);let generation=0,disposed=false;
  const load=async()=>{const ticket=++generation;usage.value=null;const api=props.api as any;if(!api?.usageStatus)return;try{const [status,ledger]=await Promise.all([api.usageStatus(),typeof api.ledgerStats==='function'?api.ledgerStats().catch(()=>null):null]);if(!disposed&&ticket===generation)usage.value=usageOf(status,ledger);}catch{/* 读失败保持未知，不回填旧会话。 */}};
  watch(()=>props.sessionId,()=>void load(),{immediate:true,flush:'sync'});watch(()=>props.settled,settled=>{if(settled)void load();});
  onBeforeUnmount(()=>{disposed=true;generation++;});
  return()=>props.empty||(!activityOf(props.activity)&&!usage.value)?null:h('div',{class:'composer-stats-row','aria-label':'活动与用量统计'},[h(ActivityPill,{key:props.modelKey,activity:props.activity,resetKey:props.sessionId+':'+props.modelKey}),h(UsagePill,{usage:usage.value,resetKey:props.sessionId})]);
}});
