# E. 多 agent 协作进度

痛点：多个 agent 并行开发、各自工作树/目录，**进度互不可见**；做完**不更新进度**。

## 方案（零写冲突）

- **真源**：每个 agent 一个文件 `<docs 目录>/agents/<agent-id>.md`，**只改自己的** → 无写冲突。
- **汇总**：一个脚本读真源 + 版本控制状态 → 生成看板 + "未登记告警"。
- **看板**：自动生成，勿手改。

## 文件约定

头部字段（便于脚本解析）：`agent` / `role` / `updated`。
"## 在飞"表列：`工作包 | 领域 | 状态 | 涉及路径 | 证据 | 下一步`。
状态枚举：`in-progress` / `partial` / `done-unsubmitted` / `blocked` / `paused`。

模板：

```md
# <agent-id>

- agent: <agent-id>
- role: <角色>
- updated: <YYYY-MM-DD HH:MM>

## 在飞
| 工作包 | 领域 | 状态 | 涉及路径 | 证据 | 下一步 |
|---|---|---|---|---|---|
| 示例：某模块接线 | 模块A | in-progress | src/a.ts | docs/evidence/x.md | 接线并验收 |
```

## 强制规则

- **开工登记**：动手前加一行，并更新 `updated`。
- **收尾更新**：同批更新状态 / 证据 / 下一步，并更新 CHANGELOG 与项目台账。
- **收尾自检**：跑脚本；若"未登记告警"里出现**你改动范围内**的文件，必须先补登记。

## 参考脚本（Node ESM、零依赖，可粘贴为 `scripts/agent-board.mjs`）

```js
#!/usr/bin/env node
// 多 agent 进度汇总与“未登记”告警。真源：<docs>/agents/<id>.md
// 用法：node scripts/agent-board.mjs [--write]
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const AGENTS_DIR = path.join(ROOT, 'docs', 'agents');
const BOARD = path.join(ROOT, 'docs', 'agent-board.md');
const WRITE = process.argv.includes('--write');
const SKIP = ['.gitignore', 'docs/agents/', 'scripts/agent-board.mjs', 'docs/agent-board.md', 'target/', 'node_modules/'];

const sh = (cmd, args) => { try { return execFileSync(cmd, args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return ''; } };

function parse(file) {
  const text = fs.readFileSync(file, 'utf8');
  const id = path.basename(file, '.md');
  const updated = (text.match(/^- updated:\s*(.+)$/m) || [])[1] || '';
  const rows = [];
  const i = text.indexOf('## 在飞');
  if (i >= 0) for (const line of text.slice(i).split(/\r?\n/)) {
    const t = line.trim();
    if (!t.startsWith('|') || !t.endsWith('|')) continue;
    const c = t.slice(1, -1).split('|').map(x => x.trim());
    if (c.length < 4 || c[0] === '工作包' || c[0].startsWith('-')) continue;
    rows.push({ pkg: c[0], paths: c[3] });
  }
  return { id, updated, rows };
}
const agents = fs.existsSync(AGENTS_DIR)
  ? fs.readdirSync(AGENTS_DIR).filter(f => f.endsWith('.md') && f !== 'README.md' && !f.startsWith('_')).map(f => parse(path.join(AGENTS_DIR, f)))
  : [];
const inflight = sh('git', ['status', '--porcelain', '-uall']).split(/\r?\n/).filter(l => l.length >= 4)
  .map(l => l.slice(3).replace(/^"|"$/g, '').split('\\').join('/').replace(/\/$/, ''))
  .filter(p => !SKIP.some(s => p === s.replace(/\/$/, '') || p.startsWith(s)));
const claimed = p => agents.some(a => a.rows.some(r => r.paths.split(/[,、\s]+/).filter(Boolean).some(cp => {
  const b = cp.replace(/\/$/, ''); return p === b || p.startsWith(b + '/') || b.startsWith(p + '/');
})));
const unreg = inflight.filter(p => !claimed(p));

const out = ['# 多 agent 在飞看板（自动生成，勿手改）', '', `> 生成于 ${new Date().toISOString()}`, '', '## 当前在飞', ''];
for (const a of agents) for (const r of a.rows) out.push(`- ${a.id} | ${r.pkg} | ${r.paths} | ${a.updated}`);
out.push('', `## 未登记告警：共 ${unreg.length} 个在飞文件无 agent 登记`, '');
for (const p of unreg.slice(0, 200)) out.push(`- ⚠ ${p}`);
const text = out.join('\n');
process.stdout.write(text);
if (WRITE) fs.writeFileSync(BOARD, text, 'utf8');
if (unreg.length) process.exitCode = 1;
```

## 输出

- 看板文件（`docs/agent-board.md`）+ 未登记告警；有告警退出码 1。
- 意义：把"有产出但没登记"从隐性变显性——**机制不假装透明，而是把不透明变成红灯**。