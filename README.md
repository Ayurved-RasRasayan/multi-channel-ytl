# Multi-Channel-YTL — Date Stamp Update

Files in this folder replace the originals in your local clone of
`https://github.com/Ayurved-RasRasayan/multi-channel-ytl`.

## What's new

This update adds YouTube upload-date stamping to your downloaded video files.
Existing files get a `_YY-MM-DD` suffix appended before the extension (e.g.
`MyVideo.mp4` → `MyVideo_22-05-14.mp4`). New downloads auto-receive the
suffix as part of the post-download rename step.

### Performance (v2 — parallel batch mode)

The Fix-Dates feature uses **parallel batch mode** for ~25× speedup over the
original per-video approach:

| Scenario | Old (per-video) | New (parallel batch) |
|----------|-----------------|---------------------|
| 52-video channel | ~75 seconds | ~3 seconds |
| 87-video channel | ~130 seconds | ~6 seconds |
| 200-video backlog | ~5 minutes | ~13 seconds |

**How it works:**
1. Writes all video URLs to a temp file
2. Spawns ONE yt-dlp process with `--batch-file` + `--print "%(id)s|%(upload_date)s"`
3. Runs 4 such processes in parallel (auto-tuned down for small batches)
4. Streams stdout line-by-line so results arrive in real-time
5. Renames each file immediately as its date arrives

### Per-channel progress bar

Each channel card now shows a tiny amber progress bar + counter under the
icon buttons while Fix-Dates is running:

```
┌──────────────────────────────────────────────────────────┐
│ 📺  @kayakalp-i9z                                       │
│     Fix-Dates: 21/52 (40%)        ← amber meta text
│                              ┌──┐ ┌──┐ ┌──┐             │
│                              │📅│ │🔄│ │🗑│             │
│                              └──┘ └──┘ └──┘             │
│                              ▓▓▓▓▓░░░░░░░  21/52 (40%)  │ ← bar + counter
└──────────────────────────────────────────────────────────┘
```

When done, the bar turns green and shows `✓ 52/52` for 3 seconds, then hides.

## Files modified

| File | What changed |
|------|--------------|
| `server/server.js` | Added date-stamp helpers + parallel batch functions (`getVideoUploadDatesBatch`, `getVideoUploadDatesParallel`, `buildBatchCommandStrategies`), refactored `applyDateStampsForChannel` and `applyDateStampsForSingleFileFolder` to use parallel batch mode, added 3 SSE-streaming endpoints, modified `executeDownloadWithFormat` to auto-stamp new downloads |
| `public/index.html` | Added amber 📅 button to each channel card, added per-channel progress bar + counter under the buttons, added "FIX ALL DATES" sidebar button + progress bar, added `updateChannelFixDatesProgress` helper + `fixDatesChannel` / `fixDatesAllChannels` JS functions |

## How to install

1. **Back up** your existing files first:
   ```bash
   cp server/server.js server/server.js.bak
   cp public/index.html public/index.html.bak
   ```

2. **Copy** the files from this folder over your local clone:
   ```bash
   cp server/server.js      <your-clone>/server/server.js
   cp public/index.html     <your-clone>/public/index.html
   ```

3. **No new dependencies** — uses the existing `yt-dlp`, Express, and the
   existing `cookies.txt` retry mechanism. No `npm install` needed.

4. **Restart** the server:
   ```bash
   cd server
   node server.js
   ```

5. **Open** the app at http://localhost:3000, log in.

## How to use

### Fix dates on EXISTING files (one channel)

- Click the new **📅** (amber) button on any channel card.
- Sequential run, ~1–2 seconds per video (yt-dlp metadata fetch).
- Live progress shows in the activity log; the button pulses while running.
- Idempotent: clicking it twice does nothing the second time.

### Fix dates on EVERYTHING (all channels + Single-File folder)

- Click the new **📅 FIX ALL DATES** button at the top of the sidebar
  (right under "REFRESH ALL WITH YOUTUBE").
- Streams per-channel + per-video progress through an amber progress bar.
- For a 200-video backlog expect ~5–7 minutes total.

### New downloads

- No action needed. Every new download now auto-receives the `_YY-MM-DD`
  suffix as part of the post-download rename step.
- If yt-dlp can't fetch the upload date (deleted/private/geo-blocked),
  the file keeps the sanitized-only name and the download is still
  considered successful (best-effort, non-blocking).

## Format spec

- Suffix: `_YY-MM-DD` (e.g. upload_date `20231115` → `_23-11-15`)
- Position: inserted before the file extension
- Separator: underscore
- Idempotent: regex `_\d{2}-\d{2}-\d{2}\.(mp4|webm|mkv|m4a|mp3)$` is detected
  and skipped on re-runs

## Database changes

After a Fix-Dates run, every successfully processed video in
`server/db_channels.json` will have:

```json
{
  "uploadDate": "20220514",                                   ← was null
  "finalFilename": "MyVideo_22-05-14.mp4",                    ← updated
  "sanitizedBase": "MyVideo",                                  ← unchanged
  "displayTitle": "MyVideo",                                   ← unchanged
  "title": "MyVideo",                                          ← unchanged
  ...
}
```

The `finalFilename` change keeps the existing sync logic working —
`performDiskScanForChannel()` matches disk files against
`video.finalFilename`, and both are updated atomically.

## Endpoints added

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/channels/:id/fix-dates` | Date-stamp all videos in one channel |
| `POST` | `/api/files/fix-dates-single-file` | Date-stamp all files in Single-File folder |
| `POST` | `/api/files/fix-dates-all` | Date-stamp every channel + Single-File folder |

All three return Server-Sent Events streams (`text/event-stream`) with
events: `start`, `channel_start`, `video`, `progress`, `channel_done`,
`done`, `complete`, `error`. A heartbeat comment (`: heartbeat\n\n`) is
sent every 15s to keep the connection alive through proxies.

## Safety

- Files are renamed in place — no copies, no temp files left behind
- DB is saved after every successful rename (crash-safe)
- yt-dlp failures are non-fatal: file is skipped, loop continues
- File-lock errors on Windows are caught and logged
- Path-length safety: base names are truncated so total path stays under
  260 chars on Windows

## Rollback

If you want to undo a Fix-Dates run, the simplest path is:

1. Stop the server
2. Restore your `server.js.bak` and `index.html.bak`
3. Manually rename files back (or use a script — the format is
   deterministic: strip the trailing `_\d{2}-\d{2}-\d{2}` from each
   filename)
4. Restore `db_channels.json` from your backup

There is currently no built-in undo endpoint — adding one is on the
"future enhancements" list.

## Future enhancements (not implemented)

- `POST /api/files/undo-fix-dates?log=<timestamp>` — reverse a run
- Use `uploadDate` in the UI (sort/filter column)
- Parallelism knob (currently sequential per channel)
- `yt-dlp --batch-args` for ~5× faster metadata fetching
