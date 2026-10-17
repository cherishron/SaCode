import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const desktop=join(dirname(fileURLToPath(import.meta.url)),'..');
test('主进程启动依赖全部进入安装包清单',()=>{
  const {build}=JSON.parse(readFileSync(join(desktop,'package.json'),'utf8'));
  const queue=['main.cjs','preload.cjs'],visited=new Set();
  while(queue.length){
    const file=queue.shift();if(visited.has(file))continue;visited.add(file);
    assert.ok(build.files.some(pattern=>pattern===file||(pattern.endsWith('/**')&&file.startsWith(pattern.slice(0,-2)))),'打包遗漏运行时文件：'+file);
    // 冒烟辅助文件另由装包态交互验收覆盖；这里检查产品启动依赖图。
    if(file.startsWith('test-support/')||file.endsWith('-smoke.cjs'))continue;
    const source=readFileSync(join(desktop,file),'utf8');
    for(const match of source.matchAll(/require\(['"]\.\/([^'"]+\.cjs)['"]\)/g))queue.push(join(dirname(file),match[1]).replaceAll('\\','/'));
  }
});
