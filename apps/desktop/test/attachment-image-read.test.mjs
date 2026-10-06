import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {mkdtempSync,readdirSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const require=createRequire(import.meta.url),{HostBridge}=require('../host-bridge.cjs'),{png}=require('../test-support/image-fixture.cjs');
const host=process.env.SACODE_HOST||fileURLToPath(new URL('../dist/host/bin/sacode-host.exe',import.meta.url));

test('真实宿主只读取当前会话持有的图片引用，删除队列即失去读取范围',async()=>{
 const root=mkdtempSync(join(tmpdir(),'sacode-image-read-'));
 let bridge=new HostBridge(host,{...process.env,SACODE_USER_SETTINGS_DIR:join(root,'settings')});await bridge.start(root);
 try{
  assert.ok((await bridge.request('initialize')).capabilities.includes('attachment/image-read'));
  const image=await bridge.request('attachment/upload',{kind:'image',name:'完整图片.png',mediaType:'image/png',data:png.toString('base64')});
  const attachmentId=image.attachment.attachmentId;
  const read=()=>bridge.request('attachment/image-read',{sessionId:'current',attachmentId});
  await assert.rejects(read(),/attachment-image-not-referenced/);
  await bridge.request('queue/enqueue',{text:'图片排队',rpcId:'read-test',receiptIds:[image.receiptId]});
  assert.deepEqual(await read(),{attachmentId,mediaType:'image/png',data:png.toString('base64')});
  await assert.rejects(bridge.request('attachment/image-read',{sessionId:'other',attachmentId}),/attachment-session-changed/);
  const rows=(await bridge.request('queue/describe')).nextTurn;
  await bridge.request('queue/update',{itemId:rows[0].id,kind:'remove'});
  await assert.rejects(read(),/attachment-image-not-referenced/);
  const again=await bridge.request('attachment/upload',{kind:'image',name:'历史图片.png',mediaType:'image/png',data:png.toString('base64')});
  await bridge.request('session/append',{data:'历史图片',receiptIds:[again.receiptId]});
  assert.equal((await read()).data,png.toString('base64'));
  const file=await bridge.request('attachment/upload',{kind:'file',name:'文字.txt',mediaType:'',data:'YWJj'});
  await bridge.request('session/append',{data:'文件消息',receiptIds:[file.receiptId]});
  await assert.rejects(bridge.request('attachment/image-read',{sessionId:'current',attachmentId:file.attachment.attachmentId}),/attachment-image-not-referenced/);
  assert.equal((await bridge.stop()).code,0);
  bridge=new HostBridge(host,{...process.env,SACODE_USER_SETTINGS_DIR:join(root,'settings')});await bridge.start(root);
  assert.equal((await read()).data,png.toString('base64'));
  const other=await bridge.request('session/create',{title:'隔离会话'});
  await bridge.request('session/select',{sessionId:other.id});
  await assert.rejects(read(),/attachment-session-changed/);
  await assert.rejects(bridge.request('attachment/image-read',{sessionId:other.id,attachmentId}),/attachment-image-not-referenced/);
  await bridge.request('session/select',{sessionId:'current'});
  assert.equal((await read()).data,png.toString('base64'));
  // 对象仍在磁盘也不能绕过完整性校验。
  const objectDir=join(root,'attachments','v1');
  const objects=readdirSync(objectDir,{recursive:true}).map(name=>join(objectDir,name));
  const object=objects.find(path=>{try{return readFileSync(path).equals(png);}catch{return false;}});
  assert.ok(object,'必须找到实际持久图片对象');writeFileSync(object,Buffer.from('tampered'));
  await assert.rejects(read(),/attachment-.*(corrupt|digest|hash)/);
 }finally{assert.equal((await bridge.stop()).code,0);}
});
