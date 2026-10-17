import {mkdtempSync,mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

// 所有配置、数据与插件声明仅写入独占临时工作区；不读取用户认证、不安装npm包。
export async function openCodeInstanceFixture(t){
 const base=mkdtempSync(join(tmpdir(),'sacode-opencode-instance-')),workspace=join(base,'workspace'),fixture=join(workspace,'fixture-plugin');
 mkdirSync(fixture,{recursive:true});for(const name of ['config','data','state','cache','home','appdata','localappdata'])mkdirSync(join(base,name));
 let modelRequests=0;const modelServer=createServer((req,res)=>{modelRequests++;req.resume();res.writeHead(503);res.end('model-requests-forbidden-in-diagnostic-test');});
 await new Promise(done=>modelServer.listen(0,'127.0.0.1',done));t.after(()=>new Promise(done=>modelServer.close(done)));
 writeFileSync(join(fixture,'package.json'),JSON.stringify({name:'sacode-isolated-fixture',type:'module',main:'index.js'}));
 writeFileSync(join(fixture,'index.js'),`import {Plugin,Provider,Model} from '@opencode/plugin';
export default Plugin.define({id:'sacode.fixture.readonly-catalog',async setup(ctx){
 const providerID=Provider.ID.make('sacode-fixture');const model=Model.Info.default(providerID,Model.ID.make('fixture'));
 await ctx.provider.transform(editor=>editor.add({info:{...Provider.Info.empty(providerID),activation:'enabled',package:'@opencode/ai/providers/openai-compatible',settings:{baseURL:'http://127.0.0.1:${modelServer.address().port}/v1'}},models:[model]}));
 await ctx.agent.transform(editor=>{const agent=editor.list().find(a=>a.mode==='subagent');if(agent)editor.update(agent.id,a=>{a.model={providerID,id:Model.ID.make('missing-fixture-model')};});});
}});`);
 const adapter=fileURLToPath(new URL('../../../extjs/providers/opencode-diagnostics/',import.meta.url));
 writeFileSync(join(workspace,'opencode.json'),JSON.stringify({model:'sacode-fixture/fixture',plugins:[fixture,adapter]}));
 mkdirSync(join(base,'config','opencode'));writeFileSync(join(base,'config','opencode','opencode.json'),JSON.stringify({update:'disable'}));
 const environment={};for(const key of ['SystemRoot','WINDIR','ComSpec','PATHEXT','PROCESSOR_ARCHITECTURE','NUMBER_OF_PROCESSORS'])if(process.env[key])environment[key]=process.env[key];
 Object.assign(environment,{PATH:[dirname(process.execPath),'C:/Windows/System32'].join(';'),
  TEMP:base,TMP:base,USERPROFILE:join(base,'home'),APPDATA:join(base,'appdata'),LOCALAPPDATA:join(base,'localappdata'),
  XDG_CONFIG_HOME:join(base,'config'),XDG_DATA_HOME:join(base,'data'),XDG_STATE_HOME:join(base,'state'),XDG_CACHE_HOME:join(base,'cache'),
  SACODE_USER_SETTINGS_DIR:join(base,'sacode-settings'),SACODE_ACP_OPENCODE_EXECUTABLE:process.env.SACODE_ACP_OPENCODE_TEST_EXECUTABLE});
 return {base,workspace,environment,modelRequests:()=>modelRequests,
  async cli(...args){
   const child=spawn(process.env.SACODE_CLI,['acp',...args],{cwd:workspace,env:environment,windowsHide:true,stdio:['ignore','pipe','pipe']});
   let out='',err='';const timer=setTimeout(()=>child.kill(),45000);
   return await new Promise((done,reject)=>{
    child.stdout.on('data',b=>{out+=b;if(out.length>1048576)child.kill();});child.stderr.on('data',b=>{err+=b;if(err.length>1048576)child.kill();});
    child.once('error',error=>{clearTimeout(timer);reject(error);});child.once('close',(status,signal)=>{clearTimeout(timer);done({status,signal,stdout:out,stderr:err});});
   });
  },log:()=>readFileSync(join(workspace,'session.log'),'utf8')};
}
