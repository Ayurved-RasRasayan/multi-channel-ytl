const path = require('path');
const fs = require('fs');

const [,, dbPath, serverDir, root, dest, applyStr] = process.argv;
const apply = applyStr === '1';

process.chdir(serverDir);
const D = require('better-sqlite3');
const db = new D(dbPath, { readonly: true });

const channels = db.prepare('SELECT name FROM channels ORDER BY name').all().map(r => r.name);
const VIDEO_EXTS = ['.mp4', '.webm', '.mkv', '.m4a', '.mp3'];

if (apply && !fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
    console.log('Created: ' + dest);
}

let totalOrphans = 0;
let totalBytes = 0;
const toMove = [];

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
        if (/^ytl_/.test(f) || f.startsWith('__ytl_')) continue;

        // Get videoId from filename if present
        const m = f.match(/--([a-zA-Z0-9_-]{11})\.\w+$/);
        const idInDb = m ? dbIds.has(m[1]) : false;
        const fnInDb = dbFilenames.has(f.toLowerCase());

        if (!idInDb && !fnInDb) {
            const fullPath = path.join(folder, f);
            const size = fs.statSync(fullPath).size;
            totalBytes += size;
            totalOrphans++;
            // Prefix with channel name so nothing collides in the destination
            const safeChannel = chName.replace(/[\\/:*?"<>|]/g, '_');
            const destName = '[' + safeChannel + '] ' + f;
            toMove.push({
                channel: chName,
                source: fullPath,
                destName,
                destPath: path.join(dest, destName),
                sizeMB: Math.round(size / 1048576 * 100) / 100,
            });
        }
    }
}

console.log('');
console.log('Orphans to move: ' + totalOrphans);
console.log('Total size     : ' + Math.round(totalBytes / 1048576 * 100) / 100 + ' MB');
console.log('Destination    : ' + dest);
console.log('');

// Group by channel for display
const byChannel = new Map();
for (const o of toMove) {
    if (!byChannel.has(o.channel)) byChannel.set(o.channel, []);
    byChannel.get(o.channel).push(o);
}
for (const [chName, arr] of byChannel.entries()) {
    console.log('  ' + chName + ': ' + arr.length + ' files');
}

if (!apply) {
    console.log('');
    console.log('DRY RUN -- no files moved. Sample of first 5:');
    for (const o of toMove.slice(0, 5)) {
        console.log('  ' + o.destName);
    }
    console.log('');
    console.log('To actually move: re-run with apply=1');
} else {
    console.log('');
    console.log('Moving files...');
    let moved = 0, failed = 0;
    for (const o of toMove) {
        try {
            // Handle collisions in dest
            let finalDest = o.destPath;
            let counter = 2;
            while (fs.existsSync(finalDest)) {
                const ext = path.extname(o.destName);
                const base = path.basename(o.destName, ext);
                finalDest = path.join(dest, base + ' (' + counter + ')' + ext);
                counter++;
            }
            fs.renameSync(o.source, finalDest);
            moved++;
        } catch (e) {
            console.log('  FAILED: ' + o.source + ' -- ' + e.message);
            failed++;
        }
    }
    console.log('');
    console.log('Moved : ' + moved + ' / ' + toMove.length);
    console.log('Failed: ' + failed);
}

db.close();
