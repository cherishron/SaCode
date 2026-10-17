import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const {HostBridge}=createRequire(import.meta.url)('../host-bridge.cjs');
const host=process.env.SACODE_HOST||fileURLToPath(new URL('../dist/host/bin/sacode-host.exe',import.meta.url));
test('历史投影附件只属于对应用户消息，宿主重启和尾部裁切保留稳定身份',async()=>{
 const root=mkdtempSync(join(tmpdir(),'sacode-history-attachment-'));
 let bridge=new HostBridge(host,{...process.env,SACODE_USER_SETTINGS_DIR:join(root,'settings')});
 await bridge.start(root);
 try{
  const image=await bridge.request('attachment/upload',{kind:'image',name:'历史图片.png',mediaType:'image/png',data:'iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAAAAAAA'});
  const file=await bridge.request('attachment/upload',{kind:'file',name:'说明"<正文>.txt',mediaType:'',data:'YWJj'});
  await bridge.request('session/append',{data:'同样正文',receiptIds:[image.receiptId,file.receiptId]});
  await bridge.request('session/append',{eventType:'user/message',data:'同样正文'});
  let view=await bridge.request('session/projection');
  assert.deepEqual(view.messageRows[0].attachments,[image.attachment,file.attachment]);
  assert.deepEqual(view.messageRows[1].attachments,[]);
  const firstId=view.messageRows[0].id, secondId=view.messageRows[1].id;
  assert.notEqual(firstId,secondId);assert.equal(view.messageRows[0].text,'同样正文');
  assert.equal(JSON.stringify(view.messageRows).includes('base64'),false);
  assert.equal((await bridge.stop()).code,0);
  bridge=new HostBridge(host,{...process.env,SACODE_USER_SETTINGS_DIR:join(root,'settings')});await bridge.start(root);
  view=await bridge.request('session/projection');assert.equal(view.messageRows[0].id,firstId);
  assert.deepEqual(view.messageRows[0].attachments,[image.attachment,file.attachment]);
  for(let i=0;i<64;i++)await bridge.request('session/append',{eventType:'user/message',data:'尾部 '+i});
  view=await bridge.request('session/projection');assert.equal(view.projection,66);assert.equal(view.messageRows.length,64);
  assert.equal(view.messages.length,64);assert.equal(view.messageRows[0].text,'尾部 0');
  assert.ok(view.messageRows.every(row=>row.attachments.length===0));
  assert.equal(new Set(view.messageRows.map(row=>row.id)).size,64);
 }finally{assert.equal((await bridge.stop()).code,0);}
});
