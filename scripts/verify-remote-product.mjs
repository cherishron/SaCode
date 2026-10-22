#!/usr/bin/env node
// 任务 11 的交付验收执行器：把「产品到底能不能算完成」写成一张**每次真跑**的表，
// 而不是清单勾。输出每行 = 一项检查 + PASS/FAIL/BLOCKED + 取证态（提交副本还是工作区）
// + 命令 + 计数 + rc + 缺失前提。规矩：
//  * 不出百分比、不出日期、不写「大概能上」——只报实跑读数。
//  * 任何 Linux / 安全执行 / 移动真实运行门槛没过，总体就是 FAIL 或 BLOCKED，
//    绝不按缩范围发布「完整支持」（计划 §11 第 7 条）。
//  * BLOCKED 必须点名缺的前提和解锁动作；FAIL 必须点名实得读数。
// 用法：node scripts/verify-remote-product.mjs [--json] [--keep-worktree] [--only-build]
//   --only-build 只跑仓颉四模块编译读数，不跑任何测试套件（便宜地复验这一道门）
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, rmSync, mkdtempSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const asJson = process.argv.includes('--json');
const keepWorktree = process.argv.includes('--keep-worktree');
const onlyBuild = process.argv.includes('--only-build');
// 编译读数默认真跑。SACODE_SKIP_BUILD=1 只跳过、不放行（留一行 BLOCKED）；
// SACODE_BUILD_TIMEOUT_MS 覆盖单模块超时（host 体量大，默认 15 分钟）。
const skipBuild = process.env.SACODE_SKIP_BUILD === '1';
const buildTimeoutMs = Number(process.env.SACODE_BUILD_TIMEOUT_MS || 900000);
const rows = [];

const textOf = (p) => existsSync(p) ? readFileSync(p, 'utf8') : '';

function record(item, status, fields) {
  rows.push({ item, status, ...fields });
}

function sha256(file) {
  if (!existsSync(file)) return null;
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

// 跑一条命令，收 stdout/stderr 尾部与 rc；超时视为 FAIL 而不是「没跑」。
function run(cmd, args, opts = {}) {
  return new Promise(resolve => {
    const child = spawn(cmd, args, { cwd: opts.cwd || root, stdio: ['ignore', 'pipe', 'pipe'], env: process.env, detached: process.platform !== 'win32' });
    let out = '';
    let err = '';
    let timedOut = false;
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { err += d; });
    const timer = setTimeout(() => {
      timedOut = true;
      if (process.platform === 'win32' && child.pid) {
        // 只结束本次 spawn 的树，否则 cjc 继承 pipe 会让 close 永远不来。
        try { execFileSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' }); } catch { child.kill(); }
      } else if (child.pid) {
        try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
      }
    }, opts.timeoutMs || 180000);
    child.on('error', error => {
      clearTimeout(timer);
      resolve({ rc: null, out, err: error.message, timedOut: false });
    });
    child.on('close', code => {
      clearTimeout(timer);
      resolve({ rc: code, out, err, timedOut });
    });
  });
}

// 从 node --test 的输出里取真计数。剥 ANSI 后只认末尾的 `# tests N` 等行，
// 不用匹配 [ PASSED ] 计数（颜色转义会把 token 劈开）。
function nodeTestCounts(text) {
  const clean = text.replace(/\x1b\[[0-9;]*m/g, '').replace(/\r/g, '');
  const pick = (key) => {
    const m = clean.match(new RegExp(`^# ${key} (\\d+)$`, 'm'));
    return m ? Number(m[1]) : null;
  };
  return { tests: pick('tests'), pass: pick('pass'), fail: pick('fail'), cancelled: pick('cancelled'), skipped: pick('skipped') };
}

// 仓颉编译器的计数口径：只认 "N warnings generated" / "N errors generated" 汇总行；
// 报错另按 `==> 文件:行:列` 抽出位置，好把「编译不过」指到具体文件，而不是只留一句 rc。
function cangjieCounts(text) {
  const clean = text.replace(/\x1b\[[0-9;]*m/g, '').replace(/\r/g, '');
  const sum = (key) => {
    const m = [...clean.matchAll(new RegExp(`(\\d+) ${key} generated`, 'g'))];
    return m.length ? m.reduce((n, match) => n + Number(match[1]), 0) : null;
  };
  return {
    warnings: sum('warnings?'),
    errors: sum('errors?'),
    files: [...new Set([...clean.matchAll(/==>[^\r\n]*?([A-Za-z0-9_.\-]+\.cj):(\d+):\d+/g)].map(m => `${m[1]}:${m[2]}`))],
  };
}

// 每个模块在**固定提交副本**里、用独立 --target-dir 编译：不碰共享的 core/target/release
// （并发会话共用会互锁，AGENTS.md 记 2026-10-12 两次 cjc 卡死），日志留在主仓 target/ 便于复核。
async function buildMember(wt, label, dir) {
  const logDir = path.join(root, 'target/tmp', 'sacode-verify-build');
  mkdirSync(logDir, { recursive: true });
  const logFile = path.join(logDir, `${label}.log`);
  // 每个成员独立 target，单成员产物均叫 main，不能相互覆盖。
  const res = await run('cjpm', ['build', '--target-dir', path.join(wt, 'target', 'verify', label)],
    { cwd: path.join(wt, dir), timeoutMs: buildTimeoutMs });
  const text = res.out + '\n' + res.err;
  writeFileSync(logFile, text);
  return { ...res, counts: cangjieCounts(text), logFile };
}

// ── 仓颉四模块生产构建 ────────────────────────────────────────────────
// 必须放在固定提交副本里编译，不能用工作区读数：工作区可能已被未入库改动「修绿」
// （apps/daemon 的调度文件就是工作区已删、提交态仍坏，且曾长期无人发现）。
// 以前这张表只消费已构建产物，模块编译不过会被降级成「缺产物 → BLOCKED」，编译门形同虚设。
const CANGJIE_MEMBERS = [['core', 'core'], ['cli', 'apps/cli'], ['host', 'apps/host'], ['daemon', 'apps/daemon']];

async function recordCangjieBuilds(gitSha) {
  if (skipBuild) {
    record('仓颉四模块生产构建', 'BLOCKED', {
      tree: 'n/a', command: '固定提交副本内逐模块 cjpm build',
      missing: '本次以 SACODE_SKIP_BUILD=1 跳过；未编译不等于通过',
    });
    return;
  }
  const temporary = path.join(root, 'target/tmp');
  mkdirSync(temporary, { recursive: true });
  const copy = mkdtempSync(path.join(temporary, 'sacode-verify-build-copy-'));
  const wt = path.join(copy, 'head');
  try {
    execFileSync('git', ['worktree', 'add', '--detach', wt, gitSha], { cwd: root });
    // 依赖不是源码；给提交副本显式 provision 同一份 SDK/stdx/native 库。
    if (existsSync(path.join(root, '.deps'))) symlinkSync(path.join(root, '.deps'), path.join(wt, '.deps'), process.platform === 'win32' ? 'junction' : 'dir');
  } catch (e) {
    rmSync(copy, { recursive: true, force: true });
    record('仓颉四模块生产构建', 'BLOCKED', {
      tree: 'n/a', command: `git worktree add --detach <tmp> ${gitSha.slice(0, 8)}`,
      missing: `建固定提交副本失败：${e.message}`,
    });
    return;
  }
  try {
    for (const [label, dir] of CANGJIE_MEMBERS) {
      const r = await buildMember(wt, label, dir);
      const failed = r.timedOut || r.rc !== 0 || (r.counts.errors || 0) > 0;
      const detail = r.timedOut
        ? `${Math.round(buildTimeoutMs / 1000)} 秒仍未编译完，被杀；未取得编译结论`
        : `rc=${r.rc}；warnings generated=${r.counts.warnings ?? '无汇总行'}；`
          + `errors generated=${r.counts.errors ?? '无汇总行'}`
          + (r.counts.files.length ? `；报错位置 ${r.counts.files.slice(0, 6).join('、')}` : '');
      record(`仓颉生产构建：${label}`, failed ? 'FAIL' : 'PASS', {
        tree: `提交态 ${gitSha.slice(0, 8)}`,
        command: `cd ${dir} && cjpm build --target-dir <副本>/target/verify/${label}`,
        detail,
        missing: failed ? `编译日志 ${path.relative(root, r.logFile)}` : '',
      });
    }
  } finally {
    if (!keepWorktree) {
      try { execFileSync('git', ['worktree', 'remove', '--force', wt], { cwd: root }); } catch (e) { /* 留痕即可 */ }
      try {
        rmSync(copy, { recursive: true, force: true });
      } catch (e) {
        // 超时被杀的 cjc 可能仍占着副本文件；此时不能假装清理成功，要点名残留路径。
        record('固定提交副本清理', 'BLOCKED', {
          tree: 'n/a', command: `git worktree remove --force ${wt} && 删除 ${copy}`,
          missing: `副本清理失败：${e.message}；需手工执行 git worktree remove --force ${wt}`,
        });
      }
    }
  }
}

async function main() {
  // ── 1. 取证基线：SHA、构建产物摘要、工作区是否干净 ────────────────────
  const gitSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root }).toString().trim();
  const porcelain = execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: root }).toString();
  const dirtyCount = porcelain.split('\n').filter(l => l.trim().length > 0).length;
  const daemonExe = path.join(root, 'apps/daemon/target/release/bin/main.exe');
  const hostExe = path.join(root, 'apps/desktop/dist/host/bin/sacode-host.exe');
  const digests = {
    daemonExe: sha256(daemonExe),
    hostExe: sha256(hostExe),
  };
  record('取证基线', dirtyCount === 0 ? 'PASS' : 'BLOCKED', {
    tree: dirtyCount === 0 ? `提交态 ${gitSha}` : `工作区态（${dirtyCount} 个已跟踪文件未提交）`,
    sha: gitSha,
    digests,
    detail: dirtyCount === 0 ? '工作区与 HEAD 一致'
      : '多客户端验收行只能在**工作区态**取，其中含并发会话未落库的改动；提交态读数需等它们落库',
  });

  // ── 1.5 仓颉四模块生产构建（固定提交态，不是工作区） ──────────────────
  await recordCangjieBuilds(gitSha);
  if (onlyBuild) {
    const verdict = decide(rows);
    emit(gitSha, dirtyCount, verdict);
    process.exit(verdict === 'PASS' ? 0 : 1);
  }

  // ── 2. 固定提交隔离副本：不含未入库源码，且在副本里跑纯源码套件 ─────────
  const copy = mkdtempSync(path.join(root, 'target/tmp', 'sacode-verify-copy-'));
  const wt = path.join(copy, 'head');
  let copyStatus = 'FAIL';
  let copyDetail = '';
  let copyDirty = null;
  try {
    execFileSync('git', ['worktree', 'add', '--detach', wt, gitSha], { cwd: root });
    const dirtyRaw = execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: wt }).toString().trim();
    copyDirty = dirtyRaw.length === 0;
    const extjs = await run('node', ['--test'], { cwd: path.join(wt, 'extjs'), timeoutMs: 120000 });
    const extjsCounts = nodeTestCounts(extjs.out + extjs.err);
    // 副本里只跑「不吃构建产物」的套件：pack-service 那批用例要合成 node_modules 与
    // target/ 下的真产物，而 target/、renderer/vendor/ 都在 .gitignore 里，副本天生没有，
    // 把它们算进提交态读数只会把产物缺失误报成源码失败。
    const naming = await run('node', ['--test', 'scripts/sacode-naming.test.mjs'],
      { cwd: wt, timeoutMs: 120000 });
    const namingCounts = nodeTestCounts(naming.out + naming.err);
    const namingReds = [...(naming.out + naming.err).replace(/\x1b\[[0-9;]*m/g, '')
      .matchAll(/^not ok \d+ - (.+)$/gm)].map(m => m[1].trim());
    const contract = await run('node', ['--test', 'apps/daemon/test/remote-capability-contract.test.mjs'],
      { cwd: wt, timeoutMs: 120000 });
    const contractCounts = nodeTestCounts(contract.out + contract.err);
    const ok = copyDirty && extjs.rc === 0 && extjsCounts.tests > 0
      && extjsCounts.fail === 0 && namingCounts.tests > 0 && namingCounts.fail === 0
      && contractCounts.tests > 0 && contractCounts.fail === 0;
    copyStatus = ok ? 'PASS' : 'FAIL';
    copyDetail = `副本 git status 干净=${copyDirty}; `
      + `extjs tests=${extjsCounts.tests} pass=${extjsCounts.pass} fail=${extjsCounts.fail} rc=${extjs.rc}; `
      + `命名与桥面契约 tests=${namingCounts.tests} pass=${namingCounts.pass} fail=${namingCounts.fail} rc=${naming.rc}; `
      + `能力契约静态对账 tests=${contractCounts.tests} pass=${contractCounts.pass} fail=${contractCounts.fail} rc=${contract.rc}`
      + (namingReds.length > 0 ? `；提交态红的具体用例：${namingReds.join('、')}` : '');
  } catch (e) {
    copyStatus = 'FAIL';
    copyDetail = `建副本或跑副本失败：${e.message}`;
  }
  record('固定提交隔离副本内的源码套件', copyStatus, {
    tree: `提交态 ${gitSha}`,
    command: `git worktree add --detach <tmp> ${gitSha.slice(0, 8)} && (cd extjs && node --test) && node --test scripts/sacode-naming.test.mjs apps/daemon/test/remote-capability-contract.test.mjs`,
    detail: copyDetail + (keepWorktree ? ` [副本保留于 ${wt}]` : ''),
    missing: copyStatus === 'PASS' ? '' : '见 detail 的实得读数',
  });
  if (!keepWorktree) {
    try { execFileSync('git', ['worktree', 'remove', '--force', wt], { cwd: root }); } catch (e) { /* 留痕即可 */ }
    rmSync(copy, { recursive: true, force: true });
  }

  // ── 3. 一台实例 × 两台设备的产品面（真 TLS daemon，工作区态） ──────────
  const daemonReady = digests.daemonExe !== null;
  let listenerOk = false;
  if (!daemonReady) {
    record('一台实例多客户端产品面', 'BLOCKED', {
      tree: 'n/a', command: 'node --test --test-concurrency=1 apps/daemon/test/remote-product.test.mjs',
      missing: '缺 apps/daemon/target/release/bin/main.exe（先 cd apps/daemon && cjpm build）',
    });
  } else {
    const res = await run('node', ['--test', '--test-concurrency=1', 'apps/daemon/test/remote-product.test.mjs'],
      { cwd: root, timeoutMs: 420000 });
    const c = nodeTestCounts(res.out + res.err);
    const failedCases = [...(res.out + res.err).replace(/\x1b\[[0-9;]*m/g, '')
      .matchAll(/^not ok \d+ - (.+)$/gm)].map(m => m[1].trim());
    const knownDefect = failedCases.some(n => n.includes('带外撤销一台'));
    listenerOk = failedCases.length === 0 || !failedCases.some(n => n.includes('监听端口'));
    record('一台实例多客户端产品面', c.fail === 0 ? 'PASS' : 'FAIL', {
      tree: `工作区态（daemon 摘要 ${digests.daemonExe?.slice(0, 12)}）`,
      command: 'node --test --test-concurrency=1 apps/daemon/test/remote-product.test.mjs',
      counts: c, rc: res.rc,
      detail: knownDefect
        ? `红的是已知缺陷：core/src/remote_identity.cj 撤销一台会抬全局 revocationVersion，把整台实例的在途令牌同时作废。失败用例：${failedCases.join('、')}`
        : `实得失败用例：${failedCases.join('、') || '无'}`,
      missing: knownDefect ? '解锁动作：撤销只抬该设备的版本（该文件被并发会话持有，本目标未改）' : '',
    });
  }

  // ── 4. 反向结果登记：每类失守必须有具名受害用例，且能在测试源里找到 ─────
  const REGISTRY = [
    ['认证失守', '带外撤销一台', ['apps/daemon/test/remote-product.test.mjs']],
    ['认证门禁（缺 Bearer / 错凭据）', '未认证的 execute 请求只拿到认证拒因', ['apps/daemon/test/remote-execution-gate.test.mjs']],
    ['权限过滤失守', '铺开转发不等于放开授权', ['apps/daemon/test/remote-method-surface.test.mjs']],
    ['沙箱透传', '契约里 execute 一族在没有 OS 强制后端时被整族拒绝', ['apps/daemon/test/remote-execution-gate.test.mjs']],
    ['幂等失守', '同 operationId 换内容按冲突拒', ['apps/daemon/test/remote-idempotency.test.mjs']],
    ['会话归属失守', '补读按 sessionId 归属', ['apps/daemon/test/remote-events.test.mjs']],
    ['epoch 失守', '代次不符与游标越界都回显式 gap', ['apps/daemon/test/remote-events.test.mjs']],
    ['断连恢复丢事件', '带 Last-Event-ID 重连', ['apps/daemon/test/remote-sse-recovery.test.mjs']],
    ['凭据泄漏到审计', '两台设备混跑后，审计仍能按 deviceId 定位', ['apps/daemon/test/remote-product.test.mjs']],
  ];
  const corpus = REGISTRY.flatMap(r => r[2]).reduce((acc, rel) => {
    acc[rel] = textOf(path.join(root, rel));
    return acc;
  }, {});
  const missingVictims = [];
  for (const [cls, victim, files] of REGISTRY) {
    const hit = files.some(f => (corpus[f] || '').includes(victim));
    if (!hit) missingVictims.push(`${cls} → 找不到具名用例「${victim}」`);
  }
  record('反向结果登记（每类失守有具名受害用例）', missingVictims.length === 0 ? 'PASS' : 'FAIL', {
    tree: '源码静态对账',
    command: '本脚本内 REGISTRY 与测试源逐条比对',
    detail: `登记 ${REGISTRY.length} 类；缺失 ${missingVictims.length} 类`,
    missing: missingVictims.join('；'),
  });

  // ── 5/6. 需要外部环境才能跑的门槛：如实 BLOCKED，不冒充 ────────────────
  record('Linux 干净包真实运行（任务 2-5 的 Linux 半）', 'BLOCKED', {
    tree: 'n/a', command: '在 Linux 上：cjpm build && node scripts/pack-service.mjs && node scripts/verify-service-package.mjs <pkg>',
    missing: '本机无 Linux；Windows SDK 不能交叉编译 Linux 目标（docs/evidence/2026-10-10-remote-platform-baseline.md §1 退出码 1）。解锁：Linux 主机或 WSL2 发行版',
  });
  record('OS 沙箱强制边界（真实子进程越权五类）', 'BLOCKED', {
    tree: 'n/a', command: '待补：读凭据目录 / 写工作区外 / 未授权网络 / fork-resource 超限 / 取消后逃逸进程',
    missing: '当前构建无任何 OS 强制后端，故 execute 族整族拒绝（批次 J）。解锁后五类用例才有可区分的红',
  });
  // 移动工具链按档位逐个探，不写「缺 gradle」这种整串结论——批次 I 就把在位的 gradle
  // 一起写成了缺（2026-10-10 14:07 复探：Gradle 8.7 + JVM 17.0.2 都在 version-fox 里）。
  // version-fox 给的是 shell 包装（没有 .exe），不经 shell 直接 spawn 会 ENOENT——
  // 第一版探针就因此把在位的 gradle 报成缺失，必须经 ComSpec 走。
  const shell = process.env.ComSpec || 'cmd.exe';
  const probe = (args) => {
    try { return execFileSync(shell, ['/c', ...args], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().replace(/\r/g, '').trim(); }
    catch (e) { return null; }
  };
  const gradleVer = probe(['gradle', '--version']);
  const gradleLine = gradleVer ? (gradleVer.match(/^Gradle .*$/m) || ['Gradle 版本未知'])[0] : null;
  const adbVer = probe(['adb', 'version']);
  const hasAdb = adbVer !== null;
  const deviceList = hasAdb ? (probe(['adb', 'devices']) || '').split('\n').slice(1).filter(l => /\t(device|emulator)/.test(l)).length : 0;
  record('Kuikly 移动工程与三平台真实运行（任务 10）', 'BLOCKED', {
    tree: 'apps/mobile（KMP/Kuikly 工程；源码导入不等于运行验收）', command: 'cd apps/mobile && ./gradlew :androidApp:assembleDebug；另验 Android/鸿蒙真机',
    detail: `gradle=${gradleLine || '缺失'}；ANDROID_HOME=[${process.env.ANDROID_HOME || '未设'}] `
      + `ANDROID_SDK_ROOT=[${process.env.ANDROID_SDK_ROOT || '未设'}]；adb=${hasAdb ? '在位' : '缺失'}；已连设备 ${deviceList} 台`,
    missing: '此处只探测了全局 Gradle、adb 与环境变量，未执行手机工程构建或真机任务；'
      + '源码已纳入 apps/mobile 不等于 Android SDK、签名或鸿蒙工具链已验证。请配置本机 SDK 并另行执行 Wrapper 构建与设备验收；'
      + '缺依赖时须明确报前置条件，不擅自安装。JVM 侧协议用例不代替手机工程及三平台真实运行。',
  });
  // 打包交付链需要构建产物，只能在**工作区态**取；副本没有 target/，不是它失败。
  const pack = await run('node', ['--test', 'scripts/pack-service.test.mjs'], { cwd: root, timeoutMs: 180000 });
  const packCounts = nodeTestCounts(pack.out + pack.err);
  record('打包交付链在工作区态的读数（含构建产物）',
    (pack.rc === 0 && packCounts.fail === 0 && packCounts.tests > 0) ? 'PASS' : 'FAIL', {
      tree: '工作区态',
      command: 'node --test scripts/pack-service.test.mjs',
      counts: packCounts, rc: pack.rc,
      detail: `提交态副本不含这些套件（target/ 与 renderer/vendor/ 都被 gitignore），本行是补充读数不是替代`,
    });
    record('验收安装包仅一套 SaCode 部署（无独立 PC 桥 / 无 SDK 依赖）',
      (listenerOk && copyDirty === 0) ? 'PASS' : 'FAIL', {
      tree: `提交态 ${gitSha.slice(0, 8)} 副本 + 工作区 daemon 进程读数`,
      command: 'node --test apps/daemon/test/remote-product.test.mjs（「交付面只有一个监听端口」那条）',
      detail: listenerOk
        ? '单进程单监听端口且明文面不通——这一子项本身是绿的'
        : '「只有一个监听端口」这条没通过，说明确实多了一颗在别处听的 socket',
      missing: '真·安装包态（npm pack 装进干净目录后跑）未做：发布需另行授权；本行只覆盖进程级单实例面',
    });

  const verdict = decide(rows);
  emit(gitSha, dirtyCount, verdict);
  process.exit(verdict === 'PASS' ? 0 : 1);
}

// 总体判定：只要有一行不是 PASS，总体就不能算通过（不缩范围发布）。
function decide(all) {
  if (all.some(r => r.status === 'FAIL')) return 'FAIL';
  if (all.some(r => r.status === 'BLOCKED')) return 'BLOCKED';
  return 'PASS';
}

function emit(sha, dirty, verdict) {
  if (asJson) {
    process.stdout.write(JSON.stringify({ sha, dirtyTrackedFiles: dirty, verdict, rows }, null, 2) + '\n');
    return;
  }
  const width = Math.max(...rows.map(r => r.item.length));
  process.stdout.write(`取证 SHA ${sha}（已跟踪未提交 ${dirty} 个）\n\n`);
  for (const r of rows) {
    process.stdout.write(`${r.status.padEnd(8)} ${r.item}\n`);
    if (r.tree) process.stdout.write(`         取证态：${r.tree}\n`);
    if (r.command) process.stdout.write(`         命令：${r.command}\n`);
    if (r.counts) process.stdout.write(`         计数：tests=${r.counts.tests} pass=${r.counts.pass} fail=${r.counts.fail} cancelled=${r.counts.cancelled} skipped=${r.counts.skipped} rc=${r.rc}\n`);
    if (r.digests) process.stdout.write(`         摘要：daemon=${r.digests.daemonExe || '缺'} host=${r.digests.hostExe || '缺'}\n`);
    if (r.detail) process.stdout.write(`         实得：${r.detail}\n`);
    if (r.missing) process.stdout.write(`         缺失前提/解锁：${r.missing}\n`);
  }
  process.stdout.write(`\n整体验收：${verdict}\n`);
}

main().catch(e => {
  process.stderr.write(`验收执行器自身失败：${e?.stack || e}\n`);
  process.exit(2);
});
