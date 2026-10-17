# Run in a separate, ordinary PowerShell process. No installation, ACL change or cleanup.
[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$CoreRelease,
    [Parameter(Mandatory=$true)][string]$DestinationRoot,
    [string]$NativeDll = '',
    [string]$SdkHome = $env:CANGJIE_HOME,
    [string]$StdxDllDir = $env:SACODE_STDX_DLL_DIR
)
$ErrorActionPreference='Stop'
$repo=Split-Path -Parent $PSScriptRoot
if (!$SdkHome) { $SdkHome='D:\Program Files\HuaWei\Cangjie' }
if (!$StdxDllDir) { $StdxDllDir='C:\Users\jingg\stdx-work\stdx-1.1.3.1\windows_x86_64_cjnative\dynamic\stdx' }
if (!$NativeDll) { $NativeDll=Join-Path $repo '.deps\native\win32-x64\sacode-windows-process.dll' }
$CoreRelease=(Resolve-Path -LiteralPath $CoreRelease).Path
$NativeDll=(Resolve-Path -LiteralPath $NativeDll).Path
$coreLib=Join-Path $CoreRelease 'core'
foreach($file in @((Join-Path $coreLib 'libcore.a'),(Join-Path $coreLib 'core.cjo'),$NativeDll,(Join-Path $SdkHome 'envsetup.ps1'))) {
    if (!(Test-Path -LiteralPath $file -PathType Leaf)) { throw "Missing input: $file" }
}
if (!(Test-Path -LiteralPath $StdxDllDir -PathType Container)) { throw 'Missing installed stdx runtime directory' }
$run=Join-Path $repo ('target\tmp\windows-adapter-' + (Get-Date -Format 'yyyyMMdd') + '-' + [guid]::NewGuid().ToString('N'))
$source=Join-Path $run 'src'
$payload=Join-Path $run 'payload'
$compileTemp=Join-Path $run 'compile-temp'
$runtimeTemp=Join-Path $run 'runtime-temp'
New-Item -ItemType Directory -Path $source,$payload,$compileTemp,$runtimeTemp -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $repo 'core\test-support\windows_process_adapter_test.cj') -Destination (Join-Path $source 'windows_process_adapter_test.cj')
Copy-Item -LiteralPath $NativeDll -Destination (Join-Path $payload 'sacode-windows-process.dll')
. (Join-Path $SdkHome 'envsetup.ps1')
$env:TEMP=$compileTemp
$env:TMP=$compileTemp
$env:PATH="$StdxDllDir;$env:PATH"
$compiler=Join-Path $SdkHome 'bin\cjc.exe'
$compilerArgs=@('--import-path',$CoreRelease,'--import-path',$StdxDllDir,'--test-only','-L',$coreLib,'-lcore','-lcore.launch_context','-L',$StdxDllDir)
foreach($lib in @('stdx.encoding.json','stdx.serialization.serialization','stdx.net.tls','stdx.net.http','stdx.net.tls.common','stdx.logger','stdx.log','stdx.encoding.url','stdx.encoding.json.stream','stdx.crypto.x509','stdx.crypto.keys','stdx.encoding.hex','stdx.crypto.crypto','stdx.crypto.digest','stdx.crypto.common','stdx.encoding.base64')) {
    $compilerArgs += "-l$lib"
}
$compilerArgs += @('-p',$source,'-o',(Join-Path $payload 'adapter-test.exe'),'--mock=off','--no-sub-pkg')
& $compiler @compilerArgs *> (Join-Path $run 'compile.log')
$compileRc=$LASTEXITCODE
Set-Content -LiteralPath (Join-Path $run 'compile.exit') -Value $compileRc
if ($compileRc -ne 0) { Get-Content (Join-Path $run 'compile.log'); throw "CJC failed: $compileRc" }
$neutral=Join-Path $DestinationRoot (Split-Path -Leaf $run)
& node (Join-Path $repo 'scripts\export-windows-artifact.mjs') $payload $neutral *> (Join-Path $run 'export.log')
if ($LASTEXITCODE -ne 0) { Get-Content (Join-Path $run 'export.log'); throw 'Neutral export failed; no permissions are changed' }
$env:SACODE_WINDOWS_PROCESS_DLL=Join-Path $neutral 'sacode-windows-process.dll'
$env:SACODE_WINDOWS_SCOPE_PARENT=$neutral
$env:SACODE_WORKSPACE_FIXTURE_NODE=(Get-Command node).Source
$env:SACODE_WORKSPACE_CLEANUP_SCRIPT=Join-Path $repo 'scripts\cleanup-windows-workspace-fixture.mjs'
$env:SACODE_DISPOSAL_FIXTURE_SCRIPT=Join-Path $repo 'scripts\create-windows-workspace-disposal-fixture.mjs'
$env:SACODE_SNAPSHOT_LINK_SCRIPT=Join-Path $repo 'scripts\create-windows-snapshot-link-fixture.mjs'
$env:TEMP=$runtimeTemp
$env:TMP=$runtimeTemp
$stdout=Join-Path $run 'run.out'
$stderr=Join-Path $run 'run.err'
$process=Start-Process -FilePath (Join-Path $neutral 'adapter-test.exe') -ArgumentList @('--no-progress','--no-color','--timeout-each=30s') -WorkingDirectory $neutral -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
$timedOut=$false
$completed=$process.WaitForExit(60000)
if (!$completed) { $completed=$process.WaitForExit(60000) }
if (!$completed) { $completed=$process.WaitForExit(60000) }
if (!$completed) {
    $timedOut=$true
    $process.Kill($true)
    if (!$process.WaitForExit(5000)) { throw 'Owned test termination unconfirmed' }
}
$actualExit=$process.ExitCode
Set-Content -LiteralPath (Join-Path $run 'run.exit') -Value $actualExit
$outStream=[IO.File]::Open($stdout,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::ReadWrite)
$outReader=[IO.StreamReader]::new($outStream,[Text.Encoding]::UTF8)
try { $outText=$outReader.ReadToEnd() } finally { $outReader.Dispose() }
$clean=[regex]::Replace($outText,'\x1B(?:\[[0-?]*[ -/]*[@-~]|.)','')
[IO.File]::WriteAllText((Join-Path $run 'run.clean.log'),$clean)
$summaries=[regex]::Matches($clean,'Summary:\s*TOTAL:\s*(\d+)\s*PASSED:\s*(\d+),\s*SKIPPED:\s*(\d+),\s*ERROR:\s*(\d+)\s*FAILED:\s*(\d+)')
$passed=$false
if ($summaries.Count -gt 0) {
    $summary=$summaries[$summaries.Count-1]
    $passed=!$timedOut -and $actualExit -eq 0 -and $summary.Groups[1].Value -eq '54' -and $summary.Groups[2].Value -eq '54' -and $summary.Groups[3].Value -eq '0' -and $summary.Groups[4].Value -eq '0' -and $summary.Groups[5].Value -eq '0'
}
$report=[ordered]@{version=1;passed=$passed;timedOut=$timedOut;exitCode=$actualExit;expectedTests=54;runtimeLimitMs=180000;neutral=$neutral;
    coreLibrarySha256=(Get-FileHash (Join-Path $coreLib 'libcore.a')).Hash;
    adapterSourceSha256=(Get-FileHash (Join-Path $repo 'core\src\windows_process_adapter.cj')).Hash;
    processProviderSourceSha256=(Get-FileHash (Join-Path $repo 'core\src\execution_process_provider.cj')).Hash;
    executionServiceSourceSha256=(Get-FileHash (Join-Path $repo 'core\src\execution_service.cj')).Hash;
    reviewPlatformSourceSha256=(Get-FileHash (Join-Path $repo 'core\src\review_platform.cj')).Hash;
    reviewApplySourceSha256=(Get-FileHash (Join-Path $repo 'core\src\execution_review_apply.cj')).Hash;
    reviewApiSourceSha256=(Get-FileHash (Join-Path $repo 'core\src\execution_review_api.cj')).Hash;
    executionApiSourceSha256=(Get-FileHash (Join-Path $repo 'core\src\execution_api.cj')).Hash;
    supervisorSourceSha256=(Get-FileHash (Join-Path $repo 'core\src\execution_supervisor.cj')).Hash;
    workspaceAdapterSourceSha256=(Get-FileHash (Join-Path $repo 'core\src\windows_workspace_adapter.cj')).Hash;
    toolBindingSourceSha256=(Get-FileHash (Join-Path $repo 'core\src\windows_execution_tool.cj')).Hash;
    capsuleSourceSha256=(Get-FileHash (Join-Path $repo 'core\src\windows_execution_capsule.cj')).Hash;
    workspaceInterfaceSourceSha256=(Get-FileHash (Join-Path $repo 'core\src\execution_workspace.cj')).Hash;
    snapshotSettlementSourceSha256=(Get-FileHash (Join-Path $repo 'core\src\windows_snapshot_settlement.cj')).Hash;
    snapshotProviderSourceSha256=(Get-FileHash (Join-Path $repo 'core\src\windows_snapshot_provider.cj')).Hash;
    workspaceSnapshotSourceSha256=(Get-FileHash (Join-Path $repo 'core\src\windows_workspace_snapshot.cj')).Hash;
    nativeTreeSourceSha256=(Get-FileHash (Join-Path $repo 'core\native\windows_tree.c')).Hash;
    nativeTreeHeaderSha256=(Get-FileHash (Join-Path $repo 'core\native\windows_tree.h')).Hash;
    snapshotLinkFixtureSha256=(Get-FileHash $env:SACODE_SNAPSHOT_LINK_SCRIPT).Hash;
    workspaceNativeSourceSha256=(Get-FileHash (Join-Path $repo 'core\native\windows_workspace.c')).Hash;
    workspaceNativeHeaderSha256=(Get-FileHash (Join-Path $repo 'core\native\windows_workspace.h')).Hash;
    disposalFixtureSha256=(Get-FileHash $env:SACODE_DISPOSAL_FIXTURE_SCRIPT).Hash;
    fixtureCleanupScriptSha256=(Get-FileHash $env:SACODE_WORKSPACE_CLEANUP_SCRIPT).Hash;
    testSourceSha256=(Get-FileHash (Join-Path $source 'windows_process_adapter_test.cj')).Hash;
    nativeDllSha256=(Get-FileHash $NativeDll).Hash;
    runtimeSha256=(Get-FileHash (Join-Path $SdkHome 'runtime\lib\windows_x86_64_cjnative\libcangjie-runtime.dll')).Hash}
[IO.File]::WriteAllText((Join-Path $run 'verification.json'),($report | ConvertTo-Json -Depth 4))
Write-Output $clean
Write-Output "EVIDENCE=$run"
if (!$passed) { Get-Content $stderr; throw 'Current-source adapter tests did not produce a nonempty 54/54 Summary' }
