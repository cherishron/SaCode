"use strict";
// 固定候选的手工验收客户端：复用真实 HostBridge，不提供任务、修复、登录或安装入口。
const {readFileSync,existsSync,mkdirSync,mkdtempSync,realpathSync,statSync}=require('node:fs');
const {resolve,join,sep,isAbsolute}=require('node:path');
const {createHash}=require('node:crypto');
const {HostBridge}=require('../../apps/desktop/host-bridge.cjs');
const defaultRoot=resolve(__dirname,'../..');
function verifyPackage(root){
 const manifest=JSON.parse(readFileSync(join(root,'acp-verification-manifest.json'),'utf8'));
 if(manifest.version!==1||manifest.purpose!=='acp-protocol-only'||!/^[a-f0-9]{40}$/.test(manifest.sourceCommit)||!Array.isArray(manifest.files)||!manifest.files.length)throw Error('verification-manifest-invalid');
 const resolved=realpathSync(root),seen=new Set();
 for(const file of manifest.files){
  if(!file||typeof file.path!=='string'||isAbsolute(file.path)||file.path.split(/[\\/]/).includes('..')||seen.has(file.path)||!/^[a-f0-9]{64}$/.test(file.sha256))throw Error('verification-manifest-invalid');
  seen.add(file.path);const path=realpathSync(resolve(resolved,file.path));
  if(!path.startsWith(resolved+sep)||!statSync(path).isFile()||createHash('sha256').update(readFileSync(path)).digest('hex')!==file.sha256)throw Error('verification-payload-mismatch');
 }
 for(const file of ['runtime/sacode-host.exe','runtime/sacode.exe','apps/desktop/host-bridge.cjs','apps/desktop/paths.cjs','docs/qa/acp-normal-context-check.cjs'])if(!seen.has(file))throw Error('verification-manifest-incomplete');
 return manifest;
}
async function runNormalContextCheck({root=defaultRoot,workspace=root,environment=process.env,signal}={}){
 if(process.platform!=='win32')throw Error('verification-windows-only');
 if(signal?.aborted)throw Error('verification-cancelled');
 root=realpathSync(root);workspace=realpathSync(workspace);if(!statSync(workspace).isDirectory())throw Error('workspace-not-directory');
 const manifest=verifyPackage(root);
 const parent=join(root,'verification-data');mkdirSync(parent,{recursive:true});const session=mkdtempSync(join(parent,'session-'));
 const bridge=new HostBridge(join(root,'runtime/sacode-host.exe'),{...environment,SACODE_USER_SETTINGS_DIR:join(session,'settings')});
 const cancel=()=>{void bridge.stop(10000);};signal?.addEventListener('abort',cancel,{once:true});
 try{
  if(signal?.aborted)throw Error('verification-cancelled');
  await bridge.start(session);
  if(signal?.aborted)throw Error('verification-cancelled');
  await bridge.request('workspace/set-directory',{sessionId:'current',directory:workspace});
  await bridge.request('acp/settings/set-enabled',{sessionId:'current',enabled:true,revision:0});
  const report=await bridge.request('acp/provider/probe',{sessionId:'current'},30000);
  if(report?.peerId!=='opencode'||typeof report.protocolReady!=='boolean'||report.modelTaskTested!==false||report.diagnostics?.workspace!==workspace)throw Error('verification-reply-invalid');
  return{sourceCommit:manifest.sourceCommit,scope:'protocol-only',sessionDirectory:session,...report};
 }finally{signal?.removeEventListener('abort',cancel);const stopped=await bridge.stop(10000);if(stopped.forced)throw Error('verification-host-stop-unconfirmed');}
}
async function main(args=process.argv.slice(2)){
 if(args.length>1||args[0]==='--help'){
  console.log('用法：node check-acp.cjs [项目目录]。仅初始化与建会话，不发送模型任务；新建独立验收会话。');process.exitCode=args[0]==='--help'?0:64;return;
 }
 const controller=new AbortController(),cancel=()=>controller.abort();process.once('SIGINT',cancel);
 try{const report=await runNormalContextCheck({workspace:args[0]?resolve(args[0]):defaultRoot,signal:controller.signal});console.log(JSON.stringify(report,null,2));process.exitCode=report.protocolReady?0:2;}
 catch(error){console.error(controller.signal.aborted?'verification-cancelled':String(error.message));process.exitCode=controller.signal.aborted?130:1;}
 finally{process.removeListener('SIGINT',cancel);}
}
module.exports={verifyPackage,runNormalContextCheck,main};
if(require.main===module)void main();
