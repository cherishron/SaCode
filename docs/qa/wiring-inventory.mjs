// 只读接线库存：文本引用仅为定位线索，不能作为运行闭环通过判据。
import {readFileSync,readdirSync,mkdirSync,writeFileSync} from 'node:fs';
import {dirname,resolve,join,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const read=p=>readFileSync(join(root,p),'utf8');
function files(dir,extensions){return readdirSync(join(root,dir),{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(dir+'/'+e.name,extensions):extensions.some(ext=>e.name.endsWith(ext))?[dir+'/'+e.name]:[]);}
const preload=read('apps/desktop/preload.cjs');
const renderer=files('apps/desktop/renderer',['.js','.ts']).filter(p=>!p.includes('/vendor/')).map(path=>({path,text:read(path)}));
const desktop=readdirSync(join(root,'apps/desktop')).filter(p=>p.endsWith('.cjs')).map(p=>({path:'apps/desktop/'+p,text:read('apps/desktop/'+p)}));
const actions=[];
for(const line of preload.split(/\r?\n/)){
 const match=line.match(/^\s*(\w+):.*?ipcRenderer\.invoke\(["'](sacode:[^"']+)["']/);if(!match)continue;
 const [,action,channel]=match;
 const references=renderer.filter(f=>new RegExp('\\b'+action+'\\b').test(f.text)).map(f=>f.path);
 const handlerCandidates=desktop.filter(f=>f.text.includes(channel)).map(f=>f.path);
 // LSP 使用有限 action 表动态注册，不能仅按 sacode: 字面量判断缺失。
 const dynamicHandlerCandidates=desktop.filter(f=>f.path.endsWith('lsp-ipc.cjs')&&f.text.includes("['"+action+"'")).map(f=>f.path);
 actions.push({action,channel,rendererReferences:references,handlerCandidates,dynamicHandlerCandidates,note:'仅文本定位，不证明已装配、授权或真实提供方可用'});
}
const result={date:'2026-10-13',sourceHead:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),scope:'当前工作区；未提交文件也可能出现在定位结果中',actions};
const out=join(root,'target/tmp','wiring-inventory-'+Date.now()+'.json');mkdirSync(dirname(out),{recursive:true});writeFileSync(out,JSON.stringify(result,null,2));
console.log(JSON.stringify({output:relative(root,out),actionCount:actions.length,noRendererTextReference:actions.filter(a=>a.rendererReferences.length===0).map(a=>a.action),noHandlerTextCandidate:actions.filter(a=>!a.handlerCandidates.length&&!a.dynamicHandlerCandidates.length).map(a=>a.action)}));
