'use strict';
function registerAutomationIpc(ipcMain,request){
 for(const [name,verb] of [['List','list'],['Save','save'],['Control','control']])ipcMain.handle('sacode:automation'+name,(_e,args)=>{
  const keys=verb==='list'?['sessionId','scope']:verb==='save'?['sessionId','scope','definition','revision']:['sessionId','scope','id','action','revision'];
  if(!args||Array.isArray(args)||Object.keys(args).length!==keys.length||keys.some(k=>!Object.hasOwn(args,k))||typeof args.sessionId!=='string'||!args.sessionId||!['user','project'].includes(args.scope))throw Error('automation-bad-args');
  if(verb!=='list'&&(!Number.isSafeInteger(args.revision)||args.revision<0))throw Error('automation-bad-revision');
  if(verb==='control'&&(typeof args.id!=='string'||!args.id||!['pause','resume','remove'].includes(args.action)))throw Error('automation-bad-action');
  if(verb==='save'){
   const d=args.definition,fields=['id','title','prompt','cron','workspace','modelId','timezone','permission','enabled'];
   if(!d||Array.isArray(d)||Object.keys(d).length!==fields.length||fields.some(k=>!Object.hasOwn(d,k))||fields.filter(k=>k!=='enabled').some(k=>typeof d[k]!=='string')||typeof d.enabled!=='boolean'||Buffer.byteLength(JSON.stringify(d))>70000)throw Error('automation-bad-definition');
  }
  return request('automation/'+verb,args);
 });
}
module.exports={registerAutomationIpc};
