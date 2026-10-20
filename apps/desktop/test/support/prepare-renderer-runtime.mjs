// 准备完整页面诊断运行库；不安装、不覆盖 dist，不关闭沙箱。
// 用法：node 此文件 --runtime-dir=<已有Electron目录> --host-dir=<已有host目录> --output=<target/tmp下目录>
import {cpSync, mkdirSync, writeFileSync, existsSync,readFileSync} from 'node:fs';
import {resolve, join, dirname, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
const desktop=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const option=name=>process.argv.find(a=>a.startsWith('--'+name+'='))?.slice(name.length+3);
const runtime=option('runtime-dir'),host=option('host-dir'),out=option('output');
if(!runtime||!host||!out)throw Error('必须明确提供已有运行库、Host目录与输出目录');
const output=resolve(out);
if(!output.split(sep).some((part,i,parts)=>part==='tmp'&&parts[i-1]==='target'))throw Error('输出必须位于 target/tmp 下');
if(existsSync(output))throw Error('输出目录已存在，拒绝覆盖');
mkdirSync(output,{recursive:true});
cpSync(resolve(runtime),output,{recursive:true,filter:path=>{
  const name=path.replaceAll('\\','/');
  return !name.endsWith('/app.asar')&&!name.includes('/data/')&&!name.endsWith('/data')&&!name.endsWith('/TEMPORARY-NO-SANDBOX.txt')&&!name.endsWith('/start-sacode-no-sandbox.cmd');
}});
cpSync(resolve(host),join(output,'resources/host'),{recursive:true});
const appDir=join(output,'resources/app');mkdirSync(appDir,{recursive:true});
const imageFixture=option('image-fixture');let imageAttachmentId;
if(imageFixture){
  const fixture=resolve(imageFixture),verification=JSON.parse(readFileSync(join(fixture,'verification.json'),'utf8'));
  imageAttachmentId=verification.attachment?.attachmentId;if(!imageAttachmentId)throw Error('缺少实际图片夹具验证记录');
  mkdirSync(join(output,'sessions'),{recursive:true});
  cpSync(join(fixture,'session.log'),join(output,'sessions/session.log'));
  cpSync(join(fixture,'attachments'),join(output,'sessions/attachments'),{recursive:true});
}
writeFileSync(join(appDir,'package.json'),JSON.stringify({name:'sacode-runtime-diagnostic',version:'0.0.0',main:'main.cjs'}));
writeFileSync(join(appDir,'main.cjs'),'require('+JSON.stringify(join(desktop,'test/support/renderer-runtime-main.cjs'))+')('+JSON.stringify({desktop,output,imageAttachmentId,closeAfterChecks:process.argv.includes('--close-after-checks'),questionTest:process.argv.includes('--question-test')})+');');
console.log(JSON.stringify({output,source:desktop,host:resolve(host),runtime:resolve(runtime),entry:existsSync(join(output,'SaCode.exe'))?'SaCode.exe':'electron.exe'}));
