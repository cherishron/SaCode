# 使用已安装SDK验证P1，不重建SDK、不覆盖正式包。所有动态输出隔离。
param([string]$StdxDir = '')
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '../../../..')).Path
if ($env:OS -ne 'Windows_NT') { throw '该驱动仅验Windows，不代表其他平台通过' }
if (!$env:CANGJIE_HOME) { throw '需要已安装的CANGJIE_HOME' }
if (!$StdxDir) { $StdxDir = Join-Path $root '.deps/stdx/windows_x86_64_cjnative/dynamic/stdx' }
$StdxDir = (Resolve-Path $StdxDir).Path
$cjc = (Get-Command cjc -ErrorAction Stop).Source
function Run([string]$exe, [string[]]$arguments) {
    & $exe @arguments
    if ($LASTEXITCODE -ne 0) { throw "命令失败：$exe，退出码$LASTEXITCODE" }
}
$version = & $cjc -v
if ($LASTEXITCODE -ne 0 -or "$version" -notmatch '1\.1\.3\b' -or "$version" -notmatch 'x86_64-w64-mingw32') { throw '需要仓颉1.1.3 Windows x64 SDK' }
$dir = Join-Path $root ('apps/desktop/.tmp-test/p1-verification-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $dir | Out-Null
$imports = @('--import-path', $StdxDir, '--import-path', $dir)
$links = @()
Get-ChildItem $StdxDir -Filter '*.dll' | ForEach-Object { $links += @('--link-option', $_.FullName) }
$production = @(Get-ChildItem (Join-Path $root 'core/src') -Filter '*.cj' | Where-Object { !$_.Name.EndsWith('_test.cj') } | ForEach-Object { $_.FullName })
$launch = Join-Path $dir 'launch.a'
$core = Join-Path $dir 'libcore.a'
$runtime = Join-Path $env:CANGJIE_HOME 'runtime/lib/windows_x86_64_cjnative'
$pack = Join-Path $root 'scripts/pack-host.mjs'
Push-Location $root
$oldHost = $env:SACODE_HOST
$oldProbe = $env:SACODE_CLOSE_PROBE
try {
    Run $cjc @((Join-Path $root 'core/src/launch_context/integrity.cj'), '--output-type', 'staticlib', '-o', $launch)
    Run $cjc ($production + $imports + @('--output-type', 'staticlib', '-o', $core))
    $hostFiles = @(Get-ChildItem (Join-Path $root 'apps/host/src') -Filter '*.cj' | Where-Object { !$_.Name.EndsWith('_test.cj') } | ForEach-Object { $_.FullName })
    $hostExe = Join-Path $dir 'host.exe'
    Run $cjc ($hostFiles + $imports + $links + @('--link-option', $core, '--link-option', $launch, '-o', $hostExe))
    $hostPack = Join-Path $dir 'host'
    Run 'node' @($pack, $hostExe, $hostPack, $StdxDir, $runtime)
    $env:SACODE_HOST = Join-Path $hostPack 'bin/sacode-host.exe'
    Run 'node' @('--test', (Join-Path $PSScriptRoot 'local-routing.test.mjs'))
    $budgetExe = Join-Path $dir 'budget.exe'
    Run $cjc ($production + @((Join-Path $root 'core/src/model_request_budget_test.cj'), '--test') + $imports + $links + @('--link-option', $launch, '-o', $budgetExe))
    $budgetPack = Join-Path $dir 'budget'
    Run 'node' @($pack, $budgetExe, $budgetPack, $StdxDir, $runtime)
    Run (Join-Path $budgetPack 'bin/sacode-host.exe') @()
    $probeExe = Join-Path $dir 'probe.exe'
    Run $cjc (@((Join-Path $root 'apps/host/test/fixtures/models/client-close-probe.cj')) + $imports + $links + @('-o', $probeExe))
    $probePack = Join-Path $dir 'probe'
    Run 'node' @($pack, $probeExe, $probePack, $StdxDir, $runtime)
    $env:SACODE_CLOSE_PROBE = Join-Path $probePack 'bin/sacode-host.exe'
    Run 'node' @('--test', (Join-Path $PSScriptRoot 'client-close-probe.test.mjs'))
    Write-Output "P1 Windows本地验证通过；证据产物保留于$dir，不代表安装态或真实提供方验收"
} finally {
    $env:SACODE_HOST = $oldHost
    $env:SACODE_CLOSE_PROBE = $oldProbe
    Pop-Location
}
