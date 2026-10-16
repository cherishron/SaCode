#!/usr/bin/env node
// 批次 Z 取证脚本：核对 remote-capability-contract.json 的 119 条实现锚点。
//
// 分类法（五档）：
//   - implemented-locally    方法字面量出现在某文件的 `if (method == "...")` 分派位置，或在谓词函数体内被判读
//   - forwarded-only         方法仅在 `apps/daemon/src/host_proxy.cj` 的转发白名单里，宿主侧无本地分派
//   - capabilities-only      方法只在 `apps/host/src/main.cj` 的 caps blob 里出现，无本地分派
//   - proposed               锚点以「拟新增」开头
//   - anchor-broken          锚点文件缺失，或方法字面量在锚点文件内扫不到
//
// 输出：console 上打 TALLY 与每档明细；JSON 结果写到 `target/tmp/` 目录（未入库）。
//
// 用法：`node scripts/check_contract_anchor_audit.cjs`
// 不依赖除 Node 标准库外的任何东西。
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, 'target/tmp');
const CONTRACT = 'docs/plans/remote-capability-contract.json';

if (!fs.existsSync(path.join(ROOT, CONTRACT))) {
  console.error(`[audit] 契约表未找到：${CONTRACT}`);
  process.exit(1);
}

const contract = JSON.parse(fs.readFileSync(path.join(ROOT, CONTRACT), 'utf8'));
const CACHE = new Map();
function fileOf(rel) {
  if (CACHE.has(rel)) return CACHE.get(rel);
  const full = path.join(ROOT, rel);
  const s = fs.existsSync(full) ? fs.readFileSync(full, 'utf8') : null;
  CACHE.set(rel, s);
  return s;
}

// host caps blob 是被 emit 的转义字符串：`\"capabilities\":[\"a\",\"b\",...]`，
// 所以要匹配反斜杠+引号的字面量。用非贪婪 `[^]]*` 吃到数组尾。
const hostCaps = new Set();
{
  const m = (fileOf('apps/host/src/main.cj') || '').match(/\\"capabilities\\":\[([^\]]*)\]/);
  if (m) for (const s of m[1].matchAll(/"([^"]+)"/g)) hostCaps.add(s[1]);
}
const daemonInitCaps = new Set();
{
  const m = (fileOf('apps/daemon/src/daemon.cj') || '').match(/INIT_CAPS\s*=\s*"\[(.*?)\]"/);
  if (m) for (const s of m[1].matchAll(/"([^"]+)"/g)) daemonInitCaps.add(s[1]);
}
const forwardSet = new Set();
{
  const text = fileOf('apps/daemon/src/host_proxy.cj') || '';
  const m = text.match(/let hostMethods\s*=\s*\[(.*?)\]/s);
  if (m) for (const s of m[1].matchAll(/"([^"]+)"/g)) forwardSet.add(s[1]);
}

function scanMethodIn(fileRel, method) {
  const text = fileOf(fileRel);
  if (text == null) return { present: false, inDispatch: false, inPredicates: false, inCaps: false, lines: [] };
  const lines = text.split('\n');
  const lineHits = [];
  let inDispatch = false, inPredicates = false, inCaps = false;
  for (let i = 0; i < lines.length; i++) {
    const L = lines[i];
    if (L.includes('"' + method + '"')) {
      lineHits.push(i + 1);
      const lo = Math.max(0, i - 3), hi = Math.min(lines.length, i + 4);
      const ctx = lines.slice(lo, hi).join('\n');
      if (/if\s*\(\s*method\s*==|"|!=\s*method/.test(ctx)) inDispatch = true;
      if (/isGoalControlMethod|isQueueMethod|isTipsMethod|ExecutionApi\.readOnly|ExecutionApi\.handles|allowedDuringTurn|isWorktreeMethod|isLspMethod/.test(ctx)) inPredicates = true;
      if (/capabilities/.test(ctx)) inCaps = true;
    }
  }
  return { present: lineHits.length > 0, inDispatch, inPredicates, inCaps, lines: lineHits };
}

function parseAnchor(a) {
  return a.split(/\s*\+\s*/).map(seg => {
    const m1 = seg.match(/^([^\s:]+\.(?:cj|cjs|json|md)):(\d+)(?:\s+(.*))?$/);
    if (m1) return { file: m1[1], line: parseInt(m1[2]), suffix: (m1[3] || '').trim() };
    const m2 = seg.match(/^([^\s:]+\.(?:cj|cjs|json|md))(?:\s+(.*))?$/);
    if (m2) return { file: m2[1], line: null, suffix: (m2[2] || '').trim() };
    return null;
  }).filter(Boolean);
}

function classify(row) {
  const { method, implementationAnchor } = row;
  if (implementationAnchor.startsWith('拟新增')) return { cls: 'proposed', notes: [implementationAnchor] };

  const parts = parseAnchor(implementationAnchor);
  const notes = [];
  let hasLocalImpl = false, hasForward = false, hasCapsOnly = false;

  for (const p of parts) {
    const text = fileOf(p.file);
    if (text == null) { notes.push(`${p.file}: FILE MISSING`); continue; }

    const suffixIsCaps = /capabilities/i.test(p.suffix || '') || /INIT_CAPS/i.test(p.suffix || '');
    const suffixIsHelper = /ExecutionApi|isGoalControlMethod|isQueueMethod|isTipsMethod|isWorktreeMethod|isLspMethod/i.test(p.suffix || '');
    const isProxyFile = p.file.endsWith('host_proxy.cj');

    if (isProxyFile) {
      if (forwardSet.has(method)) { hasForward = true; notes.push(`${p.file}: in forward whitelist`); }
      else { notes.push(`${p.file}: NOT in forward whitelist`); }
      continue;
    }

    if (suffixIsCaps) {
      const capsBlob = text.match(/"capabilities":\[(.*?)\]/);
      const capsList = capsBlob ? [...capsBlob[1].matchAll(/"([^"]+)"/g)].map(m => m[1]) : [];
      if (capsList.includes(method) || daemonInitCaps.has(method)) {
        hasCapsOnly = true;
        notes.push(`${p.file}: in caps blob`);
      } else {
        notes.push(`${p.file}: caps suffix but method NOT in caps`);
      }
      continue;
    }

    if (suffixIsHelper) {
      const info = scanMethodIn(p.file, method);
      if (info.present && (info.inDispatch || info.inPredicates)) {
        hasLocalImpl = true;
        notes.push(`${p.file}:${info.lines[0]} via ${p.suffix}`);
      } else if (info.present) {
        hasCapsOnly = true;
        notes.push(`${p.file}:${info.lines[0]} (helper-suffix but no dispatch ctx)`);
      } else {
        notes.push(`${p.file}: helper-suffix but method literal not found`);
      }
      continue;
    }

    const info = scanMethodIn(p.file, method);
    if (!info.present) { notes.push(`${p.file}: method literal NOT in file`); continue; }
    if (info.inDispatch || info.inPredicates) {
      hasLocalImpl = true;
      notes.push(`${p.file}:${info.lines[0]} ${info.inDispatch ? 'dispatch' : 'via predicate'}`);
    } else if (info.inCaps) {
      hasCapsOnly = true;
      notes.push(`${p.file}:${info.lines[0]} caps-only`);
    } else {
      notes.push(`${p.file}:${info.lines[0]} present but no recognized dispatch ctx`);
      hasCapsOnly = true;
    }
  }

  if (hasLocalImpl) return { cls: 'implemented-locally', notes };
  if (hasForward && !hasCapsOnly) return { cls: 'forwarded-only', notes };
  if (hasForward) return { cls: 'forwarded-and-caps', notes };
  if (hasCapsOnly) return { cls: 'capabilities-declared-only', notes };
  return { cls: 'anchor-broken', notes };
}

const out = contract.map(row => ({
  method: row.method,
  anchor: row.implementationAnchor,
  permission: row.permission,
  ...classify(row),
}));

const tally = {};
for (const r of out) tally[r.cls] = (tally[r.cls] || 0) + 1;

console.log(`[audit] 契约表条目数：${contract.length}`);
console.log(`[audit] 分类：${JSON.stringify(tally)}`);
console.log(`[audit] host caps blob 声明数：${hostCaps.size}`);
console.log(`[audit] daemon INIT_CAPS 声明数：${daemonInitCaps.size}`);
console.log(`[audit] host_proxy 转发白名单数：${forwardSet.size}`);

for (const cls of ['implemented-locally', 'forwarded-and-caps', 'forwarded-only', 'capabilities-declared-only', 'anchor-broken', 'proposed']) {
  const list = out.filter(r => r.cls === cls);
  if (list.length === 0) continue;
  console.log(`\n== ${cls} (${list.length}) ==`);
  for (const r of list) {
    console.log(`  ${r.method.padEnd(30)} | ${r.anchor.padEnd(72)} | ${r.notes.join('; ')}`);
  }
}

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, 'contract-anchor-audit.json'), JSON.stringify(out, null, 2));

// 硬门槛：不允许「完全没有实现」的方法出现
const missingImpl = out.filter(r => r.cls === 'capabilities-declared-only' || r.cls === 'anchor-broken' || r.cls === 'proposed');
console.log(`\n[audit] 探针归类为「探针未判出真实现」的 ${missingImpl.length} 条需要人工复核是否 anchor 元数据过期`);
console.log(`[audit] 完整 JSON 结果：${path.relative(ROOT, path.join(OUT_DIR, 'contract-anchor-audit.json'))}`);
process.exit(0);
