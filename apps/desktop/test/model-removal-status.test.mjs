import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
test('供应商删除区分独立清理、共享保留、环境保留与未确认回执',async()=>{
  const result=await build({entryPoints:[fileURLToPath(new URL('../renderer/pages/provider-settings.ts',import.meta.url))],bundle:true,write:false,format:'cjs',external:['vue']});
  const context={module:{exports:{}},require:()=>({defineComponent:v=>v})};vm.runInNewContext(result.outputFiles[0].text,context);
  const notice=context.module.exports.removalNotice;
  assert.equal(notice({credentialRemoval:'credential-removed'}),'已删除');
  assert.match(notice({credentialRemoval:'shared-credential-retained'}),/共享凭据/);
  assert.match(notice({credentialRemoval:'environment-credential-retained'}),/环境凭据/);
  for(const result of [undefined,null,{},true,{credentialRemoval:'invented'}])assert.match(notice(result),/缺少凭据清理回执/);
});
