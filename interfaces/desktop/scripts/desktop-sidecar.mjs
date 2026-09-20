/**
 * Desktop sidecar launcher (Compose desktop-sidecar T2).
 *
 * Spawns `sacode serve --port 0 --ready-file <path> --nonce <n>`,
 * waits for ready-file + /health, prints one JSON line **without token**:
 *   { "ok": true, "base_url": "...", "port": n, "pid": n, "nonce": "...", "auth_required": true }
 *
 * Token is injected only into the child env (`SACODE_DAEMON_TOKEN`).
 * It is NOT written to ready-file and NOT printed unless `--print-token`.
 *
 * Usage:
 *   node scripts/desktop-sidecar.mjs --sacode <path> [--workdir <dir>] [--ready <path>]
 *        [--timeout-ms 20000] [--print-token]
 */
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(desktopRoot, '..', '..');
const defaultSacode =
  process.env.SACODE_BINARY || path.join(repoRoot, 'target', 'debug', 'sacode.exe');

function parseArgs(argv) {
  const out = {
    sacode: defaultSacode,
    workdir: repoRoot,
    ready: path.join(os.tmpdir(), `sacode-ready-${process.pid}.json`),
    timeoutMs: 20000,
    nonce: crypto.randomBytes(8).toString('hex'),
    token: crypto.randomBytes(24).toString('hex'),
    printToken: argv.includes('--print-token'),
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--sacode') out.sacode = argv[++i];
    else if (a === '--workdir') out.workdir = argv[++i];
    else if (a === '--ready') out.ready = argv[++i];
    else if (a === '--timeout-ms') out.timeoutMs = Number(argv[++i]);
    else if (a === '--nonce') out.nonce = argv[++i];
  }
  return out;
}

function emit(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

function waitReady(readyPath, nonce, timeoutMs) {
  return new Promise(async (resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (fs.existsSync(readyPath)) {
        const raw = fs.readFileSync(readyPath, 'utf8');
        let info;
        try {
          info = JSON.parse(raw);
        } catch {
          // partial write — retry
          await new Promise((r) => setTimeout(r, 150));
          continue;
        }
        if (info.schema_version !== 1 || !(info.port > 0) || typeof info.host !== 'string') {
          await new Promise((r) => setTimeout(r, 150));
          continue;
        }
        if (typeof info.nonce === 'string' && info.nonce !== nonce) {
          reject(new Error('ready-file nonce mismatch'));
          return;
        }
        const base = info.base_url || `http://${info.host}:${info.port}`;
        try {
          const u = new URL(base);
          if (u.protocol !== 'http:' && u.protocol !== 'https:') {
            reject(new Error(`invalid ready base_url protocol: ${base}`));
            return;
          }
        } catch {
          reject(new Error(`invalid ready base_url: ${base}`));
          return;
        }
        resolve(info);
        return;
      }
      await new Promise((r) => setTimeout(r, 150));
    }
    reject(new Error(`ready-file timeout: ${readyPath}`));
  });
}

async function waitHealth(baseUrl, token, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/health`, { headers });
      if (res.ok) {
        const body = await res.json();
        if (body && body.status === 'healthy') return body;
      }
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`health timeout: ${baseUrl}`);
}

async function main() {
  const args = parseArgs(process.argv);
  if (!fs.existsSync(args.sacode)) {
    emit({ ok: false, error: `sacode binary not found: ${args.sacode}` });
    process.exit(2);
  }
  fs.mkdirSync(path.dirname(args.ready), { recursive: true });
  try {
    fs.unlinkSync(args.ready);
  } catch {}

  const child = spawn(
    args.sacode,
    ['serve', '--port', '0', '--ready-file', args.ready, '--nonce', args.nonce],
    {
      cwd: args.workdir,
      env: {
        ...process.env,
        SACODE_DAEMON_TOKEN: args.token,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  let stderr = '';
  child.stderr.on('data', (d) => {
    stderr += String(d);
  });
  child.stdout.on('data', () => {});

  try {
    const ready = await waitReady(args.ready, args.nonce, args.timeoutMs);
    const base = ready.base_url || `http://${ready.host}:${ready.port}`;
    const health = await waitHealth(base, args.token, args.timeoutMs);
    const payload = {
      ok: true,
      base_url: base,
      host: ready.host,
      port: ready.port,
      pid: child.pid,
      daemon_pid: ready.pid,
      nonce: args.nonce,
      ready_file: args.ready,
      auth_required: true,
      version: health.version || ready.version || null,
    };
    if (args.printToken) payload.token = args.token;
    emit(payload);
  } catch (e) {
    try {
      child.kill('SIGTERM');
    } catch {}
    emit({ ok: false, error: String(e), stderr: stderr.slice(-800) });
    process.exit(1);
  }
}

main();
