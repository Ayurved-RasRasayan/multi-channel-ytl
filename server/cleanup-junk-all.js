const path = require('path');
const fs = require('fs');

const [,, dbPath, serverDir, applyStr, ...channels] = process.argv;
const apply = applyStr === '1';

process.chdir(serverDir);
const D = require('better-sqlite3');
const db = new D(dbPath);

for (const chName of channels) {
    console.log('');
    console.log('===== ' + chName + ' =====');

    const ch = db.prepare('SELECT id FROM channels WHERE name = ?').get(chName);
    if (!ch) { console.log('  Channel not found'); continue; }

    const folder = path.join('C:\\Users\\Jackle\\Downloads\\YouTube-Downloader', chName);
    if (!fs.existsSync(folder)) { console.log('  Folder not found'); continue; }

    // --- Junk files (ytl_*) ---
    const allFiles = fs.readdirSync(folder);
    const junkFiles = allFiles.filter(f => /^ytl_[0-9a-f]{8}-/i.test(f) || f.startsWith('__ytl_'));
    let junkBytes = 0;
    for (const f of junkFiles) {
        try { junkBytes += fs.statSync(path.join(folder, f)).size; } catch (e) {}
    }

    console.log('  Junk files (ytl_*)        : ' + junkFiles.length + ' (' + Math.round(junkBytes/1048576*100)/100 + ' MB)');

    // --- Orphan disk_* DB rows ---
    const orphanRows = db.prepare("SELECT id, finalFilename FROM videos WHERE channelId = ? AND id LIKE 'disk_%'").all(ch.id);
    console.log('  Orphan disk_* DB rows     : ' + orphanRows.length);
    for (const r of orphanRows.slice(0, 3)) {
        console.log('    ' + r.id + '  ->  ' + (r.finalFilename || '').substring(0, 60));
    }

    if (!apply) continue;

    // --- Delete junk files ---
    let filesDeleted = 0;
    for (const f of junkFiles) {
        try { fs.unlinkSync(path.join(folder, f)); filesDeleted++; }
        catch (e) { console.log('    FAILED delete: ' + f + ' -- ' + e.message); }
    }

    // --- Delete orphan DB rows ---
    const del = db.prepare("DELETE FROM videos WHERE channelId = ? AND id LIKE 'disk_%'");
    const r = del.run(ch.id);

    console.log('  -> Files deleted: ' + filesDeleted + ' / ' + junkFiles.length);
    console.log('  -> DB rows deleted: ' + r.changes + ' / ' + orphanRows.length);
}

db.close();
