<#
.SYNOPSIS
  For channels whose filenames lack --videoId, match each disk file to its
  DB row by exact filename, and rename to add --videoId.
#>

[CmdletBinding()]
param(
    [string]$ChannelName = "Jogisnasinuskhajatchannel",
    [string]$Root        = "C:\Users\Jackle\Downloads\YouTube-Downloader",
    [string]$DbPath      = "C:\Program Files (x86)\multi-channel-ytl\server\db\database.db",
    [string]$ServerDir   = "C:\Program Files (x86)\multi-channel-ytl\server",
    [switch]$Apply
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

if (-not (Test-Path -LiteralPath $Root))   { throw "Root not found: $Root" }
if (-not (Test-Path -LiteralPath $DbPath)) { throw "DB not found: $DbPath" }

$folder = Join-Path $Root $ChannelName
if (-not (Test-Path -LiteralPath $folder)) { throw "Channel folder not found: $folder" }

Write-Host ""
Write-Host "==============================================================" -ForegroundColor Cyan
Write-Host "  Add --videoId suffixes" -ForegroundColor Cyan
Write-Host "==============================================================" -ForegroundColor Cyan
Write-Host "Channel : $ChannelName"
Write-Host "Folder  : $folder"
Write-Host "Mode    : $(if ($Apply) { 'APPLY' } else { 'DRY RUN' })"
Write-Host ""

# ---- Step 1: read DB rows for this channel ----
$jsRead = @"
const D = require('better-sqlite3');
const db = new D(process.argv[2], { readonly: true });
const ch = db.prepare('SELECT id FROM channels WHERE name = ?').get(process.argv[3]);
if (!ch) { console.error('CHANNEL_NOT_FOUND'); process.exit(2); }
const rows = db.prepare('SELECT id, title, finalFilename FROM videos WHERE channelId = ?').all(ch.id);
console.log(JSON.stringify(rows));
db.close();
"@
$jsReadPath = Join-Path $ServerDir "read-rows.js"
Set-Content -LiteralPath $jsReadPath -Value $jsRead -Encoding UTF8

Push-Location $ServerDir
$rowsJson = node .\read-rows.js $DbPath $ChannelName
Pop-Location
Remove-Item -LiteralPath $jsReadPath -Force

if (-not $rowsJson) {
    Write-Host "Could not read rows for channel $ChannelName" -ForegroundColor Red
    return
}
$rows = $rowsJson | ConvertFrom-Json
Write-Host "DB rows for this channel: $($rows.Count)"

# ---- Step 2: build the rename plan ----
$diskFiles = Get-ChildItem -LiteralPath $folder -File |
    Where-Object { $_.Extension -in '.mp4', '.webm', '.mkv', '.m4a', '.mp3' }
Write-Host "Disk files: $($diskFiles.Count)"
Write-Host ""

$diskByName = @{}
foreach ($f in $diskFiles) { $diskByName[$f.Name] = $f }

$plan = @()
$skipped_noFile = 0
$skipped_hasId = 0
$skipped_noMatch = 0

foreach ($r in $rows) {
    if (-not $r.finalFilename) { continue }
    if ($r.finalFilename -match '--[a-zA-Z0-9_-]{11}\.\w+$') {
        $skipped_hasId++
        continue
    }
    $diskFile = $diskByName[$r.finalFilename]
    if (-not $diskFile) {
        $skipped_noFile++
        continue
    }
    $ext = [System.IO.Path]::GetExtension($r.finalFilename)
    $base = [System.IO.Path]::GetFileNameWithoutExtension($r.finalFilename)
    $newName = "${base}--$($r.id)$ext"

    if ($diskByName.ContainsKey($newName)) {
        Write-Host "  SKIP (target exists): $newName" -ForegroundColor Yellow
        $skipped_noMatch++
        continue
    }

    $plan += [pscustomobject]@{
        VideoId     = $r.id
        OldName     = $r.finalFilename
        NewName     = $newName
        OldFullPath = $diskFile.FullName
        NewFullPath = Join-Path $folder $newName
    }
}

Write-Host "Plan summary:"
Write-Host "  To rename    : $($plan.Count)"
Write-Host "  Already hasId: $skipped_hasId"
Write-Host "  No disk file : $skipped_noFile"
Write-Host "  Skipped      : $skipped_noMatch"
Write-Host ""

if ($plan.Count -eq 0) {
    Write-Host "Nothing to do." -ForegroundColor Green
    return
}

Write-Host "First 10 planned renames:" -ForegroundColor Cyan
$plan | Select-Object -First 10 | ForEach-Object {
    Write-Host "  OLD: $($_.OldName)"
    Write-Host "  NEW: $($_.NewName)"
    Write-Host ""
}

if (-not $Apply) {
    Write-Host "DRY RUN COMPLETE -- no changes made." -ForegroundColor Yellow
    Write-Host "Re-run with -Apply to actually rename:" -ForegroundColor Yellow
    Write-Host "  .\add-video-ids.ps1 -ChannelName `"$ChannelName`" -Apply" -ForegroundColor Yellow
    return
}

# ---- Step 3: backup DB + rename ----
$ts = Get-Date -Format 'yyyyMMdd-HHmmss'
$dbBak = "$DbPath.videoid-bak.$ts"
Copy-Item -LiteralPath $DbPath -Destination $dbBak -Force
Write-Host "DB backup: $dbBak" -ForegroundColor Cyan
Write-Host ""

$renamed = 0
$failed = 0
$updates = @()

foreach ($p in $plan) {
    try {
        Rename-Item -LiteralPath $p.OldFullPath -NewName $p.NewName -Force
        $renamed++
        $updates += [pscustomobject]@{ id = $p.VideoId; fn = $p.NewName }
    } catch {
        Write-Host "  FAILED: $($p.OldName) -- $($_.Exception.Message)" -ForegroundColor Red
        $failed++
    }
}

# Batch DB update via Node (avoid PowerShell JSON quirks)
if ($updates.Count -gt 0) {
    $updatesJson = $updates | ConvertTo-Json -Compress
    $jsPath = Join-Path $ServerDir "batch-update.js"
    $jsContent = "const D=require('better-sqlite3');const db=new D(process.argv[2]);const updates=JSON.parse(process.argv[3]);const stmt=db.prepare('UPDATE videos SET finalFilename = ? WHERE id = ?');const txn=db.transaction((a)=>{for(const u of a)stmt.run(u.fn,u.id);});txn(updates);console.log('DB rows updated:',updates.length);db.close();"
    Set-Content -LiteralPath $jsPath -Value $jsContent -Encoding UTF8

    Push-Location $ServerDir
    node .\batch-update.js $DbPath $updatesJson
    Pop-Location
    Remove-Item -LiteralPath $jsPath -Force
}

Write-Host ""
Write-Host "Renamed : $renamed" -ForegroundColor Green
Write-Host "Failed  : $failed" -ForegroundColor $(if ($failed -gt 0) { 'Red' } else { 'Green' })
Write-Host "DB backup: $dbBak" -ForegroundColor Cyan
