<#
.SYNOPSIS
  Rename every video file across every channel folder using YouTube oEmbed titles.
.DESCRIPTION
  Dry-run by default. Pass -Apply to actually rename.
#>

[CmdletBinding()]
param(
    [string]   $Root         = "C:\Users\Jackle\Downloads\YouTube-Downloader",
    [string]   $DbPath       = "C:\Program Files (x86)\multi-channel-ytl\server\db\database.db",
    [string]   $ServerDir    = "C:\Program Files (x86)\multi-channel-ytl\server",
    [string[]] $SkipChannels = @('Single-File'),
    [switch]   $Apply
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

if (-not (Test-Path -LiteralPath $Root))  { throw "Root not found: $Root" }
if (-not (Test-Path -LiteralPath $DbPath)) { throw "DB not found: $DbPath" }

$ts = Get-Date -Format 'yyyyMMdd-HHmmss'
$combinedLog = Join-Path $Root "_rename-all-$ts.log"

function Log {
    param([string]$Message, [string]$Level = 'INFO')
    $line = "[{0}] [{1}] {2}" -f (Get-Date -Format 'HH:mm:ss'), $Level, $Message
    Add-Content -LiteralPath $combinedLog -Value $line -Encoding UTF8
    switch ($Level) {
        'ERROR'   { Write-Host $line -ForegroundColor Red }
        'WARN'    { Write-Host $line -ForegroundColor Yellow }
        'SUCCESS' { Write-Host $line -ForegroundColor Green }
        default   { Write-Host $line }
    }
}

function Get-SanitizedBaseName {
    param([string]$Title)
    if ([string]::IsNullOrWhiteSpace($Title)) { return 'unnamed' }
    $s = $Title
    $s = [regex]::Replace($s, '[\u0000-\u001F\u007F-\u009F]', ' ')
    $s = [regex]::Replace($s, '[\\/:*?"<>|]', '_')
    $s = [regex]::Replace($s, '[\p{So}\p{Sk}\p{Cf}\p{Co}]', '-')
    $s = [regex]::Replace($s, '\s+', ' ')
    $s = $s.Trim().Trim('.', ' ')
    if ($s -match '^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\..*)?$') { $s = "_$s" }
    $s = [regex]::Replace($s, '[-_]{2,}', '-')
    $s = $s.Trim('-', '_').Trim()
    if ($s.Length -gt 180) { $s = $s.Substring(0, 180).Trim() }
    if ([string]::IsNullOrWhiteSpace($s)) { return 'unnamed' }
    return $s
}

function Split-FilenameSuffix {
    param([string]$Filename)
    if (-not $Filename) { return $null }
    $base = [System.IO.Path]::GetFileNameWithoutExtension($Filename)
    $ext  = [System.IO.Path]::GetExtension($Filename)

    $m = [regex]::Match($base, '^(?<base>.+?)(?<suffix>_\d{2}-\d{2}-\d{2}--[a-zA-Z0-9_-]{11})$')
    if ($m.Success) {
        return [pscustomobject]@{
            Base = $m.Groups['base'].Value; Suffix = $m.Groups['suffix'].Value; Ext = $ext
            DateInSfx = $m.Groups['suffix'].Value.Substring(1, 8)
            VideoId = $m.Groups['suffix'].Value.Substring($m.Groups['suffix'].Value.Length - 11)
        }
    }
    $m = [regex]::Match($base, '^(?<base>.+?)(?<suffix>_\d{2}-\d{2}-\d{2})$')
    if ($m.Success) {
        return [pscustomobject]@{
            Base = $m.Groups['base'].Value; Suffix = $m.Groups['suffix'].Value; Ext = $ext
            DateInSfx = $m.Groups['suffix'].Value.Substring(1, 8); VideoId = $null
        }
    }
    $m = [regex]::Match($base, '^(?<base>.+?)(?<suffix>--[a-zA-Z0-9_-]{11})$')
    if ($m.Success) {
        return [pscustomobject]@{
            Base = $m.Groups['base'].Value; Suffix = $m.Groups['suffix'].Value; Ext = $ext
            DateInSfx = $null; VideoId = $m.Groups['suffix'].Value.Substring(2)
        }
    }
    return $null
}

$script:titleCache = @{}

function Get-YouTubeTitle {
    param([string]$VideoId)
    if (-not $VideoId) { return $null }
    if ($script:titleCache.ContainsKey($VideoId)) { return $script:titleCache[$VideoId] }
    $url = "https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=$VideoId&format=json"
    try {
        $r = Invoke-RestMethod -Uri $url -UseBasicParsing -TimeoutSec 15
        $script:titleCache[$VideoId] = $r.title
        return $r.title
    } catch {
        $script:titleCache[$VideoId] = $null
        return $null
    }
}

function Get-DbTitles {
    param([string[]]$VideoIds, [string]$DbPath, [string]$ServerDir)
    if (-not $VideoIds -or $VideoIds.Count -eq 0) { return @{} }
    $jsFile = Join-Path $ServerDir "batch-read-titles.js"
    @'
const Database = require('better-sqlite3');
const db = new Database(process.argv[2], { readonly: true, fileMustExist: true });
const ids = process.argv.slice(3);
const out = {};
const stmt = db.prepare('SELECT title FROM videos WHERE id = ?');
for (const id of ids) {
  const row = stmt.get(id);
  out[id] = row ? row.title : null;
}
process.stdout.write(JSON.stringify(out));
db.close();
'@ | Set-Content -LiteralPath $jsFile -Encoding UTF8

    $result = @{}
    $chunkSize = 200
    Push-Location $ServerDir
    try {
        for ($i = 0; $i -lt $VideoIds.Count; $i += $chunkSize) {
            $chunk = $VideoIds[$i..([Math]::Min($i + $chunkSize - 1, $VideoIds.Count - 1))]
            $json = node $jsFile $DbPath @chunk
            if ($json) {
                $obj = $json | ConvertFrom-Json
                foreach ($prop in $obj.PSObject.Properties) { $result[$prop.Name] = $prop.Value }
            }
        }
    } finally {
        Pop-Location
        Remove-Item -LiteralPath $jsFile -Force -ErrorAction SilentlyContinue
    }
    return $result
}

function Process-Channel {
    param([string]$Folder, [string]$DbPath, [string]$ServerDir, [switch]$Apply)

    $channelName = Split-Path $Folder -Leaf
    Log "===== CHANNEL: $channelName ====="

    $videoExts = @('.mp4', '.webm', '.mkv', '.m4a', '.mp3', '.m4v', '.mov', '.avi')
    $files = Get-ChildItem -LiteralPath $Folder -File -ErrorAction SilentlyContinue |
        Where-Object { $videoExts -contains $_.Extension.ToLower() }

    if (-not $files) {
        Log "  No video files found -- skipping" 'WARN'
        return [pscustomobject]@{ Channel = $channelName; Total = 0; Renamed = 0; Failed = 0; Skipped = 0 }
    }

    Log "  Files on disk: $($files.Count)"

    $candidates = @()
    $noVideoId  = @()
    foreach ($f in $files) {
        $s = Split-FilenameSuffix -Filename $f.Name
        if (-not $s -or -not $s.VideoId) { $noVideoId += $f.Name; continue }
        $candidates += [pscustomobject]@{
            File = $f; OldName = $f.Name; Suffix = $s.Suffix; Ext = $s.Ext
            VideoId = $s.VideoId; DateInSfx = $s.DateInSfx; MTime = $f.LastWriteTime
        }
    }

    if ($noVideoId.Count -gt 0) {
        Log "  Files without --videoId suffix: $($noVideoId.Count)" 'WARN'
    }
    Log "  Candidates with videoId: $($candidates.Count)"

    $resolved = @()
    $oembedFails = @()
    $i = 0
    foreach ($c in $candidates) {
        $i++
        if ($i % 100 -eq 0) { Log "    Fetching titles: $i / $($candidates.Count)" }
        $title = Get-YouTubeTitle -VideoId $c.VideoId
        if (-not $title) { $oembedFails += $c.VideoId }
        $resolved += [pscustomobject]@{
            OldName = $c.OldName; OldPath = $c.File.FullName; Suffix = $c.Suffix; Ext = $c.Ext
            VideoId = $c.VideoId; DateInSfx = $c.DateInSfx; MTime = $c.MTime; RawTitle = $title
        }
    }

    if ($oembedFails.Count -gt 0) {
        Log "  oEmbed 401/404 for $($oembedFails.Count) -- trying DB" 'WARN'
        $dbTitles = Get-DbTitles -VideoIds $oembedFails -DbPath $DbPath -ServerDir $ServerDir
        foreach ($r in $resolved) {
            if (-not $r.RawTitle -and $dbTitles.ContainsKey($r.VideoId)) { $r.RawTitle = $dbTitles[$r.VideoId] }
        }
    }

    $resolved = $resolved | Where-Object { $_.RawTitle }
    Log "  Titles resolved: $($resolved.Count) / $($candidates.Count)"

    if ($resolved.Count -eq 0) {
        Log "  Nothing to rename -- skipping" 'WARN'
        return [pscustomobject]@{ Channel = $channelName; Total = $files.Count; Renamed = 0; Failed = 0; Skipped = $noVideoId.Count }
    }

    foreach ($r in $resolved) {
        $r | Add-Member -NotePropertyName NewBase -NotePropertyValue (Get-SanitizedBaseName -Title $r.RawTitle) -Force
    }

    $grouped = @{}
    foreach ($r in $resolved) {
        $key = $r.NewBase.ToLowerInvariant()
        if (-not $grouped.ContainsKey($key)) { $grouped[$key] = @() }
        $grouped[$key] += $r
    }

    $plan = @()
    foreach ($key in $grouped.Keys) {
        $sorted = $grouped[$key] | Sort-Object `
            @{ Expression = { if ($_.DateInSfx) { $_.DateInSfx } else { 'ZZ-ZZ-ZZ' } } }, `
            @{ Expression = { $_.MTime } }
        $counter = 1
        foreach ($r in $sorted) {
            $baseForFile = if ($counter -eq 1) { $r.NewBase } else { "$($r.NewBase) ($counter)" }
            $desired = "$baseForFile$($r.Suffix)$($r.Ext)"
            $plan += [pscustomobject]@{
                OldName = $r.OldName; OldFullPath = $r.OldPath
                NewName = $desired; NewFullPath = Join-Path $Folder $desired
                VideoId = $r.VideoId; Position = $counter
            }
            $counter++
        }
    }

    $seen = @{}
    foreach ($p in $plan) {
        $lower = $p.NewName.ToLowerInvariant()
        if ($seen.ContainsKey($lower)) {
            $ext  = [System.IO.Path]::GetExtension($p.NewName)
            $stem = [System.IO.Path]::GetFileNameWithoutExtension($p.NewName)
            $n = 2
            while ($true) {
                $cand = "$stem ($n)$ext"
                if (-not $seen.ContainsKey($cand.ToLowerInvariant()) -and
                    -not (Test-Path -LiteralPath (Join-Path $Folder $cand))) {
                    $p.NewName = $cand; $p.NewFullPath = Join-Path $Folder $cand
                    $lower = $cand.ToLowerInvariant(); break
                }
                $n++
                if ($n -gt 1000) { throw "Unresolvable collision" }
            }
        }
        $seen[$lower] = $true
    }

    $actuallyRenaming = $plan | Where-Object { $_.OldName -ne $_.NewName }
    Log "  Files needing rename: $($actuallyRenaming.Count)"
    Log "  Already correct     : $($plan.Count - $actuallyRenaming.Count)"

    if ($actuallyRenaming.Count -eq 0) {
        return [pscustomobject]@{ Channel = $channelName; Total = $files.Count; Renamed = 0; Failed = 0; Skipped = $noVideoId.Count }
    }

    $csvPath = Join-Path $Folder "_rename-report-$ts.csv"
    $actuallyRenaming | Select-Object @{n='OldName';e={$_.OldName}},
                                       @{n='NewName';e={$_.NewName}},
                                       @{n='VideoId';e={$_.VideoId}},
                                       @{n='Position';e={$_.Position}} |
        Export-Csv -LiteralPath $csvPath -NoTypeInformation -Encoding UTF8
    Log "  Report: $csvPath"

    if (-not $Apply) {
        Log "  DRY RUN -- no changes made" 'WARN'
        return [pscustomobject]@{ Channel = $channelName; Total = $files.Count; Renamed = 0; Failed = 0; Skipped = $noVideoId.Count }
    }

    $renamed = 0; $failed = 0
    foreach ($p in $actuallyRenaming) {
        try {
            $tmpName = "__ytl_tmp__" + [Guid]::NewGuid().ToString('N') + $p.NewName.Substring($p.NewName.LastIndexOf('.'))
            $tmpPath = Join-Path $Folder $tmpName
            Rename-Item -LiteralPath $p.OldFullPath -NewName $tmpName -ErrorAction Stop
            $p | Add-Member -NotePropertyName TempPath -NotePropertyValue $tmpPath -Force
        } catch {
            Log "    Stage-1 failed: $($p.OldName) -- $($_.Exception.Message)" 'ERROR'
            $failed++
        }
    }
    foreach ($p in $actuallyRenaming) {
        if (-not $p.TempPath) { continue }
        try {
            if (Test-Path -LiteralPath $p.NewFullPath) {
                Log "    Target exists, skipping: $($p.NewName)" 'WARN'
                Rename-Item -LiteralPath $p.TempPath -NewName $p.OldName -ErrorAction SilentlyContinue
                $failed++; continue
            }
            Rename-Item -LiteralPath $p.TempPath -NewName $p.NewName -ErrorAction Stop
            $renamed++
        } catch {
            Log "    Stage-2 failed: $($p.OldName) -- $($_.Exception.Message)" 'ERROR'
            Rename-Item -LiteralPath $p.TempPath -NewName $p.OldName -ErrorAction SilentlyContinue
            $failed++
        }
    }

    Log "  Renamed: $renamed / $($actuallyRenaming.Count) -- Failed: $failed" $(if ($failed -eq 0) { 'SUCCESS' } else { 'WARN' })

    return [pscustomobject]@{
        Channel = $channelName; Total = $files.Count
        Renamed = $renamed; Failed = $failed; Skipped = $noVideoId.Count
    }
}

Write-Host ""
Write-Host "==============================================================" -ForegroundColor Cyan
Write-Host "  BATCH RENAME -- All Channels in YouTube-Downloader" -ForegroundColor Cyan
Write-Host "==============================================================" -ForegroundColor Cyan
Write-Host "Root        : $Root"
Write-Host "DB          : $DbPath"
Write-Host "Mode        : $(if ($Apply) { 'APPLY' } else { 'DRY RUN' })"
Write-Host "Combined log: $combinedLog"
Write-Host ""

Log "Started -- Mode=$(if ($Apply){'APPLY'}else{'DRY RUN'})"

$folders = Get-ChildItem -LiteralPath $Root -Directory -ErrorAction SilentlyContinue |
    Where-Object { $SkipChannels -notcontains $_.Name } | Sort-Object Name

Log "Channel folders found: $($folders.Count)"
Write-Host ""

$results = @()
$channelIdx = 0
foreach ($folder in $folders) {
    $channelIdx++
    Write-Host "----- [$channelIdx / $($folders.Count)] $($folder.Name) -----" -ForegroundColor Cyan
    try {
        $r = Process-Channel -Folder $folder.FullName -DbPath $DbPath -ServerDir $ServerDir -Apply:$Apply
        $results += $r
    } catch {
        Log "CHANNEL FAILED: $($folder.Name) -- $($_.Exception.Message)" 'ERROR'
        $results += [pscustomobject]@{ Channel = $folder.Name; Total = 0; Renamed = 0; Failed = 0; Skipped = 0 }
    }
    Write-Host ""
}

Write-Host "==============================================================" -ForegroundColor Cyan
Write-Host "  SUMMARY" -ForegroundColor Cyan
Write-Host "==============================================================" -ForegroundColor Cyan
$results | Format-Table -AutoSize

$totChannels = $results.Count
$totFiles    = ($results | Measure-Object Total   -Sum).Sum
$totRenamed  = ($results | Measure-Object Renamed -Sum).Sum
$totFailed   = ($results | Measure-Object Failed  -Sum).Sum
$totSkipped  = ($results | Measure-Object Skipped -Sum).Sum

Log "DONE -- Channels: $totChannels | Files: $totFiles | Renamed: $totRenamed | Failed: $totFailed | Skipped: $totSkipped" 'SUCCESS'
Log "Combined log: $combinedLog"

if (-not $Apply) {
    Write-Host ""
    Write-Host "DRY RUN COMPLETE -- no files were renamed." -ForegroundColor Yellow
    Write-Host "Re-run with -Apply to actually rename:" -ForegroundColor Yellow
    Write-Host "  .\rename-all-channels.ps1 -Apply" -ForegroundColor Yellow
}