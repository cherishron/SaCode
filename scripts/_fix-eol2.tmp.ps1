# 按内容对齐还原行尾：HEAD 里以 CRLF 结尾的行，在工作区对应行上恢复 CRLF。
# 容忍三件事：我的 token 重命名、对方对行的增删、行序稳定。
$ErrorActionPreference = 'Stop'
$repo = 'D:\Project\sa\saai\sa-code'
Set-Location $repo

# 与重命名脚本同一张表，用于把两侧都映射到「已重命名空间」再比对
$rules = [ordered]@{
  'dsh-host.exe'='sacode-host.exe'; 'DSH_PROVIDER_BASE_URL'='SACODE_PROVIDER_BASE_URL'
  'DSH_PROVIDER_KEY'='SACODE_PROVIDER_KEY'; 'DSH_PROVIDER_MODEL'='SACODE_PROVIDER_MODEL'
  'DSH_EXTJS_DIR'='SACODE_EXTJS_DIR'; 'DSH_HOST'='SACODE_HOST'
  'window.dsh'='window.sacode'; 'DshMsgFold'='SaCodeMsgFold'
  'dsh-smoke-'='sacode-smoke-'; 'dsh-session:'='sacode-session:'
  'exposeInMainWorld("dsh"'='exposeInMainWorld("sacode"'; 'dsh:'='sacode:'
  'dsh.exe'='sacode.exe'; 'dsh-cli-win32-x64'='sacode-cli-win32-x64'
  'dsh-cli'='sacode-cli'; 'usage: dsh '='usage: sacode '
  'you are dsh'='you are SaCode'; 'dsh extjs'='sacode extjs'
  'dsh call'='sacode call'; 'dsh realstream'='sacode realstream'; 'dsh headless'='sacode headless'
}
function Normalize([string]$s) { foreach ($k in $rules.Keys) { $s = $s.Replace($k, $rules[$k]) }; return $s }

function Read-BlobLines([string]$rel) {
  $tmp = Join-Path $env:TEMP ("blob_" + [guid]::NewGuid().ToString('N') + ".bin")
  cmd /c "git show HEAD:$rel > `"$tmp`"" 2>$null
  $b = [System.IO.File]::ReadAllBytes($tmp); Remove-Item $tmp -Force
  $lines = New-Object System.Collections.ArrayList; $start = 0
  for ($i = 0; $i -lt $b.Length; $i++) {
    if ($b[$i] -eq 10) {
      $hasCr = ($i -gt 0 -and $b[$i-1] -eq 13)
      $end = if ($hasCr) { $i - 1 } else { $i }
      $txt = [System.Text.Encoding]::UTF8.GetString($b, $start, $end - $start)
      [void]$lines.Add([pscustomobject]@{ Text = $txt; Crlf = $hasCr })
      $start = $i + 1
    }
  }
  if ($start -lt $b.Length) {
    $txt = [System.Text.Encoding]::UTF8.GetString($b, $start, $b.Length - $start)
    [void]$lines.Add([pscustomobject]@{ Text = $txt; Crlf = $false })
  }
  return ,$lines
}

function Read-WorkLines([string]$full) {
  $b = [System.IO.File]::ReadAllBytes($full)
  $lines = New-Object System.Collections.ArrayList; $start = 0
  for ($i = 0; $i -lt $b.Length; $i++) {
    if ($b[$i] -eq 10) {
      $hasCr = ($i -gt 0 -and $b[$i-1] -eq 13)
      $end = if ($hasCr) { $i - 1 } else { $i }
      $txt = [System.Text.Encoding]::UTF8.GetString($b, $start, $end - $start)
      [void]$lines.Add([pscustomobject]@{ Text = $txt; Crlf = $hasCr })
      $start = $i + 1
    }
  }
  if ($start -lt $b.Length) {
    $txt = [System.Text.Encoding]::UTF8.GetString($b, $start, $b.Length - $start)
    [void]$lines.Add([pscustomobject]@{ Text = $txt; Crlf = $false })
  }
  return ,$lines
}

$targets = @('apps/host/src/main.cj','apps/desktop/test-support/ui-smoke.cjs')
foreach ($f in $targets) {
  $full = Join-Path $repo ($f -replace '/', '\')
  if (-not (Test-Path $full)) { Write-Output "跳过（不存在）：$f"; continue }
  $head = Read-BlobLines $f
  $work = Read-WorkLines $full
  $headNorm = $head | ForEach-Object { Normalize $_.Text }
  $workNorm = $work | ForEach-Object { Normalize $_.Text }

  # 双指针对齐，带 3 行前瞻以吸收增删
  $j = 0; $restored = 0
  for ($i = 0; $i -lt $head.Count; $i++) {
    $h = $headNorm[$i]
    $matched = -1
    for ($k = $j; $k -lt [Math]::Min($j + 4, $work.Count); $k++) {
      if ($workNorm[$k] -ceq $h) { $matched = $k; break }
    }
    if ($matched -lt 0) { continue }              # HEAD 这行在工作区已被删
    for ($k = $j; $k -lt $matched; $k++) { }      # 工作区多出来的行，跳过
    if ($head[$i].Crlf -and -not $work[$matched].Crlf) { $work[$matched].Crlf = $true; $restored++ }
    $j = $matched + 1
  }

  $out = New-Object System.Collections.Generic.List[byte]
  $enc = [System.Text.Encoding]::UTF8
  foreach ($l in $work) {
    foreach ($by in $enc.GetBytes($l.Text)) { $out.Add($by) }
    if ($l.Crlf) { $out.Add([byte]13) }
    $out.Add([byte]10)
  }
  [System.IO.File]::WriteAllBytes($full, $out.ToArray())
  Write-Output "$f : 还原 CRLF $restored 行；工作区共 $($work.Count) 行"
}
