/**
 * check-db.js — Read-only inspection of database.db
 *
 * Run from this folder:
 *   cd "C:\Program Files (x86)\multi-channel-ytl\server\db"
 *   node check-db.js
 *
 * OR from the server folder:
 *   node db\check-db.js
 */

const path = require('path');
const fs = require('fs');

// Resolve better-sqlite3 from the project's node_modules,
// even if this script runs from inside db/.
const Database = require('better-sqlite3');

const DB_PATH = path.join(__dirname, 'database.db');

console.log('==================================================');
console.log('Database Inspector');
console.log('==================================================');
console.log('DB path:      ', DB_PATH);

// Verify the three WAL-mode files exist
['', '-wal', '-shm'].forEach(suffix => {
    const p = DB_PATH + suffix;
    if (fs.existsSync(p)) {
        const sz = fs.statSync(p).size;
        console.log(`  ✅ ${path.basename(p).padEnd(25)} ${(sz / 1024).toFixed(2)} KB`);
    } else {
        console.log(`  ⚠️  ${path.basename(p).padEnd(25)} (missing)`);
    }
});

console.log('');

let db;
try {
    db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
} catch (err) {
    console.error('❌ Failed to open database:', err.message);
    process.exit(1);
}

// ============================================================
// 1. Channels
// ============================================================
console.log('--------------------------------------------------');
console.log('1) CHANNELS');
console.log('--------------------------------------------------');
const channels = db.prepare(`
    SELECT id, name, youtubeId, handle, videoCount, lastChecked
    FROM channels
    ORDER BY name
`).all();

if (channels.length === 0) {
    console.log('   (no channels in DB)');
} else {
    channels.forEach(ch => {
        console.log(`\n   Name:        ${ch.name}`);
        console.log(`   UUID (id):   ${ch.id}`);
        console.log(`   youtubeId:   ${ch.youtubeId}`);
        console.log(`   handle:      ${ch.handle}`);
        console.log(`   videoCount:  ${ch.videoCount}`);
        console.log(`   lastChecked: ${ch.lastChecked}`);
    });
}

// ============================================================
// 2. Broken filenames in DB
// ============================================================
console.log('\n--------------------------------------------------');
console.log('2) VIDEOS WITH BROKEN FILENAMES (ytl_...)');
console.log('--------------------------------------------------');
const broken = db.prepare(`
    SELECT id, channelId, title, finalFilename, filePath, downloadStatus, syncStatus
    FROM videos
    WHERE finalFilename LIKE 'ytl_%'
    ORDER BY finalFilename
`).all();

if (broken.length === 0) {
    console.log('   ✅ No broken filenames stored in DB.');
    console.log('      (This is good news — the repair endpoint only');
    console.log('       needs to handle the disk files, not DB entries.)');
} else {
    console.log(`   Found ${broken.length} broken entry(s):\n`);
    broken.forEach((v, i) => {
        console.log(`   [${i + 1}] video id:   ${v.id}`);
        console.log(`       channelId:  ${v.channelId}`);
        console.log(`       title:      ${v.title}`);
        console.log(`       filename:   ${v.finalFilename}`);
        console.log(`       filePath:   ${v.filePath}`);
        console.log(`       status:     ${v.downloadStatus} / ${v.syncStatus}`);
        console.log('');
    });
}

// ============================================================
// 3. Specific video IDs from your broken files
// ============================================================
console.log('--------------------------------------------------');
console.log('3) YOUR SPECIFIC BROKEN-FILE VIDEO IDS');
console.log('--------------------------------------------------');
const targets = ['lRcDMCfFtzU', 'GA146syfPxU', 'U2ETcFH3dD8'];

targets.forEach(tid => {
    const row = db.prepare(`
        SELECT id, channelId, title, finalFilename, downloadStatus, syncStatus
        FROM videos
        WHERE id = ?
    `).get(tid);

    if (row) {
        console.log(`\n   ✅ ${tid}`);
        console.log(`      title:      ${row.title}`);
        console.log(`      channelId:  ${row.channelId}`);
        console.log(`      filename:   ${row.finalFilename}`);
        console.log(`      status:     ${row.downloadStatus} / ${row.syncStatus}`);
    } else {
        console.log(`\n   ❌ ${tid}  —  NOT FOUND in DB`);
    }
});

// ============================================================
// 4. Video counts per channel
// ============================================================
console.log('\n--------------------------------------------------');
console.log('4) VIDEO COUNT PER CHANNEL');
console.log('--------------------------------------------------');
const counts = db.prepare(`
    SELECT channelId, COUNT(*) AS n
    FROM videos
    GROUP BY channelId
    ORDER BY n DESC
`).all();

if (counts.length === 0) {
    console.log('   (no videos in DB)');
} else {
    counts.forEach(c => {
        const chName = db.prepare('SELECT name FROM channels WHERE id = ?').get(c.channelId)?.name || '(unknown)';
        console.log(`   ${c.n.toString().padStart(5)}  ${c.channelId}  →  ${chName}`);
    });
}

// ============================================================
// 5. Schema summary
// ============================================================
console.log('\n--------------------------------------------------');
console.log('5) TABLE ROW COUNTS');
console.log('--------------------------------------------------');
console.log('   channels:', db.prepare('SELECT COUNT(*) AS n FROM channels').get().n);
console.log('   videos:  ', db.prepare('SELECT COUNT(*) AS n FROM videos').get().n);

db.close();
console.log('\n==================================================');
console.log('Done.');
console.log('==================================================');