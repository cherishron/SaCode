// 穿过真实 Host 投影与产品会话切换，验证附件卡片没有在适配时丢失。
module.exports=async function({win,bridge,waitFor,check}) {
 const js=c=>win.webContents.executeJavaScript(c,true);
 const current=await js("document.querySelector('[data-sidebar-session][aria-current=page]').dataset.sidebarSession");
 const other=await js(`[...document.querySelectorAll('[data-sidebar-session]')].find(n=>n.dataset.sidebarSession!==${JSON.stringify(current)}).dataset.sidebarSession`);
 const image=await bridge.request('attachment/upload',{kind:'image',name:'队列图.png',mediaType:'image/png',data:'iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAAAAAAA'});
 const file=await bridge.request('attachment/upload',{kind:'file',name:'说明文档.txt',mediaType:'',data:'YWJj'});
 await bridge.request('queue/enqueue',{text:'真实附件排队',rpcId:'queue-ref-smoke',receiptIds:[image.receiptId,file.receiptId]});
 for(const id of [other,current]) {
  await js(`document.querySelector('[data-sidebar-session="'+${JSON.stringify(id)}+'"]').click()`);
  await waitFor(`document.querySelector('[data-sidebar-session][aria-current=page]')?.dataset.sidebarSession===${JSON.stringify(id)} && !document.querySelector('#sidebar-new-session').disabled`);
 }
 await waitFor("!!document.querySelector('.composer .queue-file')");
 await check('真实队列附件引用投影成产品卡片',"(()=>{const row=document.querySelector('.composer [data-queue-id]');return {text:row.textContent.includes('真实附件排队'),fileName:row.querySelector('.queue-fileName').textContent==='说明文档.txt',fileSize:row.querySelector('.queue-fileSize').textContent==='3 B',imageReference:row.querySelector('[role=img]').getAttribute('aria-label')==='排队图片 队列图.png',mixedEditDisabled:row.querySelector('[aria-label=编辑排队消息]').disabled}})()");
 await js("document.querySelector('.composer [aria-label=删除排队消息]').click()");
 await waitFor("!document.querySelector('.composer [data-queue-dock]')");
 const rows=(await bridge.request('queue/describe')).nextTurn;
 await check('删除排队附件卡片同时更新真实核心队列',`({removed:${rows.length===0},noCards:!document.querySelector('.composer .queue-file,.composer [aria-label="排队图片 队列图.png"]')})`);
};
