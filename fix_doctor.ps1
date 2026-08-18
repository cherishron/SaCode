$path = 'E:\Project\cherishron\SaCode\interfaces\cli\src\cmd\doctor.rs'
$lines = Get-Content $path -Encoding UTF8
$newLines = @()
foreach ($line in $lines) {
    if ($line.Trim() -eq 'workdir.join(".sacode/wiki/memory.md"),') {
        $newLines += '        workdir.join(".sacode/wiki/project.md"),'
    } elseif ($line.Trim() -eq 'workdir.join(".sacode/wiki/workflows.md"),') {
        # skip
    } elseif ($line.Trim() -eq 'workdir.join(".sacode/wiki/decisions.md"),') {
        # skip
    } elseif ($line.Trim() -eq 'workdir.join(".sacode/wiki/preferences.md"),') {
        $newLines += '        workdir.join(".sacode/wiki/preferences.md"),'
        $newLines += '        workdir.join(".sacode/wiki/experience.md"),'
    } else {
        $newLines += $line
    }
}
Set-Content $path -Value $newLines -Encoding UTF8