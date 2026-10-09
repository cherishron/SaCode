// 直接编译仓库执行器与无副作用探针；不是模拟 Shell provider 或完整核心回归。
import {spawnSync,spawn} from 'node:child_process';
import {mkdirSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
if(process.platform!=='win32')throw Error('此探针只验证 Windows；其他平台需独立进程与清理探针');
const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const root=join(repo,'apps/desktop/.tmp-test','shell-execution-'+Date.now());mkdirSync(root,{recursive:true});
const sources=['core/src/shlex.cj','core/src/sandbox.cj','core/test-support/shell-execution-probe.cj'].map(p=>join(repo,p));
const env={...process.env,TEMP:root,TMP:root};const exe=join(root,'probe.exe');
const built=spawnSync('cjc',['-O0',...sources,'-o',exe],{cwd:repo,env,encoding:'utf8',windowsHide:true,timeout:60000});
writeFileSync(join(root,'build.log'),(built.stdout||'')+(built.stderr||'')+(built.error?.message||''));writeFileSync(join(root,'build-exit.txt'),String(built.status));
if(built.status!==0){console.error('构建失败：'+root);process.exit(1);}
const hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
writeFileSync(join(root,'baseline.json'),JSON.stringify({sourceSha:spawnSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).stdout.trim(),state:'working-tree',sources:Object.fromEntries(sources.map(p=>[p,hash(p)])),probeSha256:hash(exe),command:['cjc','-O0',...sources,'-o',exe],node:process.execPath},null,2));
const child=spawn(exe,[process.execPath],{cwd:root,env,windowsHide:true});let output='',error='',watchdog=false;const start=Date.now();
const timer=setTimeout(()=>{watchdog=true;spawnSync('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true});},20000);
child.stdout.on('data',data=>output+=data);child.stderr.on('data',data=>error+=data);
child.on('error',e=>{clearTimeout(timer);console.error(e);process.exitCode=1;});
child.on('close',async code=>{
  clearTimeout(timer);writeFileSync(join(root,'run.log'),output+error);writeFileSync(join(root,'result.json'),JSON.stringify({exitCode:code,watchdog,elapsedMs:Date.now()-start},null,2));console.log(output);
  if(code!==0||watchdog||!output.includes('SHELL_EXECUTION_PROBE_PASS 12')){process.exitCode=1;console.log('SHELL_EXECUTION_EVIDENCE='+root);return;}
  const pidFile=join(root,'tree-pids.json');const tree=spawn(exe,[process.execPath,'tree',pidFile],{cwd:root,env,windowsHide:true});let treeLog='';tree.stdout.on('data',d=>treeLog+=d);tree.stderr.on('data',d=>treeLog+=d);
  const ended=new Promise(resolve=>tree.on('close',resolve));const alive=pid=>{try{process.kill(pid,0);return true;}catch{return false;}};
  let ids;const treeTimer=setTimeout(()=>{spawnSync('taskkill',['/PID',String(tree.pid),'/T','/F'],{windowsHide:true});if(ids?.child&&alive(ids.child))spawnSync('taskkill',['/PID',String(ids.child),'/T','/F'],{windowsHide:true});},10000);
  try{
    for(let i=0;i<12&&!existsSync(pidFile);i++)await new Promise(r=>setTimeout(r,100));
    ids=JSON.parse(readFileSync(pidFile,'utf8'));if(!Number.isSafeInteger(ids.parent)||!Number.isSafeInteger(ids.child)||ids.parent<=0||ids.child<=0)throw Error('本夹具 PID 无效');
    await new Promise(r=>setTimeout(r,900));const observation={rootAlive:alive(ids.parent),childAlive:alive(ids.child),parentPid:ids.parent,childPid:ids.child};
    writeFileSync(join(root,'tree-observation.json'),JSON.stringify(observation,null,2));
    if(alive(ids.child))spawnSync('taskkill',['/PID',String(ids.child),'/T','/F'],{windowsHide:true});
    const treeCode=await ended;writeFileSync(join(root,'tree.log'),treeLog);writeFileSync(join(root,'tree-exit.txt'),String(treeCode));
    if(observation.rootAlive||observation.childAlive||treeCode!==0)throw Error('当前环境父子进程终止未通过；产品停止入口继续阻塞');
    console.log('TREE_PROBE_PASS：当前环境根进程及此直接子进程均已终止；不扩展为其他平台或脱离子树保证。');
  }catch(e){console.error(e);writeFileSync(join(root,'tree-error.txt'),String(e));process.exitCode=1;}
  finally{clearTimeout(treeTimer);if(ids?.child&&alive(ids.child))spawnSync('taskkill',['/PID',String(ids.child),'/T','/F'],{windowsHide:true});console.log('SHELL_EXECUTION_EVIDENCE='+root);}
});
