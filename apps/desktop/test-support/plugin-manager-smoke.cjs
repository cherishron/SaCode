// 官方插件安装管理的状态视图测试；安装服务为内存适配器，不代表仓颉安装能力完成。
module.exports=async function({win,check,waitFor,outDir}){
  const js=code=>win.webContents.executeJavaScript(`(async()=>{${code}})()`,true);
  await js(`document.querySelector('.nav-panel').click()`);
  await waitFor("!!document.querySelector('[data-plugin-manager]')");
  await check('独立插件管理产品入口',"({center:!!document.querySelector('.conversation-center [data-plugin-manager]'),unconnected:document.querySelector('[data-plugin-manager]').textContent.includes('尚未接入'),noFakePackages:!document.querySelector('[data-package-name]'),disabled:[...document.querySelectorAll('[data-plugin-manager] button')].find(b=>b.textContent==='添加插件').disabled})");
  require('node:fs').writeFileSync(require('node:path').join(outDir,'plugin-manager-product.png'),(await win.webContents.capturePage()).toPNG());
  await js(`document.querySelector('.nav-panel').click();const root=document.createElement('div');root.id='manager-fixture';Object.assign(root.style,{position:'fixed',inset:'80px 120px',zIndex:30,background:'var(--panel-surface)'});document.body.append(root);
    const install=()=>({open:false,spec:'',phase:'idle',registry:'',registries:[{name:'默认安装源',url:''},{name:'npm 官方源',url:'https://registry.npmjs.org/'}],runs:[]});
    window.managerFixture={root,commands:[],snapshot:{available:true,busy:[],packages:[{name:'@sample/plugin',title:'示例插件',description:'插件说明',version:'1.2.0',installed:true,enabled:false,optional:false,rows:Array.from({length:10},(_,n)=>({id:'row'+n,entryId:n===0?undefined:'entry'+n,name:'组件'+n,enabled:true,phase:n===1?'failed':'active',readOnlyReason:n===0?'只读组件':undefined}))}],install:install()}};
    const f=managerFixture,clone=v=>JSON.parse(JSON.stringify(v));
    const adapter={async read(){if(f.readFail)throw Error('read');return clone(f.snapshot);},subscribe(callback){f.invalidate=callback;return()=>f.off=true;},async dispatch(c){f.commands.push(clone(c));const i=f.snapshot.install;
      if(c.kind==='open-install')i.open=true;if(c.kind==='close-install')i.open=false;if(c.kind==='edit-spec')i.spec=c.text;if(c.kind==='choose-registry')i.registry=c.url;
      if(c.kind==='run-install'){i.phase='running';i.subject={name:'示例插件',version:'1.2.0'};i.runs=[{jobId:'job1',command:'安装示例插件',cwd:'测试工作目录',output:Array.from({length:30},(_,n)=>'输出 '+n).join('\\n')}];}
      if(c.kind==='enable-package')f.snapshot.packages.find(p=>p.name===c.name).enabled=c.enabled;
      if(c.kind==='enable-row')f.snapshot.packages[0].rows.find(r=>r.entryId===c.entryId).enabled=c.enabled;
      if(c.kind==='uninstall')f.snapshot.confirm=c.name;if(c.kind==='cancel-confirm')delete f.snapshot.confirm;if(c.kind==='confirm-uninstall'){f.snapshot.packages=[];delete f.snapshot.confirm;}
      if(c.kind==='cancel-install')i.phase='cancelling';if(c.kind==='reconcile-install')i.phase='done';if(c.kind==='edit-install')i.phase='idle';if(c.kind==='approve-builds'){i.failure=undefined;i.phase='running';}
      if(c.kind==='change-registry'){i.phase='idle';i.failure=undefined;}if(c.kind==='use-github-mirror'){i.phase='idle';i.failure=undefined;i.spec='';i.registry='https://registry.npmmirror.com/';}
    }};
    f.mounted=[];f.disposed=[];f.contributions=Vue.ref([]);
    const Form=Vue.defineComponent({props:['subject'],setup(props){const draft=Vue.ref('');const key=JSON.stringify(props.subject);Vue.onMounted(()=>f.mounted.push(key));Vue.onBeforeUnmount(()=>f.disposed.push(key));return()=>Vue.h('input',{'aria-label':'贡献配置草稿',value:draft.value,onInput:e=>draft.value=e.target.value,'data-subject':key});}});
    const Label=Vue.defineComponent({props:['text'],setup(props){return()=>Vue.h('span',{'data-contribution-label':''},props.text);}});
    f.contributions.value=[{id:'bundle-config',order:0,slot:'configuration',subject:{kind:'bundle',name:'@sample/plugin'},component:Vue.markRaw(Form)},
      {id:'row-config',order:0,slot:'configuration',subject:{kind:'row',name:'@sample/plugin',rowId:'row1'},component:Vue.markRaw(Form)},
      {id:'other-package-config',order:0,slot:'configuration',subject:{kind:'row',name:'@another/plugin',rowId:'row1'},component:Vue.markRaw(Form)},
      {id:'badge-b',order:20,slot:'badge',subject:{kind:'row',name:'@sample/plugin',rowId:'row1'},component:Vue.markRaw(Label),props:{text:'后徽标'}},
      {id:'badge-a',order:10,slot:'badge',subject:{kind:'row',name:'@sample/plugin',rowId:'row1'},component:Vue.markRaw(Label),props:{text:'前徽标'}},
      {id:'row-section',order:0,slot:'section',subject:{kind:'row',name:'@sample/plugin',rowId:'row1'},component:Vue.markRaw(Label),props:{text:'组件贡献说明'}},
      {id:'item-config',order:0,slot:'configuration',subject:{kind:'item',id:'shell'},component:Vue.markRaw(Form)}];
    f.app=Vue.createApp({setup:()=>()=>Vue.h(SaCodePluginManager.Page,{adapter,contributions:f.contributions.value})});f.app.mount(root);f.button=text=>[...document.querySelectorAll('#manager-fixture button,dialog.plugin-manager-install button')].find(b=>b.textContent===text);
  `);
  await waitFor("!!document.querySelector('#manager-fixture [data-package-name]')");
  await js(`document.querySelector('#manager-fixture input[aria-label="启用 示例插件"]').click()`);
  await waitFor("managerFixture.snapshot.packages[0].enabled");
  await js(`managerFixture.button('示例插件').click()`);
  await check('插件详情保留组件运行状态和只读限制',"({details:document.querySelector('#manager-fixture').textContent.includes('共 10 个'),failed:document.querySelector('#manager-fixture').textContent.includes('1 异常'),locked:document.querySelector('#manager-fixture input[aria-label=\"启用组件 组件0\"]').disabled,filter:!!document.querySelector('#manager-fixture input[aria-label=\"筛选组件\"]')})");
  await js(`const input=document.querySelector('#manager-fixture input[aria-label="筛选组件"]');input.value='组件1';input.dispatchEvent(new Event('input',{bubbles:true}));await Vue.nextTick();document.querySelector('#manager-fixture input[aria-label="启用组件 组件1"]').click()`);
  await waitFor("managerFixture.snapshot.packages[0].rows[1].enabled===false");
  await check('组件筛选与精确入口启停',"({oneRow:document.querySelectorAll('#manager-fixture .plugin-manager-row').length===1,entry:managerFixture.commands.some(c=>c.kind==='enable-row'&&c.entryId==='entry1'&&c.enabled===false)})");
  await check('插件包配置贡献只挂载所属表单',"({oneForm:document.querySelectorAll('#manager-fixture input[aria-label=\"贡献配置草稿\"]').length===1,bundle:JSON.parse(document.querySelector('#manager-fixture input[aria-label=\"贡献配置草稿\"]').dataset.subject).kind==='bundle',configuredRow:!!managerFixture.button('配置 组件1')})");
  await js(`const input=document.querySelector('#manager-fixture input[aria-label="贡献配置草稿"]');input.value='包草稿';input.dispatchEvent(new Event('input',{bubbles:true}));managerFixture.button('配置 组件1').click()`);
  await waitFor("!!document.querySelector('#manager-fixture [data-plugin-row-detail]')");
  await check('组件配置按包名与组件标识隔离并排序',"({oneForm:document.querySelectorAll('#manager-fixture input[aria-label=\"贡献配置草稿\"]').length===1,row:JSON.parse(document.querySelector('#manager-fixture input[aria-label=\"贡献配置草稿\"]').dataset.subject).rowId==='row1',draftIsolated:document.querySelector('#manager-fixture input[aria-label=\"贡献配置草稿\"]').value==='',badges:[...document.querySelectorAll('#manager-fixture [data-contribution-label]')].map(e=>e.textContent).join('|')==='前徽标|后徽标|组件贡献说明',bundleDisposed:managerFixture.disposed.some(k=>JSON.parse(k).kind==='bundle')})");
  await js(`const input=document.querySelector('#manager-fixture input[aria-label="贡献配置草稿"]');input.value='组件草稿';input.dispatchEvent(new Event('input',{bubbles:true}));managerFixture.button('返回 示例插件').click()`);
  await waitFor("!document.querySelector('#manager-fixture [data-plugin-row-detail]')");
  await check('返回插件包释放组件草稿并重新挂载包配置',"({emptyDraft:document.querySelector('#manager-fixture input[aria-label=\"贡献配置草稿\"]').value==='',rowDisposed:managerFixture.disposed.some(k=>JSON.parse(k).kind==='row'),filterPreserved:document.querySelector('#manager-fixture input[aria-label=\"筛选组件\"]').value==='组件1'})");
  await js(`managerFixture.button('配置 组件1').click();await Vue.nextTick();managerFixture.contributions.value=managerFixture.contributions.value.filter(c=>c.id!=='row-config')`);
  await check('卸载配置贡献撤销已打开表单',"({removed:!document.querySelector('#manager-fixture input[aria-label=\"贡献配置草稿\"]'),otherPackageNotLeaked:document.querySelector('#manager-fixture [data-plugin-row-detail]').textContent.includes('组件1')})");
  await js(`managerFixture.button('返回 示例插件').click();await Vue.nextTick();document.querySelector('#manager-fixture input[aria-label="启用 示例插件"]').click()`);
  await waitFor("managerFixture.snapshot.packages[0].enabled===false");
  await check('停用插件包隐藏组件启停但保留配置',"({noRowSwitch:!document.querySelector('#manager-fixture input[aria-label=\"启用组件 组件1\"]'),packageConfig:!!document.querySelector('#manager-fixture input[aria-label=\"贡献配置草稿\"]'),parentOff:!document.querySelector('#manager-fixture input[aria-label=\"启用 示例插件\"]').checked})");
  await js(`managerFixture.button('返回插件列表').click();await Vue.nextTick();managerFixture.button('终端').click()`);
  await check('官方插件配置使用对应贡献表单',"({item:document.querySelector('#manager-fixture [data-plugin-item-detail]').dataset.pluginItemDetail==='shell',exact:JSON.parse(document.querySelector('#manager-fixture input[aria-label=\"贡献配置草稿\"]').dataset.subject).id==='shell',oneForm:document.querySelectorAll('#manager-fixture input[aria-label=\"贡献配置草稿\"]').length===1})");
  await js(`managerFixture.button('返回插件列表').click();await Vue.nextTick();managerFixture.button('添加插件').click()`);
  await waitFor("!!document.querySelector('dialog.plugin-manager-install[open]')");
  await check('插件安装空输入阻止提交',"({blocked:managerFixture.button('安装').disabled,accountRemoved:!document.querySelector('dialog.plugin-manager-install').textContent.includes('DeepSeek')})");
  await js(`let input=document.querySelector('input[aria-label="包名或地址"]');input.value='@sample/new-plugin';input.dispatchEvent(new Event('input',{bubbles:true}))`);
  await waitFor("managerFixture.snapshot.install.spec==='@sample/new-plugin'");
  await js(`const input=document.querySelector('input[aria-label="包名或地址"]');input.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));`);
  await check('插件输入法确认不触发安装',"({noInstall:!managerFixture.commands.some(c=>c.kind==='run-install')})");
  await js(`document.querySelector('input[aria-label="包名或地址"]').dispatchEvent(new Event('blur'));managerFixture.button('安装源').click();await Vue.nextTick();const input=document.querySelector('input[aria-label="自定义安装源"]');input.value='bad-source';input.dispatchEvent(new Event('input',{bubbles:true}))`);
  await check('安装源非法地址阻止提交',"({invalid:document.querySelector('input[aria-label=\"自定义安装源\"]').getAttribute('aria-invalid')==='true',blocked:managerFixture.button('安装').disabled})");
  await js(`const input=document.querySelector('input[aria-label="自定义安装源"]');input.value='https://packages.example.test/';input.dispatchEvent(new Event('input',{bubbles:true}))`);
  await waitFor("managerFixture.snapshot.install.registry==='https://packages.example.test/'");
  await js(`managerFixture.button('安装').click()`);
  await waitFor("managerFixture.snapshot.install.phase==='running'");
  await js(`managerFixture.button('查看安装详情').click()`);
  await check('安装运行输出折叠与取消入口',"({folded:document.querySelector('.plugin-manager-terminal').textContent.includes('18 行已折叠'),cancel:!!managerFixture.button('取消安装'),subject:document.querySelector('dialog.plugin-manager-install').textContent.includes('版本 1.2.0')})");
  await js(`managerFixture.button('展开全部输出').click()`);
  await check('安装输出完整展开',"({all:document.querySelector('.plugin-manager-terminal').textContent.includes('输出 15'),noFold:!document.querySelector('.plugin-manager-terminal').textContent.includes('行已折叠')})");
  await js(`managerFixture.button('取消安装').click()`);
  await waitFor("managerFixture.snapshot.install.phase==='cancelling'");
  await check('取消待确认不能再次取消',"({noDuplicate:!managerFixture.button('取消安装'),phase:document.querySelector('dialog.plugin-manager-install').textContent.includes('正在取消安装')})");
  await js(`managerFixture.snapshot.install.phase='unconfirmed';managerFixture.invalidate()`);
  await waitFor("!!managerFixture.button('核对安装状态')");
  await js(`managerFixture.button('核对安装状态').click()`);
  await waitFor("managerFixture.snapshot.install.phase==='done'");
  await check('丢失安装结果可以核对',"({reconciled:managerFixture.commands.some(c=>c.kind==='reconcile-install'),done:document.querySelector('dialog.plugin-manager-install').textContent.includes('已安装')})");
  await check('安装完成未新增依赖明确说明',"({noDependency:document.querySelector('dialog.plugin-manager-install').textContent.includes('没有新增依赖'),noEnable:!managerFixture.button('立即启用')})");
  for(const [kind,message] of [['disk-full','磁盘空间不足'],['permission','没有写入权限'],['integrity','校验失败'],['build-blocked','明确允许这些包']]){
    await js(`managerFixture.snapshot.install.phase='failed';managerFixture.snapshot.install.failure={kind:${JSON.stringify(kind)},reason:'generic'};managerFixture.invalidate()`);
    await waitFor(`document.querySelector('dialog.plugin-manager-install').textContent.includes(${JSON.stringify(message)})`);
    await check('安装失败分类 '+kind,"({classified:!document.querySelector('dialog.plugin-manager-install .plugin-manager-error').textContent.includes('generic'),noAutoBuildApproval:!managerFixture.commands.some(c=>c.kind==='approve-builds')})");
  }
  await js(`managerFixture.snapshot.install.failure={code:'incompatible-version',kind:'network',reason:'generic',incompatible:[{name:'@sample/new-plugin',version:'2.0.0',runtimeVersion:'0.1.0',peers:{sacode:'>=2.0.0'}}]};managerFixture.invalidate()`);
  await waitFor("document.querySelector('dialog.plugin-manager-install').textContent.includes('与 SaCode 0.1.0 不兼容')");
  await check('兼容性拒绝优先于安装失败分类',"({identity:document.querySelector('dialog.plugin-manager-install').textContent.includes('@sample/new-plugin@2.0.0'),required:document.querySelector('dialog.plugin-manager-install').textContent.includes('sacode >=2.0.0'),remedy:document.querySelector('dialog.plugin-manager-install').textContent.includes('兼容的插件版本'),noAccountBrand:!document.querySelector('dialog.plugin-manager-install').textContent.includes('DSH')})");
  await js(`managerFixture.snapshot.install.attempts={registries:['https://registry.npmjs.org/','https://registry.other.test/'],total:2};managerFixture.snapshot.install.failure={kind:'network',failedAt:'registry',reason:'generic'};managerFixture.invalidate()`);
  await waitFor("!!managerFixture.button('更换安装源')");
  await check('全部安装源网络失败列出真实尝试',"({allFailed:document.querySelector('dialog.plugin-manager-install').textContent.includes('所有安装源都无法连接'),official:document.querySelector('dialog.plugin-manager-install').textContent.includes('npm 官方源'),other:document.querySelector('dialog.plugin-manager-install').textContent.includes('https://registry.other.test/')})");
  await js(`managerFixture.button('更换安装源').click()`);
  await waitFor("!!document.querySelector('input[aria-label=\"自定义安装源\"]')");
  await check('更换安装源返回编辑并展开选项',"({idle:managerFixture.snapshot.install.phase==='idle',specRetained:document.querySelector('input[aria-label=\"包名或地址\"]').value==='@sample/new-plugin',requested:managerFixture.commands.some(c=>c.kind==='change-registry')})");
  await js(`managerFixture.snapshot.install.phase='failed';managerFixture.snapshot.install.subject={name:'Git 插件',host:'github.com'};managerFixture.snapshot.install.registries.push({name:'国内镜像',url:'https://registry.npmmirror.com/'});managerFixture.snapshot.install.failure={kind:'timeout',failedAt:'spec-host',reason:'generic'};managerFixture.invalidate()`);
  await waitFor("!!managerFixture.button('试试其他安装来源')");
  await check('GitHub 故障单独恢复且不自动切源',"({hostTitle:document.querySelector('dialog.plugin-manager-install').textContent.includes('连接 GitHub 超时'),requiresName:document.querySelector('dialog.plugin-manager-install').textContent.includes('实际发布的 npm 包名'),noAutoMirror:!managerFixture.commands.some(c=>c.kind==='use-github-mirror')})");
  await js(`managerFixture.button('试试其他安装来源').click()`);
  await waitFor("!!document.querySelector('input[aria-label=\"包名或地址\"]')");
  await check('镜像恢复要求重新指定 npm 包',"({empty:document.querySelector('input[aria-label=\"包名或地址\"]').value==='',registry:managerFixture.snapshot.install.registry==='https://registry.npmmirror.com/',guide:!!document.querySelector('dialog.plugin-manager-install .plugin-manager-guide')})");
  await js(`managerFixture.snapshot.install.phase='unconfirmed';managerFixture.snapshot.install.failure={reason:'lost',uncertainty:'cancellation'};managerFixture.invalidate()`);
  await waitFor("document.querySelector('dialog.plugin-manager-install').textContent.includes('尚未确认安装已停止')");
  await check('取消未确认不宣称安装已停止',"({retryCancel:!!managerFixture.button('取消安装'),uncertainty:document.querySelector('dialog.plugin-manager-install').textContent.includes('等待安装结果')})");
  await js(`managerFixture.snapshot.install.phase='failed';managerFixture.snapshot.install.failure={reason:'安装脚本等待授权',pendingBuilds:['@sample/build']};managerFixture.invalidate()`);
  await waitFor("!!managerFixture.button('允许这些脚本并重试')");
  await check('安装脚本必须显式授权',"({listed:document.querySelector('.plugin-manager-builds').textContent.includes('@sample/build'),noPlainRetry:!managerFixture.button('重试'),noAutoApproval:!managerFixture.commands.some(c=>c.kind==='approve-builds')})");
  await js(`managerFixture.button('允许这些脚本并重试').click()`);
  await waitFor("managerFixture.snapshot.install.phase==='running'");
  await js(`managerFixture.snapshot.install.phase='applying';managerFixture.invalidate()`);
  await waitFor("document.querySelector('dialog.plugin-manager-install').textContent.includes('无法取消')");
  await check('收尾阶段禁止取消安装',"({noCancel:!managerFixture.button('取消安装'),background:!!managerFixture.button('关闭并在后台继续')})");
  await js(`await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
  require('node:fs').writeFileSync(require('node:path').join(outDir,'plugin-manager-install-fixture.png'),(await win.webContents.capturePage()).toPNG());
  await js(`managerFixture.button('关闭并在后台继续').click()`);
  await waitFor("!document.querySelector('dialog.plugin-manager-install')");
  await check('安装窗口关闭保留后台任务入口',"({viewTask:!!managerFixture.button('查看安装任务')})");
  await js(`managerFixture.button('示例插件').click();await Vue.nextTick();managerFixture.button('卸载').click()`);
  await waitFor("!!document.querySelector('dialog[aria-label=\"卸载插件\"]')");
  await check('卸载确认前不移除插件',"({retained:managerFixture.snapshot.packages.length===1,requested:managerFixture.snapshot.confirm==='@sample/plugin'})");
  await js(`[...document.querySelectorAll('dialog[aria-label="卸载插件"] button')].find(b=>b.textContent==='卸载').click()`);
  await waitFor("managerFixture.snapshot.packages.length===0");
  await check('卸载确认后刷新列表',"({empty:document.querySelector('#manager-fixture').textContent.includes('还没有安装任何插件')})");
  await js(`managerFixture.readFail=true;managerFixture.invalidate()`);
  await waitFor("!!managerFixture.button('重试刷新')");
  await check('刷新失败保留已接受的清单与任务',"({lastList:document.querySelector('#manager-fixture').textContent.includes('还没有安装任何插件'),taskKept:!!managerFixture.button('查看安装任务'),honest:document.querySelector('#manager-fixture').textContent.includes('上次读取')})");
  await js(`managerFixture.readFail=false;managerFixture.button('重试刷新').click()`);
  await waitFor("!managerFixture.button('重试刷新')");
  await check('刷新重试成功清除失败提示',"({recovered:!document.querySelector('#manager-fixture').textContent.includes('刷新失败')})");
  await js(`managerFixture.app.unmount()`);
  await check('插件管理页面卸载释放订阅',"({released:managerFixture.off===true})");
  await js(`managerFixture.root.remove();delete window.managerFixture`);
};
