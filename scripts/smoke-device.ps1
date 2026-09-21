# SaCode ↔ sa-idp Device Authorization (RFC 8628) smoke
# Covers: device_authorization → password login → approve → token (offline_access + refresh)
# Optional: parallel `sacode account login --device` full client path.
$ErrorActionPreference = 'Stop'
$base = 'http://127.0.0.1:8080'
$gwb = $env:SACODE_GATEWAY_BASE_URL
if (-not $gwb) { $gwb = 'http://127.0.0.1:8090' }
$sacode = 'E:\Project\sa\saai\SaCode\target\debug\sacode.exe'
$sacodeHome = 'E:\Project\sa\saai\SaCode\.tmp-device-home'
$workdir = 'E:\Project\sa\saai\SaCode\.tmp-device-work'

$env:SACODE_IDP_BASE_URL = $base
$env:SACODE_GATEWAY_BASE_URL = $gwb
$env:SACODE_IDENTITY_CLIENT_ID = 'sacode'
$env:SACODE_HOME = $sacodeHome
$env:SACODE_IDENTITY_SECRET_BACKEND = 'file'
Remove-Item $sacodeHome, $workdir -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $sacodeHome, $workdir | Out-Null

# --- health / discovery ---
$h = Invoke-RestMethod "$base/healthz" -TimeoutSec 5
Write-Host "idp health: $($h | ConvertTo-Json -Compress)"
$disc = Invoke-RestMethod "$base/.well-known/openid-configuration" -TimeoutSec 5
if (-not $disc.device_authorization_endpoint) { throw 'discovery missing device_authorization_endpoint' }
if ($disc.grant_types_supported -notcontains 'urn:ietf:params:oauth:grant-type:device_code') {
  throw 'discovery missing device_code grant'
}
Write-Host "discovery device_endpoint=$($disc.device_authorization_endpoint)"

# --- register + login (session for approve) ---
$uname = "dev_$(Get-Random)"
$pw = "DevPass!$(Get-Random)"
$null = Invoke-RestMethod -Method Post "$base/api/register" -ContentType 'application/json' -Body (@{ username = $uname; password = $pw; email = "$uname@e.com" } | ConvertTo-Json)
$null = Invoke-RestMethod -Method Post "$base/api/login/password" -ContentType 'application/json' -SessionVariable sess -Body (@{ username = $uname; password = $pw } | ConvertTo-Json)
$cookie = ($sess.Cookies.GetCookies($base) | Where-Object { $_.Name -eq 'idp_session' } | Select-Object -First 1).Value
if (-not $cookie) { throw 'no idp_session cookie after password login' }
Write-Host "user $uname logged in (idp_session present)"

# --- device authorize ---
$dev = Invoke-RestMethod -Method Post "$disc.device_authorization_endpoint" -ContentType 'application/x-www-form-urlencoded' -Body "client_id=sacode&scope=openid%20profile%20email%20phone%20offline_access"
Write-Host "device: user_code=$($dev.user_code) verification_uri=$($dev.verification_uri) expires_in=$($dev.expires_in) interval=$($dev.interval)"
if (-not $dev.device_code -or -not $dev.user_code) { throw 'device_authorization missing device_code/user_code' }

# --- poll once (expect authorization_pending) ---
$tokenUrl = $disc.token_endpoint
function Poll-Token([string]$deviceCode) {
  try {
    return Invoke-RestMethod -Method Post $tokenUrl -ContentType 'application/x-www-form-urlencoded' -Body @{
      grant_type  = 'urn:ietf:params:oauth:grant-type:device_code'
      device_code = $deviceCode
      client_id   = 'sacode'
    }
  } catch {
    $resp = $_.Exception.Response
    if ($resp) {
      $reader = New-Object System.IO.StreamReader($resp.GetResponseStream())
      $body = $reader.ReadToEnd()
      return @{ error = $true; body = $body; status = [int]$resp.StatusCode }
    }
    throw
  }
}
$p1 = Poll-Token $dev.device_code
if ($p1.error -eq $true) {
  if ($p1.body -notmatch 'authorization_pending') { Write-Host "unexpected first poll: $($p1.body)" }
  else { Write-Host 'poll1: authorization_pending (ok)' }
} else {
  Write-Host 'poll1: unexpected early token'
}

# --- approve ---
$approve = Invoke-RestMethod -Method Post "$base/api/identity/device/approve" -ContentType 'application/json' -Headers @{ Cookie = "idp_session=$cookie" } -Body (@{ user_code = $dev.user_code; approve = $true } | ConvertTo-Json)
Write-Host "approve: $($approve | ConvertTo-Json -Compress)"

# --- poll token ---
$token = $null
for ($i = 0; $i -lt 20; $i++) {
  $t = Poll-Token $dev.device_code
  if ($t.error -eq $true) {
    Write-Host "poll[$i]: $($t.body)"
    if ($t.body -match 'expired_token|access_denied') { throw "device poll failed: $($t.body)" }
  } else {
    $token = $t
    break
  }
  Start-Sleep -Seconds 3
}
if (-not $token) { throw 'no token after approve' }
Write-Host "token: expires_in=$($token.expires_in) scope=$($token.scope) has_refresh=$([bool]$token.refresh_token) has_access=$([bool]$token.access_token)"
if (-not $token.refresh_token) { throw 'token missing refresh_token — offline_access/scope or client grant not applied' }
if ($token.scope -notmatch 'offline_access') { Write-Host "WARN scope missing offline_access: $($token.scope)" }
if ([int]$token.expires_in -lt 60) { Write-Host "WARN access expires_in unexpectedly small: $($token.expires_in)" }

# --- second poll should be one-time ---
$p2 = Poll-Token $dev.device_code
if ($p2.error -ne $true) { Write-Host 'WARN second poll still returned token (expected one-time device code)' }
elseif ($p2.body -match 'expired_token|authorization_pending|invalid') { Write-Host "poll2: one-time ok ($($p2.body))" }

# --- refresh grant (7-day policy) ---
$refreshBody = @{
  grant_type    = 'refresh_token'
  refresh_token = $token.refresh_token
  client_id     = 'sacode'
}
$rt = Invoke-RestMethod -Method Post $tokenUrl -ContentType 'application/x-www-form-urlencoded' -Body $refreshBody
Write-Host "refresh: new_access=$([bool]$rt.access_token) new_refresh=$([bool]$rt.refresh_token) expires_in=$($rt.expires_in)"
if (-not $rt.access_token) { throw 'refresh_token grant failed' }

# --- optional full SaCode CLI device login (parallel approve if needed) ---
if (Test-Path $sacode) {
  Push-Location $workdir
  $outLog = Join-Path $workdir 'device-cli.out.log'
  $errLog = Join-Path $workdir 'device-cli.err.log'
  $proc = Start-Process -FilePath $sacode -ArgumentList @(
    'account', 'login', '--device',
    '--idp', $base,
    '--gateway', $gwb,
    '--client-id', 'sacode',
    '--insecure-file-secrets'
  ) -WorkingDirectory $workdir -RedirectStandardOutput $outLog -RedirectStandardError $errLog -PassThru
  $cliCode = $null
  for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep -Milliseconds 400
    if (Test-Path $outLog) {
      $txt = Get-Content $outLog -Raw -ErrorAction SilentlyContinue
      if ($txt -match 'code:\s*([A-Z0-9-]+)') { $cliCode = $Matches[1]; break }
      if ($txt -match '([A-Z0-9]{4}-[A-Z0-9]{4})') { $cliCode = $Matches[1]; break }
    }
  }
  if ($cliCode) {
    Write-Host "CLI device user_code=$cliCode — approving"
    $null = Invoke-RestMethod -Method Post "$base/api/identity/device/approve" -ContentType 'application/json' -Headers @{ Cookie = "idp_session=$cookie" } -Body (@{ user_code = $cliCode; approve = $true } | ConvertTo-Json)
  } else {
    Write-Host 'CLI did not print user_code in time; dump logs:'
    if (Test-Path $outLog) { Get-Content $outLog | Select-Object -First 40 }
    if (Test-Path $errLog) { Get-Content $errLog | Select-Object -First 40 }
  }
  $exited = $proc.WaitForExit(90000)
  if (Test-Path $outLog) { Write-Host '--- cli stdout ---'; Get-Content $outLog | Select-Object -Last 40 }
  if (Test-Path $errLog) { Write-Host '--- cli stderr ---'; Get-Content $errLog | Select-Object -Last 40 }
  Pop-Location
  if (-not $exited) { Write-Host 'CLI still running (timeout)'; try { $proc.Kill() } catch {} }
  else { Write-Host "CLI exit=$($proc.ExitCode)" }
  & $sacode account status 2>$null | Write-Host
} else {
  Write-Host "skip CLI path: $sacode not built"
}

Write-Host 'DEVICE SMOKE OK'
