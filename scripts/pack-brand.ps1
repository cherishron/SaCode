# 从既有 SaCode 标志生成标准 256px 图标；只转换尺寸与容器格式，不重绘品牌。
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$brandDir = Join-Path (Split-Path $PSScriptRoot) 'apps/desktop/renderer/assets'
$source = [Drawing.Image]::FromFile((Join-Path $brandDir 'sacode-logo.png'))
$canvas = [Drawing.Bitmap]::new(256, 256)
$graphics = [Drawing.Graphics]::FromImage($canvas)
try {
    $graphics.Clear([Drawing.Color]::Transparent)
    $graphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $scale = [Math]::Min(224 / $source.Width, 224 / $source.Height)
    $width = [int]($source.Width * $scale)
    $height = [int]($source.Height * $scale)
    $graphics.DrawImage($source, [int]((256-$width)/2), [int]((256-$height)/2), $width, $height)
    $png = Join-Path $brandDir 'sacode-icon.png'
    $canvas.Save($png, [Drawing.Imaging.ImageFormat]::Png)
    $bytes = [IO.File]::ReadAllBytes($png)
    $stream = [IO.MemoryStream]::new()
    $writer = [IO.BinaryWriter]::new($stream)
    try {
        $writer.Write([uint16]0); $writer.Write([uint16]1); $writer.Write([uint16]1)
        $writer.Write([byte]0); $writer.Write([byte]0); $writer.Write([byte]0); $writer.Write([byte]0)
        $writer.Write([uint16]1); $writer.Write([uint16]32)
        $writer.Write([uint32]$bytes.Length); $writer.Write([uint32]22); $writer.Write($bytes)
        [IO.File]::WriteAllBytes((Join-Path $brandDir 'sacode-icon.ico'), $stream.ToArray())
    } finally { $writer.Dispose(); $stream.Dispose() }
} finally { $graphics.Dispose(); $canvas.Dispose(); $source.Dispose() }
Write-Output 'SaCode PNG 与 ICO 图标已生成'
