import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const {HostBridge}=createRequire(import.meta.url)('../host-bridge.cjs');

test('真实Host拉取模型落库并拒绝陈旧目录写入及失败响应',{timeout:30000},async t=>{
  let invalid=false;const auth=[];
  const server=createServer((req,res)=>{auth.push(req.headers.authorization);res.writeHead(invalid?401:200,{'Content-Type':'application/json'});res.end(invalid?'{"error":"denied"}':JSON.stringify({data:[{id:'pulled-a'},{id:'pulled-b'},{id:'pulled-a'}]}));});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
  const dir=mkdtempSync(join(tmpdir(),'sacode-pull-'));
  const bridge=new HostBridge(process.env.SACODE_HOST||fileURLToPath(new URL('../dist/host/bin/sacode-host.exe',import.meta.url)),{...process.env,SACODE_USER_SETTINGS_DIR:join(dir,'settings')});
  t.after(()=>bridge.stop());await bridge.start(dir);
  const empty=await bridge.request('model/registry/describe');
  const saved=await bridge.request('model/registry/update',{draft:{id:'pull',name:'拉取测试',baseUrl:`http://127.0.0.1:${server.address().port}`,protocol:'openai-completions',models:[{id:'original',name:'原模型',contextWindow:'',maxTokens:'',image:false}]},expectedRevision:empty.revision});
  await bridge.request('model/registry/save-credential',{providerId:'pull',expectedRevision:saved.revision,key:'fixture-pull-key'});
  const pulled=await bridge.request('model/pull',{providerId:'pull',expectedRevision:saved.revision});
  assert.deepEqual(pulled.providers[0].models.map(m=>m.id),['original','pulled-a','pulled-b']);
  assert.equal(pulled.revision,saved.revision+1);assert.equal(auth[0],'Bearer fixture-pull-key');
  await assert.rejects(bridge.request('model/pull',{providerId:'pull',expectedRevision:saved.revision}),/settings-conflict/);
  invalid=true;await assert.rejects(bridge.request('model/pull',{providerId:'pull',expectedRevision:pulled.revision}));
  const after=await bridge.request('model/registry/describe');assert.equal(after.revision,pulled.revision);assert.deepEqual(after.providers[0].models,pulled.providers[0].models);
  await bridge.stop();await bridge.start(dir);assert.deepEqual((await bridge.request('model/registry/describe')).providers[0].models,pulled.providers[0].models);
});
