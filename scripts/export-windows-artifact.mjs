import {readFileSync,writeFileSync,mkdirSync,existsSync,realpathSync} from 'node:fs';
import {resolve,dirname,basename,relative,isAbsolute,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';

// Export bytes into ordinary delivery storage, without inheriting the build
// workspace's security metadata. No installation, elevation or ACL mutation.
const [sourceArg,destinationArg]=process.argv.slice(2);
if(process.platform!=='win32'||!sourceArg||!destinationArg) throw new Error('usage: node scripts/export-windows-artifact.mjs <source> <new destination file>');
const source=realpathSync(resolve(sourceArg)),destination=resolve(destinationArg);
if(existsSync(destination)) throw new Error('destination exists; refusing overwrite');
mkdirSync(dirname(destination),{recursive:true});
const repo=realpathSync(resolve(dirname(fileURLToPath(import.meta.url)),'..'));
const parent=realpathSync(dirname(destination)),rel=relative(repo,parent);
if(!rel||(!isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('..\\'))) throw new Error('delivery must be outside the build workspace');
const helper=readFileSync(new URL('./windows-file-integrity.cs',import.meta.url),'utf8');
function label(path) {
    const command='$request=[Console]::In.ReadToEnd() | ConvertFrom-Json; Add-Type -TypeDefinition $request.code; [SaCodeDeliverySecurity]::ReadLabel($request.path)';
    const run=spawnSync(join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoProfile','-NonInteractive','-Command',command],{input:JSON.stringify({code:helper,path}),encoding:'utf8',windowsHide:true});
    if(run.error||run.status!==0) throw run.error||new Error('cannot query integrity: '+run.stderr);
    return run.stdout.trim();
}
const parentLabel=label(parent);
if(parentLabel!=='implicit-medium'&&parentLabel!=='S-1-16-8192') throw new Error('delivery directory must have ordinary medium integrity: '+parentLabel);
const bytes=readFileSync(source),hash=b=>createHash('sha256').update(b).digest('hex');
writeFileSync(destination,bytes,{flag:'wx'});
const destinationLabel=label(destination),sha256=hash(bytes);
if(hash(readFileSync(destination))!==sha256) throw new Error('export hash mismatch');
if(destinationLabel!=='implicit-medium'&&destinationLabel!=='S-1-16-8192') throw new Error('export integrity mismatch: '+destinationLabel);
const manifest={source,destination,sourceLabel:label(source),parentLabel,destinationLabel,sha256,bytes:bytes.length,createdAt:new Date().toISOString(),scope:'Content-only export, no installation or security policy changes'};
writeFileSync(destination+'.manifest.json',JSON.stringify(manifest,null,2),{flag:'wx'});
console.log(JSON.stringify(manifest));
