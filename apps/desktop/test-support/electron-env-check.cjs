// 环境检测预检 CLI：输出 {blocked, reason, details}。
// 权威判据是默认沙箱最小 Electron 探针；父链/会话信息只作旁证，不参与判死。
const { spawnSync } = require('node:child_process');
const { probe, gateRoot } = require('./electron-env-probe.cjs');

function ps(script) {
  const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8', timeout: 8000, windowsHide: true, maxBuffer: 2 * 1024 * 1024,
  });
  return (r.stdout || '').trim();
}

function context() {
  const details = {};
  const treeScript = `
    $p = Get-CimInstance Win32_Process -Filter "ProcessId=$PID"
    $results = @()
    for ($i = 0; $i -lt 10 -and $p -ne $null -and $p.ProcessId -gt 0; $i++) {
      $cmd = ""
      try { $cmd = $p.CommandLine } catch {}
      if ($cmd -eq $null) { $cmd = "" }
      $cmd = $cmd -replace "[\\r\\n]+", " "
      $cmd = $cmd -replace "\\s+", " "
      if ($cmd.Length -gt 160) { $cmd = $cmd.Substring(0, 160) }
      $results += ($p.ProcessId.ToString() + "|" + $p.Name + "|" + $cmd)
      $parentId = $p.ParentProcessId
      if ($parentId -le 0) { break }
      try { $p = Get-CimInstance Win32_Process -Filter ("ProcessId=" + $parentId) } catch { break }
    }
    Write-Output ($results -join [char]10)
  `;
  const tree = ps(treeScript);
  details.processTree = tree.split(/\r?\n/).filter(Boolean);
  details.signals = {
    agentHarnessInTree: /opencode|workbuddy|tsbx|sandbox-cli/i.test(tree),
    electronRunAsNode: Boolean(process.env.ELECTRON_RUN_AS_NODE),
    sessionName: process.env.SESSIONNAME || null,
    wtSession: Boolean(process.env.WT_SESSION),
  };
  const me = ps('$p=Get-CimInstance Win32_Process -Filter "ProcessId=$PID"; Write-Output ("SessionId=" + $p.SessionId)');
  const m = me.match(/SessionId=(\d+)/);
  details.sessionId = m ? Number(m[1]) : -1;
  return details;
}

const result = probe();
const out = {
  blocked: result.blocked,
  reason: result.status,
  details: {
    probe: {
      source: result.source,
      exit: result.exit,
      exitHex: result.exitHex,
      signal: result.signal || null,
      ms: result.ms,
      detail: result.detail,
      stderrTail: result.stderrTail || null,
      spawnError: result.spawnError || null,
    },
    evidenceDir: gateRoot,
    ...context(),
  },
};
console.log(JSON.stringify(out, null, 2));
