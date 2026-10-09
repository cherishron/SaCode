// 使用刚构建的共享 core 静态库，验证真实审批与工具结果；没有桌面 Shell 入口。
import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync,readdirSync} from 'node:fs';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
if(process.platform!=='win32')throw Error('该管线探针只验证当前 Windows cmd 提供方');
const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const root=join(repo,'apps/desktop/.tmp-test','shell-pipeline-'+Date.now(),"quoted 中文' path");mkdirSync(root,{recursive:true});
const core=resolve(process.env.SACODE_CORE_PROBE_TARGET||join(repo,'apps/desktop/.tmp-test/shell-host/release/core'));
const toml=readFileSync(join(repo,'apps/host/cjpm.toml'),'utf8');const stdx=toml.match(/path-option\s*=\s*\[\s*"([^"]+)"/)?.[1];if(!stdx)throw Error('未找到 Host 的实际 stdx 依赖目录');
const source=join(repo,'core/test-support/shell-pipeline-probe.cj');
const args=['-O0','--import-path',core,'--import-path',stdx,'-L',core,'-L',stdx,'-lcore',...readdirSync(stdx).filter(n=>n.endsWith('.dll')).sort().map(n=>'-l:'+n),source,'-o',join(root,'probe.exe')];
const env={...process.env,TEMP:root,TMP:root,PATH:[stdx,join(repo,'apps/desktop/dist/host/bin'),process.env.Path||process.env.PATH].join(';')};
for(const key of Object.keys(env))if(key.toLowerCase()==='path'&&key!=='PATH')delete env[key];
const build=spawnSync('cjc',args,{cwd:repo,env,encoding:'utf8',windowsHide:true,timeout:60000});
writeFileSync(join(root,'build.log'),(build.stdout||'')+(build.stderr||'')+(build.error?.message||''));writeFileSync(join(root,'build-exit.txt'),String(build.status));
if(build.status!==0){console.error('构建失败：'+root);process.exit(1);}
writeFileSync(join(root,'invalid.cjs'),'process.stdout.write(Buffer.from([255]));');writeFileSync(join(root,'large.cjs'),"process.stdout.write('x'.repeat(80000));");writeFileSync(join(root,'failed.cjs'),"process.stderr.write('failure');process.exitCode=42;");
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
writeFileSync(join(root,'baseline.json'),JSON.stringify({state:'working-tree',sourceSha:spawnSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).stdout.trim(),coreLibrary:core,coreSha256:hash(join(core,'libcore.a')),agentSha256:hash(join(repo,'core/src/agent.cj')),executorSha256:hash(join(repo,'core/src/shlex.cj')),probeSourceSha256:hash(source),command:['cjc',...args]},null,2));
const run=spawnSync(join(root,'probe.exe'),[process.execPath,join(root,'session.log'),root],{cwd:root,env,encoding:'utf8',windowsHide:true,timeout:20000});
writeFileSync(join(root,'run.log'),(run.stdout||'')+(run.stderr||'')+(run.error?.message||''));writeFileSync(join(root,'run-exit.txt'),String(run.status));console.log(run.stdout);console.log('SHELL_PIPELINE_EVIDENCE='+root);
process.exitCode=run.status===0&&run.stdout.includes('SHELL_PIPELINE_PROBE_PASS 4')?0:1;
