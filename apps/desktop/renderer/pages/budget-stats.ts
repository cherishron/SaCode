// 模型中心·费用统计页：注册到 'model-center.tab' 槽位。
// 三列（模型费用 / 探测费用 / 加速费用）的计量基底不同类，界面把它们分列并标注来源，
// 不把它们加成一个「总花费」冒充账单口径。
import {defineComponent,h,ref,onMounted,onBeforeUnmount,type PropType} from 'vue';
import type {ClientScope} from './slot-core';

// --- 类型 ---
export interface SessionUsage{used:number|null;budget:number|null;over:boolean;verdict:string}
export interface BudgetLimits{
  dailyTokens:number;monthlyTokens:number;
  dailyAmountMicro:number;monthlyAmountMicro:number;
  maxOutputTokens:number;
  probeEnabled:boolean;probeMaxPerDay:number;
}
export interface BindingRate{
  providerId:string;modelId:string;
  priceInMicro:number;priceOutMicro:number;
  priceCacheReadMicro:number;priceCacheWriteMicro:number;
  currency:string;enabled:boolean;
}
export interface ModelBudget{
  id:string;name:string;
  limits:BudgetLimits;
  bindings:BindingRate[];
  enabled:boolean;
}
export interface CostColumn{amountMicro:number|null;currency:string|null;meterSource:string;note:string}
export interface StatsView{
  session:SessionUsage;
  models:ModelBudget[];
  costs:{model:CostColumn;probe:CostColumn;relay:CostColumn};
  writable:boolean;
  revision:string;
}
export interface Adapter{
  describe():Promise<StatsView>;
  subscribe?(invalidate:()=>void):()=>void;
}

// --- 格式化 ---
export function formatMicro(v:number):string{
  if(v===-1)return'未设置';
  if(v<1000)return String(v)+' 微';
  return(v/1000).toLocaleString()+' 毫';
}
export function formatAmount(micro:number|null,currency:string|null):string{
  if(micro===null)return'—';
  const unit=micro/1e6;return Number(unit.toFixed(6)).toLocaleString()+' '+(currency||'');
}
export function formatTokens(v:number):string{
  if(v===-1)return'未设置';
  if(v<1000)return String(v);
  if(v<1000000)return(v/1000).toLocaleString()+'K';
  return(v/1000000).toLocaleString()+'M';
}
export function verdictLabel(v:string):string{
  const map:Record<string,string>={
    recorded:'已计量','over-budget':'超出预算',
    absent:'未收到用量','bad-usage':'用量格式异常',
  };
  return map[v]||'未计量';
}

// --- UI ---
const el=(tag:string,cls:string,children:any,props:any={})=>h(tag,{class:'bs-'+cls,...props},children);
const fmt=(v:number|string|null,label:string,unit='token')=>el('div','stat',[
  el('span','stat-label',label),
  el('span','stat-value',v===null?'—':String(v)),
  v!==null?el('span','stat-unit',unit):null,
]);

// --- 主组件 ---
export const Page=defineComponent({
  name:'SaCodeBudgetStats',
  props:{adapter:Object as PropType<Adapter>},
  setup(props){
    const view=ref<StatsView|null>(null);
    const loading=ref(false),error=ref('');
    let off:(()=>void)|undefined,disposed=false;

    const load=async()=>{
      if(!props.adapter)return;
      loading.value=true;error.value='';
      try{const r=await props.adapter.describe();if(!disposed)view.value=r;}
      catch(e){if(!disposed)error.value=String((e as any)?.message||e);}
      finally{if(!disposed)loading.value=false;}
    };

    onMounted(()=>{off=props.adapter?.subscribe?.(()=>{void load();});void load();});
    onBeforeUnmount(()=>{disposed=true;off?.();});

    const costCard=(c:CostColumn,title:string)=>el('div','costCard',[
      el('h3','costTitle',title),
      el('div','costAmount',[el('span','costValue',formatAmount(c.amountMicro,c.currency)),el('span','costSource',c.meterSource)]),
      c.note?el('p','costNote',c.note):null,
    ]);

    return()=>{
      if(!props.adapter)return el('section','root',[el('h2',null,'费用统计'),el('p','notice','费用统计后端尚未接入。',{role:'status'})]);

      const v=view.value;
      return el('section','root',[
        el('div','header',[el('h2',null,'费用统计'),el('p','intro','模型费用、探测费用与加速费用分列展示，计量基底不同类，不加总成总账单。')]),
        loading.value?el('p','loading','正在加载…'):null,
        error.value?el('p','error',error.value,{role:'alert'}):null,

        // 三列费用
        el('div','costColumns',[
          v?costCard(v.costs.model,'模型费用'):el('div','costCard',[el('h3','costTitle','模型费用'),el('p','costNote','暂无数据。')]),
          v?costCard(v.costs.probe,'探测费用'):el('div','costCard',[el('h3','costTitle','探测费用'),el('p','costNote','暂无数据。')]),
          v?costCard(v.costs.relay,'加速费用'):el('div','costCard',[el('h3','costTitle','加速费用'),el('p','costNote','暂无数据。')]),
        ]),

        // 会话级预算
        el('fieldset','section',[
          el('legend',null,'会话级预算用量'),
          v?el('div','stats',[
            fmt(v.session.used,'已使用','token'),
            fmt(v.session.budget,'预算上限','token'),
            el('div','stat',[el('span','stat-label','判定'),el('span','stat-value',verdictLabel(v.session.verdict))]),
            el('div','stat',[el('span','stat-label','超档'),el('span','stat-value '+(v.session.over?'over':'ok'),v.session.over?'是':'否')]),
          ]):el('p','hint','暂无数据。'),
          el('p','hint','数值来自宿主 usageStatus 投影；界面不另算账。'),
        ]),

        // 自定义模型预算
        el('fieldset','section',[
          el('legend',null,'自定义模型预算限额'),
          v&&v.models.length?h('table',{class:'bs-table',role:'table'},[
            el('thead',null,el('tr',null,[
              el('th',null,'模型'),
              el('th',null,'每日 Token'),
              el('th',null,'每月 Token'),
              el('th',null,'每日金额'),
              el('th',null,'每月金额'),
              el('th',null,'最大输出'),
              el('th',null,'探测'),
            ])),
            el('tbody',null,v.models.map(m=>h('tr',{key:m.id},[
              el('td',null,m.name||m.id),
              el('td',null,formatTokens(m.limits.dailyTokens)),
              el('td',null,formatTokens(m.limits.monthlyTokens)),
              el('td',null,formatMicro(m.limits.dailyAmountMicro)),
              el('td',null,formatMicro(m.limits.monthlyAmountMicro)),
              el('td',null,formatTokens(m.limits.maxOutputTokens)),
              el('td',null,m.limits.probeEnabled?'每日 '+m.limits.probeMaxPerDay+' 次':'已禁用'),
            ]))),
          ]):el('p','hint','暂无自定义模型。'),
        ]),

        // 绑定费率
        el('fieldset','section',[
          el('legend',null,'上游绑定费率'),
          (()=>{
            const rows:(BindingRate&{modelName:string})[]=[];
            if(v)for(const m of v.models)for(const b of m.bindings)rows.push({...b,modelName:m.name||m.id});
            return rows.length?h('table',{class:'bs-table',role:'table'},[
              el('thead',null,el('tr',null,[
                el('th',null,'所属模型'),
                el('th',null,'提供商/模型'),
                el('th',null,'输入价格'),
                el('th',null,'输出价格'),
                el('th',null,'缓存读'),
                el('th',null,'缓存写'),
                el('th',null,'货币'),
                el('th',null,'状态'),
              ])),
              el('tbody',null,rows.map((r,i)=>h('tr',{key:i},[
                el('td',null,r.modelName),
                el('td',null,r.providerId+'/'+r.modelId),
                el('td',null,formatMicro(r.priceInMicro)),
                el('td',null,formatMicro(r.priceOutMicro)),
                el('td',null,formatMicro(r.priceCacheReadMicro)),
                el('td',null,formatMicro(r.priceCacheWriteMicro)),
                el('td',null,r.currency||'—'),
                el('td',null,r.enabled?'启用':'禁用'),
              ]))),
            ]):el('p','hint','暂无绑定费率数据。');
          })(),
        ]),

        // 计量来源说明
        el('fieldset','section',[
          el('legend',null,'计量来源'),
          el('ul','sources',[
            el('li',null,'模型费用与探测费用：来自上游回给的用量，按绑定登记的四档费率（输入/输出/缓存读/缓存写）计算。'),
            el('li',null,'加速费用：来自本地记录的请求/响应字节数 × 登记的传输费率，与上游用量无关。'),
            el('li',null,'「待核算」表示该维度已产生用量但未登记费率，或请求状态不明，不会按已登记的维度反推。'),
            el('li',null,'本地累计费用只是本地可控消费的上界，不冒充供应商余额；远端可能延迟计量或额外计费。'),
          ]),
        ]),
      ]);
    };
  },
});

// --- 槽位注册 ---
export function install(scope:ClientScope):()=>void{
  return scope.inject('model-center.tab',(child)=>{
    child.register({name:'model-center.tab',id:'budget-stats',order:2,label:'费用统计'},
      defineComponent({name:'SaCodeBudgetStatsSlot',props:['owner'],setup:(props)=>()=>h(Page,{adapter:(props.owner as any)?.adapter})}));
  });
}