import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {mkdtempSync} from 'node:fs';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';

const bundle=await build({entryPoints:[fileURLToPath(new URL('../renderer/pages/git-action-state.ts',import.meta.url))],bundle:true,write:false,format:'cjs'});
const ctx={module:{exports:{}}};vm.runInNewContext(bundle.outputFiles[0].text,ctx);
const {createGitActionPlan,inspectPushUpstream,parseGitPushTarget,safeGitBranchLabel}=ctx.module.exports;

test('暂存提案只接受当前可暂存文件，并用 literal pathspec 防止通配符扩张',()=>{
 const entries=[{path:'wild[1].txt',x:'?',y:'?'},{path:'other.txt',x:'?',y:'?'}];
 const plan=createGitActionPlan('stage',{entries,selectedPaths:['wild[1].txt']});
 assert.deepEqual(Array.from(plan.argv),['add','--all','--',':(literal)wild[1].txt']);
 assert.throws(()=>createGitActionPlan('stage',{entries,selectedPaths:['../outside']}));
 assert.throws(()=>createGitActionPlan('stage',{entries,selectedPaths:['other.txt/child']}));
 assert.throws(()=>createGitActionPlan('stage',{entries:[{path:'conflict.txt',x:'U',y:'U'}],selectedPaths:['conflict.txt']}));
 assert.throws(()=>createGitActionPlan('stage',{entries:[{path:'partial.txt',x:'M',y:'M'}],selectedPaths:['partial.txt']}));
 assert.throws(()=>createGitActionPlan('stage',{entries:[{path:'staged.txt',x:'M',y:' '}],selectedPaths:['staged.txt']}));
});

test('暂存提案拒绝覆盖部分暂存，索引内容保持原样',()=>{
 const root=mkdtempSync(join(fileURLToPath(new URL('../.tmp-test/',import.meta.url)),'git-partial-stage-'));
 const git=(...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8'});
 git('init','-q','-b','main');git('config','user.name','SaCode Test');git('config','user.email','test@example.invalid');
 writeFileSync(join(root,'partial.txt'),'base one\nbase two\n');git('add','--','partial.txt');git('commit','-m','fixture');
 writeFileSync(join(root,'partial.txt'),'staged one\nbase two\n');git('add','--','partial.txt');
 writeFileSync(join(root,'partial.txt'),'staged one\nworktree two\n');
 const stagedBefore=git('show',':partial.txt');
 assert.throws(()=>createGitActionPlan('stage',{entries:[{path:'partial.txt',x:'M',y:'M'}],selectedPaths:['partial.txt']}),/可暂存/);
 assert.equal(git('show',':partial.txt'),stagedBefore);
 assert.equal(git('diff','--cached','--name-only'), 'partial.txt\n');
});

test('真实 Git 暂存只匹配选中的字面文件名，并保留其他未跟踪文件',()=>{
 const root=mkdtempSync(join(fileURLToPath(new URL('../.tmp-test/',import.meta.url)),'git-action-'));
 const git=(...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8'});
 git('init','-q','-b','main');
 writeFileSync(join(root,'wild[1].txt'),'chosen\n');
 writeFileSync(join(root,'wild1.txt'),'not chosen\n');
 const plan=createGitActionPlan('stage',{entries:[{path:'wild[1].txt',x:'?',y:'?'}],selectedPaths:['wild[1].txt']});
 execFileSync(plan.executable,plan.argv,{cwd:root});
 assert.equal(git('diff','--cached','--name-only','-z'),'wild[1].txt\0');
 assert.match(git('status','--porcelain'),/\?\? wild1\.txt/);
});

test('提交提案要求有索引内容、无冲突和非空说明，且只提交已暂存内容',()=>{
 assert.throws(()=>createGitActionPlan('commit',{stagedPaths:[],commitMessage:'x'}));
 assert.throws(()=>createGitActionPlan('commit',{stagedPaths:['a'],conflicts:['a'],commitMessage:'x'}));
 assert.throws(()=>createGitActionPlan('commit',{stagedPaths:['a'],commitMessage:'  '}));
 const plan=createGitActionPlan('commit',{stagedPaths:['a'],commitMessage:'  修复缺陷  '});
 assert.deepEqual(Array.from(plan.argv),['commit','-m','修复缺陷']);
 assert.ok(!plan.argv.includes('--amend'));
});

test('推送必须有安全可展示的已配置上游，不强推也不自动设置 upstream',()=>{
 assert.equal(inspectPushUpstream('main').available,false);
 assert.equal(inspectPushUpstream('HEAD (no branch)').available,false);
 assert.equal(inspectPushUpstream('main...https://user:token@example.invalid/repo').available,false);
 const inspected=inspectPushUpstream('main...origin/main [ahead 1]');
 assert.equal(inspected.available,true);
 assert.equal(inspected.upstream,'origin/main');
 const commit='a'.repeat(40),pushTarget={remote:'origin',ref:'refs/heads/main',commit};
 assert.throws(()=>createGitActionPlan('push',{branch:'main...origin/main [ahead 1]'}),/尚未从宿主核实/);
 const plan=createGitActionPlan('push',{branch:'main...origin/main [ahead 1]',pushTarget});
 assert.deepEqual(Array.from(plan.argv),['push','--porcelain','--no-follow-tags','--recurse-submodules=no','--','origin',commit+':refs/heads/main']);
 assert.ok(!plan.argv.some(arg=>/force|set-upstream/i.test(arg)));
 assert.ok(plan.summary.includes(commit));
 assert.ok(safeGitBranchLabel('main...https://user:token@example.invalid/repo').includes('https://•••@'));
});

test('推送目标解析只接受远端别名、heads ref 和完整提交 ID',()=>{
 const commit='b'.repeat(40);
 assert.equal(JSON.stringify(parseGitPushTarget('origin\nrefs/heads/release/next\n'+commit)),JSON.stringify({remote:'origin',ref:'refs/heads/release/next',commit}));
 for(const output of ['https://user:secret@example.invalid/repo\nrefs/heads/main\n'+commit,'origin\nrefs/tags/v1\n'+commit,'origin\nrefs/heads/main\nabc','origin\nrefs/heads/main\n'+commit+'\nextra'])assert.throws(()=>parseGitPushTarget(output));
});
