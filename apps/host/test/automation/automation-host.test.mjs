import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createRequire} from 'node:module';
import {fixtureHostEnv} from '../../../desktop/test-support/fixture-env.mjs';

const {HostBridge}=createRequire(import.meta.url)('../../../desktop/host-bridge.cjs');
test('真实 Host 自动化 RPC：空清单、会话绑定和无项目时的明确拒绝',
 {timeout:90000,skip:!process.env.SACODE_HOST},async()=>{
  const root=mkdtempSync(join(tmpdir(),'sacode-automation-host-'));mkdirSync(join(root,'test-user-settings'));
  const env=fixtureHostEnv(root),hostPath=resolve(process.env.SACODE_HOST);let bridge=new HostBridge(hostPath,env),stage='start Host';
  try{
   await bridge.start(root);
   const call=(verb,scope='user',extra={})=>bridge.request('automation/'+verb,{sessionId:'current',scope,...extra});
   stage='initialize Host session';
   const initialized=await bridge.request('initialize');
   for(const method of ['automation/list','automation/save','automation/control']) assert.ok(initialized.capabilities.includes(method),`initialize must advertise ${method}`);
   stage='read initial user automation';
   const initial=await call('list');assert.equal(initial.scope,'user');assert.equal(initial.revision,0);assert.deepEqual(initial.tasks,[]);assert.equal(initial.executorAvailable,false);
   stage='reject stale session';
   const badSession=bridge.request('automation/list',{sessionId:'not-current',scope:'user'});await assert.rejects(badSession,/automation-session-changed/);
   stage='reject project scope without a selected workspace';
   await assert.rejects(call('list','project'),/automation-project-required/);
   stage='read user automation again';
   const current=await call('list');assert.equal(current.revision,initial.revision);assert.deepEqual(current.tasks,[]);
   await bridge.stop(10000);
  }catch(error){throw Error(stage+': '+String(error));}
  finally{await bridge.stop(10000).catch(()=>{});assert.equal(resolve(root,'..'),resolve(tmpdir()));rmSync(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
 });
