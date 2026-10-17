#!/usr/bin/env node
// 交付包的**真·安装态**验收：不手工拷文件摆布局，而是 npm 自己 pack、npm 自己 install，
// 再把仓颉 SDK 的 PATH 剥掉跑包内 CLI 与 daemon。批次 H 那份 `pack-service.test.mjs`
// 铺的是合成安装布局（`copyFile` 把 package.json 与 bin 拷进 node_modules 位置），
// 它能证「包装脚本解析到包内那一份」，证不了「tarball 里真的带齐了东西」——
// `files` 白名单漏一项、或打包脚本没把清单带进去，合成布局一律看不出来。
// 用法：node scripts/verify-service-install.mjs [--keep] [--self-test]（后者只做判据反证，不打包）
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const root = path.resolve(import.meta.dirname, '..');
const keep = process.argv.includes('--keep');
const win = process.platform === 'win32';
const EXE = win ? '.exe' : '';

const results = [];
function record(step, ok, detail) {
  results.push({ step, ok, detail });
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${step}  ${detail}\n`);
}

function run(cmd, args, opts = {}) {
  const r = spawnSyncCap(cmd, args, opts);
  return r;
}
function spawnSyncCap(cmd, args, opts) {
  try {
    const out = execFileSync(cmd, args, {
      cwd: opts.cwd || root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
      env: opts.env || process.env, stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { rc: 0, out: out || '', err: '' };
  } catch (e) {
    return { rc: e.status === undefined || e.status === null ? -1 : e.status, out: (e.stdout || '') + '', err: (e.stderr || '') + '' };
  }
}

// 剥 SDK：把仓颉与 stdx 的目录从 PATH 里摘掉。必须在 **JS 里**做——上一轮我在 bash 里
// 用 ';' 重拼 PATH，直接把 sleep/head/grep 全弄丢了，那种红是探针自伤不是被测面失败。
function sdkFreePath() {
  return (process.env.PATH || '').split(path.delimiter)
    .filter(p => p.length > 0 && !/cangjie|stdx-work|cjpm/i.test(p)).join(path.delimiter);
}

// npm 不能直接 spawn `npm.cmd`——Node 在不带 shell 的情况下拉起 .cmd/.bat 会 EINVAL
// （第一版就是这么红的）。改用随 node 分发的 npm-cli.js，走同一条 execPath。
function resolveNpmCli() {
  const candidates = [
    path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(process.env.APPDATA || '', 'npm', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ];
  for (const c of candidates) { if (existsSync(c)) return c; }
  throw new Error(`找不到 npm-cli.js，试过：${candidates.join(' | ')}`);
}
const npmCli = resolveNpmCli();
const npmRun = (args, opts) => run(process.execPath, [npmCli, ...args], opts);

const mainPkg = path.join(root, 'npm', 'sacode-cli');
const platPkg = path.join(root, 'npm', 'sacode-cli-win32-x64');
const platName = JSON.parse(readFileSync(path.join(platPkg, 'package.json'), 'utf8')).name;

// 内容判据抽成纯函数，是为了让 `--self-test` 能喂合成违规进去反证：
// 一台门禁脚本的绿灯如果从没红过，就分不清「包里干净」和「检查根本没执行」。
const SECRET_RE = /instance\.id|audit\.log|\.key$|\.crt$|\.env$|devices\.json/i;
const secretHits = list => list.filter(l => SECRET_RE.test(l));
// 绝对路径泄漏按**内容**判，不按条目名判：npm 打出来的条目一律以 `package/` 打头，
// 「条目名以盘符或 / 开头」这条检查结构上永假，等于没检查（--self-test 把它钉出来了）。
// 前导分隔符类是为了不把 `https://` 里的 `s:` 当成盘符；`/usr/share/zoneinfo` 是运行时
// 自带的时区表，不是本机路径，所以白名单只列 home/Users/Project/var-folders。
const WIN_ABS_RE = /(?:^|[\s"'`=,(])([A-Za-z]:[\\/][^\s"'`)]*)/g;
const NIX_ABS_RE = /(?:^|[\s"'`=,(])((?:\/home|\/Users|\/Project|\/var\/folders)\/[^\s"'`)]*)/g;
const absPathLeaks = text => [...text.matchAll(WIN_ABS_RE), ...text.matchAll(NIX_ABS_RE)].map(m => m[1]);
const MAIN_REQUIRED = ['package/bin/cli.js', 'package/bin/daemon.js', 'package/package.json'];
const missingMainEntries = list => MAIN_REQUIRED.filter(k => !list.includes(k));
// 空清单永远不判通过——上一版就是拿 `filter(...).length === 0` 在 tar 根本没跑出来的
// 情况下打印了「无命中」。
const cleanVerdict = (list, hits) => list.length > 0 && hits.length === 0;
const isTextMember = l => /\.(js|cjs|mjs|json)$/.test(l) && !l.endsWith('.exe') && !l.endsWith('.dll');

function runSelfTest() {
  const cases = [
    // 每项：[名称, 判据实际值, 期望]
    ['秘密文件必须被抓到', secretHits(['package/bin/instance.id', 'package/bin/x']).length === 1, true],
    ['审计日志必须被抓到', secretHits(['package/bin/a.audit.log']).length === 1, true],
    ['设备快照必须被抓到', secretHits(['package/bin/y.devices.json']).length === 1, true],
    ['私钥/证书必须被抓到', secretHits(['package/bin/s.key', 'package/bin/s.crt']).length === 2, true],
    ['正常的 bin 与 dll 不能误报', secretHits(['package/bin/sacode.exe', 'package/bin/libstdx.dll']).length === 0, true],
    ['盘符反斜杠路径要抓到', absPathLeaks('const root = "D:\\Project\\sa"').length === 1, true],
    ['盘符正斜杠路径要抓到', absPathLeaks('const dll = "C:/Users/jingg/stdx-work"').length === 1, true],
    ['POSIX home 要抓到', absPathLeaks('const t = "/home/jingg/x"').length === 1, true],
    ['POSIX Users 要抓到', absPathLeaks('const t = "/Users/jingg/x"').length === 1, true],
    ['https 的冒号不能误报成盘符', absPathLeaks('let u = "https://api.deepseek.com/v1"').length === 0, true],
    ['http 的冒号不能误报成盘符', absPathLeaks('fetch("http://127.0.0.1:1/t")').length === 0, true],
    ['包内相对路径不能误报', absPathLeaks('"path":"bin/sacode.exe"').length === 0, true],
    ['时区表不是本机路径不能误报', absPathLeaks('"/usr/share/zoneinfo/etc/localtime"').length === 0, true],
    ['入口缺失必须点名缺的是哪条', missingMainEntries(['package/package.json']).join(',') === 'package/bin/cli.js,package/bin/daemon.js', true],
    ['入口齐时不该有缺失', missingMainEntries(MAIN_REQUIRED).length === 0, true],
    // 反向：空集合的内容判据都必须判不过，否则「无命中」就是假绿。
    ['空文本不得判「无绝对路径」通过', cleanVerdict([], absPathLeaks('')), false],
    ['空清单不得判「无秘密」通过', cleanVerdict([], []), false],
    ['有命中时不得判通过', cleanVerdict(['package/bin/instance.id'], secretHits(['package/bin/instance.id'])), false],
    ['非空且无命中才算通过', cleanVerdict(['package/bin/cli.js'], secretHits(['package/bin/cli.js'])), true],
  ];
  let bad = 0;
  for (const [name, got, want] of cases) {
    const ok = got === want;
    if (!ok) bad += 1;
    process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  反证：${name}（期望 ${want}，实得 ${got}）\n`);
  }
  // 用例集本身为空也是假绿：一条都没有就退出非零。
  if (cases.length === 0) bad = 1;
  process.stdout.write(`\n自检 ${cases.length} 条，判据与期望不符 ${bad} 条\n`);
  return bad === 0 && cases.length > 0 ? 0 : 1;
}

if (process.argv.includes('--self-test')) {
  process.exit(runSelfTest());
}

const work = mkdtempSync(path.join(root, 'target', 'tmp', 'sacode-install-state-'));
const tarballs = path.join(work, 'tarballs');
const installDir = path.join(work, 'install');
readdirSync(work); // 目录确实建起来了

let failed = 0;
function check(step, ok, detail) {
  record(step, ok, detail);
  if (!ok) failed += 1;
}

try {
  // ① 用真实构建产物填平台包
  const packed = run(process.execPath, ['scripts/pack-service.mjs', '--out', path.relative(root, platPkg)]);
  check('pack-service 用真实产物填平台包', packed.rc === 0,
    `rc=${packed.rc} ${(packed.out + packed.err).replace(/\r/g, '').trim().split('\n').pop()}`);

  // ② npm 自己出 tarball（--offline：不许偷偷联网补东西）
  const mkDirs = () => { if (!existsSync(tarballs)) { execFileSync(win ? 'cmd' : 'mkdir', win ? ['/c', 'mkdir', tarballs] : ['-p', tarballs]); } };
  mkDirs();
  const packMain = npmRun(['pack', '--offline', '--no-audit', '--no-fund', '--pack-destination', tarballs], { cwd: mainPkg });
  const packPlat = npmRun(['pack', '--offline', '--no-audit', '--no-fund', '--pack-destination', tarballs], { cwd: platPkg });
  const tarOf = (out) => (out.replace(/\r/g, '').trim().split('\n').pop() || '').trim();
  const mainTar = path.join(tarballs, tarOf(packMain.out));
  const platTar = path.join(tarballs, tarOf(packPlat.out));
  check('npm pack 离线产出两个 tarball', packMain.rc === 0 && packPlat.rc === 0
    && /\.tgz$/.test(mainTar) && existsSync(mainTar) && /\.tgz$/.test(platTar) && existsSync(platTar),
    `main=${path.basename(mainTar)}(rc=${packMain.rc}) plat=${path.basename(platTar)}(rc=${packPlat.rc}) `
    + `${(packMain.err + packPlat.err).replace(/\r/g, '').slice(0, 120)}`);

  // ③ 包内内容清单：角色齐 + 不含秘密与绝对路径
  const listOf = (tar) => spawnList(tar);
  let listErr = '';
  function spawnList(tar) {
    // 不能用绝对路径喂 tar：GNU tar 把 `D:/x.tgz` 里的冒号读成「远程主机:文件」，
    // 报 `Cannot connect to D: resolve failed`（本机实测踩过）。改成在目录内用相对名。
    const r = run('tar', ['-tzf', path.basename(tar)], { cwd: path.dirname(tar) });
    if (r.rc !== 0) { listErr += `${path.basename(tar)} rc=${r.rc} ${(r.err || '').replace(/\r/g, '').slice(0, 120)}; `; return []; }
    return r.out.replace(/\r/g, '').trim().split('\n').filter(l => l.length > 0);
  }
  const mainList = listOf(mainTar);
  const platList = listOf(platTar);
  const missingMain = missingMainEntries(mainList.concat(platList));
  const mainOk = mainList.length > 0 && platList.length > 0 && missingMain.length === 0;
  check('主包 tarball 带齐两个入口与清单', mainOk,
    `主包条目 ${mainList.length} / 平台包条目 ${platList.length}`
    + `${mainOk ? '，两个入口与 package.json 都在' : `，缺：${missingMain.join(',')}`}${listErr ? ` tar 报错：${listErr}` : ''}`);
  const exeName = win ? 'sacode-daemon.exe' : 'sacode-daemon';
  const platHasExe = platList.some(l => l.endsWith(`bin/${exeName}`));
  const platHasManifest = platList.some(l => l.endsWith('bin/service-manifest.json'));
  const dllCount = platList.filter(l => /\.(dll|so)$/.test(l)).length;
  const extCount = platList.filter(l => l.includes('extjs/')).length;
  check('平台包 tarball 带 daemon、清单、运行期库与扩展宿主', platHasExe && platHasManifest && dllCount > 0 && extCount > 0,
    `daemon=${platHasExe} 清单=${platHasManifest} 运行库=${dllCount} 扩展宿主文件=${extCount}`);
  // 空清单不能当「没有秘密」的证据：这两条必须建立在清单非空之上，否则就是假绿。
  const corpusNonEmpty = mainList.length > 0 && platList.length > 0;
  const secretHit = secretHits(platList.concat(mainList));
  check('两个 tarball 都不含身份/审计/密钥类文件', cleanVerdict(platList.concat(mainList), secretHit),
    corpusNonEmpty ? (secretHit.length === 0 ? '无命中' : `命中：${secretHit.join(', ')}`) : '清单为空，不判通过');
  // ③b 真判据在内容侧：把两个 tarball 的文本成员解出来拼成语料再扫。
  // 语料为空必须判不过——空串扫不出命中不等于包里干净。
  const textOf = (tar, list) => {
    const members = list.filter(isTextMember);
    if (members.length === 0) return { count: 0, bytes: 0, out: '', err: 'tar 里没有 .js/.cjs/.json 成员' };
    const r = run('tar', ['-xzOf', path.basename(tar), ...members], { cwd: path.dirname(tar) });
    return { count: members.length, bytes: (r.out || '').length, out: r.out || '', err: (r.err || '').replace(/\r/g, '').slice(0, 120) };
  };
  const tMain = textOf(mainTar, mainList);
  const tPlat = textOf(platTar, platList);
  const corpus = tMain.out + tPlat.out;
  const corpusBytes = tMain.bytes + tPlat.bytes;
  const leak = absPathLeaks(corpus);
  check('包内文本内容不含本机绝对路径', corpusBytes > 0 && leak.length === 0,
    `语料 ${corpusBytes} 字节 / 文本成员 ${tMain.count + tPlat.count} 个（主包 ${tMain.bytes}B + 平台包 ${tPlat.bytes}B）`
    + `${corpusBytes === 0 ? `，抽取失败：${tMain.err} ${tPlat.err}` : (leak.length === 0 ? '，无泄漏' : `，泄漏：${leak.slice(0, 3).join(' | ')}`)}`);

  // ④ npm 自己 install（离线，两个 tarball 一起给）
  if (!existsSync(installDir)) execFileSync(win ? 'cmd' : 'mkdir', win ? ['/c', 'mkdir', installDir] : ['-p', installDir]);
  const inst = npmRun(['install', '--offline', '--no-audit', '--no-fund', mainTar, platTar], { cwd: installDir });
  const nm = path.join(installDir, 'node_modules');
  const installedMain = path.join(nm, '@stand-alone', 'sacode');
  const installedPlat = path.join(nm, ...platName.split('/'));
  check('npm install 离线装出两个包', inst.rc === 0 && existsSync(installedMain) && existsSync(installedPlat),
    `rc=${inst.rc} 主包=${existsSync(installedMain)} 平台包=${existsSync(installedPlat)}`);
  const binShims = existsSync(path.join(nm, '.bin')) ? readdirSync(path.join(nm, '.bin')) : [];
  check('npm 生成了 sacode 与 sacode-daemon 两个命令 shim',
    binShims.some(s => /^sacode(\.cmd|\.ps1)?$/.test(s)) && binShims.some(s => /^sacode-daemon(\.cmd|\.ps1)?$/.test(s)),
    `.bin: ${binShims.join(', ')}`);

  // ⑤ 剥 SDK 后，包内 daemon 真能起来并答 /health
  const stripped = { ...process.env, PATH: sdkFreePath(), SACODE_USER_SETTINGS_DIR: path.join(work, 'settings') };
  check('探针自证：剥掉的 SDK 里 cjc 确实不可见',
    run(win ? 'cmd' : 'which', win ? ['/c', 'where', 'cjc'] : ['cjc'], { env: stripped }).rc !== 0,
    '在剥过的 PATH 下 cjc 不可达（否则这条读数没意义）');
  const daemonScript = path.join(installedMain, 'bin', 'daemon.js');
  const child = spawn(process.execPath, [daemonScript, '--port', '0'], {
    cwd: installDir, env: stripped, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let dOut = '';
  let dErr = '';
  child.stdout.on('data', d => { dOut += d; });
  child.stderr.on('data', d => { dErr += d; });
  const deadline = Date.now() + 25000;
  while (!/127\.0\.0\.1:(\d+)/.test(dOut) && child.exitCode === null && Date.now() < deadline) await sleep(50);
  const m = dOut.match(/127\.0\.0\.1:(\d+)/);
  let health = '未起';
  if (m) {
    try {
      const res = await fetch(`http://127.0.0.1:${m[1]}/health`, { signal: AbortSignal.timeout(8000) });
      health = `${res.status} ${(await res.text()).slice(0, 60)}`;
    } catch (e) { health = `ERR ${e.message}`; }
  }
  check('包内 daemon 在无 SDK 环境下起来并答 /health', /200/.test(health),
    `端口 ${m ? m[1] : '未宣布'}，/health=${health}，stderr=${dErr.replace(/\r/g, '').slice(0, 160)}`);
  child.kill('SIGKILL');
  for (let i = 0; i < 40 && child.exitCode === null; i += 1) await sleep(50);

  // 包内 CLI 自测子命令在同样剥 SDK 的环境下跑完。
  // 计数纪律：`FAILURES=N` 是这份自测自己的汇总行，不能算成一条 FAIL；
  // 同时把它与实数 FAIL 行交叉核对，对不上就是自测输出形状变了（要响）。
  const cli = run(process.execPath, [path.join(installedMain, 'bin', 'cli.js'), 'all'], { cwd: installDir, env: stripped });
  const passCount = (cli.out.match(/^PASS /gm) || []).length;
  const failLines = (cli.out.match(/^FAIL .*$/gm) || []).map(l => l.trim());
  const summary = (cli.out.match(/^FAILURES=(\d+)$/m) || [])[1];
  // 把产物的 gitSha 与 mtime 打在读数里：包内 CLI 是构建产物，旧产物造的红
  // 不能冒充源码级失败（这一批就撞过一次）。
  const manifestPath = path.join(installedPlat, 'bin', 'service-manifest.json');
  let builtFor = '清单缺失';
  const installedCliExe = path.join(installedPlat, 'bin', 'sacode.exe');
  const exeMtime = existsSync(installedCliExe) ? statSync(installedCliExe).mtime.toISOString() : '无';
  if (existsSync(manifestPath)) {
    try {
      const man = JSON.parse(readFileSync(manifestPath, 'utf8'));
      // 清单里没有 generatedAt 字段（实测键：schemaVersion/platform/arch/gitSha/roles/files），
      // 所以「是否旧产物」只能靠包内 exe 的 mtime 判，别把不存在的字段读成 '?' 当证据。
      builtFor = `gitSha=${man.gitSha || '?'} 平台=${man.platform || '?'}/${man.arch || '?'} 包内 exe mtime=${exeMtime}`;
    } catch (e) { builtFor = `清单解析失败 ${e.message}`; }
  }
  check('包内 CLI 的 all 子命令无 FAIL 且有 PASS',
    cli.rc === 0 && failLines.length === 0 && passCount > 0 && summary === '0',
    `rc=${cli.rc} ^PASS=${passCount} ^FAIL=${failLines.length} 汇总行 FAILURES=${summary ?? '无'}；${builtFor}；具体：${failLines.slice(0, 4).join(' | ').slice(0, 200)}`);
} finally {
  if (keep) {
    process.stdout.write(`\n一次性目录保留在 ${work}（--keep）\n`);
  } else {
    for (let i = 0; i < 10; i += 1) {
      try { rmSync(work, { recursive: true, force: true }); break; }
      catch (e) { if (e.code !== 'EBUSY' && e.code !== 'EPERM' && e.code !== 'ENOTEMPTY') throw e; await sleep(200); }
    }
  }
}

const rows = results.length;
const okRows = results.filter(r => r.ok).length;
process.stdout.write(`\n共 ${rows} 步，PASS ${okRows}，FAIL ${failed}\n`);
process.exit(failed === 0 ? 0 : 1);
