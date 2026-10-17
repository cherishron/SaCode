# 在普通、非管理员 PowerShell 中手动运行；不自动寻找或启动高完整性进程。
# 探针是纯仓颉可执行文件，只创建挂起进程、验证身份并终止，不恢复、不改 ACL。
[CmdletBinding()]
param(
    [string]$ProbePath = "",
    [string]$CangjieHome = ""
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
if (!$ProbePath) {
    $ProbePath = Join-Path $root "target\tmp\appcontainer-research-20261013\identity-final-probe.exe"
}
if (!$CangjieHome) {
    $CangjieHome = $env:CANGJIE_HOME
    if (!$CangjieHome) { $CangjieHome = "D:\Program Files\HuaWei\Cangjie" }
}

# 冻结的 2026-10-13 对照原件；不以调用方自报摘要替代它。
$expected = "5A042992466B073CA49570899529636B93894D8B67D9AEDB7D646F64CF603AD6"
if (!(Test-Path -LiteralPath $ProbePath -PathType Leaf)) { throw "找不到冻结探针：$ProbePath" }
if ((Get-FileHash -LiteralPath $ProbePath -Algorithm SHA256).Hash -ne $expected) {
    throw "探针摘要不符，停止。请重新冻结探针，不能拿不同源码冒充同机对照。"
}

$runtime = Join-Path $CangjieHome "runtime\lib\windows_x86_64_cjnative"
$dlls = @("libcangjie-runtime.dll", "libboundscheck.dll")
foreach ($dll in $dlls) {
    if (!(Test-Path -LiteralPath (Join-Path $runtime $dll) -PathType Leaf)) { throw "缺仓颉运行库：$dll" }
}

# 手动窗口中的普通临时目录。仅创建自己的唯一子目录，不调整任何 ACL/完整性标签。
$base = Join-Path ([IO.Path]::GetTempPath()) "SaCode-AppContainer-Identity"
$output = Join-Path $base ([Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $output -Force | Out-Null
$exe = Join-Path $output "identity-probe.exe"
Copy-Item -LiteralPath $ProbePath -Destination $exe
foreach ($dll in $dlls) { Copy-Item -LiteralPath (Join-Path $runtime $dll) -Destination (Join-Path $output $dll) }
if ((Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash -ne $expected) { throw "复制后的摘要不符" }

$start = New-Object System.Diagnostics.ProcessStartInfo
$start.FileName = $exe
$start.WorkingDirectory = $output
$start.UseShellExecute = $false
$start.RedirectStandardOutput = $true
$start.RedirectStandardError = $true
$start.CreateNoWindow = $true
# 身份探针不需要父进程凭据、模型设置或网络配置，只传系统定位字段。
$start.EnvironmentVariables.Clear()
$start.EnvironmentVariables["SystemRoot"] = $env:SystemRoot
$start.EnvironmentVariables["WINDIR"] = $env:SystemRoot
$start.EnvironmentVariables["PATH"] = (Join-Path $env:SystemRoot "System32")
$start.EnvironmentVariables["TMP"] = $output
$start.EnvironmentVariables["TEMP"] = $output

$process = New-Object System.Diagnostics.Process
$process.StartInfo = $start
$timedOut = $false
$stdout = ""
$stderr = ""
$exitCode = -1
try {
    if (!$process.Start()) { throw "探针未启动" }
    $readOut = $process.StandardOutput.ReadToEndAsync()
    $readErr = $process.StandardError.ReadToEndAsync()
    if (!$process.WaitForExit(30000)) {
        $timedOut = $true
        # 只终止本脚本创建的根进程；不把此动作声称为子进程树已收束。
        $process.Kill()
        if (!$process.WaitForExit(5000)) { throw "本脚本创建的探针终止未确认" }
    }
    if (!$readOut.Wait(5000) -or !$readErr.Wait(5000)) { throw "输出捕获未收束" }
    $stdout = $readOut.Result
    $stderr = $readErr.Result
    $exitCode = $process.ExitCode
} finally {
    $process.Dispose()
    [IO.File]::WriteAllText((Join-Path $output "stdout.log"), $stdout, [Text.UTF8Encoding]::new($false))
    [IO.File]::WriteAllText((Join-Path $output "stderr.log"), $stderr, [Text.UTF8Encoding]::new($false))
}

$integrity = -1
if ($stdout -match "(?m)^caller_integrity_rid=(\d+)\s*$") { $integrity = [int]$Matches[1] }
$medium = $integrity -ge 8192 -and $integrity -lt 12288
$control = $stdout -match "(?m)^control_created=true control_terminated=true\s*$"
$identity = $stdout -match "(?m)^available=true created=true appContainer=true sidMatches=true terminated=true pid=\d+ reason=identity-verified-not-resumed\s*$"
$passed = $medium -and $control -and $identity -and !$timedOut -and $exitCode -eq 0 -and !$stderr.Trim()
$status = "IDENTITY_FAILED"
if (!$medium) { $status = "NOT_MEDIUM_CONTEXT" }
elseif ($passed) { $status = "IDENTITY_ONLY_PASS" }

$report = [ordered]@{
    version = 1
    recordedUtc = [DateTime]::UtcNow.ToString("o")
    probeSha256 = $expected
    runtime = @($dlls | ForEach-Object { [ordered]@{ name = $_; sha256 = (Get-FileHash (Join-Path $output $_) -Algorithm SHA256).Hash } })
    integrityRid = $integrity
    mediumContext = $medium
    controlPassed = $control
    identityPassed = $identity
    timedOut = $timedOut
    actualExitCode = $exitCode
    status = $status
    productSandboxEnabled = $false
}
[IO.File]::WriteAllText((Join-Path $output "result.json"), ($report | ConvertTo-Json -Depth 6), [Text.UTF8Encoding]::new($false))
Write-Host $stdout
Write-Host "结果：$status；探针实际退出码：$exitCode"
Write-Host "证据目录：$output"
Write-Host "这里只验证身份，没有执行命令、改 ACL 或开放产品门禁。"
if ($passed) { exit 0 }
if (!$medium) { exit 2 }
exit 1
