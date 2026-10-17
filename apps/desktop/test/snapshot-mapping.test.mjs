import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
const bundle=await build({entryPoints:[fileURLToPath(new URL('../renderer/pages/execution-task-state.ts',import.meta.url))],bundle:true,write:false,format:'cjs'});
const context={module:{exports:{}}};vm.runInNewContext(bundle.outputFiles[0].text,context);
const {executionWorkspaceSnapshot,executionReview}=context.module.exports;
const receipt={version:1,sessionId:'current',taskId:'t1',requestId:'r1',executionId:'execution-1',proposalDigest:'a'.repeat(64),workspaceRevision:1,sourceDirectory:'D:/source',executionDirectory:'D:/private',sourceIdentity:'1'.repeat(48),manifestDigest:'b'.repeat(64),entryCount:1,byteCount:8,excluded:[]};
const task={sessionId:'current',taskId:'t1',requestId:'r1',executionId:'execution-1',proposalDigest:'a'.repeat(64),revision:4,phase:'exited',proposal:JSON.stringify({cwd:'D:/source',workspaceRevision:1}),workspaceSnapshot:JSON.stringify(receipt)};
test('快照逻辑工作区保持原目录，执行目录单独展示且必须有目录身份',()=>{
 const value=executionWorkspaceSnapshot(task);assert.equal(value.sourceDirectory,'D:/source');assert.equal(value.executionDirectory,'D:/private');
 assert.throws(()=>executionWorkspaceSnapshot({...task,workspaceSnapshot:JSON.stringify({...receipt,sourceIdentity:undefined})}),/快照身份/);
 assert.throws(()=>executionWorkspaceSnapshot({...task,workspaceSnapshot:JSON.stringify({...receipt,sourceDirectory:'D:/other'})}),/快照身份/);
});
test('物理cwd旧快照继续只读兼容',()=>{
 const old={...receipt};delete old.sourceIdentity;
 assert.equal(executionWorkspaceSnapshot({...task,proposal:JSON.stringify({cwd:'D:/private',workspaceRevision:1}),workspaceSnapshot:JSON.stringify(old)}).executionDirectory,'D:/private');
});
test('审查结果不能换用另一个源目录实体',()=>{
 const review={...receipt,executionRevision:4,files:[]};delete review.executionDirectory;
 assert.equal(executionReview({...task,review:JSON.stringify(review)}).sourceIdentity,receipt.sourceIdentity);
 assert.throws(()=>executionReview({...task,review:JSON.stringify({...review,sourceIdentity:'2'.repeat(48)})}),/差异清单身份/);
});

test('实际程序绑定必须属于当前提案，拒绝相对路径及畸形指纹',()=>{
 const proposal=JSON.stringify({cwd:'D:/source',workspaceRevision:1,executable:'node'});
 const binding={version:1,requested:'node',executable:'D:/Tools/node.exe',sha256:'c'.repeat(64)};
 const value=tool=>({...task,proposal,workspaceSnapshot:JSON.stringify({...receipt,toolBinding:JSON.stringify(tool)})});
 assert.equal(JSON.parse(executionWorkspaceSnapshot(value(binding)).toolBinding).executable,binding.executable);
 for(const altered of [{...binding,requested:'cjpm'},{...binding,executable:'node.exe'},{...binding,sha256:'bad'},{...binding,extra:true}])assert.throws(()=>executionWorkspaceSnapshot(value(altered)),/程序绑定/);
});
