// 步骤 1「当前改动集成验收」的可复跑门禁：在飞/暂存路径 ↔ §1 归属表 ↔ 临时输出。
// 判据行以 GATE: 结尾；rc 0=PASS 1=FAIL 2=取不到输入 3=自检壳错误。
// 用法：node docs/qa/check-inflight-ownership.cjs [repoRoot] [--selftest]
// 为什么放 docs/qa/：§1 表把 dir scripts/ 记给 A（check_path_ownership 的 scripts-owned-by-a 是硬判据），
// 这是 QA 侧的只读验收壳，不占公共构建面。
// 这是「收口时刻」的门禁：开发中途未登记属正常态，所以它只在合入前跑，红了不许绕过。
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const OWNERSHIP = 'docs/plans/w00-path-ownership-and-isolation-2026-10-06.md';
const MATRIX = 'docs/plans/dsh-capability-matrix.md';
const SRC_EXT = ['cj', 'ts', 'tsx', 'js', 'mjs', 'cjs', 'vue', 'css', 'json', 'ps1', 'md'];
// 临时输出的判据不是「扩展名是 txt」，而是「仓根或模块根的裸转储」：
// 实测有 o.txt / test-output.txt / .qoder-el-*.txt / core/ct3.txt / cto2.txt / build-check.txt 这类形态。
const TEMP_NAME = /(^|\/)(?:\.?[a-z0-9_-]*(?:cto\d*|ct\d|build-check|o|test-output|output|out|dump|log|\.qoder-el-[a-z]+|\.test-out\d))\.(?:txt|log|err)$/i;
const TEMP_DIR = /(^|\/)(?:\.tmp-test|target|dist|node_modules|dualtest|protocol-bridge-dbg)(?:\/|$)/;
const TEMP_ROOT_TXT = /^[^/]+\.txt$/;

function parseOwnership(text) {
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t.startsWith('|') || !t.endsWith('|')) continue;
    const c = t.slice(1, -1).split('|').map((x) => x.trim());
    if (c.length !== 4) continue;
    const [m, p, ty, pa] = c;
    if (!/^[A-I]$/.test(m) || !/^W\d\d$/.test(p) || !/^(file|dir)$/.test(ty)) continue;
    rows.push({ m, p, ty, pa });
  }
  return rows;
}

function ownerOf(rows, p) {
  let best = null;
  for (const r of rows) {
    const rp = r.pa.replace(/\/$/, '');
    const hit = r.ty === 'dir' ? (p === rp || p.startsWith(rp + '/')) : p === rp;
    if (hit && (!best || rp.length > best.k.length)) best = { m: r.m, p: r.p, k: rp };
  }
  return best;
}

function parseStatus(text) {
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.length < 4) continue;
    const xy = line.slice(0, 2);
    const p = line.slice(3).replace(/^"|"$/g, '').split('\\').join('/');
    if (!p) continue;
    out.push({ xy, index: xy[0], work: xy[1], p });
  }
  return out;
}

function audit(root, statusText, ownershipText, ignoreText) {
  const rows = parseOwnership(ownershipText);
  const list = parseStatus(statusText);
  const ignored = [];
  for (const line of (ignoreText || '').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#') || t.startsWith('!')) continue;
    ignored.push(t.replace(/\/$/, ''));
  }
  const isIgnored = (p) => ignored.some((g) => p === g || p.startsWith(g + '/') || p.endsWith('/' + g) || p.startsWith(g));

  const checks = [];
  const add = (name, level, detail) => checks.push({ name, level, detail });

  // 输入取不到就等于「全部路径都有主」被静默当成已证 —— 空读数必须自己报红灯。
  if (!rows.length) return [{ name: 'ownership-rows-parsed', level: 'FAIL', detail: '§1 表解析出 0 行归属，无法判主责' }];
  if (!list.length) return [{ name: 'status-parsed', level: 'FAIL', detail: 'git status 取到 0 条在飞路径，不能据此判验收通过' }];
  add('ownership-rows-parsed', 'OK', `§1 表解析出 ${rows.length} 行归属`);
  add('status-parsed', 'OK', `在飞/暂存条目 ${list.length} 条`);

  const inflight = list.filter((e) => e.p.split('/').pop().includes('.'));
  const unowned = inflight.filter((e) => !ownerOf(rows, e.p));
  const am = list.filter((e) => e.index === 'A' && e.work === 'M');
  const tempTracked = list.filter((e) => !isIgnored(e.p) && (TEMP_NAME.test(e.p) || (TEMP_ROOT_TXT.test(e.p) && e.p.includes('.'))));
  const tempDirLeak = list.filter((e) => !isIgnored(e.p) && TEMP_DIR.test(e.p));
  const matrixDirty = list.some((e) => e.p === MATRIX && (e.index === 'M' || e.work === 'M'));

  add('owner-registered', unowned.length ? 'FAIL' : 'OK',
    unowned.length ? `${unowned.length} 条在飞路径在 §1 表无归属行: ${unowned.map((e) => `${e.p}[${e.xy.trim()}]`).join(', ')}`
      : '每条在飞路径都能按 §1 表最长前缀找到唯一主责');
  add('temp-output-not-staged', tempTracked.length ? 'FAIL' : 'OK',
    tempTracked.length ? `临时转储进入 index/工作区: ${tempTracked.map((e) => `${e.p}[${e.xy.trim()}]`).join(', ')}`
      : '无根目录裸转储或 cjpm/构建日志被跟踪');
  add('temp-dir-not-staged', tempDirLeak.length ? 'FAIL' : 'OK',
    tempDirLeak.length ? `产物目录出现在未忽略的在飞条目: ${tempDirLeak.map((e) => `${e.p}[${e.xy.trim()}]`).join(', ')}`
      : 'target/dist/node_modules/dualtest/.tmp-test 等产物目录结构上进不来');
  add('staged-worktree-drift', am.length ? 'WARN' : 'OK',
    am.length ? `暂存后工作区又改动（半批风险）: ${am.map((e) => e.p).join(', ')}` : '无 AM 形态条目');
  add('matrix-not-dirty-at-close', matrixDirty ? 'WARN' : 'OK',
    matrixDirty ? '能力矩阵仍有在飞改动：本批收口时刻的账本读数可能与提交态不一致' : '矩阵工作区==提交态');
  return checks;
}

function readStatus(root) {
  try {
    return { text: execFileSync('git', ['status', '--porcelain', '-uall'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }), err: null };
  } catch (e) {
    return { text: '', err: 'git status 失败：' + ((e && e.message) || '').split('\n')[0] };
  }
}

function report(checks) {
  let fail = 0, warn = 0;
  for (const c of checks) {
    if (c.level === 'FAIL') fail++;
    if (c.level === 'WARN') warn++;
    console.log(`${c.level.padEnd(4)} ${c.name}: ${c.detail}`);
  }
  console.log(`GATE: ${fail ? 'FAIL' : (warn ? 'PASS_WITH_WARN' : 'PASS')} (${checks.length} checks, fail=${fail}, warn=${warn})`);
  return fail ? 1 : 0;
}

// 反证：每项检查各注入一处独占违规，要求该项自己的名字新出现。
// 输入是「status 文本 + 归属表文本」，所以探针不需要真动 git。
const BASE_STATUS = [
  'M  core/src/session.cj',
  ' M core/src/plugin_store.cj',
].join('\n');
const BASE_OWNERSHIP = [
  '| A | W00 | dir | scripts/ |',
  '| B | W10 | file | core/src/session.cj |',
  '| C | W20 | file | core/src/plugin_store.cj |',
  '| A | W00 | file | docs/plans/dsh-capability-matrix.md |',
].join('\n');

const PROBES = [
  { check: 'owner-registered', expect: 'FAIL', blurb: '加一条表里没有的在飞源文件',
    status: (s) => s + '\nM  core/src/brand_new_orphan.cj' },
  { check: 'temp-output-not-staged', expect: 'FAIL', blurb: '加一条仓根 cjpm 转储',
    status: (s) => s + '\nA  core/ct9.txt' },
  { check: 'temp-dir-not-staged', expect: 'FAIL', blurb: '加一条没被忽略的产物目录条目',
    status: (s) => s + '\n?? apps/desktop/.tmp-test/run/user-data/db' },
  { check: 'staged-worktree-drift', expect: 'WARN', blurb: '把一条改成 AM（暂存后又改）',
    status: (s) => s.replace(' M core/src/plugin_store.cj', 'AM core/src/plugin_store.cj') },
  { check: 'matrix-not-dirty-at-close', expect: 'WARN', blurb: '追加一条矩阵在飞改动（基线里矩阵是干净的）',
    status: (s) => s + '\n M docs/plans/dsh-capability-matrix.md' },
  { check: 'ownership-rows-parsed', expect: 'FAIL', blurb: '归属表整体取空',
    ownership: () => '' },
  { check: 'status-parsed', expect: 'FAIL', blurb: 'status 读数为空',
    status: () => '' },
];

function selftest() {
  let missed = 0;
  const clean = audit('.', BASE_STATUS, BASE_OWNERSHIP, '');
  const baseFail = new Set(clean.filter((c) => c.level === 'FAIL').map((c) => c.name));
  console.log(`baseline: ${baseFail.size ? 'FAIL 集 [' + [...baseFail].join(',') + ']' : '无 FAIL'}`);
  for (const p of PROBES) {
    const st = p.status ? p.status(BASE_STATUS) : BASE_STATUS;
    const ow = p.ownership ? p.ownership(BASE_OWNERSHIP) : BASE_OWNERSHIP;
    if (p.status && st === BASE_STATUS && !p.ownership) { console.log(`MISSED ${p.check}: 注入串没命中（探针失效）`); missed++; continue; }
    const res = audit('.', st, ow, '');
    // 断言按「该项自己的等级」而不是「FAIL 集里有没有它」：WARN 级检查永远进不了 FAIL 集，
    // 只查 FAIL 会让这两项的反证空转（实测就是这么暴露的）。
    const hit = res.find((c) => c.name === p.check);
    const seen = res.filter((c) => c.level !== 'OK').map((c) => `${c.name}:${c.level}`);
    if (baseFail.has(p.check)) { console.log(`ALREADY-RED ${p.check}: 基线即红，不计入`); continue; }
    if (hit && hit.level === p.expect) console.log(`CAUGHT ${p.check}(${p.expect}): ${p.blurb} → 非 OK 集 [${seen.join(',') || '空'}]`);
    else { console.log(`MISSED ${p.check}: ${p.blurb} → 该项实得 ${hit ? hit.level : '未出现'}（需 ${p.expect}），非 OK 集 [${seen.join(',') || '空'}]`); missed++; }
  }
  console.log(missed ? `GATE: SELFTEST FAIL (missed=${missed})` : `GATE: SELFTEST PASS (${PROBES.length} probes, all CAUGHT)`);
  return missed ? 1 : 0;
}

const argv = process.argv.slice(2);
const root = argv[0] && !argv[0].startsWith('--') ? argv[0] : path.resolve(__dirname, '..', '..');
if (!fs.existsSync(root)) { console.log('用法: node docs/qa/check-inflight-ownership.cjs [repoRoot] [--selftest]'); process.exit(2); }
try {
  if (argv.includes('--selftest')) process.exit(selftest());
  const st = readStatus(root);
  if (st.err) { console.log(`GATE: FAIL status-source: ${st.err}`); process.exit(1); }
  const owns = fs.readFileSync(path.join(root, OWNERSHIP), 'utf8');
  // 不传 .gitignore：`git status -uall` 本身已经排除被忽略的文件，而「被跟踪的产物」正是要报的红。
  process.exit(report(audit(root, st.text, owns, '')));
} catch (e) {
  console.log('GATE: ERROR ' + (e && e.message));
  process.exit(3);
}
