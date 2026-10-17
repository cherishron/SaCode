// 产品通用设置实际读写 Host，复用整页驱动，不用夹具开关冒充持久设置。
module.exports=async({win,check,waitFor,bridge,outDir})=>{
  const js=code=>win.webContents.executeJavaScript(code,true);
  await js("document.querySelector('#open-settings').click();document.querySelector('#settings-tab-general').click()");
  await waitFor("!!document.querySelector('#busy-send-preference')&&!document.querySelector('#busy-send-preference').disabled");
  const before=(await bridge.request('global/appearance/get')).busySend;
  for(const value of ['steer','queue']){
    await js(`(()=>{const e=document.querySelector('#busy-send-preference');e.value='${value}';e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await waitFor(`document.querySelector('#busy-send-preference').value==='${value}'&&!document.querySelector('#busy-send-preference').disabled&&document.querySelector('.busy-send-note').textContent.includes('已保存')`);
    const stored=await bridge.request('global/appearance/get');
    if(stored.busySend!==value)throw Error('繁忙发送设置没有真实落到核心');
  }
  await check('繁忙发送设置与宿主偏好一致',"({options:[...document.querySelector('#busy-send-preference').options].map(e=>e.textContent).join(',')==='排队发送,插话发送',explanation:document.querySelector('.busy-send-copy').textContent.includes('Ctrl/Cmd+Enter'),saved:document.querySelector('.busy-send-note').textContent.includes('已保存')})");
  if(outDir)require('node:fs').writeFileSync(require('node:path').join(outDir,'general-busy-send.png'),(await win.webContents.capturePage()).toPNG());
  await js(`(()=>{const e=document.querySelector('#busy-send-preference');e.value='${before}';e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await waitFor(`document.querySelector('#busy-send-preference').value==='${before}'&&!document.querySelector('#busy-send-preference').disabled`);
  await js("document.querySelector('.settings-close').click()");
};
