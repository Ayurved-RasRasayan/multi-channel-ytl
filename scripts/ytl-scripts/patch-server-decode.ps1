# Patch server.js to URL-decode channel names
$ServerJs = "C:\Program Files (x86)\multi-channel-ytl\server\server.js"

if (-not (Test-Path -LiteralPath $ServerJs)) {
    Write-Host "server.js not found: $ServerJs" -ForegroundColor Red
    exit 1
}

$src = [System.IO.File]::ReadAllText($ServerJs, [System.Text.Encoding]::UTF8)
Write-Host "Read $($src.Length) chars" -ForegroundColor Cyan

if ($src.Contains('function decodeIfUrlEncoded')) {
    Write-Host "Already patched -- nothing to do" -ForegroundColor DarkGray
    exit 0
}

# ---- Anchor 1: app.post('/api/channels' ----
$anchorHelper = "app.post('/api/channels', async (req, res) => {"
if (-not $src.Contains($anchorHelper)) {
    Write-Host "Anchor 1 not found (app.post /api/channels)" -ForegroundColor Red
    exit 1
}

# ---- Anchor 2: channelUrl line ----
$anchorUrl = 'let channelUrl = url || `https://www.youtube.com/@${channelId}`;'
if (-not $src.Contains($anchorUrl)) {
    Write-Host "Anchor 2 not found (channelUrl line)" -ForegroundColor Red
    exit 1
}

# ---- Anchor 3: channelIdFinal line ----
$anchorFinal = "const channelIdFinal = channelId || channelUrl.split('@').pop().split('/')[0];"
if (-not $src.Contains($anchorFinal)) {
    Write-Host "Anchor 3 not found (channelIdFinal line)" -ForegroundColor Red
    exit 1
}

Write-Host "All 3 anchors found" -ForegroundColor Green

# ---- Build helper text with individual lines ----
$helperLines = @(
    '/**'
    ' * Decode URL-encoded characters in a string (e.g. %D9%85 -> Arabic letter meem).'
    ' * Returns the string unchanged if it is not URL-encoded or if decoding fails.'
    ' */'
    'function decodeIfUrlEncoded(str) {'
    '    if (!str || typeof str !== ''string'') return str;'
    '    if (!/%[0-9A-Fa-f]{2}/.test(str)) return str;'
    '    try {'
    '        return decodeURIComponent(str);'
    '    } catch (e) {'
    '        console.warn(''[URL Decode] Failed to decode:'', str, e.message);'
    '        return str;'
    '    }'
    '}'
    ''
    ''
)
$helperText = [string]::Join([char]10, $helperLines)

# ---- Build URL replacement with individual lines ----
$urlReplLines = @(
    '// Decode URL-encoded characters in url and channelId (e.g. Arabic/Chinese handles)'
    '        // so the resulting channel name is readable and matches the folder name.'
    '        const decodedUrl = decodeIfUrlEncoded(url);'
    '        const decodedChannelId = decodeIfUrlEncoded(channelId);'
    '        let channelUrl = decodedUrl || ''https://www.youtube.com/@'' + decodedChannelId;'
)
$urlRepl = [string]::Join([char]10, $urlReplLines)

# ---- Build channelIdFinal replacement ----
$finalRepl = "        const channelIdFinal = decodeIfUrlEncoded(channelId) || decodeIfUrlEncoded(channelUrl.split('@').pop().split('/')[0]);"

# ---- Apply all three replacements ----
$src = $src.Replace($anchorHelper, $helperText + $anchorHelper)
$src = $src.Replace($anchorUrl, $urlRepl)
$src = $src.Replace($anchorFinal, $finalRepl)

# ---- Verify all three landed ----
$ok = $true
if (-not $src.Contains('function decodeIfUrlEncoded')) {
    Write-Host "Helper insert FAILED" -ForegroundColor Red
    $ok = $false
}
if (-not $src.Contains('const decodedUrl = decodeIfUrlEncoded(url);')) {
    Write-Host "URL patch FAILED" -ForegroundColor Red
    $ok = $false
}
if (-not $src.Contains('const channelIdFinal = decodeIfUrlEncoded(channelId)')) {
    Write-Host "Final patch FAILED" -ForegroundColor Red
    $ok = $false
}
if (-not $ok) {
    Write-Host "Aborting -- not saving" -ForegroundColor Red
    exit 1
}
Write-Host "All 3 replacements verified in memory" -ForegroundColor Green

# ---- Syntax check ----
$tmp = "$env:TEMP\server-verify.js"
Set-Content -LiteralPath $tmp -Value $src -Encoding UTF8
node --check $tmp
$rc = $LASTEXITCODE
Remove-Item -LiteralPath $tmp -Force

if ($rc -ne 0) {
    Write-Host "Syntax check FAILED -- NOT saving" -ForegroundColor Red
    exit 1
}
Write-Host "Syntax check passed" -ForegroundColor Green

# ---- Backup + save ----
$ts  = Get-Date -Format 'yyyyMMdd-HHmmss'
$bak = "$ServerJs.urldecode-bak.$ts"
Copy-Item -LiteralPath $ServerJs -Destination $bak -Force

$utf8 = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($ServerJs, $src, $utf8)

Write-Host ""
Write-Host "[PATCHED] server.js -- URL-decode channel names" -ForegroundColor Green
Write-Host "Backup: $bak" -ForegroundColor Cyan
Write-Host ""
Write-Host "Restart the server:" -ForegroundColor Yellow
Write-Host "  Get-Process node | Stop-Process -Force" -ForegroundColor Yellow
Write-Host "  node C:\Program Files (x86)\multi-channel-ytl\server\server.js" -ForegroundColor Yellow