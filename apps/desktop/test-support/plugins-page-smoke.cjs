// 原生 Chromium 插件页交互。清单 fixture 不代表仓颉 inventory 已实现。
module.exports = async function({win,check,waitFor,outDir}) {
  const js = code => win.webContents.executeJavaScript(`(async()=>{${code}})()`,true);
  await js(`document.querySelector('#open-settings').click();document.querySelector('#settings-tab-plugins').click()`);
  await js(`const e=[...document.querySelectorAll('#settings-page-plugins [role=tab]')].find(e=>e.textContent==='插件列表');if(e)e.click()`);
  await waitFor("!!document.querySelector('#settings-page-plugins .plugins-inventory')");
  await check('插件页真实入口与数据边界',"({title:document.querySelector('#settings-page-plugins .plugins-heading').textContent==='内置插件',unconnected:document.querySelector('#settings-page-plugins').textContent.includes('插件清单接口尚未接入'),tools:document.querySelectorAll('#settings-page-plugins .settings-tool').length>0,configurationView:!![...document.querySelectorAll('#settings-page-plugins [role=tab]')].find(e=>e.textContent==='插件配置')})");
  require('node:fs').writeFileSync(require('node:path').join(outDir,'plugins-product.png'),(await win.webContents.capturePage()).toPNG());
  await js(`document.querySelector('.settings-close').click();
    const root=document.createElement('div');root.id='plugins-fixture';root.className='settings-dialog';Object.assign(root.style,{position:'fixed',top:'80px',left:'300px',width:'720px',maxHeight:'calc(100vh - 160px)',height:'auto',padding:'24px',overflow:'auto',display:'block',zIndex:'20',background:'var(--panel-surface)',borderRadius:'16px'});document.body.append(root);
    const entry=(moduleName,title,enabled,phase)=>({moduleName,title,entryId:'include:'+moduleName,description:'插件说明 '+title,enabled,phase});
    const reader=entry('sacode-read','读取能力',false,null),failed=entry('sacode-fail','故障能力',true,'failed'),conditional={...entry('sacode-cond','条件能力',false,'pending'),condition:'平台条件'},metadata={...entry('sacode-meta','元信息能力',true,'active'),metadataError:'缺少标题元信息'};
    window.pluginFixture={root,entries:[reader,conditional,metadata,failed],presets:[{id:'reader',name:'读取预设',isDefault:true,rows:[{...reader,enabled:true,phase:'active'}]},{id:'writer',name:'写入预设',rows:[entry('sacode-write','写入能力',true,null)]}],loads:0,configMounts:0,retries:0};
    const adapter={async list(){pluginFixture.loads++;if(pluginFixture.fail)throw Error('fixture');return {entries:pluginFixture.entries,presets:pluginFixture.presets};},subscribe(callback){pluginFixture.invalidate=callback;return()=>{pluginFixture.off=true;};}};
    const Config=Vue.defineComponent({setup(){pluginFixture.configMounts++;const draft=Vue.ref('');return()=>Vue.h('input',{'aria-label':'插件配置草稿',value:draft.value,onInput:e=>draft.value=e.target.value});}});
    pluginFixture.sync=Vue.reactive({clientSync:'idle',adapter,retryClient:()=>{pluginFixture.retries++;pluginFixture.sync.clientSync='idle';}});
    pluginFixture.tabs=Vue.shallowRef([{id:'config',label:'插件配置',order:10,component:Config},{id:'inventory',label:'插件列表',order:20,component:SaCodePlugins.Inventory,props:pluginFixture.sync}]);
    pluginFixture.app=Vue.createApp({setup(){return()=>Vue.h(SaCodePlugins.Page,{tabs:pluginFixture.tabs.value});}});pluginFixture.app.mount(root);
    pluginFixture.tab=async text=>{[...root.querySelectorAll('[role=tab]')].find(e=>e.textContent===text).click();await Vue.nextTick();};
  `);
  await check('插件贡献视图首次访问才挂载',"({configurationFirst:!!document.querySelector('#plugins-fixture input[aria-label=\"插件配置草稿\"]'),notLoaded:pluginFixture.loads===0,noInventory:!document.querySelector('#plugins-fixture .plugins-inventory')})");
  await js(`const e=document.querySelector('#plugins-fixture input[aria-label="插件配置草稿"]');e.value='保留设置草稿';e.dispatchEvent(new Event('input',{bubbles:true}));await pluginFixture.tab('插件列表')`);
  await waitFor("document.querySelectorAll('#plugins-fixture [data-plugin-module]').length===5");
  await check('插件清单分组与故障优先',"({defaultPreset:document.querySelector('#plugins-fixture select').value==='reader',failedFirst:document.querySelectorAll('#plugins-fixture .plugins-group')[1].querySelector('[data-plugin-module]').dataset.pluginModule==='sacode-fail',noMutation:pluginFixture.entries[0].moduleName==='sacode-read',hostLoaded:pluginFixture.loads===1})");
  await js(`await pluginFixture.tab('插件配置')`);
  await check('插件视图切换保留草稿和清单',"({draft:document.querySelector('#plugins-fixture input[aria-label=\"插件配置草稿\"]').value==='保留设置草稿',notRemounted:pluginFixture.configMounts===1,inventoryPreserved:!!document.querySelector('#plugins-fixture .plugins-panel[hidden] .plugins-inventory'),notReloaded:pluginFixture.loads===1})");
  await js(`const e=document.querySelector('#plugins-fixture [role=tab][aria-selected=true]');e.focus();e.dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true}));await Vue.nextTick()`);
  await check('插件页签键盘选择同步焦点',"({inventory:document.querySelector('#plugins-fixture [role=tab][aria-selected=true]').textContent==='插件列表',focused:document.activeElement===document.querySelector('#plugins-fixture [role=tab][aria-selected=true]')})");
  await js(`const e=document.querySelector('#plugins-fixture [data-plugin-module="sacode-read"][data-failed=false]');const globals=document.querySelectorAll('#plugins-fixture .plugins-group')[1];globals.querySelector('[data-plugin-module="sacode-read"] button').click()`);
  await check('全局插件详情保留运行与配置状态',"({presetProvided:document.querySelector('#plugins-fixture .plugins-cardDetails').textContent.includes('预设中启用'),technicalIdentity:document.querySelector('#plugins-fixture .plugins-cardDetails').textContent.includes('sacode-read'),jump:!!document.querySelector('#plugins-fixture [aria-label=\"去预设分组查看 读取预设\"]')})");
  await js(`const e=document.querySelector('#plugins-fixture input[aria-label="搜索插件"]');e.value='写入';e.dispatchEvent(new Event('input',{bubbles:true}))`);
  await check('插件搜索发现其他预设匹配',"({otherPreset:document.querySelector('#plugins-fixture .plugins-otherMatches').textContent.includes('写入预设'),notFalseEmpty:!document.querySelector('#plugins-fixture').textContent.includes('没有匹配的插件')})");
  await js(`document.querySelector('#plugins-fixture .plugins-otherMatches button').click()`);
  await check('其他预设跳转显示匹配插件',"({selected:document.querySelector('#plugins-fixture select').value==='writer',writer:!!document.querySelector('#plugins-fixture [data-plugin-module=\"sacode-write\"]')})");
  await js(`const e=document.querySelector('#plugins-fixture input[aria-label="搜索插件"]');e.value='不存在的插件';e.dispatchEvent(new Event('input',{bubbles:true}))`);
  await check('插件搜索无结果独立展示',"({empty:document.querySelector('#plugins-fixture').textContent.includes('没有匹配的插件'),noCards:!document.querySelector('#plugins-fixture [data-plugin-module]')})");
  await js(`const e=document.querySelector('#plugins-fixture input[aria-label="搜索插件"]');e.value='';e.dispatchEvent(new Event('input',{bubbles:true}));pluginFixture.sync.clientSync='failed'`);
  await check('页面插件同步失败不改 Host 清单',"({notice:document.querySelector('#plugins-fixture').textContent.includes('服务端的启用状态保持不变'),hostRows:document.querySelectorAll('#plugins-fixture [data-plugin-module]').length===5})");
  await js(`[...document.querySelectorAll('#plugins-fixture button')].find(e=>e.textContent==='重试本页面同步').click()`);
  await check('客户端重试不重载 Host 清单',"({retry:pluginFixture.retries===1,hostLoads:pluginFixture.loads===1,noFailure:!document.querySelector('#plugins-fixture').textContent.includes('未能完成同步')})");
  await js(`pluginFixture.fail=true;pluginFixture.invalidate()`);
  await waitFor("document.querySelector('#plugins-fixture').textContent.includes('暂时无法读取插件')");
  await js(`pluginFixture.fail=false;[...document.querySelectorAll('#plugins-fixture button')].find(e=>e.textContent==='重试').click()`);
  await waitFor("document.querySelectorAll('#plugins-fixture [data-plugin-module]').length===5");
  await check('插件 Host 清单失败可独立重试',"({recovered:pluginFixture.loads===3,searchPreserved:document.querySelector('#plugins-fixture input[aria-label=\"搜索插件\"]').value==='',selectionPreserved:document.querySelector('#plugins-fixture select').value==='writer'})");
  await js(`await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
  await check('插件卡片宽容器为两列', "({twoColumns:getComputedStyle(document.querySelector('#plugins-fixture .plugins-cards')).gridTemplateColumns.split(' ').length===2})");
  await js(`pluginFixture.root.style.width='500px';await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
  await check('插件卡片按容器宽度折为单列', "({oneColumn:getComputedStyle(document.querySelector('#plugins-fixture .plugins-cards')).gridTemplateColumns.split(' ').length===1})");
  await js(`pluginFixture.root.style.width='720px'`);
  await js(`await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
  require('node:fs').writeFileSync(require('node:path').join(outDir,'plugins-inventory-fixture.png'),(await win.webContents.capturePage()).toPNG());
  await js(`pluginFixture.entries=[
    {moduleName:'@deepseek-ai/dsh-persona',entryId:'persona',description:'Composition-authored deployment persona',enabled:true,phase:'active'},
    {moduleName:'@deepseek-ai/dsh-tool-fs',entryId:'tool-fs',description:'Model-facing filesystem tools',enabled:false,phase:null},
    {moduleName:'@community/tool-fs',entryId:'custom-fs',description:'Custom filesystem integration',enabled:true,phase:'failed'}
  ];pluginFixture.presets=[];pluginFixture.invalidate()`);
  await waitFor("document.querySelectorAll('#plugins-fixture [data-plugin-module]').length===3");
  await check('内置插件中文说明保留原始身份与真实状态',"({persona:document.querySelector('[data-plugin-module=\"@deepseek-ai/dsh-persona\"]').textContent.includes('身份、角色和工作风格'),files:document.querySelector('[data-plugin-module=\"@deepseek-ai/dsh-tool-fs\"]').textContent.includes('文件读取、写入和编辑'),disabled:document.querySelector('[data-plugin-module=\"@deepseek-ai/dsh-tool-fs\"]').textContent.includes('已停用'),sourceUnchanged:pluginFixture.entries[0].description==='Composition-authored deployment persona',thirdParty:document.querySelector('[data-plugin-module=\"@community/tool-fs\"]').textContent.includes('Custom filesystem integration')})");
  await js(`const e=document.querySelector('#plugins-fixture input[aria-label="搜索插件"]');e.value='文件读取';e.dispatchEvent(new Event('input',{bubbles:true}))`);
  await check('内置插件可按中文用途搜索',"({oneMatch:document.querySelectorAll('#plugins-fixture [data-plugin-module]').length===1,correctIdentity:document.querySelector('#plugins-fixture [data-plugin-module]').dataset.pluginModule==='@deepseek-ai/dsh-tool-fs'})");
  await js(`const e=document.querySelector('#plugins-fixture input[aria-label="搜索插件"]');e.value='persona';e.dispatchEvent(new Event('input',{bubbles:true}))`);
  await check('中文插件说明仍支持原始 ID 搜索',"({oneMatch:document.querySelectorAll('#plugins-fixture [data-plugin-module]').length===1,correctIdentity:document.querySelector('#plugins-fixture [data-plugin-module]').dataset.pluginModule==='@deepseek-ai/dsh-persona'})");
  require('node:fs').writeFileSync(require('node:path').join(outDir,'plugins-chinese-fixture.png'),(await win.webContents.capturePage()).toPNG());
  await js(`pluginFixture.app.unmount()`);
  await check('插件视图卸载释放订阅',"({released:pluginFixture.off===true})");
  await js(`pluginFixture.root.remove();delete window.pluginFixture`);
};
