// 对照冻结上游 ContextMeter/context-occupancy；MIT 许可证见 renderer/assets/dsh-ui-LICENSE.txt。
// 当前上下文与累计预算是不同指标；此视图只读取上下文压力投影。
import {defineComponent,h,ref,computed,watch,nextTick,onMounted,onBeforeUnmount,type PropType} from 'vue';
export type Pressure={projectedTokens?:number;pressureTokens?:number;contextWindow?:number};
export type Breakdown={systemTokens:number;toolsTokens:number;messageTokens:number};
export function contextOccupancy(pressure?:Pressure){const usedTokens=pressure?.projectedTokens??pressure?.pressureTokens,contextWindow=pressure?.contextWindow;if(usedTokens===undefined||contextWindow===undefined||!Number.isFinite(usedTokens)||!Number.isFinite(contextWindow)||usedTokens<0||contextWindow<=0)return null;return {usedTokens,contextWindow,percent:Math.min(100,Math.round(usedTokens/contextWindow*100))};}
export function formatTokens(value:number){const scale=(n:number)=>String(n>=100?Math.round(n):Math.round(n*10)/10);return value<1000?String(value):value<1000000?scale(value/1000)+'K':scale(value/1000000)+'M';}
const rows=[{key:'systemTokens',label:'系统提示词',color:'system'},{key:'toolsTokens',label:'工具',color:'tools'},{key:'messageTokens',label:'对话',color:'messages'}] as const;
const el=(tag:string,cls:string,children:any,props:any={})=>h(tag,{class:'context-meter-'+cls,...props},children);
let instance=0;
export const ContextMeter=defineComponent({name:'SaCodeContextMeter',props:{pressure:Object as PropType<Pressure>,breakdown:Object as PropType<Breakdown>},setup(props){
  const anchor=ref<HTMLButtonElement|null>(null),panel=ref<HTMLDivElement|null>(null),open=ref(false),context=computed(()=>contextOccupancy(props.pressure)),id='sacode-context-'+(++instance);let observer:ResizeObserver|null=null,frame=0,disposed=false;
  const place=()=>{frame=0;const a=anchor.value,p=panel.value;if(!open.value||!a||!p)return;const ar=a.getBoundingClientRect(),margin=12,gap=8;p.style.maxHeight=Math.max(40,innerHeight-margin*2)+'px';const pr=p.getBoundingClientRect();const above=ar.top-gap-margin,below=innerHeight-ar.bottom-gap-margin,up=above>=pr.height||above>=below;const height=Math.min(pr.height,innerHeight-margin*2),left=Math.max(margin,Math.min(ar.left,innerWidth-margin-pr.width));p.style.left=left+'px';p.style.top=Math.max(margin,Math.min(up?ar.top-gap-height:ar.bottom+gap,innerHeight-margin-height))+'px';};
  const schedule=()=>{if(!frame)frame=requestAnimationFrame(place);};
  const close=(restore=false)=>{open.value=false;if(restore)anchor.value?.focus({preventScroll:true});};
  const pointer=(e:PointerEvent)=>{if(open.value&&e.target instanceof Node&&!anchor.value?.contains(e.target)&&!panel.value?.contains(e.target))close();};
  const escape=(e:KeyboardEvent)=>{if(open.value&&e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();close(true);}};
  const sync=async()=>{await nextTick();if(disposed)return;observer?.disconnect();if(anchor.value)observer?.observe(anchor.value);if(panel.value)observer?.observe(panel.value);const p=panel.value;if(!p)return;if(open.value&&context.value&&!p.matches(':popover-open'))p.showPopover();if(!open.value&&p.matches(':popover-open'))p.hidePopover();place();};
  watch(context,value=>{if(!value)open.value=false;void sync();},{flush:'post'});watch(open,()=>void sync(),{flush:'post'});watch(()=>props.breakdown,schedule,{deep:true,flush:'post'});
  onMounted(()=>{observer=new ResizeObserver(schedule);window.addEventListener('resize',schedule);window.addEventListener('scroll',schedule,true);document.addEventListener('pointerdown',pointer,true);document.addEventListener('keydown',escape,true);void sync();});
  onBeforeUnmount(()=>{disposed=true;cancelAnimationFrame(frame);observer?.disconnect();window.removeEventListener('resize',schedule);window.removeEventListener('scroll',schedule,true);document.removeEventListener('pointerdown',pointer,true);document.removeEventListener('keydown',escape,true);if(panel.value?.matches(':popover-open'))panel.value.hidePopover();});
  return()=>{const c=context.value;if(!c)return null;const b=props.breakdown&&rows.every(r=>Number.isFinite(props.breakdown![r.key])&&props.breakdown![r.key]>=0)?props.breakdown:undefined,total=b?b.systemTokens+b.toolsTokens+b.messageTokens:0;
    const parts=b&&total>0?rows.map(r=>({key:r.key,color:r.color,width:c.percent*b[r.key]/total})):[{key:'total',color:'total',width:c.percent}];
    const label=`上下文已用 ${c.percent}%`,trigger=el('button','trigger',[h('svg',{viewBox:'0 0 14 14',width:14,height:14,'aria-hidden':true},[h('circle',{class:'context-meter-track',cx:7,cy:7,r:5.5}),h('circle',{class:'context-meter-fill',cx:7,cy:7,r:5.5,'stroke-dasharray':`${2*Math.PI*5.5*c.percent/100} ${2*Math.PI*5.5}`,transform:'rotate(-90 7 7)'})]),c.percent+'%'],{ref:anchor,type:'button','aria-label':label,'aria-haspopup':'dialog','aria-expanded':open.value,'aria-controls':id,onClick:()=>open.value=!open.value});
    return el('span','root',[(window as any).SaCodeTooltip?(window as any).SaCodeTooltip.wrap(trigger,{label,side:'top',delayMs:200,disabled:open.value}):trigger,
      el('div','panel',[
        el('div','header',[el('span','headline','上下文已用'),el('span','percent',c.percent+'%'),el('span','figures',`~${formatTokens(c.usedTokens)} / ${formatTokens(c.contextWindow)}`)]),
        el('div','bar',parts.filter(p=>p.width>0).map(p=>el('div','segment '+p.color,null,{key:p.key,style:{width:p.width+'%'},'data-context-segment':p.key}))),
        b?el('dl','rows',rows.map(r=>el('div','row',[h('dt',[el('span','swatch '+r.color,null,{'aria-hidden':true}),r.label]),h('dd','~'+formatTokens(b[r.key]))],{key:r.key}))):null,
      ],{ref:panel,id,popover:'manual',role:'dialog','aria-label':'上下文用量详情'}),
    ]);
  };
}});
