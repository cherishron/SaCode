// 真实 Chromium 组件交互验收。前半段走真实 IPC → 真实宿主进程（后端接入证据）；
// 后半段的提供商适配器是内存桩，只用于组件行为，不作为后端接入证据。
module.exports = async function ({ win, check, waitFor, outDir, bridge }) {
  const js = source => win.webContents.executeJavaScript(`(async()=>{${source}})()`, true);
  await js(`document.querySelector('#open-settings').click();document.querySelector('#settings-tab-model-center').click()`);
  await waitFor("!!document.querySelector('#models-add-provider')&&!document.querySelector('#models-add-provider').disabled");
  await check('模型中心替换旧入口', "({singleEntry:!!document.querySelector('#settings-tab-model-center')&&!document.querySelector('#settings-tab-models'),fourTabs:document.querySelectorAll('[data-model-center-tab]').length===4,providersActive:document.querySelector('[data-model-center-tab=provider-settings]').getAttribute('aria-pressed')==='true'})");
  await js(`document.querySelector('[data-model-center-tab="custom-models"]').click()`);
  await waitFor("!!document.querySelector('.cm-primary')&&!document.querySelector('.cm-loading')");
  await js(`document.querySelector('.cm-primary').click()`);
  await js(`for(const [label,value] of [['ID','center-smoke'],['名称','模型中心验收']]){const e=document.querySelector('.cm-ipt[aria-label="'+label+'"]');e.value=value;e.dispatchEvent(new Event('input',{bubbles:true}));}`);
  await js(`[...document.querySelectorAll('.cm-primary')].find(b=>b.textContent==='保存').click()`);
  await waitFor("!!document.querySelector('.cm-name')&&document.querySelector('.cm-root').textContent.includes('模型中心验收')&&!document.querySelector('.cm-loading')");
  await check('模型中心自定义模型真实保存', "(async()=>{const v=await window.sacode.customsDescribe();return {persisted:v.models.some(m=>m.id==='center-smoke'&&m.name==='模型中心验收'),onlyCurrentPage:!document.querySelector('#models-add-provider')}})()");
  await js(`document.querySelector('[data-model-center-tab="budget-stats"]').click()`);
  await waitFor("!!document.querySelector('.bs-table')");
  await check('费用页读取核心限额并声明流水缺口', "({model:document.querySelector('.bs-root').textContent.includes('模型中心验收'),honest:document.querySelector('.bs-root').textContent.includes('后端目前不提供')})");
  await js(`document.querySelector('[data-model-center-tab="migration"]').click()`);
  await waitFor("!!document.querySelector('.mig-table')");
  await check('迁移页呈现真实模型且摘要不冒充恢复包', "({model:document.querySelector('.mig-root').textContent.includes('模型中心验收'),summary:document.querySelector('.mig-root').textContent.includes('不能用来恢复配置'),textarea:!!document.querySelector('textarea[aria-label=\"条目列表\"]')})");
  await js(`const v=await window.sacode.customsDescribe();await window.sacode.customsRemove('center-smoke',v.revision);document.querySelector('[data-model-center-tab="provider-settings"]').click()`);
  await waitFor("!!document.querySelector('#models-add-provider')&&!document.querySelector('#models-add-provider').disabled");
  await check('模型页真实产品入口', "({typedComponent:!!window.SaCodeModels?.Page,accountRemoved:!document.querySelector('#settings-page-model-center').textContent.includes('DeepSeek'),noStubNotice:!document.querySelector('#settings-page-model-center').textContent.includes('后端尚未接入')})");
  await js(`document.querySelector('#models-add-provider').click()`);
  await check('目录来自宿主而非空表', "(()=>{const s=[...document.querySelectorAll('#settings-page-model-center select[aria-label=\"提供商\"]')];return {selectPresent:s.length===1,catalogNamed:s[0].textContent.includes('StepFun'),threeProtocols:document.querySelector('#settings-page-model-center select[aria-label=\"API 协议\"]').options.length===3}})()");
  await check('模型页自定义添加表单', "({route:!!document.querySelector('#settings-page-model-center input[aria-label=\"Provider ID\"]'),keyMasked:document.querySelector('#settings-page-model-center input[aria-label=\"API 密钥\"]').type==='password',protocols:document.querySelector('#settings-page-model-center select[aria-label=\"API 协议\"]').options.length===3})");

  // —— 真实往返：页面上填的提供商要能在另一个进程（宿主）里读回来 ——
  const realClick = text => js(`[...document.querySelectorAll('#settings-page-model-center button')].find(e=>e.textContent===${JSON.stringify(text)}&&!e.closest('[hidden]')).click()`);
  const realInput = (label, value) => js(`(()=>{const e=[...document.querySelectorAll('#settings-page-model-center input[aria-label=${JSON.stringify(label)}]')].find(e=>!e.closest('[hidden]'));e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('input',{bubbles:true}))})()`);
  await realClick('自定义模型 API');
  await realInput('Provider ID', 'smoke-gw');
  await realInput('显示名称', '冒烟网关');
  await realInput('API 地址', 'http://127.0.0.1:9/v1');
  await realInput('API 密钥', 'smoke-secret-value');
  await realClick('＋ 添加模型');
  await realInput('模型 ID 1', 'smoke-model');
  await realInput('显示名称 1', '冒烟模型');
  await realClick('创建提供商');
  await waitFor("document.querySelector('#settings-page-model-center .models-savedNotice')?.textContent.includes('冒烟网关')");
  const view = await bridge.request('model/registry/describe');
  const stored = view.providers.find(p => p.id === 'smoke-gw');
  const cred = stored ? await bridge.request('credential/describe', { ref: stored.credentialRef }) : { configured: false };
  await check('密钥不回显在页面文本里', "(()=>{const b=document.querySelector('#settings-page-model-center');const t=b?b.textContent:'no-section';return {noEcho:!t.includes('smoke-secret-value'),savedShown:t.includes('冒烟网关'),dotConfigured:!!document.querySelector('#settings-page-model-center [aria-label=\"API 密钥已配置\"]')}})()");
  await check('模型页写入落到宿主进程', '(' + JSON.stringify({
    persisted: !!stored,
    derivedRef: !!stored && stored.credentialRef === 'SA_CODE_SMOKE_GW_API_KEY',
    keyConfigured: !!stored && stored.keyConfigured === true,
    modelStored: !!stored && stored.models.length === 1 && stored.models[0].id === 'smoke-model',
    revisionAdvanced: view.revision >= 1,
    registryDocHasNoSecret: !JSON.stringify(view).includes('smoke-secret-value'),
    credentialReadBack: cred.configured === true,
  }) + ')');
  require('node:fs').writeFileSync(require('node:path').join(outDir, 'models-real-save.png'), (await win.webContents.capturePage()).toPNG());

  require('node:fs').writeFileSync(require('node:path').join(outDir,'models-custom-form.png'),(await win.webContents.capturePage()).toPNG());
  await js(`document.querySelector('.settings-close').click();
    (()=>{
      const model={id:'test-model',name:'测试模型',contextWindow:'128K',maxTokens:'8K',image:false};
      const provider={id:'fixture',name:'测试提供商',baseUrl:'https://example.test/v1',protocol:'openai-completions',models:[model],keyConfigured:true,declared:false,defaultModels:[model],modelsCustomized:false,credentialWritable:false};
      const root=document.createElement('div');root.id='models-fixture';root.className='settings-dialog';document.body.append(root);
      window.modelFixture={root,rows:[provider],saved:null,deleted:null,revision:1,writable:true};
      const adapter={async load(){const snapshot={revision:String(modelFixture.revision),writable:modelFixture.writable,providers:modelFixture.rows,catalog:[{...provider,id:'catalog-fixture',name:'目录提供商'}]};if(modelFixture.delayNext){modelFixture.delayNext=false;await new Promise(resolve=>modelFixture.releaseLoad=resolve);modelFixture.oldLoadReturned=true;}return snapshot;},subscribe(invalidate){modelFixture.invalidate=invalidate;return()=>{modelFixture.unsubscribed=true;modelFixture.invalidate=null;};},async save(d,revision){modelFixture.expectedRevision=revision;if(revision!==String(modelFixture.revision))throw Object.assign(Error('conflict'),{code:'model-conflict'});if(modelFixture.rejectSave)throw Error('fixture failure');modelFixture.revision++;modelFixture.saved={...d,models:d.models.map(m=>({...m}))};modelFixture.rows=[...modelFixture.rows.filter(p=>p.id!==d.id),{...d,keyConfigured:!!d.key||d.keyConfigured,key:undefined}];},async remove(id,revision){if(revision!==String(modelFixture.revision))throw Object.assign(Error('conflict'),{code:'model-conflict'});modelFixture.revision++;modelFixture.deleted=id;modelFixture.rows=modelFixture.rows.filter(p=>p.id!==id);},async listModels(){return [{...model,id:'remote-a'},{...model,id:'remote-b'}];}};
      modelFixture.adapter=adapter;modelFixture.app=Vue.createApp(SaCodeModels.Page,{adapter});modelFixture.app.mount(root);
      modelFixture.input=(label,value)=>{const e=[...root.querySelectorAll('input[aria-label="'+label+'"]')].find(e=>!e.closest('[hidden]'));e.value=value;e.dispatchEvent(new Event('input',{bubbles:true}));};
      modelFixture.click=(text)=>{const e=[...root.querySelectorAll('button')].find(e=>e.textContent===text&&!e.closest('[hidden]'));if(!e)throw Error('缺少按钮 '+text);e.click();return Vue.nextTick();};
    })()`);
  await waitFor("document.querySelector('#models-fixture .models-rowName')?.textContent==='测试提供商'");
  await check('模型提供商状态列表', "({configured:!!document.querySelector('#models-fixture [aria-label=\"API 密钥已配置\"]'),edit:!!document.querySelector('#models-fixture [aria-label=\"编辑 测试提供商\"]'),remove:!!document.querySelector('#models-fixture [aria-label=\"删除 测试提供商\"]')})");
  await js(`document.querySelector('#models-fixture [aria-label="编辑 测试提供商"]').click()`);
  await check('目录提供商身份与环境凭证边界', "({noCustomTag:!document.querySelector('#models-fixture .models-rowTag'),noRouteEditor:!document.querySelector('#models-fixture input[aria-label=\"Provider ID\"]'),keyLocked:document.querySelector('#models-fixture input[type=password]').disabled})");
  await js(`await modelFixture.click('＋ 添加模型')`);
  await check('目录模型修改标注自定义', "({customized:document.querySelector('#models-fixture').textContent.includes('已自定义模型目录'),twoModels:document.querySelectorAll('#models-fixture .models-modelEntry').length===2})");
  await js(`await modelFixture.click('恢复默认模型')`);
  await check('恢复适配器默认模型只修改草稿', "({inherited:document.querySelector('#models-fixture').textContent.includes('正在使用适配器默认模型'),oneModel:document.querySelectorAll('#models-fixture .models-modelEntry').length===1,notSaved:modelFixture.saved===null})");
  await js(`await modelFixture.click('取消')`);
  await js(`await modelFixture.click('＋ 添加模型提供商');await modelFixture.click('自定义模型 API');modelFixture.input('Provider ID','custom-one');modelFixture.input('显示名称','自定义草稿');modelFixture.input('API 地址','https://gateway.example/v1');`);
  await js(`await modelFixture.click('第三方模型提供商')`);
  await js(`await modelFixture.click('自定义模型 API')`);
  await check('模型添加方式切换保留草稿', "({route:document.querySelector('#models-fixture input[aria-label=\"Provider ID\"]').value==='custom-one',name:document.querySelector('#models-fixture .models-addPanel:not([hidden]) input[aria-label=\"显示名称\"]').value==='自定义草稿'})");
  await js(`await modelFixture.click('创建提供商')`);
  await check('自定义提供商缺模型拒绝保存', "({rejected:document.querySelector('#models-fixture .models-error').textContent.includes('至少需要一个模型'),notSaved:modelFixture.saved===null})");
  await js(`await modelFixture.click('＋ 添加模型')`);
  await js(`modelFixture.input('模型 ID 1','local-model');modelFixture.input('API 密钥','fixture-key');await modelFixture.click('获取可用模型')`);
  await waitFor("[...document.querySelectorAll('.sacode-dialog')].some(e=>e.textContent.includes('选择要添加的模型'))");
  await js(`const d=[...document.querySelectorAll('.sacode-dialog')].find(e=>e.textContent.includes('选择要添加的模型'));d.querySelector('input[aria-label="搜索模型"]').value='remote-b';d.querySelector('input[aria-label="搜索模型"]').dispatchEvent(new Event('input',{bubbles:true}));`);
  await check('远端模型目录搜索', "({filtered:document.querySelectorAll('.models-fetchRow').length===1})");
  await js(`document.querySelector('.models-fetchRow input').click()`);
  await js(`document.querySelector('.models-fetchList').closest('.sacode-dialog').querySelector('.models-primaryButton').click()`);
  await check('选择远端模型合并草稿', "({twoModels:document.querySelector('#models-fixture .models-addPanel:not([hidden])').querySelectorAll('.models-modelEntry').length===2,stillDraft:modelFixture.saved===null})");
  await js(`modelFixture.rejectSave=true;await modelFixture.click('创建提供商')`);
  await waitFor("document.querySelector('#models-fixture .models-error')?.textContent.includes('保存失败')");
  await check('模型保存失败保留完整草稿', "({notSaved:modelFixture.saved===null,models:document.querySelector('#models-fixture .models-addPanel:not([hidden])').querySelectorAll('.models-modelEntry').length===2,key:document.querySelector('#models-fixture .models-addPanel:not([hidden]) input[type=password]').value.length>0})");
  await js(`modelFixture.rejectSave=false;await modelFixture.click('创建提供商')`);
  await waitFor("modelFixture.rows.length===2 && !document.querySelector('#models-fixture .models-addCard')");
  await check('模型配置通过适配器保存再加载', "({saved:modelFixture.saved.id==='custom-one',models:modelFixture.saved.models.length===2,confirmation:document.querySelector('#models-fixture .models-savedNotice').textContent.includes('自定义草稿'),secretCleared:!document.querySelector('#models-fixture input[type=password]')})");
  await js(`document.querySelector('#models-fixture [aria-label="删除 自定义草稿"]').click()`);
  await check('删除提供商需要确认', "({notDeleted:modelFixture.deleted===null,confirmation:[...document.querySelectorAll('.sacode-dialog')].some(e=>e.textContent.includes('移除提供商配置和存储的 API 密钥'))})");
  await js(`const dialog=[...document.querySelectorAll('.sacode-dialog')].find(e=>e.textContent.includes('移除提供商配置和存储的 API 密钥'));[...dialog.querySelectorAll('button')].find(e=>e.textContent==='确认删除').click()`);
  await waitFor("modelFixture.deleted==='custom-one' && modelFixture.rows.length===1");
  await check('确认删除后刷新提供商列表', "({removed:document.querySelectorAll('#models-fixture .models-rowCard').length===1})");
  await js(`document.querySelector('#models-fixture [aria-label="编辑 测试提供商"]').click()`);
  await js(`modelFixture.input('API 地址','https://new.example/v1');modelFixture.revision++;await modelFixture.click('保存')`);
  await check('配置版本冲突保留草稿并拒绝覆盖', "({conflict:document.querySelector('#models-fixture .models-error').textContent.includes('已被其他地方改动'),draft:document.querySelector('#models-fixture input[aria-label=\"API 地址\"]').value==='https://new.example/v1',original:modelFixture.rows[0].baseUrl==='https://example.test/v1'})");
  await js(`await modelFixture.click('取消')`);
  await js(`document.querySelector('#models-fixture [aria-label="编辑 测试提供商"]').click()`);
  await js(`await modelFixture.click('保存')`);
  await waitFor("!document.querySelector('#models-fixture .models-editor')");
  await check('冲突后重新打开使用最新版本', "({latest:Number(modelFixture.expectedRevision)===modelFixture.revision-1,saved:document.querySelector('#models-fixture .models-savedNotice').textContent.includes('测试提供商')})");
  await js(`modelFixture.writable=false;modelFixture.invalidate()`);
  await waitFor("document.querySelector('#models-fixture .models-notice')?.textContent.includes('只读')");
  await js(`document.querySelector('#models-fixture [aria-label="编辑 测试提供商"]').click()`);
  await check('只读配置禁止所有写操作', "({notice:document.querySelector('#models-fixture .models-notice').textContent.includes('只读'),add:document.querySelector('#models-fixture #models-add-provider').disabled,remove:document.querySelector('#models-fixture [aria-label=\"删除 测试提供商\"]').disabled,inputs:[...document.querySelectorAll('#models-fixture .models-editor input')].every(e=>e.disabled),save:[...document.querySelectorAll('#models-fixture button')].find(e=>e.textContent==='保存').disabled})");
  await js(`modelFixture.writable=true;modelFixture.delayNext=true;modelFixture.invalidate();modelFixture.rows=modelFixture.rows.map(p=>({...p,name:'更新目录提供商'}));modelFixture.revision++;modelFixture.invalidate()`);
  await waitFor("document.querySelector('#models-fixture .models-rowName')?.textContent==='更新目录提供商'");
  await js(`modelFixture.releaseLoad()`);
  await waitFor("modelFixture.oldLoadReturned===true");
  await check('目录刷新拒绝乱序旧快照覆盖', "({latest:document.querySelector('#models-fixture .models-rowName').textContent==='更新目录提供商',writable:!document.querySelector('#models-fixture #models-add-provider').disabled})");
  await js(`modelFixture.app.unmount()`);
  await check('模型页面卸载回收配置订阅', "({disposed:modelFixture.unsubscribed===true,noListener:modelFixture.invalidate===null})");
  await js(`modelFixture.root.remove();delete window.modelFixture;`);
};
