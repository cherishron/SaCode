// 输入按键的实际 DOM 路由与现有仓颉消息落盘；不证明队列/steer 后端已接入。
module.exports=async function({win,check,waitFor}){
  const js=code=>win.webContents.executeJavaScript(`(async()=>{${code}})()`,true);
  await js(`const node=document.createElement('textarea');node.id='keymap-fixture';document.body.append(node);window.keymapFixture={node,sends:[],allowed:true,menu:false,composing:[],popup:0};const f=keymapFixture;f.dispose=SaCodeAttachments.installComposerKeymap(node,{canSubmit:()=>f.allowed,submit:a=>f.sends.push(a),arbitrate:(key,c)=>{f.composing.push(c);return f.menu?'consumed':'pass';},dismissPopup:()=>f.popup++});f.key=(options)=>{const e=new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true,...options});node.dispatchEvent(e);return e.defaultPrevented;};`);
  await js(`const f=keymapFixture;f.plain=f.key({});f.ctrl=f.key({ctrlKey:true});f.meta=f.key({metaKey:true});f.shift=f.key({shiftKey:true});f.key({repeat:true});f.key({altKey:true});f.key({ctrlKey:true,metaKey:true});f.key({ctrlKey:true,shiftKey:true});`);
  await check('Enter 发送、加速手势与 Shift 换行路由',"({plain:keymapFixture.plain,ctrl:keymapFixture.ctrl,meta:keymapFixture.meta,nativeShift:!keymapFixture.shift,sends:JSON.stringify(keymapFixture.sends)==='[false,true,true]'})");
  await js(`const f=keymapFixture;f.allowed=false;f.blocked=f.key({});f.allowed=true;f.menu=true;f.menuConsumed=f.key({});f.key({key:'Escape'});f.menu=false;f.beforeIME=f.sends.length;f.key({isComposing:true});f.key({keyCode:229});f.node.dispatchEvent(new CompositionEvent('compositionstart'));f.key({});f.node.dispatchEvent(new CompositionEvent('compositionend'));f.key({});`);
  await check('忙碌、菜单与输入法确认不误发消息',"({blocked:keymapFixture.blocked,menu:keymapFixture.menuConsumed,popup:keymapFixture.popup===1,noIME:keymapFixture.sends.length===keymapFixture.beforeIME,attributeCleared:!keymapFixture.node.hasAttribute('data-composer-composing')})");
  await js(`await new Promise(resolve=>setTimeout(resolve,20));keymapFixture.key({});keymapFixture.afterIME=keymapFixture.sends.length;keymapFixture.dispose();keymapFixture.key({});`);
  await check('输入法结束后恢复发送且卸载清理按键监听',"({resumed:keymapFixture.afterIME===keymapFixture.beforeIME+1,disposed:keymapFixture.sends.length===keymapFixture.afterIME})");
  await check('运行状态与偏好共同决定排队或即时补充',"({idle:SaCodeAttachments.resolveSubmitMode('steer',false,true,true)==='queue',noSteer:SaCodeAttachments.resolveSubmitMode('steer',true,true,false)==='queue',queue:SaCodeAttachments.resolveSubmitMode('queue',true,false,true)==='queue',acceleratedSteer:SaCodeAttachments.resolveSubmitMode('queue',true,true,true)==='steer',steer:SaCodeAttachments.resolveSubmitMode('steer',true,false,true)==='steer',acceleratedQueue:SaCodeAttachments.resolveSubmitMode('steer',true,true,true)==='queue'})");
  await js(`keymapFixture.node.remove();delete window.keymapFixture;const node=document.querySelector('#composer');node.value='按键验收的真实用户消息';node.dispatchEvent(new Event('input',{bubbles:true}));node.focus();node.setSelectionRange(node.value.length,node.value.length);node.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',ctrlKey:true,isComposing:true,bubbles:true,cancelable:true}));`);
  await check('真实输入区中文候选确认不穿透到全局发送',"({retained:document.querySelector('#composer').value==='按键验收的真实用户消息',enabled:!document.querySelector('#send').disabled})");
  win.focus();win.webContents.focus();
  win.webContents.sendInputEvent({type:'keyDown',keyCode:'Enter',modifiers:['shift']});
  win.webContents.sendInputEvent({type:'char',keyCode:'\r',modifiers:['shift']});
  win.webContents.sendInputEvent({type:'keyUp',keyCode:'Enter',modifiers:['shift']});
  await waitFor("document.querySelector('#composer').value.endsWith('\\n')");
  await check('真实输入区 Shift Enter 保留浏览器换行',"({newline:document.querySelector('#composer').value==='按键验收的真实用户消息\\n'})");
  await js(`document.querySelector('#composer').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}))`);
  await waitFor("document.querySelector('#composer').value===''");
  await check('真实输入区普通 Enter 经宿主确认后清空草稿',"({cleared:document.querySelector('#composer').value==='',message:document.querySelector('#messages').textContent.includes('按键验收的真实用户消息'),focus:document.activeElement.id==='composer'})");
  // 运行中发送的排队与取消，由金路径夹具在可控制的慢流路由上验收（示例假轮的
  // 两帧窗口太短，按不动）：这里不再重复一遍时序碰运气。
};
