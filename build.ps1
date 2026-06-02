# AskBubble 打包脚本
# 用法：在项目根目录右键 → "使用 PowerShell 运行"，或在 PowerShell/bash 里执行：
#   powershell -ExecutionPolicy Bypass -File build.ps1
# 产物：dist/askbubble-<version>.zip，仅包含 manifest 引用的文件，已排除 _*/、.git、README、临时图片等。

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

# 读取 manifest 拿版本号
$manifest = Get-Content -Raw -Path 'manifest.json' | ConvertFrom-Json
$version = $manifest.version
if (-not $version) { throw 'manifest.json 里没有 version 字段' }

# 白名单：只打包这些文件（manifest 里实际引用的）
$files = @(
  'manifest.json',
  'background.js',
  'content.js',
  'popup.html',
  'popup.js',
  'styles.css',
  'logo.png'
)

# 校验所有文件都存在
$missing = $files | Where-Object { -not (Test-Path -LiteralPath $_) }
if ($missing) { throw "缺少文件：$($missing -join ', ')" }

# 校验没有 _ 开头的文件被误加（Chrome 扩展系统保留前缀）
$bad = $files | Where-Object { (Split-Path $_ -Leaf).StartsWith('_') }
if ($bad) { throw "文件名不能以 _ 开头：$($bad -join ', ')" }

# 输出目录
$distDir = Join-Path $PSScriptRoot 'dist'
if (-not (Test-Path $distDir)) { New-Item -ItemType Directory -Path $distDir | Out-Null }

$zipPath = Join-Path $distDir "askbubble-$version.zip"
if (Test-Path $zipPath) { Remove-Item -LiteralPath $zipPath -Force }

Compress-Archive -Path $files -DestinationPath $zipPath -CompressionLevel Optimal

# 显示结果
$size = [math]::Round((Get-Item $zipPath).Length / 1KB, 1)
Write-Host ""
Write-Host "✓ 打包完成：" -ForegroundColor Green
Write-Host "  $zipPath" -ForegroundColor Cyan
Write-Host "  版本 v$version，大小 ${size} KB，包含 $($files.Count) 个文件"
Write-Host ""
Write-Host "下一步：上传到 https://chrome.google.com/webstore/devconsole"
