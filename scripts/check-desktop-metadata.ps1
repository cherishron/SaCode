# 核对实际 Windows PE 元数据，不能用 package.json 的声明代替产物证据。
param(
    [Parameter(Mandatory = $true)][string]$ExePath,
    [string]$ExpectedVersion
)
$ErrorActionPreference = 'Stop'
if (-not $ExpectedVersion) {
    $taskPackage = Get-Content -LiteralPath (Join-Path $PSScriptRoot '../apps/desktop/package.json') -Raw | ConvertFrom-Json
    $ExpectedVersion = $taskPackage.version
}
$taskResolved = (Resolve-Path -LiteralPath $ExePath).Path
$taskInfo = [Diagnostics.FileVersionInfo]::GetVersionInfo($taskResolved)
foreach ($taskField in @('ProductName', 'FileDescription', 'CompanyName')) {
    if ($taskInfo.$taskField -cne 'SaCode') {
        throw "发布文件字段 $taskField 应为 SaCode，实际为 $($taskInfo.$taskField)"
    }
}
if ($taskInfo.LegalCopyright -notmatch '^Copyright © \d{4} SaCode$') {
    throw "发布文件版权信息异常：$($taskInfo.LegalCopyright)"
}
if ($taskInfo.FileVersion -ne $ExpectedVersion) {
    throw "发布文件版本应为 $ExpectedVersion，实际为 $($taskInfo.FileVersion)"
}
[pscustomobject]@{
    passed = $true
    path = $taskResolved
    product = $taskInfo.ProductName
    description = $taskInfo.FileDescription
    company = $taskInfo.CompanyName
    copyright = $taskInfo.LegalCopyright
    version = $taskInfo.FileVersion
} | ConvertTo-Json
