<#
.SYNOPSIS
  For every channel:
    1. Call /api/channels/:id/update-database to sync DB with disk
    2. Read back the DB and compare finalFilename to disk
    3. Report any mismatches, orphans, missing files

  Writes a combined log at <Root>\_sync-verify-<timestamp>.log
#>

[CmdletBinding()]
param(
    [string]$ServerBase = "http://localhost:3000",
    [string]$Root       = "C:\Users\Jackle\Downloads\YouTube-Downloader",
    [string]$DbPath     = "C:\Program Files (x86)\multi-channel-ytl\server\db\database.db",
    [string]$ServerDir  = "C:\Program Files (x86)\multi-channel-ytl\server",
    [string]$User       = "admin",
    [string]$Pass       = "password123"
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$ts  = Get-Date -Format 'yyyyMMdd-HHmmss'
$log = Join-Path $Root "_sync-verify-$ts.log"

function Log {
    param([string]$Msg, [string]$Level = 'INFO')
    $line = "[{0}] [{1}] {2}" -f (Get-Date -Format 'HH:mm:ss'), $Level, $Msg
    Add-Content -LiteralPath $log -Value $line -Encoding UTF8
    switch ($Level) {
        'ERROR'   { Write-Host $line -ForegroundColor Red }
        'WARN'    { Write-Host $line -ForegroundColor Yellow }
        'SUCCESS' { Write-Host $line -ForegroundColor Green }
        'INFO'    { Write-Host $line }
        default   { Write-Host $line -ForegroundColor DarkGray }
    }
}

# --- Server check ---
Write-Host ""
Write-Host "==============================================================" -ForegroundColor Cyan
Write-Host "  SYNC + VERIFY ALL CHANNELS" -ForegroundColor Cyan
Write-Host "==============================================================" -ForegroundColor Cyan
Write-Host "Server : $ServerBase"
Write-Host "Root   : $Root"
Write-Host "Log    : $log"
Write-Host ""

if (-not (Test-NetConnection localhost -Port 3000 -InformationLevel Quiet -WarningAction SilentlyContinue)) {
    Log "SERVER IS NOT RUNNING on port 3000 -- start it first" 'ERROR'
    exit 1
}

# --- Login ---
$sess = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$body = @{ username = $User; password = $Pass } | ConvertTo-Json
try {
    $loginResp = Invoke-RestMethod -Uri "$ServerBase/api/login" -Method POST `
        -Body $body -ContentType 'application/json' -WebSession $sess
    if (-not $loginResp.success) { Log "Login failed" 'ERROR'; exit 1 }
    Log "Login OK" 'SUCCESS'
} catch {
    Log "Login error: $($_.Exception.Message)" 'ERROR'
    exit 1
}

# --- Fetch channel list ---
$channels = (Invoke-RestMethod "$ServerBase/api/channels" -WebSession $sess).channels
Log "Channels found: $($channels.Count)"
Write-Host ""

# --- Helper: run update-database (SSE) and wait for completion ---
function Sync-ChannelDatabase {
    param([string]$ChannelId, [string]$ChannelName)

    $url = "$ServerBase/api/channels/$ChannelId/update-database"
    try {
        $resp = Invoke-WebRequest -Uri $url -Method POST `
            -WebSession $sess -UseBasicParsing -TimeoutSec 900

        # Find the final "complete" event in the SSE stream
        $completeLine = ($resp.Content -split "`n" |
            Where-Object { $_ -match '^data: \{"success":true' } |
            Select-Object -Last 1)

        if ($completeLine) {
            $data = ($completeLine -replace '^data: ', '') | ConvertFrom-Json
            return [pscustomobject]@{
                OK         = $true
                Total      = $data.totalVideos
                Downloaded = $data.downloaded
                Updated    = $data.updated
                Orphaned   = $data.orphanedAdded
            }
        }

        # Fallback: look for the "done" event
        $doneLine = ($resp.Content -split "`n" |
            Where-Object { $_ -match '"channelId"' -and $_ -match '"downloaded"' } |
            Select-Object -Last 1)
        if ($doneLine) {
            $data = ($doneLine -replace '^data: ', '') | ConvertFrom-Json
            return [pscustomobject]@{
                OK         = $true
                Total      = $data.totalVideos
                Downloaded = $data.downloaded
                Updated    = $data.updated
                Orphaned   = $data.orphanedAdded
            }
        }

        return [pscustomobject]@{ OK = $true; Total = 0; Downloaded = 0; Updated = 0; Orphaned = 0 }
    } catch {
        return [pscustomobject]@{ OK = $false; Error = $_.Exception.Message }
    }
}

# --- Helper: verify channel by reading DB and comparing to disk ---
function Verify-Channel {
    param([string]$ChannelId, [string]$ChannelFolder)

    $jsFile = Join-Path $ServerDir "verify-one.js"
    @'
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const dbPath = process.argv[2];
const channelId = process.argv[3];
const folder = process.argv[4];

const db = new Database(dbPath, { readonly: true, fileMustExist: true });
const rows = db.prepare('SELECT id, finalFilename FROM videos WHERE channelId = ?').all(channelId);
db.close();

// Build lookup by finalFilename (lowercased)
const dbByFn = new Map();
for (const r of rows) {
  if (r.finalFilename) dbByFn.set(r.finalFilename.toLowerCase(), r);
}

// Read disk
const exts = ['.mp4','.webm','.mkv','.m4a','.mp3','.m4v','.mov','.avi'];
let diskFiles = [];
try { diskFiles = fs.readdirSync(folder); } catch (e) { /* skip */ }
diskFiles = diskFiles.filter(f => exts.some(e => f.toLowerCase().endsWith(e)));

let matched = 0;
let dbOnly = [];
let diskOnly = [];
let diskWithoutId = 0;

for (const r of rows) {
  if (!r.finalFilename) continue;
  const found = diskFiles.find(f => f.toLowerCase() === r.finalFilename.toLowerCase());
  if (found) matched++;
  else dbOnly.push(r.finalFilename);
}

const dbFnSet = new Set(rows.map(r => (r.finalFilename || '').toLowerCase()));
for (const f of diskFiles) {
  if (!dbFnSet.has(f.toLowerCase())) {
    if (/--[a-zA-Z0-9_-]{11}\.\w+$/.test(f)) diskOnly.push(f);
    else diskWithoutId++;
  }
}

console.log(JSON.stringify({
  totalDbRows: rows.length,
  matched: matched,
  dbOnlyCount: dbOnly.length,
  diskOnlyCount: diskOnly.length,
  diskWithoutId: diskWithoutId,
  dbOnlySample: dbOnly.slice(0, 3),
  diskOnlySample: diskOnly.slice(0, 3)
}));
'@ | Set-Content -LiteralPath $jsFile -Encoding UTF8

    Push-Location $ServerDir
    try {
        $json = node .\verify-one.js $DbPath $ChannelId $ChannelFolder
    } finally {
        Pop-Location
        Remove-Item -LiteralPath $jsFile -Force -ErrorAction SilentlyContinue
    }

    return $json | ConvertFrom-Json
}

# --- Main loop ---
$results = @()
$idx = 0
$total = $channels.Count

foreach ($ch in $channels) {
    $idx++
    $folder = Join-Path $Root $ch.name

    Write-Host "[$idx/$total] $($ch.name)" -NoNewline

    if (-not (Test-Path -LiteralPath $folder)) {
        Write-Host " -- folder not found, skipping" -ForegroundColor Yellow
        Log "  Skipped: $($ch.name) (no folder at $folder)" 'WARN'
        $results += [pscustomobject]@{
            Channel = $ch.name; Sync = 'N/A'; Matched = 0; DbOnly = 0; DiskOnly = 0; DiskWoId = 0
        }
        continue
    }

    # 1. Sync
    $sync = Sync-ChannelDatabase -ChannelId $ch.id -ChannelName $ch.name
    if (-not $sync.OK) {
        Write-Host "  SYNC FAIL: $($sync.Error)" -ForegroundColor Red
        Log "  Sync failed for $($ch.name): $($sync.Error)" 'ERROR'
        $results += [pscustomobject]@{
            Channel = $ch.name; Sync = 'FAIL'; Matched = 0; DbOnly = 0; DiskOnly = 0; DiskWoId = 0
        }
        continue
    }

    # 2. Verify
    $v = Verify-Channel -ChannelId $ch.id -ChannelFolder $folder

    $status = 'OK'
    if ($v.dbOnlyCount -gt 0 -or $v.diskOnlyCount -gt 0) { $status = 'WARN' }

    Write-Host "  sync=$($sync.Downloaded)/$($sync.Total) matched=$($v.matched) dbOnly=$($v.dbOnlyCount) diskOnly=$($v.diskOnlyCount) diskWoId=$($v.diskWithoutId)" -ForegroundColor $(if ($status -eq 'OK') {'Green'} else {'Yellow'})

    Log "  $($ch.name): sync $($sync.Downloaded)/$($sync.Total) (updated=$($sync.Updated), orphaned=$($sync.Orphaned)) | verify matched=$($v.matched) dbOnly=$($v.dbOnlyCount) diskOnly=$($v.diskOnlyCount) diskWoId=$($v.diskWithoutId)"

    $results += [pscustomobject]@{
        Channel  = $ch.name
        Sync     = "$($sync.Downloaded)/$($sync.Total)"
        Matched  = $v.matched
        DbOnly   = $v.dbOnlyCount
        DiskOnly = $v.diskOnlyCount
        DiskWoId = $v.diskWithoutId
    }
}

# --- Summary ---
Write-Host ""
Write-Host "==============================================================" -ForegroundColor Cyan
Write-Host "  SUMMARY" -ForegroundColor Cyan
Write-Host "==============================================================" -ForegroundColor Cyan
$results | Format-Table -AutoSize

$totMatched  = ($results | Measure-Object Matched  -Sum).Sum
$totDbOnly   = ($results | Measure-Object DbOnly   -Sum).Sum
$totDiskOnly = ($results | Measure-Object DiskOnly -Sum).Sum
$totDiskWoId = ($results | Measure-Object DiskWoId -Sum).Sum

Write-Host ""
Write-Host "Total matched     : $totMatched" -ForegroundColor Green
Write-Host "Total DB-only     : $totDbOnly" -ForegroundColor $(if ($totDbOnly -gt 0) {'Yellow'} else {'DarkGray'})
Write-Host "Total disk-only   : $totDiskOnly" -ForegroundColor $(if ($totDiskOnly -gt 0) {'Magenta'} else {'DarkGray'})
Write-Host "Total disk w/o ID : $totDiskWoId" -ForegroundColor $(if ($totDiskWoId -gt 0) {'DarkYellow'} else {'DarkGray'})

Log "DONE -- matched=$totMatched dbOnly=$totDbOnly diskOnly=$totDiskOnly diskWoId=$totDiskWoId" 'SUCCESS'
Log "Log: $log"