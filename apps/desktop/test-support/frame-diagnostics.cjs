// 等待失败时保存结构化现场，避免装包态只有一句超时、无法定位发送和滚动状态。
const {mkdirSync,writeFileSync}=require('node:fs');
const {join}=require('node:path');
async function recordFrameTimeout({win,bridge,outDir,probe}) {
  mkdirSync(outDir,{recursive:true});
  const state={probe,at:new Date().toISOString(),host:{pid:bridge?.proc?.pid??null,exitCode:bridge?.proc?.exitCode??null,pending:bridge?.pending?.size??null}};
  try {
    state.renderer=await win.webContents.executeJavaScript(`(()=>{
      const n=document.querySelector('.conversation-scroll'),send=document.querySelector('#send'),input=document.querySelector('#composer');
      const bounds=e=>{const r=e.getBoundingClientRect();return {top:r.top,bottom:r.bottom,height:r.height}};
      return {visible:document.visibilityState,focused:document.hasFocus(),viewport:{width:innerWidth,height:innerHeight},
        send:send&&{disabled:send.disabled,busy:send.getAttribute('aria-busy')},draftLength:input?.value.length??null,
        messages:document.querySelectorAll('[data-msg-id]').length,
        scroll:n&&{top:n.scrollTop,height:n.scrollHeight,client:n.clientHeight,floor:n.scrollHeight-n.clientHeight,following:n.dataset.followingTail,bounds:bounds(n)},
        composer:document.querySelector('.composer-seat')&&bounds(document.querySelector('.composer-seat')),
        folds:[...document.querySelectorAll('.btn-fold')].map(b=>({expanded:b.getAttribute('aria-expanded'),bounds:bounds(b)}))};
    })()`,true);
  } catch(error) {state.rendererError=String(error.message||error);}
  // 每次超时采用独立文件，后续失败不能覆盖前一个现场。
  const stem='wait-timeout-'+Date.now();
  writeFileSync(join(outDir,stem+'.json'),JSON.stringify(state,null,2));
  try {writeFileSync(join(outDir,stem+'.png'),(await win.webContents.capturePage()).toPNG());}
  catch(error) {state.captureError=String(error.message||error);writeFileSync(join(outDir,stem+'.json'),JSON.stringify(state,null,2));}
  return state;
}
module.exports={recordFrameTimeout};
