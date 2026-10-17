import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// 随包信任锚生成器的合同。为什么要有这个文件：本机实测（docs/evidence/2026-10-11-windows-tls-anchor-audit.md）
// 表明随包那颗 libssl 的默认证书库不可依赖，核心只能吃显式 PEM 锚；而 crypt32 系统存储入口
// 在我们的进程里恒开不起来，所以锚在打包机上从证书存储导出成 PEM 随包走。
// 脚本另留 --from-der-lines 离线入口，让这套合同在没有 PowerShell 的场合也能被测。

const script = fileURLToPath(new URL('../../../scripts/gen-ca-bundle.mjs', import.meta.url));
const TMP = tmpdir();

function run(args) {
  const root = mkdtempSync(join(TMP, 'sacode-ca-bundle-'));
  return { root, result: spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' }) };
}

// 两段任意字节当作 DER 载荷：合同只关心封装与拒绝，不关心证书内容
const DER_A = Buffer.from([0x30, 0x03, 0x01, 0x01, 0xff]).toString('base64');
const DER_B = Buffer.from([0x30, 0x05, 0x02, 0x01, 0x00, 0x01, 0x01, 0xff]).toString('base64');

test('两条 DER 记录导出为两个 PEM 块且能逐字节还原', () => {
  const { root } = run([]);
  const lines = join(root, 'der.txt');
  writeFileSync(lines, `${DER_A}\n${DER_B}\n`);
  const out = join(root, 'ca-bundle.pem');
  const r = spawnSync(process.execPath, [script, out, `--from-der-lines=${lines}`], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const pem = readFileSync(out, 'utf8');
  assert.equal(pem.split('-----BEGIN CERTIFICATE-----').length - 1, 2);
  assert.equal(pem.split('-----END CERTIFICATE-----').length - 1, 2);
  for (const body of pem.split('-----BEGIN CERTIFICATE-----').slice(1)) {
    const b64 = body.split('-----END CERTIFICATE-----')[0];
    for (const line of b64.trim().split('\n')) {
      assert.ok(line.length <= 64, `PEM 载荷行宽必须 ≤64，实测 ${line.length}`);
    }
  }
  const decoded = [...pem.matchAll(/-----BEGIN CERTIFICATE-----\s*([\s\S]*?)-----END CERTIFICATE-----/g)]
    .map((m) => Buffer.from(m[1].replace(/\s+/g, ''), 'base64').toString('base64'));
  assert.deepEqual(decoded, [DER_A, DER_B], '拼回来的 DER 必须与原记录逐字节相同，顺序也不能变');
});

test('一条锚都没有时拒绝产出文件', () => {
  const root = mkdtempSync(join(TMP, 'sacode-ca-bundle-'));
  const lines = join(root, 'der.txt');
  writeFileSync(lines, '');
  const out = join(root, 'ca-bundle.pem');
  const r = spawnSync(process.execPath, [script, out, `--from-der-lines=${lines}`], { encoding: 'utf8' });
  assert.notEqual(r.status, 0, '0 张锚静默产出空文件，会让核心以为锚已配置');
  assert.equal(existsSync(out), false, '拒绝时不得留下半份产物');
  assert.match(r.stderr, /锚|certificate/i);
});

test('不是 base64 的行直接拒绝，不猜半截', () => {
  const root = mkdtempSync(join(TMP, 'sacode-ca-bundle-'));
  const lines = join(root, 'der.txt');
  writeFileSync(lines, `${DER_A}\n这 不是 base64 !!!\n`);
  const out = join(root, 'ca-bundle.pem');
  const r = spawnSync(process.execPath, [script, out, `--from-der-lines=${lines}`], { encoding: 'utf8' });
  assert.notEqual(r.status, 0);
  assert.equal(existsSync(out), false);
});

test('缺输出路径时给用法并退出码 2', () => {
  const r = spawnSync(process.execPath, [script], { encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /用法/);
});

// 上面三条只走离线入口，PowerShell 那条命令本身得真的跑一次：
// 实测第一版用 New-Object 的位置参数写法，PowerShell 直接 PositionalParameterNotFound 退出，
// 离线用例却全绿——没有这条用例，那台打包机要到装包后才发现自己没有锚。
test('真机路径：从 Windows 证书存储导出至少一张锚', () => {
  const root = mkdtempSync(join(TMP, 'sacode-ca-bundle-'));
  const out = join(root, 'ca-bundle.pem');
  const result = spawnSync(process.execPath, [script, out], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const pem = readFileSync(join(root, 'ca-bundle.pem'), 'utf8');
  const blocks = pem.split('-----BEGIN CERTIFICATE-----').length - 1;
  assert.ok(blocks > 0, 'Windows 存储里一张锚都没有，说明导出通道断了');
  assert.ok(blocks <= 400, `锚数异常膨胀（${blocks}），疑似重复未去重`);
});
