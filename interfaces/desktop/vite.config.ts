import { defineConfig } from 'vite';
import path from 'node:path';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import crypto from 'node:crypto';
import type { Plugin } from 'vite';

const repoRoot = path.resolve(__dirname, '..');
const saaiRoot = path.resolve(repoRoot, '..');
const outDir = path.join(repoRoot, '.sacode', 'desktop-sidecar');
const readyFile = path.join(outDir, 'ready.json');
/** Token stays in process memory + sacode env only — never on disk, never in WebView. */
let sidecarToken: string | undefined;
let child: ReturnType<typeof spawn> | null = null;

interface SidecarEnv {
  /** Public base URL for the browser (Vite origin → proxy attaches Bearer). */
  SACODE_BASE_URL: string;
}

let envCache: SidecarEnv | null = null;

async function ensureSidecar(): Promise<SidecarEnv> {
  if (envCache) return envCache;
  if (fs.existsSync(readyFile)) {
    try {
      const ready = JSON.parse(fs.readFileSync(readyFile, 'utf8'));
      const res = await fetch(`${ready.base_url}/health`, {
        headers: sidecarToken ? { Authorization: `Bearer ${sidecarToken}` } : {},
      });
      if (res.ok) {
        envCache = { SACODE_BASE_URL: '' };
        return envCache;
      }
    } catch {
      /* spawn */
    }
  }
  fs.mkdirSync(outDir, { recursive: true });
  fs.rmSync(readyFile, { force: true });
  const nonce = crypto.randomBytes(8).toString('hex');
  sidecarToken = crypto.randomBytes(24).toString('hex');
  const binary =
    process.env.SACODE_BINARY_PATH || path.join(saaiRoot, 'SaCode', 'target', 'debug', 'sacode.exe');
  const fallbackBin = path.join(repoRoot, '..', 'target', 'debug', 'sacode.exe');
  const exe = fs.existsSync(binary)
    ? binary
    : fs.existsSync(fallbackBin)
      ? fallbackBin
      : binary;
  const procEnv: NodeJS.ProcessEnv = {
    ...process.env,
    SACODE_DAEMON_TOKEN: sidecarToken,
  };
  if (process.env.SACODE_OPENCODE_EXECUTABLE) {
    procEnv.SACODE_OPENCODE_EXECUTABLE = process.env.SACODE_OPENCODE_EXECUTABLE;
    procEnv.SACODE_OPENCODE_ARGS = process.env.SACODE_OPENCODE_ARGS || 'x opencode-ai acp';
  }
  child = spawn(exe, ['serve', '--port', '0', '--ready-file', readyFile, '--nonce', nonce], {
    cwd: saaiRoot,
    env: procEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  child.stderr?.on('data', (d) => process.stderr.write(`[sacode-sidecar] ${d}`));

  const deadline = Date.now() + 20000;
  let ready: { base_url: string; port?: number; nonce?: string } | null = null;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 200));
    if (!fs.existsSync(readyFile)) continue;
    try {
      const parsed = JSON.parse(fs.readFileSync(readyFile, 'utf8'));
      if (parsed.port && typeof parsed.host === 'string') {
        ready = parsed;
        break;
      }
    } catch {
      /* partial write — retry */
    }
  }
  if (!ready) throw new Error('sacode sidecar ready-file timeout');
  if (typeof ready.nonce === 'string' && ready.nonce !== nonce) {
    throw new Error('sacode sidecar nonce mismatch');
  }
  // Browser talks to Vite origin; proxy injects Bearer — never expose token to WebView.
  envCache = { SACODE_BASE_URL: '' };
  return envCache;
}

function sacodeSidecarPlugin(): Plugin {
  return {
    name: 'sacode-sidecar',
    async configureServer(server) {
      let target = 'http://127.0.0.1:8080';
      try {
        await ensureSidecar();
        const raw = fs.existsSync(readyFile) ? JSON.parse(fs.readFileSync(readyFile, 'utf8')) : null;
        if (raw?.base_url) target = raw.base_url;
      } catch (e) {
        server.config.logger.warn(`[sacode-sidecar] ${e}`);
      }
      server.middlewares.use((req, res, next) => {
        const url = req.url || '';
        const proxied =
          url.startsWith('/health') ||
          url.startsWith('/task') ||
          url.startsWith('/agents') ||
          url.startsWith('/tools') ||
          url.startsWith('/metrics') ||
          url.startsWith('/queue') ||
          url.startsWith('/events') ||
          url.startsWith('/api/stream');
        if (!proxied) return next();
        const headers: Record<string, string> = {};
        for (const [k, v] of Object.entries(req.headers)) {
          if (v == null) continue;
          const key = k.toLowerCase();
          if (['host', 'connection', 'content-length'].includes(key)) continue;
          headers[key] = Array.isArray(v) ? v.join(',') : String(v);
        }
        // Server-side only: attach daemon token (not visible to browser).
        if (sidecarToken) headers.authorization = `Bearer ${sidecarToken}`;
        const chunks: Buffer[] = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => {
          const body = chunks.length ? Buffer.concat(chunks) : undefined;
          fetch(`${target}${url}`, {
            method: req.method,
            headers,
            body,
            // @ts-expect-error node fetch duplex
            duplex: body ? 'half' : undefined,
          })
            .then(async (upstream) => {
              res.statusCode = upstream.status;
              upstream.headers.forEach((value, key) => {
                if (['content-encoding', 'content-length', 'transfer-encoding', 'connection'].includes(key.toLowerCase()))
                  return;
                res.setHeader(key, value);
              });
              const buf = Buffer.from(await upstream.arrayBuffer());
              res.end(buf);
            })
            .catch((e) => {
              res.statusCode = 502;
              res.end(String(e));
            });
        });
      });
    },
    config() {
      return {
        define: {
          // Empty base → UI uses same-origin Vite proxy; token never injected.
          __SACODE_ENV__: JSON.stringify({ SACODE_BASE_URL: '' }),
        },
      };
    },
    closeBundle() {
      child?.kill();
    },
  };
}

export default defineConfig({
  root: '.',
  plugins: [sacodeSidecarPlugin()],
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
