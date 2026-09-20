# SaCode I3 e2e：IdP 登录 → exchange → models（模拟浏览器完成 authorize）
$ErrorActionPreference = 'Stop'
$base = 'http://127.0.0.1:8080'
$gwb = 'http://127.0.0.1:8090'
$sacode = 'E:\Project\sa\saai\SaCode\target\debug\sacode.exe'
$sacodeHome = 'E:\Project\sa\saai\SaCode\.tmp-i3-home'
$workdir = 'E:\Project\sa\saai\SaCode\.tmp-i3-work'
$idpBin = 'E:\Project\sa\saai\sa-idp\target\debug\sa-idp.exe'
$idpWork = 'E:\Project\sa\saai\sa-idp\backend'

$env:SACODE_IDP_BASE_URL = $base
$env:SACODE_GATEWAY_BASE_URL = $gwb
$env:SACODE_IDENTITY_CLIENT_ID = 'sacode'
$env:SACODE_HOME = $sacodeHome
Remove-Item $sacodeHome, $workdir -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $sacodeHome, $workdir | Out-Null

function Start-IdpIfNeeded() {
  try { Invoke-RestMethod "$base/healthz" -TimeoutSec 3 | Out-Null; Write-Host 'idp already up'; return } catch {}
  # WMI + cmd 启动器：带 env，且不挂在工具作业下
  $r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
    CommandLine = 'cmd.exe /c E:\Project\sa\saai\sa-idp\scripts\start-dev.cmd'
  }
  Write-Host "start idp wmi rv=$($r.ReturnValue) pid=$($r.ProcessId)"
  for ($i = 0; $i -lt 180; $i++) {
    try { Invoke-RestMethod "$base/healthz" -TimeoutSec 8 | Out-Null; Write-Host 'idp ready'; return } catch {}
    Start-Sleep 1
  }
  throw 'idp not ready'
}

Start-IdpIfNeeded
$gwReady = $false
for ($i = 0; $i -lt 60; $i++) {
  try {
    $r = Invoke-RestMethod "$gwb/ready" -TimeoutSec 10
    if ($r.status -eq 'ok' -or $r.database -eq $true) { Write-Host "gw ready: $($r | ConvertTo-Json -Compress)"; $gwReady = $true; break }
  } catch {}
  Start-Sleep 2
}
if (-not $gwReady) {
  # 云库偶发 503：只要进程在监听就继续（exchange/models 会重试语义）
  try { Invoke-RestMethod "$gwb/health" -TimeoutSec 5 | Out-Null; Write-Host 'gw health ok, continue despite ready 503'; $gwReady = $true } catch {}
}
if (-not $gwReady) { Write-Host "gw not ready"; exit 3 }

$uname = "i3_$(Get-Random)"
$pw = "I3Pass!$(Get-Random)"
$reg = Invoke-RestMethod -Method Post "$base/api/register" -ContentType 'application/json' -Body (@{ username = $uname; password = $pw; email = "$uname@e.com" } | ConvertTo-Json)
$null = Invoke-RestMethod -Method Post "$base/api/login/password" -ContentType 'application/json' -SessionVariable sess -Body (@{ username = $uname; password = $pw } | ConvertTo-Json)
$cookie = ($sess.Cookies.GetCookies($base) | Where-Object { $_.Name -eq 'idp_session' } | Select-Object -First 1).Value
if (-not $cookie) { throw 'no idp_session cookie' }
Write-Host "registered uid=$($reg.user_id) user=$uname"

Push-Location $workdir
& $sacode account login --dry-run --idp $base --gateway $gwb
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "dry-run failed $LASTEXITCODE" }

$loginLog = Join-Path $workdir 'sacode-login.log'
$loginErr = Join-Path $workdir 'sacode-login.err.log'
$proc = Start-Process -FilePath $sacode -ArgumentList @(
  'account', 'login',
  '--idp', $base,
  '--gateway', $gwb,
  '--client-id', 'sacode',
  '--no-browser',
  '--insecure-file-secrets'
) -WorkingDirectory $workdir -RedirectStandardOutput $loginLog -RedirectStandardError $loginErr -PassThru
Write-Host "login pid=$($proc.Id)"

$authUrl = $null
for ($i = 0; $i -lt 50; $i++) {
  Start-Sleep -Milliseconds 400
  if (Test-Path $loginLog) {
    $txt = Get-Content $loginLog -Raw -ErrorAction SilentlyContinue
    if ($txt -match 'Authorize URL:\s*(\S+)') { $authUrl = $Matches[1]; break }
    if ($txt -match '(http://127\.0\.0\.1:8080/oauth/authorize\S+)') { $authUrl = $Matches[1]; break }
  }
}
if (-not $authUrl) {
  Write-Host '--- login log ---'; Get-Content $loginLog -ErrorAction SilentlyContinue
  Write-Host '--- login err ---'; Get-Content $loginErr -ErrorAction SilentlyContinue
  Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
  Pop-Location
  throw 'authorize url not found'
}
Write-Host "auth_url=$authUrl"

$req = [System.Net.HttpWebRequest]::Create($authUrl)
$req.AllowAutoRedirect = $false
$req.Headers.Add('Cookie', "idp_session=$cookie")
$loc = $null
try {
  $resp = $req.GetResponse()
  $loc = $resp.Headers['Location']
  $resp.Close()
} catch {
  $r = $_.Exception.Response
  if ($r) {
    $sr = New-Object System.IO.StreamReader($r.GetResponseStream())
    Write-Host "authorize error $([int]$r.StatusCode): $($sr.ReadToEnd())"
  } else { Write-Host "authorize ex: $($_.Exception.Message)" }
}
if (-not $loc) {
  Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
  Pop-Location
  throw 'authorize did not return Location'
}
Write-Host "callback=$loc"
try {
  $cb = Invoke-WebRequest -Uri $loc -UseBasicParsing -TimeoutSec 20
  Write-Host "callback HTTP $($cb.StatusCode)"
} catch {
  Write-Host "callback hit note: $($_.Exception.Message)"
}

# 轮询 session / 进程，最多 120s
$deadline = (Get-Date).AddSeconds(120)
$sessionPath = Join-Path $sacodeHome '.sacode\identity\session.json'
while ((Get-Date) -lt $deadline) {
  if ($proc.HasExited) { break }
  if (Test-Path $sessionPath) { break }
  Start-Sleep -Seconds 2
}
if (-not $proc.HasExited) {
  Start-Sleep -Seconds 5
  if (-not $proc.HasExited) {
    Write-Host 'login still running after wait, killing'
    Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
  }
}
Write-Host "login_exit=$($proc.ExitCode) hasExited=$($proc.HasExited)"
Write-Host '--- login stdout ---'
Get-Content $loginLog -ErrorAction SilentlyContinue
Write-Host '--- login stderr ---'
Get-Content $loginErr -ErrorAction SilentlyContinue
Write-Host '--- session path ---'
Write-Host $sessionPath
if (Test-Path $sessionPath) { Get-Content $sessionPath -ErrorAction SilentlyContinue }

& $sacode account status
Write-Host '--- account models ---'
& $sacode account models
Write-Host '--- provider.json ---'
$pj = Join-Path $workdir '.sacode\provider.json'
if (Test-Path $pj) { Get-Content $pj } else { Write-Host "(missing $pj)" }
Write-Host '--- session.json ---'
if (Test-Path $sessionPath) { Get-Content $sessionPath } else { Write-Host '(missing session)' }

# 安全基线：provider.json 不得出现明文 sa- key；session 只含 secret_ref/masked
$pass = $true
if (-not (Test-Path $sessionPath)) { Write-Host 'FAIL: no session.json'; $pass = $false }
else {
  $sessRaw = Get-Content $sessionPath -Raw
  if ($sessRaw -notmatch 'logged_in_at|gateway') { Write-Host 'FAIL: session not logged in'; $pass = $false }
  if ($sessRaw -match '"api_key"\s*:\s*"sa-') { Write-Host 'FAIL: plaintext api_key in session.json'; $pass = $false }
}
if (Test-Path $pj) {
  $pjRaw = Get-Content $pj -Raw
  if ($pjRaw -match '"api_key"\s*:\s*"[^"]{8,}"') { Write-Host 'FAIL: plaintext api_key in provider.json'; $pass = $false }
  if ($pjRaw -notmatch 'secret_ref|os_keyring') { Write-Host 'FAIL: provider.json missing secret_ref'; $pass = $false }
}
Pop-Location
if ($pass) { Write-Host 'I3 E2E PASS'; exit 0 }
Write-Host 'I3 E2E FAIL'
exit 1
