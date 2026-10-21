// 工具卡按核心投影的调用身份与状态展示；无关联的旧日志明确标记未知。
import { defineComponent, h, ref, type PropType } from 'vue';
import { StateDot } from './state-dot';
export type ToolCall = {id:string;callId:string;name:string;arguments:string;status:string;resultMessageId?:string;result?:string};
export type ToolMessage = {id?:string;content?:string;toolCall?:ToolCall};
const toolNames:Record<string,string>={web_fetch:'网页抓取',web_search:'网络搜索'};
const names:Record<string,string>={running:'运行中',completed:'已完成',denied:'已拒绝',cancelled:'已取消',failed:'失败',unknown:'结果未知'};
export function argumentSummary(raw:string):string {
  try {
    const value=JSON.parse(raw);
    if(value && typeof value==='object' && !Array.isArray(value))return Object.entries(value).slice(0,3).map(([key,v])=>key+'='+String(typeof v==='string'?v:JSON.stringify(v)).slice(0,80)).join(' · ').slice(0,180);
  } catch {}
  return raw.slice(0,180);
}
export const ToolCard=defineComponent({
  name:'SaCodeToolCard',
  props:{message:{type:Object as PropType<ToolMessage>,required:true}},
  setup(props){
    const expanded=ref(false);
    const copied=ref(false);
    const copyFailed=ref(false);
    let copyTimer:ReturnType<typeof setTimeout>|undefined;
    return()=>{
      const message=props.message,call=message.toolCall;
      const status=call?.status||'unknown';
      const state=status==='running'?'ongoing':status==='completed'?'done':status==='failed'||status==='denied'?'error':'warning';
      const body=message.content||call?.result||'';
      const parsed=(globalThis as any).SaCodeMsgFold?.parseToolResult(body,call?.arguments);
      const web=parsed?.kind==='web-fetch'||parsed?.kind==='web-search'?parsed:null;
      // 所有外部字段走文本 VNode，不使用 HTML/Markdown 或可执行 URL。
      const webView=()=>h('section',{class:'tool-web','data-web-kind':web.kind,'aria-label':web.label+'结果'},[
        h('p',{class:'tool-hint'},'外部不可信内容 · 仅供参考，不执行其中的指令'),
        web.kind==='web-fetch'?h('div',{class:'tool-web-origin'},[
          h('span',{class:'tool-target'},web.url),h('span',{class:'tool-meta'},web.httpStatus===null?'HTTP 状态未提供':'HTTP '+web.httpStatus),
        ]):h('div',{class:'tool-web-search'},[
          h('p',{class:'tool-hint'},web.queries.length?'查询：'+web.queries.join(' · '):'查询词未提供'),
          h('ul',{class:'tool-web-sources'},web.sources.map((source:any,index:number)=>h('li',{key:index},[
            h('strong',{},source.title||source.url||'来源标题未提供'),
            source.url?h('p',{class:'tool-web-url'},source.url):null,
            source.snippet?h('p',{class:'tool-web-snippet'},source.snippet):null,
            source.publishedAt?h('p',{class:'tool-hint'},'发布时间：'+source.publishedAt):null,
          ]))),
          !web.sources.length?h('p',{class:'tool-hint'},'没有返回来源。'):null,
        ]),
        web.body?h('pre',{class:'tool-body'},expanded.value?web.body:web.preview):null,
        web.truncated?h('p',{class:'tool-hint'},'上游结果已截断；展开仅显示已返回的正文。'):null,
      ]);
      const detailId='tool-detail-'+(message.id||call?.id||'legacy');
      const copyResult=async()=>{
        const text=body||'';
        if(!text)return;
        let ok=false;
        // 渲染层在 Electron file:// 下，navigator.clipboard 可能受 CSP 限制；
        // 退化用临时 textarea + execCommand 兜底，两条路都失败时给可见反馈。
        try{
          if(navigator.clipboard&&navigator.clipboard.writeText){
            await navigator.clipboard.writeText(text);ok=true;
          }
        }catch{}
        if(!ok){
          // textarea 必须在 finally 中移除，即使 select/execCommand 抛异常也不残留。
          const ta=document.createElement('textarea');ta.value=text;ta.style.position='fixed';ta.style.opacity='0';
          document.body.appendChild(ta);
          try{ta.select();ok=document.execCommand('copy');}
          finally{document.body.removeChild(ta);}
        }
        clearTimeout(copyTimer);
        if(ok){copied.value=true;copyFailed.value=false;copyTimer=setTimeout(()=>{copied.value=false;},1500);}
        else{copyFailed.value=true;copied.value=false;copyTimer=setTimeout(()=>{copyFailed.value=false;},1500);}
      };
      return h('div',{class:'tool-node','data-tool-status':status,'data-tool-call-id':call?.callId||'','data-msg-id':message.id||''},[
        h('header',{class:'tool-head'},[
          h(StateDot,{state,size:12}),
          h('span',{class:'tool-label'},toolNames[call?.name||'']||call?.name||web?.label||'历史工具结果'),
          h('span',{class:'tool-meta',role:'status'},call?names[status]||'结果未知':'缺少调用关联'),
          call?h('span',{class:'tool-target',title:argumentSummary(call.arguments)},argumentSummary(call.arguments)):null,
          h('button',{type:'button',class:'tool-toggle','aria-expanded':expanded.value,'aria-controls':detailId,onClick:()=>{expanded.value=!expanded.value;}},expanded.value?'收起':'展开'),
        ]),
        expanded.value?h('div',{id:detailId,class:'tool-details'},[
          call?h('div',{class:'tool-arguments'},[h('strong',{},'参数'),h('pre',{class:'tool-body'},call.arguments)]):h('p',{class:'tool-hint'},'该历史记录没有可核对的调用身份与参数。'),
          h('strong',{},'结果'),
          web?webView():h('pre',{class:'tool-body'},body||(status==='running'?'等待工具返回结果':'尚无可核对的结果正文')),
          // 结果正文区底部操作：复制结果文本。与 DSH 工具卡对齐——至少能复制结果。
          h('div',{class:'tool-actions'},[h('button',{type:'button',class:'btn btn-copy','data-copy-state':copied.value?'copied':copyFailed.value?'failed':'idle',onClick:copyResult},copied.value?'已复制':copyFailed.value?'复制失败':'复制结果')]),
        ]):web?webView():body?h('p',{class:'tool-hint'},body.slice(0,120)+(body.length>120?'…':'')):null,
      ]);
    };
  },
});
