import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const context={};vm.runInNewContext(readFileSync(new URL('../renderer/attachment-state.js',import.meta.url),'utf8'),context);
function fixture({exists=true,accept=true,listFiles,submit}={}){
  let text='请检查\n工作区文件：src/foo.ts',identity=0;const sends=[],prompts=[],errors=[];
  const send=context.SaCodeAttachmentState.createReferenceSendGuard({getText:()=>text,getIdentity:()=>identity,
    listFiles:listFiles|| (async path=>({files:path===''?[{name:'src',isDir:true}]:exists?[{name:'foo.ts',isDir:false}]:[]})),
    confirm:async paths=>{prompts.push(Array.from(paths));return accept;},
    submit:submit|| (async(...args)=>{sends.push({text,args});text='';}),replaceText:value=>{text=value;identity++;},error:message=>errors.push(message)});
  return{send,sends,prompts,errors,getText:()=>text,setText:value=>{text=value;identity++;}};
}
test('存在的引用正常发送，不弹确认且参数透传',async()=>{const f=fixture();await f.send('send',true);assert.equal(f.prompts.length,0);assert.equal(f.sends[0].text,'请检查\n工作区文件：src/foo.ts');assert.deepEqual(f.sends[0].args,['send',true]);});
test('删除引用出现确认，确认后发送不包含失效引用',async()=>{const f=fixture({exists:false});await f.send();assert.deepEqual(f.prompts,[['src/foo.ts']]);assert.equal(f.sends[0].text,'请检查');});
test('取消不发送，草稿完整保留',async()=>{const f=fixture({exists:false,accept:false});await f.send();assert.equal(f.sends.length,0);assert.equal(f.getText(),'请检查\n工作区文件：src/foo.ts');});
test('整个父目录删除也识别为失效，不把未知读取错误冒充删除',async()=>{const absent=fixture({listFiles:async()=>({files:[]})});await absent.send();assert.deepEqual(absent.prompts,[['src/foo.ts']]);const error=fixture({listFiles:async()=>{throw Error('unavailable');}});await error.send();assert.equal(error.sends.length,0);assert.equal(error.prompts.length,0);assert.match(error.errors[0],/无法检查/);});
test('检查期间草稿变化拒绝迟到发送',async()=>{let resolve;const f=fixture({listFiles:()=>new Promise(r=>resolve=r)});const sending=f.send();f.setText('新的草稿');resolve({files:[]});await sending;assert.equal(f.sends.length,0);assert.equal(f.getText(),'新的草稿');});
test('纯失效引用不发送空消息，底层拒绝保留原草稿',async()=>{const empty=fixture({exists:false});empty.setText('工作区文件：src/foo.ts');await empty.send();assert.equal(empty.sends.length,0);assert.match(empty.errors[0],/消息为空/);const rejected=fixture({exists:false,submit:async()=>{}});await rejected.send();assert.equal(rejected.getText(),'请检查\n工作区文件：src/foo.ts');});
test('同一检查期间重复发送不会重复提交',async()=>{let resolve;const f=fixture({listFiles:()=>new Promise(r=>resolve=r)});const pending=f.send();await f.send();resolve({files:[]});await pending;assert.equal(f.sends.length,1);assert.match(f.errors[0],/正在检查/);});
test('部分错误列表和200项截断不误判文件删除',async()=>{
  for(const view of [{files:[],error:'io-error'},{files:[],configured:false},{files:Array.from({length:200},(_,i)=>({name:'other'+i,isDir:false}))}]){
    const f=fixture({listFiles:async()=>view});await f.send();assert.equal(f.sends.length,0);assert.equal(f.prompts.length,0);assert.match(f.errors[0],/无法检查/);
  }
});
test('工具引用与普通正文不误判为文件引用',()=>{assert.deepEqual(Array.from(context.SaCodeAttachmentState.workspaceReferences('普通 src/foo.ts\n工作区文件：@read\n工作区文件：src/foo.ts\n工作区文件：src/foo.ts')),['src/foo.ts']);});
