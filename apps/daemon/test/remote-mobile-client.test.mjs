import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

// 移动客户端接入逻辑层的交付验证：Kotlin 源码必须真编出来、真跑起来，
// 并且对着**真的 daemon**（TLS + 票据登记 + Bearer + /rpc + /sse）拿结论。
//
// 为什么不用「静态对账 + 跳过」：这一层过去只有 JS 客户端（桌面/CLI）在打 daemon，
// 移动侧的接入逻辑一旦只存在于源码里，就等于没验过。本机有 JDK 与 kotlinc，
// 所以缺的不是跑不了的前提，而是执行——把它跑起来。
// 缺工具链时本文件要**红并指名前提**，不许 skip：skip 会让「移动接入从未验过」
// 这件事在下一次读计数时消失。
const root = path.resolve(import.meta.dirname, '../../..');
const daemonExe = process.env.SACODE_DAEMON || path.join(root, 'apps/daemon/target/release/bin/main.exe');
const policyFile = path.join(root, 'docs/plans/remote-capability-contract.json');
const openssl = process.env.SACODE_OPENSSL || 'openssl';
const kotlinHome = process.env.SACODE_KOTLIN_HOME || 'C:/Users/jingg/.version-fox/sdks/kotlin';
const compilerJar = path.join(kotlinHome, 'lib', 'kotlin-compiler.jar');
const stdlibJar = path.join(kotlinHome, 'lib', 'kotlin-stdlib.jar');
const javaExe = process.env.SACODE_JAVA || 'java';
const srcDirs = [path.join(root, 'apps/mobile/kotlin'), path.join(root, 'apps/mobile/kotlin-test')];

const baseEnv = { ...process.env };
const pathKey = Object.keys(baseEnv).find(k => k.toLowerCase() === 'path') || 'PATH';
baseEnv[pathKey] = [
  process.env.SACODE_STDX_DLL_DIR || 'C:/Users/jingg/stdx-work/stdx-1.1.3.1/windows_x86_64_cjnative/dynamic/stdx',
  process.env.SACODE_RUNTIME_DLL_DIR || 'D:/Program Files/HuaWei/Cangjie/runtime/lib/windows_x86_64_cjnative',
  baseEnv[pathKey],
].join(path.delimiter);

const delay = ms => new Promise(r => setTimeout(r, ms));

// 收尾两步都必须有界等待：daemon 的 cwd 就是那份临时目录，Windows 上进程还活着时
// rmdir 会 EBUSY。实测这样翻过一次车（18 条断言全过、整条用例因为 rm 而红），
// 所以「kill 后等 close」不是礼貌，是这条用例能不能稳定判绿的前提。
async function stopDaemon(proc) {
  if (proc.exitCode !== null || proc.signalCode !== null) return;
  proc.kill();
  const end = Date.now() + 8000;
  while (proc.exitCode === null && proc.signalCode === null && Date.now() < end) await delay(25);
}

async function removeDir(dir) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try { await rm(dir, { recursive: true, force: true }); return; }
    catch (e) {
      if (e.code !== 'EBUSY' && e.code !== 'EPERM' && e.code !== 'ENOTEMPTY') throw e;
      await delay(150);
    }
  }
  throw new Error(`临时目录清不掉（同机器上还挂着 daemon？）：${dir}`);
}

function requireToolchain() {
  for (const p of [daemonExe, compilerJar, stdlibJar]) {
    assert.ok(existsSync(p), `缺前提 ${p}——这条是环境缺失，不是通过也不是失败，必须写进证据`);
  }
  const probe = spawnSync(javaExe, ['-version'], { encoding: 'utf8' });
  assert.equal(probe.status, 0, `java 不可用：${probe.stderr || probe.error}`);
}

// 自签证书只是本机夹具：SAN 必须是 IP:127.0.0.1，否则红的是夹具而不是被测面。
async function makeCert(dir) {
  const certPath = path.join(dir, 'server.crt');
  const keyPath = path.join(dir, 'server.key');
  await new Promise((resolve, reject) => {
    const p = spawn(openssl, [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
      '-subj', '/CN=127.0.0.1',
      '-addext', 'subjectAltName=IP:127.0.0.1',
      '-keyout', keyPath, '-out', certPath,
    ]);
    let err = '';
    p.stderr.on('data', d => { err += d; });
    p.on('close', code => (code === 0 ? resolve() : reject(new Error(`openssl 出证失败 rc=${code}: ${err}`))));
  });
  const pem = await readFile(certPath, 'utf8');
  const der = Buffer.from(pem.split('\n').filter(l => l.trim() && !l.startsWith('-----')).join(''), 'base64');
  return { certPath, keyPath, pin: createHash('sha256').update(der).digest('hex') };
}

function compile(outDir) {
  const r = spawnSync(javaExe, [
    '-cp', compilerJar, 'org.jetbrains.kotlin.cli.jvm.K2JVMCompiler',
    ...srcDirs, '-d', outDir, '-nowarn',
  ], { encoding: 'utf8', cwd: root });
  return r;
}

// Kotlin 侧的 `fun main()` 在包 sacode 里 → JVM 主类是 sacode.MobileClientTestKt。
// -Dfile.encoding=UTF-8：不指定的话 Windows 控制台按 GBK 出中文原因串，取证日志里的
// 失败原因会变成不可读的乱码——红还是红，但归因那段就废了。
function runClient(classes, env) {
  return spawnSync(javaExe, [
    '-Dfile.encoding=UTF-8',
    '-cp', [classes, stdlibJar].join(path.delimiter), 'sacode.MobileClientTestKt',
  ], { encoding: 'utf8', env: { ...process.env, ...env }, cwd: root, timeout: 180000 });
}

// 18 条是 Kotlin 侧的常驻用例数。写死数字并逐名比对，是为了挡住
// 「删掉一条 check 让红消失」——只比 counts 的话少跑一条也能过。
const EXPECTED = [
  'plaintextBearerIsRefusedBeforeAnyRequest',
  'pinFingerprintIsComputedFromTheServedCertificate',
  'pinMismatchAbortsTheHandshakeInsteadOfFallingBack',
  'enrollThenTokenThenInitializeHitsRpc',
  'httpErrorIsClassifiedApartFromJsonRpcError',
  'unknownMethodComesBackAsJsonRpcErrorNotHttpError',
  'malformedMethodNameIsRefusedLocallyNotSent',
  'sessionCatalogEntriesParseWithExplicitOwnership',
  'sseStreamOpensWithPinAndBearerAndGreets',
  'sseWithoutBearerIsRefusedNotSilentlyEmpty',
  'credentialStoreNeverSerializesTheToken',
  'requiredFieldsAreRejectedNotDefaulted',
  'approvalAnswerUsesTicketIdOnly',
  'turnCancelRequiresBothSessionAndOperation',
  'noAutoFailoverToAnotherTarget',
  'lateFramesFromOlderEpochAreDropped',
  'draftsAreKeptPerTarget',
  'sseResumeSendsLastEventIdOverTheWire',
];

test('移动接入层的 Kotlin 源码能真编译（工具链缺失即红并指名前提）', (t) => {
  requireToolchain();
  const out = path.join(root, 'target', 'sacode-mobile-classes');
  const r = compile(out);
  assert.equal(r.status, 0, `kotlinc 失败：${r.stdout}\n${r.stderr}`);
  assert.ok(existsSync(path.join(out, 'sacode', 'MobileClientTestKt.class')),
    '编译产物里没有主类，等于没跑');
  for (const cls of ['SecureTransportKt', 'RpcClient', 'SseClient', 'CredentialStore', 'SessionModel', 'TargetStore', 'EpochGate']) {
    const hit = existsSync(path.join(out, 'sacode', `${cls}.class`))
      || existsSync(path.join(out, 'sacode', `${cls}Kt.class`));
    assert.ok(hit, `计划命名的接入层类型没编出来：${cls}`);
  }
});

test('移动接入层对着真 daemon 跑：18 条全绿，红一条都不许留', async (t) => {
  requireToolchain();
  const dir = await mkdtemp(path.join(root, 'target', 'sacode-mobile-run-'));
  const classes = path.join(root, 'target', 'sacode-mobile-classes');
  const { certPath, keyPath, pin } = await makeCert(dir);
  const identity = path.join(dir, 'instance.id');
  const snapshot = `${identity}.devices.json`;

  const proc = spawn(daemonExe, ['--port', '0'], {
    cwd: dir,
    env: {
      ...baseEnv,
      SACODE_USER_SETTINGS_DIR: path.join(dir, 'settings'),
      SACODE_REMOTE_ACCESS: '1',
      SACODE_REMOTE_IDENTITY: identity,
      SACODE_REMOTE_POLICY: policyFile,
      SACODE_REMOTE_TLS_CERT: certPath,
      SACODE_REMOTE_TLS_KEY: keyPath,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  let err = '';
  proc.stdout.on('data', d => { out += d; });
  proc.stderr.on('data', d => { err += d; });
  try {
    const end = Date.now() + 20000;
    while (!/127\.0\.0\.1:(\d+)/.test(out) && proc.exitCode === null && Date.now() < end) await delay(20);
    assert.match(out, /127\.0\.0\.1:(\d+)/, `daemon 未监听：stdout=${out} stderr=${err}`);
    assert.match(out, /^daemon on https:\/\//, `配了证书就必须以 TLS 提供服务：${out}`);
    const port = Number(out.match(/127\.0\.0\.1:(\d+)/)[1]);

    const ticket = await createTicket(snapshot, 'p-mobile');
    const compiled = compile(classes);
    assert.equal(compiled.status, 0, `kotlinc 失败：${compiled.stderr}`);

    const r = runClient(classes, {
      SACODE_MOBILE_BASE: `https://127.0.0.1:${port}`,
      SACODE_MOBILE_CERT_PEM: certPath,
      SACODE_MOBILE_KEY_PEM: keyPath,
      SACODE_MOBILE_PIN: pin,
      SACODE_MOBILE_BAD_PIN: createHash('sha256').update('wrong-pin-fixture').digest('hex'),
      SACODE_MOBILE_TICKET: ticket,
    });
    const lines = (r.stdout || '').replace(/\r/g, '').split('\n');
    const pass = lines.filter(l => l.startsWith('PASS ')).map(l => l.slice(5).trim());
    const fail = lines.filter(l => l.startsWith('FAIL '));
    assert.equal(r.status, 0, `Kotlin 侧退出码非零（${r.status}）：\n${r.stdout}\n${r.stderr}`);
    assert.deepEqual(fail, [], `Kotlin 侧有失败条目：\n${fail.join('\n')}`);
    assert.deepEqual(pass.slice().sort(), EXPECTED.slice().sort(),
      `常驻用例集对不上（少跑/多跑都不算绿）：\n实得 ${pass.join(', ')}\n失败 ${fail.join(', ')}`);
    assert.equal(pass.length, EXPECTED.length, `条数应为 ${EXPECTED.length}`);
  } finally {
    await stopDaemon(proc);
    await removeDir(dir);
  }
});

async function createTicket(snapshot, principal) {
  const proc = spawn(daemonExe, ['--manage', 'enroll-ticket', snapshot, principal], {
    env: baseEnv, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  let err = '';
  proc.stdout.on('data', d => { out += d; });
  proc.stderr.on('data', d => { err += d; });
  // 有界等待建票退出：'close' 还要等 stdio 句柄全关，并发跑整套时可能永远不来，
  // 无界 await 会把整个测试文件冻住（2026-10-10 批次 J 就是这个形状挂的）。
  const end = Date.now() + 15000;
  while (proc.exitCode === null && proc.signalCode === null && Date.now() < end) await delay(25);
  const code = proc.exitCode;
  assert.notEqual(proc.exitCode, null, '本地管理入口建票未在 15s 内退出');
  assert.equal(code, 0, `本地管理入口建票失败 rc=${code}：${err}`);
  const lines = out.replace(/\r/g, '').trim().split('\n');
  const ticket = lines[lines.length - 1].trim();
  assert.match(ticket, /^[0-9a-f]{32}$/, `票据形状不对：${JSON.stringify(lines)}`);
  return ticket;
}
