/**
 * reset-broken.js — marks all ghost videos (finalFilename LIKE 'ytl_%')
 * as not-downloaded so the UI will offer to re-download them.
 *
 * Safe: only touches rows where finalFilename starts with ytl_
 * (which are known to be broken / missing).
 */

const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = path.join(__dirname, 'database.db');
const db = new Database(DB_PATH);

console.log('Opening:', DB_PATH);

// Show what we're about to touch
const before = db.prepare(`
    SELECT id, channelId, finalFilename
    FROM videos
    WHERE finalFilename LIKE 'ytl_%'
`).all();

console.log(`\nFound ${before.length} ghost video(s) in DB:\n`);
before.forEach(v => {
    console.log(`  ${v.id}  →  ${v.finalFilename}`);
});

if (before.length === 0) {
    console.log('\n✅ Nothing to reset.');
    db.close();
    process.exit(0);
}

console.log('\nResetting these entries to "not downloaded" ...');

const result = db.prepare(`
    UPDATE videos
    SET finalFilename = NULL,
        filePath = NULL,
        downloadStatus = NULL,
        syncStatus = 'new'
    WHERE finalFilename LIKE 'ytl_%'
`).run();

console.log(`\n✅ Updated ${result.changes} row(s).`);

// Verify
const after = db.prepare(`
    SELECT COUNT(*) AS n
    FROM videos
    WHERE finalFilename LIKE 'ytl_%'
`).get();

console.log(`Remaining ytl_ rows: ${after.n}`);

db.close();
console.log('\nDone. Restart the server, then reload the app.');