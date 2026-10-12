// 使用正式 main/preload/renderer 和真实 Host；不替换 IPC，不启动模型；仅在私有目录执行明确的读取工具检查。
const {app,BrowserWindow,nativeTheme}=require('electron');
const {mkdirSync,writeFileSync}=require('node:fs');
const {join}=require('node:path');
const root=process.env.SACODE_DESIGN_SMOKE_DIR;
if(!root)throw Error('必须指定 SACODE_DESIGN_SMOKE_DIR，避免碰用户数据');
mkdirSync(root,{recursive:true});
process.env.SACODE_USER_SETTINGS_DIR=join(root,'settings');
app.setPath('userData',join(root,'electron'));
mkdirSync(join(root,'session'),{recursive:true});
writeFileSync(join(root,'session','preview-smoke.txt'),'SaCode real Host preview fixture\nsecond line\n');
// 已配置项目是独立磁盘夹具；后续通过真实会话选择、目录请求和读取工具验收。
mkdirSync(join(root,'project','src'),{recursive:true});
writeFileSync(join(root,'project','src','search-smoke.txt'),'SaCode configured workspace search and preview\n');
const fixtureGit=(...args)=>require('node:child_process').execFileSync('git',['-C',join(root,'project'),...args],{encoding:'utf8'});
fixtureGit('init','-b','main');fixtureGit('config','user.name','SaCode Test');fixtureGit('config','user.email','test@example.invalid');
fixtureGit('add','--','.');fixtureGit('commit','-m','fixture');
mkdirSync(join(root,'session','sessions','search-fixture'),{recursive:true});
writeFileSync(join(root,'session','sessions','search-fixture','session.log'),'0\tworkspace/directory\t'+join(root,'project').replace(/\\/g,'/')+'\n1\tterminal/chunk\tbash-1::终端回放取证夹具（未执行命令）\n');
process.argv.push('--session-dir='+join(root,'session'));
app.on('browser-window-created',(_event,win)=>win.setOpacity(0));
// 备用 Electron 可执行文件来自打包目录：本次验源码开发态，必须选择开发态 Host 路径。
// 不替换任何 IPC 或 Host 请求。否则 app.isPackaged 会选到备用运行时自己的旧宿主。
Object.defineProperty(app,'isPackaged',{value:false});
require('../main.cjs');
const checks=[];const deadline=setTimeout(()=>{writeFileSync(join(root,'checks.json'),JSON.stringify(checks,null,2));writeFileSync(join(root,'failure.txt'),'MANAGEMENT_UI_TIMEOUT');app.exit(1);},60000);
app.whenReady().then(async()=>{
 const win=BrowserWindow.getAllWindows()[0];const js=s=>win.webContents.executeJavaScript(s);
 const wait=ms=>new Promise(r=>setTimeout(r,ms));
 const remembered={knowledge:'',automation:'',connections:''};
 const fill=(label,value,event='input')=>js(`(()=>{const n=[...document.querySelectorAll('input,textarea,select')].find(n=>n.getAttribute('aria-label')===${JSON.stringify(label)});if(!n)throw Error('字段不存在');n.value=${JSON.stringify(value)};n.dispatchEvent(new Event(${JSON.stringify(event)},{bubbles:true}));return window.Vue.nextTick();})()`);
 const fieldValue=label=>js(`[...document.querySelectorAll('input,textarea,select')].find(n=>n.getAttribute('aria-label')===${JSON.stringify(label)}).value`);

 const check=(name,pass)=>{checks.push({name,pass});if(!pass)throw Error(name);};
 for(let n=0;n<120;n++){if(await js("!!document.querySelector('#composer')"))break;await wait(50);}
 for(const theme of ['light','dark']){await js(`document.querySelector('#app')._vnode.component.proxy.setTheme('${theme}')`);await wait(100);check(theme+' 真实主题颜色',await js(`getComputedStyle(document.documentElement).getPropertyValue('--surface-2').trim()==='${theme==='light'?'#faf9f6':'#252622'}'`));
  for(const width of [1384,700]){win.setContentSize(width,764);await wait(120);
   for(const id of ['knowledge','automation','connections']){
    await js(`document.querySelector('#open-${id}').click()`);await wait(150);
    check(theme+width+id+' 正式入口',await js(`!!document.querySelector('#management-${id}')`));
    check(theme+width+id+' 不显示工作台',await js("document.querySelector('.side').hidden&&document.querySelector('.app').getAttribute('data-management-page')!=='chat'"));
    check(theme+width+id+' 缺接口不冒充空清单',await js("document.querySelector('.management-unavailable').textContent.includes('这里不表示清单为空')"));
    await js("document.querySelector('.management-intro button').click()");await wait(60);
    check(theme+width+id+' 配置可编辑但不保存执行',await js("!!document.querySelector('.management-editor')&&[...document.querySelectorAll('.management-form-actions button')].find(b=>b.textContent==='保存').disabled"));
    check(theme+width+id+' 草稿按页面保留',await fieldValue('名称')===remembered[id]);
    remembered[id]='草稿-'+id;await fill('名称',remembered[id]);
    check(theme+width+id+' 字段不越界',await js("[...document.querySelectorAll('.management-field input,.management-field select,.management-field textarea')].every(n=>{const r=n.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1;})"));
    if(id==='knowledge'){
     await fill('文档来源','file','change');check('文件来源有路径且不假读取',await js("!!document.querySelector('[aria-label=\"知识来源路径\"]')&&!document.querySelector('[aria-label=\"正文\"]')"));
     await js("document.querySelectorAll('.management-scope button')[1].click()");await wait(30);
     check('项目知识明确未选项目',await js("document.querySelector('.management-project').textContent.includes('尚未选择项目')"));
     check('作用域不混入用户标题',await fieldValue('名称')!==remembered[id]);await fill('名称','项目知识草稿');
     await js("document.querySelectorAll('.management-scope button')[0].click()");await wait(30);check('返回用户知识恢复草稿',await fieldValue('名称')===remembered[id]);
    }
    if(id==='automation'){
     check('自动化目录模型Cron时区',await js("['工作目录','自动化模型','Cron','时区'].every(v=>document.querySelector('[aria-label=\"'+v+'\"]'))"));
     await fill('工作目录','D:/任务草稿');await fill('Cron','15 8 * * 1-5');
     await js("[...document.querySelectorAll('.management-editor button')].find(b=>b.textContent==='模型中心').click()");await wait(100);
     check('模型快捷入口打开统一设置',await js("!!document.querySelector('dialog[open] #settings-page-model-center')&&!document.querySelector('#settings-page-model-center').hidden"));
     await js("document.querySelector('[aria-label=\"关闭SaCode 设置\"]').click()");await wait(60);
     check('关闭模型中心保留自动化草稿',await fieldValue('工作目录')==='D:/任务草稿'&&await fieldValue('Cron')==='15 8 * * 1-5');
    }
    if(id==='connections'){
     await fill('连接地址','ssh.example.invalid');await fill('端口','2222');
     await js("document.querySelectorAll('.management-scope button')[1].click()");await wait(30);check('数据库不混入SSH地址',await fieldValue('连接地址')!=='ssh.example.invalid');await fill('连接地址','database.example.invalid');await fill('数据库类型','MySQL','change');
     await js("document.querySelectorAll('.management-scope button')[2].click()");await wait(30);check('MCP不混入数据库地址',await fieldValue('连接地址')!=='database.example.invalid');
     await fill('连接地址','服务命令草稿');await fill('MCP 传输','http','change');check('HTTP不复用stdio命令',await fieldValue('连接地址')!=='服务命令草稿');await fill('连接地址','https://mcp.example.invalid');await fill('MCP 传输','stdio','change');check('stdio恢复命令草稿',await fieldValue('连接地址')==='服务命令草稿');
     await js("document.querySelectorAll('.management-scope button')[0].click()");await wait(30);check('SSH恢复原地址与端口',await fieldValue('连接地址')==='ssh.example.invalid'&&await fieldValue('端口')==='2222');

    }
    await js("new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))");
    writeFileSync(join(root,id+'-'+theme+'-'+width+'.png'),(await win.webContents.capturePage()).toPNG());
    await js("document.querySelector('#back-to-chat').click()");await wait(60);
    check('返回对话恢复焦点 '+id,await js(`document.activeElement.id===(document.querySelector('#open-${id}').getClientRects().length?'open-${id}':'toggle-sidebar')&&!document.querySelector('.management-page')`));
   }
  }
 }
 // 真实切换到已配置项目：用户草稿继续可见，项目草稿独立。
 await js("document.querySelector('#app')._vnode.component.proxy.selectSession('sessions/search-fixture')");
 for(let n=0;n<100;n++){if(await js("document.querySelector('#app')._vnode.component.proxy.workspace?.configured"))break;await wait(50);}
 check('真实会话切换读取项目',await js("document.querySelector('#app')._vnode.component.proxy.workspace?.configured===true"));
 await js("document.querySelector('#open-knowledge').click()");await wait(100);await js("document.querySelector('.management-intro button').click()");await wait(30);
 check('用户知识草稿跨会话保留',await fieldValue('名称')===remembered.knowledge);
 await js("document.querySelectorAll('.management-scope button')[1].click()");await wait(30);
 check('新项目不继承未选项目草稿',await fieldValue('名称')==='');
 check('项目知识显示实际工作目录',await js("document.querySelector('.management-project').textContent.includes(document.querySelector('#app')._vnode.component.proxy.workspace.directory)"));
 await js("document.querySelector('#back-to-chat').click()");await wait(30);await js("document.querySelector('#open-automation').click()");await wait(100);await js("document.querySelector('.management-intro button').click()");await wait(30);
 check('新会话自动化不串旧草稿',await fieldValue('名称')==='');
 check('当前项目初始化实际目录',await js("document.querySelector('[aria-label=\"工作目录\"]').value===document.querySelector('#app')._vnode.component.proxy.workspace.directory"));
 writeFileSync(join(root,'checks.json'),JSON.stringify(checks,null,2));console.log('MANAGEMENT_UI_PASS '+checks.length);clearTimeout(deadline);win.close();app.exit(0);
}).catch(e=>{writeFileSync(join(root,'failure.txt'),String(e.stack||e));writeFileSync(join(root,'checks.json'),JSON.stringify(checks,null,2));console.error(e);app.exit(1);});
