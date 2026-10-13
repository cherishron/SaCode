#!/usr/bin/env node
// 透传用户命令、目录、标准流与退出结果，平台解析只走包内。
const { spawnSync } = require('node:child_process');
try {
  const { exe, env } = require('./platform.js').resolvePlatform('sacode');
  const result = spawnSync(exe, process.argv.slice(2), { cwd: process.cwd(), stdio: 'inherit', env });
  if (result.error) throw result.error;
  process.exit(result.status === null ? 81 : result.status);
} catch (error) { process.stderr.write(`sacode: ${error.message}\n`); process.exit(79); }
