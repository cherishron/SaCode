// 在真实 Vue runtime + Chromium 内验提供者换绑；清单数据是竞态夹具，不是产品档案。
const {app,BrowserWindow}=require('electron');
app.whenReady().then(async()=>{
  const win=new BrowserWindow({show:false,webPreferences:{nodeIntegration:false,contextIsolation:true}});
  await win.loadFile(process.argv[2]);
  const checks=await win.webContents.executeJavaScript(`(async()=>{
    const checks=[];const check=(name,ok)=>{checks.push({name,ok});};
    const settle=async()=>{await Promise.resolve();await Vue.nextTick();await Promise.resolve();await Vue.nextTick();};
    const root=document.querySelector('#fixture'), props=Vue.shallowReactive({adapter:undefined});
    const ui=Vue.createApp({setup:()=>()=>Vue.h(SaCodePlugins.Inventory,props)});ui.mount(root);await settle();
    const snapshot=name=>({entries:[{moduleName:name,entryId:name,enabled:true,phase:'active'}],presets:[]});
    const visible=name=>!!root.querySelector('[data-plugin-module="'+name+'"]');
    check('缺提供者保持未接入',root.textContent.includes('插件清单接口尚未接入'));
    let resolveA,resolveB,callbackA,callbackB,offA=0,offB=0,callsB=0;
    const a={list:()=>new Promise(r=>resolveA=r),subscribe:f=>{callbackA=f;return()=>offA++;}};
    const b={list:()=>{callsB++;return callsB===1?new Promise(r=>resolveB=r):Promise.resolve(snapshot('new-provider'));},subscribe:f=>{callbackB=f;return()=>offB++;}};
    props.adapter=a;await settle();check('晚绑定发起真实读取',typeof resolveA==='function');
    props.adapter=b;await settle();check('替换释放旧提供者订阅',offA===1&&typeof resolveB==='function');
    if(resolveB)resolveB(snapshot('new-provider'));await settle();
    if(resolveA)resolveA(snapshot('old-provider'));await settle();
    check('迟到旧响应不得覆盖新清单',visible('new-provider')&&!visible('old-provider'));
    const before=callsB;if(callbackA)callbackA();await settle();check('旧订阅回调不得驱动新提供者',callsB===before);
    props.adapter=undefined;await settle();check('卸载清空旧事实并恢复未接入',offB===1&&!visible('new-provider')&&root.textContent.includes('插件清单接口尚未接入'));
    props.adapter=b;await settle();check('重装重新读取当前事实',visible('new-provider')&&callsB===before+1);
    ui.unmount();if(callbackB)callbackB();await settle();check('组件卸载释放订阅且停止读取',offB===2&&callsB===before+1);
    const pending=[];let invalidate;
    props.adapter={list:()=>new Promise(r=>pending.push(r)),subscribe:f=>{invalidate=f;return()=>{};}};
    const second=Vue.createApp({setup:()=>()=>Vue.h(SaCodePlugins.Inventory,props)});second.mount(root);await settle();
    if(invalidate)invalidate();await settle();
    if(pending[1])pending[1](snapshot('latest-refresh'));await settle();
    if(pending[0])pending[0](snapshot('stale-refresh'));await settle();
    check('同提供者刷新只接受最新响应',visible('latest-refresh')&&!visible('stale-refresh'));
    props.adapter={list:()=>{throw Error('不应读取');},subscribe:()=>{throw Error('订阅失败');}};await settle();
    check('订阅失败明确报错并清除旧事实',root.textContent.includes('暂时无法读取插件')&&!visible('latest-refresh'));
    props.adapter=b;await settle();check('失败提供者替换后可恢复',visible('new-provider'));
    second.unmount();return checks;
  })()`);
  console.log(JSON.stringify(checks));win.destroy();app.exit(checks.every(c=>c.ok)?0:1);
}).catch(e=>{console.error(e.message);app.exit(2)});
