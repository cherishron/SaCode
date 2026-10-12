const {app,BrowserWindow,nativeTheme}=require('electron');
const {mkdirSync,writeFileSync}=require('node:fs');const {join}=require('node:path');
const captureDir=process.env.SACODE_MODEL_CAPTURE_DIR;
if(captureDir)mkdirSync(captureDir,{recursive:true});
if(['light','dark'].includes(process.env.SACODE_MODEL_THEME))nativeTheme.themeSource=process.env.SACODE_MODEL_THEME;
app.whenReady().then(async()=>{
  const win=new BrowserWindow({show:false,width:Number(process.env.SACODE_MODEL_WIDTH)||600,height:760,webPreferences:{nodeIntegration:false,contextIsolation:true}});
  // 渲染层报错时把 console 落到 stderr：executeJavaScript 只回「Script failed to execute」，
  // 不带具体信息，调试时只能靠这里看到 <script> 加载失败或顶层 ReferenceError。
  win.webContents.on('console-message',(_e,_lvl,msg,_line,_src)=>process.stderr.write('RENDERER: '+msg+'\n'));
  let captureIndex=0;
  win.webContents.on('console-message',async(_e,_lvl,msg)=>{
    if(!msg.startsWith('SACODE_MODEL_CAPTURE:'))return;
    try{if(captureDir){
      const label=String(++captureIndex)+'-'+msg.slice(21).replace(/[^a-z0-9-]/gi,'');
      await win.webContents.executeJavaScript('window.scrollTo(0,0);new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
      writeFileSync(join(captureDir,label+'.png'),(await win.webContents.capturePage()).toPNG());
      await win.webContents.executeJavaScript('window.scrollTo(0,document.documentElement.scrollHeight);new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
      writeFileSync(join(captureDir,label+'-bottom.png'),(await win.webContents.capturePage()).toPNG());
      await win.webContents.executeJavaScript('window.scrollTo(0,0)');
    }await win.webContents.executeJavaScript('window.__modelCaptureDone?.()');}
    catch(e){console.error(e);app.exit(1);}
  });
  // fixture 走末位 argv：electron 会把 --no-sandbox/--user-data-dir 等开关留在 argv 里，
  // 按固定下标取会被标志挤偏；末位永远是测试传入的 fixture 路径。
  await win.loadFile(process.argv[process.argv.length-1]);
  const checks=await win.webContents.executeJavaScript(`(async()=>{
    const checks=[],root=document.querySelector('#fixture'),errors=[];const check=(name,ok)=>checks.push({name,ok});
    const settle=async()=>{await Promise.resolve();await Vue.nextTick();await Promise.resolve();await Vue.nextTick();};
    const capture=label=>new Promise(resolve=>{window.__modelCaptureDone=resolve;console.log('SACODE_MODEL_CAPTURE:'+label);});
    const provider={id:'fixture',name:'本地提供商',baseUrl:'http://127.0.0.1:3000',protocol:'openai-completions',enabled:true,models:[],sortOrder:0,transport:'direct',declared:false};
    const custom={id:'coding',name:'编程模型',description:'',enabled:true,category:'coding',requires:['text-output'],mode:'weighted',bindings:[],dailyTokens:-1,monthlyTokens:-1,dailyAmountMicro:-1,monthlyAmountMicro:-1,maxOutputTokens:-1,probeEnabled:true,probeMaxPerDay:3};
    for(const writable of [false,true])for(const [page,row,title] of [[ModelPages.Providers,provider,'供应商'],[ModelPages.Customs,custom,'自定义模型']]){
      const adapter={describe:async()=>({providers:[provider],customs:[custom],catalog:[],revision:'r1',writable}),upsert:async()=>{throw Error('未授权写入');},remove:async()=>{throw Error('未授权删除');}};
      const ui=Vue.createApp({setup:()=>()=>Vue.h(page,{adapter})});ui.config.errorHandler=e=>errors.push(String(e));ui.mount(root);await settle();
      check(title+'列表真实呈现 '+writable,root.querySelectorAll('li').length===1&&root.textContent.includes(row.name));
      const edit=[...root.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')==='编辑 '+row.name);
      const remove=[...root.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')==='删除 '+row.name);
      check(title+'编辑删除只读护栏 '+writable,!!edit&&!!remove&&edit.disabled===!writable&&remove.disabled===!writable);
      if(writable&&edit){edit.click();await settle();check(title+'点击编辑打开字段',!!root.querySelector('input[aria-label="'+(title==='供应商'?'显示名称':'名称')+'"]'));}
      if(writable){check(title+'编辑表单字段不越界',[...root.querySelectorAll('input,select,fieldset')].every(n=>{const r=n.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1;}));check(title+'表单样式实际加载',getComputedStyle(root.querySelector('input')).borderTopStyle==='solid');}
      if(writable)await capture(title==='供应商'?'provider-edit':'custom-edit');
      const cancel=[...root.querySelectorAll('button')].find(b=>b.textContent==='取消');if(cancel){cancel.click();await settle();}
      const add=[...root.querySelectorAll('button')].find(b=>b.textContent.includes('+ 添加'));
      check(title+'添加入口只读护栏 '+writable,!!add&&add.disabled===!writable);
      if(writable&&add){add.click();await settle();check(title+'新增表单打开',!!root.querySelector('input[aria-label="'+(title==='供应商'?'Provider ID':'ID')+'"]'));}
      if(writable)await capture(title==='供应商'?'provider-create':'custom-create');
      ui.unmount();await settle();
    }
    // 多绑定仅使用明确的模拟目录，不请求或写入真实供应商。
    const longModel='跨文件代码理解与复杂接口重构模型-'+('长名称'.repeat(18));
    const multiProvider={...provider,models:[{id:'first',name:longModel},{id:'second',name:'备用语义模型'}]};
    const binding=modelId=>({providerId:provider.id,modelId,enabled:true,order:0,weight:10,priceInMicro:1200000,priceOutMicro:3600000,priceCacheReadMicro:-1,priceCacheWriteMicro:-1,priceVersion:1,currency:'CNY'});
    const multi={...custom,bindings:[binding('first'),{...binding('second'),order:1,weight:20}]};
    const multiUi=Vue.createApp({setup:()=>()=>Vue.h(ModelPages.Customs,{adapter:{describe:async()=>({providers:[multiProvider],customs:[multi],revision:'multi-r1',writable:true}),upsert:async()=>{throw Error('模拟夹具禁止保存');}}})});
    multiUi.config.errorHandler=e=>errors.push(String(e));multiUi.mount(root);await settle();
    root.querySelector('button[aria-label="编辑 '+multi.name+'"]').click();await settle();
    check('多绑定实际显示两组',root.querySelectorAll('.cm-binding').length===2);
    check('供应商显示名称并保留身份',root.querySelector('select[aria-label="供应商"]').selectedOptions[0].textContent===provider.name&&root.querySelector('select[aria-label="供应商"]').value===provider.id);
    check('长模型名有完整悬浮说明',root.querySelector('select[aria-label="模型"]').title===longModel);
    check('长模型名称与价格字段不越界',[...root.querySelectorAll('input,select,fieldset,.cm-binding')].every(n=>{const r=n.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1;}));
    check('价格与币种来自绑定',root.querySelectorAll('input[aria-label="输入价格（微）"]')[0].value==='1200000'&&root.querySelectorAll('input[aria-label="货币"]')[0].value==='CNY');
    const firstSelect=()=>root.querySelector('select[aria-label="模型"]');
    root.querySelector('button[aria-label="下移"]').click();await settle();check('绑定重排保留模型身份',firstSelect().value==='second');
    const price=root.querySelector('input[aria-label="输入价格（微）"]');price.value='2400000';price.dispatchEvent(new Event('input',{bubbles:true}));await settle();
    root.querySelectorAll('button[aria-label="上移"]')[1].click();await settle();check('重排后价格仍绑定原模型',root.querySelectorAll('input[aria-label="输入价格（微）"]')[1].value==='2400000'&&firstSelect().value==='first');
    await capture('custom-multi-bindings');
    root.querySelector('button[aria-label="删除绑定"]').click();await settle();check('删除单个绑定保留其他绑定',root.querySelectorAll('.cm-binding').length===1&&firstSelect().value==='second');
    multiUi.unmount();await settle();
    const orphan={...custom,bindings:[{...binding('missing-model'),providerId:'missing-provider'},binding('removed-model')]};
    const orphanUi=Vue.createApp({setup:()=>()=>Vue.h(ModelPages.Customs,{adapter:{describe:async()=>({providers:[multiProvider],customs:[orphan],revision:'missing-r1',writable:true}),upsert:async()=>{throw Error('模拟夹具禁止保存');}}})});
    orphanUi.config.errorHandler=e=>errors.push(String(e));orphanUi.mount(root);await settle();root.querySelector('button[aria-label="编辑 '+orphan.name+'"]').click();await settle();
    check('缺失供应商仍显示原绑定身份',root.querySelector('select[aria-label="供应商"]').value==='missing-provider'&&root.querySelector('select[aria-label="供应商"]').selectedOptions[0].disabled);
    check('缺失模型仍显示原绑定身份',root.querySelectorAll('select[aria-label="模型"]')[1].value==='removed-model'&&root.querySelectorAll('select[aria-label="模型"]')[1].selectedOptions[0].disabled);
    check('缺失目录说明保留配置',root.textContent.includes('原供应商不在当前目录中，已保留绑定')&&root.textContent.includes('原模型不在当前供应商目录中，已保留绑定'));
    const pick=root.querySelector('select[aria-label="供应商"]');pick.value=provider.id;pick.dispatchEvent(new Event('change',{bubbles:true}));await settle();
    check('用户更换供应商清除旧模型身份',root.querySelector('select[aria-label="模型"]').value==='');
    await capture('custom-missing-catalog');orphanUi.unmount();await settle();
    let saveReply,saveReject,saveCalls=0,readCalls=0,writeAllowed=true,invalidate,snapshotRevision='save-r1',sentRevision,failCustomRead=false;
    const delayedAdapter={describe:async()=>{readCalls++;if(failCustomRead)throw Error('fixture-custom-read-failed');return{providers:[multiProvider],customs:[multi],revision:snapshotRevision,writable:writeAllowed};},upsert:async(_draft,revision)=>{sentRevision=revision;saveCalls++;return new Promise((resolve,reject)=>{saveReply=resolve;saveReject=reject;});},subscribe:fn=>{invalidate=fn;return()=>{};}};
    const saveUi=Vue.createApp({setup:()=>()=>Vue.h(ModelPages.Customs,{adapter:delayedAdapter})});saveUi.config.errorHandler=e=>errors.push(String(e));saveUi.mount(root);await settle();root.querySelector('button[aria-label="编辑 '+multi.name+'"]').click();await settle();
    const nameInput=root.querySelector('input[aria-label="名称"]');nameInput.value='保留的保存草稿';nameInput.dispatchEvent(new Event('input',{bubbles:true}));await settle();
    const saveButton=[...root.querySelectorAll('button')].find(b=>b.textContent==='保存');saveButton.click();saveButton.click();await settle();
    check('保存并发仅调用一次',saveCalls===1);
    check('保存期间锁定编辑页',root.querySelector('.cm-editor').hasAttribute('inert')&&root.querySelector('.cm-editor').getAttribute('aria-busy')==='true'&&root.querySelector('button[aria-label="刷新自定义模型目录"]').disabled);
    saveReject(Error('fixture-save-rejected'));await settle();
    check('保存失败保留草稿并显示原因',root.querySelector('input[aria-label="名称"]').value==='保留的保存草稿'&&root.textContent.includes('fixture-save-rejected'));
    check('保存失败解除提交锁',!root.querySelector('.cm-editor').hasAttribute('inert')&&[...root.querySelectorAll('button')].find(b=>b.textContent==='保存').disabled===false);
    await capture('custom-save-failure');
    failCustomRead=true;root.querySelector('button[aria-label="刷新自定义模型目录"]').click();await settle();check('目录刷新失败禁止旧草稿提交',root.querySelector('.cm-editor button.cm-primary').disabled);check('目录刷新失败保留草稿并允许重试',root.textContent.includes('fixture-custom-read-failed')&&root.querySelector('input[aria-label="名称"]').value==='保留的保存草稿'&&!root.querySelector('button[aria-label="刷新自定义模型目录"]').disabled);failCustomRead=false;root.querySelector('button[aria-label="刷新自定义模型目录"]').click();await settle();check('目录读取重试恢复并保留原绑定',!root.textContent.includes('fixture-custom-read-failed')&&root.querySelector('select[aria-label="模型"]').value==='first');
    writeAllowed=false;invalidate();await settle();check('权限撤回后禁止保存',root.querySelector('.cm-editor button.cm-primary').disabled);
    writeAllowed=true;snapshotRevision='save-r2';root.querySelector('button[aria-label="刷新自定义模型目录"]').click();await settle();check('手动刷新保留模型名称和绑定草稿',root.querySelector('input[aria-label="名称"]').value==='保留的保存草稿'&&root.querySelectorAll('.cm-binding').length===2);root.querySelector('.cm-editor button.cm-primary').click();await settle();check('刷新不提升旧草稿的提交修订',sentRevision==='save-r1');const readsBeforeUnmount=readCalls;saveUi.unmount();saveReply();await settle();
    check('卸载后保存回执不再读取目录',readCalls===readsBeforeUnmount);
    let deleteCalls=0,deleteReject,deleteSnapshot='delete-r1',deleteSentRevision,deleteInvalidate;
    const deleteUi=Vue.createApp({setup:()=>()=>Vue.h(ModelPages.Customs,{adapter:{describe:async()=>({providers:[multiProvider],customs:[multi],revision:deleteSnapshot,writable:true}),remove:async(_id,revision)=>{deleteCalls++;deleteSentRevision=revision;return new Promise((_resolve,reject)=>deleteReject=reject);},subscribe:fn=>{deleteInvalidate=fn;return()=>{};}}})});
    deleteUi.config.errorHandler=e=>errors.push(String(e));deleteUi.mount(root);await settle();root.querySelector('button[aria-label="删除 '+multi.name+'"]').click();await settle();deleteSnapshot='delete-r2';deleteInvalidate();await settle();
    const confirm=[...root.querySelectorAll('button')].find(b=>b.textContent==='确认删除');confirm.click();confirm.click();await settle();check('删除重复提交仅调用一次',deleteCalls===1);check('刷新不提升删除提案修订',deleteSentRevision==='delete-r1');deleteReject(Error('fixture-delete-rejected'));await settle();check('删除失败保留确认与原因',!!root.querySelector('[role="alertdialog"]')&&root.textContent.includes('fixture-delete-rejected'));deleteUi.unmount();await settle();
    let builtinWrites=0,builtinSent;
    const builtinUi=Vue.createApp({setup:()=>()=>Vue.h(ModelPages.Providers,{adapter:{describe:async()=>({providers:[{...provider,declared:true}],catalog:[],revision:'builtin-r1',writable:true}),save:async d=>{builtinWrites++;builtinSent=d;}}})});builtinUi.config.errorHandler=e=>errors.push(String(e));builtinUi.mount(root);await settle();root.querySelector('button[aria-label="编辑 '+provider.name+'"]').click();await settle();
    check('内置供应商目录字段只读且说明保存范围',['显示名称','API 地址','API 协议','传输方式','排序'].every(label=>root.querySelector('[aria-label="'+label+'"]').disabled)&&root.textContent.includes('此处仅保存启停'));
    const builtinEnabled=root.querySelector('input[aria-label="启用"]');check('内置供应商启停仍可修改',!builtinEnabled.disabled);builtinEnabled.checked=false;builtinEnabled.dispatchEvent(new Event('change',{bubbles:true}));await settle();await capture('provider-builtin-edit');[...root.querySelectorAll('button')].find(b=>b.textContent==='保存').click();await settle();check('内置供应商启停保存保留目录字段',builtinWrites===1&&builtinSent.enabled===false&&builtinSent.baseUrl===provider.baseUrl&&builtinSent.name===provider.name);builtinUi.unmount();
    let invalidProviderWrites=0;
    const invalidProviderUi=Vue.createApp({setup:()=>()=>Vue.h(ModelPages.Providers,{adapter:{describe:async()=>({providers:[provider],catalog:[],revision:'invalid-r1',writable:true}),save:async()=>{invalidProviderWrites++;}}})});invalidProviderUi.config.errorHandler=e=>errors.push(String(e));invalidProviderUi.mount(root);await settle();root.querySelector('button[aria-label="编辑 '+provider.name+'"]').click();await settle();[...root.querySelectorAll('button')].find(b=>b.textContent==='保存').click();await settle();check('无模型供应商保存显示原因且不调用适配器',invalidProviderWrites===0&&root.textContent.includes('请配置 1–128 个模型')&&!!root.querySelector('fieldset'));invalidProviderUi.unmount();
    const validProvider={...multiProvider,models:multiProvider.models.map(m=>({...m,name:m.id,contextWindow:'',maxTokens:'',image:false}))};
    let providerRevision='provider-r1',providerInvalidate,providerCalls=0,providerReject,providerResolve,providerReads=0,providerSent;
    const providerUi=Vue.createApp({setup:()=>()=>Vue.h(ModelPages.Providers,{adapter:{describe:async()=>{providerReads++;return{providers:[validProvider],catalog:[],revision:providerRevision,writable:true};},save:async(d,r)=>{providerCalls++;providerSent={d,r};return new Promise((resolve,reject)=>{providerResolve=resolve;providerReject=reject;});},subscribe:fn=>{providerInvalidate=fn;return()=>{};}}})});
    providerUi.config.errorHandler=e=>errors.push(String(e));providerUi.mount(root);await settle();root.querySelector('button[aria-label="编辑 '+provider.name+'"]').click();await settle();
    const providerName=root.querySelector('input[aria-label="显示名称"]');providerName.value='保留供应商草稿';providerName.dispatchEvent(new Event('input',{bubbles:true}));providerRevision='provider-r2';root.querySelector('button[aria-label="刷新供应商目录"]').click();await settle();check('手动刷新保留供应商编辑草稿',root.querySelector('input[aria-label="显示名称"]').value==='保留供应商草稿');
    const providerSave=[...root.querySelectorAll('button')].find(b=>b.textContent==='保存');providerSave.click();providerSave.click();await settle();
    check('供应商保存绑定原提案修订并阻止重复',providerCalls===1&&providerSent.r==='provider-r1');
    check('供应商变更期间锁定表单与其他动作',root.querySelector('fieldset').disabled&&root.querySelector('button[aria-label="刷新供应商目录"]').disabled&&root.querySelector('button[aria-label="禁用 '+provider.name+'"]').disabled&&root.querySelector('button[aria-label="拉取 '+provider.name+' 模型目录"]').disabled);
    providerReject(Error('fixture-provider-rejected'));await settle();check('供应商失败保留草稿并解除锁定',root.querySelector('input[aria-label="显示名称"]').value==='保留供应商草稿'&&!root.querySelector('fieldset').disabled&&root.textContent.includes('fixture-provider-rejected'));
    await capture('provider-save-failure');[...root.querySelectorAll('button')].find(b=>b.textContent==='保存').click();await settle();const readsBeforeProviderClose=providerReads;providerUi.unmount();providerResolve();await settle();check('供应商关闭后迟到保存不刷新',providerReads===readsBeforeProviderClose);
    // 每种供应商动作单独验证，避免一种操作的锁掩盖另一种操作的缺口。
    for(const action of ['remove','save','reorder','pullModels']){
      let calls=0,reads=0,rev='action-r1',invalidateAction,resolveAction,rejectAction,sentArgs;
      const actionAdapter={describe:async()=>{reads++;return{providers:[multiProvider,{...provider,id:'second-provider',name:'第二供应商'}],catalog:[],revision:rev,writable:true};},subscribe:fn=>{invalidateAction=fn;return()=>{};}};
      actionAdapter[action]=async(...args)=>{calls++;sentArgs=args;return new Promise((resolve,reject)=>{resolveAction=resolve;rejectAction=reject;});};
      const actionUi=Vue.createApp({setup:()=>()=>Vue.h(ModelPages.Providers,{adapter:actionAdapter})});actionUi.config.errorHandler=e=>errors.push(String(e));actionUi.mount(root);await settle();
      let trigger;
      if(action==='remove'){root.querySelector('button[aria-label="删除 '+provider.name+'"]').click();await settle();rev='action-r2';invalidateAction();await settle();trigger=[...root.querySelectorAll('button')].find(b=>b.textContent==='确认删除');}
      else trigger=root.querySelector('button[aria-label="'+(action==='save'?'禁用 '+provider.name:action==='reorder'?'下移 '+provider.name:'拉取 '+provider.name+' 模型目录')+'"]');
      trigger.click();trigger.click();await settle();check('供应商 '+action+' 阻止重复调用',calls===1);check('供应商 '+action+' 绑定请求修订',sentArgs[1]==='action-r1');
      if(action==='save')check('供应商启停保留模型且仅切换启用',sentArgs[0].enabled===false&&sentArgs[0].models.length===2&&sentArgs[0].models[0].id==='first');
      if(action==='reorder')check('供应商排序提交完整顺序',sentArgs[0].join(',')==='second-provider,fixture');
      rejectAction(Error('fixture-'+action+'-rejected'));await settle();check('供应商 '+action+' 失败显示原因并可重试',root.textContent.includes('fixture-'+action+'-rejected')&&!trigger.disabled);
      if(action==='remove')check('供应商删除失败保留确认提案',!!root.querySelector('[role="alertdialog"]'));
      trigger.click();await settle();check('供应商 '+action+' 可重新提交',calls===2);const beforeClose=reads;actionUi.unmount();resolveAction();await settle();check('供应商 '+action+' 迟到回执不刷新',reads===beforeClose);
    }
    // 写入成功与后续读取失败分别记录，禁止把读取重试变成重复写入。
    for(const kind of ['provider','custom'])for(const action of ['save','remove']){
      let failRead=false,writes=0;
      const row=kind==='provider'?validProvider:multi;
      const adapter={describe:async()=>{if(failRead)throw Error('fixture-after-write-read-failed');return{providers:[validProvider],customs:[multi],catalog:[],revision:'after-write-r1',writable:true};},save:async()=>{writes++;failRead=true;},upsert:async()=>{writes++;failRead=true;},remove:async()=>{writes++;failRead=true;}};
      const ui=Vue.createApp({setup:()=>()=>Vue.h(kind==='provider'?ModelPages.Providers:ModelPages.Customs,{adapter})});ui.config.errorHandler=e=>errors.push(String(e));ui.mount(root);await settle();root.querySelector('button[aria-label="'+(action==='save'?'编辑 ':'删除 ')+row.name+'"]').click();await settle();[...root.querySelectorAll('button')].find(b=>b.textContent===(action==='save'?'保存':'确认删除')).click();await settle();
      check(kind+' '+action+' 读取失败禁止旧目录修改',root.querySelector('button[aria-label="删除 '+row.name+'"]').disabled&&root.textContent.includes('修改操作已暂停'));check(kind+' '+action+' 写入成功后读取失败显示明确状态',writes===1&&root.textContent.includes('目录刷新失败')&&root.textContent.includes('fixture-after-write-read-failed'));
      failRead=false;root.querySelector('button[aria-label="刷新'+(kind==='provider'?'供应商':'自定义模型')+'目录"]').click();await settle();check(kind+' '+action+' 刷新成功恢复目录操作',!root.querySelector('button[aria-label="删除 '+row.name+'"]').disabled&&!root.textContent.includes('修改操作已暂停'));check(kind+' '+action+' 读取重试不重复写入',writes===1&&!root.textContent.includes('fixture-after-write-read-failed')&&!root.textContent.includes('目录刷新失败'));ui.unmount();
    }
    window.SaCodeDialog=Vue.defineComponent({setup:(_,ctx)=>()=>Vue.h('div',{role:'dialog'},ctx.slots.default?.())});
    // 供应商槽位走新适配器契约（describe/save/remove/reorder/pullModels）：
    // fakeApi 把这几个动词桩掉，宿主投影形状与真实 describe 一致。
    for(const writable of [false,true]){
      const providerView={providers:[provider],revision:1,writable,defaultProviderId:provider.id,defaultModel:(provider.models[0]||{}).id||null};
      const bump=(rev)=>({...providerView,revision:(rev||1)+1});
      const fakeApi={
        modelsDescribe:async()=>providerView,
        modelsCatalog:async()=>[],
        modelsSave:async()=>bump(providerView.revision),
        modelsRemove:async()=>({...bump(providerView.revision),providers:[]}),
        modelsSort:async()=>bump(providerView.revision),
        modelsSetEnabled:async()=>bump(providerView.revision),
        modelPull:async()=>({...bump(providerView.revision),providers:[{...provider,models:[{id:'pulled-model',name:'拉取候选',contextWindow:'',maxTokens:'',image:false}]}]}),
        customsDescribe:async()=>({models:[custom],revision:'r1',writable}),
        usageStatus:async()=>({used:0,budget:0,over:false,verdict:''}),
      };
      const assembly=ModelPages.createModelCenterAssembly();
      const owner={adapters:ModelPages.createModelCenterAdapters(fakeApi)};
      const ui=Vue.createApp({setup:()=>()=>Vue.h(assembly.Outlet,{owner})});ui.config.errorHandler=e=>errors.push(String(e));ui.mount(root);await settle();
      // 默认活动标签是「模型」，要先点「供应商」切过去再断言供应商 DOM。
      const tabBtn=root.querySelector('button[data-model-center-tab="provider-settings"]');
      if(tabBtn){tabBtn.click();await settle();}
      check('供应商槽位读取适配器 '+writable,root.textContent.includes(provider.name)&&!root.textContent.includes('is not a function'));
      const edit=root.querySelector('button[aria-label="编辑 '+provider.name+'"]');
      const add=root.querySelector('button[aria-label="添加供应商"]');
      const remove=root.querySelector('button[aria-label="删除 '+provider.name+'"]');
      check('供应商槽位只读护栏 '+writable,!!edit&&!!add&&!!remove&&add.disabled===!writable&&remove.disabled===!writable&&edit.disabled===!writable);
      if(writable&&edit){edit.click();await settle();check('供应商编辑打开字段',!!root.querySelector('input[aria-label="显示名称"]'));}
      const cancel=[...root.querySelectorAll('button')].find(b=>b.textContent==='取消');if(cancel){cancel.click();await settle();}
      if(writable&&add){add.click();await settle();check('供应商新增表单打开',!!root.querySelector('input[aria-label="Provider ID"]')&&!!root.querySelector('input[aria-label="API 密钥"]'));}
      if(writable){const pull=root.querySelector('button[aria-label="拉取 '+provider.name+' 模型目录"]');if(pull){pull.click();await settle();}check('供应商槽位可拉取候选',root.textContent.includes('拉取候选')||root.textContent.includes('拉取中'));}
      ui.unmount();assembly.dispose();await settle();
    }
    check('无 Vue 渲染异常',errors.length===0);return {checks,errors};
  })()`);console.log(JSON.stringify(checks));app.exit(checks.checks.some(c=>!c.ok)?1:0);
}).catch(e=>{console.error(e);app.exit(1);});
