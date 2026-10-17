// 只提取公开注册表字段；禁止展开对象或保留原始配置、错误、请求头、提示词与凭据。
const text=value=>typeof value==='string'&&value.length>0&&value.length<=256&&!/[\u0000-\u001f\u007f]/.test(value);
function ref(value){
 if(!value||!text(value.providerID)||!text(value.id))return null;
 return {providerId:value.providerID,modelId:value.id,...(text(value.variant)?{variant:value.variant}:{})};
}
function rows(result,limit,convert){
 if(result.status!=='fulfilled'||!Array.isArray(result.value?.data))return {status:'unknown',complete:false,items:[]};
 const values=result.value.data,items=[];let complete=values.length<=limit;
 for(const value of values.slice(0,limit)){const row=convert(value);if(row)items.push(row);else complete=false;}
 return {status:'observed',complete,items};
}
export async function collectMetadata(ctx,{diagnosticId,nonce,directory,sessionId},identity){
 const location={directory};
 const [modelResult,defaultResult,agentResult,pluginResult]=await Promise.allSettled([
  ctx.model.list({location},{signal:identity.signal}),ctx.model.default({location},{signal:identity.signal}),
  ctx.agent.list({location},{signal:identity.signal}),ctx.plugin.list({location},{signal:identity.signal}),
 ]);
 const models=rows(modelResult,256,value=>{
  const model=ref(value);if(!model||typeof value.enabled!=='boolean')return null;
  return {...model,enabled:value.enabled};
 });
 const selected=defaultResult.status==='fulfilled'?ref(defaultResult.value?.data):null;
 const known=new Set(models.items.filter(m=>m.enabled).map(m=>JSON.stringify([m.providerId,m.modelId])));
 const availability=model=>!model?'inherits-default':known.has(JSON.stringify([model.providerId,model.modelId]))?'listed':models.complete?'not-listed':'unknown';
 const agents=rows(agentResult,128,value=>{
  if(!value||!text(value.id)||!['primary','subagent','all'].includes(value.mode))return null;
  const model=ref(value.model);
  return {id:value.id,mode:value.mode,model,availability:value.model!==undefined&&!model?'unknown':availability(model)};
 });
 const plugins=rows(pluginResult,64,value=>{
  if(!value||!text(value.id))return null;
  return {id:value.id,status:['ready','loading','failed','disabled'].includes(value.status)?value.status:'unknown'};
 });
 return {version:1,source:'opencode-v2-plugin',implementation:'sacode-diagnostics-0.1.0',diagnosticId,nonce,directory,sessionId,
  providerVersion:ctx.app.version,providerPid:identity.pid,osUser:identity.osUser,capturedAt:identity.now(),
  models,defaultModel:{status:selected?'observed':'unknown',ref:selected,availability:selected?availability(selected):'unknown'},agents,plugins,
  limitations:['config-sources-not-exposed','registered-agents-only','dynamic-routes-not-fully-observable','price-not-confirmed','model-task-not-tested']};
}
