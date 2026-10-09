import {spawnSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {tmpdir} from 'node:os';
import assert from 'node:assert/strict';
const exe=resolve(process.env.SACODE_CLI||'apps/desktop/.tmp-test/execution-api-cli/bin/sacode.exe');
if(!existsSync(exe)) throw Error('缺新编译的私有 CLI，不能沿用旧安装包');
const evidenceBase=resolve(process.env.SACODE_EXECUTION_EVIDENCE||'apps/desktop/.tmp-test');
mkdirSync(evidenceBase,{recursive:true});
const root=mkdtempSync(join(evidenceBase,'sacode-execution-cli-'));
writeFileSync(join(root,'session.log'),`0\tworkspace/directory\t${root.replaceAll('\\','\\\\')}\n`);
const env={...process.env,PATH:join(process.env.SystemRoot,'System32'),TMP:root,TEMP:root,SACODE_USER_SETTINGS_DIR:join(root,'settings')};
const results=[];
function run(action,params,input=''){
  const result=spawnSync(exe,['job',action,JSON.stringify(params)],{cwd:root,env,input,encoding:'utf8',windowsHide:true,timeout:30000});
  results.push({action,status:result.status,stdout:result.stdout,stderr:result.stderr,error:result.error?.message});
  if(result.error) throw result.error;
  return result;
}
try{
 const proposal=JSON.stringify({workspaceRevision:1,cwd:root.replaceAll('\\','/'),executable:'cmd',argv:['/c','echo never-run'],timeoutMs:1000,outputLimit:64});
 const params={sessionId:'current',taskId:'task-1',requestId:'request-1',proposal};
 let r=run('propose',params);assert.equal(r.status,0);const state=JSON.parse(r.stdout);assert.equal(state.phase,'awaiting-approval');
 r=run('propose',params);assert.equal(r.status,0);assert.equal(JSON.parse(r.stdout).executionId,state.executionId);
 r=run('describe',{sessionId:'current',executionId:state.executionId});assert.equal(r.status,0);assert.equal(JSON.parse(r.stdout).proposalDigest,state.proposalDigest);
 r=run('authorize',{sessionId:'current',executionId:state.executionId,revision:state.revision,proposalDigest:state.proposalDigest},'n\n');assert.equal(r.status,1);assert.match(r.stderr,/not-authorized/);
 r=run('authorize',{sessionId:'current',executionId:state.executionId,revision:state.revision,proposalDigest:state.proposalDigest},'y\n');assert.equal(r.status,0);const admitted=JSON.parse(r.stdout);assert.equal(admitted.phase,'admitted');
 r=run('start',{sessionId:'current',executionId:state.executionId,revision:admitted.revision});assert.equal(r.status,1);assert.match(r.stderr,/execution-provider-unverified/);
 r=run('describe',{sessionId:'current',executionId:state.executionId});assert.equal(r.status,0);const restored=JSON.parse(r.stdout);assert.equal(restored.phase,'awaiting-approval');assert.ok(restored.revision>admitted.revision);
 r=run('output',{sessionId:'current',executionId:state.executionId,cursor:-1,limit:16});assert.equal(r.status,0);assert.deepEqual(JSON.parse(r.stdout).records,[]);
 r=run('stop',{sessionId:'current',executionId:state.executionId,revision:restored.revision});assert.equal(r.status,0);assert.equal(JSON.parse(r.stdout).phase,'cancelled-before-start');
 r=run('describe',{sessionId:'other',executionId:state.executionId});assert.equal(r.status,1);assert.match(r.stderr,/execution-session-changed/);
 assert.ok(!readFileSync(join(root,'session.log'),'utf8').includes('owned-subprocess:'));
 console.log('EXECUTION_CLI_PASS 10 cases；无 SDK PATH；启动门禁关闭；重启不继承授权');
}finally{writeFileSync(join(root,'results.json'),JSON.stringify(results,null,2));console.log('EXECUTION_CLI_EVIDENCE='+root);}
