const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '..', 'database.sqlite');
const JSON_DB_PATH = path.join(__dirname, '..', 'db_channels.json');

const db = new sqlite3.Database(DB_PATH, (err) => {
    if (err) {
        console.error('[SQLite] Error opening database:', err.message);
    } else {
        console.log('[SQLite] Connected to SQLite database at:', DB_PATH);
        initTables();
    }
});

function initTables() {
    db.serialize(() => {
        db.run(`
            CREATE TABLE IF NOT EXISTS channels (
                id TEXT PRIMARY KEY,
                youtubeId TEXT UNIQUE,
                url TEXT,
                name TEXT,
                videoCount INTEGER DEFAULT 0,
                addedAt TEXT,
                lastChecked TEXT,
                status TEXT
            )
        `);

        db.run(`
            CREATE TABLE IF NOT EXISTS videos (
                id TEXT PRIMARY KEY,
                channelId TEXT,
                title TEXT,
                duration INTEGER,
                views INTEGER,
                uploadDate TEXT,
                downloadStatus TEXT,
                syncStatus TEXT,
                finalFilename TEXT,
                filePath TEXT,
                FOREIGN KEY (channelId) REFERENCES channels(id)
            )
        `, (err) => {
            if (!err) {
                migrateFromJSON();
            }
        });
    });
}

function migrateFromJSON() {
    if (!fs.existsSync(JSON_DB_PATH)) return;

    try {
        const raw = fs.readFileSync(JSON_DB_PATH, 'utf8');
        const channels = JSON.parse(raw);

        if (!Array.isArray(channels) || channels.length === 0) return;

        db.get('SELECT COUNT(*) as count FROM channels', (err, row) => {
            if (err || row.count > 0) return; // Already populated

            console.log(`[SQLite] Migrating ${channels.length} channels from db_channels.json...`);

            db.serialize(() => {
                const stmtChan = db.prepare(`
                    INSERT OR REPLACE INTO channels (id, youtubeId, url, name, videoCount, addedAt, lastChecked, status)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                `);

                const stmtVid = db.prepare(`
                    INSERT OR REPLACE INTO videos (id, channelId, title, duration, views, uploadDate, downloadStatus, syncStatus, finalFilename, filePath)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `);

                channels.forEach(ch => {
                    stmtChan.run(
                        ch.id,
                        ch.youtubeId || ch.id,
                        ch.url || '',
                        ch.name || '',
                        ch.videoCount || 0,
                        ch.addedAt || new Date().toISOString(),
                        ch.lastChecked || new Date().toISOString(),
                        ch.status || 'active'
                    );

                    if (Array.isArray(ch.videos)) {
                        ch.videos.forEach(v => {
                            stmtVid.run(
                                v.id || v.videoId,
                                ch.id,
                                v.title || '',
                                v.duration || null,
                                v.views || null,
                                v.uploadDate || null,
                                v.downloadStatus || null,
                                v.syncStatus || null,
                                v.finalFilename || null,
                                v.filePath || null
                            );
                        });
                    }
                });

                stmtChan.finalize();
                stmtVid.finalize();
                console.log('[SQLite] ✅ Migration from db_channels.json completed successfully');
            });
        });
    } catch (e) {
        console.error('[SQLite] JSON migration error:', e.message);
    }
}

function getAllChannels() {
    return new Promise((resolve, reject) => {
        db.all('SELECT * FROM channels', [], (err, rows) => {
            if (err) return reject(err);
            resolve(rows);
        });
    });
}

function getChannelById(id) {
    return new Promise((resolve, reject) => {
        db.get('SELECT * FROM channels WHERE id = ?', [id], (err, channel) => {
            if (err) return reject(err);
            if (!channel) return resolve(null);

            db.all('SELECT * FROM videos WHERE channelId = ?', [id], (err, videos) => {
                if (err) return reject(err);
                channel.videos = videos || [];
                resolve(channel);
            });
        });
    });
}

function saveChannel(channel) {
    return new Promise((resolve, reject) => {
        db.serialize(() => {
            db.run(`
                INSERT OR REPLACE INTO channels (id, youtubeId, url, name, videoCount, addedAt, lastChecked, status)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                channel.id,
                channel.youtubeId || channel.id,
                channel.url || '',
                channel.name || '',
                channel.videoCount || 0,
                channel.addedAt || new Date().toISOString(),
                channel.lastChecked || new Date().toISOString(),
                channel.status || 'active'
            ]);

            if (Array.isArray(channel.videos)) {
                const stmtVid = db.prepare(`
                    INSERT OR REPLACE INTO videos (id, channelId, title, duration, views, uploadDate, downloadStatus, syncStatus, finalFilename, filePath)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `);

                channel.videos.forEach(v => {
                    stmtVid.run(
                        v.id || v.videoId,
                        channel.id,
                        v.title || '',
                        v.duration || null,
                        v.views || null,
                        v.uploadDate || null,
                        v.downloadStatus || null,
                        v.syncStatus || null,
                        v.finalFilename || null,
                        v.filePath || null
                    );
                });

                stmtVid.finalize();
            }

            resolve(channel);
        });
    });
}

module.exports = {
    db,
    getAllChannels,
    getChannelById,
    saveChannel
};
