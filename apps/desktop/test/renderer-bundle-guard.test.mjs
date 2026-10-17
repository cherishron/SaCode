import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {assertStaticRendererBundle} from '../../../scripts/renderer-bundle-guard.mjs';
test('真实构建区分语法数据与动态/外部模块，运行时求值仍拒绝',async()=>{
  for(const [source,rejected] of [["globalThis.rule='import(?=...)';",false],["globalThis.go=()=>import('outside');",true],["import x from 'outside';globalThis.x=x;",true],["globalThis.go=new Function('return 1');",true]]){
    const result=await build({stdin:{contents:source},bundle:true,format:'iife',write:false,metafile:true,external:['outside'],logLevel:'silent'});
    const verify=()=>assertStaticRendererBundle(result.outputFiles[0].text,result.metafile);
    if(rejected)assert.throws(verify);else assert.doesNotThrow(verify);
  }
  assert.throws(()=>assertStaticRendererBundle('',undefined));
});
