# SaCode Desktop — Windows Authenticode signing helper (D5)
#
# Tauri invokes this via `bundle.windows.signCommand`, passing the target file
# path as the trailing `%1` argument. It is also reused by CI to sign both the
# binary and the NSIS installer.
#
# Fail-closed, but dev-friendly:
#   * If $env:SACODE_CODESIGN_CERT_BASE64 is empty  -> exit 0 (unsigned build).
#     This keeps local `tauri build` / CI-without-cert working exactly as today.
#   * Otherwise decode the PFX, locate signtool.exe, and sign with SHA-256 +
#     RFC-3161 timestamping (so the signature stays valid after the cert expires).

param(
  [Parameter(Mandatory = $true, Position = 0)]
  [string]$File
)

$ErrorActionPreference = 'Stop'

if (-not $env:SACODE_CODESIGN_CERT_BASE64) {
  Write-Host "[sign] SACODE_CODESIGN_CERT_BASE64 not set -> skipping signing (unsigned build)."
  exit 0
}

if (-not (Test-Path -LiteralPath $File)) {
  Write-Error "Sign target not found: $File"
  exit 1
}

# Decode the PFX from the base64 secret into a temp file.
$pfxPath = Join-Path $env:TEMP "sacode-codesign.pfx"
[System.IO.File]::WriteAllBytes($pfxPath, [System.Convert]::FromBase64String($env:SACODE_CODESIGN_CERT_BASE64))

# Locate signtool.exe across common Windows SDK / WDK layouts.
$signtool = Get-ChildItem -Path "C:\Program Files (x86)\Windows Kits\10\bin" `
  -Recurse -Filter signtool.exe -ErrorAction SilentlyContinue |
  Sort-Object FullName -Descending | Select-Object -First 1

if (-not $signtool) {
  Write-Error "signtool.exe not found under Windows Kits; install the Windows SDK."
  exit 1
}

$certPass = $env:SACODE_CODESIGN_CERT_PASSWORD
$passwordArg = if ($certPass) { "/p `"$certPass`"" } else { "" }

# Dual-sign-friendly SHA-256 with a trusted RFC-3161 timestamp.
$cmd = "& `"$($signtool.FullName)`" sign /fd SHA256 /tr http://timestamp.digicert.com /td SHA256 /f `"$pfxPath`" $passwordArg `"$File`""
Write-Host "[sign] $cmd"
Invoke-Expression $cmd

if ($LASTEXITCODE -ne 0) {
  Write-Error "signtool failed with exit code $LASTEXITCODE"
  exit $LASTEXITCODE
}

Write-Host "[sign] Signed: $File"
exit 0
