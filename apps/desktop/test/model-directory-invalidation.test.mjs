import {test} from 'node:test';
import assert from 'node:assert/strict';
import '../renderer/model-directory-state.js';

test('模型中心所有供应商写动作成功或失败后刷新输入区目录',async()=>{
  for(const failed of [false,true]){
    let loads=0;const calls=[];const provider={};
    const verbs=['save','saveCredential','createInstance','setDefault','remove','reorder','pullModels','refreshPull','cancelPull'];
    for(const verb of verbs)provider[verb]=async(...args)=>{calls.push([verb,...args]);if(failed)throw Error('settings-conflict');return 'saved';};
    const selection=globalThis.SaCodeModelDirectory.createModelSelection({api:{},directory:{load:async()=>{loads++;}},customModels:{value:[]},selectedCustomModel:{value:''}});
    const bound=selection.bindAdapters({'provider-settings':provider,'custom-models':{}})['provider-settings'];
    for(const verb of verbs){if(failed)await assert.rejects(bound[verb]('p',4),/settings-conflict/);else assert.equal(await bound[verb]('p',4),'saved');}
    assert.equal(loads,verbs.length);assert.deepEqual(calls,verbs.map(verb=>[verb,'p',4]));
  }
});
