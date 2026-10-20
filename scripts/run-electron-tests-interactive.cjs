// 交互跑道：由用户双击 scripts/run-electron-tests-interactive.cmd（或在已登录交互会话中直接运行）。
// 先用同一探针确认“默认沙箱下 Electron 能启动”，命中受限代理上下文就明确拒绝，不假装跑过。
// 通过后按正常用户上下文串行跑 10 个 Electron 测试文件，结果落 target/tmp/electron-interactive-<日期>-<时间>/。
const { spawn, spawnSync } = require('node:child_process');
const { existsSync, mkdirSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const root = join(__dirname, '..');
const desktop = join(root, 'apps', 'desktop');

// 与 docs/testing.md 和 apps/desktop/test-support/electron-env-gate.mjs 登记保持同一清单。
const ELECTRON_TESTS = [
  'test/approval-mode-electron-host.test.mjs',
  'test/inline-editor-render.test.mjs',
  'test/knowledge-electron.test.mjs',
  'test/model-credential-electron-host.test.mjs',
  'test/model-pages-render.test.mjs',
  'test/models/model-pull-electron.test.mjs',
  'test/pack-next-sdk.test.mjs',
  'test/plugin-inventory-lifecycle.test.mjs',
  'test/provider-credential-retry-render.test.mjs',
  'test/window-visibility.test.mjs',
];

function checkEnv() {
  const checker = join(desktop, 'test-support', 'electron-env-check.cjs');
  const r = spawnSync(process.execPath, [checker], { encoding: 'utf8', timeout: 30000, windowsHide: true });
  try {
    return JSON.parse(r.stdout.trim());
  } catch {
    return {
      blocked: true,
      reason: 'env-check-failed',
      details: { stdoutTail: (r.stdout || '').slice(-400), stderrTail: (r.stderr || '').slice(-400) },
    };
  }
}

function tapSummary(stdout) {
  const summary = {};
  for (const line of stdout.split(/\r?\n/)) {
    const m = line.match(/^# (tests|pass|fail|cancelled|skipped|todo|duration_ms) (.+)$/);
    if (m) summary[m[1]] = m[1] === 'duration_ms' ? Number(m[2]) : Number(m[2]);
  }
  return summary;
}

// 每个文件一个子进程，超时即杀；结果保留 TAP 全文与尾部。
function runOne(file, outputDir, env) {
  const fullPath = join(desktop, file);
  if (!existsSync(fullPath)) {
    return Promise.resolve({ file, status: 'missing', rc: null, durationMs: 0, tapTail: '文件不存在', summary: {} });
  }
  const tapFile = join(outputDir, file.replace(/[\\/]/g, '__') + '.tap');
  return new Promise(resolve => {
    const started = Date.now();
    const child = spawn(process.execPath, ['--test', fullPath], {
      cwd: desktop,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, 180000);
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      writeFileSync(tapFile, stdout + '\n--- stderr ---\n' + stderr + (timedOut ? '\n--- timed out ---\n' : ''));
      const summary = tapSummary(stdout);
      const status = timedOut ? 'timeout' : (code === 0 ? 'pass' : 'fail');
      resolve({
        file,
        status,
        rc: code,
        signal: signal || null,
        durationMs: Date.now() - started,
        tapFile: tapFile.slice(root.length + 1),
        tapTail: stdout.split(/\r?\n/).filter(Boolean).slice(-12).join('\n'),
        stderrTail: stderr.trim().split(/\r?\n/).slice(-5).join('\n'),
        summary,
      });
    });
    child.on('error', error => {
      clearTimeout(timer);
      resolve({ file, status: 'error', rc: null, signal: null, durationMs: Date.now() - started, tapTail: String(error.message || error), summary: {} });
    });
  });
}

async function main() {
  console.log('=== SaCode Electron 交互测试跑道 ===\n');
  const env = checkEnv();
  console.log('环境检测: ' + env.reason);
  console.log(JSON.stringify(env.details?.probe || env.details || {}, null, 2));

  if (env.blocked) {
    console.error('\n[拒绝] 当前处于受限代理上下文（' + env.reason + '）。');
    console.error('默认沙箱下最小 Electron 探针未能启动，Chromium 沙箱初始化被环境阻断。');
    console.error('这不是 SaCode 代码失败，也不能用 --no-sandbox 绕过。');
    console.error('请直接双击 scripts\\run-electron-tests-interactive.cmd（或在普通命令行中运行）。');
    console.error('本次没有启动任何 Electron 测试，也没有生成“通过”结果。');
    process.exit(2);
  }

  const now = new Date();
  const stamp = now.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const outputDir = join(root, 'target', 'tmp', 'electron-interactive-' + stamp);
  mkdirSync(outputDir, { recursive: true });

  // 某些用例需要真实 Host。交互跑道不伪造 Host：只在变量为空且默认 dist 宿主存在时补默认路径。
  const childEnv = {
    ...process.env,
    // 跑道已用同一探针确认环境可用，子测试直接沿用，避免每个文件再启动一次探针。
    SACODE_ELECTRON_ENV: 'ok',
    TEMP: outputDir,
    TMP: outputDir,
  };
  const defaultHost = join(desktop, 'dist', 'host', 'bin', 'sacode-host.exe');
  if (!childEnv.SACODE_HOST && existsSync(defaultHost)) childEnv.SACODE_HOST = defaultHost;

  console.log('\n输出目录: ' + outputDir);
  console.log('测试文件数: ' + ELECTRON_TESTS.length);
  if (!childEnv.SACODE_HOST) console.log('提示: 未设置 SACODE_HOST，需要真实 Host 的用例会按自身门禁跳过。');
  console.log('');

  const results = [];
  for (const file of ELECTRON_TESTS) {
    console.log('运行: ' + file);
    const result = await runOne(file, outputDir, childEnv);
    results.push(result);
    console.log('  => ' + result.status + (result.rc !== null ? ' (rc=' + result.rc + ')' : '') + '  ' + result.durationMs + 'ms');
    if (result.tapTail) console.log(result.tapTail.split('\n').map(line => '    ' + line).join('\n'));
    console.log('');
  }

  const summary = {
    date: now.toISOString(),
    outputDir: outputDir.slice(root.length + 1),
    gate: { reason: env.reason, blocked: false, probe: env.details?.probe || null },
    totalFiles: results.length,
    passFiles: results.filter(r => r.status === 'pass').length,
    failFiles: results.filter(r => r.status === 'fail').length,
    missingFiles: results.filter(r => r.status === 'missing').length,
    errorFiles: results.filter(r => r.status === 'error' || r.status === 'timeout').length,
    totals: {
      tests: results.reduce((n, r) => n + (r.summary.tests || 0), 0),
      pass: results.reduce((n, r) => n + (r.summary.pass || 0), 0),
      fail: results.reduce((n, r) => n + (r.summary.fail || 0), 0),
      skipped: results.reduce((n, r) => n + (r.summary.skipped || 0), 0),
    },
    results,
  };
  writeFileSync(join(outputDir, 'summary.json'), JSON.stringify(summary, null, 2));
  writeFileSync(
    join(outputDir, 'report.txt'),
    'SaCode Electron 交互测试跑道报告\n' +
    '日期: ' + summary.date + '\n' +
    '环境: ' + summary.gate.reason + '\n' +
    '文件: 通过 ' + summary.passFiles + ' / 失败 ' + summary.failFiles + ' / 缺失 ' + summary.missingFiles + ' / 错误 ' + summary.errorFiles + ' / 总 ' + summary.totalFiles + '\n' +
    '用例: 通过 ' + summary.totals.pass + ' / 失败 ' + summary.totals.fail + ' / 跳过 ' + summary.totals.skipped + ' / 总 ' + summary.totals.tests + '\n\n' +
    results.map(r => r.file + ' => ' + r.status + (r.rc !== null ? ' (rc=' + r.rc + ')' : '') + '\n' + (r.tapTail || '')).join('\n---\n')
  );

  console.log('=== 汇总 ===');
  console.log('文件: 通过 ' + summary.passFiles + ' / 失败 ' + summary.failFiles + ' / 缺失 ' + summary.missingFiles + ' / 错误 ' + summary.errorFiles + ' / 总 ' + summary.totalFiles);
  console.log('用例: 通过 ' + summary.totals.pass + ' / 失败 ' + summary.totals.fail + ' / 跳过 ' + summary.totals.skipped + ' / 总 ' + summary.totals.tests);
  console.log('报告: ' + join(outputDir, 'report.txt'));
  console.log('JSON: ' + join(outputDir, 'summary.json'));
  process.exit(summary.failFiles + summary.errorFiles + summary.missingFiles > 0 ? 1 : 0);
}

main().catch(error => { console.error(error); process.exit(1); });
