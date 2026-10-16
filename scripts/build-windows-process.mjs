// Optional Windows OS mechanism; does not open a product execution gate.
import {execFileSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,writeFileSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
if(process.platform!=='win32'||process.arch!=='x64')throw Error('Windows process thin layer requires a native Windows x64 compiler');
const out=join(root,'.deps/native/win32-x64');mkdirSync(out,{recursive:true});
const compiler=process.env.SACODE_WINDOWS_CC||'clang';
const dll=join(out,'sacode-windows-process.dll');
const args=['-std=c11','-O2','-Wall','-Wextra','-Werror','-fms-runtime-lib=static','-shared',join(root,'core/native/windows_process.c'),'-o',dll,'-ladvapi32'];
execFileSync(compiler,args,{stdio:'inherit',windowsHide:true});
const sha256=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
const manifest={version:1,target:'win32-x64',compiler:execFileSync(compiler,['--version'],{encoding:'utf8',windowsHide:true}).trim(),
 sourceSha256:sha256(join(root,'core/native/windows_process.c')),headerSha256:sha256(join(root,'core/native/windows_process.h')),dllSha256:sha256(dll)};
writeFileSync(join(out,'build-manifest.json'),JSON.stringify(manifest,null,2));
console.log('Windows process thin layer: '+dll);
if(process.argv.includes('--verify')){
 const destination=process.env.SACODE_NATIVE_VERIFY_DIR;
 if(!destination)throw Error('--verify requires explicit SACODE_NATIVE_VERIFY_DIR outside the workspace; no ACL/label edits are performed');
 const base=join(root,'target/tmp');mkdirSync(base,{recursive:true});
 const now=new Date(),day=[now.getFullYear(),String(now.getMonth()+1).padStart(2,'0'),String(now.getDate()).padStart(2,'0')].join('');
 const run=mkdtempSync(join(base,`windows-process-verify-${day}-`));
 writeFileSync(join(run,'build-manifest.json'),JSON.stringify(manifest,null,2));
 const payload=join(run,'payload');mkdirSync(payload);
 // A normal file copy within the build workspace is enough; neutral export below recreates bytes.
 const {copyFileSync}=await import('node:fs');copyFileSync(dll,join(payload,'sacode-windows-process.dll'));
 execFileSync(compiler,['-std=c11','-O2','-Wall','-Wextra','-Werror','-fms-runtime-lib=static',join(root,'scripts/verify-windows-process.c'),join(out,'sacode-windows-process.lib'),'-o',join(payload,'verify.exe'),'-luserenv','-ladvapi32'],{stdio:'inherit',windowsHide:true});
 const neutral=join(resolve(destination),run.split(/[\\/]/).at(-1));
 execFileSync(process.execPath,[join(root,'scripts/export-windows-artifact.mjs'),payload,neutral],{stdio:'inherit',windowsHide:true});
 let code=0,stdout='',stderr='';
 try{stdout=execFileSync(join(neutral,'verify.exe'),[],{encoding:'utf8',windowsHide:true,timeout:20000});}
 catch(error){code=error.status??-1;stdout=String(error.stdout||'');stderr=String(error.stderr||error.message);}
 writeFileSync(join(run,'stdout.log'),stdout);writeFileSync(join(run,'stderr.log'),stderr);
 writeFileSync(join(run,'exit.txt'),String(code));
 console.log(stdout);console.log('Verification evidence: '+run);
 if(code!==0)throw Error('Windows process verification failed: '+code+' '+stderr);
 const summary=stdout.match(/^SACODE_NATIVE_PROCESS_SUMMARY checks=(\d+) failed=0 cleanup=confirmed\r?$/m);
 if(!summary||Number(summary[1])!==35)throw Error('Missing or unexpected Windows process verification summary');
 writeFileSync(join(run,'verification.json'),JSON.stringify({version:1,checks:Number(summary[1]),failed:0,cleanup:'confirmed',exitCode:code,
   verifySha256:sha256(join(payload,'verify.exe')),dllSha256:manifest.dllSha256,neutral},null,2));
}
