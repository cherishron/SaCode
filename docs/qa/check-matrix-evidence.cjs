// 只读审计：能力矩阵里每条 已复刻=✔/◐ 的行，备注是否真的落到了可复跑的证据上。
// 判据行以 GATE: 结尾；rc 0=PASS 1=FAIL 2=用法/取不到基线 3=自检壳错误。
// 用法：node docs/qa/check-matrix-evidence.cjs [repoRoot] [--selftest] [docPath]
// 放这里而不是 scripts/：§1 表把 dir scripts/ 记给 A（`node scripts/check_path_ownership.cjs`
// 的 scripts-owned-by-a 项），QA 自用的只读审计壳归 I 的 docs/qa/，不占公共构建面。
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const STATES = ['✔', '◐', '☐'];
const NEED_MODULE_ROWS = 63;
const NEED_README_ROWS = 1;
const SRC_EXT = ['cj', 'ts', 'tsx', 'js', 'mjs', 'cjs', 'vue'];

// 与 scripts/check_p0_ownership.cjs 同一套扫描：反引号内的 | 不是分隔符，\| 要还原成 |。
// 朴素 split('|') 会把这种行撕成多列，然后被「列数不等」静默丢弃 —— 丢行的门禁能把发现数压成 0。
function cellsOf(line) {
  const text = line.trim();
  if (!text.startsWith('|') || !text.endsWith('|')) return null;
  const cells = [];
  let current = '';
  let code = false;
  for (let i = 1; i < text.length - 1; i++) {
    const ch = text[i];
    if (ch === '`') { code = !code; current += ch; continue; }
    if (ch === '\\' && text[i + 1] === '|') { current += '|'; i++; continue; }
    if (ch === '|' && !code) { cells.push(current.trim()); current = ''; continue; }
    current += ch;
  }
  cells.push(current.trim());
  return cells;
}

function isSeparator(cells) {
  return cells.length > 0 && cells.every((c) => /^:?-+:?$/.test(c));
}

// 索引来源只认 git：`ls-files -co --exclude-standard` = 已跟踪 + 未跟踪但未被忽略。
// 盲扫文件系统的版本把别的会话开在仓内的 worktree 副本（.qoder/worktrees/*，已 gitignore）收了进来，
// 于是每个基名都「多解 9 处」，真实存在的引用被判成不可证 —— 门禁自己造的假红。
// 用 git 取列表后，被忽略的副本目录结构上进不来，不需要再维护一份 skip 名单。
function buildIndex(root) {
  let out;
  try {
    out = execFileSync('git', ['ls-files', '-co', '--exclude-standard'],
      { cwd: root, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch (e) {
    return { files: [], err: 'git ls-files 失败：' + ((e && e.message) || '').split('\n')[0] };
  }
  const files = out.split(/\r?\n/).filter(Boolean)
    .map((f) => f.split('\\').join('/'))
    .filter((f) => SRC_EXT.includes(path.posix.extname(f).slice(1)));
  return { files, err: files.length ? null : '索引为空（0 个源文件），不能据此判引用存在' };
}

// 三档解析，且把「怎么对上的」如实带出来：根相对 → 唯一后缀 → 唯一基名。
// 多解 = AMBIGUOUS，不能算已证；0 解 = MISSING。
function resolveRef(ref, index) {
  if (index.includes(ref)) return { ok: true, tier: 'root', hits: [ref] };
  const bySuffix = index.filter((f) => f === ref || f.endsWith('/' + ref));
  if (bySuffix.length === 1) return { ok: true, tier: 'suffix', hits: bySuffix };
  if (bySuffix.length > 1) return { ok: false, tier: 'suffix-ambiguous', hits: bySuffix };
  const base = ref.split('/').pop();
  const byBase = index.filter((f) => path.posix.basename(f) === base);
  if (byBase.length === 1) return { ok: true, tier: 'basename', hits: byBase };
  if (byBase.length > 1) return { ok: false, tier: 'basename-ambiguous', hits: byBase };
  return { ok: false, tier: 'missing', hits: [] };
}

function refsOf(text) {
  const out = new Set();
  const re = new RegExp('[`A-Za-z0-9_./-]+\\.(?:' + SRC_EXT.join('|') + ')', 'g');
  for (const m of text.match(re) || []) {
    const cleaned = m.replace(/^[^A-Za-z0-9_./-]+/, '');
    if (cleaned.length > 1) out.add(cleaned);
  }
  return [...out];
}

// 备注可以用四种形式落证据，任一即可销项：
//   文件路径 / 证据文档链接 / 符号名 / 用例条数。
// 只认文件路径的版本会把 `deriveMessages()`、"99/99"、[请求取证边界](../evidence/x.md) 判成「未引用」，
// 那是门禁自己造的假红 —— 矩阵本来就没承诺每行都写路径。
function corpusOf(index, root) {
  let text = '';
  let bytes = 0;
  for (const f of index) {
    let s;
    try { s = fs.readFileSync(path.join(root, f), 'utf8'); } catch { continue; }
    bytes += s.length;
    if (bytes > 48 * 1024 * 1024) return { text: null, why: '源码总量超阈值，符号档跳过' };
    text += s + '\n';
  }
  return { text, why: null };
}

function symbolsOf(note) {
  const out = [];
  for (const m of note.match(/`([A-Za-z_][A-Za-z0-9_]{3,})`/g) || []) {
    const s = m.slice(1, -1);
    if (!/\.(cj|ts|tsx|js|mjs|cjs|vue)$/.test(s)) out.push(s);
  }
  return [...new Set(out)];
}

function evidenceDocs(note, root) {
  const hits = [];
  for (const m of note.match(/\]\(([^)]+\.md)\)/g) || []) {
    const rel = m.slice(2, -1);
    const p = path.posix.normalize(path.posix.join('docs/plans', rel));
    if (fs.existsSync(path.join(root, p))) hits.push(p);
  }
  return hits;
}

function audit(root, docPath) {
  const doc = fs.readFileSync(docPath, 'utf8').split(/\r?\n/);
  const headerIdx = doc.findIndex((l) => {
    const c = cellsOf(l);
    return c && c.includes('模块') && c.includes('已复刻');
  });
  if (headerIdx < 0) {
    return [{ name: 'header-not-found', level: 'FAIL', detail: docPath }];
  }
  const cols = cellsOf(doc[headerIdx]);
  const iName = cols.indexOf('模块');
  const iState = cols.indexOf('已复刻');
  const iNote = cols.indexOf('备注');
  // 状态列/备注列按表头名定位。按下标取列实测造出过「63 行全达标」的假绿。
  if (iState < 0) return [{ name: 'state-column-not-found', level: 'FAIL', detail: cols.join(',') }];
  if (iNote < 0) return [{ name: 'note-column-not-found', level: 'FAIL', detail: cols.join(',') }];

  const ix = buildIndex(root);
  const index = ix.files;
  let corpus;
  const needCorpus = () => { if (corpus === undefined) corpus = corpusOf(index, root); return corpus.text; };
  const shapeBad = [];
  const badState = [];
  const unsub = [];
  const ambiguous = [];
  const noTest = [];
  const dup = new Map();
  let moduleRows = 0;
  let readmeRows = 0;
  const tally = { '✔': 0, '◐': 0, '☐': 0 };

  for (let i = headerIdx + 1; i < doc.length; i++) {
    const cells = cellsOf(doc[i]);
    if (!cells) {
      if (moduleRows > 0) break;
      continue;
    }
    if (isSeparator(cells)) continue;
    if (cells.length !== cols.length) { shapeBad.push(`L${i + 1} 列数 ${cells.length}（表头 ${cols.length}）`); continue; }
    const name = cells[iName];
    if (name === 'README') { readmeRows++; continue; }
    if (!name || name === '—') continue;
    const state = cells[iState];
    if (!STATES.includes(state)) { badState.push(`${name} 状态列取值 ${JSON.stringify(state)}`); continue; }
    moduleRows++;
    tally[state]++;
    dup.set(name, (dup.get(name) || 0) + 1);
    if (state === '☐') continue;

    const note = cells[iNote];
    const hits = refsOf(note).map((r) => ({ r, ...resolveRef(r, index) }));
    const proven = hits.filter((h) => h.ok);
    const amb = hits.filter((h) => !h.ok && h.hits.length > 1);
    const forms = [];
    if (proven.length) forms.push(`文件 ${proven[0].r}`);
    const docs = evidenceDocs(note, root);
    if (docs.length) forms.push(`证据文档 ${docs[0]}`);
    const cnt = note.match(/[1-9]\d*(?:\s*\/\s*[1-9]\d*|\s*条)/);
    if (cnt) forms.push(`用例计数 ${cnt[0].replace(/\s+/g, '')}`);
    const body = needCorpus();
    const sym = body ? symbolsOf(note).find((s) => new RegExp('\\b' + s + '\\b').test(body)) : null;
    if (sym) forms.push(`符号 ${sym}`);
    const ambDetail = `${name} [${state}] ${amb.map((h) => `${h.r}（${h.tier} 多解 ${h.hits.length} 处）`).join('; ')}`;
    if (forms.length === 0) {
      if (amb.length) ambiguous.push(ambDetail);
      const dead = hits.filter((h) => !h.ok);
      unsub.push(`${name} [${state}] 备注里文件/证据文档/符号/用例计数四种形式都没落地` +
        (hits.length ? `（引用 ${dead.map((h) => h.r).join(', ')} 均不可解）` : ''));
      continue;
    }
    if (amb.length) ambiguous.push(ambDetail);
    if (!/_test\.(cj|js)|test\/|\.test\.|--test|冒烟|smoke|用例/.test(note)) noTest.push(`${name} [${state}] 有实现引用但备注未登记测试/用例`);
  }

  const dups = [...dup.entries()].filter(([, n]) => n > 1).map(([n, c]) => `${n}×${c}`);
  const out = [];
  const add = (name, level, detail) => out.push({ name, level, detail });
  // 索引取不到就等于「引用全部存在」被静默当成已证 —— 空索引必须自己报红灯。
  add('index-source', ix.err ? 'FAIL' : 'OK', ix.err || `git ls-files 取到 ${index.length} 个源文件（被忽略的副本目录结构上进不来）`);
  add('row-shape', shapeBad.length ? 'FAIL' : 'OK', shapeBad.join(' | ') || `表体每行列数 ${cols.length}`);
  add('row-denominator',
    (moduleRows === NEED_MODULE_ROWS && readmeRows === NEED_README_ROWS) ? 'OK' : 'FAIL',
    `模块行 ${moduleRows}（需 ${NEED_MODULE_ROWS}）、README 行 ${readmeRows}（需 ${NEED_README_ROWS}）`);
  add('name-unique', dups.length ? 'FAIL' : 'OK', dups.length ? dups.join(', ') : '无重名');
  add('state-column-values-valid', badState.length ? 'FAIL' : 'OK', badState.length ? badState.join(' | ') : `✔${tally['✔']} ◐${tally['◐']} ☐${tally['☐']}`);
  add('ref-ambiguity', ambiguous.length ? 'WARN' : 'OK', ambiguous.join(' | ') || '引用的路径全部唯一可解');
  add('substantiation', unsub.length ? 'FAIL' : 'OK', unsub.join(' | ') || `每条 ✔/◐ 都至少有一条可复跑的出处（文件/证据文档/符号/用例计数）`);
  add('test-note', noTest.length ? 'WARN' : 'OK', noTest.length ? `${noTest.length} 行：${noTest.join(' | ')}` : '每条 ✔/◐ 备注都登记了测试/用例');
  return out;
}

function report(out) {
  let fail = 0;
  let warn = 0;
  for (const c of out) {
    if (c.level === 'FAIL') fail++;
    if (c.level === 'WARN') warn++;
    console.log(`${c.level.padEnd(4)} ${c.name}: ${c.detail}`);
  }
  console.log(`GATE: ${fail ? 'FAIL' : (warn ? 'PASS_WITH_WARN' : 'PASS')} (${out.length} checks, fail=${fail}, warn=${warn})`);
  return fail ? 1 : 0;
}

// 反证：每项检查各注入一处独占违规，要求该项自己的名字新出现。
// 只证绿灯不证红灯的门禁，等于没有门禁。
const PROBES = [
  { check: 'substantiation', blurb: '把一条 ✔ 行的备注换成「待补出处」（四种形式全撤）',
    // 不用「改坏一个文件名」做注入：实测那一行还有符号名与用例计数兜着，substantiation 照样绿，
    // 探针失效会被误读成门禁失效。独占违规要撤掉该行全部证据形式。
    edit: (s) => s.replace(/^\| token-meter \|.*/m, '| token-meter | ✔ | ✔ | M2 | ✔ | ✔ | 待补出处 | I | W10 |') },
  { check: 'row-shape', blurb: '把一行拆成两列（列数与表头不符）',
    edit: (s) => s.replace('| agent-team | ✔ | ✔ | M3 | ✔ | ◐ |', '| agent-team | ✔ |') },
  { check: 'row-denominator', blurb: '删掉一条模块行',
    edit: (s) => s.replace(/^\| boot \|.*\r?\n/m, '') },
  { check: 'state-column-values-valid', blurb: '把状态列写成不认识的符号',
    edit: (s) => s.replace(/^\| approval \| ✔ \| ✔ \| M4 \| ✔ \| ✔ \|/m, '| approval | ✔ | ✔ | M4 | ✔ | △ |') },
  { check: 'name-unique', blurb: '把两行模块名改成同名',
    edit: (s) => s.replace(/^\| approval \|/m, '| boot |') },
];

function selftest(root, docPath) {
  // 探针与夹具写在仓库外的临时目录。往 scripts/ 或 docs/ 里落 doctored-*.md
  // 会在这个共享工作区留下别的会话能看见的未跟踪垃圾。
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'matrix-evidence-'));
  const base = fs.readFileSync(docPath, 'utf8');
  const clean = audit(root, docPath);
  let missed = 0;
  // 基线本身可以合法地红（台账真有缺口时）。这时该项的反证记 ALREADY-RED：
  // 既不算 CAUGHT 也不算 MISSED —— 红来自台账，不是来自门禁失效。只有 index-source 必须先绿，
  // 因为索引取不到时其余一切读数都无意义。
  const baseFail = new Set(clean.filter((c) => c.level === 'FAIL').map((c) => c.name));
  if (baseFail.has('index-source')) {
    console.log('UNCREDITED: 索引取不到源文件，其余读数无意义');
    report(clean);
    return 2;
  }
  console.log(`baseline: ${baseFail.size ? 'FAIL 集 [' + [...baseFail].join(',') + ']（这些项的注入不记 CAUGHT/MISSED）' : '无 FAIL'}`);
  for (const p of PROBES) {
    const doctored = p.edit(base);
    if (doctored === base) { console.log(`MISSED ${p.check}: 注入串没命中（探针失效，不是门禁失效）`); missed++; continue; }
    const file = path.join(dir, `doctored-${p.check}.md`);
    fs.writeFileSync(file, doctored, 'utf8');
    const res = audit(root, file);
    fs.unlinkSync(file);
    const failing = res.filter((c) => c.level === 'FAIL').map((c) => c.name);
    if (baseFail.has(p.check)) { console.log(`ALREADY-RED ${p.check}: 注入照样红，但基线即红，不计入`); continue; }
    if (failing.includes(p.check)) console.log(`CAUGHT ${p.check}: ${p.blurb} → FAIL 集 [${failing.join(',') || '空'}]`);
    else { console.log(`MISSED ${p.check}: ${p.blurb} → FAIL 集 [${failing.join(',') || '空'}]`); missed++; }
  }
  // index-source 的违规不在文档侧：把同一份矩阵放进一个 git 完全不收的目录（仓库外的临时根），
  // 索引取不到源文件，此时「备注引用的文件存在」必须判红灯而不是空集合放行。
  const fx = path.join(dir, 'fixture-root');
  fs.mkdirSync(path.join(fx, 'docs/plans'), { recursive: true });
  const fdoc = path.join(fx, 'docs/plans/dsh-capability-matrix.md');
  fs.copyFileSync(docPath, fdoc);
  const caught = audit(fx, fdoc).find((c) => c.name === 'index-source' && c.level === 'FAIL');
  fs.rmSync(dir, { recursive: true, force: true });
  if (caught) console.log(`CAUGHT index-source: 同一份矩阵放进 git 不收的目录 → ${caught.detail}`);
  else { console.log('MISSED index-source: 索引取不到源文件却没报 FAIL'); missed++; }
  const total = PROBES.length + 1;
  console.log(missed ? `GATE: SELFTEST FAIL (missed=${missed})` : `GATE: SELFTEST PASS (${total} probes, all CAUGHT)`);
  return missed ? 1 : 0;
}

const argv = process.argv.slice(2);
const hasRootArg = !!argv[0] && !argv[0].startsWith('--');
const root = hasRootArg ? argv[0] : path.resolve(__dirname, '..', '..');
if (!fs.existsSync(root)) { console.log('用法: node docs/qa/check-matrix-evidence.cjs [repoRoot] [--selftest] [docPath]'); process.exit(2); }
const useSelftest = argv.includes('--selftest');
const pos = argv.filter((a) => !a.startsWith('--'));
const docPath = (hasRootArg ? pos[1] : pos[0]) || path.join(root, 'docs/plans/dsh-capability-matrix.md');
try {
  process.exit(useSelftest ? selftest(root, docPath) : report(audit(root, docPath)));
} catch (e) {
  console.log('GATE: ERROR ' + (e && e.message));
  process.exit(3);
}
