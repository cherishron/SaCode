$content = [System.IO.File]::ReadAllText('E:\Project\cherishron\SaCode\interfaces\cli\src\cmd\doctor.rs')
if ($content.StartsWith([char]0xFEFF)) {
    $content = $content.Substring(1)
}
$enc = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText('E:\Project\cherishron\SaCode\interfaces\cli\src\cmd\doctor.rs', $content, $enc)