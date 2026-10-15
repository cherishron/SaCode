'use strict';
function registerKnowledgeIpc(ipcMain, request) {
  for (const [action, verb] of [['List','list'],['Save','save'],['Remove','remove'],['Import','import'],['Reference','reference']]) {
    ipcMain.handle('sacode:knowledge'+action, (_event,args) => {
      const fields=verb==='list'?['sessionId','scope','query']:verb==='reference'?['sessionId','scope','id','revision']:verb==='import'?['sessionId','scope','id','title','path','revision']:['sessionId','scope','id','title','content','revision'];
      if(!args||Array.isArray(args)||Object.keys(args).length!==fields.length||fields.some(k=>!Object.hasOwn(args,k))) throw Error('knowledge-bad-args');
      if(typeof args.sessionId!=='string'||!args.sessionId||!['user','project'].includes(args.scope)) throw Error('knowledge-bad-scope');
      if(verb==='list') {if(typeof args.query!=='string'||args.query.length>500)throw Error('knowledge-bad-query');}
      else {
        if(typeof args.id!=='string'||!args.id||args.id.length>80||!Number.isSafeInteger(args.revision)||args.revision<0)throw Error('knowledge-bad-document');
        if(verb!=='reference'&&(typeof args.title!=='string'||args.title.length>200))throw Error('knowledge-bad-document');
        if(verb==='import') {if(args.scope!=='project'||typeof args.path!=='string'||!args.path||args.path.length>1024)throw Error('knowledge-source-rejected');}
        else if(verb!=='reference'&&(typeof args.content!=='string'||Buffer.byteLength(args.content)>65536))throw Error('knowledge-bad-document');
      }
      return request('knowledge/'+verb,args);
    });
  }
}
module.exports={registerKnowledgeIpc};
