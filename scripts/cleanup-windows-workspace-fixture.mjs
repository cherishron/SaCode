// 仅供显式私有集成夹具：独立进程只删除固定名单的文件/空目录，不扫描、不改 ACL。
import {resolve,dirname,basename,join} from 'node:path';
import {lstatSync,realpathSync,unlinkSync} from 'node:fs';
const parent=realpathSync(process.env.SACODE_WINDOWS_SCOPE_PARENT||'');
const scope=resolve(process.argv[2]||'');
if(dirname(scope).toLowerCase()!==parent.toLowerCase()||!/^sacode-workspace-cj-[0-9-]+$/.test(basename(scope)))throw Error('Fixture cleanup scope rejected');
if(lstatSync(scope).isSymbolicLink()||realpathSync(scope).toLowerCase()!==scope.toLowerCase())throw Error('Fixture cleanup reparse rejected');
function safeParent(name){
 let current=scope;
 const parts=name.split('/');parts.pop();
 for(const part of parts){
  current=join(current,part);
  let stat;try{stat=lstatSync(current);}catch(e){if(e.code==='ENOENT')return false;throw e;}
  if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('Fixture ancestor rejected');
 }
 return true;
}
for(const name of ['input.txt','result.txt']){
 if(!safeParent(name))continue;
 const path=join(scope,name);
 let stat;try{stat=lstatSync(path);}catch(e){if(e.code==='ENOENT')continue;throw e;}
 if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1)throw Error('Unexpected fixture object');
 unlinkSync(path);
}
console.log('SACODE_WORKSPACE_FIXTURE_CLEANUP confirmed');
