// 真实注册表、真实上传与产品发送入口：非图片模型不能清空草稿或发送图片。
module.exports=async function({win,bridge,waitFor,check}) {
 const js=code=>win.webContents.executeJavaScript(code,true);
 const before=await bridge.request('model/registry/describe');
 await bridge.request('model/registry/update',{draft:{id:'image-gate',name:'图片门控验收',baseUrl:'http://127.0.0.1:1',protocol:'openai-completions',models:[{id:'text-only',name:'纯文字模型',contextWindow:'',maxTokens:'',image:false}]},expectedRevision:before.revision});
 const saved=await bridge.request('model/registry/describe');
 await bridge.request('model/registry/set-default',{providerId:'image-gate',model:'text-only',expectedRevision:saved.revision});
 await win.webContents.reload();
 await waitFor("!!document.querySelector('#composer') && document.querySelector('.composer [aria-label^=\"选择模型，当前\"]')?.textContent.includes('纯文字模型')");
 await js(`(()=>{const bytes=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAAAAAAA'),c=>c.charCodeAt(0));const data=new DataTransfer();data.items.add(new File([bytes],'门控.png',{type:'image/png'}));const input=document.querySelector('.composer input[type=file]');input.files=data.files;input.dispatchEvent(new Event('change',{bubbles:true}));const draft=document.querySelector('#composer');draft.value='图片草稿要保留';draft.dispatchEvent(new Event('input',{bubbles:true}));})()`);
 await waitFor("!!document.querySelector('.composer [data-upload-status=ready]')");
 const count=await js("document.querySelectorAll('[data-msg-id]').length");
 await js("document.querySelector('#send').click()");
 await waitFor("document.querySelector('#error')?.textContent.includes('未声明支持图片')");
 await check('非图片模型在真实发送前门控并保留草稿',`({explicit:document.querySelector('#error').textContent.includes('选择支持图片的模型'),draft:document.querySelector('#composer').value==='图片草稿要保留',attachment:!!document.querySelector('.composer [data-upload-status=ready]'),notSent:document.querySelectorAll('[data-msg-id]').length===${count},notBusy:document.querySelector('#send').getAttribute('aria-busy')==='false'})`);
 await js("document.querySelector('[aria-label=\"移除图片 门控.png\"]').click();const draft=document.querySelector('#composer');draft.value='';draft.dispatchEvent(new Event('input',{bubbles:true}))");
 const current=await bridge.request('model/registry/describe');
 await bridge.request('model/registry/remove',{id:'image-gate',expectedRevision:current.revision});
 if(before.defaultProviderId&&before.defaultModel){const next=await bridge.request('model/registry/describe');await bridge.request('model/registry/set-default',{providerId:before.defaultProviderId,model:before.defaultModel,expectedRevision:next.revision});}
 await win.webContents.reload();
 await waitFor("!!document.querySelector('#composer') && !document.querySelector('#send').getAttribute('aria-busy')?.includes('true')");
};
