import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url);
test('通用设置贡献按插件卸载，父槽位释放后没有残留入口',async()=>{
  const source=fileURLToPath(new URL('../renderer/pages/general-settings.ts',import.meta.url));
  const result=await build({entryPoints:[source],bundle:true,write:false,platform:'node',format:'cjs',external:['vue'],logLevel:'silent'});
  const module={exports:{}};runInNewContext(result.outputFiles[0].text,{module,exports:module.exports,require,queueMicrotask});
  const assembly=module.exports.createGeneralSettingsAssembly(),root=assembly.slots.entries('root')[0];
  assert.equal(root.registrant,'ui-settings-general');
  assert.equal(assembly.slots.dispatch(root,'settings.general.row',{}).length,14);
  assembly.unload('ui-conversation-preferences');
  assert.equal(assembly.slots.dispatch(root,'settings.general.row',{}).length,12);
  assembly.install('local-settings',scope=>scope.inject('settings.general.row',child=>child.register({name:'settings.general.row',id:'local'},{})));
  assert.equal(assembly.slots.dispatch(root,'settings.general.row',{})[0].entry.registrant,'local-settings');
  assembly.unload('ui-settings-general');
  assert.equal(assembly.slots.entries('settings.general.row').length,0);
  assert.equal(assembly.slots.entries('root').length,0);
  assembly.dispose();assembly.dispose();
  assert.throws(()=>assembly.install('late',()=>{}),/settings-assembly-disposed/);
});


test('设置分类只装配选中行，控件从正确的行 owner 取值并转交保存',async()=>{
  const source=fileURLToPath(new URL('../renderer/pages/general-settings.ts',import.meta.url));
  const result=await build({entryPoints:[source],bundle:true,write:false,platform:'node',format:'cjs',external:['vue'],logLevel:'silent'});
  const module={exports:{}};runInNewContext(result.outputFiles[0].text,{module,exports:module.exports,require,queueMicrotask});
  const assembly=module.exports.createGeneralSettingsAssembly(),host=assembly.slots.entries('root')[0];
  const calls=[],owner={visibleRows:['composer-enter'],'composer-enter':{value:'newline',busy:false,change:v=>calls.push(v)}};
  const vnode=host.component.setup({owner})();
  assert.equal(vnode.children.length,1);
  assert.equal(vnode.children[0].props.owner,owner['composer-enter']);
  const render=vnode.children[0].type.setup(vnode.children[0].props);
  assert.equal(typeof render,'function');
  const control=render().children.find(child=>child.type==='select');
  assert.equal(control.props.value,'newline');assert.equal(control.props.disabled,false);
  control.props.onChange({target:{value:'send'}});assert.deepEqual(calls,['send']);
  owner['composer-enter'].busy=true;assert.equal(render().children.find(child=>child.type==='select').props.disabled,true);
  owner.visibleRows=['session-log'];const privacy=host.component.setup({owner})();
  assert.equal(privacy.children.length,1);assert.equal(privacy.children[0].type.name,'SaCodeSessionLogSetting');
  assembly.dispose();
});
