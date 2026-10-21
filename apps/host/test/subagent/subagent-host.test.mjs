// 真实Host + 回环合成模型：主工具声明、审批、独立子上下文与摘要回传。
import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdirSync,mkdtempSync,writeFileSync,realpathSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {setTimeout as pause} from 'node:timers/promises';
const {HostBridge}=createRequire(import.meta.url)('../../../desktop/host-bridge.cjs');
for(const decision of ['allowed-once','denied','project-role'])test('Host子代理委派 '+decision,{timeout:60000},async()=>{
  assert.ok(process.env.SACODE_HOST,'必须指定本轮SACODE_HOST');
  const root=fileURLToPath(new URL('../../../../target/tmp/r8-host/runs/',import.meta.url));mkdirSync(root,{recursive:true});
  const dir=mkdtempSync(join(root,'run-')),project=join(dir,'project');mkdirSync(project);writeFileSync(join(project,'a.txt'),'fixture');
  const accepted=decision!=='denied',custom=decision==='project-role';
  const settings=join(dir,'settings');mkdirSync(settings);
  if(custom){
    const workspace=realpathSync(project),role={id:'scope-probe',name:'作用域探针',description:'合成角色',tools:['read'],acpEnabled:false,model:'',budget:{maxTurns:2,maxTokens:20000,maxTimeMs:30000},systemPrompt:'USER_ROLE_PROMPT'};
    writeFileSync(join(settings,'subagent-roles-user.json'),JSON.stringify({schemaVersion:1,scope:'user',workspace:'',revision:1,roles:[role]}));
    const key=createHash('sha256').update(workspace).digest('hex');
    writeFileSync(join(settings,`subagent-roles-${key}.json`),JSON.stringify({schemaVersion:1,scope:'project',workspace,revision:1,roles:[{...role,systemPrompt:'PROJECT_ROLE_PROMPT'}]}));
  }
  let requests=0,children=0,checked=false;const errors=[];
  const server=createServer(async(req,res)=>{
    try{
      let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);requests++;
      const send=(delta,finish='stop')=>{res.writeHead(200,{'content-type':'text/event-stream'});res.end('data: '+JSON.stringify({choices:[{index:0,delta}]})+'\n\ndata: '+JSON.stringify({choices:[{index:0,delta:{},finish_reason:finish}],usage:{total_tokens:10}})+'\n\ndata: [DONE]\n\n');};
      const child=body.messages.some(m=>m.role==='system'&&m.content?.includes(custom?'PROJECT_ROLE_PROMPT':'只读探索子代理'));
      if(child){
        children++;assert.ok(body.max_tokens>0);assert.equal(body.messages.some(m=>m.content?.includes('PARENT_PRIVATE_MARKER')),false);
        assert.equal(body.tools.some(t=>t.function.name==='subagent_delegate'),false);
        return send({content:'独立子任务摘要'});
      }
      const spec=body.tools.find(t=>t.function.name==='subagent_delegate');assert.ok(spec);checked=true;
      assert.deepEqual(spec.function.parameters.required,['roleId','task']);
      if(!body.messages.some(m=>m.role==='tool'&&m.tool_call_id==='delegate-1'))return send({tool_calls:[{index:0,id:'delegate-1',type:'function',function:{name:'subagent_delegate',arguments:JSON.stringify({roleId:custom?'scope-probe':'explorer',task:'返回独立摘要'})}}]},'tool_calls');
      const result=JSON.parse(body.messages.find(m=>m.role==='tool'&&m.tool_call_id==='delegate-1').content);
      if(accepted)assert.equal(result.summary,'独立子任务摘要');else assert.match(result.error,/approval-not-granted/);
      send({content:'父任务完成'});
    }catch(e){errors.push(String(e));res.writeHead(500);res.end('fixture-error');}
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const bridge=new HostBridge(process.env.SACODE_HOST,{...process.env,SACODE_USER_SETTINGS_DIR:join(dir,'settings'),SACODE_PROVIDER_MODEL:'subagent-fixture',SACODE_PROVIDER_KEY:'invalid-local-fixture',SACODE_PROVIDER_BASE_URL:`http://127.0.0.1:${server.address().port}/v1/chat/completions`});
  try{
    await bridge.start(dir);await bridge.request('initialize');await bridge.request('workspace/set-directory',{sessionId:'current',directory:project});
    await bridge.request('session/append',{eventType:'user/message',data:'PARENT_PRIVATE_MARKER 委派独立任务'});await bridge.request('task/start');
    const answered=new Set();let settled;
    for(let i=0;i<1500;i++){
      const poll=await bridge.request('turn/poll');
      for(const notice of bridge.notifications.filter(n=>n.method==='approval/asked')){
        const id=notice.params.approvalId;if(answered.has(id))continue;answered.add(id);
        await bridge.request('approval/answer',{approvalId:id,decision:accepted?'allowed-once':'denied'});
      }
      if(poll.settled){settled=poll;break;}await pause(20);
    }
    assert.deepEqual(errors,[]);assert.ok(settled);assert.equal(settled.text,'父任务完成');assert.ok(checked);
    assert.equal(children,accepted?1:0);assert.equal(answered.size,1);assert.equal(requests,accepted?3:2);
  }finally{await bridge.stop();server.closeAllConnections();await new Promise(r=>server.close(r));}
});
