// 仅测试自有私有目录的清理边界；创建固定外部哨兵，绝不递归清理。
import {resolve,dirname,basename,join} from 'node:path';
import {realpathSync,lstatSync,existsSync,mkdirSync,writeFileSync,readFileSync,linkSync,symlinkSync,rmdirSync,unlinkSync} from 'node:fs';
const parent=realpathSync(process.env.SACODE_WINDOWS_SCOPE_PARENT||''),scope=resolve(process.argv[3]||'');
if(dirname(scope).toLowerCase()!==parent.toLowerCase()||!/^sacode-workspace-cj-[0-9-]+$/.test(basename(scope))||realpathSync(scope).toLowerCase()!==scope.toLowerCase())throw Error('Disposal fixture scope rejected');
const canary=join(parent,'disposal-canary-'+basename(scope)),file=join(canary,'input.txt'),link=join(scope,'link'),hard=join(scope,'hard.txt');
const action=process.argv[2];
function verify(){if(lstatSync(canary).isSymbolicLink()||realpathSync(canary).toLowerCase()!==canary.toLowerCase()||lstatSync(file).isSymbolicLink()||readFileSync(file,'utf8')!=='DO_NOT_REMOVE')throw Error('Disposal canary changed');}
function removeJunction(){if(existsSync(link)){if(!lstatSync(link).isSymbolicLink()||realpathSync(link).toLowerCase()!==canary.toLowerCase())throw Error('Disposal junction changed');rmdirSync(link);}}
if(action==='junction'){mkdirSync(canary);writeFileSync(file,'DO_NOT_REMOVE',{flag:'wx'});symlinkSync(canary,link,'junction');}
else if(action==='remove-junction'){verify();removeJunction();}
else if(action==='hardlink'){verify();linkSync(file,hard);}
else if(action==='cleanup'){verify();removeJunction();if(existsSync(hard)){const a=lstatSync(hard),b=lstatSync(file);if(!a.isFile()||a.isSymbolicLink()||a.ino!==b.ino||a.dev!==b.dev)throw Error('Disposal hardlink changed');unlinkSync(hard);}unlinkSync(file);rmdirSync(canary);}
else throw Error('Disposal fixture action rejected');
console.log('SACODE_DISPOSAL_FIXTURE confirmed');
