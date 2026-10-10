import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

// 启动越出清理边界会留下 HTTP 监听，即使 ENOENT 已报失败也不能自然退出。
test('缺少 Host 时响应性测试保留 ENOENT 并清理监听后自然退出',t=>{
 const desktop=fileURLToPath(new URL('../',import.meta.url));
 const target=fileURLToPath(new URL('./provider-start-responsive.test.mjs',import.meta.url));
 const missingHost=fileURLToPath(new URL('./provider-start-cleanup-missing-host.exe',import.meta.url));
 assert.equal(existsSync(missingHost),false,'回归必须使用确定不存在的树内 Host');
 // 不继承凭证或 Node 测试上下文；只保留 Windows 启动所需的系统目录。
 const env={SACODE_HOST:missingHost};
 if(process.platform==='win32')env.SystemRoot=process.env.SystemRoot;
 const child=spawnSync(process.execPath,['--test','--test-reporter=tap',target],{
  cwd:desktop,env,encoding:'utf8',timeout:12000
 });
 const output=child.stdout+child.stderr;
 t.diagnostic(JSON.stringify({status:child.status,signal:child.signal,error:child.error?.code,
  failures:(output.match(/^not ok \d+ - /gm)||[]).length}));
 assert.equal(child.error,undefined,'子进程必须自然退出，不能由 deadline 终止');
 assert.equal(child.signal,null,'子进程不能靠信号终止');
 assert.equal(child.status,1,'缺 Host 必须以测试失败退出');
 assert.match(output,/^\s+code: 'ENOENT'$/m,'必须保留原始启动错误码');
 assert.match(output,/^\s+error: 'spawn .* ENOENT'$/m,'必须保留原始 spawn 错误');
 assert.equal((output.match(/^not ok \d+ - /gm)||[]).length,1,'只能有一个失败结算');
 assert.match(output,/^# tests 1$/m);
 assert.match(output,/^# pass 0$/m);
 assert.match(output,/^# fail 1$/m);
 assert.match(output,/^# cancelled 0$/m);
 assert.match(output,/^# skipped 0$/m);
 assert.match(output,/^# todo 0$/m);
});
