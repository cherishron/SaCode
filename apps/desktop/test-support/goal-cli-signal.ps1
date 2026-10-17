param([Parameter(Mandatory=$true)][string]$Exe,[Parameter(Mandatory=$true)][string]$WorkDir)
$ErrorActionPreference='Stop'
Add-Type -Namespace SaCodeGoalProbe -Name Native -MemberDefinition @'
[DllImport("kernel32.dll")] public static extern bool FreeConsole();
[DllImport("kernel32.dll")] public static extern bool AllocConsole();
[DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow();
[DllImport("kernel32.dll")] public static extern uint GetConsoleProcessList([Out] uint[] processes, uint count);
[DllImport("kernel32.dll")] public static extern bool SetConsoleCtrlHandler(IntPtr handler, bool add);
[DllImport("kernel32.dll")] public static extern bool GenerateConsoleCtrlEvent(uint evt, uint group);
[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr window, int command);
'@
$probeResult=@{passed=$false;signalDelivered=$false;forcedCleanup=$false}
$ownedChild=$null
try {
    [void][SaCodeGoalProbe.Native]::FreeConsole()
    if (-not [SaCodeGoalProbe.Native]::AllocConsole()) { throw 'probe-console-unavailable' }
    [void][SaCodeGoalProbe.Native]::ShowWindow([SaCodeGoalProbe.Native]::GetConsoleWindow(),0)
    $start=[Diagnostics.ProcessStartInfo]::new()
    $start.FileName=$Exe; $start.Arguments='goal run signal-probe'; $start.WorkingDirectory=$WorkDir
    $start.UseShellExecute=$false; $start.CreateNoWindow=$false
    $start.RedirectStandardOutput=$true; $start.RedirectStandardError=$true; $start.RedirectStandardInput=$true
    $ownedChild=[Diagnostics.Process]::Start($start)
    $ownedChild.StandardInput.Close()
    $stdoutTask=$ownedChild.StandardOutput.ReadToEndAsync()
    $stderrTask=$ownedChild.StandardError.ReadToEndAsync()
    # 网络夹具落这个文件，表示真实请求已到达且响应保持打开。
    $deadline=[DateTime]::UtcNow.AddSeconds(15)
    while (-not (Test-Path -LiteralPath (Join-Path $WorkDir 'request-ready')) -and [DateTime]::UtcNow -lt $deadline -and -not $ownedChild.HasExited) { Start-Sleep -Milliseconds 50 }
    if ($ownedChild.HasExited) { throw 'cli-exited-before-signal' }
    if (-not (Test-Path -LiteralPath (Join-Path $WorkDir 'request-ready'))) { throw 'model-request-not-observed' }
    $consolePids=New-Object uint32[] 16
    $count=[SaCodeGoalProbe.Native]::GetConsoleProcessList($consolePids,16)
    if ($count -ne 2 -or $consolePids[0..($count-1)] -notcontains [uint32]$PID -or $consolePids[0..($count-1)] -notcontains [uint32]$ownedChild.Id) { throw 'console-not-isolated-to-owned-processes' }
    [void][SaCodeGoalProbe.Native]::SetConsoleCtrlHandler([IntPtr]::Zero,$true)
    $watch=[Diagnostics.Stopwatch]::StartNew()
    $probeResult.signalDelivered=[SaCodeGoalProbe.Native]::GenerateConsoleCtrlEvent(0,0)
    if (-not $probeResult.signalDelivered) { throw 'console-signal-delivery-failed' }
    if (-not $ownedChild.WaitForExit(60000)) { throw 'cli-cancel-did-not-settle' }
    $probeResult.elapsedMs=$watch.ElapsedMilliseconds
    $probeResult.exitCode=$ownedChild.ExitCode
    $probeResult.stdout=$stdoutTask.GetAwaiter().GetResult()
    $probeResult.stderr=$stderrTask.GetAwaiter().GetResult()
    if ($ownedChild.ExitCode -ne 130) { throw 'cli-cancel-exit-code-not-130' }
    $probeResult.passed=$true
} catch { $probeResult.error=$_.Exception.Message }
finally {
    if ($null -ne $ownedChild -and -not $ownedChild.HasExited) { $probeResult.forcedCleanup=$true; $ownedChild.Kill(); $ownedChild.WaitForExit() }
    $probeResult | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $WorkDir 'signal-result.json') -Encoding UTF8
    [void][SaCodeGoalProbe.Native]::FreeConsole()
}
if ($probeResult.passed) { exit 0 } else { exit 1 }
