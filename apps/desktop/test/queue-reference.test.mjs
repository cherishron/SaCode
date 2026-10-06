import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const {HostBridge}=createRequire(import.meta.url)('../host-bridge.cjs');
const host=process.env.SACODE_HOST||fileURLToPath(new URL('../dist/host/bin/sacode-host.exe',import.meta.url));
test('排队投影返回持久附件引用，编辑保留、删除移除',async()=>{
 const root=mkdtempSync(join(tmpdir(),'sacode-queue-refs-'));
 let bridge=new HostBridge(host,{...process.env,SACODE_USER_SETTINGS_DIR:join(root,'settings')});
 await bridge.start(root);
 try {
  await bridge.request('initialize');
  const image=await bridge.request('attachment/upload',{kind:'image',name:'排队图片.png',mediaType:'image/png',data:'iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAAAAAAA'});
  const file=await bridge.request('attachment/upload',{kind:'file',name:'说明"文档.txt',mediaType:'',data:Buffer.from('正文').toString('base64')});
  await bridge.request('queue/enqueue',{text:'带附件排队',rpcId:'refs-test',receiptIds:[image.receiptId,file.receiptId]});
  let rows=(await bridge.request('queue/describe')).nextTurn;
  assert.equal(rows.length,1);assert.deepEqual(rows[0].attachments,[image.attachment,file.attachment]);
  assert.equal(JSON.stringify(rows).includes('base64'),false);
  const id=rows[0].id;
  await bridge.request('queue/update',{itemId:id,kind:'edit',text:'编辑后正文'});
  rows=(await bridge.request('queue/describe')).nextTurn;
  assert.equal(rows[0].text,'编辑后正文');assert.deepEqual(rows[0].attachments,[image.attachment,file.attachment]);
  assert.equal((await bridge.stop()).code,0);
  bridge=new HostBridge(host,{...process.env,SACODE_USER_SETTINGS_DIR:join(root,'settings')});await bridge.start(root);
  assert.deepEqual((await bridge.request('queue/describe')).nextTurn[0].attachments,[image.attachment,file.attachment]);
  await bridge.request('queue/update',{itemId:id,kind:'remove'});
  assert.deepEqual((await bridge.request('queue/describe')).nextTurn,[]);
 }finally{assert.equal((await bridge.stop()).code,0);}
});
