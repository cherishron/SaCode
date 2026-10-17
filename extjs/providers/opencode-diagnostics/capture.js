import {readFileSync,lstatSync,realpathSync,writeFileSync,renameSync,unlinkSync,existsSync} from 'node:fs';
import {basename,dirname,join,resolve} from 'node:path';
import {tmpdir,userInfo} from 'node:os';
import {collectMetadata} from './metadata.js';

const equalPath=(a,b)=>process.platform==='win32'?a.toLowerCase()===b.toLowerCase():a===b;
function requestAt(path,now){
 if(basename(path)!=='request.json')throw Error('invalid-request');
 const info=lstatSync(path);if(!info.isFile()||info.isSymbolicLink()||info.size>4096)throw Error('invalid-request');
 const root=realpathSync(dirname(path));
 if(!/^sacode-acp-metadata-[0-9a-f]{32}$/.test(basename(root))||!equalPath(realpathSync(dirname(root)),realpathSync(tmpdir())))throw Error('invalid-request');
 const request=JSON.parse(readFileSync(path,'utf8'));
 if(request.version!==1||!/^acp-[0-9a-f]{32}$/.test(request.diagnosticId)||!/^[0-9a-f]{64}$/.test(request.nonce)||
  !Number.isSafeInteger(request.expiresAt)||request.expiresAt<=now||request.expiresAt>now+120000||
  typeof request.directory!=='string'||request.directory.length>4096||!equalPath(realpathSync(request.directory),request.directory))throw Error('invalid-request');
 return {root,request};
}
// 仅在显式临时请求存在时订阅；没有请求时连模型/插件注册表都不读取。
export function startCapture(ctx,environment=process.env){
 const path=environment.SACODE_ACP_METADATA_REQUEST;if(!path)return;
 let root,request;
 try{({root,request}=requestAt(resolve(path),Date.now()));if(ctx.app.version!=='2.0.28'||!equalPath(realpathSync(ctx.location.directory),request.directory))return;}catch{return;}
 const lock=join(root,'capture.lock');
 try{writeFileSync(lock,'owned',{flag:'wx',mode:0o600});}catch{return;}
 const controller=new AbortController();let closed=false,deadline;
 const publish=value=>{
  if(closed||Date.now()>=request.expiresAt||!equalPath(realpathSync(dirname(path)),root))return false;
  const encoded=JSON.stringify(value);if(Buffer.byteLength(encoded)>262144)return false;
  const pending=join(root,'snapshot.pending');
  try{writeFileSync(pending,encoded,{flag:'wx',mode:0o600});renameSync(pending,join(root,'snapshot.json'));return true;}
  finally{if(existsSync(pending))unlinkSync(pending);}
 };
 const cleanup=()=>{closed=true;clearTimeout(deadline);controller.abort();};
 deadline=setTimeout(cleanup,request.expiresAt-Date.now());deadline.unref?.();
 try{
  publish({version:1,phase:'waiting-session',diagnosticId:request.diagnosticId,nonce:request.nonce,directory:request.directory,providerPid:process.pid});
  void(async()=>{
   try{
    for await(const event of ctx.event.subscribe({signal:controller.signal})){
     if(closed||Date.now()>=request.expiresAt)break;
     if(event.type!=='session.created'||!event.data||typeof event.data.sessionID!=='string'||event.data.sessionID.length>256||/[\u0000-\u001f\u007f]/.test(event.data.sessionID)||
       !event.data.location?.directory||!equalPath(realpathSync(event.data.location.directory),request.directory))continue;
     let osUser='unknown';try{osUser=userInfo().username;}catch{}
     const value=await collectMetadata(ctx,{...request,sessionId:event.data.sessionID},{pid:process.pid,osUser,now:Date.now,signal:controller.signal});
     publish(value);break;
    }
   }catch{}finally{cleanup();}
  })();
 }catch{cleanup();}
 return cleanup;
}
