// 仅新建的独占目录会获得 profile ACE；不修改现有目录或用户配置。
import {execFileSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,copyFileSync,writeFileSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const destination=process.env.SACODE_NATIVE_VERIFY_DIR;
if(process.platform!=='win32'||!destination)throw Error('Requires Windows and explicit SACODE_NATIVE_VERIFY_DIR');
const base=join(root,'target/tmp');mkdirSync(base,{recursive:true});
const day=new Date().toISOString().slice(0,10).replaceAll('-','');
const run=mkdtempSync(join(base,`windows-workspace-verify-${day}-`));
const payload=join(run,'payload');mkdirSync(payload);
const compiler=process.env.SACODE_WINDOWS_CC||'clang';
const native=join(root,'.deps/native/win32-x64');
execFileSync(process.execPath,[join(root,'scripts/build-windows-process.mjs')],{stdio:'inherit',windowsHide:true});
copyFileSync(join(native,'sacode-windows-process.dll'),join(payload,'sacode-windows-process.dll'));
execFileSync(compiler,['-std=c11','-O2','-Wall','-Wextra','-Werror','-fms-runtime-lib=static',join(root,'scripts/verify-windows-workspace.c'),join(native,'sacode-windows-process.lib'),'-o',join(payload,'workspace-verify.exe'),'-luserenv','-ladvapi32'],{stdio:'inherit',windowsHide:true});
const neutral=join(resolve(destination),run.split(/[\\/]/).at(-1));
execFileSync(process.execPath,[join(root,'scripts/export-windows-artifact.mjs'),payload,neutral],{stdio:'inherit',windowsHide:true});
let code=0,out='',err='';
try{out=execFileSync(join(neutral,'workspace-verify.exe'),[],{encoding:'utf8',windowsHide:true,timeout:30000});}
catch(e){code=e.status??-1;out=String(e.stdout||'');err=String(e.stderr||e.message);}
for(const [name,text]of [['stdout.log',out],['stderr.log',err],['exit.txt',String(code)]])writeFileSync(join(run,name),text);
console.log(out);console.log('EVIDENCE='+run);
const summary=out.match(/^SACODE_WORKSPACE_SUMMARY checks=(\d+) failed=0 cleanup=confirmed\r?$/m);
if(code||!summary||Number(summary[1])!==47)throw Error('Workspace verification failed: '+code+' '+err);
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
writeFileSync(join(run,'verification.json'),JSON.stringify({version:1,checks:Number(summary[1]),exitCode:code,neutral,
 dllSha256:hash(join(payload,'sacode-windows-process.dll')),sourceSha256:hash(join(root,'core/native/windows_workspace.c')),
 headerSha256:hash(join(root,'core/native/windows_workspace.h')),testSha256:hash(join(root,'scripts/verify-windows-workspace.c'))},null,2));
