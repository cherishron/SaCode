# 用法：pwsh -File scripts/run-core-tests.ps1 [-Filter "testA,testB"] [-All]
#
# 为什么需要这个脚本：`cjpm test` 的 worker 派发路径在本机稳定复现
# `Exception: Too many attempts to create a temporary file`
# （std.unittest::TempDirectory::createTempFile），测试一条都跑不起来。
# 但 `cjpm test` 已经把 unittest 二进制链出来了，直接跑那个二进制
# （等价于 cjpm 内部那一步，只是省掉 worker 派发）就能正常出结果。
# 证据：docs/evidence/h70-external-drivers-2026-10-06.md §测试环境
#
# 注意：--filter 是**精确用例名**匹配（不是子串），多个用逗号分隔。
param(
    [string]$Filter = "",
    [switch]$All
)

$root = Split-Path -Parent $PSScriptRoot
$bin = Join-Path $root "core\target\release\unittest_bin"
$stdx = "C:\Users\jingg\stdx-work\stdx-1.1.3.1\windows_x86_64_cjnative\dynamic\stdx"

Write-Host "[1/3] cjpm build -i"
Push-Location (Join-Path $root "core")
try {
    & cjpm build -i 2>&1 | Out-String | Out-Null
    $rc = $LASTEXITCODE
    if ($rc -ne 0) { Write-Host "构建失败 rc=$rc"; exit 1 }

    # [2/3] 让 cjpm 把 unittest 二进制重链出来。worker 派发会失败，忽略它。
    # 注意：这一步**不带 --filter**。带 filter 时 cjpm 会走筛选分支，
    # 新增的 *_test.cj 用例不会被编进二进制（实测 TOTAL 不变、用例被 SKIPPED）。
    Write-Host "[2/3] 重链 unittest 二进制（worker 派发失败已忽略）"
    & cjpm test --parallel 1 --no-progress --no-color 2>&1 | Out-String | Out-Null
} finally {
    Pop-Location
}

if (-not (Test-Path (Join-Path $bin "core.exe"))) {
    Write-Host "未找到 core.exe"; exit 2
}

Write-Host "[3/3] 直接运行 unittest 二进制"
$env:Path = "$stdx;$env:Path"
Push-Location $bin
try {
    $args = @("--no-color", "--parallel=1", "--no-progress")
    if (-not $All -and $Filter.Length -gt 0) { $args += "--filter=$Filter" }
    & .\core.exe @args
    exit $LASTEXITCODE
} finally {
    Pop-Location
}
