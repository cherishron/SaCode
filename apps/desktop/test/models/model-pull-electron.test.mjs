import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createServer} from 'node:http';
import {mkdirSync,mkdtempSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {electronTestOptions} from '../../test-support/electron-env-gate.mjs';
const require=createRequire(import.meta.url),host=process.env.SACODE_HOST;
test('Electron默认沙箱：页面→生产preload→IPC→Host取消与丢回执结果找回',electronTestOptions({
  timeout:40000,skip:!host&&'须显式提供当前源码构建的中性 SACODE_HOST',
}),async()=>{
  const desktop=fileURLToPath(new URL('../../',import.meta.url));
  const base=fileURLToPath(new URL('../../../../target/tmp/model-pull-electron/',import.meta.url));mkdirSync(base,{recursive:true});
  const dir=mkdtempSync(join(base,'run-'));mkdirSync(join(dir,'user-data'));
  let hits=0;const timers=new Set();
  const server=createServer((_req,res)=>{hits++;if(hits===1)return;
    const timer=setTimeout(()=>{timers.delete(timer);res.end('{"data":[{"id":"electron-found"}]}');},hits===3?650:0);timers.add(timer);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    await build({entryPoints:[join(desktop,'test/fixtures/models/model-pull-checks.ts')],bundle:true,format:'iife',outfile:join(dir,'checks.js'),plugins:[{name:'vue-runtime',setup(b){b.onResolve({filter:/^vue$/},()=>({path:'vue',namespace:'runtime'}));b.onLoad({filter:/.*/,namespace:'runtime'},()=>({contents:'module.exports=globalThis.Vue;',loader:'js'}));}}]});
    writeFileSync(join(dir,'fixture.html'),`<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'self';script-src 'self';style-src 'self'"><link rel="stylesheet" href="${pathToFileURL(join(desktop,'renderer/product-design.css')).href}"><div id="fixture"></div><script src="${pathToFileURL(join(desktop,'renderer/vendor/vue.runtime.global.prod.js')).href}"></script><script src="checks.js"></script>`);
    const config=join(dir,'config.json');writeFileSync(config,JSON.stringify({desktop,dir,host,baseUrl:`http://127.0.0.1:${server.address().port}`}));
    const env={...process.env,TEMP:dir,TMP:dir};for(const key of ['ELECTRON_RUN_AS_NODE','NODE_OPTIONS','NODE_INSPECT_RESUME_ON_START'])delete env[key];
    const child=spawn(process.env.SACODE_TEST_ELECTRON||require('electron'),['--user-data-dir='+join(dir,'user-data'),join(desktop,'test/support/models/model-pull-electron.cjs'),config],{env,windowsHide:true,stdio:['ignore','pipe','pipe']});
    let out='';child.stdout.on('data',d=>out+=d);child.stderr.on('data',d=>out+=d);
    const timer=setTimeout(()=>child.kill(),32000);
    const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);}).finally(()=>clearTimeout(timer));
    writeFileSync(join(dir,'output.txt'),out);
    assert.equal(code,0,'默认沙箱Electron未通过；输出保存在 '+join(dir,'output.txt'));
    const line=out.split(/\r?\n/).find(line=>line.startsWith('PULL_ELECTRON_RESULT '));assert.ok(line,'缺少真实renderer回执');
    const result=JSON.parse(line.slice('PULL_ELECTRON_RESULT '.length));assert.equal(result.ok,true);assert.ok(result.checks.length>=7);
    assert.equal(result.sandboxConfigured,true);assert.equal(result.contextIsolation,true);assert.equal(result.nodeIntegration,false);
    assert.equal(hits,3,'取消、成功、丢回执各一次，查询不重发');
  }finally{for(const timer of timers)clearTimeout(timer);server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
