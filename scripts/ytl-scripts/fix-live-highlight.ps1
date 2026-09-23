<#
.SYNOPSIS
  Fix the Live Highlight file: fetch correct title from oEmbed, fetch upload
  date from YouTube via yt-dlp, rename with correct suffix.
#>

[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string]$ServerDir = "C:\Program Files (x86)\multi-channel-ytl\server",
    [string]$Folder    = "C:\Users\Jackle\Downloads\YouTube-Downloader\kayakalp-i9z",
    [string]$VideoId   = "Ng-GEpQt_jw"
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

function Get-SanitizedBaseName {
    param([string]$Title)
    if ([string]::IsNullOrWhiteSpace($Title)) { return 'unnamed' }
    $s = $Title
    $s = [regex]::Replace($s, '[\u0000-\u001F\u007F-\u009F]', ' ')
    $s = [regex]::Replace($s, '[\\/:*?"<>|]', '_')
    $s = [regex]::Replace($s, '[\p{So}\p{Sk}\p{Cf}\p{Co}]', '-')
    $s = [regex]::Replace($s, '\s+', ' ')
    $s = $s.Trim().Trim('.', ' ')
    $s = [regex]::Replace($s, '[-_]{2,}', '-')
    $s = $s.Trim('-', '_').Trim()
    if ($s.Length -gt 180) { $s = $s.Substring(0, 180).Trim() }
    return $s
}

Write-Host ""
Write-Host "=== Fix Live Highlight ($VideoId) ===" -ForegroundColor Cyan
Write-Host ""

# 1. Fetch title from oEmbed
Write-Host "Fetching title from YouTube oEmbed..."
try {
    $meta = Invoke-RestMethod "https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=$VideoId&format=json" -ErrorAction Stop
    $title = $meta.title
} catch {
    throw "oEmbed failed: $($_.Exception.Message)"
}

if (-not $title) { throw "Empty title from oEmbed" }
Write-Host "Title     : $title" -ForegroundColor Green

# 2. Fetch upload date from yt-dlp
Write-Host "Fetching upload date from YouTube..."
$ytdlpBin = $null
foreach ($c in @(
    "yt-dlp",
    "$env:LOCALAPPDATA\Programs\Python\Python312\Scripts\yt-dlp.exe",
    "$env:APPDATA\Python\Python312\Scripts\yt-dlp.exe",
    "$env:LOCALAPPDATA\Programs\Python\Python311\Scripts\yt-dlp.exe",
    "$env:APPDATA\Python\Python311\Scripts\yt-dlp.exe"
)) {
    try {
        $v = & $c --version 2>$null
        if ($LASTEXITCODE -eq 0) { $ytdlpBin = $c; break }
    } catch {}
}

$uploadDate = $null
if ($ytdlpBin) {
    try {
        $json = & $ytdlpBin --dump-json --no-download --no-warnings "https://www.youtube.com/watch?v=$VideoId" 2>$null
        $info = $json | ConvertFrom-Json
        $uploadDate = $info.upload_date
        Write-Host "UploadDate: $uploadDate"
    } catch {
        Write-Host "yt-dlp failed: $($_.Exception.Message)" -ForegroundColor Yellow
    }
} else {
    Write-Host "yt-dlp not found - will use file's LastWriteTime" -ForegroundColor Yellow
}

if ($uploadDate -match '^\d{8}$') {
    $suffix = "_$($uploadDate.Substring(2,2))-$($uploadDate.Substring(4,2))-$($uploadDate.Substring(6,2))"
} else {
    $currentForDate = Get-ChildItem -LiteralPath $Folder -File |
        Where-Object { $_.Name -match [regex]::Escape($VideoId) -or $_.Name -eq 'ल-इव ह-इल-इट.mp4' } |
        Select-Object -First 1
    if ($currentForDate) {
        $d = $currentForDate.LastWriteTime
        $suffix = "_$($d.ToString('yy-MM-dd'))"
    } else {
        $d = Get-Date
        $suffix = "_$($d.ToString('yy-MM-dd'))"
    }
}
Write-Host "Suffix    : $suffix" -ForegroundColor Green

# 3. Build new name
$newBase = Get-SanitizedBaseName $title
$newName = "$newBase$suffix--$VideoId.mp4"
Write-Host "New name  : $newName" -ForegroundColor Green

# 4. Find current file
$current = Get-ChildItem -LiteralPath $Folder -File |
    Where-Object { $_.Name -match [regex]::Escape($VideoId) -or $_.Name -eq 'ल-इव ह-इल-इट.mp4' } |
    Select-Object -First 1

if (-not $current) { throw "No file found matching $VideoId or the broken name" }
Write-Host "Current   : $($current.Name)" -ForegroundColor Yellow

if ($current.Name -eq $newName) {
    Write-Host "Already correct - nothing to do." -ForegroundColor Cyan
    return
}

if ($WhatIfPreference) {
    Write-Host ""
    Write-Host "*** -WhatIf: no changes made ***" -ForegroundColor Magenta
    return
}

# 5. Rename
$target = Join-Path $Folder $newName
if (Test-Path -LiteralPath $target) { throw "Target already exists: $newName" }

Rename-Item -LiteralPath $current.FullName -NewName $newName
Write-Host "Renamed OK" -ForegroundColor Green

# 6. Verify
Write-Host ""
Write-Host "=== Verify ===" -ForegroundColor Cyan
Get-ChildItem -LiteralPath $Folder -File |
    Where-Object { $_.Name -match [regex]::Escape($VideoId) } |
    Select-Object -ExpandProperty Name