import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, readFile, appendFile, unlink, mkdir, copyFile } from 'node:fs/promises';
import fs from 'node:fs';
import path from 'node:path';

// 任务 5 的 Windows 半：一份包同时带 CLI、Host 与 daemon，并且**在剥掉仓颉 SDK 的环境里**起得来。
// 为什么把「剥 PATH」写进断言而不是只核清单：清单绿只证明脚本抄了文件；
// 缺 DLL 的包在装出来的机器上是启动瞬间 rc=127，那是发布事故而不是测试噪声。
// 同理，「删掉一颗真依赖必须启动失败」是这条链的反证——不测它，抄漏 DLL 也能全绿。
const root = path.resolve(import.meta.dirname, '..');
const platformDir = path.join(root, 'npm', 'sacode-cli-win32-x64');
const packScript = path.join(root, 'scripts', 'pack-service.mjs');
const verifyScript = path.join(root, 'scripts', 'verify-service-package.mjs');
const delay = ms => new Promise(r => setTimeout(r, ms));

function sha256(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

async function rmBounded(dir) {
  const until = Date.now() + 12000;
  for (;;) {
    try { await rm(dir, { recursive: true, force: true }); return; }
    catch (e) { if (Date.now() >= until) throw e; await delay(250); }
  }
}

// 运行期库集合的唯一真源是 scripts/pack-cli.mjs（哪几颗 DLL 进包、哪几颗不进，它已经用反证定过档）。
// 服务包不重新决定这件事，只消费它的产物；所以缺包时先补一次，而不是在服务包脚本里再抄一套规则。
function ensurePlatformPackage() {
  const exe = path.join(platformDir, 'bin', 'sacode.exe');
  const dlls = fs.existsSync(path.join(platformDir, 'bin')) &&
    fs.readdirSync(path.join(platformDir, 'bin')).some(f => f.endsWith('.dll'));
  if (fs.existsSync(exe) && dlls) return 'reused';
  execFileSync(process.execPath, [path.join(root, 'scripts', 'pack-cli.mjs')], { cwd: root, stdio: 'pipe' });
  return 'packed';
}

function pack(outDir, extra = []) {
  return spawnSync(process.execPath, [packScript, '--out', outDir, ...extra], { cwd: root, encoding: 'utf8' });
}

function verify(outDir) {
  return spawnSync(process.execPath, [verifyScript, outDir], { cwd: root, encoding: 'utf8' });
}

function readManifest(outDir) {
  return JSON.parse(fs.readFileSync(path.join(outDir, 'bin', 'service-manifest.json'), 'utf8'));
}

// 剥掉仓颉 SDK 与 stdx 的 PATH：只留 Node 与系统目录，等价于装好包后的用户机器。
function sdkFreeEnv(extra = {}) {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.toLowerCase() === 'path') delete env[k];
  env.PATH = [path.dirname(process.execPath), path.join(process.env.SystemRoot, 'System32'), process.env.SystemRoot].join(';');
  return { ...env, ...extra };
}

async function withPacked(run) {
  const mode = ensurePlatformPackage();
  const out = await mkdtemp(path.join(root, 'target', 'sacode-service-'));
  const made = pack(out);
  assert.equal(made.status, 0, `pack-service 应成功（补包方式=${mode}）：${made.stdout}\n${made.stderr}`);
  try { await run(out, mode); } finally { await rmBounded(out); }
}

test('服务包清单收齐 cli、host、daemon 与扩展宿主四个角色', async () => {
  await withPacked((out) => {
    const m = readManifest(out);
    for (const role of ['cli', 'host', 'daemon', 'extensionHost']) {
      assert.ok(m.roles?.[role], `清单缺角色 ${role}：${JSON.stringify(m.roles)}`);
      const listed = m.files.some(f => f.path === m.roles[role]);
      assert.ok(listed, `角色 ${role} 指向的 ${m.roles[role]} 不在文件清单里`);
      assert.ok(fs.existsSync(path.join(out, m.roles[role])), `角色 ${role} 声明了但盘上没有`);
    }
    assert.equal(m.platform, process.platform);
    assert.equal(m.arch, process.arch);
    assert.ok(m.files.some(f => f.kind === 'runtime-library'), '一颗运行期库都没进包，剥掉 SDK 必炸');
  });
});

test('清单逐条摘要对得上，且摘要就是本轮构建产物', async () => {
  await withPacked((out) => {
    const m = readManifest(out);
    for (const f of m.files) {
      const abs = path.join(out, f.path);
      assert.ok(fs.existsSync(abs), `清单里这条在盘上不存在：${f.path}`);
      assert.equal(fs.statSync(abs).size, f.bytes, `字节数与清单不符：${f.path}`);
      assert.equal(sha256(abs), f.sha256, `摘要与清单不符：${f.path}`);
    }
    // 「包内产物与本次源码对应」的唯一硬判据是摘要，不是时间戳（旧产物造过一轮假红）。
    const roleDigest = (role) => m.files.find(f => f.path === m.roles[role]).sha256;
    assert.equal(roleDigest('daemon'), sha256(path.join(root, 'apps/daemon/target/release/bin/main.exe')));
    assert.equal(roleDigest('host'), sha256(path.join(root, 'apps/host/target/release/bin/main.exe')));
    assert.equal(roleDigest('cli'), sha256(path.join(root, 'apps/cli/target/release/bin/main.exe')));
    const v = verify(out);
    assert.equal(v.status, 0, `验收脚本应放行完整包：${v.stdout}\n${v.stderr}`);
  });
});

test('篡改一个包内文件后验收必须失败，并点名那条', async () => {
  await withPacked(async (out) => {
    const rel = readManifest(out).roles.extensionHost;
    const target = path.join(out, rel);
    // 等长改一个字节：换字符会同时改动大小，于是 file-sizes 先红，摘要这项检查就没人证了。
    // P1 变异轮就是靠这个洞发现「红的其实是别的检查」。
    const buf = fs.readFileSync(target);
    const idx = buf.indexOf(0x63);
    assert.ok(idx >= 0, `${rel} 里没有可翻转的 ASCII 'c'，换一种等长篡改`);
    buf[idx] = 0x43;
    fs.writeFileSync(target, buf);
    const v = verify(out);
    assert.notEqual(v.status, 0, '正文被改了还能过验收，清单就只是装饰');
    assert.match(v.stdout + v.stderr, /^FAIL file-digests/m, `失败必须落在摘要这项检查上：${v.stdout}`);
    assert.match(v.stdout + v.stderr, new RegExp(`\\b${rel.replace('.', '\\.')}\\b`), `失败原因没点名被改的那条：${v.stdout}`);
  });
});

test('清单不含绝对路径、用户目录，也不登记身份与密钥类文件', async () => {
  await withPacked((out) => {
    const text = fs.readFileSync(path.join(out, 'bin', 'service-manifest.json'), 'utf8').replace(/\\/g, '/');
    const m = readManifest(out);
    const home = (process.env.USERPROFILE || '').replace(/\\/g, '/');
    for (const f of m.files) {
      assert.ok(!path.isAbsolute(f.path), `清单条目不该是绝对路径：${f.path}`);
      assert.ok(!f.path.includes('..'), `清单条目不该越出库根：${f.path}`);
      // 分隔符也钉住：清单是要跨平台核对的，Windows 上写出的反斜杠路径在 Linux 侧读就是找不到文件。
      assert.ok(!f.path.includes('\\'), `清单条目带了反斜杠分隔符：${f.path}`);
      assert.ok(!home || !f.path.includes(home), `清单条目带了用户目录：${f.path}`);
    }
    // 按 basename 后缀判，不按子串判：真包里就有 libstdx.crypto.keys.dll，
    // 子串式禁词会把这颗合法运行期库判成秘密文件——那是假阳性，会把门禁自己耗掉。
    const denied = ['.pem', '.key', '.id', '.audit.log', '.ledger.jsonl', '.devices.json'];
    for (const f of m.files) {
      const base = f.path.split('/').pop();
      assert.ok(!denied.some(d => base.endsWith(d)), `清单登记了运行态或密钥文件：${f.path}`);
    }
    assert.ok(!/[A-Za-z]:\//.test(text), `清单正文里出现盘符路径：${text.slice(0, 200)}`);
    assert.match(text, /"gitSha"/, '清单要带上它对应的提交，摘要才能反查源码');
  });
});

test('包里有未登记的二进制时验收必须失败（旧产物混包的唯一静默通道）', async () => {
  // 只查「清单说的都在盘上」是不够的：反过来「盘上的都在清单里」才挡得住
  // 上一轮构建留在目录里的旧 exe——那条通道造过一次假红。
  await withPacked(async (out) => {
    fs.writeFileSync(path.join(out, 'bin', 'sacode-daemon-OLD.exe'), 'stale build artifact\n');
    const v = verify(out);
    assert.notEqual(v.status, 0, `包里躺着一颗清单没登记的 exe 还能过验收：${v.stdout}`);
    // 必须落在这一项的 FAIL 行上：只匹配检查名会被「PASS 同名检查」那行满足，
    // P1 变异轮（整段短路这项检查）就是靠这个洞活下来的。
    assert.match(v.stdout + v.stderr, /^FAIL no-unlisted-payload/m, `失败必须落在未登记这项检查上：${v.stdout}`);
    assert.match(v.stdout + v.stderr, /sacode-daemon-OLD\.exe/);
  });
});

test('把一颗伪装成密钥的文件写进清单，验收必须点名它', async () => {
  // 上一条只证「真包没被误杀」；这条证禁词那一项检查真的在执行——不配这条，
  // 检查名可以整段删掉而全套仍绿。
  await withPacked(async (out) => {
    const manifestPath = path.join(out, 'bin', 'service-manifest.json');
    const m = readManifest(out);
    const decoy = 'bin/server.key';
    fs.writeFileSync(path.join(out, decoy), 'PRIVATE KEY MATERIAL\n');
    const bytes = fs.statSync(path.join(out, decoy)).size;
    // 分类给 executable 而不是 'other'：给 other 会先把 kind 白名单那项撑红，
    // 于是「禁词这项检查到底有没有在执行」又没人证了。
    m.files.push({ path: decoy, bytes, sha256: sha256(path.join(out, decoy)), kind: 'executable' });
    m.files.sort((a, b) => a.path.localeCompare(b.path));
    fs.writeFileSync(manifestPath, JSON.stringify(m, null, 2) + '\n');
    const v = verify(out);
    assert.notEqual(v.status, 0, '清单里躺着一颗 .key 还能过验收，禁词那项就是摆设');
    assert.match(v.stdout + v.stderr, /^FAIL secret-and-state-denied/m, `失败必须落在禁词这项检查上：${v.stdout}`);
    assert.match(v.stdout + v.stderr, /server\.key/);
  });
});

test('缺 daemon 构建产物时 pack-service 响亮失败，而不是出一个残缺包', async () => {
  await withPacked(async (out) => {
    const made = pack(out, ['--daemon', path.join(root, 'target', 'definitely-not-here.exe')]);
    assert.notEqual(made.status, 0, '指不到 daemon 还继续出包，就是在出残缺包');
    assert.match(made.stderr + made.stdout, /definitely-not-here/, `失败原因没点名缺的那个输入：${made.stderr}`);
  });
});

test('剥掉 SDK 的 PATH 后，包内 daemon 仍能起来并答 /health', async () => {
  await withPacked(async (out) => {
    const exe = path.join(out, readManifest(out).roles.daemon);
    const work = await mkdtemp(path.join(root, 'target', 'sacode-service-health-'));
    const proc = spawn(exe, ['--port', '0'], {
      cwd: work, env: sdkFreeEnv({ SACODE_USER_SETTINGS_DIR: path.join(work, 'settings') }),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', d => { stdout += d; });
    proc.stderr.on('data', d => { stderr += d; });
    try {
      const until = Date.now() + 20000;
      while (!/127\.0\.0\.1:(\d+)/.test(stdout) && proc.exitCode === null && Date.now() < until) await delay(30);
      assert.match(stdout, /127\.0\.0\.1:(\d+)/, `包内 daemon 没能监听：rc=${proc.exitCode} stderr=${stderr}`);
      const port = Number(stdout.match(/127\.0\.0\.1:(\d+)/)[1]);
      const r = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(10000) });
      assert.equal(r.status, 200);
      assert.match(await r.text(), /"status":"ok"/);
    } finally {
      proc.kill('SIGKILL');
      await Promise.race([new Promise(res => proc.on('close', res)), delay(3000)]);
      await rmBounded(work);
    }
  });
});

test('删掉 libcangjie-runtime.dll，剥 SDK 后包内 daemon 必须启动失败', async () => {
  await withPacked(async (out) => {
    const m = readManifest(out);
    // 指定那颗而不是「随便挑一条运行期库」：挑错的后果是「删了也能跑」，
    // 那会被读成依赖集抄多了，而不是这条断言在保护什么。
    const runtime = m.files.find(f => f.path.split(/[\\/]/).pop() === 'libcangjie-runtime.dll');
    assert.ok(runtime, `清单里没有 libcangjie-runtime.dll，说明运行期库集合没按 pack-cli 的档位收齐：${JSON.stringify(m.files.map(f => f.path))}`);
    assert.equal(verify(out).status, 0, '基线验收应通过');
    await unlink(path.join(out, runtime.path));
    const proc = spawn(path.join(out, m.roles.daemon), ['--port', '0'], {
      cwd: out, env: sdkFreeEnv(), stdio: ['ignore', 'pipe', 'pipe'],
    });
    let text = '';
    // 结局只有三种：起来监听（= 这颗其实不是真依赖）、12 秒还没退（超时不是失败证据）、非零退出。
    // 后一种才是这条断言要的形状，所以前两种都判红。
    const verdict = await new Promise(resolve => {
      const timer = setTimeout(() => resolve('hung'), 12000);
      proc.stdout.on('data', d => {
        text += d;
        if (/127\.0\.0\.1:(\d+)/.test(text)) { clearTimeout(timer); proc.kill('SIGKILL'); resolve('listened'); }
      });
      proc.on('close', code => { clearTimeout(timer); resolve({ code }); });
    });
    if (verdict === 'listened') { proc.kill('SIGKILL'); }
    if (verdict === 'hung') { proc.kill('SIGKILL'); }
    assert.notEqual(verdict, 'listened', `删掉 ${runtime.path} 后包仍能监听，这颗不在依赖集里`);
    assert.notEqual(verdict, 'hung', `删掉 ${runtime.path} 后 12 秒既没起来也没退出，不能算失败证据`);
    assert.notEqual(verdict.code, 0, `删掉 ${runtime.path} 后 daemon 竟以 0 退出：${text}`);
    const v = verify(out);
    assert.notEqual(v.status, 0, `删掉 ${runtime.path} 后验收必须失败`);
    assert.match(v.stdout + v.stderr, /libcangjie-runtime\.dll/, '失败原因要点名缺的那颗');
  });
});

test('装好的布局里，包装脚本解析到包内 daemon 并真把它跑起来', async () => {
  // 下一条只证「缺包即红」；这一条证正向路径：require.resolve 命中的是包内那一份，
  // 而且包内那一份靠自带的运行期库就能起来。两条都要——否则「永远找不到包」也能全绿。
  const src = await readFile(path.join(root, 'npm', 'sacode-cli', 'bin', 'daemon.js'), 'utf8');
  assert.ok(!/shell:\s*true/.test(src), '包装脚本不能经 shell 启动，参数透传不该拼 shell');
  const mode = ensurePlatformPackage();
  const staged = await mkdtemp(path.join(root, 'target', 'sacode-install-'));
  const pkgRoot = path.join(staged, 'npm', 'sacode-cli');
  const platformPkg = path.join(staged, 'node_modules', '@stand-alone', 'sacode-win32-x64');
  try {
    const made = pack(platformPkg);
    assert.equal(made.status, 0, `pack-service 应能把交付装进安装态布局（补包方式=${mode}）：${made.stderr}`);
    assert.equal(verify(platformPkg).status, 0, '交付前验收必须通过');
    await mkdir(path.join(pkgRoot, 'bin'), { recursive: true });
    for (const f of ['package.json', 'bin/cli.js', 'bin/daemon.js']) {
      await copyFile(path.join(root, 'npm', 'sacode-cli', f), path.join(pkgRoot, f));
    }
    // 平台包的 package.json 也在：require.resolve 认的是包名，不是目录里有没有二进制。
    await copyFile(path.join(root, 'npm', 'sacode-cli-win32-x64', 'package.json'), path.join(platformPkg, 'package.json'));
    // 装出来的 daemon 是常驻进程，所以按「它是否打到监听行」判，而不是等它退出。
    const probe = spawn(process.execPath, [path.join(pkgRoot, 'bin', 'daemon.js'), '--port', '0'], {
      cwd: pkgRoot, env: sdkFreeEnv({ SACODE_USER_SETTINGS_DIR: path.join(staged, 'settings') }),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let text = '';
    let errText = '';
    probe.stdout.on('data', d => { text += d; });
    probe.stderr.on('data', d => { errText += d; });
    const until = Date.now() + 25000;
    while (!/127\.0\.0\.1:(\d+)/.test(text) && probe.exitCode === null && Date.now() < until) await delay(30);
    try {
      assert.match(text, /127\.0\.0\.1:(\d+)/, `包装脚本没能把包内 daemon 起来：rc=${probe.exitCode} stderr=${errText}`);
      const port = Number(text.match(/127\.0\.0\.1:(\d+)/)[1]);
      const r = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(10000) });
      assert.equal(r.status, 200, '装出来的 daemon 应能答 /health');
    } finally {
      probe.kill('SIGKILL');
      await Promise.race([new Promise(res => probe.on('close', res)), delay(3000)]);
    }
  } finally {
    await rmBounded(staged);
  }
});

test('npm 主包声明 daemon 入口，包装脚本只认包内路径且缺包即响亮失败', async () => {
  const pkg = JSON.parse(await readFile(path.join(root, 'npm', 'sacode-cli', 'package.json'), 'utf8'));
  assert.ok(pkg.bin?.['sacode-daemon'], `主包必须提供 daemon 入口，否则同包交付到此为止：${JSON.stringify(pkg.bin)}`);
  const rel = pkg.bin['sacode-daemon'];
  assert.ok(pkg.files.includes(rel), `入口脚本没进 files 清单：${JSON.stringify(pkg.files)}`);
  const wrapper = path.join(root, 'npm', 'sacode-cli', rel);
  assert.ok(fs.existsSync(wrapper), `入口脚本不存在：${wrapper}`);
  // 仓库里没有装好的平台包可解析时，必须失败退出而不是去找 PATH 上的全局 daemon。
  const work = await mkdtemp(path.join(root, 'target', 'sacode-wrapper-'));
  try {
    const r = spawnSync(process.execPath, [wrapper, '--help'], { cwd: work, env: sdkFreeEnv(), encoding: 'utf8' });
    assert.equal(r.status, 79, `解析不到平台包应回 79，实际 ${r.status}：${r.stderr}`);
    assert.match(r.stderr, /解析不到平台包/, `失败信息要说清缺的是平台包本身：${r.stderr}`);
    assert.ok(!/usage|Usage/.test(r.stdout), `不该在缺包时把参数透传给某个全局可执行：${r.stdout}`);
    // 第二种缺法：装了平台包但包里没有 daemon（旧 pack-cli 出的残缺包）。归因必须不同，
    // 因为处置相反——前者重装即可，后者光重装不会改变任何东西。
    const half = path.join(work, 'half');
    await mkdir(path.join(half, 'node_modules', '@stand-alone', 'sacode-win32-x64'), { recursive: true });
    await copyFile(path.join(root, 'npm', 'sacode-cli-win32-x64', 'package.json'),
      path.join(half, 'node_modules', '@stand-alone', 'sacode-win32-x64', 'package.json'));
    const nested = path.join(half, 'npm', 'sacode-cli', 'bin');
    await mkdir(nested, { recursive: true });
    await copyFile(wrapper, path.join(nested, 'daemon.js'));
    const r2 = spawnSync(process.execPath, [path.join(nested, 'daemon.js'), '--help'], { cwd: half, env: sdkFreeEnv(), encoding: 'utf8' });
    assert.equal(r2.status, 82, `装了包但缺 daemon 应回 82，实际 ${r2.status}：${r2.stderr}`);
    assert.match(r2.stderr, /pack-service/, `这条缺法要指到补包脚本：${r2.stderr}`);
  } finally {
    await rmBounded(work);
  }
});
