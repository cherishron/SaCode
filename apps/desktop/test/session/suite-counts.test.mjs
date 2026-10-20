import {test} from 'node:test';
import assert from 'node:assert/strict';
import {tapCounts,unsafeLines} from '../support/run-batch-suite.mjs';

test('受控回归保留超时文件已交回的成功失败及跳过，不把缺尾部当零失败',()=>{
  assert.deepEqual(tapCounts('ok 1 - 成功\nnot ok 2 - 失败\nok 3 - 未运行 # SKIP\n    not ok 1 - 嵌套\n'),{footerComplete:false,tests:3,pass:1,fail:1,cancelled:0,skipped:1});
  assert.deepEqual(tapCounts('# tests 4\n# pass 2\n# fail 1\n# cancelled 0\n# skipped 1\n'),{footerComplete:true,tests:4,pass:2,fail:1,cancelled:0,skipped:1});
});

test('安全预检不忽略与断言压在同一行的危险启动参数',()=>{
  const bypass='--no'+'-sandbox';
  assert.equal(unsafeLines("const child=spawn(exe,["+JSON.stringify(bypass)+"]);assert.equal(rc,0);").length,1);
  assert.equal(unsafeLines("assert.equal(rc,0);const child=spawn(exe,["+JSON.stringify(bypass)+"]);").length,1);
  assert.equal(unsafeLines('// '+bypass).length,0);
  assert.equal(unsafeLines('const x={'+['sandbox',': false'].join('')+'};assert.ok(x);').length,1);
});
