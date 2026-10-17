# Ctrl+C 端到端取证驱动。
#
# 为什么要有这个脚本：core 侧的用例只能证明「处理器体确实取消了在册令牌」，
# 证不了「系统真的会把中断投递进我们的回调」。这一步不成立，整条协作式取消
# 就还是自称。这里用 kernel32 的 AttachConsole + GenerateConsoleCtrlEvent
# 向被测进程所在控制台发一次真的 CTRL_C_EVENT，再按退出码与断言行判收束。
#
# 用法：powershell -NoProfile -ExecutionPolicy Bypass -File scripts/sigwin-e2e.ps1 `
#          -Exe <dsh.exe 绝对路径> -WorkDir <空目录>
# 输出：E2E PASS / E2E FAIL <原因>，退出码 0 仅当且仅当全部断言成立。

param(
    [Parameter(Mandatory = $true)][string]$Exe,
    [Parameter(Mandatory = $true)][string]$WorkDir,
    [string]$Mode = 'sig',
    [int]$TimeoutSec = 30
)

$ErrorActionPreference = 'Stop'

Add-Type -Namespace Dsh -Name Win -MemberDefinition @'
[DllImport("kernel32.dll", SetLastError = true)] public static extern bool FreeConsole();
[DllImport("kernel32.dll", SetLastError = true)] public static extern bool AttachConsole(uint pid);
[DllImport("kernel32.dll", SetLastError = true)] public static extern bool GenerateConsoleCtrlEvent(uint evt, uint pid);
[DllImport("kernel32.dll", SetLastError = true)] public static extern bool SetConsoleCtrlHandler(IntPtr handler, bool add);
'@

# 本脚本由外层用 start 在**新控制台**里拉起（控制台输出看不见），所以判决同时落一份结果文件。
if (-not (Test-Path $WorkDir)) { New-Item -ItemType Directory -Path $WorkDir | Out-Null }
$resultFile = Join-Path $WorkDir 'e2e-result.txt'
function Say([string]$line) {
    Write-Output $line
    Add-Content -Path $resultFile -Value $line
}

function Fail([string]$why) {
    Say "E2E FAIL $why"
    exit 1
}

if (-not (Test-Path $Exe)) { Fail "被测 exe 不存在: $Exe" }

$outFile = Join-Path $WorkDir 'sig-out.txt'
if (Test-Path $outFile) { Remove-Item $outFile -Force }

# 被测进程与驱动**共用一个控制台**：由外层用 start（新建控制台）拉起本脚本，
# 被测进程再用 -NoNewWindow 挂进同一个控制台。
# 先前试过的「FreeConsole + AttachConsole(目标 pid) + GenerateConsoleCtrlEvent」实测
# 目标侧 SetConsoleCtrlHandler 返回 1（注册成功）但 hits 恒为 0 —— 事件根本没投到，
# 所以取证改走同源控制台这条路。
$p = Start-Process -FilePath $Exe -ArgumentList $Mode -WorkingDirectory $WorkDir `
    -NoNewWindow -RedirectStandardOutput $outFile -PassThru

$deadline = (Get-Date).AddSeconds(10)
$handoff = $false
while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 100
    if (Test-Path $outFile) {
        $text = Get-Content $outFile -Raw -ErrorAction SilentlyContinue
        if ($text -and $text.Contains('handoff')) { $handoff = $true; break }
    }
    if ($p.HasExited) {
        $soFar = ''
        if (Test-Path $outFile) { $soFar = Get-Content $outFile -Raw -ErrorAction SilentlyContinue }
        Fail "被测进程在发中断前就退出了 exit=[$($p.ExitCode)] 已写出=[$soFar]"
    }
}
if (-not $handoff) { $p.Kill(); Fail '等握手行超时（没看到 sig handoff）' }

# 驱动自己先「移除全部处理器」= 本进程忽略 Ctrl+C，
# 否则同一个控制台里的事件会先把驱动打断，看起来像目标没响应。
# NULL + TRUE 是文档化的「屏蔽」写法。
[void][Dsh.Win]::SetConsoleCtrlHandler([IntPtr]::Zero, $true)

# 投递按三种 documented 组合逐级试：(CTRL_C, 0)=本控制台全部进程组、
# (CTRL_C, pid)=进程组 id 恰为 pid 的那些、(CTRL_BREAK, pid)=只发给该进程组。
# 每级发完给目标 3 秒收束窗口；协作式取消一旦生效，目标会结算并退出。
$targetPid = [uint32]$p.Id
$candidates = @(@(0, [uint32]0), @(0, $targetPid), @(1, $targetPid))
$sent = @()
foreach ($c in $candidates) {
    $evt = [uint32]$c[0]
    $grp = [uint32]$c[1]
    $okEvt = [Dsh.Win]::GenerateConsoleCtrlEvent($evt, $grp)
    $w32 = [System.Runtime.InteropServices.Marshal]::GetLastWin32Error()
    $sent += "evt=$evt grp=$grp ret=$okEvt err=$w32"
    $null = $p.WaitForExit(3000)
    if ($p.HasExited) { break }
}
Say "投递尝试: $($sent -join ' | ')"

if (-not $p.WaitForExit($TimeoutSec * 1000)) {
    $stuck = ''
    if (Test-Path $outFile) { $stuck = Get-Content $outFile -Raw -ErrorAction SilentlyContinue }
    $p.Kill()
    Fail "发了中断但目标进程 $TimeoutSec 秒内没收束（协作式取消没接上）。中断后已写出=[$stuck]"
}

$final = Get-Content $outFile -Raw
Say "---- 被测输出 ----"
Say "$final"
Say "---- exit=$($p.ExitCode) ----"

if ($final -cmatch 'FAIL') { Fail '被测进程自报断言失败' }
# OS 投递的唯一证据：处理器计数 hits 从 0 变 1、事件类型 kind=0（CTRL_C）
if (-not $final.Contains('hits=1')) { Fail 'hits 没变成 1：处理器没被系统调起，中断没送到' }
if (-not $final.Contains('kind=0')) { Fail 'kind 不是 0：收到的不是 CTRL_C' }
if (-not $final.Contains('cancelled=true')) { Fail 'cancelled=true 缺失：中断没取消在途 turn' }
if (-not $final.Contains('code=130')) { Fail '缺少自报的 code=130 结算行' }
if ($p.ExitCode -ne 130) { Fail "退出码应为 130（128+SIGINT），实得 [$($p.ExitCode)]" }

Say 'E2E PASS'
exit 0
