# 一次性迁移：把产品面残留的 dsh 命名换成 SaCode。
# 只做 token 级精确替换——盲目替换 'dsh' 会毁掉 handshake（含 dsh）与 foldedShown（含 dSh）。
$ErrorActionPreference = 'Stop'
$repo = 'D:\Project\sa\saai\sa-code'

# 顺序有意义：先长后短，避免短模式吃掉长模式的前缀。
$rules = [ordered]@{
  'dsh-host.exe'          = 'sacode-host.exe'
  'DSH_PROVIDER_BASE_URL' = 'SACODE_PROVIDER_BASE_URL'
  'DSH_PROVIDER_KEY'      = 'SACODE_PROVIDER_KEY'
  'DSH_PROVIDER_MODEL'    = 'SACODE_PROVIDER_MODEL'
  'DSH_EXTJS_DIR'         = 'SACODE_EXTJS_DIR'
  'DSH_HOST'              = 'SACODE_HOST'
  'window.dsh'            = 'window.sacode'
  'DshMsgFold'            = 'SaCodeMsgFold'
  'dsh-smoke-'            = 'sacode-smoke-'
  'dsh-session:'          = 'sacode-session:'
  'exposeInMainWorld("dsh"' = 'exposeInMainWorld("sacode"'
  'dsh:'                  = 'sacode:'
  'dsh.exe'               = 'sacode.exe'
  'dsh-cli-win32-x64'     = 'sacode-cli-win32-x64'
  'dsh-cli'               = 'sacode-cli'
  'usage: dsh '           = 'usage: sacode '
  'you are dsh'           = 'you are SaCode'
  'dsh extjs'             = 'sacode extjs'
  'dsh call'              = 'sacode call'
  'dsh realstream'        = 'sacode realstream'
  'dsh headless'          = 'sacode headless'
}

$utf8 = New-Object System.Text.UTF8Encoding $false
$scopes = @('core\src','apps\cli\src','apps\host\src','apps\desktop','scripts','npm')
$exts = @('.cj','.cjs','.mjs','.js','.ts','.html','.css','.json')
$changed = @()

$files = foreach ($s in $scopes) {
  $p = Join-Path $repo $s
  if (Test-Path $p) {
    Get-ChildItem $p -Recurse -File -ErrorAction SilentlyContinue |
      Where-Object { $exts -contains $_.Extension -and $_.FullName -notmatch '\\vendor\\|\\dist\\|node_modules|\\target\\' }
  }
}

foreach ($f in $files) {
  $text = [System.IO.File]::ReadAllText($f.FullName)
  $orig = $text
  $hits = 0
  foreach ($k in $rules.Keys) {
    if ($text.Contains($k)) {
      $n = ([regex]::Matches($text, [regex]::Escape($k))).Count
      $hits += $n
      $text = $text.Replace($k, $rules[$k])
    }
  }
  if ($text -ne $orig) {
    [System.IO.File]::WriteAllText($f.FullName, $text, $utf8)
    $changed += [pscustomobject]@{ File = $f.FullName.Replace("$repo\", ''); Replaced = $hits }
  }
}

Write-Output "改动文件数：$($changed.Count)"
$changed | Sort-Object Replaced -Descending | ForEach-Object { "{0,4}  {1}" -f $_.Replaced, $_.File }
