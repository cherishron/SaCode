#!/usr/bin/env node
/**
 * Start sacode serve sidecar for Desktop UI development.
 * Usage:
 *   node scripts/desktop-sidecar.mjs --workspace <dir> [--binary <path>] [--out <ready.json>]
 * Prints: { host, port, baseUrl, pid, readyFile, nonce, authRequired }
 * Token is written to .sacode/desktop-sidecar/token (mode 0600), not to stdout.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const workspace = path.resolve(arg('--workspace', process.cwd()));
const binary = path.resolve(
  arg('--binary', process.env.SACODE_BINARY_PATH || path.join(repoRoot, 'target', 'debug', 'sacode.exe')),
);
const outDir = path.join(repoRoot, '.sacode', 'desktop-sidecar');
fs.mkdirSync(outDir, { recursive: true });
const readyFile = path.resolve(arg('--ready-file', path.join(outDir, 'ready.json')));
const nonce = crypto.randomBytes(16).toString('hex');
const token = crypto.randomBytes(24).toString('hex');

if (!fs.existsSync(binary)) {
  console.error(`sacode binary not found: ${binary}`);
  process.exit(1);
}

fs.rmSync(readyFile, { force: true });

const env = { ...process.env, SACODE_DAEMON_TOKEN: token };
if (process.env.SACODE_OPENCODE_EXECUTABLE) {
  env.SACODE_OPENCODE_EXECUTABLE = process.env.SACODE_OPENCODE_EXECUTABLE;
  env.SACODE_OPENCODE_ARGS = process.env.SACODE_OPENCODE_ARGS || 'x opencode-ai acp';
}

console.error(`[desktop-sidecar] spawn ${binary}`);
console.error(`[desktop-sidecar] cwd ${workspace}`);
const child = spawn(
  binary,
  ['serve', '--port', '0', '--ready-file', readyFile, '--nonce', nonce],
  { cwd: workspace, env, stdio: ['ignore', 'inherit', 'inherit'], windowsHide: true },
);

const timeout = Number(arg('--timeout', '20000'));
const start = Date.now();
const timer = setInterval(() => {
  if (Date.now() - start > timeout) {
    clearInterval(timer);
    console.error('[desktop-sidecar] timeout waiting ready-file');
    child.kill();
    process.exit(1);
  }
  if (!fs.existsSync(readyFile)) return;
  let ready;
  try {
    ready = JSON.parse(fs.readFileSync(readyFile, 'utf8'));
  } catch {
    return;
  }
  if (!ready.port) return;
  if (ready.nonce && ready.nonce !== nonce) {
    console.error('[desktop-sidecar] nonce mismatch');
    child.kill();
    process.exit(1);
  }
  clearInterval(timer);
  const handle = {
    host: ready.host,
    port: ready.port,
    baseUrl: ready.base_url,
    pid: ready.pid || child.pid,
    readyFile,
    nonce,
    authRequired: !!ready.auth_required,
  };
  fs.writeFileSync(path.join(outDir, 'token'), token, { mode: 0o600 });
  console.error(`[desktop-sidecar] ready ${handle.baseUrl}`);
  console.log(JSON.stringify(handle));
  child.on('exit', (code) => {
    fs.rmSync(readyFile, { force: true });
    process.exit(code ?? 0);
  });
  process.on('SIGINT', () => {
    child.kill();
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    child.kill();
    process.exit(0);
  });
}, 200);
