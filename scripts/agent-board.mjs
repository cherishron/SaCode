#!/usr/bin/env node
// agent-board.mjs — 多 agent 进度汇总与“未登记”告警
//
// 真源：docs/agents/<agent-id>.md（各 agent 自报，只改自己的文件，避免写冲突）
// 汇总：worktree 列表 + git status 在飞文件
// 用法：
//   node scripts/agent-board.mjs            # 打印看板 + 告警（有告警退出码 1）
//   node scripts/agent-board.mjs --write    # 同时写入 docs/product/agent-board.md
//
// 说明：这是一个“弱门禁”工具——不阻断开发，只把“有产出但没登记”暴露出来。

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const AGENTS_DIR = path.join(ROOT, 'docs', 'agents');
const BOARD = path.join(ROOT, 'docs', 'product', 'agent-board.md');
const WRITE = process.argv.includes('--write');

// 不参与“未登记”判定的路径（工具自身/忽略产物）
const SKIP_PREFIX = ['.gitignore', 'docs/agents/', 'scripts/agent-board.mjs', 'docs/product/agent-board.md', 'target/', '.sacode/'];

function sh(cmd, args) {
  try { return execFileSync(cmd, args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); }
  catch { return ''; }
}

function listAgentFiles() {
  if (!fs.existsSync(AGENTS_DIR)) return [];
  return fs.readdirSync(AGENTS_DIR)
    .filter(f => f.endsWith('.md') && f !== 'README.md' && !f.startsWith('_'))
    .map(f => path.join(AGENTS_DIR, f));
}

function parseAgent(file) {
  const text = fs.readFileSync(file, 'utf8');
  const id = path.basename(file, '.md');
  const g = (re, d = '') => (text.match(re) || [])[1] || d;
  const role = g(/^- role:\s*(.+)$/m);
  const updated = g(/^- updated:\s*(.+)$/m);
  const rows = [];
  const idx = text.indexOf('## 在飞');
  if (idx >= 0) {
    for (const line of text.slice(idx).split(/\r?\n/)) {
      const t = line.trim();
      if (!t.startsWith('|') || !t.endsWith('|')) continue;
      const c = t.slice(1, -1).split('|').map(x => x.trim());
      if (c.length < 4 || c[0] === '工作包' || c[0].startsWith('-')) continue;
      rows.push({ pkg: c[0], domain: c[1], status: c[2], paths: c[3], evidence: c[4] || '', next: c[5] || '' });
    }
  }
  return { id, role, updated, rows };
}

function inflightPaths() {
  const out = sh('git', ['status', '--porcelain', '-uall']);
  const res = [];
  for (const line of out.split(/\r?\n/)) {
    if (line.length < 4) continue;
    let p = line.slice(3).replace(/^"|"$/g, '').split('\\').join('/');
    if (p.endsWith('/')) p = p.slice(0, -1);
    if (p) res.push(p);
  }
  return res;
}

function worktrees() {
  return sh('git', ['worktree', 'list']).split(/\r?\n/).filter(Boolean);
}

function isSkipped(p) { return SKIP_PREFIX.some(s => p === s.replace(/\/$/, '') || p.startsWith(s)); }

function claimedBy(agents, p) {
  for (const a of agents) {
    for (const r of a.rows) {
      for (const cp of r.paths.split(/[,、\s]+/).filter(Boolean)) {
        const base = cp.replace(/\/$/, '');
        if (p === base || p.startsWith(base + '/') || base.startsWith(p + '/')) return a.id;
      }
    }
  }
  return null;
}

function main() {
  const agents = listAgentFiles().map(parseAgent);
  const inflight = inflightPaths().filter(p => !isSkipped(p));
  const unregistered = inflight.filter(p => !claimedBy(agents, p));

  const L = [];
  L.push('# 多 agent 在飞看板（自动生成，勿手改）');
  L.push('');
  L.push('> 由 `scripts/agent-board.mjs` 生成。真源：`docs/agents/<agent-id>.md`。生成于 ' + new Date().toISOString());
  L.push('');
  L.push('## 当前在飞');
  L.push('');
  L.push('| agent | 角色 | 工作包 | F域 | 状态 | 涉及路径 | 证据 | 下一步 | 更新于 |');
  L.push('|---|---|---|---|---|---|---|---|---|');
  for (const a of agents) {
    if (!a.rows.length) {
      L.push(`| ${a.id} | ${a.role} | （未登记在飞项） | - | - | - | - | - | ${a.updated} |`);
      continue;
    }
    for (const r of a.rows) L.push(`| ${a.id} | ${a.role} | ${r.pkg} | ${r.domain} | ${r.status} | ${r.paths} | ${r.evidence} | ${r.next} | ${a.updated} |`);
  }
  L.push('');
  L.push('## worktree');
  L.push('');
  const wts = worktrees();
  if (wts.length) for (const w of wts) L.push('- ' + w); else L.push('- （无）');
  L.push('');
  L.push('## 未登记告警（有产出但没登记）');
  L.push('');
  if (unregistered.length) {
    const byDir = new Map();
    for (const p of unregistered) {
      const seg = p.split('/');
      const key = seg.length > 1 ? seg.slice(0, 2).join('/') : seg[0];
      byDir.set(key, (byDir.get(key) || 0) + 1);
    }
    L.push(`**共 ${unregistered.length} 个在飞文件未被任何 agent 登记**，按模块聚合：`);
    L.push('');
    L.push('| 模块 | 未登记文件数 |');
    L.push('|---|---|');
    for (const [k, v] of [...byDir.entries()].sort((a, b) => b[1] - a[1])) L.push(`| ${k} | ${v} |`);
    L.push('');
    L.push('> 处理：对应 agent 在自己的 `docs/agents/<agent-id>.md` 里登记这些路径；或从工作区撤出。');
  } else {
    L.push('- 无');
  }
  L.push('');

  const text = L.join('\n');
  process.stdout.write(text);
  if (WRITE) {
    fs.mkdirSync(path.dirname(BOARD), { recursive: true });
    fs.writeFileSync(BOARD, text, 'utf8');
    process.stdout.write(`\n[written] ${path.relative(ROOT, BOARD)}\n`);
  }
  if (unregistered.length) process.exitCode = 1;
}

main();