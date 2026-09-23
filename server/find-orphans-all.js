const path = require('path');
const fs = require('fs');

const [,, dbPath, serverDir, root, ...channels] = process.argv;

process.chdir(serverDir);
const D = require('better-sqlite3');
const db = new D(dbPath, { readonly: true });

const VIDEO_EXTS = ['.mp4', '.webm', '.mkv', '.m4a', '.mp3'];

// Collect all channels if none passed
let chList = channels;
if (chList.length === 0) {
    chList = db.prepare('SELECT name FROM channels ORDER BY name').all().map(r => r.name);
}

let grandTotalOrphans = 0;
let grandTotalDupes = 0;
let grandTotalStrays = 0;
const allOrphans = [];

for (const chName of chList) {
    const ch = db.prepare('SELECT id FROM channels WHERE name = ?').get(chName);
    if (!ch) continue;

    const folder = path.join(root, chName);
    if (!fs.existsSync(folder)) continue;

    const rows = db.prepare('SELECT id, title, finalFilename FROM videos WHERE channelId = ?').all(ch.id);
    const dbIds = new Set(rows.map(r => r.id));
    const dbFilenames = new Set(rows.map(r => (r.finalFilename || '').toLowerCase()));

    // Title lookup: normalized title -> row(s)
    const rowsByTitle = new Map();
    for (const r of rows) {
        const key = (r.title || '').toLowerCase().trim();
        if (!key) continue;
        if (!rowsByTitle.has(key)) rowsByTitle.set(key, []);
        rowsByTitle.get(key).push(r);
    }

    const files = fs.readdirSync(folder).filter(f => VIDEO_EXTS.includes(path.extname(f).toLowerCase()));
    const orphans = [];

    for (const f of files) {
        if (/^ytl_/.test(f) || f.startsWith('__ytl_')) continue;

        // Get videoId from filename if present
        const m = f.match(/--([a-zA-Z0-9_-]{11})\.\w+$/);
        const idInDb = m ? dbIds.has(m[1]) : false;
        const fnInDb = dbFilenames.has(f.toLowerCase());

        if (!idInDb && !fnInDb) {
            orphans.push(f);
        }
    }

    if (orphans.length === 0) continue;

    console.log('');
    console.log('===== ' + chName + ' (' + orphans.length + ' orphans) =====');

    for (const f of orphans) {
        // Normalize for title matching
        const base = f
            .replace(/\.[^.]+$/, '')                     // strip extension
            .replace(/--[a-zA-Z0-9_-]{11}$/, '')         // strip --videoId
            .replace(/_\d{2}-\d{2}-\d{2}$/, '')          // strip _YY-MM-DD
            .replace(/\s*\(\d+\)$/, '')                  // strip (N)
            .toLowerCase()
            .trim();

        // Try to find a DB row with the same base title
        let matches = [];
        if (rowsByTitle.has(base)) matches = rowsByTitle.get(base);
        if (matches.length === 0) {
            for (const [title, rws] of rowsByTitle.entries()) {
                if (title.length > 5 && (title.includes(base) || base.includes(title))) {
                    matches = matches.concat(rws);
                }
            }
        }

        // Get file size for context
        let sizeMB = 0;
        try { sizeMB = Math.round(fs.statSync(path.join(folder, f)).size / 1048576 * 100) / 100; } catch (e) {}

        if (matches.length > 0) {
            console.log('');
            console.log('  [DUP]  ' + f + '  (' + sizeMB + ' MB)');
            for (const r of matches.slice(0, 3)) {
                const rf = r.finalFilename || '(no filename)';
                let rSizeMB = 0;
                try { rSizeMB = Math.round(fs.statSync(path.join(folder, rf)).size / 1048576 * 100) / 100; } catch (e) { rSizeMB = -1; }
                console.log('         DB: ' + r.id + '  ' + rf + (rSizeMB >= 0 ? '  (' + rSizeMB + ' MB)' : '  (file missing)'));
            }
            grandTotalDupes++;
        } else {
            console.log('');
            console.log('  [STRAY] ' + f + '  (' + sizeMB + ' MB)');
            grandTotalStrays++;
        }

        grandTotalOrphans++;
        allOrphans.push({ channel: chName, file: f, type: matches.length > 0 ? 'DUP' : 'STRAY' });
    }
}

db.close();

console.log('');
console.log('==============================================================');
console.log('  GRAND TOTAL');
console.log('==============================================================');
console.log('  Orphan files total : ' + grandTotalOrphans);
console.log('    Likely duplicates: ' + grandTotalDupes);
console.log('    Strays           : ' + grandTotalStrays);
console.log('');

if (grandTotalStrays > 0) {
    console.log('  Stray files (not duplicates, leave as-is unless you want them added):');
    for (const o of allOrphans.filter(x => x.type === 'STRAY')) {
        console.log('    ' + o.channel.padEnd(35) + o.file);
    }
}
