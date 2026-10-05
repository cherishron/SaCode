// 通过真实附件上传/消息提交/会话切换检查历史引用，不能向 Vue 写假消息。
module.exports=async function({win,bridge,waitFor,check}) {
 const consoleProbe=(_event,level,message)=>{if(level>=2)console.log('HISTORY_RENDERER_ERROR',message);};
 win.webContents.on('console-message',consoleProbe);
 const js=async code=>{
  const result=await win.webContents.executeJavaScript(`(()=>{try{return (${code})}catch(e){return {historyProbeError:String(e.message)}}})()`,true);
  if(result?.historyProbeError)throw Error(result.historyProbeError+'；探针：'+code);
  return result;
 };
 await waitFor("!!document.querySelector('[data-sidebar-session][aria-current=page]') && !document.querySelector('#sidebar-new-session').disabled");
 const current=await js("document.querySelector('[data-sidebar-session][aria-current=page]').dataset.sidebarSession");
 console.log('HISTORY_STAGE','原会话已读取');
 await js("document.querySelector('#sidebar-new-session').click()");
 // 空会话尚未持久化，不出现在产品侧栏；从真实目录读它的身份，不强迫 UI 造占位行。
 await waitFor("!document.querySelector('#sidebar-new-session').disabled && document.querySelector('.app').dataset.emptyConversation==='true'");
 const history=(await bridge.request('session/catalog')).entries.find(row=>row.current).id;
 console.log('HISTORY_STAGE','历史会话已创建');
 const image=await bridge.request('attachment/upload',{kind:'image',name:'历史图片.png',mediaType:'image/png',data:'iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAAAAAAA'});
 const file=await bridge.request('attachment/upload',{kind:'file',name:'<b>说明.txt',mediaType:'',data:'YWJj'});
 await bridge.request('session/append',{data:'相同历史正文',receiptIds:[image.receiptId,file.receiptId]});
 await bridge.request('session/append',{eventType:'user/message',data:'相同历史正文'});
 console.log('HISTORY_STAGE','两条消息已落盘');
 win.webContents.reload();
 await waitFor("document.querySelectorAll('[data-msg-id]').length===2 && document.querySelector('.app').dataset.catalogReady==='true'");
 // 重载恢复每组默认五条；新增会话可能在折叠部分，先经真实「显示更多」动作展开。
 for(let i=0;i<4;i++) {
  await js("(()=>{document.querySelectorAll('[data-workspace-overflow][aria-expanded=false]').forEach(n=>n.click());return true})()");
  await js("Vue.nextTick().then(()=>true)");
 }
 await waitFor(`!!document.querySelector('#sidebar-new-session') && !document.querySelector('#sidebar-new-session').disabled && document.querySelector('[data-sidebar-session][aria-current=page]')?.dataset.sidebarSession===${JSON.stringify(history)}`);
 for(const id of [current,history]) {
  await js(`document.querySelector('[data-sidebar-session="'+${JSON.stringify(id)}+'"]').click()`);
  await waitFor(`!document.querySelector('#sidebar-new-session').disabled && document.querySelector('[data-sidebar-session][aria-current=page]')?.dataset.sidebarSession===${JSON.stringify(id)}`);
 }
 await waitFor("document.querySelectorAll('#messages [data-history-attachment]').length===2");
 console.log('HISTORY_STAGE','历史卡片已出现',await js("[...document.querySelectorAll('#messages .msg-node')].map(n=>({text:n.querySelector('.msg-text')?.textContent,cards:n.querySelectorAll('[data-history-attachment]').length}))"));
 await check('真实历史附件只属于对应消息并安全展示名称',"(()=>{const rows=[...document.querySelectorAll('#messages .msg-node')].filter(n=>n.querySelector('.msg-text')?.textContent==='相同历史正文');const cards=[...rows[0].querySelectorAll('[data-history-attachment]')];return {paired:rows.length===2&&rows[1].querySelectorAll('[data-history-attachment]').length===0,ordered:cards[0].dataset.attachmentKind==='image'&&cards[1].dataset.attachmentKind==='file',imageReference:cards[0].textContent.includes('历史图片.png')&&cards[0].textContent.includes('2 × 1'),fileName:cards[1].textContent.includes('<b>说明.txt'),fileBytes:cards[1].textContent.includes('3 B'),escaped:!cards[1].querySelector('b')}})()");
 await js(`document.querySelector('[data-sidebar-session="'+${JSON.stringify(current)}+'"]').click()`);
 await waitFor(`!document.querySelector('#sidebar-new-session').disabled && document.querySelector('[data-sidebar-session][aria-current=page]')?.dataset.sidebarSession===${JSON.stringify(current)}`);
 win.webContents.removeListener('console-message',consoleProbe);
};
