# 修复：把被脚本剥离的 CRLF 按 HEAD 的行尾样式逐行恢复。
# 只用行号对齐——我的重命名是纯字符串替换，不增删行，所以行数一致时行号可信。
$ErrorActionPreference = 'Stop'
$repo = 'D:\Project\sa\saai\sa-code'
Set-Location $repo

function Get-BlobBytes([string]$rel) {
  $tmp = Join-Path $env:TEMP ("blob_" + [guid]::NewGuid().ToString('N') + ".bin")
  cmd /c "git show HEAD:$rel > `"$tmp`"" 2>$null
  $b = [System.IO.File]::ReadAllBytes($tmp)
  Remove-Item $tmp -Force
  return ,$b
}

# 按 \n 切行，保留每行是否以 \r\n 结尾的信息
function Split-KeepEol([byte[]]$bytes) {
  $lines = New-Object System.Collections.ArrayList
  $start = 0
  for ($i = 0; $i -lt $bytes.Length; $i++) {
    if ($bytes[$i] -eq 10) {
      $hasCr = ($i -gt 0 -and $bytes[$i - 1] -eq 13)
      $len = $i - $start + 1
      $arr = New-Object byte[] $len
      [Array]::Copy($bytes, $start, $arr, 0, $len)
      [void]$lines.Add([pscustomobject]@{ Bytes = $arr; Crlf = $hasCr })
      $start = $i + 1
    }
  }
  if ($start -lt $bytes.Length) {
    $len = $bytes.Length - $start
    $arr = New-Object byte[] $len
    [Array]::Copy($bytes, $start, $arr, 0, $len)
    [void]$lines.Add([pscustomobject]@{ Bytes = $arr; Crlf = $false })
  }
  return $lines
}

$files = git diff --name-only
$fixed = @(); $skipped = @()
foreach ($f in $files) {
  $full = Join-Path $repo ($f -replace '/', '\')
  if (-not (Test-Path $full)) { continue }
  $head = Split-KeepEol (Get-BlobBytes $f)
  $work = Split-KeepEol ([System.IO.File]::ReadAllBytes($full))
  $headCrlf = ($head | Where-Object { $_.Crlf }).Count
  $workCrlf = ($work | Where-Object { $_.Crlf }).Count
  if ($headCrlf -eq $workCrlf) { continue }          # 无需修复
  if ($head.Count -ne $work.Count) { $skipped += "$f (行数 $($head.Count) vs $($work.Count))"; continue }

  $out = New-Object System.Collections.Generic.List[byte]
  for ($i = 0; $i -lt $work.Count; $i++) {
    $line = $work[$i].Bytes
    $wantCrlf = $head[$i].Crlf
    $isCrlf = $work[$i].Crlf
    if ($wantCrlf -and -not $isCrlf -and $line.Length -ge 1 -and $line[$line.Length - 1] -eq 10) {
      # 在 LF 前插回 CR
      for ($k = 0; $k -lt $line.Length - 1; $k++) { $out.Add($line[$k]) }
      $out.Add([byte]13); $out.Add([byte]10)
    } elseif ((-not $wantCrlf) -and $isCrlf) {
      # 反向：HEAD 是裸 LF 而工作区是 CRLF，也拉平
      for ($k = 0; $k -lt $line.Length - 2; $k++) { $out.Add($line[$k]) }
      $out.Add([byte]10)
    } else {
      foreach ($b in $line) { $out.Add($b) }
    }
  }
  [System.IO.File]::WriteAllBytes($full, $out.ToArray())
  $fixed += "$f  CRLF $workCrlf -> $((Split-KeepEol $out.ToArray() | Where-Object { $_.Crlf }).Count)"
}

Write-Output "=== 行尾已修复 ==="
if ($fixed.Count) { $fixed | ForEach-Object { "  $_" } } else { Write-Output "  (无)" }
Write-Output "=== 行数不一致，跳过（需人工看）==="
if ($skipped.Count) { $skipped | ForEach-Object { "  $_" } } else { Write-Output "  (无)" }
