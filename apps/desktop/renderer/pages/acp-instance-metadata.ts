import {h} from 'vue';
const text=(v:unknown,max=256)=>typeof v==='string'&&v.length>0&&v.length<=max&&!/[\u0000-\u001f\u007f]/.test(v);
const ref=(v:any)=>v===null||(v&&text(v.providerId)&&text(v.modelId)&&(v.variant===undefined||text(v.variant)));
const section=(v:any,max:number,valid:(row:any)=>boolean)=>v&&['observed','unknown'].includes(v.status)&&typeof v.complete==='boolean'&&Array.isArray(v.items)&&v.items.length<=max&&v.items.every(valid)&&!(v.status==='unknown'&&(v.complete||v.items.length));
export function readAcpInstanceMetadata(value:any,directory:string){
 if(value==null)return null;
 if(value.version!==1||value.source!=='opencode-v2-plugin'||value.binding!=='request-and-acp-session'||value.directory!==directory||!text(value.sessionId)||
  value.providerVersion!=='2.0.28'||!Number.isSafeInteger(value.providerPid)||value.providerPid<1||value.providerPid>4294967295||!Number.isSafeInteger(value.capturedAt)||value.capturedAt<0||!text(value.osUser)||
  value.configSources!=='not-exposed'||value.price!=='unknown'||value.dynamicRoutes!=='unknown'||value.modelTask!=='not-tested'||
  !section(value.models,256,row=>ref(row)&&row!==null&&typeof row.enabled==='boolean')||
  !section(value.agents,128,row=>row&&text(row.id)&&['primary','subagent','all'].includes(row.mode)&&ref(row.model)&&['listed','not-listed','unknown','inherits-default'].includes(row.availability)&&(row.model!==null||['unknown','inherits-default'].includes(row.availability)))||
  !section(value.plugins,64,row=>row&&text(row.id)&&['ready','loading','failed','disabled','unknown'].includes(row.status))||
  !value.defaultModel||!ref(value.defaultModel.ref)||!['listed','not-listed','unknown'].includes(value.defaultModel.availability))throw Error('ACP 实例元数据无效');
 const known=new Set(value.models.items.filter((m:any)=>m.enabled).map((m:any)=>JSON.stringify([m.providerId,m.modelId])));
 const availability=(r:any)=>!r?'unknown':known.has(JSON.stringify([r.providerId,r.modelId]))?'listed':value.models.complete?'not-listed':'unknown';
 if(value.defaultModel.availability!==availability(value.defaultModel.ref)||value.agents.items.some((a:any)=>a.model&&a.availability!==availability(a.model)))throw Error('ACP 模型目录结论不一致');
 return value;
}
const model=(r:any)=>r?r.providerId+'/'+r.modelId+(r.variant?' #'+r.variant:''):'继承默认模型';
const availability:Record<string,string>={listed:'当前启用目录已列出，尚未调用','not-listed':'当前启用目录未列出，调用可能失败',unknown:'尚未确认','inherits-default':'继承默认模型'};
export function renderAcpInstanceMetadata(raw:unknown,directory:string){
 let value:any;try{value=readAcpInstanceMetadata(raw,directory);}catch{return h('p',{class:'note',role:'status'},'实例元数据回执无效，配置与插件风险仍未确认。');}
 if(!value)return null;
 return h('section',{class:'acp-instance-metadata','aria-label':'OpenCode 实例模型与插件'},[
  h('h3',{},'模型与 Agent 检查'),
  h('p',{class:'note'},'来自本次 ACP 会话绑定的 OpenCode 注册表；配置来源、动态插件路由和真实模型调用仍未完全验证。'),
  h('dl',{},[h('dt',{},'提供方用户'),h('dd',{},value.osUser),h('dt',{},'服务 PID（提供方自报）'),h('dd',{},String(value.providerPid)),
   h('dt',{},'默认模型'),h('dd',{},model(value.defaultModel.ref)),h('dt',{},'目录状态'),h('dd',{},availability[value.defaultModel.availability])]),
  !value.models.complete?h('p',{class:'note'},'模型目录未完整读取；不据此断言未列出的模型不存在。'):null,
  h('details',{open:value.agents.items.some((a:any)=>a.availability==='not-listed')},[
   h('summary',{},'Agent 模型 · '+value.agents.items.length),
   value.agents.status==='unknown'?h('p',{class:'note'},'Agent 注册表尚未读取。'):null,
   ...value.agents.items.map((agent:any)=>h('article',{class:'tool-card',key:agent.id},[
    h('strong',{},agent.id),h('p',{class:'note'},model(agent.model)),
    h('p',{class:agent.availability==='not-listed'?'resource-error':'note'},availability[agent.availability]),
    agent.availability==='not-listed'?h('p',{class:'note'},'请核对该 Agent 的模型设置。可以保留现状；这不影响 SaCode 自有 Agent。'):null,
   ])),
  ]),
  h('details',{},[h('summary',{},'插件清单 · '+value.plugins.items.length),h('p',{class:'note'},'注册清单不能证明所有插件动态行为已检查。'),
   ...value.plugins.items.map((plugin:any)=>h('p',{class:'note',key:plugin.id},plugin.id+' · '+({ready:'已就绪',loading:'加载中',failed:'加载失败',disabled:'已禁用',unknown:'状态未确认'} as any)[plugin.status])),
  ]),
  h('p',{class:'note'},'模型价格未知，不能保证免费；未发送模型任务，未测试端点可达性。'),
 ]);
}
