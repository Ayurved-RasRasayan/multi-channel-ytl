const path = require('path');
const fs = require('fs');
const [,, dbPath, serverDir, root, applyStr] = process.argv;
const apply = applyStr === '1';

process.chdir(serverDir);
const D = require('better-sqlite3');
const db = new D(dbPath, { readonly: true });

const channels = db.prepare('SELECT name FROM channels ORDER BY name').all().map(r => r.name);
const VIDEO_EXTS = ['.mp4', '.webm', '.mkv', '.m4a', '.mp3'];

let totalDupes = 0;
let totalBytes = 0;
const toDelete = [];

for (const chName of channels) {
    const ch = db.prepare('SELECT id FROM channels WHERE name = ?').get(chName);
    if (!ch) continue;
    const folder = path.join(root, chName);
    if (!fs.existsSync(folder)) continue;

    const rows = db.prepare('SELECT id, finalFilename FROM videos WHERE channelId = ?').all(ch.id);
    const dbIds = new Set(rows.map(r => r.id));
    const dbFilenames = new Set(rows.map(r => (r.finalFilename || '').toLowerCase()));

    const files = fs.readdirSync(folder).filter(f => VIDEO_EXTS.includes(path.extname(f).toLowerCase()));

    for (const f of files) {
        // Only consider files with a (N) suffix
        if (!/\s\(\d+\)\.\w+$/.test(f)) continue;

        // Is the base file (without " (N)") tracked in DB?
        const baseCandidate = f.replace(/\s\(\d+\)(\.\w+)$/, '$1');
        const baseInDb = dbFilenames.has(baseCandidate.toLowerCase());

        // Also check: does the file's own videoId match a DB row?
        const m = f.match(/--([a-zA-Z0-9_-]{11})\s*\(\d+\)\.\w+$/) || f.match(/--([a-zA-Z0-9_-]{11})\.\w+$/);
        const idInDb = m ? dbIds.has(m[1]) : false;

        // It's a duplicate if the base is tracked AND this specific file is not the canonical one
        if (baseInDb && !dbFilenames.has(f.toLowerCase())) {
            const fullPath = path.join(folder, f);
            const size = fs.statSync(fullPath).size;
            totalBytes += size;
            totalDupes++;
            toDelete.push({ channel: chName, file: f, path: fullPath, sizeMB: Math.round(size/1048576*100)/100 });
        }
    }
}

console.log('');
console.log('Duplicates to delete: ' + totalDupes);
console.log('Total size: ' + Math.round(totalBytes/1048576*100)/100 + ' MB');
console.log('');
for (const d of toDelete) {
    console.log('  ' + d.channel.padEnd(35) + d.file.substring(0, 70));
}

if (apply) {
    let deleted = 0, failed = 0;
    for (const d of toDelete) {
        try { fs.unlinkSync(d.path); deleted++; }
        catch (e) { console.log('  FAILED: ' + d.file + ' -- ' + e.message); failed++; }
    }
    console.log('');
    console.log('Deleted: ' + deleted + ' / ' + toDelete.length);
    console.log('Failed : ' + failed);
} else {
    console.log('');
    console.log('DRY RUN -- no files deleted');
}
db.close();
