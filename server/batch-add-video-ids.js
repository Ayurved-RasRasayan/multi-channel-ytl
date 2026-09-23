const path = require('path');
const fs = require('fs');

const [,, dbPath, serverDir, applyStr, ...channels] = process.argv;
const apply = applyStr === '1';

process.chdir(serverDir);
const D = require('better-sqlite3');
const db = new D(dbPath);

const VIDEO_EXTS = ['.mp4', '.webm', '.mkv', '.m4a', '.mp3'];

for (const chName of channels) {
    console.log('');
    console.log('===== ' + chName + ' =====');

    const ch = db.prepare('SELECT id FROM channels WHERE name = ?').get(chName);
    if (!ch) { console.log('  Channel not found'); continue; }

    const folder = path.join('C:\\Users\\Jackle\\Downloads\\YouTube-Downloader', chName);
    if (!fs.existsSync(folder)) { console.log('  Folder not found'); continue; }

    const dbRows = db.prepare('SELECT id, finalFilename FROM videos WHERE channelId = ?').all(ch.id);
    const dbByFn = new Map();
    let orphanRows = 0;
    for (const r of dbRows) {
        if (!r.finalFilename) continue;
        if (r.id.startsWith('disk_')) { orphanRows++; continue; }
        dbByFn.set(r.finalFilename, r);
    }

    const allFiles = fs.readdirSync(folder);
    let withId = 0, junk = 0, noMatch = 0;
    const plan = [];

    for (const f of allFiles) {
        const ext = path.extname(f).toLowerCase();
        if (!VIDEO_EXTS.includes(ext)) continue;
        if (/^ytl_[0-9a-f]{8}-/i.test(f) || f.startsWith('__ytl_')) { junk++; continue; }
        if (/--[a-zA-Z0-9_-]{11}/.test(f)) { withId++; continue; }
        const r = dbByFn.get(f);
        if (!r) { noMatch++; continue; }
        const newName = f.replace(/(\.\w+)$/, '--' + r.id + '$1');
        plan.push({ oldName: f, newName: newName, videoId: r.id, oldPath: path.join(folder, f), newPath: path.join(folder, newName) });
    }

    console.log('  Total video files     : ' + (withId + plan.length + noMatch));
    console.log('  Already has --videoId : ' + withId);
    console.log('  Needs rename (matched): ' + plan.length);
    console.log('  No DB match           : ' + noMatch);
    console.log('  Junk (ytl_*)          : ' + junk);
    console.log('  Orphan disk_* DB rows : ' + orphanRows);

    if (plan.length === 0) { console.log('  -> Nothing to rename.'); continue; }

    console.log('');
    console.log('  First 5 planned renames:');
    for (const p of plan.slice(0, 5)) {
        console.log('    OLD: ' + p.oldName);
        console.log('    NEW: ' + p.newName);
    }

    if (!apply) { console.log('  DRY RUN -- no changes made'); continue; }

    const updateStmt = db.prepare('UPDATE videos SET finalFilename = ? WHERE id = ?');
    let renamed = 0, failed = 0;
    const txn = db.transaction((arr) => {
        for (const p of arr) {
            try { fs.renameSync(p.oldPath, p.newPath); }
            catch (e) { console.log('    FAILED rename: ' + p.oldName + ' -- ' + e.message); failed++; continue; }
            try { updateStmt.run(p.newName, p.videoId); renamed++; }
            catch (e) { console.log('    DB update failed: ' + p.videoId + ': ' + e.message); failed++; }
        }
    });
    txn(plan);

    console.log('  Renamed: ' + renamed + ' / ' + plan.length);
    console.log('  Failed : ' + failed);
}

db.close();
