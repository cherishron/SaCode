#!/usr/bin/env node
// daemon 与 CLI 共用平台包，缺产物直接失败，不回退 PATH 或仓库。
const { spawnSync } = require('node:child_process');
try {
  const { exe, env } = require('./platform.js').resolvePlatform('sacode-daemon');
  const result = spawnSync(exe, process.argv.slice(2), { cwd: process.cwd(), stdio: 'inherit', env });
  if (result.error) throw result.error;
  process.exit(result.status === null ? 81 : result.status);
} catch (error) { process.stderr.write(`sacode-daemon: ${error.message}\n`); process.exit(79); }
