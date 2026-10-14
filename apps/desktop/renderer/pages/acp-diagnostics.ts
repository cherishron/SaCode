import {h} from 'vue';
export interface AcpDiagnostics {
 version:1;diagnosticId:string;workspace:string;executable:string;source:'acp-observation';
 agentName:string|null;agentVersion:string|null;sessionModel:string|null;sessionMode:string|null;
 configSources:'unknown';processIdentity:'unknown';primaryAgent:'unknown';price:'unknown';pluginModels:'unknown';network:'not-tested';modelTask:'not-tested';
}
const text=(value:unknown,max:number)=>typeof value==='string'&&value.length<=max&&!/[\u0000-\u001f\u007f]/.test(value);
export function readAcpDiagnostics(raw:unknown):AcpDiagnostics|null {
 if(raw==null)return null;
 const value=raw as any;
 if(!value||Array.isArray(value)||value.version!==1||!/^acp-[0-9a-f]{32}$/.test(value.diagnosticId)||value.source!=='acp-observation'||
 !text(value.workspace,4096)||!text(value.executable,4096)||
 !['agentName','agentVersion','sessionModel','sessionMode'].every(key=>value[key]===null||text(value[key],256))||
 !['configSources','processIdentity','primaryAgent','price','pluginModels'].every(key=>value[key]==='unknown')||value.network!=='not-tested'||value.modelTask!=='not-tested')throw Error('ACP 结构化诊断回执无效');
 return value;
}
export function renderAcpDiagnostics(raw:unknown){
 let value:AcpDiagnostics|null;
 try{value=readAcpDiagnostics(raw);}catch{return h('p',{class:'note',role:'status'},'结构化诊断回执无效；不显示未经确认的信息。');}
 if(!value)return h('p',{class:'note'},'当前宿主未返回结构化诊断，配置与模型信息尚未确认。');
 const rows=[['请求工作目录',value.workspace],['启动程序',value.executable],['Agent 回执',value.agentName],['实际版本回执',value.agentVersion],
 ['会话模型回执',value.sessionModel],['会话模式回执',value.sessionMode],['主 Agent','未确认，不能以模式名代替'],['模型价格','未知，未核价'],
 ['配置来源与身份','未确认全局/项目合并来源与系统身份'],['插件模型覆盖','未确认动态插件覆盖'],['端点与模型任务','未发送模型任务，端点可达性未验证']];
 return h('details',{class:'acp-diagnostics',open:true},[h('summary',{},'诊断详情'),h('dl',{},rows.flatMap(([label,content])=>[h('dt',{},label),h('dd',{},content||'未返回（未确认）')])),h('p',{class:'note'},'诊断编号 '+value.diagnosticId)]);
}
