const {app,BrowserWindow}=require('electron');
app.whenReady().then(async()=>{
  const win=new BrowserWindow({show:false,webPreferences:{nodeIntegration:false,contextIsolation:true}});await win.loadFile(process.argv[2]);
  const checks=await win.webContents.executeJavaScript(`(async()=>{
    const checks=[],root=document.querySelector('#fixture'),errors=[];const check=(name,ok)=>checks.push({name,ok});
    const settle=async()=>{await Promise.resolve();await Vue.nextTick();await Promise.resolve();await Vue.nextTick();};
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
      const cancel=[...root.querySelectorAll('button')].find(b=>b.textContent==='取消');if(cancel){cancel.click();await settle();}
      const add=[...root.querySelectorAll('button')].find(b=>b.textContent.includes('+ 添加'));
      check(title+'添加入口只读护栏 '+writable,!!add&&add.disabled===!writable);
      if(writable&&add){add.click();await settle();check(title+'新增表单打开',!!root.querySelector('input[aria-label="'+(title==='供应商'?'Provider ID':'ID')+'"]'));}
      ui.unmount();await settle();
    }
    window.SaCodeDialog=Vue.defineComponent({setup:(_,ctx)=>()=>Vue.h('div',{role:'dialog'},ctx.slots.default?.()));
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
