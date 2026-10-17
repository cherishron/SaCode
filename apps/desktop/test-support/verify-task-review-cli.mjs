// 与 Host 联验使用同一真实任务副本，直接执行 CLI 用户命令。
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {fixtureHostEnv} from './fixture-env.mjs';
const [directory,cli]=process.argv.slice(2).map(v=>resolve(v));
assert.ok(directory&&cli,'需要真实 Host 验证目录及本轮 CLI 路径');
const previous=JSON.parse(readFileSync(join(directory,'verification.json'),'utf8'));
const run=(action,params)=>spawnSync(cli,['job',action,JSON.stringify(params)],{cwd:directory,env:fixtureHostEnv(directory,{TEMP:directory,TMP:directory}),encoding:'utf8',windowsHide:true,timeout:15000,maxBuffer:1048576});
const describe=run('describe',{sessionId:'current',executionId:previous.executionId});
assert.equal(describe.status,0,describe.stderr);const task=JSON.parse(describe.stdout),review=JSON.parse(task.review);
let checks=0;
for(const row of review.files)for(const side of ['before','after']){
 const result=run('review-file',{sessionId:'current',executionId:task.executionId,revision:task.revision,path:row.path,side});
 assert.equal(result.status,0,result.stderr);const reply=JSON.parse(result.stdout);
 assert.equal(reply.sha256,row[side+'Digest']);assert.equal(Buffer.from(reply.data,'base64').length,reply.returnedBytes);checks++;
}
const denied=run('review-file',{sessionId:'current',executionId:task.executionId,revision:task.revision,path:'../secret',side:'before'});
assert.equal(denied.status,1);assert.match(denied.stderr,/workspace-review-path-not-recorded/);checks++;
const report={passed:true,checks,executionId:task.executionId,cliSha256:createHash('sha256').update(readFileSync(cli)).digest('hex')};
writeFileSync(join(directory,'cli-verification.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
