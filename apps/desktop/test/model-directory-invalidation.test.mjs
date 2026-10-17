import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

test('模型中心所有供应商写动作成功或失败后刷新输入区目录',async()=>{
  const source=readFileSync(new URL('../renderer/app.js',import.meta.url),'utf8');
  const start=source.indexOf('    // 供应商写动作之后刷新输入区的模型目录');
  const end=source.indexOf('    for (const verb of ["upsert"',start);
  assert.ok(start>=0&&end>start,'需要实际产品装配段');
  for(const failed of [false,true]){
    let loads=0;const calls=[];const provider={};
    const verbs=['save','saveCredential','createInstance','setDefault','remove','reorder','pullModels','refreshPull','cancelPull'];
    for(const verb of verbs)provider[verb]=async(...args)=>{calls.push([verb,...args]);if(failed)throw Error('settings-conflict');return 'saved';};
    vm.runInNewContext(source.slice(start,end),{modelCenterAdapters:{'provider-settings':provider},modelDirectory:{load:async()=>{loads++;}}});
    for(const verb of verbs){if(failed)await assert.rejects(provider[verb]('p',4),/settings-conflict/);else assert.equal(await provider[verb]('p',4),'saved');}
    assert.equal(loads,verbs.length);assert.deepEqual(calls,verbs.map(verb=>[verb,'p',4]));
  }
});
