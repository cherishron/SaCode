import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtempSync,readdirSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const {recordFrameTimeout}=createRequire(import.meta.url)('../test-support/frame-diagnostics.cjs');
test('整页等待失败保存宿主和滚动现场及截图',async()=>{
 const outDir=mkdtempSync(join(tmpdir(),'sacode-frame-diagnostics-'));
 const renderer={messages:5,scroll:{top:100,floor:800,following:'false'}};
 const state=await recordFrameTimeout({outDir,probe:'tail',bridge:{proc:{pid:123,exitCode:null},pending:new Map([[1,{}]])},win:{webContents:{executeJavaScript:async()=>renderer,capturePage:async()=>({toPNG:()=>Buffer.from('capture')})}}});
 assert.deepEqual(state.renderer,renderer);assert.equal(state.host.pending,1);
 const files=readdirSync(outDir);assert.equal(files.length,2);
 assert.equal(JSON.parse(readFileSync(join(outDir,files.find(f=>f.endsWith('.json'))),'utf8')).probe,'tail');
 assert.equal(readFileSync(join(outDir,files.find(f=>f.endsWith('.png'))),'utf8'),'capture');
});
test('渲染进程与截图错误仍留下可读失败报告',async()=>{
 const outDir=mkdtempSync(join(tmpdir(),'sacode-frame-diagnostics-error-'));
 const fail=async()=>{throw Error('renderer-gone')};
 const state=await recordFrameTimeout({outDir,probe:'send',win:{webContents:{executeJavaScript:fail,capturePage:fail}}});
 assert.equal(state.rendererError,'renderer-gone');assert.equal(state.captureError,'renderer-gone');
 const saved=JSON.parse(readFileSync(join(outDir,readdirSync(outDir)[0]),'utf8'));
 assert.equal(saved.captureError,'renderer-gone');assert.equal(saved.probe,'send');
});
