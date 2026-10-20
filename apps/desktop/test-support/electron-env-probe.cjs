// 受限代理上下文探测（单一来源）。
// 判据以「默认沙箱下最小 Electron 能否启动」为准：这正是外面那 16 项失败的根因，
// 且不会因为普通用户装过 WorkBuddy / 有 sandbox-cli-gc 进程而误判。
// 不传 --no-sandbox、不关 GPU、不改系统配置；只做一次最小窗口探针。
const { spawnSync } = require('node:child_process');
const { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const desktop = join(__dirname, '..');
const gateRoot = join(desktop, '..', '..', 'target', 'tmp', 'electron-env-gate');

function hex(code) {
  if (code === null || code === undefined) return 'null';
  return '0x' + (code >>> 0).toString(16).toUpperCase().padStart(8, '0');
}

function resolveElectron() {
  try {
    const bin = require(join(desktop, 'node_modules', 'electron'));
    return typeof bin === 'string' && existsSync(bin) ? bin : null;
  } catch {
    return null;
  }
}

function probe({ timeoutMs = 20000, cache = true } = {}) {
  const forced = process.env.SACODE_ELECTRON_ENV;
  if (cache && (forced === 'ok' || forced === 'blocked')) {
    return {
      blocked: forced === 'blocked',
      status: forced === 'blocked' ? 'env-blocked-electron' : 'env-ok',
      source: 'SACODE_ELECTRON_ENV',
      exit: null,
      exitHex: 'null',
      ms: 0,
      detail: forced === 'blocked' ? '环境门禁已在交互跑道预检阶段判定受限' : '交互跑道预检已通过',
    };
  }

  const electron = resolveElectron();
  if (!electron) {
    return {
      blocked: false,
      status: 'env-probe-unavailable',
      source: 'probe',
      exit: null,
      exitHex: 'null',
      ms: 0,
      detail: '未找到 apps/desktop/node_modules/electron，无法判断是否受限；按普通失败处理',
    };
  }

  // 探针只写 target/tmp（已被 gitignore），每次用独立目录，不碰产品数据。
  mkdirSync(gateRoot, { recursive: true });
  const dir = mkdtempSync(join(gateRoot, 'probe-'));
  const userData = join(dir, 'user-data');
  mkdirSync(userData);
  const main = join(dir, 'main.cjs');
  writeFileSync(main, `
const { app, BrowserWindow } = require('electron');
const watchdog = setTimeout(() => app.exit(3), ${Math.max(5000, Math.min(15000, timeoutMs - 3000))});
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false });
  win.webContents.once('did-finish-load', () => { clearTimeout(watchdog); app.exit(0); });
  await win.loadURL('about:blank');
}).catch(() => { clearTimeout(watchdog); app.exit(4); });
`);

  const env = { ...process.env };
  // harness 可能注入 ELECTRON_RUN_AS_NODE（仅 Process 级）；保留它会把 Electron 当 Node 跑，
  // 得到的是 "bad option" 而不是沙箱结论，必须删除而不是设空串。
  delete env.ELECTRON_RUN_AS_NODE;

  const started = Date.now();
  const run = spawnSync(electron, ['--user-data-dir=' + userData, main], {
    encoding: 'utf8', timeout: timeoutMs, windowsHide: true, env,
  });
  const ms = Date.now() - started;
  const exit = run.status;
  const blocked = exit !== 0;
  const result = {
    blocked,
    status: blocked ? 'env-blocked-electron' : 'env-ok',
    source: 'probe',
    electron,
    exit,
    exitHex: hex(exit),
    signal: run.signal || null,
    ms,
    detail: blocked
      ? `默认沙箱下最小 Electron 未能启动（exit ${hex(exit)}，${ms}ms）`
      : `默认沙箱下最小 Electron 启动成功（${ms}ms）`,
    stderrTail: (run.stderr || '').trim().split(/\r?\n/).slice(-5).join('\n') || null,
    stdoutTail: (run.stdout || '').trim().split(/\r?\n/).slice(-5).join('\n') || null,
    spawnError: run.error ? String(run.error.message || run.error) : null,
  };

  // 留一份可复议的原始读数；同一进程只写最后一份，避免全量测试时堆成山。
  try {
    writeFileSync(join(gateRoot, `probe-${process.pid}.json`), JSON.stringify(result, null, 2));
  } catch {}
  return result;
}

module.exports = { probe, hex, gateRoot };
