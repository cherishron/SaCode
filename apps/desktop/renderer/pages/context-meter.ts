// 对照冻结上游 ContextMeter/context-occupancy；MIT 许可证见 renderer/assets/dsh-ui-LICENSE.txt。
// 当前上下文与累计预算是不同指标；此视图只读取上下文压力投影。
import {defineComponent,h,ref,computed,watch,nextTick,onMounted,onBeforeUnmount,type PropType} from 'vue';
export type Pressure={projectedTokens?:number;pressureTokens?:number;contextWindow?:number};
export type Reading={usedTokens?:number;contextWindow?:number;percent?:number};
export type Breakdown={systemTokens:number;toolsTokens:number;messageTokens:number};
// 两个读数各自独立：提供方回传用量、注册表给模型容量。缺哪一侧就如实空着，
// 只有两侧都有才换算比例——拿未知容量去除会造出一个假百分比。
export function contextReading(pressure?:Pressure):Reading|null{const used=pressure?.projectedTokens??pressure?.pressureTokens,window=pressure?.contextWindow,hasUsed=typeof used==='number'&&Number.isFinite(used)&&used>=0,hasWindow=typeof window==='number'&&Number.isFinite(window)&&window>0;if(!hasUsed&&!hasWindow)return null;const reading:Reading={};if(hasUsed)reading.usedTokens=used;if(hasWindow)reading.contextWindow=window;if(hasUsed&&hasWindow)reading.percent=Math.min(100,Math.round(used/window*100));return reading;}
export function contextOccupancy(pressure?:Pressure){const usedTokens=pressure?.projectedTokens??pressure?.pressureTokens,contextWindow=pressure?.contextWindow;if(usedTokens===undefined||contextWindow===undefined||!Number.isFinite(usedTokens)||!Number.isFinite(contextWindow)||usedTokens<0||contextWindow<=0)return null;return {usedTokens,contextWindow,percent:Math.min(100,Math.round(usedTokens/contextWindow*100))};}
export function formatTokens(value:number){const scale=(n:number)=>String(n>=100?Math.round(n):Math.round(n*10)/10);return value<1000?String(value):value<1000000?scale(value/1000)+'K':scale(value/1000000)+'M';}
const rows=[{key:'systemTokens',label:'系统提示词',color:'system'},{key:'toolsTokens',label:'工具',color:'tools'},{key:'messageTokens',label:'对话',color:'messages'}] as const;
const el=(tag:string,cls:string,children:any,props:any={})=>h(tag,{class:'context-meter-'+cls,...props},children);
let instance=0;
export const ContextMeter=defineComponent({name:'SaCodeContextMeter',props:{pressure:Object as PropType<Pressure>,breakdown:Object as PropType<Breakdown>},setup(props){
  const anchor=ref<HTMLButtonElement|null>(null),panel=ref<HTMLDivElement|null>(null),open=ref(false),reading=computed(()=>contextReading(props.pressure)),context=computed(()=>contextOccupancy(props.pressure)),id='sacode-context-'+(++instance);let observer:ResizeObserver|null=null,frame=0,disposed=false;let suppressFocus=false;let leaveTimer:ReturnType<typeof setTimeout>|undefined;
  const enter=()=>{clearTimeout(leaveTimer);open.value=true;};const leave=()=>{clearTimeout(leaveTimer);leaveTimer=setTimeout(()=>{open.value=false;},180);};
  const place=()=>{frame=0;const a=anchor.value,p=panel.value;if(!open.value||!a||!p)return;const ar=a.getBoundingClientRect(),margin=12,gap=8;p.style.maxHeight=Math.max(40,innerHeight-margin*2)+'px';const pr=p.getBoundingClientRect();const above=ar.top-gap-margin,below=innerHeight-ar.bottom-gap-margin,up=above>=pr.height||above>=below;const height=Math.min(pr.height,innerHeight-margin*2),left=Math.max(margin,Math.min(ar.left,innerWidth-margin-pr.width));p.style.left=left+'px';p.style.top=Math.max(margin,Math.min(up?ar.top-gap-height:ar.bottom+gap,innerHeight-margin-height))+'px';};
  const schedule=()=>{if(!frame)frame=requestAnimationFrame(place);};
  const close=(restore=false)=>{clearTimeout(leaveTimer);open.value=false;if(restore){suppressFocus=true;anchor.value?.focus({preventScroll:true});suppressFocus=false;}};
  const pointer=(e:PointerEvent)=>{if(open.value&&e.target instanceof Node&&!anchor.value?.contains(e.target)&&!panel.value?.contains(e.target))close();};
  const escape=(e:KeyboardEvent)=>{if(open.value&&e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();close(true);}};
  const sync=async()=>{await nextTick();if(disposed)return;observer?.disconnect();if(anchor.value)observer?.observe(anchor.value);if(panel.value)observer?.observe(panel.value);const p=panel.value;if(!p)return;if(open.value&&!p.matches(':popover-open'))p.showPopover();if(!open.value&&p.matches(':popover-open'))p.hidePopover();place();};
  watch(reading,()=>{void sync();},{flush:'post'});watch(open,()=>void sync(),{flush:'post'});watch(()=>props.breakdown,schedule,{deep:true,flush:'post'});
  onMounted(()=>{observer=new ResizeObserver(schedule);window.addEventListener('resize',schedule);window.addEventListener('scroll',schedule,true);document.addEventListener('pointerdown',pointer,true);document.addEventListener('keydown',escape,true);void sync();});
  onBeforeUnmount(()=>{disposed=true;clearTimeout(leaveTimer);cancelAnimationFrame(frame);observer?.disconnect();window.removeEventListener('resize',schedule);window.removeEventListener('scroll',schedule,true);document.removeEventListener('pointerdown',pointer,true);document.removeEventListener('keydown',escape,true);if(panel.value?.matches(':popover-open'))panel.value.hidePopover();});
  return()=>{const r=reading.value;if(!r)return null;const c=context.value,used=r.usedTokens,window=r.contextWindow,percent=r.percent,u=used??0,w=window??0;
    const b=c&&props.breakdown&&rows.every(row=>Number.isFinite(props.breakdown![row.key])&&props.breakdown![row.key]>=0)?props.breakdown:undefined,total=b?b.systemTokens+b.toolsTokens+b.messageTokens:0;
    const parts=b&&total>0?rows.map(row=>({key:row.key,color:row.color,width:(percent??0)*b[row.key]/total})):[{key:'total',color:'total',width:percent??0}];
    const full=percent!==undefined,label=full?`上下文已用 ${percent}% · ${formatTokens(u)} / ${formatTokens(w)}`:used!==undefined?`上下文已用 ~${formatTokens(u)} · 容量未提供`:`上下文容量 ${formatTokens(w)} · 用量未提供`,trigger=el('button','trigger',[h('svg',{viewBox:'0 0 14 14',width:14,height:14,'aria-hidden':true},[h('circle',{class:'context-meter-track',cx:7,cy:7,r:5.5}),full?h('circle',{class:'context-meter-fill',cx:7,cy:7,r:5.5,'stroke-dasharray':`${2*Math.PI*5.5*(percent??0)/100} ${2*Math.PI*5.5}`,transform:'rotate(-90 7 7)'}):null]) ],{ref:anchor,type:'button','aria-label':label,'aria-haspopup':'dialog','aria-expanded':open.value,'aria-controls':id,onFocus:()=>{if(!suppressFocus)open.value=true;},onClick:()=>open.value=true});
    return el('span','root',[trigger,
      el('div','panel',[
        el('div','header',[el('span','headline',used!==undefined?'上下文已用':'上下文容量'),el('span','percent',full?percent+'%':'—'),el('span','figures',full?`~${formatTokens(u)} / ${formatTokens(w)}`:used!==undefined?`~${formatTokens(u)} · 容量未提供`:`容量 ${formatTokens(w)} · 用量未提供`)]),
        full?el('div','bar',parts.filter(p=>p.width>0).map(p=>el('div','segment '+p.color,null,{key:p.key,style:{width:p.width+'%'},'data-context-segment':p.key}))):null,
        full?null:el('p','note',used!==undefined?'模型容量未提供，无法换算占用比例；用量来自提供方回传的上一轮统计。':'暂未获得当前上下文用量；数据可用后会显示占用比例。'),
        c&&b?el('dl','rows',rows.map(row=>el('div','row',[h('dt',[el('span','swatch '+row.color,null,{'aria-hidden':true}),row.label]),h('dd','~'+formatTokens(b[row.key]))],{key:row.key}))):null,
      ],{ref:panel,id,onPointerenter:enter,onPointerleave:leave,popover:'manual',role:'dialog','aria-label':'上下文用量详情'}),
    ],{onPointerenter:enter,onPointerleave:leave,onFocusout:(e:FocusEvent)=>{if(!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node))close();}});
  };
}});
