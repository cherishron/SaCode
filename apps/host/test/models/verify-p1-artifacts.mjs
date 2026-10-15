// 验证显式指定的本轮业务产物，记录真实运行库指纹；不构建/安装/修改SDK。
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
const root = resolve(import.meta.dirname, '../../../..');
const entries = [
  ['SACODE_HOST', ['--test', join(root, 'apps/host/test/models/local-routing.test.mjs')]],
  ['SACODE_BUDGET_TEST', []],
  ['SACODE_CLOSE_PROBE', ['--test', join(root, 'apps/host/test/models/client-close-probe.test.mjs')]],
];
const facts = entries.map(([name]) => {
  if (!process.env[name]) throw new Error(`必须显式指定${name}，不默认复用旧产物`);
  const exe = realpathSync(process.env[name]);
  const runtime = join(dirname(exe), 'libcangjie-runtime.dll');
  const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex');
  return { name, exe, exeSha256: hash(exe), runtimeSha256: hash(runtime) };
});
if (new Set(facts.map(f => f.runtimeSha256)).size !== 1) throw new Error('三项产物运行库不同，禁止合并验收结果');
console.log('P1产物指纹（哈希相同不代表官方来源已认证）：');
console.log(JSON.stringify(facts, null, 2));
for (let i = 0; i < entries.length; i++) {
  const [name, args] = entries[i];
  const command = name === 'SACODE_BUDGET_TEST' ? facts[i].exe : process.execPath;
  const result = spawnSync(command, args, { cwd: root, env: process.env, stdio: 'inherit', timeout: 120000 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${name}验证失败：退出${result.status}，信号${result.signal}`);
}
console.log('P1定向验证通过；仅对应上述产物/运行库，不代表完整workspace、安装态或真实提供方验收。');
