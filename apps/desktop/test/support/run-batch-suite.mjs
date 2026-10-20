// 受控桌面测试清单：逐文件保留完整日志、退出事实与未执行原因，不把局部门禁计为全套通过。
import {readdirSync,readFileSync,mkdirSync,writeFileSync,createWriteStream} from 'node:fs';
import {dirname,join,resolve,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
const desktop=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const repo=resolve(desktop,'../..');
const option=name=>process.argv.find(arg=>arg.startsWith('--'+name+'='))?.slice(name.length+3);
export function tapCounts(text){
  const complete=footer(text,'tests')!==null;
  if(complete)return{footerComplete:true,tests:footer(text,'tests'),pass:footer(text,'pass'),fail:footer(text,'fail'),cancelled:footer(text,'cancelled'),skipped:footer(text,'skipped')};
  // 文件超时或退出前可能已经交回用例结果；不能因缺少汇总尾部而将这些失败计为零。
  const rows=text.split(/\r?\n/).filter(line=>/^(?:not )?ok \d+ - /.test(line));
  return{footerComplete:false,tests:rows.length,pass:rows.filter(line=>/^ok /.test(line)&&!/# SKIP\b/i.test(line)).length,fail:rows.filter(line=>/^not ok /.test(line)).length,cancelled:0,skipped:rows.filter(line=>/# SKIP\b/i.test(line)).length};
}
function walk(dir){return readdirSync(dir,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?walk(join(dir,entry.name)):/\.test\.(mjs|cjs|js)$/.test(entry.name)?[join(dir,entry.name)]:[]);}
export function unsafeLines(source){return source.split(/\r?\n/).flatMap((line,i)=>{
  // 不能因一行含断言而忽略其他语句；压缩测试可能在同一行先启动进程再断言。
  if(/^\s*(\/\/|\*)/.test(line))return[];
  return /['"]--(?:no-sandbox|disable-gpu-sandbox)['"]|sandbox\s*:\s*false|appendSwitch\(['"](?:no-sandbox|disable-gpu-sandbox)/.test(line)?[{line:i+1,reason:'sandbox-bypass-in-test'}]:[];
});}
function footer(text,name){const found=[...text.matchAll(new RegExp('^# '+name+' (\\d+)\\s*$','gm'))];return found.length?Number(found.at(-1)[1]):null;}
function failures(text){
  const lines=text.split(/\r?\n/),items=[];
  for(let i=0;i<lines.length;i++)if(/^\s*not ok \d+ - /.test(lines[i])){
    let end=i+1;while(end<lines.length&&!/^\s*\.\.\./.test(lines[end])&&!/^\s*(?:not )?ok \d+ - /.test(lines[end]))end++;
    const detail=lines.slice(i,Math.min(end+1,i+100)).join('\n');
    const category=/ERR_MODULE_NOT_FOUND|MODULE_NOT_FOUND|Cannot find (?:module|package)/.test(detail)?'module-resolution':/host-gone|host-exited|Host exited/.test(detail)?'host-exit-observed':/already-owned|session-owner-unknown/.test(detail)?'lease-observed':/timed? ?out|timeout/i.test(detail)?'timeout-observed':'assertion-or-unclassified';
    items.push({name:lines[i].replace(/^\s*not ok \d+ - /,''),category,detail});
  }
  return items;
}
export async function runSuite({output,host,concurrency=2,files:selection,desktopRoot}){
  const desktop=desktopRoot?resolve(desktopRoot):resolve(dirname(fileURLToPath(import.meta.url)),'../..');
  const repo=resolve(desktop,'../..');
  const out=resolve(output);
  if(!out.replaceAll('\\','/').includes('/target/tmp/'))throw Error('输出必须位于target/tmp');
  mkdirSync(out,{recursive:true});
  const digest=value=>createHash('sha256').update(value).digest('hex');
  const files=walk(join(desktop,'test')).filter(file=>!selection||selection.includes(relative(desktop,file).replaceAll('\\','/'))).sort(),manifest=files.map((file,index)=>{
    const source=readFileSync(file,'utf8');return{index,file:relative(repo,file).replaceAll('\\','/'),sourceSha256:digest(source),unsafe:unsafeLines(source)};
  });
  writeFileSync(join(out,'manifest.json'),JSON.stringify({created:new Date().toISOString(),host,desktop,concurrency,driverSha256:digest(readFileSync(fileURLToPath(import.meta.url))),cli:process.env.SACODE_CLI,openssl:process.env.SACODE_OPENSSL,files:manifest},null,2));
  const results=[];let cursor=0;
  const save=()=>writeFileSync(join(out,'results.json'),JSON.stringify({updated:new Date().toISOString(),discovered:manifest.length,completed:results.length,results:[...results].sort((a,b)=>a.index-b.index)},null,2));
  async function run(item){
    if(item.unsafe.length){const result={...item,status:'not-run-sandbox-bypass'};results.push(result);save();return;}
    const id=String(item.index).padStart(3,'0'),dir=join(out,id);mkdirSync(dir,{recursive:true});mkdirSync(join(dir,'temp'),{recursive:true});
    const env={...process.env};for(const key of Object.keys(env))if(/(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)/i.test(key))delete env[key];
    Object.assign(env,{SACODE_RUN_REAL_PROVIDER_TESTS:'0',SACODE_WINDOWS_ENFORCING:'0',SACODE_HOST:host,SACODE_USER_SETTINGS_DIR:join(dir,'settings'),SACODE_TEST_TMP:join(dir,'temp'),SACODE_TEST_ROOT:join(dir,'temp'),TEMP:join(dir,'temp'),TMP:join(dir,'temp')});
    for(const key of ['ELECTRON_RUN_AS_NODE','NODE_OPTIONS','NODE_REPL_EXTERNAL_MODULE'])delete env[key];
    const logPath=join(dir,'test.log'),log=createWriteStream(logPath),started=Date.now();
    const child=spawn(process.execPath,['--test','--test-concurrency=1',resolve(repo,item.file)],{cwd:desktop,env,stdio:['ignore','pipe','pipe'],windowsHide:true});
    child.stdout.pipe(log,{end:false});child.stderr.pipe(log,{end:false});let timedOut=false,error='';
    const timer=setTimeout(()=>{
      if(child.exitCode!==null)return;timedOut=true;
      if(process.platform==='win32')spawn('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});
      else child.kill('SIGTERM');
    },120000);timer.unref();
    const exit=await new Promise(resolveExit=>{child.once('error',e=>{error=String(e);resolveExit({code:null,signal:null});});child.once('close',(code,signal)=>resolveExit({code,signal}));});
    clearTimeout(timer);await new Promise(r=>log.end(r));const text=readFileSync(logPath,'utf8');
    const result={index:item.index,file:item.file,pid:child.pid,status:timedOut?'file-timeout':exit.code===0?'passed':'failed',...exit,error,elapsedMs:Date.now()-started,log:relative(out,logPath).replaceAll('\\','/'),counts:tapCounts(text),failures:failures(text)};
    results.push(result);save();process.stdout.write(JSON.stringify({completed:results.length,total:manifest.length,file:item.file,status:result.status,counts:result.counts})+'\n');
  }
  await Promise.all(Array.from({length:concurrency},async()=>{while(cursor<manifest.length){const item=manifest[cursor++];await run(item);}}));
  const summary={discovered:manifest.length,filesPassed:results.filter(r=>r.status==='passed').length,filesFailed:results.filter(r=>r.status==='failed'||r.status==='file-timeout').length,filesWithoutCompleteFooter:results.filter(r=>r.counts&&!r.counts.footerComplete).map(r=>r.file),notRun:results.filter(r=>r.status.startsWith('not-run')).length,counts:{}};
  for(const name of ['tests','pass','fail','cancelled','skipped'])summary.counts[name]=results.reduce((sum,r)=>sum+(r.counts?.[name]||0),0);
  writeFileSync(join(out,'summary.json'),JSON.stringify(summary,null,2));return summary;
}
if(process.argv.includes('--run-suite')){
  const output=option('output'),host=option('host');if(!output||!host)throw Error('必须提供--output与--host');
  const result=await runSuite({output,host,concurrency:Number(option('concurrency')||2),files:option('files')?.split(','),desktopRoot:option('desktop-root')});process.stdout.write(JSON.stringify(result)+'\n');
}
