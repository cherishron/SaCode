import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const compiled=await build({entryPoints:[fileURLToPath(new URL('../renderer/pages/automation-page.ts',import.meta.url))],bundle:true,write:false,format:'cjs',external:['vue']});
const slotsSource=readFileSync(fileURLToPath(new URL('../renderer/pages/client-slots.ts',import.meta.url)),'utf8');
const appSource=readFileSync(fileURLToPath(new URL('../renderer/app.js',import.meta.url)),'utf8');
const tick=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
const view=(tasks=[],revision=0,scope='user')=>({scope,workspace:scope==='project'?'D:/repo':'',revision,tasks,executorAvailable:false});
function fixture(api,overrides={}){
 const unmounts=[],events=[];
 const vue={defineComponent:value=>value,ref:value=>({value}),h:(type,props,children)=>({type,props:props||{},children}),watch:(_source,callback,options)=>{if(options?.immediate)callback();},onBeforeUnmount:fn=>unmounts.push(fn)};
 const context={module:{exports:{}},require:()=>vue,globalThis:{crypto:{randomUUID:()=> 'automation-new-id'},confirm:()=>true}};
 vm.runInNewContext(compiled.outputFiles[0].text,context);
 const component=context.module.exports.AutomationPage;
 const render=component.setup({api,sessionId:'session-1',directory:'D:/repo',models:[{id:'model-1',name:'Model One'}],recent:[],readRecent:async()=>({entries:[]}),...overrides},{emit:(...event)=>events.push(event)});
 return{render,unmounts,events};
}
function nodes(node){if(!node||typeof node!=='object')return[];return[node,...(Array.isArray(node.children)?node.children.flatMap(nodes):[])];}
function button(f,label){return nodes(f.render()).find(node=>node.type==='button'&&node.children===label);}
function field(f,label){return nodes(f.render()).find(node=>node.props?.['aria-label']===label);}
function input(f,label,value){const node=field(f,label);assert.ok(node,`missing input ${label}`);node.props.onInput({target:{value}});}
function select(f,label,value){const node=field(f,label);assert.ok(node,`missing select ${label}`);node.props.onChange({target:{value}});}

test('主产品路由通过唯一 Vue 槽位加载真实自动化页',()=>{
 assert.match(slotsSource,/export\s*\{AutomationPage\}\s*from\s*['"]\.\/automation-page['"]/);
 assert.match(appSource,/self\.managementPage==='automation'\?window\.SaCodeSlots\.AutomationPage/);
});

test('自动化页从真实 IPC API 读取清单，并明确当前没有调度执行器',async()=>{
 const f=fixture({automationList:async()=>view([],4)});await tick();
 assert.match(JSON.stringify(f.render()),/调度执行器尚未接通/);
 assert.match(JSON.stringify(f.render()),/不会按 Cron 自动启动/);
 assert.match(JSON.stringify(f.render()),/还没有自动化任务/);
 assert.equal(button(f,'刷新清单').props.disabled,false);
 assert.equal(button(f,'运行'),undefined);
});

test('创建自动化提交完整定义和 Host 修订，真实回执更新页面',async()=>{
 const calls=[];let current=view([],0);
 const f=fixture({automationList:async()=>current,automationSave:async(...args)=>{calls.push(args);current=view([{...args[2],title:args[2].title,modelId:args[2].modelId,timezone:args[2].timezone,permission:args[2].permission,history:[]}],1);return current;}});
 await tick();button(f,'创建自动化').props.onClick();
 input(f,'自动化名称','检查依赖更新');input(f,'自动化提示词','检查过期依赖并给出升级建议');input(f,'自动化工作目录','D:/repo');select(f,'自动化模型','model-1');
 button(f,'保存自动化').props.onClick();await tick();
 assert.equal(calls.length,1);assert.equal(calls[0][0],'session-1');assert.equal(calls[0][1],'user');assert.equal(calls[0][3],0);
 assert.deepEqual(JSON.parse(JSON.stringify(calls[0][2])),{id:'automation-new-id',title:'检查依赖更新',prompt:'检查过期依赖并给出升级建议',cron:'0 9 * * 1-5',workspace:'D:/repo',modelId:'model-1',timezone:'Asia/Shanghai',permission:'plan',enabled:true});
 assert.match(JSON.stringify(f.render()),/自动化配置已保存/);assert.match(JSON.stringify(f.render()),/检查依赖更新/);
});

test('修订冲突时保留用户草稿，不伪报保存成功',async()=>{
 const f=fixture({automationList:async()=>view([],7),automationSave:async()=>{throw Error('automation-revision-conflict');}});await tick();button(f,'创建自动化').props.onClick();input(f,'自动化名称','我的草稿');input(f,'自动化提示词','保留这段内容');input(f,'自动化工作目录','D:/repo');button(f,'保存自动化').props.onClick();await tick();
 assert.match(JSON.stringify(f.render()),/配置已被其他操作更新/);assert.match(JSON.stringify(f.render()),/我的草稿/);assert.match(JSON.stringify(f.render()),/保留这段内容/);assert.doesNotMatch(JSON.stringify(f.render()),/自动化配置已保存/);
});

test('Host 读取失败或结构异常都不会被渲染成空清单',async()=>{
 const failed=fixture({automationList:async()=>{throw Error('host-gone');}});await tick();assert.match(JSON.stringify(failed.render()),/Host 连接已断开/);assert.doesNotMatch(JSON.stringify(failed.render()),/还没有自动化任务/);
 const malformed=fixture({automationList:async()=>({scope:'user',revision:0,tasks:[],executorAvailable:'false'})});await tick();assert.match(JSON.stringify(malformed.render()),/回执格式错误/);assert.doesNotMatch(JSON.stringify(malformed.render()),/还没有自动化任务/);
});

test('时区数据缺失或时区名称无效时给出可处理的提示',async()=>{
 const f=fixture({automationList:async()=>view(),automationSave:async()=>{throw Error('automation-timezone-load-failed');}});await tick();
 button(f,'创建第一个自动化').props.onClick();input(f,'自动化名称','时区检查');input(f,'自动化提示词','仅保存配置');input(f,'自动化工作目录','D:/repo');
 button(f,'保存自动化').props.onClick();await tick();
 assert.match(JSON.stringify(f.render()),/无法加载所选时区/);
});

test('暂停与删除使用当前列表修订并刷新真实回执',async()=>{
 const calls=[];let current=view([{id:'job-1',title:'依赖检查',prompt:'检查依赖',cron:'0 9 * * 1-5',workspace:'D:/repo',modelId:'model-1',enabled:true,history:[]}],5);
 const f=fixture({automationList:async()=>current,automationControl:async(...args)=>{calls.push(args);current=view([],6);return current;}});await tick();button(f,'暂停').props.onClick();await tick();
 assert.deepEqual(calls[0],['session-1','user','job-1','pause',5]);assert.match(JSON.stringify(f.render()),/自动化配置已暂停/);
});

test('卸载后的迟到清单结果不进入原页面',async()=>{
 let resolve;const f=fixture({automationList:()=>new Promise(r=>resolve=r)});f.unmounts[0]();resolve(view([{id:'late',prompt:'迟到',cron:'* * * * *',workspace:'D:/repo',enabled:true}],1));await tick();
 assert.doesNotMatch(JSON.stringify(f.render()),/迟到/);
});

test('卸载后的迟到保存回执不会覆盖页面状态',async()=>{
 let resolve;const f=fixture({automationList:async()=>view(),automationSave:()=>new Promise(r=>resolve=r)});await tick();button(f,'创建自动化').props.onClick();input(f,'自动化名称','迟到保存');input(f,'自动化提示词','不应回写');input(f,'自动化工作目录','D:/repo');button(f,'保存自动化').props.onClick();f.unmounts[0]();resolve(view([{id:'late',title:'迟到保存',prompt:'不应回写',cron:'* * * * *',workspace:'D:/repo',enabled:true}],1));await tick();
 const tree=f.render(),list=nodes(tree).find(node=>node.props?.class==='automation-list');
 assert.deepEqual(list.children,[]);assert.doesNotMatch(JSON.stringify(tree),/自动化配置已保存/);assert.equal(button(f,'保存自动化').props.disabled,true);
});

test('卸载后的迟到启停回执不会覆盖任务状态',async()=>{
 let resolve;const task={id:'job-1',title:'依赖检查',prompt:'检查依赖',cron:'0 9 * * 1-5',workspace:'D:/repo',modelId:'model-1',enabled:true,history:[]};const f=fixture({automationList:async()=>view([task],5),automationControl:()=>new Promise(r=>resolve=r)});await tick();button(f,'暂停').props.onClick();f.unmounts[0]();resolve(view([{...task,enabled:false}],6));await tick();
 assert.equal(button(f,'暂停').props.disabled,true);assert.doesNotMatch(JSON.stringify(f.render()),/自动化配置已暂停/);assert.match(JSON.stringify(f.render()),/已启用 · 待执行器/);
});
