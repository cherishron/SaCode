import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const createFixture=createRequire(import.meta.url)('../support/development-task-fixture.cjs');
const root=fileURLToPath(new URL('../../../../target/tmp/development-fixture-20261019/',import.meta.url));
for(const state of ['denied','expired'])test('开发夹具如实结算修改审批'+state+'，不派发测试命令',async()=>{
  mkdirSync(root,{recursive:true});const project=mkdtempSync(join(root,state+'-'));
  const fixture=await createFixture({project,nodeExecutable:process.execPath});
  const tools=['read','edit','pwsh'].map(name=>({function:{name}}));
  const send=async messages=>{const response=await fetch(fixture.baseUrl,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tools,messages})});assert.equal(response.status,200);return response.text();};
  try{
    assert.match(await send([{role:'user',content:'修复相加'}]),/dev-read/);
    assert.match(await send([{role:'tool',tool_call_id:'dev-read',content:fixture.before}]),/dev-edit/);
    const result=await send([{role:'tool',tool_call_id:'dev-edit',content:JSON.stringify({error:'approval-not-granted:'+state})}]);
    assert.match(result,/文件修改未成功执行，测试未运行/);assert.doesNotMatch(result,/tool_calls|dev-test/);
    assert.equal(readFileSync(join(project,'sum.cjs'),'utf8'),fixture.before);
    assert.equal(fixture.report().requests,3);assert.deepEqual(fixture.report().failures,[]);
  }finally{await fixture.close();}
});
