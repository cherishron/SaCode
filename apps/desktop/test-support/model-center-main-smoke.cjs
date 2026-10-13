// 定向完整主窗口验收：复用产品createWindow、preload及实际IPC，不装配假处理器。
module.exports = async function modelCenterMainSmoke({app,bridge,seedIfNeeded,createWindow}) {
  seedIfNeeded();const win=createWindow();
  const js=code=>win.webContents.executeJavaScript(code);
  const wait=async code=>{for(let i=0;i<200;i++){try{if(await js(code))return;}catch{}await new Promise(r=>setTimeout(r,30));}throw Error('model-main-timeout: '+code);};
  try {
    await wait("!!document.querySelector('#open-settings') && !!window.sacode");
    await js("document.querySelector('#open-settings').click()");
    await wait("!!document.querySelector('.settings-dialog[open]')");
    await js("(()=>{const button=[...document.querySelectorAll('.settings-nav button')].find(b=>b.textContent.includes('模型中心'));if(!button)throw Error('model-settings-entry-missing');button.click();})()");
    await wait("!!document.querySelector('[data-model-center-tab=\"provider-settings\"]')");
    await js("document.querySelector('[data-model-center-tab=\"provider-settings\"]').click()");
    await wait("!!document.querySelector('.ps-root select[aria-label=\"内置供应商目录\"]') && !document.querySelector('.ps-root select[aria-label=\"内置供应商目录\"]').disabled");
    await js("(()=>{const pick=document.querySelector('select[aria-label=\"内置供应商目录\"]');pick.value='stepfun';pick.dispatchEvent(new Event('change',{bubbles:true}));return Vue.nextTick();})()");
    await js("[...document.querySelectorAll('.ps-root button')].find(b=>b.textContent==='添加实例').click()");
    await wait("document.querySelector('.ps-saved')?.textContent.includes('供应商实例已添加')");
    const created=await bridge.request('model/registry/describe');
    if(created.providers.length!==1||created.providers[0].id!=='stepfun')throw Error('model-core-create-mismatch');
    await js("[...document.querySelectorAll('.ps-root button')].find(b=>b.textContent==='编辑').click()");
    await wait("!!document.querySelector('input[aria-label=\"API 密钥\"]')");
    await js("(()=>{const input=document.querySelector('input[aria-label=\"API 密钥\"]');input.value='fixture-main-window-key';input.dispatchEvent(new Event('input',{bubbles:true}));return Vue.nextTick();})()");
    await js("[...document.querySelectorAll('.ps-root button')].find(b=>b.textContent==='保存').click()");
    await wait("document.querySelector('.ps-saved')?.textContent.includes('已保存') && !document.querySelector('input[aria-label=\"API 密钥\"]')");
    await js("(()=>{const pick=document.querySelector('select[aria-label^=\"默认模型 \"]');if(!pick||pick.disabled)throw Error('default-picker-unavailable');pick.value=pick.options[1].value;pick.dispatchEvent(new Event('change',{bubbles:true}));})()");
    await wait("document.querySelector('.ps-saved')?.textContent==='默认模型已保存'");
    const selected=await bridge.request('model/registry/describe');
    if(!selected.providers[0].keyConfigured||selected.defaultProviderId!=='stepfun'||selected.defaultModel!==selected.providers[0].models[0].id)throw Error('model-core-save-mismatch');
    await js("document.querySelector('.settings-close').click()");
    await wait("!document.querySelector('.settings-dialog[open]')");
    console.log('MODEL_MAIN_SMOKE PASS');await bridge.stop();app.exit(0);
  } catch(error) { console.error('MODEL_MAIN_SMOKE FAIL',error);console.error('MODEL_MAIN_DOM',await js("document.querySelector('.settings-dialog')?.textContent").catch(()=>''));await bridge.stop();app.exit(1); }
};
