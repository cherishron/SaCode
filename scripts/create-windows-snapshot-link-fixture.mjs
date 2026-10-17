// 仅测试：在本轮 TEMP 下的自有 source 中建立/移除固定链接，不扫描或递归清理。
import {resolve,dirname,basename,join} from 'node:path';
import {realpathSync,lstatSync,linkSync,symlinkSync,rmdirSync} from 'node:fs';
const root=resolve(process.argv[3]||'');
const parent=realpathSync(process.env.TEMP||'');
if(dirname(root).toLowerCase()!==parent.toLowerCase()||!/^snapshot-source-[0-9-]+$/.test(basename(root))||realpathSync(root).toLowerCase()!==root.toLowerCase())throw Error('Source fixture scope rejected');
const action=process.argv[2];
if(action==='hardlink')linkSync(join(root,'input.txt'),join(root,'hard.txt'));
else if(action==='junction')symlinkSync(root,join(root,'link'),'junction');
else if(action==='remove-junction'){
 const path=join(root,'link');
 if(!lstatSync(path).isSymbolicLink()||realpathSync(path).toLowerCase()!==root.toLowerCase())throw Error('Fixture link mismatch');
 rmdirSync(path);
}else throw Error('Unsupported fixture action');
console.log('SACODE_SNAPSHOT_LINK_FIXTURE confirmed');
