#!/usr/bin/env node
// 无参数（或显式 `sacode tui`）且 stdin/stdout 都是交互终端时进入 Ink TUI；
// 其余命令仍原样透传给平台包里的仓颉 CLI，脚本与 CI 行为不变。
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const TUI_BUNDLE = process.env.SACODE_TUI_BUNDLE || path.join(__dirname, '..', 'tui', 'index.mjs');

function wantsTui(args) {
  if (args.length === 0) return true;
  return args.length === 1 && args[0] === 'tui';
}

async function runTui(env) {
  if (!fs.existsSync(TUI_BUNDLE)) throw new Error(`TUI 未打包：缺少 ${TUI_BUNDLE}`);
  const { main } = await import(pathToFileURL(TUI_BUNDLE).href);
  return main({ cwd: process.cwd(), env });
}

const args = process.argv.slice(2);
const tty = Boolean(process.stdin.isTTY && process.stdout.isTTY);
const explicitTui = args.length === 1 && args[0] === 'tui';

if (explicitTui && !tty) {
  process.stderr.write('sacode: TUI 需要交互终端（stdin 与 stdout 都必须是 TTY）。\n');
  process.exit(64);
}

if (tty && wantsTui(args)) {
  // TUI 只需要宿主；平台包缺失时仍允许按 SACODE_HOST/开发布局找宿主，
  // 这样仓库内和安装态走同一条入口，不因薄启动器缺包而整体不可用。
  let env = process.env;
  try {
    env = require('./platform.js').resolvePlatform('sacode').env;
  } catch {
    // 宿主定位交给 TUI，失败时它会给出尝试过的路径。
  }
  runTui(env)
    .then((code) => process.exit(code))
    .catch((error) => {
      process.stderr.write(`sacode: ${error.message}\n`);
      process.exit(79);
    });
} else {
  try {
    const { exe, env } = require('./platform.js').resolvePlatform('sacode');
    const result = spawnSync(exe, args, { cwd: process.cwd(), stdio: 'inherit', env });
    if (result.error) throw result.error;
    process.exit(result.status === null ? 81 : result.status);
  } catch (error) {
    process.stderr.write(`sacode: ${error.message}\n`);
    process.exit(79);
  }
}
