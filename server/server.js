// ===== UTF-8 STDOUT/STDERR =====
if(process.platform==='win32'){try{process.stdout.setDefaultEncoding('utf8');process.stderr.setDefaultEncoding('utf8');process.env.LANG=process.env.LANG||'en_US.UTF-8';process.env.LC_ALL=process.env.LC_ALL||'en_US.UTF-8';}catch(e){}}
// ================================

// ===== CRASH GUARD =====
process.on('unhandledRejection', (reason, promise) => {
    console.error('[FATAL-GUARD] Unhandled Rejection:', reason);
});
process.on('uncaughtException', (err) => {
    console.error('[FATAL-GUARD] Uncaught Exception:', err && err.message ? err.message : err);
});
process.stdout.on('error', (err) => { if (err.code !== 'EPIPE') throw err; });
process.stderr.on('error', (err) => { if (err.code !== 'EPIPE') throw err; });
// =======================

// =============================================================================
// INTERNET CONNECTIVITY MONITOR
// =============================================================================
const net = require('net');
const dns = require('dns');

const NETWORK_CHECK_INTERVAL_MS = 5000;
const NETWORK_CHECK_FAST_MS = 2000;
const NETWORK_PROBE_TIMEOUT_MS = 3000;
const NETWORK_HOSTS = [
    { host: 'www.youtube.com', port: 443 },
    { host: 'www.google.com', port: 443 },
    { host: '1.1.1.1', port: 443 },
];
const NETWORK_FAILS_BEFORE_OFFLINE = 2;
const NETWORK_SUCCESSES_BEFORE_ONLINE = 1;

const networkMonitor = {
    online: true,
    lastCheck: null,
    lastOnlineAt: Date.now(),
    lastOfflineAt: null,
    consecutiveFails: 0,
    consecutiveSuccesses: 0,
    listeners: { online: [], offline: [] },
    _timer: null,
    _probeInFlight: false,

    on(event, fn) {
        if (this.listeners[event]) this.listeners[event].push(fn);
    },
    _emit(event, payload) {
        for (const fn of (this.listeners[event] || [])) {
            try { fn(payload); }
            catch (e) { console.error('[Network] listener error (' + event + '):', e.message); }
        }
    },
    isOnline() { return this.online; },

    _probeOnce() {
        return new Promise((resolve) => {
            let settled = false;
            const finish = (ok) => { if (settled) return; settled = true; resolve(ok); };
            let idx = 0;
            const tryNext = () => {
                if (idx >= NETWORK_HOSTS.length) return finish(false);
                const { host, port } = NETWORK_HOSTS[idx++];
                const sock = net.connect({ host, port });
                const timer = setTimeout(() => {
                    try { sock.destroy(); } catch {}
                    tryNext();
                }, NETWORK_PROBE_TIMEOUT_MS);
                sock.once('connect', () => {
                    clearTimeout(timer);
                    try { sock.destroy(); } catch {}
                    finish(true);
                });
                sock.once('error', () => {
                    clearTimeout(timer);
                    try { sock.destroy(); } catch {}
                    tryNext();
                });
            };
            tryNext();
        });
    },

    async _tick() {
        if (this._probeInFlight) return;
        this._probeInFlight = true;
        try {
            const ok = await this._probeOnce();
            this.lastCheck = Date.now();
            if (ok) {
                this.consecutiveSuccesses++;
                this.consecutiveFails = 0;
                if (!this.online && this.consecutiveSuccesses >= NETWORK_SUCCESSES_BEFORE_ONLINE) {
                    this.online = true;
                    this.lastOnlineAt = Date.now();
                    console.log('\n[Network] \u2705 Internet connection RESTORED');
                    this._emit('online', { at: this.lastOnlineAt });
                }
            } else {
                this.consecutiveFails++;
                this.consecutiveSuccesses = 0;
                if (this.online && this.consecutiveFails >= NETWORK_FAILS_BEFORE_OFFLINE) {
                    this.online = false;
                    this.lastOfflineAt = Date.now();
                    console.log('\n[Network] \u274c Internet connection LOST');
                    this._emit('offline', { at: this.lastOfflineAt });
                }
            }
        } catch (e) {
        } finally {
            this._probeInFlight = false;
            const delay = this.online ? NETWORK_CHECK_INTERVAL_MS : NETWORK_CHECK_FAST_MS;
            this._timer = setTimeout(() => this._tick(), delay);
        }
    },

    start() {
        if (this._timer) return;
        console.log('[Network] Monitor started');
        this._tick();
    },
    stop() {
        if (this._timer) { clearTimeout(this._timer); this._timer = null; }
    },
    status() {
        return {
            online: this.online,
            lastCheck: this.lastCheck,
            lastOnlineAt: this.lastOnlineAt,
            lastOfflineAt: this.lastOfflineAt,
            consecutiveFails: this.consecutiveFails,
            consecutiveSuccesses: this.consecutiveSuccesses,
        };
    }
};

// =============================================================================
// ACTIVE CHILD PROCESS REGISTRY
// =============================================================================
const activeChildProcesses = new Map();

const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const cron = require('node-cron');
const { execSync, exec, execFileSync, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

// =============================================================================
//  CRITICAL FIX: Force UTF-8 encoding on Windows
// =============================================================================
if (process.platform === 'win32') {
    process.env.NODE_ENV = process.env.NODE_ENV || 'production';
    if (!process.env.PYTHONIOENCODING) {
        process.env.PYTHONIOENCODING = 'utf-8';
    }
    console.log('[Init]  Windows UTF-8 mode enabled (PYTHONIOENCODING=utf-8)');
}

// =============================================================================
// AUTHENTICATION & SECURITY MODULES
// =============================================================================

const session = require('express-session');
const rateLimit = require('express-rate-limit');

// =============================================================================
//  FIX #3: Cookie path discovery  check BOTH server/cookies.txt and ../cookies.txt
// =============================================================================
function resolveCookieFilePath() {
    if (process.env.COOKIE_FILE_PATH) return process.env.COOKIE_FILE_PATH;

    const serverLocal = path.join(__dirname, 'cookies.txt');       // server/cookies.txt
    const projectRoot = path.join(__dirname, '..', 'cookies.txt');  // <root>/cookies.txt

    if (fs.existsSync(serverLocal)) return serverLocal;
    if (fs.existsSync(projectRoot)) return projectRoot;
    // Neither exists  default to server-local (matches bootstrap behavior)
    return serverLocal;
}

const AUTH_CONFIG = {
    username: 'admin',
    password: 'password123',
    sessionSecret: 'ytl-secret-key-2024',
    sessionMaxAge: 2 * 24 * 60 * 60 * 1000,
    cookieFilePath: resolveCookieFilePath(),
    browserName: 'edge'
};

function validateAuthConfig() {
    console.log(`
+============================================================+
|                 AUTHENTICATION CONFIGURATION               |
+============================================================+
|  Username        : ${AUTH_CONFIG.username}
|  Password        : ${'*'.repeat(AUTH_CONFIG.password.length)} (hidden)
|  Session         : ${(AUTH_CONFIG.sessionMaxAge / (1000 * 60 * 60 * 24)).toFixed(1)} days
|                                                            |
|  To change credentials, edit server.js and modify the      |
|  AUTH_CONFIG object near the top of the file.              |
+============================================================+
`);

    if (AUTH_CONFIG.username === 'admin' && AUTH_CONFIG.password === 'password123') {
        console.warn('  WARNING: You are using default credentials!');
        console.warn('   It is recommended to change them in server.js for better security.\n');
    }
}

// =============================================================================
// PATH CONVERSION
// =============================================================================

function toNativePath(unixStylePath) {
    if (/^[A-Za-z]:\\/.test(unixStylePath) || /^[A-Za-z]:\//.test(unixStylePath)) {
        return unixStylePath;
    }

    const isWindows = process.platform === 'win32';
    const isCygwinMsysPath = isWindows &&
                              unixStylePath.startsWith('/') &&
                              unixStylePath.length >= 3 &&
                              /^[a-zA-Z]$/.test(unixStylePath.charAt(1)) &&
                              (unixStylePath.charAt(2) === '/' || unixStylePath.charAt(2) == '\\');

    if (isCygwinMsysPath) {
        const driveLetter = unixStylePath.charAt(1).toUpperCase();
        const restOfPath = unixStylePath.slice(2).replace(/\//g, '\\');
        const windowsPath = driveLetter + ':\\' + restOfPath;
        console.log('[Path Conversion] Cygwin -> Windows:');
        console.log('   FROM:', unixStylePath);
        console.log('   TO:  ', windowsPath);
        return windowsPath;
    }

    if (!isWindows) {
        console.log('[Path Conversion] Non-Windows system, keeping Unix path:', unixStylePath);
        return unixStylePath;
    }

    const resolved = path.resolve(unixStylePath);
    console.log('[Path Conversion] Resolved:', unixStylePath, '->', resolved);
    return resolved;
}

function findIndexHtml() {
    const possiblePaths = [
        path.join(__dirname, '../public/index.html'),
        path.join(__dirname, '../../public/index.html'),
        path.join(process.cwd(), '../public/index.html'),
        path.join(process.cwd(), 'public/index.html'),
    ];

    for (const p of possiblePaths) {
        if (fs.existsSync(p)) {
            console.log('[findIndexHtml] FOUND:', p);
            return p;
        }
    }

    console.log('[findIndexHtml] NOT FOUND in any location');
    return null;
}

// =============================================================================
//  FIX #6: Resolve absolute path to yt-dlp binary ONCE at startup
// =============================================================================
let YTDLP_BIN = process.env.YTDLP_PATH || 'yt-dlp';

function detectYtDlpBinary() {
    if (process.env.YTDLP_PATH) {
        YTDLP_BIN = process.env.YTDLP_PATH;
        console.log(`[Init] yt-dlp (from env): ${YTDLP_BIN}`);
        return YTDLP_BIN;
    }

    // (1) PATH lookup
    try {
        const cmd = process.platform === 'win32' ? 'where yt-dlp' : 'which yt-dlp';
        const out = execSync(cmd, { encoding: 'utf-8', windowsHide: true, timeout: 5000 });
        const first = out.split(/\r?\n/).map(l => l.trim()).filter(Boolean)[0];
        if (first && fs.existsSync(first)) {
            YTDLP_BIN = first;
            console.log(`[Init]  yt-dlp resolved (PATH): ${YTDLP_BIN}`);
            return YTDLP_BIN;
        }
    } catch (e) { /* continue */ }

    // (2) Ask Python where yt-dlp lives
    const pyCandidates = process.platform === 'win32'
        ? ['python', 'python3', 'py']
        : ['python3', 'python'];
    for (const py of pyCandidates) {
        try {
            const args = py === 'py'
                ? ['-3', '-c', 'import shutil; print(shutil.which("yt-dlp") or "")']
                : ['-c', 'import shutil; print(shutil.which("yt-dlp") or "")'];
            const out = execFileSync(py, args, {
                encoding: 'utf-8', windowsHide: true, timeout: 5000
            }).trim();
            if (out && fs.existsSync(out)) {
                YTDLP_BIN = out;
                console.log(`[Init]  yt-dlp resolved (via ${py}): ${YTDLP_BIN}`);
                return YTDLP_BIN;
            }
        } catch (e) { /* try next */ }
    }

    // (3) Direct probe of known pip-script locations
    const home = os.homedir();
    const probes = process.platform === 'win32'
        ? [
            path.join(process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'),
                      'Programs', 'Python', 'Python312', 'Scripts', 'yt-dlp.exe'),
            path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'),
                      'Python', 'Python312', 'Scripts', 'yt-dlp.exe'),
            path.join(home, 'AppData', 'Local', 'Programs', 'Python', 'Python312', 'Scripts', 'yt-dlp.exe'),
        ]
        : [
            path.join(home, '.local', 'bin', 'yt-dlp'),
            '/usr/local/bin/yt-dlp',
            '/usr/bin/yt-dlp',
        ];
    for (const p of probes) {
        if (fs.existsSync(p)) {
            YTDLP_BIN = p;
            console.log(`[Init]  yt-dlp found by direct probe: ${YTDLP_BIN}`);
            return YTDLP_BIN;
        }
    }

    console.log('[Init]  Could not resolve absolute yt-dlp path  using bare name "yt-dlp"');
    YTDLP_BIN = 'yt-dlp';
    return YTDLP_BIN;
}

// =============================================================================
//  FIX: Detect Node binary explicitly (used for --js-runtimes)
// =============================================================================
let NODE_BIN = 'node';

function detectNodeBinary() {
    // process.execPath is guaranteed to be a working Node executable  we're
    // running under it right now.
    if (process.execPath && /node(\.exe)?$/i.test(process.execPath)) {
        NODE_BIN = process.execPath;
        console.log(`[Init]  Node resolved from process: ${NODE_BIN}`);
        return NODE_BIN;
    }
    try {
        const cmd = process.platform === 'win32' ? 'where node' : 'which node';
        const out = execSync(cmd, { encoding: 'utf-8', windowsHide: true, timeout: 5000 });
        const first = out.split(/\r?\n/).map(l => l.trim()).filter(Boolean)[0];
        if (first && fs.existsSync(first)) {
            NODE_BIN = first;
            console.log(`[Init]  Node resolved: ${NODE_BIN}`);
            return NODE_BIN;
        }
    } catch (e) { /* fall through */ }
    console.log('[Init]  Node not resolved  using bare "node"');
    return NODE_BIN;
}

// =============================================================================
//  FIX #2: Global yt-dlp base flags (JS runtime for signature/n challenge)
// =============================================================================
// These are `let` so we can populate them AFTER detectNodeBinary() runs.
let YTDLP_GLOBAL_FLAGS_ARR = ['--js-runtimes', 'node'];
let YTDLP_GLOBAL_FLAGS_STR = '--js-runtimes node';

/** Prepend global yt-dlp flags to a string command (idempotent). */
function withGlobalFlags(cmdStr) {
    if (/--js-runtimes/.test(cmdStr)) return cmdStr;
    return cmdStr.replace(
        /^("?)([^"\s]*?yt-dlp(?:\.exe)?)("?)/i,
        (m, q1, bin, q2) => `${q1}${bin}${q2} ${YTDLP_GLOBAL_FLAGS_STR}`
    );
}

// =============================================================================
//  FIX: FFmpeg detection  check PATH, then imageio-ffmpeg bundled binary
// =============================================================================
let FFMPEG_AVAILABLE = false;
let FFMPEG_PATH = null;

function detectFfmpeg() {
    // (1) Try PATH
    try {
        const out = execSync('ffmpeg -version', { stdio: 'pipe', encoding: 'utf-8' })
            .split('\n')[0].trim();
        FFMPEG_AVAILABLE = true;
        console.log('[Init]  FFmpeg available on PATH:', out);
        return;
    } catch (e) { /* continue */ }

    // (2) Try imageio-ffmpeg bundled binary
    const pyScript = 'import imageio_ffmpeg,sys;sys.stdout.write(imageio_ffmpeg.get_ffmpeg_exe() or "")';
    const pyCandidates = process.platform === 'win32'
        ? ['python', 'python3', 'py']
        : ['python3', 'python'];
    for (const py of pyCandidates) {
        try {
            const args = py === 'py' ? ['-3', '-c', pyScript] : ['-c', pyScript];
            const out = execFileSync(py, args, {
                encoding: 'utf-8', windowsHide: true, timeout: 8000
            }).trim();
            if (out && fs.existsSync(out)) {
                FFMPEG_PATH = out;
                FFMPEG_AVAILABLE = true;
                // Prepend its directory to PATH so child processes (yt-dlp)
                // can find ffmpeg too.
                const dir = path.dirname(out);
                if (!process.env.PATH.includes(dir)) {
                    process.env.PATH = dir + path.delimiter + process.env.PATH;
                }
                console.log('[Init]  FFmpeg found via imageio-ffmpeg:', FFMPEG_PATH);
                console.log('[Init]    Prepended to PATH so yt-dlp can find it too');
                return;
            }
        } catch (e) { /* try next python */ }
    }

    console.log('[Init]  FFmpeg not found - merging DASH streams will fail');
}

// =============================================================================
// COOKIE MANAGEMENT
// =============================================================================

function getNativeCookiePath() {
    const originalPath = AUTH_CONFIG.cookieFilePath;
    const nativePath = toNativePath(originalPath);
    AUTH_CONFIG.cookieFilePath = nativePath;

    console.log('[Cookie Path] Original:', originalPath);
    console.log('[Cookie Path] Native:   ', nativePath);
    return nativePath;
}

let _cookiesValidCache = null;

function isCookiesFileValid(verbose = true) {
    const cookiePath = AUTH_CONFIG.cookieFilePath;

    if (!cookiePath) {
        if (verbose) console.log('[isCookiesFileValid] FAIL: Cookie path is undefined/null');
        return false;
    }

    try {
        const stats = fs.statSync(cookiePath);
        if (_cookiesValidCache &&
            _cookiesValidCache.mtime === stats.mtimeMs &&
            _cookiesValidCache.size === stats.size) {
            return _cookiesValidCache.result;
        }
    } catch (e) {
        if (verbose) console.log('[isCookiesFileValid] FAIL: Cannot stat file:', e.message);
        return false;
    }

    if (verbose) console.log('\n[isCookiesFileValid] Starting validation...');
    if (verbose) console.log('[isCookiesFileValid] Checking path:', cookiePath);

    const exists = fs.existsSync(cookiePath);
    if (verbose) console.log('[isCookiesFileValid] File exists?', exists);

    if (!exists) {
        if (verbose) {
            console.log('[isCookiesFileValid] FAIL: File does not exist:', cookiePath);
            console.log('[isCookiesFileValid] TIP: Re-export cookies from browser extension');
        }
        _cookiesValidCache = { mtime: 0, size: 0, result: false };
        return false;
    }

    try {
        const stats = fs.statSync(cookiePath);
        if (verbose) console.log('[isCookiesFileValid] File size:', stats.size, 'bytes');

        if (stats.size === 0) {
            if (verbose) console.log('[isCookiesFileValid] FAIL: File is empty');
            _cookiesValidCache = { mtime: stats.mtimeMs, size: 0, result: false };
            return false;
        }

        const content = fs.readFileSync(cookiePath, 'utf8');
        if (verbose) console.log('[isCookiesFileValid] Content length:', content.length, 'chars');

        const allLines = content.split('\n');
        const lines = allLines.filter(line => line.trim() && !line.startsWith('#'));

        if (lines.length === 0) {
            if (verbose) console.log('[isCookiesFileValid] FAIL: No cookie entries found');
            _cookiesValidCache = { mtime: stats.mtimeMs, size: stats.size, result: false };
            return false;
        }

        if (verbose) {
            console.log('[isCookiesFileValid] First 3 data lines:');
            lines.slice(0, 3).forEach((line, i) => {
                const fields = line.split('\t');
                console.log(`   Data line ${i}: ${fields.length} fields`);
                console.log('      Raw:', line.substring(0, 120));
            });
        }

        const sampleLine = lines[0];
        const fields = sampleLine.split('\t');

        if (fields.length < 7) {
            if (verbose) {
                console.log('\n[isCookiesFileValid] INVALID FORMAT DETECTED!');
                console.log('[isCookiesFileValid] Problem: Lines have only', fields.length, 'fields instead of 7');
                console.log('[isCookiesFileValid] Solution: Run POST /api/cookies/repair to fix, or re-export');
            }
            _cookiesValidCache = { mtime: stats.mtimeMs, size: stats.size, result: false };
            return false;
        }

        if (verbose) {
            console.log('\n[isCookiesFileValid] PASS: Valid Netscape format!');
            console.log('[isCookiesFileValid] Found', lines.length, 'cookies in correct format');
        }
        _cookiesValidCache = { mtime: stats.mtimeMs, size: stats.size, result: true };
        return true;

    } catch (err) {
        if (verbose) {
            console.log('[isCookiesFileValid] EXCEPTION during validation:');
            console.log('   Error name:', err.name);
            console.log('   Error message:', err.message);
        }
        return false;
    }
}

function invalidateCookiesFileCache() {
    _cookiesValidCache = null;
}

function logMissingAuthCookies() {
    const cookiePath = AUTH_CONFIG.cookieFilePath;
    if (!cookiePath || !fs.existsSync(cookiePath)) {
        console.error('[Auth Cookies]  cookies.txt file does not exist at:', cookiePath);
        return;
    }

    let content;
    try {
        content = fs.readFileSync(cookiePath, 'utf8');
    } catch (err) {
        console.error('[Auth Cookies]  Cannot read cookies.txt:', err.message);
        return;
    }

    const lines = content.split('\n').filter(l => l.trim() && !l.startsWith('#'));
    const criticalCookies = ['SID', 'SSID', 'HSID', 'APISID', 'SAPISID', 'LOGIN_INFO', 'VISITOR_INFO1_LIVE', '__Secure-3PSID'];
    const now = Date.now() / 1000;

    const found = {};
    lines.forEach(line => {
        const fields = line.split('\t');
        if (fields.length >= 7) {
            const name = fields[5];
            const expiration = parseInt(fields[4], 10);
            if (criticalCookies.includes(name)) {
                found[name] = {
                    expiration,
                    expired: expiration > 0 && expiration < now,
                    expiresInDays: expiration > 0 ? Math.round((expiration - now) / 86400) : null
                };
            }
        }
    });

    console.error('[Auth Cookies] Critical YouTube cookies in cookies.txt:');
    criticalCookies.forEach(name => {
        if (found[name]) {
            const info = found[name];
            if (info.expired) {
                console.error(`[Auth Cookies]    ${name}: EXPIRED`);
            } else if (info.expiresInDays !== null) {
                console.error(`[Auth Cookies]    ${name}: valid (expires in ${info.expiresInDays} day(s))`);
            } else {
                console.error(`[Auth Cookies]    ${name}: valid (session cookie)`);
            }
        } else {
            console.error(`[Auth Cookies]    ${name}: MISSING`);
        }
    });

    const missing = criticalCookies.filter(n => !found[n]);
    const expired = criticalCookies.filter(n => found[n] && found[n].expired);
    if (missing.length > 0 || expired.length > 0) {
        console.error(`[Auth Cookies]  ${missing.length} missing, ${expired.length} expired  re-export cookies.txt`);
    } else {
        console.error('[Auth Cookies]  All critical YouTube cookies are present and valid');
    }
}

function repairCookiesFile(cookiePath) {
    cookiePath = cookiePath || AUTH_CONFIG.cookieFilePath;

    if (!cookiePath || !fs.existsSync(cookiePath)) {
        return { repaired: false, reason: 'File does not exist' };
    }

    let content;
    try {
        content = fs.readFileSync(cookiePath, 'utf8');
    } catch (err) {
        return { repaired: false, reason: 'Cannot read file: ' + err.message };
    }

    const lines = content.split(/\r?\n/);
    const fixedLines = [];
    let fixedCount = 0;
    let dataLineCount = 0;
    let commentCount = 0;

    for (let i = 0; i < lines.length; i++) {
        const rawLine = lines[i];
        const trimmed = rawLine.trim();

        if (!trimmed || trimmed.startsWith('#')) {
            fixedLines.push(rawLine);
            if (trimmed.startsWith('#')) commentCount++;
            continue;
        }

        dataLineCount++;
        const fields = rawLine.split('\t');

        if (fields.length < 7) {
            console.warn(`[repairCookiesFile] Line ${i + 1}: only ${fields.length} fields (need 7)  skipping line`);
            continue;
        }

        const domain = fields[0];
        const flag = fields[1];
        let correctedFlag = flag;

        const hasLeadingDot = domain.startsWith('.');
        const expectedFlag = hasLeadingDot ? 'TRUE' : 'FALSE';

        if (flag !== expectedFlag) {
            correctedFlag = expectedFlag;
            fixedCount++;
            console.log(`[repairCookiesFile] Line ${i + 1}: domain="${domain}" flag="${flag}"  "${correctedFlag}"`);
        }

        fields[1] = correctedFlag;
        fixedLines.push(fields.join('\t'));
    }

    if (fixedCount === 0) {
        console.log(`[repairCookiesFile]  No format issues found  file is already valid`);
        return {
            repaired: false,
            reason: 'No issues found',
            totalLines: dataLineCount,
            commentCount
        };
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const backupPath = cookiePath + '.bak.' + timestamp;
    try {
        fs.copyFileSync(cookiePath, backupPath);
        console.log(`[repairCookiesFile]  Backup created: ${backupPath}`);
    } catch (err) {
        console.error(`[repairCookiesFile]  Failed to create backup: ${err.message}`);
        return { repaired: false, reason: 'Backup failed: ' + err.message };
    }

    try {
        fs.writeFileSync(cookiePath, fixedLines.join('\n'), 'utf8');
        invalidateCookiesFileCache();
        console.log(`[repairCookiesFile]  Repaired ${fixedCount} cookie line(s)  file saved`);
        return {
            repaired: true,
            fixedCount,
            totalLines: dataLineCount,
            commentCount,
            backupPath
        };
    } catch (err) {
        console.error(`[repairCookiesFile]  Failed to write repaired file: ${err.message}`);
        return { repaired: false, reason: 'Write failed: ' + err.message };
    }
}

function autoExtractCookiesViaPython(options = {}) {
    return new Promise((resolve) => {
        const browser = options.browser || 'auto';
        const cookiePath = AUTH_CONFIG.cookieFilePath;

        const scriptCandidates = [
            path.join(__dirname, 'extract_cookies.py'),
            path.join(__dirname, '..', 'extract_cookies.py'),
            path.join(__dirname, '.extract_cookies.py'),
            path.join(__dirname, '..', '.extract_cookies.py'),
        ];
        let scriptPath = null;
        for (const candidate of scriptCandidates) {
            if (fs.existsSync(candidate)) {
                scriptPath = candidate;
                break;
            }
        }

        if (!scriptPath) {
            resolve({
                success: false,
                error: 'extract_cookies.py not found. Place it next to server.js or in the project root.',
                searchedPaths: scriptCandidates
            });
            return;
        }

        console.log(`[AutoExtract]  Spawning extract_cookies.py (browser=${browser})`);
        console.log(`[AutoExtract]    Script: ${scriptPath}`);
        console.log(`[AutoExtract]    Output: ${cookiePath}`);

        const pyArgs = [scriptPath, '--cookie-path', cookiePath, '--browser', browser];

        const pyCandidates = process.platform === 'win32'
            ? ['python', 'python3', 'py']
            : ['python3', 'python'];
        let pyIdx = 0;

        const tryPython = () => {
            if (pyIdx >= pyCandidates.length) {
                resolve({
                    success: false,
                    error: 'Python not found in PATH. Install Python 3.x and add it to PATH.',
                    triedCommands: pyCandidates
                });
                return;
            }

            const pyCmd = pyCandidates[pyIdx];
            pyIdx++;

            const fullArgs = pyCmd === 'py' ? ['-3', ...pyArgs] : pyArgs;

            console.log(`[AutoExtract] Trying: ${pyCmd} ${fullArgs.join(' ')}`);

            const proc = spawn(pyCmd, fullArgs, {
                stdio: ['pipe', 'pipe', 'pipe'],
                shell: false,
                windowsHide: true,
                cwd: __dirname
            });

            let stdout = '';
            let stderr = '';
            let settled = false;

            proc.stdout.on('data', (data) => {
                const text = data.toString();
                stdout += text;
                text.split('\n').forEach(line => {
                    if (line.trim()) console.log(`[AutoExtract]  ${line.trim()}`);
                });
            });

            proc.stderr.on('data', (data) => {
                stderr += data.toString();
            });

            proc.on('error', (err) => {
                if (err.code === 'ENOENT') {
                    console.log(`[AutoExtract] ${pyCmd} not found, trying next...`);
                    tryPython();
                } else {
                    if (!settled) {
                        settled = true;
                        resolve({ success: false, error: `Spawn error: ${err.message}`, stderr });
                    }
                }
            });

            proc.on('close', (code) => {
                if (settled) return;
                settled = true;

                if (code === 0) {
                    console.log(`[AutoExtract]  Python script completed successfully`);
                    invalidateCookiesFileCache();
                    if (fs.existsSync(cookiePath)) {
                        const stats = fs.statSync(cookiePath);
                        console.log(`[AutoExtract]  cookies.txt created: ${stats.size} bytes`);
                        resolve({
                            success: true,
                            output: stdout,
                            cookiePath,
                            sizeBytes: stats.size
                        });
                    } else {
                        resolve({
                            success: false,
                            error: 'Python script exited 0 but cookies.txt was not created',
                            output: stdout
                        });
                    }
                } else {
                    const errText = stderr || stdout;
                    if (errText.includes('No module named') || errText.includes('browser_cookie3')) {
                        resolve({
                            success: false,
                            error: 'browser_cookie3 Python package not installed. Run: pip install browser_cookie3',
                            installCommand: 'pip install browser_cookie3',
                            stderr: errText
                        });
                    } else {
                        resolve({
                            success: false,
                            error: `Python script exited with code ${code}`,
                            output: stdout,
                            stderr: errText
                        });
                    }
                }
            });

            setTimeout(() => {
                if (settled) return;
                try { proc.kill('SIGTERM'); } catch (e) {}
                settled = true;
                resolve({
                    success: false,
                    error: 'Python script timed out after 60 seconds',
                    output: stdout
                });
            }, 60000);
        };

        tryPython();
    });
}

// =============================================================================
// STRATEGY 4  Refresh cookies via Edge browse (auto-recovery)
// =============================================================================

const STRATEGY4_COOLDOWN_MS = 5 * 60 * 1000;
let _strategy4LastRunAt = 0;
let _strategy4InProgress = false;

function getEdgeBinaryPath() {
    const candidates = process.platform === 'win32'
        ? [
            'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
            'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
        ]
        : process.platform === 'darwin'
            ? ['/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge']
            : ['/usr/bin/microsoft-edge', '/usr/bin/microsoft-edge-stable', '/usr/bin/microsoft-edge-dev'];
    return candidates.find(p => {
        try { return fs.existsSync(p); } catch { return false; }
    }) || null;
}

function getEdgeUserDataDir() {
    const home = os.homedir();
    if (process.platform === 'win32') {
        const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
        return path.join(localAppData, 'Microsoft', 'Edge', 'User Data');
    }
    if (process.platform === 'darwin') {
        return path.join(home, 'Library', 'Application Support', 'Microsoft Edge');
    }
    return path.join(home, '.config', 'microsoft-edge');
}

function isEdgeRunning() {
    try {
        if (process.platform === 'win32') {
            const out = execSync('tasklist /FI "IMAGENAME eq msedge.exe" /NH',
                { encoding: 'utf-8', windowsHide: true, timeout: 5000 });
            return /msedge\.exe/i.test(out);
        }
        const cmd = process.platform === 'darwin'
            ? 'pgrep -x "Microsoft Edge" || pgrep -x "Microsoft Edge Helper"'
            : 'pgrep -x "msedge" || pgrep -x "microsoft-edge" || pgrep -x "microsoft-edge-stable"';
        const out = execSync(cmd, { encoding: 'utf-8', timeout: 5000 });
        return out.trim().length > 0;
    } catch {
        return false;
    }
}

async function refreshCookiesViaEdgeBrowse({ force = false } = {}) {
    if (_strategy4InProgress) {
        return { success: false, reason: 'already_in_progress' };
    }

    if (!force && process.env.YTL_STRATEGY4_ENABLED === '0') {
        console.log('[Strategy4]  Disabled by env var YTL_STRATEGY4_ENABLED=0');
        return { success: false, reason: 'disabled_by_env' };
    }

    const elapsed = Date.now() - _strategy4LastRunAt;
    if (!force && elapsed < STRATEGY4_COOLDOWN_MS) {
        const remaining = Math.ceil((STRATEGY4_COOLDOWN_MS - elapsed) / 1000);
        console.log(`[Strategy4]  Cooldown active  ${remaining}s left, skipping browse step`);
        return {
            success: false,
            reason: 'cooldown',
            cooldownSecondsLeft: remaining,
            message: `Strategy 4 cooldown (${remaining}s left). Retrying with current cookies.txt.`
        };
    }

    if (process.platform === 'linux'
        && !process.env.DISPLAY
        && !process.env.WAYLAND_DISPLAY) {
        console.log('[Strategy4]  No DISPLAY/WAYLAND_DISPLAY  skipping on headless Linux');
        return { success: false, reason: 'headless_linux' };
    }

    const edgePath = getEdgeBinaryPath();
    if (!edgePath) {
        console.log('[Strategy4]  Microsoft Edge binary not found on this system');
        return { success: false, reason: 'edge_not_installed' };
    }

    const userDataDir = getEdgeUserDataDir();
    if (!fs.existsSync(userDataDir)) {
        console.log(`[Strategy4]  Edge user data dir not found: ${userDataDir}`);
        return { success: false, reason: 'edge_profile_missing' };
    }

    if (isEdgeRunning()) {
        const msg = 'Microsoft Edge is already running. Close all Edge windows and retry  Strategy 4 cannot acquire the profile lock while Edge is open.';
        console.log('[Strategy4]  ' + msg);
        return { success: false, reason: 'edge_already_open', message: msg };
    }

    let playwright;
    try {
        playwright = require('playwright');
    } catch {
        console.log('[Strategy4]  playwright is not installed (run: npm i playwright)');
        return { success: false, reason: 'playwright_not_installed' };
    }

    _strategy4InProgress = true;
    console.log('[Strategy4]  Launching Edge (headed, persistent profile)...');

    let context;
    try {
        context = await playwright.chromium.launchPersistentContext(userDataDir, {
            channel: 'msedge',
            executablePath: edgePath,
            headless: false,
            viewport: { width: 1280, height: 720 },
            locale: 'en-US',
            timeout: 60_000
        });
    } catch (err) {
        _strategy4InProgress = false;
        console.error('[Strategy4]  Edge launch failed:', err.message);
        return { success: false, reason: 'launch_failed', error: err.message };
    }

    try {
        const page = await context.newPage();

        console.log('[Strategy4]  Navigating to https://www.youtube.com');
        await page.goto('https://www.youtube.com', { waitUntil: 'domcontentloaded', timeout: 30_000 });

        await page.waitForSelector('ytd-rich-item-renderer', { timeout: 15_000 });

        const videoHrefs = await page.$$eval(
            'a[href^="/watch?v="]',
            links => links.slice(0, 40).map(a => a.href)
        );

        if (!videoHrefs.length) {
            console.log('[Strategy4]  No video links found on YouTube homepage');
            return { success: false, reason: 'no_videos_on_homepage' };
        }

        const randomUrl = videoHrefs[Math.floor(Math.random() * videoHrefs.length)];
        console.log(`[Strategy4]  Random video: ${randomUrl}`);

        await page.goto(randomUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });

        console.log('[Strategy4]  Waiting 8s for cookie rotation XHRs...');
        await page.waitForTimeout(8_000);

        console.log('[Strategy4]  Closing Edge (flushing cookie DB to disk)');
        await context.close();
        context = null;

        await new Promise(r => setTimeout(r, 1500));
    } catch (err) {
        console.error('[Strategy4]  Browse step failed:', err.message);
        try { if (context) await context.close(); } catch {}
        _strategy4InProgress = false;
        return { success: false, reason: 'browse_failed', error: err.message };
    }

    console.log('[Strategy4]  Spawning extract_cookies.py to re-extract cookies.txt');
    const extractResult = await autoExtractCookiesViaPython({ browser: 'edge' });

    _strategy4InProgress = false;
    _strategy4LastRunAt = Date.now();

    if (!extractResult.success) {
        console.error('[Strategy4]  Cookie extraction failed:',
            extractResult.error || 'unknown');
        return { success: false, reason: 'extract_failed', error: extractResult.error };
    }

    const validNow = isCookiesFileValid(true);
    console.log(`[Strategy4] ${validNow ? '' : ''} cookies.txt is ${validNow ? 'valid' : 'invalid format'} after refresh`);

    return {
        success: validNow,
        reason: validNow ? 'refreshed' : 'extracted_but_invalid',
        cookiePath: extractResult.cookiePath,
        criticalCookiesPresent: validNow
    };
}

// =============================================================================
//  FIX #1: Correct Strategy 3 command  use --cookies-from-browser, no path
//  FIX #2: Inject --js-runtimes node into every string-based command
// =============================================================================
function buildCommandsWithCookieStrategies(baseUrl, url) {
    console.log('\n[buildCommands] Building command strategies...');
    console.log('[buildCommands] Input URL:', url);

    getNativeCookiePath();

    //  FIX #2: Ensure the base command has global flags
    const baseUrlWithFlags = withGlobalFlags(baseUrl);

    const strategies = [];

    // Strategy 1: No cookies at all (works for most public channels!)
    const noCookiesCmd = baseUrlWithFlags + ' "' + url + '"';
    strategies.push({
        cmd: noCookiesCmd,
        description: 'No cookies (public access)',
        type: 'none'
    });
    console.log('[commands] Strategy 1: No cookies (fastest, works for public channels)');

    // Strategy 2: Use cookies.txt if available and looks valid
    const cookiesValid = isCookiesFileValid(false);
    if (cookiesValid && fs.existsSync(AUTH_CONFIG.cookieFilePath)) {
        const cookiesCmd = baseUrlWithFlags + ' --cookies "' + AUTH_CONFIG.cookieFilePath + '" "' + url + '"';
        strategies.push({
            cmd: cookiesCmd,
            description: 'cookies.txt file',
            type: 'file'
        });
        console.log('[commands] Strategy 2: cookies.txt file');
    } else {
        console.log('[commands] Strategy 2: SKIPPED (cookies.txt invalid or missing)');
    }

    //  FIX #1: Strategy 3  correct flag, NO hardcoded path
    const browser = AUTH_CONFIG.browserName || 'edge';
    const browserCmd = baseUrlWithFlags + ' --cookies /c/Program Files (x86)/multi-channel-ytl/server/cookies.txt' + browser + ' "' + url + '"';
    strategies.push({
        cmd: browserCmd,
        description: `Browser (${browser})`,
        type: 'browser'
    });
    console.log('[commands] Strategy 3: Browser fallback (' + browser + ')');

    // Strategy 4: Refresh cookies via Edge browse (sentinel)
    strategies.push({
        cmd: '__STRATEGY4_REFRESH__',
        description: 'Refresh cookies via Edge browse (Strategy 4)',
        type: 'refresh',
        baseUrl: baseUrlWithFlags,
        url: url
    });
    console.log('[commands] Strategy 4: Refresh cookies via Edge browse (auto-recovery)');

    console.log('[commands] Total strategies prepared:', strategies.length);
    return strategies;
}

function executeWithRetry(strategies, currentIndex, onSuccess, onError) {
    if (currentIndex >= strategies.length) {
        onError(new Error('All cookie strategies failed'));
        return;
    }

    const strategy = strategies[currentIndex];

    if (strategy.type === 'refresh') {
        if (strategy._consumed) {
            console.log('[executeWithRetry]  Strategy 4 already consumed in this chain  skipping past');
            executeWithRetry(strategies, currentIndex + 1, onSuccess, onError);
            return;
        }
        strategy._consumed = true;

        console.log('\n[executeWithRetry]  Strategy 4: Refreshing cookies via Edge browse...');
        refreshCookiesViaEdgeBrowse().then(result => {
            if (result.success) {
                console.log('[executeWithRetry]  Strategy 4 refresh succeeded  retrying Strategy 2 (cookies.txt)');

                const baseUrl = strategy.baseUrl;
                const url = strategy.url;
                const freshStrategies = buildCommandsWithCookieStrategies(baseUrl, url);

                const freshRefreshIdx = freshStrategies.findIndex(s => s.type === 'refresh');
                if (freshRefreshIdx >= 0) {
                    freshStrategies[freshRefreshIdx]._consumed = true;
                }

                const strat2Idx = freshStrategies.findIndex(s => s.type === 'file');
                if (strat2Idx >= 0) {
                    executeWithRetry(freshStrategies, strat2Idx, onSuccess, onError);
                } else {
                    console.error('[executeWithRetry]  Strategy 4 reported success but cookies.txt still invalid');
                    onError(new Error('Strategy 4 succeeded but cookies.txt is still invalid'));
                }
            } else if (result.reason === 'cooldown') {
                console.log(`[executeWithRetry]  Strategy 4 cooldown  retrying Strategy 2 with current cookies.txt (${result.cooldownSecondsLeft}s left in cooldown)`);
                const freshStrategies = buildCommandsWithCookieStrategies(strategy.baseUrl, strategy.url);

                const freshRefreshIdx = freshStrategies.findIndex(s => s.type === 'refresh');
                if (freshRefreshIdx >= 0) {
                    freshStrategies[freshRefreshIdx]._consumed = true;
                }

                const strat2Idx = freshStrategies.findIndex(s => s.type === 'file');
                if (strat2Idx >= 0) {
                    executeWithRetry(freshStrategies, strat2Idx, onSuccess, onError);
                } else {
                    onError(new Error('Strategy 4 cooldown + cookies.txt still missing'));
                }
            } else {
                console.error('[executeWithRetry]  Strategy 4 failed (' + result.reason + ')');
                if (result.message) console.error('[executeWithRetry] ' + result.message);
                if (result.error) console.error('[executeWithRetry] Detail:', result.error);
                onError(new Error('Strategy 4 (' + result.reason + '): all cookie strategies failed'));
            }
        }).catch(err => {
            console.error('[executeWithRetry]  Strategy 4 unexpected error:', err.message);
            onError(err);
        });
        return;
    }

    console.log('\n[executeWithRetry] Trying strategy', currentIndex + 1, '/', strategies.length + ':', strategy.description);
    console.log('[executeWithRetry] Command:', strategy.cmd.substring(0, 150) + '...');

    const startTime = Date.now();

    exec(strategy.cmd, {
        maxBuffer: 500 * 1024 * 1024,   // bumped from 50 MB  prevents
                                        // "maxBuffer length exceeded" on
                                        // large metadata/format outputs
        encoding: 'utf-8'
    }, (error, stdout, stderr) => {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

        if (error) {
            console.log('[executeWithRetry]  Strategy', currentIndex + 1, 'failed in', elapsed, 's:', strategy.description);

            const isCookieError =
                error.message.includes('invalid Netscape format') ||
                error.message.includes('CookieLoadError') ||
                error.message.includes('failed to load cookies') ||
                error.message.includes('DPAPI') ||
                error.message.includes('decrypt') ||
                stderr.includes('invalid Netscape') ||
                stderr.includes('DPAPI') ||
                stderr.includes('decrypt');

            if (isCookieError && currentIndex < strategies.length - 1) {
                console.log('[executeWithRetry]  Cookie-related error detected, trying next strategy...');
                if (stderr) {
                    const firstLine = stderr.split('\n').find(l => l.trim().startsWith('ERROR:'));
                    if (firstLine) console.log('[executeWithRetry] Error hint:', firstLine.trim());
                }
                executeWithRetry(strategies, currentIndex + 1, onSuccess, onError);
                return;
            }

            console.log('[executeWithRetry]  All strategies exhausted or non-recoverable error');
            if (stderr) {
                console.log('[executeWithRetry] Final error (first 500 chars):', stderr.substring(0, 500));
            }
            onError(error);
        } else {
            console.log('[executeWithRetry]  Strategy', currentIndex + 1, 'succeeded in', elapsed, 's:', strategy.description);
            onSuccess(stdout);
        }
    });
}

// =============================================================================
//  FIX #10: DOWNLOADS_DIR is MUTABLE so PUT /api/settings actually works
// =============================================================================
const PORT = process.env.PORT || 3000;

function getDefaultDownloadsDir() {
    if (process.env.DOWNLOADS_DIR) return process.env.DOWNLOADS_DIR;

    const osName = process.platform;
    if (osName === 'win32') {
        const username = process.env.USERNAME || process.env.USER || 'User';
        return `C:\\Users\\${username}\\Downloads\\YouTube-Downloader`;
    } else if (osName === 'darwin') {
        const home = process.env.HOME || '/Users/' + (process.env.USER || 'user');
        return path.join(home, 'Downloads', 'YouTube-Downloader');
    } else {
        const home = process.env.HOME || process.cwd();
        const downloadsPath = path.join(home, 'Downloads', 'YouTube-Downloader');
        try {
            if (fs.existsSync(downloadsPath)) return downloadsPath;
        } catch (e) {}
        return path.join(process.cwd(), 'downloads');
    }
}

let DOWNLOADS_DIR = getDefaultDownloadsDir();

function getChannelDownloadDir(channelName) {
    const safeChannelName = (channelName || 'Unknown_Channel')
        .replace(/[:"/\\|?*]/g, '_')
        .replace(/\s+/g, '_')
        .substring(0, 100);

    const channelDir = path.join(DOWNLOADS_DIR, safeChannelName);

    if (!fs.existsSync(channelDir)) {
        fs.mkdirSync(channelDir, { recursive: true });
        console.log('[Init] Created channel directory:', channelDir);
    }

    return channelDir;
}

const SINGLE_FILE_DIR_NAME = 'Single-File';
function getSingleFileDir() {
    const singleDir = path.join(DOWNLOADS_DIR, SINGLE_FILE_DIR_NAME);

    if (!fs.existsSync(singleDir)) {
        fs.mkdirSync(singleDir, { recursive: true });
        console.log('[Init] Created Single-File directory:', singleDir);
    }

    return singleDir;
}

if (!fs.existsSync(DOWNLOADS_DIR)) {
    fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
    console.log('[Init] Created downloads directory:', DOWNLOADS_DIR);
}

// =============================================================================
// PERSISTENT DATABASE STORAGE
// =============================================================================

const sqliteDb = require('./db/database');
const savedChannels = new Map();
let initialDiskSyncDone = false;

const _inFlightDownloadUrls = new Set();

//  FIX: _activeDownloadIds moved ABOVE any function that references it
// =============================================================================
// Recently-downloaded channel tracker
// =============================================================================
const RECENT_DOWNLOAD_WINDOW_MS = 5 * 60 * 1000;   // 5 minutes
const _recentlyDownloadedChannels = new Map();     // channelId -> last-download-timestamp

function markChannelRecentlyDownloaded(channelId) {
    if (!channelId) return;
    _recentlyDownloadedChannels.set(channelId, Date.now());
}

function getRecentlyDownloadedChannelIds() {
    const now = Date.now();
    const ids = [];
    for (const [id, ts] of _recentlyDownloadedChannels.entries()) {
        if (now - ts <= RECENT_DOWNLOAD_WINDOW_MS) ids.push(id);
        else _recentlyDownloadedChannels.delete(id);
    }
    return ids;
}

const _activeDownloadIds = new Set();

function loadDatabase() {
    try {
        const channels = sqliteDb.loadDatabase();
        for (const [id, ch] of channels.entries()) {
            savedChannels.set(id, ch);
        }
        console.log(`[Database] Loaded ${savedChannels.size} channels from SQLite.`);
    } catch (e) {
        console.error('[Database] Failed to load from SQLite:', e.message);
    }
}

function saveDatabase() {
    try {
        sqliteDb.saveAllChannels(savedChannels);
    } catch (e) {
        console.error('[Database] Failed to save to SQLite:', e.message);
    }
}

loadDatabase();

// =============================================================================
// SERVER LOG BUFFER
// =============================================================================
const serverLogBuffer = [];
const MAX_SERVER_LOGS = 500;

// =============================================================================
// DETAIL LOG PATTERNS  these stay in the 1.bat terminal but are FILTERED OUT
// of the browser's Server Terminal tab (they'd be too noisy)
// =============================================================================
const DETAIL_LOG_PATTERNS = [
    /^\[download\]/,                             // yt-dlp progress: [download] 45.2% of ...
    /^\[Execute Download\] Cookie strategy/,     // verbose strategy logging
    /^\[Execute Download\] Command:/,
    /^\[Execute Download\] \U0001f6e1\ufe0f/,   //  emoji line
    /^\[Execute Download\] Temp file/,
    /^\[Execute Download\] Format:/,
    /^\[Format Analyzer\]/,
    /^\[AutoExtract\]/,
    /^\[BatchUploadDate\]/,
    /^\[ParallelBatch\]/,
    /^\[commands\]/,
    /^\[buildCommands\]/,
    /^\[isCookiesFileValid\]/,
    /^\[Path Conversion\]/,
    /^\[Disk Scan\]/,
    /^\[fetchChannelInfo\]/,
    /^\[UploadDate\]/,
    /^\[Rename\] /,
    /^\[Smart Download\]/,
    /^\[repairCookiesFile\]/,
    /^\[ensureUniqueOnDisk\]/,
    /^\[Database\] SQLite/,
    /^\[findIndexHtml\]/,
    /^\[Settings\] \U0001f4c1/,                  //  emoji line
    /^\[Cookie Path\]/,
    /^\[Init\] /,
    /^\[Startup\] /,
    /^\[Root Route\]/,
    /^\[SSE\] /,
    /^\[Save Channels\]/,
    /^\[Sync\] /,
    /^\[Sync All\]/,
    /^\[Queue\]/,
    /^\[LogSync\]/,
    /^\[Update DB\] /,
    /^\[\d{4}-\d{2}-\d{2}/,                    // lines starting with [YYYY-MM-DD timestamp]
    /^  \| /,                                     // indented log fragments
    /^\s+->/,                                     // indented arrow lines
];

function isDetailOnlyLog(message) {
    return DETAIL_LOG_PATTERNS.some(p => p.test(message));
}

const originalConsoleLog = console.log;
console.log = function(...args) {
    originalConsoleLog.apply(console, args);

    const timestamp = new Date().toISOString();
    const message = args.map(arg => {
        if (typeof arg === 'object') {
            try { return JSON.stringify(arg, null, 2); } catch (e) { return String(arg); }
        }
        return String(arg);
    }).join(' ');

    // \u2b50 Filter out detail-only lines from the browser Server Terminal tab
    if (isDetailOnlyLog(message)) {
        return;
    }

    serverLogBuffer.push({
        time: timestamp,
        message: message,
        type: message.includes('\u274c') || message.includes('ERROR') ? 'error' :
              message.includes('\u2705') || message.includes('success') ? 'success' :
              message.includes('\u26a0\ufe0f') || message.includes('warning') ? 'warning' :
              message.includes('\u2b07\ufe0f') || message.includes('\u25b6\ufe0f') ? 'progress' : 'info'
    });

    if (serverLogBuffer.length > MAX_SERVER_LOGS) {
        serverLogBuffer.shift();
    }
};

const originalConsoleError = console.error;
console.error = function(...args) {
    originalConsoleError.apply(console, args);

    const timestamp = new Date().toISOString();
    const message = args.map(arg => String(arg)).join(' ');

    // Detail-only errors are still filtered (they show in the 1.bat terminal)
    if (isDetailOnlyLog(message)) {
        return;
    }

    serverLogBuffer.push({
        time: timestamp,
        message: '[ERROR] ' + message,
        type: 'error'
    });

    if (serverLogBuffer.length > MAX_SERVER_LOGS) {
        serverLogBuffer.shift();
    }
};

const downloadManager = {
    downloads: new Map(),

    add(download) {
        this.downloads.set(download.id, download);
        return download;
    },

    get(id) {
        return this.downloads.get(id);
    },

    update(id, updates) {
        const download = this.downloads.get(id);
        if (download) Object.assign(download, updates);
        return download;
    },

    remove(id) {
        return this.downloads.delete(id);
    },

    getAll() {
        return Array.from(this.downloads.values());
    },

    getActive() {
        return this.getAll().filter(d => d.status === 'downloading' || d.status === 'queued');
    },

    getCompleted() {
        return this.getAll().filter(d => d.status === 'completed' || d.status === 'skipped');
    }
};

// =============================================================================
// DOWNLOAD QUEUE MANAGER
//  FIX: Moved ABOVE route handlers so it's not in the temporal dead zone.
// =============================================================================

const downloadQueue = {
    maxConcurrent: 2,
    maxVisibleQueue: 25,
    replenishThreshold: 5,
    activeJobs: [],
    queue: [],
    pendingBuffer: [],
    _pausedByNetwork: false,

    pauseForNetwork() {
        if (this._pausedByNetwork) return;
        this._pausedByNetwork = true;

        console.log('\n[Download Queue] \u23f8\ufe0f  NETWORK OFFLINE - pausing all downloads');

        const killedIds = [];
        for (const [downloadId, entry] of activeChildProcesses.entries()) {
            try {
                entry.proc.kill('SIGTERM');
                killedIds.push(downloadId);
            } catch (e) {
                console.warn('[Download Queue] Failed to kill proc for ' + downloadId + ':', e.message);
            }
        }
        activeChildProcesses.clear();

        const jobsToRequeue = [];
        for (const job of this.activeJobs) {
            const dl = downloadManager.get(job.downloadId);
            if (!dl) continue;
            if (dl.status === 'downloading' || dl.status === 'queued') {
                downloadManager.update(job.downloadId, {
                    status: 'queued',
                    progress: 0,
                    networkPaused: true,
                    networkPausedAt: new Date().toISOString()
                });
                jobsToRequeue.push(job);
            }
        }

        for (let i = jobsToRequeue.length - 1; i >= 0; i--) {
            this.queue.unshift(jobsToRequeue[i]);
        }
        this.activeJobs = [];

        for (const job of jobsToRequeue) {
            try {
                const outputDir = path.dirname(job.outputPath);
                const tempBase = 'ytl_' + job.downloadId;
                for (const f of fs.readdirSync(outputDir)) {
                    if (f.startsWith(tempBase)) {
                        try {
                            fs.unlinkSync(path.join(outputDir, f));
                            console.log('[Download Queue] \ud83e\uddf9 Cleaned partial: ' + f);
                        } catch {}
                    }
                }
            } catch {}
        }

        console.log('[Download Queue] \ud83d\udce6 Requeued ' + jobsToRequeue.length + ' job(s). Killed ' + killedIds.length + ' process(es).');
    },

    resumeFromNetwork() {
        if (!this._pausedByNetwork) return;
        this._pausedByNetwork = false;

        console.log('\n[Download Queue] \u25b6\ufe0f  NETWORK ONLINE - resuming downloads');

        for (const dl of downloadManager.getAll()) {
            if (dl.networkPaused) {
                downloadManager.update(dl.id, { networkPaused: false });
            }
        }

        this.processStuckQueue();
    },

    isPausedByNetwork() {
        return this._pausedByNetwork;
    },

    replenishQueue() {
        if (this._pausedByNetwork) return;
        if (this.pendingBuffer.length === 0) return;

        const currentVisible = this.activeJobs.length + this.queue.length;
        if (currentVisible <= this.replenishThreshold) {
            const needed = this.maxVisibleQueue - currentVisible;
            if (needed <= 0) return;

            const toMove = this.pendingBuffer.splice(0, needed);
            console.log(`[Download Queue]  Queue reached ${currentVisible} (<= ${this.replenishThreshold}). Replenishing ${toMove.length} videos from pending pool.`);

            toMove.forEach(job => {
                this.queue.push(job);
                downloadManager.update(job.downloadId, { status: 'queued' });
            });
        }
    },

    enqueue(downloadId, videoUrl, outputPath, videoTitle) {
        const job = { downloadId, videoUrl, outputPath, videoTitle, startedAt: null };

        console.log(`\n[Download Queue]  Job added: ${videoTitle?.substring(0, 30)}...`);

        if (this.activeJobs.length < this.maxConcurrent) {
            console.log(`[Download Queue]  Starting immediately (slot ${this.activeJobs.length + 1}/${this.maxConcurrent})`);
            this.executeJob(job);
        } else if (this.activeJobs.length + this.queue.length < this.maxVisibleQueue) {
            this.queue.push(job);
            console.log(`[Download Queue]  Queued at visible position #${this.queue.length}`);
            downloadManager.update(downloadId, { status: 'queued' });
        } else {
            this.pendingBuffer.push(job);
            console.log(`[Download Queue]  Buffered (total buffered: ${this.pendingBuffer.length})`);
            downloadManager.update(downloadId, { status: 'queued' });
        }
    },

    executeJob(job) {
        const { downloadId, videoUrl, outputPath, videoTitle } = job;

        const alreadyActive = this.activeJobs.find(j => j.downloadId === downloadId);
        if (alreadyActive) {
            console.log(`[Download Queue]  DUPLICATE EXECUTION BLOCKED: ${videoTitle?.substring(0, 30)}...`);
            return;
        }

        job.startedAt = Date.now();
        this.activeJobs.push(job);

        downloadManager.update(downloadId, { status: 'downloading', startTime: Date.now() });

        console.log(`[Download Queue]  Job STARTED: ${videoTitle?.substring(0, 30)}...`);
        console.log(`[Download Queue] Active jobs: ${this.activeJobs.length} | Visible queue: ${this.queue.length} | Buffered: ${this.pendingBuffer.length}`);

        executeSmartDownload(downloadId, videoUrl, outputPath, videoTitle)
            .then(() => {
                console.log(`[Download Queue]  Job completed: ${videoTitle?.substring(0, 30)}...`);
                _inFlightDownloadUrls.delete(videoUrl);

                const _dlJustFinished = downloadManager.get(downloadId);
                if (_dlJustFinished && _dlJustFinished.channelId) {
                    markChannelRecentlyDownloaded(_dlJustFinished.channelId);
                }
            })
            .catch((err) => {
                console.error(`[Download Queue]  Job failed: ${videoTitle?.substring(0, 30)}... -`, err?.message);
                _inFlightDownloadUrls.delete(videoUrl);

                try {
                    const outputDir = path.dirname(outputPath);
                    const tempFile = path.join(outputDir, `ytl_${downloadId}.mp4`);
                    const partialFile = path.join(outputDir, `ytl_${downloadId}.mp4.part`);

                    [tempFile, partialFile, outputPath].forEach(file => {
                        if (fs.existsSync(file)) {
                            fs.unlinkSync(file);
                            console.log(`[Download Queue]  Cleaned up failed file: ${path.basename(file)}`);
                        }
                    });
                } catch (cleanupErr) {
                    console.warn(`[Download Queue]  Cleanup failed:`, cleanupErr.message);
                }
            })
            .finally(() => {
                this.onJobComplete(job);
            });
    },

    onJobComplete(completedJob) {
        if (completedJob) {
            const idx = this.activeJobs.findIndex(j => j.downloadId === completedJob.downloadId);
            if (idx !== -1) {
                this.activeJobs.splice(idx, 1);
                console.log(`[Download Queue]  Removed from active: ${completedJob.videoTitle?.substring(0, 30)}...`);

                const _dlCompleted = downloadManager.get(completedJob.downloadId);
                if (_dlCompleted && _dlCompleted.channelId) {
                    markChannelRecentlyDownloaded(_dlCompleted.channelId);
                    console.log(`[Download Queue] Marked channel ${_dlCompleted.channelId} as recently-downloaded`);
                }
            } else {
                console.log(`[Download Queue]  Job already removed from active`);
                return;
            }
        }

        this.replenishQueue();

        console.log(`\n[Download Queue]  Status: Active=${this.activeJobs.length}/${this.maxConcurrent} | Visible Queue=${this.queue.length} | Buffered=${this.pendingBuffer.length}`);

        if (this.queue.length > 0 && this.activeJobs.length < this.maxConcurrent) {
            //  PATCH: jittered 1530s delay (was fixed 5s) to avoid 403 storms
            const _delayMs = 15000 + Math.floor(Math.random() * 15000);
            console.log(`[Download Queue]  Waiting ${Math.round(_delayMs / 1000)}s before starting next download...`);
            setTimeout(() => {
                if (this._pausedByNetwork) {
                    console.log('[Download Queue] \u23f8\ufe0f Skipping scheduled start - network paused');
                    return;
                }
                if (this.queue.length === 0 || this.activeJobs.length >= this.maxConcurrent) return;

                const nextJob = this.queue.shift();

                if (!nextJob) {
                    console.log('[Download Queue]  Next job is null, skipping');
                    return;
                }

                const alreadyRunning = this.activeJobs.find(j => j.downloadId === nextJob.downloadId);
                if (alreadyRunning) {
                    console.log(`[Download Queue]  Next job already running, skipping`);
                    return;
                }

                console.log(`[Download Queue]  Reserved slot and starting next in queue: ${nextJob.videoTitle?.substring(0, 30)}...`);
                console.log(`[Download Queue] Remaining in queue: ${this.queue.length} (buffered: ${this.pendingBuffer.length})`);

                this.executeJob(nextJob);
            }, _delayMs);

        } else if (this.queue.length === 0 && this.pendingBuffer.length === 0 && this.activeJobs.length === 0) {
            console.log('[Download Queue]  All downloads complete! Queue empty.');
        }
    },

    getStatus() {
        const activeDownloadDetails = this.activeJobs.map(job => {
            const dlInfo = downloadManager.get(job.downloadId);
            return {
                id: job.downloadId,
                title: job.videoTitle,
                status: 'downloading',
                progress: dlInfo?.progress || 0,
                speed: dlInfo?.speed || null,
                startedAt: job.startedAt
            };
        });

        return {
            maxConcurrent: this.maxConcurrent,
            active: this.activeJobs.length,
            queued: this.queue.length,
            pendingBuffer: this.pendingBuffer.length,
            totalQueued: this.queue.length + this.pendingBuffer.length,
            activeDownloads: activeDownloadDetails,
            queue: this.queue.map(job => ({
                id: job.downloadId,
                title: job.videoTitle,
                status: 'waiting',
                position: this.queue.indexOf(job) + 1
            }))
        };
    },

    clearQueue() {
        const clearedVisible = this.queue.length;
        const clearedPending = this.pendingBuffer.length;

        this.queue.forEach(job => {
            downloadManager.update(job.downloadId, { status: 'cancelled' });
        });
        this.pendingBuffer.forEach(job => {
            downloadManager.update(job.downloadId, { status: 'cancelled' });
        });

        this.queue = [];
        this.pendingBuffer = [];
        console.log(`[Download Queue]  Queue cleared (${clearedVisible + clearedPending} jobs removed)`);
        return clearedVisible + clearedPending;
    },

    removeFromQueue(downloadId) {
        const initQ = this.queue.length;
        const initP = this.pendingBuffer.length;

        this.queue = this.queue.filter(job => job.downloadId !== downloadId);
        this.pendingBuffer = this.pendingBuffer.filter(job => job.downloadId !== downloadId);

        const removed = (initQ !== this.queue.length) || (initP !== this.pendingBuffer.length);

        if (removed) {
            console.log(`[Download Queue]  Removed job ${downloadId} from queue/buffer`);
            this.replenishQueue();
        }

        return removed;
    },

    processStuckQueue() {
        if (this._pausedByNetwork) {
            console.log('[Download Queue] \u23f8\ufe0f processStuckQueue skipped - network paused');
            return;
        }
        this.replenishQueue();
        if (this.activeJobs.length < this.maxConcurrent && this.queue.length > 0) {
            console.log('[Download Queue]  Safety check: Found stuck jobs, processing...');
            while (this.activeJobs.length < this.maxConcurrent && this.queue.length > 0) {
                const nextJob = this.queue.shift();
                console.log(`[Download Queue]  Safety-starting: ${nextJob.videoTitle?.substring(0, 30)}...`);
                this.executeJob(nextJob);
            }
        }
    }
};

// =============================================================================
// SANITIZATION & DEDUPLICATION
// =============================================================================

function fallbackSanitize(filename) {
    if (!filename || !filename.trim()) return 'unnamed';

    let sanitized = filename;

    //  FIX: strip control characters (newlines, tabs, etc.)  illegal on Windows
    sanitized = sanitized.replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ');

    // Collapse runs of whitespace into single spaces
    sanitized = sanitized.replace(/\s+/g, ' ');

    sanitized = sanitized.replace(/[\\/*?:"<>|]/g, '_');
    sanitized = sanitized.replace(/[^\p{L}\p{N}\p{M}\s\._\-()]/gu, '-');
    sanitized = sanitized.trim().replace(/^[. ]+|[. ]+$/g, '');

    if (sanitized && (sanitized[0] === '_' || sanitized[0] === '-')) {
        sanitized = 'Z' + sanitized.slice(1);
    }

    const reserved = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\..*)?$/i;
    if (reserved.test(sanitized)) {
        sanitized = '_' + sanitized;
    }

    const maxLen = process.platform === 'win32' ? 180 : 230;
    if (sanitized.length > maxLen) {
        sanitized = sanitized.substring(0, maxLen);
    }

    return sanitized || 'unnamed';
}

function sanitizeViaPython(rawTitle) {
    return fallbackSanitize(rawTitle);
}

/**
 *  FIX: Detect temp-name leaks like
 * "ytl_a5e425a1-a924-43ca-a5ec-a003b21e541d_25-03-03--lRcDMCfFtzU.mp4"
 * and force a rename using the original title. Prevents the rename-skip path
 * in renameDownloadedFile() from ever leaving a ytl_<uuid> file on disk.
 */
function recoverFromTempNameLeak(filePath, downloadObj, outputDir) {
    const currentName = path.basename(filePath);
    const looksLikeTemp = /^ytl_[0-9a-f]{8}-[0-9a-f]{4}-/i.test(currentName);

    if (!looksLikeTemp) {
        return { path: filePath, filename: currentName, recovered: false };
    }

    const rawTitle = (downloadObj && (downloadObj.title || downloadObj.filename))
        ? String(downloadObj.title || downloadObj.filename).replace(/\.[^.]+$/, '')
        : null;

    if (!rawTitle) {
        console.warn(`[TempLeak]  Detected temp name "${currentName}" but no title available to recover from`);
        return { path: filePath, filename: currentName, recovered: false };
    }

    console.warn(`[TempLeak]  Detected temp-name leak: "${currentName}"  forcing rename from title`);

    let baseName = sanitizeViaPython(rawTitle);
    if (!baseName || baseName === 'unnamed') {
        baseName = `video_${Date.now()}`;
    }

    const maxBaseLen = process.platform === 'win32' ? 180 : 230;
    if (baseName.length > maxBaseLen) {
        baseName = baseName.substring(0, maxBaseLen);
    }

    baseName = baseName.replace(/_\d{2}-\d{2}-\d{2}(--[a-zA-Z0-9_-]{11})?$/, '');
    baseName = baseName.replace(/--[a-zA-Z0-9_-]{11}$/, '');

    const ext = path.extname(currentName) || '.mp4';
    const safeName = ensureUniqueOnDisk(outputDir, baseName + ext);
    const safePath = path.join(outputDir, safeName);

    try {
        fs.renameSync(filePath, safePath);
        console.log(`[TempLeak]  Recovered: "${currentName}"  "${safeName}"`);
        return { path: safePath, filename: safeName, recovered: true };
    } catch (err) {
        console.error(`[TempLeak]  Recovery rename failed:`, err.message);
        return { path: filePath, filename: currentName, recovered: false };
    }
}

// =============================================================================
// DATE STAMP HELPERS
// =============================================================================

function formatDateSuffixYYMMDD(yyyymmdd) {
    if (!yyyymmdd || typeof yyyymmdd !== 'string') return null;
    const m = yyyymmdd.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (!m) return null;
    return `_${m[1].slice(2)}-${m[2]}-${m[3]}`;
}

function hasDateStampSuffix(filename) {
    if (!filename) return false;
    return /_\d{2}-\d{2}-\d{2}(?:--[a-zA-Z0-9_-]{11})?\.(mp4|webm|mkv|m4a|mp3)$/i.test(filename) ||
           /_\d{2}-\d{2}-\d{2}(?:--[a-zA-Z0-9_-]{11})?$/i.test(filename);
}

function hasVideoIdSuffix(filename) {
    if (!filename) return false;
    return /--[a-zA-Z0-9_-]{11}\.(mp4|webm|mkv|m4a|mp3)$/i.test(filename);
}

function applyDateStampToFilename(filename, yyyymmdd, maxBaseLen, videoId) {
    if (maxBaseLen === undefined) {
        maxBaseLen = process.platform === 'win32' ? 200 : 230;
    }
    const dateSuffix = formatDateSuffixYYMMDD(yyyymmdd);
    if (!dateSuffix) return null;
    if (!filename) return null;

    let fullSuffix = dateSuffix;
    if (videoId && /^[a-zA-Z0-9_-]{6,}$/.test(videoId)) {
        fullSuffix = `${dateSuffix}--${videoId}`;
    }

    const lastDot = filename.lastIndexOf('.');
    const base = lastDot > 0 ? filename.slice(0, lastDot) : filename;
    const ext = lastDot > 0 ? filename.slice(lastDot) : '';

    if (hasVideoIdSuffix(base) && hasDateStampSuffix(base)) {
        return filename;
    }

    let cleanBase = base;
    if (hasDateStampSuffix(base) && !hasVideoIdSuffix(base)) {
        cleanBase = base.replace(/_\d{2}-\d{2}-\d{2}$/, '');
    }

    const trimmedBase = cleanBase.length > (maxBaseLen - fullSuffix.length)
        ? cleanBase.slice(0, maxBaseLen - fullSuffix.length)
        : cleanBase;

    return `${trimmedBase}${fullSuffix}${ext}`;
}

function getVideoUploadDateFromYouTube(videoId) {
    return new Promise((resolve) => {
        if (!videoId || !/^[a-zA-Z0-9_-]{6,}$/.test(videoId)) {
            console.warn(`[UploadDate]  Invalid videoId: ${videoId}`);
            resolve(null);
            return;
        }

        const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
        const cmd = `yt-dlp --dump-json --no-download`;
        const strategies = buildCommandsWithCookieStrategies(cmd, videoUrl);

        executeWithRetry(
            strategies,
            0,
            (stdout) => {
                try {
                    const trimmed = (stdout || '').trim().split('\n').filter(l => l.trim()).pop();
                    if (!trimmed) { resolve(null); return; }
                    const info = JSON.parse(trimmed);
                    const uploadDate = info.upload_date || null;
                    if (uploadDate && /^\d{8}$/.test(uploadDate)) {
                        console.log(`[UploadDate]  ${videoId}  upload_date=${uploadDate}`);
                        resolve(uploadDate);
                    } else {
                        console.warn(`[UploadDate]  ${videoId} no upload_date in metadata`);
                        resolve(null);
                    }
                } catch (err) {
                    console.error(`[UploadDate]  parse error for ${videoId}:`, err.message);
                    resolve(null);
                }
            },
            (error) => {
                console.error(`[UploadDate]  All strategies failed for ${videoId}:`, error.message);
                resolve(null);
            }
        );
    });
}

// =============================================================================
// BATCH UPLOAD DATE FETCH
// =============================================================================

function buildBatchCommandStrategies(baseArgs) {
    const strategies = [];

    strategies.push({
        args: baseArgs.slice(),
        description: 'No cookies (public access)',
        type: 'none'
    });

    if (isCookiesFileValid(false) && fs.existsSync(AUTH_CONFIG.cookieFilePath)) {
        strategies.push({
            args: baseArgs.concat(['--cookies', AUTH_CONFIG.cookieFilePath]),
            description: 'cookies.txt file',
            type: 'file'
        });
    }

    const browser = AUTH_CONFIG.browserName || 'edge';
    strategies.push({
        args: baseArgs.concat(['--cookies-from-browser', browser]),
        description: `Browser (${browser})`,
        type: 'browser'
    });

    return strategies;
}

function getVideoUploadDatesBatch(videoIds, onResult) {
    return new Promise((resolve) => {
        if (!videoIds || videoIds.length === 0) {
            resolve({ results: new Map(), failed: [] });
            return;
        }

        const tmpFile = path.join(os.tmpdir(),
            `ytl-batch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.txt`);
        const urls = videoIds.map(id => `https://www.youtube.com/watch?v=${id}`);

        try {
            fs.writeFileSync(tmpFile, urls.join('\n') + '\n', 'utf8');
        } catch (err) {
            console.error('[BatchUploadDate]  Failed to write temp file:', err.message);
            resolve({ results: new Map(), failed: videoIds.slice() });
            return;
        }

        console.log(`[BatchUploadDate]  Batch of ${videoIds.length} videos  ${tmpFile}`);

        const results = new Map();
        const seenVideoIds = new Set(videoIds);

        const baseArgs = YTDLP_GLOBAL_FLAGS_ARR.concat([
            '--batch-file', tmpFile,
            '--dump-json',
            '--skip-download',
            '--no-warnings',
            '--no-progress',
        ]);

        const strategies = buildBatchCommandStrategies(baseArgs);

        let strategyIdx = 0;

        const cleanup = () => {
            try { fs.unlinkSync(tmpFile); } catch (e) { /* ignore */ }
        };

        const tryNextStrategy = () => {
            if (strategyIdx >= strategies.length) {
                const failed = Array.from(seenVideoIds).filter(id => !results.has(id));
                console.error(`[BatchUploadDate]  All ${strategies.length} strategies failed. ${failed.length}/${videoIds.length} videos not resolved.`);
                cleanup();
                resolve({ results, failed });
                return;
            }

            const strategy = strategies[strategyIdx];
            strategyIdx++;

            console.log(`[BatchUploadDate] Trying strategy ${strategyIdx}/${strategies.length}: ${strategy.description}`);
            console.log(`[BatchUploadDate] Args: ${YTDLP_BIN} ${strategy.args.join(' ')}`);

            const proc = spawn(YTDLP_BIN, strategy.args, {
                shell: false,
                windowsHide: true,
                encoding: 'utf8',
            });

            let stdoutBuf = '';
            let stderrData = '';
            let lineCount = 0;
            let done = false;

            const parseLine = (line) => {
                line = line.trim();
                if (!line) return;
                lineCount++;

                try {
                    const info = JSON.parse(line);
                    const vidId = info.id || info.video_id;
                    const uploadDate = info.upload_date;
                    if (vidId && uploadDate && /^\d{8}$/.test(uploadDate)) {
                        results.set(vidId, uploadDate);
                        if (onResult) {
                            try { onResult(vidId, uploadDate); }
                            catch (e) { console.warn('[BatchUploadDate] onResult error:', e.message); }
                        }
                    }
                } catch (parseErr) { /* not JSON  skip */ }
            };

            proc.stdout.on('data', (data) => {
                stdoutBuf += data.toString();
                let nl;
                while ((nl = stdoutBuf.indexOf('\n')) >= 0) {
                    const line = stdoutBuf.slice(0, nl);
                    stdoutBuf = stdoutBuf.slice(nl + 1);
                    parseLine(line);
                }
            });

            proc.stderr.on('data', (data) => {
                stderrData += data.toString();
            });

            proc.on('error', (err) => {
                console.warn(`[BatchUploadDate] Strategy ${strategyIdx} spawn error:`, err.message);
                if (!done) {
                    done = true;
                    tryNextStrategy();
                }
            });

            proc.on('close', (code) => {
                if (done) return;
                done = true;

                if (stdoutBuf.trim()) {
                    parseLine(stdoutBuf);
                    stdoutBuf = '';
                }

                console.log(`[BatchUploadDate] Strategy ${strategyIdx} done: code=${code}, lines=${lineCount}, resolved=${results.size}/${videoIds.length}`);

                if (results.size > 0) {
                    const failed = Array.from(seenVideoIds).filter(id => !results.has(id));
                    if (failed.length > 0) {
                        console.warn(`[BatchUploadDate] ${failed.length} videos not in output`);
                    }
                    if (stderrData.trim()) {
                        console.log(`[BatchUploadDate] stderr (warnings): ${stderrData.trim().split('\n').slice(0, 3).join(' | ')}`);
                    }
                    cleanup();
                    resolve({ results, failed });
                } else {
                    if (stderrData.trim()) {
                        const lastErr = stderrData.trim().split('\n').slice(-5).join('\n');
                        console.warn(`[BatchUploadDate] Strategy ${strategyIdx} stderr:\n${lastErr}`);
                    } else {
                        console.warn(`[BatchUploadDate] Strategy ${strategyIdx} produced 0 results with no stderr (code=${code})`);
                    }
                    console.warn(`[BatchUploadDate] Trying next strategy...`);
                    tryNextStrategy();
                }
            });

            setTimeout(() => {
                if (!done) {
                    console.warn(`[BatchUploadDate] Strategy ${strategyIdx} timed out (5min), killing...`);
                    try { proc.kill('SIGTERM'); } catch (e) {}
                }
            }, 5 * 60 * 1000);
        };

        tryNextStrategy();
    });
}

async function getVideoUploadDatesParallel(videoIds, concurrency = 4, onResult, onRetry) {
    if (!videoIds || videoIds.length === 0) {
        return { results: new Map(), failed: [] };
    }

    const MAX_BATCH_SIZE = 50;
    const MAX_RETRIES = Infinity;
    const RETRY_DELAY_MS = 5000;

    const allResults = new Map();
    const allFailed = [];
    let remaining = videoIds.slice();
    let zeroProgressRounds = 0;

    for (let round = 0; round <= MAX_RETRIES && remaining.length > 0; round++) {
        if (round > 0) {
            console.log(`[ParallelBatch]  Retry round ${round}: ${remaining.length} videos to re-fetch`);
            if (onRetry) {
                try { onRetry(round, remaining.length); } catch (e) {}
            }
            await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
        }

        let batchConcurrency = concurrency;
        if (remaining.length <= 5) {
            batchConcurrency = 1;
        } else if (remaining.length <= 20) {
            batchConcurrency = Math.min(2, batchConcurrency);
        } else if (remaining.length <= 50) {
            batchConcurrency = Math.min(3, batchConcurrency);
        }

        const chunks = [];
        const chunkSize = Math.min(MAX_BATCH_SIZE, Math.ceil(remaining.length / batchConcurrency));
        for (let i = 0; i < remaining.length; i += chunkSize) {
            chunks.push(remaining.slice(i, i + chunkSize));
        }

        console.log(`[ParallelBatch]  Round ${round}: ${remaining.length} videos  ${chunks.length} batches of ~${chunkSize} (concurrency=${batchConcurrency})`);

        const roundResults = new Map();
        const roundFailed = [];

        const promises = chunks.map((chunk) =>
            getVideoUploadDatesBatch(chunk, (vidId, uploadDate) => {
                if (onResult) {
                    try { onResult(vidId, uploadDate); }
                    catch (e) { /* ignore */ }
                }
            }).then(r => {
                for (const [vidId, date] of r.results) {
                    roundResults.set(vidId, date);
                }
                for (const vidId of r.failed) {
                    roundFailed.push(vidId);
                }
            })
        );

        await Promise.all(promises);

        for (const [vidId, date] of roundResults) {
            allResults.set(vidId, date);
        }

        remaining = roundFailed;

        console.log(`[ParallelBatch]  Round ${round} done: +${roundResults.size} fetched, ${roundFailed.length} still failing (total: ${allResults.size}/${videoIds.length})`);

        if (round > 0 && roundResults.size === 0) {
            zeroProgressRounds++;
            console.log(`[ParallelBatch]  Zero progress round ${zeroProgressRounds}/3 (round ${round})`);
            if (zeroProgressRounds >= 3) {
                console.log(`[ParallelBatch]  3 consecutive zero-progress rounds  stopping`);
                break;
            }
            await new Promise(r => setTimeout(r, 30000));
        } else {
            zeroProgressRounds = 0;
        }
    }

    for (const vidId of remaining) {
        allFailed.push(vidId);
    }

    console.log(`[ParallelBatch]  All rounds done: ${allResults.size}/${videoIds.length} dates fetched, ${allFailed.length} failed`);

    return { results: allResults, failed: allFailed };
}

// =============================================================================
// FORMATTING & DEDUPLICATION
// =============================================================================

function formatDuration(totalSeconds) {
    if (totalSeconds === null || totalSeconds === undefined || totalSeconds <= 0) {
        return null;
    }

    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = Math.floor(totalSeconds % 60);

    const parts = [];
    if (hours > 0) {
        parts.push(`${String(hours).padStart(2, '0')}h`);
    }
    parts.push(`${String(minutes).padStart(2, '0')}m`);
    parts.push(`${String(seconds).padStart(2, '0')}s`);

    return `(${parts.join('-')})`;
}

function resolveDuplicatesWithDuration(videos) {
    if (!videos || videos.length === 0) return [];

    console.log('\n[resolveDuplicatesWithDuration] Processing', videos.length, 'videos...');

    videos.forEach((video, index) => {
        const rawTitle = video.title || 'Untitled';
        video.sanitizedBase = sanitizeViaPython(rawTitle);
        video._originalIndex = index;
    });

    const groups = new Map();

    videos.forEach(video => {
        const key = video.sanitizedBase.toLowerCase();
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(video);
    });

    let duplicateGroupCount = 0;
    groups.forEach((group, key) => {
        if (group.length > 1) duplicateGroupCount++;
    });
    console.log(`[resolveDuplicatesWithDuration] Found ${duplicateGroupCount} duplicate group(s), ${groups.size - duplicateGroupCount} unique video(s)`);

    groups.forEach((group, groupKey) => {
        if (group.length === 1) {
            const video = group[0];
            video.durationSuffix = null;
            video.finalFilename = `${video.sanitizedBase}.mp4`;
            video.displayTitle = video.sanitizedBase;
            video.isDuplicate = false;
        } else {
            group.forEach(video => {
                const formattedDuration = formatDuration(video.duration);
                if (formattedDuration) {
                    video._proposedSuffix = formattedDuration;
                } else {
                    video._proposedSuffix = `--${video.id}`;
                }
            });

            const suffixCounts = new Map();
            group.forEach(video => {
                const lowerSuffix = video._proposedSuffix.toLowerCase();
                suffixCounts.set(lowerSuffix, (suffixCounts.get(lowerSuffix) || 0) + 1);
            });

            group.forEach(video => {
                const lowerSuffix = video._proposedSuffix.toLowerCase();
                const count = suffixCounts.get(lowerSuffix);

                if (count > 1) {
                    video.durationSuffix = `--${video.id}`;
                } else {
                    video.durationSuffix = video._proposedSuffix;
                }

                video.finalFilename = `${video.sanitizedBase}${video.durationSuffix}.mp4`;
                video.displayTitle = `${video.sanitizedBase}${video.durationSuffix}`;
                video.isDuplicate = true;
            });
        }
    });

    videos.forEach(video => {
        delete video._proposedSuffix;
        delete video._originalIndex;
    });

    const modifiedCount = videos.filter(v => v.isDuplicate).length;
    console.log(`[resolveDuplicatesWithDuration]  Processing complete: ${modifiedCount} video(s) are duplicates\n`);

    return videos;
}

function ensureUniqueOnDisk(directory, desiredFilename) {
    const ext = path.extname(desiredFilename);
    const baseName = path.basename(desiredFilename, ext);

    let finalFilename = desiredFilename;
    let counter = 2;

    while (fs.existsSync(path.join(directory, finalFilename))) {
        console.log(`[ensureUniqueOnDisk]  CONFLICT: "${finalFilename}" exists  trying "${baseName} (${counter})${ext}"`);
        finalFilename = `${baseName} (${counter})${ext}`;
        counter++;

        if (counter > 1000) {
            console.warn('[ensureUniqueOnDisk] Counter exceeded 1000, using timestamp');
            finalFilename = `${baseName}-${Date.now()}${ext}`;
            break;
        }
    }

    return finalFilename;
}

// =============================================================================
// EXPRESS APP
// =============================================================================

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

app.use('/api', (req, res, next) => {
    if (!res.getHeader('Content-Type')) {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
    }
    next();
});

app.use(session({
    secret: AUTH_CONFIG.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: false,
        maxAge: AUTH_CONFIG.sessionMaxAge,
        httpOnly: true
    }
}));

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: {
        success: false,
        error: 'Too many login attempts. Please try again after 15 minutes.',
        retryAfter: '15 minutes'
    },
    standardHeaders: true,
    legacyHeaders: false
});

const publicRoutes = [
    '/api/login',
    '/api/health',
    '/login',
    '/api/auth/status'
];

function requireAuth(req, res, next) {
    // Public routes bypass auth entirely
    if (publicRoutes.some(route => req.path.startsWith(route))) {
        return next();
    }

    // Already authenticated
    if (req.session && req.session.isAuthenticated) {
        return next();
    }

    // FIX #1: ALWAYS return 401 JSON for API routes - never 302 redirect.
    // A 302 redirect causes fetch() to silently follow to /login and
    // receive HTML with status 200, so JSON.parse fails and the frontend
    // silently shows an empty app.
    if (req.path.startsWith('/api/') ||
        req.xhr ||
        (req.headers.accept && req.headers.accept.includes('application/json'))) {
        return res.status(401).json({
            success: false,
            error: 'Authentication required',
            code: 'AUTH_REQUIRED',
            redirectTo: '/login'
        });
    }

    // Non-API browser navigation -> redirect to login page as before
    return res.redirect('/login');
}

app.use(requireAuth);

// =============================================================================
// AUTHENTICATION ROUTES
// =============================================================================

app.post('/api/login', loginLimiter, (req, res) => {
    const { username, password } = req.body;

    console.log(`[Auth] Login attempt for user: '${username}' from IP: ${req.ip}`);

    if (username === AUTH_CONFIG.username && password === AUTH_CONFIG.password) {
        req.session.isAuthenticated = true;
        req.session.user = username;
        req.session.loginTime = new Date().toISOString();
        req.session.loginIP = req.ip;

        console.log(`[Auth]  Successful login for user: '${username}'`);

        return res.json({
            success: true,
            message: 'Login successful',
            user: username,
            redirectTo: '/'
        });
    }

    console.warn(`[Auth]  Failed login attempt for user: '${username}' from IP: ${req.ip}`);

    return res.status(401).json({
        success: false,
        message: 'Invalid username or password'
    });
});

app.post('/api/logout', (req, res) => {
    const user = req.session.user;
    const sessionId = req.sessionID;

    req.session.destroy((err) => {
        if (err) {
            console.error('[Auth] Error destroying session:', err);
            return res.status(500).json({ success: false, error: 'Logout failed' });
        }

        console.log(`[Auth] User '${user}' logged out (Session: ${sessionId})`);
        res.clearCookie('connect.sid');
        res.json({ success: true, message: 'Logged out successfully' });
    });
});

app.get('/api/auth/status', (req, res) => {
    if (req.session && req.session.isAuthenticated) {
        res.json({
            isAuthenticated: true,
            user: req.session.user,
            loginTime: req.session.loginTime,
            sessionAge: req.session.loginTime ?
                Math.floor((Date.now() - new Date(req.session.loginTime).getTime()) / 1000 / 60) : 0
        });
    } else {
        res.json({ isAuthenticated: false });
    }
});

// FIX #2: Session keep-alive endpoint - touches the session cookie so its
// maxAge is refreshed. The frontend calls this every few minutes while the
// user has the tab open. Prevents silent session expiry -> 401 storms.
app.post('/api/auth/refresh', (req, res) => {
    if (!req.session || !req.session.isAuthenticated) {
        return res.status(401).json({
            success: false,
            error: 'Not authenticated',
            code: 'AUTH_REQUIRED'
        });
    }
    req.session.lastRefresh = new Date().toISOString();
    return res.json({
        success: true,
        user: req.session.user,
        refreshedAt: req.session.lastRefresh,
        maxAgeMs: AUTH_CONFIG.sessionMaxAge
    });
});

app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/login.html'));
});

// =============================================================================
// STATIC FILE SERVING
// =============================================================================

app.use(express.static(path.join(__dirname, '../public')));

app.get('/', (req, res) => {
    const indexPath = findIndexHtml();

    if (indexPath && fs.existsSync(indexPath)) {
        console.log('[Root Route] Serving:', indexPath);
        res.sendFile(indexPath);
    } else {
        const searchPaths = [
            path.join(__dirname, '..', 'public', 'index.html'),
            path.join(__dirname, '..', '..', 'public', 'index.html'),
            path.join(process.cwd(), 'public', 'index.html'),
        ];

        let found = false;
        for (const searchPath of searchPaths) {
            if (fs.existsSync(searchPath)) {
                console.log('[Root Route] Fallback found:', searchPath);
                res.sendFile(searchPath);
                found = true;
                break;
            }
        }

        if (!found) {
            res.status(404).send(`
                <html><body>
                    <h1> Frontend Not Found</h1>
                    <p>Could not locate index.html</p>
                    <p>Searched in:</p>
                    <ul>${searchPaths.map(p => `<li>${p}</li>`).join('')}</ul>
                    <p><a href="/api/health">API Status</a></p>
                </body></html>
            `);
        }
    }
});

// =============================================================================
// HEALTH / LOGS
// =============================================================================

app.get('/api/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        downloads: {
            dir: DOWNLOADS_DIR,
            exists: fs.existsSync(DOWNLOADS_DIR)
        },
        ffmpeg: FFMPEG_AVAILABLE,
        ffmpegPath: FFMPEG_PATH,
        cookies: isCookiesFileValid(false),
        ytdlp: YTDLP_BIN,
        node: NODE_BIN
    });
});

app.get('/api/logs', (req, res) => {
    const { limit, type, since } = req.query;

    let logs = [...serverLogBuffer];

    if (type && type !== 'all') {
        logs = logs.filter(log => log.type === type);
    }

    if (since) {
        const sinceDate = new Date(since);
        logs = logs.filter(log => new Date(log.time) >= sinceDate);
    }

    const logLimit = parseInt(limit) || 100;
    logs = logs.slice(-logLimit);

    res.json({
        success: true,
        count: logs.length,
        total: serverLogBuffer.length,
        logs: logs
    });
});

app.delete('/api/logs', (req, res) => {
    const cleared = serverLogBuffer.length;
    serverLogBuffer.length = 0;
    res.json({ success: true, message: `Cleared ${cleared} log entries` });
});

// =============================================================================
// SETTINGS ENDPOINTS
// =============================================================================

app.get('/api/settings', (req, res) => {
    const resolvedPath = toNativePath(DOWNLOADS_DIR);
    let fileCount = 0;
    let recentFiles = [];

    try {
        if (fs.existsSync(resolvedPath)) {
            const files = fs.readdirSync(resolvedPath);
            fileCount = files.length;
            recentFiles = files
                .filter(f => f.endsWith('.mp4') || f.endsWith('.webm'))
                .slice(-5)
                .map(f => ({
                    name: f,
                    size: fs.statSync(path.join(resolvedPath, f)).size,
                    modified: fs.statSync(path.join(resolvedPath, f)).mtime
                }));
        }
    } catch (e) {
        console.error('[Settings] Error reading downloads dir:', e);
    }

    res.json({
        success: true,
        data: {
            currentDownloadsDir: DOWNLOADS_DIR,
            resolvedPath: resolvedPath,
            dirExists: fs.existsSync(resolvedPath),
            fileCount: fileCount,
            recentFiles: recentFiles
        }
    });
});

app.put('/api/settings', async (req, res) => {
    const { downloadsDir } = req.body;

    if (!downloadsDir) {
        return res.status(400).json({ success: false, error: 'downloadsDir required' });
    }

    const newPath = toNativePath(downloadsDir);
    const oldPath = DOWNLOADS_DIR;

    console.log('\n[Settings]  Updating download folder:');
    console.log('   FROM:', oldPath);
    console.log('   TO:  ', newPath);

    try {
        if (!fs.existsSync(newPath)) {
            fs.mkdirSync(newPath, { recursive: true });
            console.log('[Settings]  Created new directory:', newPath);
        }

        DOWNLOADS_DIR = newPath;
        process.env.DOWNLOADS_DIR = newPath;

        console.log('[Settings]  Download folder updated! New downloads will use:', DOWNLOADS_DIR);

        res.json({
            success: true,
            message: ` Download folder updated to: ${newPath}`,
            data: {
                newDir: newPath,
                oldDir: oldPath,
                requiresRestart: false,
                tip: 'New downloads will use this folder immediately'
            }
        });

    } catch (error) {
        console.error('[Settings]  Error updating folder:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/settings/test-folder', (req, res) => {
    const { folderPath } = req.body;

    if (!folderPath) {
        return res.status(400).json({ success: false, error: 'folderPath required' });
    }

    const testPath = toNativePath(folderPath);

    try {
        const testFile = path.join(testPath, '.write_test_' + Date.now());
        fs.writeFileSync(testFile, 'test');
        fs.unlinkSync(testFile);

        res.json({
            success: true,
            data: {
                canUse: true,
                path: testPath,
                exists: fs.existsSync(testPath)
            }
        });
    } catch (error) {
        res.json({
            success: true,
            data: {
                canUse: false,
                path: testPath,
                error: error.message
            }
        });
    }
});

// =============================================================================
// COOKIE ENDPOINTS
// =============================================================================

app.post('/api/cookies/repair', (req, res) => {
    console.log('\n[Repair Cookies] POST /api/cookies/repair requested');

    getNativeCookiePath();
    const result = repairCookiesFile(AUTH_CONFIG.cookieFilePath);

    if (result.repaired) {
        console.log(`[Repair Cookies]  Repaired ${result.fixedCount} line(s)`);
        res.json({
            success: true,
            repaired: true,
            fixedCount: result.fixedCount,
            totalLines: result.totalLines,
            commentCount: result.commentCount,
            backupPath: result.backupPath,
            cookiePath: AUTH_CONFIG.cookieFilePath,
            message: `Repaired ${result.fixedCount} cookie line(s). Backup saved.`
        });
    } else {
        console.log(`[Repair Cookies]  No repair needed (or failed): ${result.reason}`);
        res.json({
            success: true,
            repaired: false,
            reason: result.reason,
            totalLines: result.totalLines,
            commentCount: result.commentCount,
            cookiePath: AUTH_CONFIG.cookieFilePath,
            message: result.reason || 'No repair needed'
        });
    }
});

app.get('/api/cookies/validate', (req, res) => {
    console.log('\n[Validate Cookies] GET /api/cookies/validate');

    getNativeCookiePath();
    const cookiePath = AUTH_CONFIG.cookieFilePath;

    if (!cookiePath || !fs.existsSync(cookiePath)) {
        return res.json({
            success: true,
            exists: false,
            valid: false,
            cookiePath,
            message: 'cookies.txt does not exist'
        });
    }

    const isValid = isCookiesFileValid();
    let stats;
    try {
        stats = fs.statSync(cookiePath);
    } catch (e) {
        stats = null;
    }

    res.json({
        success: true,
        exists: true,
        valid: isValid,
        cookiePath,
        sizeBytes: stats ? stats.size : 0,
        sizeKB: stats ? Math.round(stats.size / 1024 * 100) / 100 : 0,
        modified: stats ? stats.mtime : null,
        message: isValid
            ? 'cookies.txt is valid Netscape format'
            : 'cookies.txt has format issues  POST /api/cookies/repair to fix'
    });
});

app.post('/api/cookies/extract', async (req, res) => {
    console.log('\n[Extract Cookies] POST /api/cookies/extract requested');

    const browser = (req.body && req.body.browser) || 'auto';
    const browse = !!(req.body && req.body.browse);
    console.log(`[Extract Cookies] Browser: ${browser}, Browse: ${browse}`);

    if (browse) {
        try {
            const refreshResult = await refreshCookiesViaEdgeBrowse({ force: true });
            if (refreshResult.success) {
                const isValid = isCookiesFileValid(false);
                console.log(`[Extract Cookies]  Strategy 4 manual browse succeeded  cookies.txt is ${isValid ? 'valid' : 'invalid'}`);
                return res.json({
                    success: true,
                    extracted: true,
                    browsed: true,
                    cookiePath: refreshResult.cookiePath,
                    valid: isValid,
                    reason: refreshResult.reason,
                    message: `Strategy 4 manual refresh succeeded. cookies.txt is ${isValid ? 'valid' : 'invalid format'}.`
                });
            } else {
                console.log(`[Extract Cookies]  Strategy 4 manual browse failed: ${refreshResult.reason}`);
                return res.json({
                    success: false,
                    extracted: false,
                    browsed: true,
                    reason: refreshResult.reason,
                    message: refreshResult.message || `Strategy 4 failed: ${refreshResult.reason}`,
                    error: refreshResult.error || null
                });
            }
        } catch (err) {
            console.error('[Extract Cookies]  Strategy 4 unexpected error:', err.message);
            return res.status(500).json({
                success: false,
                error: 'Strategy 4 unexpected error: ' + err.message
            });
        }
    }

    try {
        const result = await autoExtractCookiesViaPython({ browser });

        if (result.success) {
            const isValid = isCookiesFileValid(false);
            console.log(`[Extract Cookies]  Extraction succeeded  cookies.txt is ${isValid ? 'valid' : 'invalid'}`);
            res.json({
                success: true,
                extracted: true,
                cookiePath: result.cookiePath,
                sizeBytes: result.sizeBytes,
                valid: isValid,
                message: `Successfully extracted ${result.sizeBytes} bytes of cookies from browser. File is ${isValid ? 'valid' : 'invalid format'}.`
            });
        } else {
            console.log(`[Extract Cookies]  Extraction failed: ${result.error}`);
            res.json({
                success: false,
                extracted: false,
                error: result.error,
                installCommand: result.installCommand || null,
                searchedPaths: result.searchedPaths || null,
                triedCommands: result.triedCommands || null,
                message: result.error
            });
        }
    } catch (err) {
        console.error('[Extract Cookies]  Unexpected error:', err.message);
        res.status(500).json({
            success: false,
            error: 'Unexpected error: ' + err.message
        });
    }
});

// =============================================================================
// CHANNEL ENDPOINTS
// =============================================================================

function fetchChannelInfo(channelId, channelUrl) {
    return new Promise((resolve, reject) => {
        console.log('\n[fetchChannelInfo] Starting channel fetch...');
        console.log('[fetchChannelInfo] Channel URL:', channelUrl);

        const cmd = `yt-dlp --flat-playlist -j "${channelUrl}"`;

        console.log('[fetchChannelInfo] Command:', cmd);

        const strategies = buildCommandsWithCookieStrategies(cmd, channelUrl);

        executeWithRetry(
            strategies,
            0,
            (stdout) => {
                console.log('[fetchChannelInfo]  Successfully fetched channel data');

                try {
                    const lines = stdout.trim().split('\n').filter(line => line.trim());
                    const videos = [];
                    const liveVideos = [];
                    const seenIds = new Set();

                    console.log(`[fetchChannelInfo] Raw JSON lines received: ${lines.length}`);

                    lines.forEach((line, index) => {
                        try {
                            const data = JSON.parse(line);

                            const videoId = data.id || `video_${index}`;
                            const videoTitle = (data.title || 'Untitled').trim();
                            const rawDuration = data.duration ? parseInt(data.duration) : null;

                            if (seenIds.has(videoId)) return;
                            seenIds.add(videoId);

                            const video = {
                                id: videoId,
                                title: videoTitle,
                                duration: rawDuration,
                                views: data.view_count ? parseInt(data.view_count) : null,
                                uploadDate: data.upload_date || null,
                                isLiveStream: videoTitle.toLowerCase().includes('live'),
                                isPremiere: videoTitle.toLowerCase().includes('premiere'),
                            };

                            const isValidDuration = rawDuration === null ||
                                                  (!isNaN(rawDuration) && rawDuration >= 60 && rawDuration < 86400);

                            if (isValidDuration) {
                                videos.push(video);
                            } else {
                                console.log(`[fetchChannelInfo] Filtered out short/invalid duration video: ${videoTitle} (${rawDuration}s)`);
                            }
                        } catch (parseError) {
                            console.warn(`[fetchChannelInfo] Failed to parse line ${index}:`, parseError.message.substring(0, 100));
                        }
                    });

                    console.log(`[fetchChannelInfo]  Parsed ${videos.length} unique videos (from ${lines.length} raw lines)`);

                    const processedVideos = resolveDuplicatesWithDuration(videos);

                    resolve({
                        videos: processedVideos,
                        liveVideos: liveVideos
                    });

                } catch (parseError) {
                    console.error('[fetchChannelInfo] Error parsing output:', parseError);
                    reject(new Error('Failed to parse channel data'));
                }
            },
            (error) => {
                console.error('[fetchChannelInfo] Failed to fetch channel:', error.message);
                reject(error);
            }
        );
    });
}

app.post('/api/video/info', async (req, res) => {
    try {
        const { url } = req.body;

        if (!url) {
            return res.status(400).json({ error: 'Video URL required' });
        }

        const info = await getVideoInfo(url);

        res.json({
            success: true,
            data: {
                id: info.id,
                title: info.title,
                duration: info.duration,
                thumbnail: info.thumbnail,
                formats: info.formats || [],
                bestFormat: getBestFormat(info.formats)
            }
        });

    } catch (error) {
        console.error('[Video Info] Error:', error.message);
        res.status(500).json({ error: 'Failed to get video info: ' + error.message });
    }
});

function getVideoInfo(url) {
    return new Promise((resolve, reject) => {
        const cmd = 'yt-dlp --dump-json --no-download';
        const strategies = buildCommandsWithCookieStrategies(cmd, url);
        executeWithRetry(strategies, 0,
            (stdout) => {
                try {
                    const lastLine = stdout.trim().split('\n').filter(l => l.trim()).pop();
                    resolve(JSON.parse(lastLine));
                } catch (e) { reject(e); }
            },
            (err) => reject(err)
        );
    });
}

function getBestFormat(formats) {
    if (!formats || !Array.isArray(formats)) return null;
    return formats.find(f => f.ext === 'mp4' && f.vcodec !== 'none') || formats[0] || null;
}

// =============================================================================
// MAIN DOWNLOAD ENDPOINTS
// =============================================================================

app.post('/api/download/start', async (req, res) => {
    try {
        const { url, format, quality, title } = req.body;

        if (!url) {
            return res.status(400).json({ error: 'Video URL required' });
        }

        const downloadId = uuidv4();
        const filename = `video_${downloadId}.mp4`;
        const outputPath = path.join(DOWNLOADS_DIR, filename);

        downloadManager.add({
            id: downloadId,
            url: url,
            title: title || null,
            filename: filename,
            outputPath: outputPath,
            status: 'queued',
            progress: 0,
            createdAt: new Date().toISOString()
        });

        downloadQueue.enqueue(downloadId, url, outputPath, title || `video_${downloadId}`);

        res.json({
            success: true,
            downloadId: downloadId,
            message: 'Download queued'
        });

    } catch (error) {
        console.error('[Download Start] Error:', error.message);
        res.status(500).json({ error: 'Failed to start download: ' + error.message });
    }
});

app.post('/api/download', async (req, res) => {
    console.log('\n' + '='.repeat(80));
    console.log(' [Download] POST /api/download - Frontend Download Request');
    console.log('='.repeat(80));
    console.log('[Download] Request body:', JSON.stringify(req.body, null, 2));

    try {
        const {
            url,
            videoId,
            channelId,
            channelName,
            format,
            quality,
            filename,
            finalFilename,
            downloadFilename,
            title
        } = req.body;

        const videoUrl = url || (videoId ? `https://www.youtube.com/watch?v=${videoId}` : null);

        if (!videoUrl) {
            console.log('[Download]  ERROR: No URL or videoId provided!');
            return res.status(400).json({
                success: false,
                error: 'Video URL or videoId required'
            });
        }

        if (_inFlightDownloadUrls.has(videoUrl)) {
            console.log(`[Download]  DUPLICATE DETECTED (in-flight): URL already being processed`);
            return res.status(409).json({
                success: false,
                error: 'Duplicate download',
                message: 'This video is already being processed (in-flight)',
                status: 'downloading'
            });
        }

        const existingDownload = downloadManager.getAll().find(d =>
            d.url === videoUrl && (d.status === 'queued' || d.status === 'downloading')
        );
        if (existingDownload) {
            console.log(`[Download]  DUPLICATE DETECTED: URL already downloading (ID: ${existingDownload.id})`);
            return res.status(409).json({
                success: false,
                error: 'Duplicate download',
                message: 'This video is already in the download queue or currently downloading',
                existingJobId: existingDownload.id,
                status: existingDownload.status
            });
        }

        _inFlightDownloadUrls.add(videoUrl);
        setTimeout(() => {
            if (_inFlightDownloadUrls.has(videoUrl)) {
                console.warn(`[Download]  In-flight URL cleanup triggered for: ${videoUrl}`);
                _inFlightDownloadUrls.delete(videoUrl);
            }
        }, 5 * 60 * 1000);

        console.log('[Download] Processing download:');
        console.log('   - URL:', videoUrl);
        console.log('   - Video ID:', videoId || 'extracted from URL');
        console.log('   - Channel ID:', channelId || 'N/A');
        console.log('   - Channel Name:', channelName || 'N/A (will use root downloads folder)');
        console.log('   - Format:', format || 'auto (best)');
        console.log('   - Quality:', quality || 'auto');

        const outputDir = channelName ? getChannelDownloadDir(channelName) : DOWNLOADS_DIR;
        console.log('[Download] Output directory:', outputDir);

        const downloadId = uuidv4();

        let outputFilename;
        let filenameSource = 'unknown';

        if (finalFilename && finalFilename.trim()) {
            outputFilename = finalFilename.includes('.mp4') ? finalFilename : `${finalFilename}.mp4`;
            filenameSource = 'finalFilename (from dedup system)';
        } else if (downloadFilename && downloadFilename.trim()) {
            outputFilename = downloadFilename.includes('.mp4') ? downloadFilename : `${downloadFilename}.mp4`;
            filenameSource = 'downloadFilename (legacy)';
        } else if (title && title.trim()) {
            const sanitized = sanitizeViaPython(title);
            outputFilename = sanitized.includes('.mp4') ? sanitized : `${sanitized}.mp4`;
            filenameSource = 'sanitizeViaPython(title) (fallback)';
        } else {
            outputFilename = `video_${downloadId}.mp4`;
            filenameSource = 'generic fallback';
        }

        console.log(`[Download]  Filename source: ${filenameSource}`);
        console.log(`[Download]  Filename BEFORE ensureUniqueOnDisk: "${outputFilename}"`);

        const filenameBeforeUniqueness = outputFilename;
        outputFilename = ensureUniqueOnDisk(outputDir, outputFilename);

        if (outputFilename !== filenameBeforeUniqueness) {
            console.log(`[Download]  ensureUniqueOnDisk MODIFIED filename!`);
            console.log(`[Download]    Before: "${filenameBeforeUniqueness}"`);
            console.log(`[Download]    After:  "${outputFilename}"`);
        } else {
            console.log(`[Download]  ensureUniqueOnDisk: No change needed`);
        }

        const outputPath = path.join(outputDir, outputFilename);

        downloadManager.add({
            id: downloadId,
            url: videoUrl,
            videoId: videoId,
            channelId: channelId,
            channelName: channelName || null,
            title: title || null,
            filename: outputFilename,
            outputPath: outputPath,
            format: format || 'best',
            quality: quality || 'auto',
            status: 'queued',
            progress: 0,
            startTime: null,
            endTime: null,
            createdAt: new Date().toISOString(),
            needsRename: !(finalFilename && finalFilename.trim()),
            hasFinalFilename: !!(finalFilename && finalFilename.trim())
        });

        console.log('[Download]  Job created, adding to DOWNLOAD QUEUE...');

        downloadQueue.enqueue(downloadId, videoUrl, outputPath, title || videoId);

        console.log('[Download]  Response sent to frontend (job queued/starting)');
        console.log('='.repeat(80) + '\n');

        res.status(201).json({
            success: true,
            jobId: downloadId,
            status: 'queued',
            message: 'Download job created and queued',
            queueStatus: {
                position: downloadQueue.activeJobs.length + downloadQueue.queue.length,
                activeDownloads: downloadQueue.activeJobs.length,
                waitingInQueue: downloadQueue.queue.length
            },
            download: {
                id: downloadId,
                url: videoUrl,
                filename: outputFilename,
                status: 'queued',
                progress: 0,
                createdAt: new Date().toISOString()
            }
        });

    } catch (error) {
        console.error('[Download]  ERROR creating download job:', error.message);
        console.log('='.repeat(80) + '\n');

        res.status(500).json({
            success: false,
            error: 'Failed to create download: ' + error.message,
            suggestion: 'Check server logs for details'
        });
    }
});

// =============================================================================
// SINGLE FILE DOWNLOAD
// =============================================================================

app.post('/api/download-single', async (req, res) => {
    console.log('\n' + '='.repeat(80));
    console.log('[Single File] POST /api/download-single');
    console.log('='.repeat(80));

    try {
        const { urls } = req.body;

        if (!urls || !urls.trim()) {
            return res.status(400).json({ success: false, error: 'Video URLs required' });
        }

        const urlList = urls.split(/[\n,]+/).map(u => u.trim()).filter(u => u.length > 0);

        if (urlList.length === 0) {
            return res.status(400).json({ success: false, error: 'No valid URLs provided' });
        }

        const precheckResults = [];
        const outputDir = getSingleFileDir();

        for (const videoUrl of urlList) {
            const vidMatch = videoUrl.match(/(?:v=|\/v\/|youtu\.be\/|embed\/)([a-zA-Z0-9_-]{11})/);
            const videoId = vidMatch ? vidMatch[1] : null;

            const cmd = 'yt-dlp --dump-json --no-download "' + videoUrl + '"';
            const strategies = buildCommandsWithCookieStrategies(cmd, videoUrl);

            try {
                const title = await new Promise((resolve, reject) => {
                    executeWithRetry(
                        strategies,
                        0,
                        (stdout) => {
                            try {
                                const info = JSON.parse(stdout.trim());
                                resolve(info.title || null);
                            } catch (e) {
                                reject(new Error('Failed to parse video info'));
                            }
                        },
                        (error) => reject(error)
                    );
                });

                const sanitizedTitle = sanitizeViaPython(title || 'Untitled');
                let outputFilename = sanitizedTitle + '.mp4';

                const filePath = path.join(outputDir, outputFilename);
                const isDuplicate = fs.existsSync(filePath);

                let renamedFilename = null;
                if (isDuplicate) {
                    let counter = 2;
                    while (fs.existsSync(path.join(outputDir, sanitizedTitle + ' (' + counter + ').mp4'))) {
                        counter++;
                    }
                    renamedFilename = sanitizedTitle + ' (' + counter + ').mp4';
                }

                precheckResults.push({
                    url: videoUrl,
                    videoId: videoId,
                    title: title,
                    proposedFilename: outputFilename,
                    isDuplicate: isDuplicate,
                    renamedFilename: renamedFilename
                });

                console.log('[Single File] Pre-check: "' + (title || '').substring(0, 50) + '" -> ' + outputFilename + (isDuplicate ? ' (DUPLICATE)' : ''));

            } catch (err) {
                console.warn('[Single File] Failed to fetch title for ' + videoUrl + ': ' + err.message);
                const fallbackId = videoId || 'unknown';
                const fallbackName = 'video_' + fallbackId + '.mp4';
                precheckResults.push({
                    url: videoUrl,
                    videoId: fallbackId,
                    title: null,
                    proposedFilename: fallbackName,
                    isDuplicate: fs.existsSync(path.join(outputDir, fallbackName)),
                    renamedFilename: null
                });
            }
        }

        const duplicates = precheckResults.filter(r => r.isDuplicate);

        if (duplicates.length > 0) {
            return res.json({
                success: true,
                phase: 'precheck',
                message: duplicates.length + ' file(s) already exist',
                precheckResults: precheckResults,
                duplicates: duplicates.map(d => ({
                    url: d.url,
                    videoId: d.videoId,
                    title: d.title,
                    existingFile: d.proposedFilename,
                    renamedFile: d.renamedFilename
                }))
            });
        }

        return queueSingleFileDownloads(precheckResults, outputDir, res);

    } catch (error) {
        console.error('[Single File] Error:', error.message);
        res.status(500).json({
            success: false,
            error: 'Failed to queue download: ' + error.message
        });
    }
});

app.post('/api/download-single/confirm', async (req, res) => {
    console.log('\n[Single File] POST /api/download-single/confirm');

    try {
        const { decisions } = req.body;

        if (!decisions || !Array.isArray(decisions)) {
            return res.status(400).json({ success: false, error: 'Decisions array required' });
        }

        const outputDir = getSingleFileDir();
        const toDownload = [];

        for (const decision of decisions) {
            if (decision.action === 'skip') {
                console.log('[Single File] Skipping: ' + (decision.title || decision.url));
                continue;
            }

            const filename = decision.filename || decision.proposedFilename || ('video_' + decision.videoId + '.mp4');
            toDownload.push({
                url: decision.url,
                videoId: decision.videoId,
                title: decision.title,
                proposedFilename: filename
            });
        }

        if (toDownload.length === 0) {
            return res.json({
                success: true,
                message: 'All downloads skipped',
                count: 0,
                downloads: [],
                outputDir: outputDir
            });
        }

        return queueSingleFileDownloads(toDownload, outputDir, res);

    } catch (error) {
        console.error('[Single File] Confirm Error:', error.message);
        res.status(500).json({
            success: false,
            error: 'Failed to confirm downloads: ' + error.message
        });
    }
});

function queueSingleFileDownloads(fileList, outputDir, res) {
    const results = [];

    for (const item of fileList) {
        const downloadId = uuidv4();
        const outputFilename = item.proposedFilename;
        const outputPath = path.join(outputDir, outputFilename);

        console.log('[Single File] Queuing: "' + (item.title || item.url).substring(0, 60) + '" -> ' + outputFilename);

        downloadManager.add({
            id: downloadId,
            url: item.url,
            videoId: item.videoId,
            channelId: null,
            channelName: 'Single-File',
            title: item.title,
            filename: outputFilename,
            outputPath: outputPath,
            format: 'best',
            quality: 'auto',
            status: 'queued',
            progress: 0,
            startTime: null,
            endTime: null,
            createdAt: new Date().toISOString(),
            needsRename: false,
            hasFinalFilename: true
        });

        downloadQueue.enqueue(downloadId, item.url, outputPath, item.title || outputFilename);

        results.push({
            videoId: item.videoId,
            url: item.url,
            title: item.title,
            jobId: downloadId,
            status: 'queued',
            filename: outputFilename
        });
    }

    res.status(201).json({
        success: true,
        phase: 'download',
        message: 'Queued ' + results.length + ' video(s) for download',
        count: results.length,
        downloads: results,
        outputDir: outputDir
    });

    console.log('[Single File] Queued ' + results.length + ' video(s) to ' + outputDir);
    console.log('='.repeat(80) + '\n');
}

app.get('/api/single-file/files', (req, res) => {
    console.log('\n[Single-File] GET /api/single-file/files');

    try {
        const singleDir = getSingleFileDir();
        const files = [];

        if (fs.existsSync(singleDir)) {
            const entries = fs.readdirSync(singleDir);
            for (const entry of entries) {
                const fullPath = path.join(singleDir, entry);
                try {
                    const stat = fs.statSync(fullPath);
                    if (stat.isFile()) {
                        files.push({
                            name: entry,
                            size: stat.size,
                            modifiedAt: stat.mtime.toISOString(),
                            sizeFormatted: formatFileSize(stat.size)
                        });
                    }
                } catch (err) {
                    console.warn(`[Single-File] Error reading ${entry}:`, err.message);
                }
            }
            files.sort((a, b) => new Date(b.modifiedAt) - new Date(a.modifiedAt));
        }

        const totalSize = files.reduce((sum, f) => sum + f.size, 0);

        console.log(`[Single-File] Found ${files.length} files, total size: ${formatFileSize(totalSize)}`);

        res.json({
            success: true,
            directory: singleDir,
            files: files,
            count: files.length,
            totalSize: totalSize,
            totalSizeFormatted: formatFileSize(totalSize)
        });

    } catch (error) {
        console.error('[Single-File] Error listing files:', error.message);
        res.status(500).json({
            success: false,
            error: 'Failed to list files: ' + error.message
        });
    }
});

function formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const k = 1024;
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + units[i];
}

// =============================================================================
// CHANNEL CRUD
// =============================================================================

app.get('/api/channels', (req, res) => {
    console.log('\n[Channels] GET /api/channels requested');

    const channels = Array.from(savedChannels.values()).map(ch => ({
        ...ch,
        videos: (ch.videos || []).map(video => ({ ...video }))
    }));

    res.json({
        success: true,
        channels: channels,
        count: channels.length
    });
});

app.get('/api/channels/:id', (req, res) => {
    const { id } = req.params;
    console.log(`\n[Channels] GET /api/channels/${id} requested`);

    if (savedChannels.has(id)) {
        const channel = savedChannels.get(id);
        res.json({
            success: true,
            channel: channel,
            videos: channel.videos || []
        });
    } else {
        res.status(404).json({ success: false, error: 'Channel not found' });
    }
});

app.get('/api/channels/:id/videos', (req, res) => {
    const { id } = req.params;
    console.log(`\n[Channels] GET /api/channels/${id}/videos requested`);

    if (savedChannels.has(id)) {
        const channel = savedChannels.get(id);
        res.json({
            success: true,
            channel: channel,
            videos: channel.videos || []
        });
    } else {
        res.status(404).json({ success: false, error: 'Channel not found' });
    }
});

/**
 * Decode URL-encoded characters in a string (e.g. %D9%85 -> Arabic letter meem).
 * Returns the string unchanged if it is not URL-encoded or if decoding fails.
 */
function decodeIfUrlEncoded(str) {
    if (!str || typeof str !== 'string') return str;
    if (!/%[0-9A-Fa-f]{2}/.test(str)) return str;
    try {
        return decodeURIComponent(str);
    } catch (e) {
        console.warn('[URL Decode] Failed to decode:', str, e.message);
        return str;
    }
}

app.post('/api/channels', async (req, res) => {
    console.log('\n' + '='.repeat(80));
    console.log(' [Channels] POST /api/channels - ADD NEW CHANNEL');
    console.log('='.repeat(80));
    console.log('[Channels] Request body:', JSON.stringify(req.body, null, 2));

    try {
        const { url, channelId, name } = req.body;

        if (!url && !channelId) {
            console.log('[Channels]  ERROR: No URL or channelId provided!');
            return res.status(400).json({ success: false, error: 'Channel URL or ID required' });
        }

        // Decode URL-encoded characters in url and channelId (e.g. Arabic/Chinese handles)
        // so the resulting channel name is readable and matches the folder name.
        const decodedUrl = decodeIfUrlEncoded(url);
        const decodedChannelId = decodeIfUrlEncoded(channelId);
        let channelUrl = decodedUrl || 'https://www.youtube.com/@' + decodedChannelId;

        if (channelUrl.startsWith('@')) {
            channelUrl = `https://www.youtube.com/${channelUrl}`;
        }

        if (channelUrl) {
            while (channelUrl.includes('youtube.com/youtube.com/') ||
                   channelUrl.includes('youtube.com/www.youtube.com/')) {
                channelUrl = channelUrl.replace(/youtube\.com\/(www\.)?youtube\.com\//, 'youtube.com/');
                console.log('[Channels]  Fixed doubled URL');
            }

            if (!channelUrl.startsWith('http://') && !channelUrl.startsWith('https://')) {
                if (channelUrl.startsWith('www.youtube.com') || channelUrl.startsWith('youtube.com')) {
                    channelUrl = 'https://' + channelUrl;
                } else {
                    channelUrl = 'https://www.youtube.com/' + channelUrl;
                }
                console.log('[Channels]  Added missing protocol');
            }

            channelUrl = channelUrl.replace(/([^:])\/{2,}/g, '$1/');
        }

                const channelIdFinal = decodeIfUrlEncoded(channelId) || decodeIfUrlEncoded(channelUrl.split('@').pop().split('/')[0]);

        console.log('[Channels] Processing channel:');
        console.log('   - URL:', channelUrl);
        console.log('   - ID:', channelIdFinal);
        console.log('   - Name:', name || 'Auto-detected');

        console.log('\n[Channels]  Fetching channel info from YouTube...');

        const channelData = await fetchChannelInfo(channelIdFinal, channelUrl);

        console.log('\n[Channels]  Channel fetched successfully!');
        console.log('[Channels] Videos found:', channelData.videos.length);
        console.log('[Channels] Live videos found:', channelData.liveVideos.length);

        const videosClean = channelData.videos.map(video => ({ ...video }));

        let existingChannel = null;
        for (const ch of savedChannels.values()) {
            if ((ch.youtubeId && ch.youtubeId === channelIdFinal) || (ch.url && ch.url === channelUrl)) {
                existingChannel = ch;
                break;
            }
        }

        const channel = {
            id: existingChannel ? existingChannel.id : uuidv4(),
            youtubeId: channelIdFinal,
            url: channelUrl,
            name: name || channelIdFinal,
            videoCount: channelData.videos.length + channelData.liveVideos.length,
            videos: videosClean,
            liveVideos: channelData.liveVideos,
            addedAt: existingChannel ? existingChannel.addedAt : new Date().toISOString(),
            lastChecked: new Date().toISOString(),
            status: 'active'
        };

        savedChannels.set(channel.id, channel);
        saveDatabase();

        console.log('[Channels]  Channel saved with ID:', channel.id);
        console.log('='.repeat(80) + '\n');

        res.status(201).json({
            success: true,
            message: 'Channel added successfully',
            channel: channel,
            channels: [channel],
            videos: channelData.videos,
            liveVideos: channelData.liveVideos,
            totalVideos: channelData.videos.length + channelData.liveVideos.length
        });

    } catch (error) {
        console.log('\n' + '='.repeat(80));
        console.log(' [Channels] FAILED TO ADD CHANNEL!');
        console.log('='.repeat(80));
        console.log('[Channels] Error Type:', error.constructor.name);
        console.log('[Channels] Error Message:', error.message);
        console.log('='.repeat(80) + '\n');

        res.status(500).json({
            success: false,
            error: 'Failed to add channel: ' + error.message,
            suggestion: 'Check yt-dlp installation and internet connection',
            debug: {
                errorType: error.constructor.name,
                errorMessage: error.message,
                timestamp: new Date().toISOString()
            }
        });
    }
});

// =============================================================================
// DISK SCAN / SYNC
// =============================================================================

function performDiskScanForChannel(channel) {
    const videos = channel.videos || [];
    const channelDir = getChannelDownloadDir(channel.name);
    let downloadedFiles = [];

    console.log(`[Disk Scan] Channel: "${channel.name}"`);

    const VIDEO_EXTENSIONS = ['.mp4', '.webm', '.mkv', '.m4a', '.mp3', '.m4v', '.mov', '.avi'];
    const hasVideoExtension = (filename) => {
        const lower = filename.toLowerCase();
        return VIDEO_EXTENSIONS.some(ext => lower.endsWith(ext));
    };

    if (fs.existsSync(channelDir)) {
        try {
            const allFiles = fs.readdirSync(channelDir);
            const videoFiles = allFiles.filter(hasVideoExtension);
            const files = videoFiles.map(file => ({
                name: file,
                path: path.join(channelDir, file),
                size: fs.statSync(path.join(channelDir, file)).size,
                modifiedAt: fs.statSync(path.join(channelDir, file)).mtime.toISOString()
            }));
            downloadedFiles.push(...files);
        } catch (err) {
            console.error(`[Disk Scan] Error reading ${channelDir}:`, err.message);
        }
    }

    if (fs.existsSync(DOWNLOADS_DIR) && path.resolve(DOWNLOADS_DIR) !== path.resolve(channelDir)) {
        try {
            const allFiles = fs.readdirSync(DOWNLOADS_DIR);
            const videoFiles = allFiles.filter(hasVideoExtension);
            const files = videoFiles.map(file => ({
                name: file,
                path: path.join(DOWNLOADS_DIR, file),
                size: fs.statSync(path.join(DOWNLOADS_DIR, file)).size,
                modifiedAt: fs.statSync(path.join(DOWNLOADS_DIR, file)).mtime.toISOString()
            }));
            downloadedFiles.push(...files);
        } catch (err) {
            console.error(`[Disk Scan] Error reading ${DOWNLOADS_DIR}:`, err.message);
        }
    }

    const consumedFiles = new Set();

    const stripDateSuffix = (filename) => {
        if (!filename) return filename;
        let result = filename.replace(/_\d{2}-\d{2}-\d{2}--[a-zA-Z0-9_-]{11}\.(mp4|webm|mkv|m4a|mp3)$/i, '.$1');
        result = result.replace(/_\d{2}-\d{2}-\d{2}\.(mp4|webm|mkv|m4a|mp3)$/i, '.$1');
        return result;
    };

    const baseNamesMatch = (diskName, expectedName) => {
        if (!diskName || !expectedName) return false;
        const diskBase = diskName.replace(/\.[^.]+$/, '').toLowerCase();
        const expectedBase = expectedName.replace(/\.[^.]+$/, '').toLowerCase();
        const diskBaseNoDate = diskBase.replace(/_\d{2}-\d{2}-\d{2}$/, '');
        const diskBaseClean = diskBaseNoDate.replace(/\s*\(\d+\)$/, '');
        const expectedClean = expectedBase.replace(/\s*\(\d+\)$/, '');
        return diskBaseClean === expectedClean;
    };

    const syncResults = videos.map((video) => {
        const vidId = (video.id || video.videoId || '').toLowerCase();
        const expectedFilename = (video.finalFilename || '').toLowerCase();
        const expectedNoDate = stripDateSuffix(expectedFilename);
        const downloadFilename = (video.downloadFilename || '').toLowerCase();
        const sanitizedBase = video.sanitizedBase ? `${video.sanitizedBase.toLowerCase()}.mp4` : '';
        const sanitizedBaseNoDate = sanitizedBase ? stripDateSuffix(sanitizedBase) : '';
        const titleSanitized = sanitizeViaPython(video.title || '').toLowerCase() + '.mp4';
        const titleSanitizedNoDate = stripDateSuffix(titleSanitized);

        let matchingFile = downloadedFiles.find(f => {
            if (consumedFiles.has(f.path)) return false;
            const fname = f.name.toLowerCase();
            const fnameNoDate = stripDateSuffix(fname);

            if (expectedFilename && fname === expectedFilename) return true;
            if (expectedNoDate && fnameNoDate === expectedNoDate) return true;
            if (expectedNoDate && fname === expectedNoDate) return true;
            if (expectedFilename && fnameNoDate === expectedFilename) return true;
            if (downloadFilename && fname === downloadFilename) return true;
            if (downloadFilename && fnameNoDate === downloadFilename) return true;
            if (sanitizedBase && fname === sanitizedBase) return true;
            if (sanitizedBaseNoDate && fnameNoDate === sanitizedBaseNoDate) return true;
            if (sanitizedBaseNoDate && fname === sanitizedBaseNoDate) return true;
            if (titleSanitized && fname === titleSanitized) return true;
            if (titleSanitizedNoDate && fnameNoDate === titleSanitizedNoDate) return true;
            if (titleSanitizedNoDate && fname === titleSanitizedNoDate) return true;
            if (expectedFilename && baseNamesMatch(fname, expectedFilename)) return true;
            if (sanitizedBase && baseNamesMatch(fname, sanitizedBase)) return true;
            if (titleSanitized && baseNamesMatch(fname, titleSanitized)) return true;
            if (vidId && fname.includes(vidId)) return true;

            return false;
        });

        const isDownloaded = !!matchingFile;
        if (isDownloaded && matchingFile) {
            consumedFiles.add(matchingFile.path);
        }

        return {
            id: video.id || video.videoId,
            isDownloaded: isDownloaded,
            fileInfo: matchingFile ? {
                fileName: matchingFile.name,
                filePath: matchingFile.path,
                fileSize: matchingFile.size
            } : null
        };
    });

    const unmatchedVideos = videos.filter((v, i) => !syncResults[i].isDownloaded);
    const unconsumedFiles = downloadedFiles.filter(f => !consumedFiles.has(f.path));

    if (unmatchedVideos.length > 0 && unconsumedFiles.length > 0) {
        console.log(`[Disk Scan]  Reverse match: ${unmatchedVideos.length} unmatched videos, ${unconsumedFiles.length} unconsumed files`);

        for (const diskFile of unconsumedFiles) {
            const diskNameLower = diskFile.name.toLowerCase();
            const diskNameNoDate = stripDateSuffix(diskNameLower);
            const diskBaseClean = diskNameNoDate.replace(/\.[^.]+$/, '').replace(/_\d{2}-\d{2}-\d{2}$/, '').replace(/\s*\(\d+\)$/, '');

            let bestMatch = null;
            let bestMatchIdx = -1;
            let bestScore = 0;

            for (let vi = 0; vi < videos.length; vi++) {
                if (syncResults[vi].isDownloaded) continue;

                const video = videos[vi];
                const vidId = (video.id || video.videoId || '').toLowerCase();
                const titleLower = (video.title || '').toLowerCase();
                const sanitizedTitle = sanitizeViaPython(video.title || '').toLowerCase();

                let score = 0;

                if (vidId && diskNameLower.includes(vidId)) {
                    score = 100;
                } else if (sanitizedTitle && diskBaseClean === sanitizedTitle.replace(/\.[^.]+$/, '').replace(/\s*\(\d+\)$/, '')) {
                    score = 90;
                } else if (titleLower && titleLower.length > 10) {
                    const titleClean = titleLower.replace(/[^\w\s]/g, '').trim();
                    const diskClean = diskBaseClean.replace(/[^\w\s]/g, '').trim();
                    if (titleClean && diskClean && (diskClean.includes(titleClean) || titleClean.includes(diskClean))) {
                        score = 70;
                    }
                }

                if (score > bestScore) {
                    bestScore = score;
                    bestMatch = video;
                    bestMatchIdx = vi;
                }
            }

            if (bestMatch && bestScore >= 70) {
                console.log(`[Disk Scan]  Reverse match (score ${bestScore}): "${bestMatch.title?.substring(0, 40)}..."  ${diskFile.name}`);
                syncResults[bestMatchIdx] = {
                    id: bestMatch.id || bestMatch.videoId,
                    isDownloaded: true,
                    fileInfo: {
                        fileName: diskFile.name,
                        filePath: diskFile.path,
                        fileSize: diskFile.size
                    }
                };
                consumedFiles.add(diskFile.path);
                bestMatch.finalFilename = diskFile.name;
                bestMatch.filePath = diskFile.path;
            }
        }
    }

    const videoStatuses = syncResults.map(v => ({
        videoId: v.id,
        exists: v.isDownloaded,
        filename: v.fileInfo ? v.fileInfo.fileName : null,
        filePath: v.fileInfo ? v.fileInfo.filePath : null
    }));

    videos.forEach(v => {
        const vidId = v.id || v.videoId;
        const statusMatch = videoStatuses.find(st => st.videoId === vidId);
        if (statusMatch) {
            v.syncStatus = statusMatch.exists ? 'downloaded' : 'new';
            if (statusMatch.filename) {
                v.finalFilename = statusMatch.filename;
                v.filePath = statusMatch.filePath;
            }
            if (statusMatch.exists) {
                v.downloadStatus = 'completed';
            } else {
                if (v.downloadStatus === 'completed') {
                    v.downloadStatus = null;
                }
            }
        }
    });

    return {
        total: videos.length,
        downloaded: syncResults.filter(v => v.isDownloaded).length,
        videoStatuses: videoStatuses,
        syncResults: syncResults
    };
}

const handleChannelSync = (req, res) => {
    const { id } = req.params;
    console.log('\n[Sync] GET /api/channels/' + id + '/sync-status');

    try {
        if (!savedChannels.has(id)) {
            return res.status(404).json({ success: false, error: 'Channel not found' });
        }

        const channel = savedChannels.get(id);

        console.log('[Sync] Performing disk scan for channel:', channel.name);
        const scanRes = performDiskScanForChannel(channel);
        initialDiskSyncDone = true;
        saveDatabase();

        const videos = channel.videos || [];
        const totalVideos = videos.length;
        const downloadedCount = scanRes.downloaded;
        const remainingCount = totalVideos - downloadedCount;

        res.json({
            success: true,
            channelId: id,
            channelName: channel.name,
            statistics: {
                total: totalVideos,
                downloaded: downloadedCount,
                remaining: remainingCount,
                percentage: totalVideos > 0 ? ((downloadedCount / totalVideos) * 100).toFixed(1) : 0
            },
            videos: videos,
            videoStatuses: scanRes.videoStatuses,
            scannedAt: new Date().toISOString()
        });

    } catch (error) {
        console.error('[Sync]  Error:', error.message);
        res.status(500).json({
            success: false,
            error: 'Failed to check sync status: ' + error.message
        });
    }
};

app.post('/api/channels/save-all', (req, res) => {
    console.log('\n[Save Channels] POST /api/channels/save-all requested');
    try {
        const clientChannels = req.body && Array.isArray(req.body.channels) ? req.body.channels : [];
        let savedCount = 0;
        let deletedCount = 0;

        const clientIds = new Set(clientChannels.map(ch => ch && ch.id).filter(Boolean));
        for (const id of Array.from(savedChannels.keys())) {
            if (!clientIds.has(id)) {
                const removed = savedChannels.get(id);
                savedChannels.delete(id);
                deletedCount++;
                console.log(`[Save Channels]  Removed orphan channel: ${removed?.name || id}`);
            }
        }

        clientChannels.forEach(ch => {
            if (ch && ch.id) {
                savedChannels.set(ch.id, ch);
                savedCount++;
            }
        });

        saveDatabase();
        console.log(`[Save Channels]  Persisted ${savedCount} channels, removed ${deletedCount} orphans`);

        res.json({
            success: true,
            savedCount: savedCount,
            deletedCount: deletedCount,
            totalChannels: savedChannels.size,
            message: `Saved ${savedCount} channels${deletedCount > 0 ? `, removed ${deletedCount} orphan(s)` : ''}`
        });
    } catch (error) {
        console.error('[Save Channels] Error:', error.message);
        res.status(500).json({ success: false, error: 'Failed to save channels: ' + error.message });
    }
});

app.post('/api/channels/sync-all', (req, res) => {
    console.log('\n[Sync All] POST /api/channels/sync-all requested');
    try {
        const clientChannels = req.body && Array.isArray(req.body.channels) ? req.body.channels : [];
        clientChannels.forEach(c => {
            if (c && c.id && !savedChannels.has(c.id)) {
                savedChannels.set(c.id, c);
            }
        });

        const channelSyncResults = {};
        for (const [id, channel] of savedChannels.entries()) {
            const scanRes = performDiskScanForChannel(channel);
            savedChannels.set(id, channel);

            channelSyncResults[id] = {
                channelId: id,
                channelName: channel.name,
                statistics: {
                    total: scanRes.total,
                    downloaded: scanRes.downloaded,
                    remaining: scanRes.total - scanRes.downloaded
                },
                videoStatuses: scanRes.videoStatuses
            };
        }

        initialDiskSyncDone = true;
        saveDatabase();

        res.json({
            success: true,
            results: channelSyncResults,
            syncedAt: new Date().toISOString()
        });
    } catch (error) {
        console.error('[Sync All] Error:', error.message);
        res.status(500).json({ success: false, error: 'Failed to sync all channels: ' + error.message });
    }
});

// ===== SYNC LOCK =====
let _syncAllInProgress = false;
// ======================

// =============================================================================
// Sync only channels that had downloads in the last N minutes.
// =============================================================================
app.post('/api/channels/sync-recent-stream', async (req, res) => {
    if (_syncAllInProgress) {
        console.warn('[Sync Recent] Sync already in progress - rejecting concurrent call');
        return res.status(429).json({ success: false, error: 'Sync already in progress' });
    }
    _syncAllInProgress = true;

    console.log('\n[Sync Recent Stream] POST /api/channels/sync-recent-stream requested');

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const heartbeat = setInterval(() => {
        try { res.write(': heartbeat\n\n'); } catch (e) {}
    }, 15000);

    try {
        const clientChannels = req.body && Array.isArray(req.body.channels) ? req.body.channels : [];
        clientChannels.forEach(c => {
            if (c && c.id && !savedChannels.has(c.id)) savedChannels.set(c.id, c);
        });

        const recentIds = getRecentlyDownloadedChannelIds();
        const toSync = recentIds
            .map(id => [id, savedChannels.get(id)])
            .filter(([, ch]) => !!ch);

        const totalChannels = toSync.length;

        if (totalChannels === 0) {
            sseSend(res, 'start', {
                totalChannels: 0,
                message: 'No channels downloaded recently - nothing to sync.'
            });
            const donePayload = {
                success: true,
                results: {},
                syncedAt: new Date().toISOString(),
                totalChannels: 0,
                processed: 0,
                mode: 'recent',
                message: 'No recent downloads - sync skipped'
            };
            sseSend(res, 'done', donePayload);
            sseSend(res, 'complete', donePayload);
            clearInterval(heartbeat);
            res.end();
            return;
        }

        console.log(`[Sync Recent] Syncing ${totalChannels} recently-downloaded channel(s):`);
        toSync.forEach(([id, ch]) => console.log(`  - ${ch.name || id}`));

        const channelSyncResults = {};
        let processed = 0;

        sseSend(res, 'start', {
            totalChannels,
            message: `Starting sync for ${totalChannels} recently-downloaded channel(s)`
        });

        for (const [id, channel] of toSync) {
            const channelName = channel.name || id;
            const index = processed + 1;

            sseSend(res, 'channel_start', {
                index, total: totalChannels, channelId: id, channelName,
                message: `Scanning channel ${index}/${totalChannels}: ${channelName}`
            });

            const scanRes = performDiskScanForChannel(channel);
            savedChannels.set(id, channel);

            channelSyncResults[id] = {
                channelId: id,
                channelName,
                statistics: {
                    total: scanRes.total,
                    downloaded: scanRes.downloaded,
                    remaining: scanRes.total - scanRes.downloaded
                },
                videoStatuses: scanRes.videoStatuses
            };

            processed++;
            const percentage = totalChannels > 0
                ? Math.round((processed / totalChannels) * 100)
                : 100;

            sseSend(res, 'channel_done', {
                index, total: totalChannels, channelId: id, channelName,
                downloaded: scanRes.downloaded,
                totalVideos: scanRes.total,
                remaining: scanRes.total - scanRes.downloaded,
                percentage,
                message: `OK ${channelName}: ${scanRes.downloaded}/${scanRes.total} downloaded`
            });

            sseSend(res, 'progress', {
                processed, total: totalChannels, percentage,
                message: `Syncing ${processed}/${totalChannels} (${percentage}%)`
            });
        }

        initialDiskSyncDone = true;
        saveDatabase();

        clearInterval(heartbeat);

        const donePayload = {
            success: true,
            results: channelSyncResults,
            syncedAt: new Date().toISOString(),
            totalChannels,
            processed,
            mode: 'recent',
            message: `Recent sync complete for ${totalChannels} channel(s)`
        };

        sseSend(res, 'done', donePayload);
        sseSend(res, 'complete', donePayload);
        res.end();
    } catch (error) {
        console.error('[Sync Recent Stream] Error:', error.message);
        clearInterval(heartbeat);
        sseSend(res, 'error', { message: 'Failed to sync recent channels: ' + error.message });
        res.end();
    } finally {
        _syncAllInProgress = false;
        console.log('[Sync Recent] Lock released');
    }
});

app.get('/api/channels/recent-downloads', (req, res) => {
    const ids = getRecentlyDownloadedChannelIds();
    const channelsList = ids
        .map(id => savedChannels.get(id))
        .filter(Boolean)
        .map(ch => ({ id: ch.id, name: ch.name }));

    res.json({
        success: true,
        count: channelsList.length,
        windowMinutes: RECENT_DOWNLOAD_WINDOW_MS / 60000,
        channels: channelsList
    });
});

app.post('/api/channels/sync-all-stream', async (req, res) => {
    if (_syncAllInProgress) {
        console.warn('[Sync All] Sync already in progress - rejecting concurrent call');
        return res.status(429).json({ success: false, error: 'Sync already in progress' });
    }
    _syncAllInProgress = true;

    console.log('\n[Sync All Stream] POST /api/channels/sync-all-stream requested');

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const heartbeat = setInterval(() => {
        try { res.write(': heartbeat\n\n'); } catch (e) {}
    }, 15000);

    try {
        const clientChannels = req.body && Array.isArray(req.body.channels) ? req.body.channels : [];
        clientChannels.forEach(c => {
            if (c && c.id && !savedChannels.has(c.id)) {
                savedChannels.set(c.id, c);
            }
        });

        const allChannels = Array.from(savedChannels.entries());
        const totalChannels = allChannels.length;
        const channelSyncResults = {};
        let processed = 0;

        sseSend(res, 'start', {
            totalChannels,
            message: `Starting sync for ${totalChannels} channel(s)`
        });

        for (const [id, channel] of allChannels) {
            const channelName = channel.name || id;
            const index = processed + 1;

            sseSend(res, 'channel_start', {
                index,
                total: totalChannels,
                channelId: id,
                channelName,
                message: `Scanning channel ${index}/${totalChannels}: ${channelName}`
            });

            const scanRes = performDiskScanForChannel(channel);
            savedChannels.set(id, channel);

            channelSyncResults[id] = {
                channelId: id,
                channelName,
                statistics: {
                    total: scanRes.total,
                    downloaded: scanRes.downloaded,
                    remaining: scanRes.total - scanRes.downloaded
                },
                videoStatuses: scanRes.videoStatuses
            };

            processed++;
            const percentage = totalChannels > 0
                ? Math.round((processed / totalChannels) * 100)
                : 100;

            sseSend(res, 'channel_done', {
                index,
                total: totalChannels,
                channelId: id,
                channelName,
                downloaded: scanRes.downloaded,
                totalVideos: scanRes.total,
                remaining: scanRes.total - scanRes.downloaded,
                percentage,
                message: ` ${channelName}: ${scanRes.downloaded}/${scanRes.total} downloaded`
            });

            sseSend(res, 'progress', {
                processed,
                total: totalChannels,
                percentage,
                message: `Syncing ${processed}/${totalChannels} (${percentage}%)`
            });
        }

        initialDiskSyncDone = true;
        saveDatabase();

        clearInterval(heartbeat);
        sseSend(res, 'done', {
            success: true,
            results: channelSyncResults,
            syncedAt: new Date().toISOString(),
            totalChannels,
            processed,
            message: `Sync complete for ${totalChannels} channel(s)`
        });
        //  FIX: also emit `complete`  the frontend's Promise waits for this
        // event to resolve. Without it, the Sync button stays disabled forever
        // and subsequent sync attempts become no-ops.
        sseSend(res, 'complete', {
            success: true,
            results: channelSyncResults,
            syncedAt: new Date().toISOString(),
            totalChannels,
            processed,
            message: `Sync complete for ${totalChannels} channel(s)`
        });
        res.end();
    } catch (error) {
        console.error('[Sync All Stream] Error:', error.message);
        clearInterval(heartbeat);
        sseSend(res, 'error', { message: 'Failed to sync all channels: ' + error.message });
        res.end();
    } finally {
        _syncAllInProgress = false;
        console.log('[Sync All] Lock released');
    }
});

app.get('/api/channels/:id/sync-status', handleChannelSync);
app.get('/api/channels/:id/sync', handleChannelSync);
app.post('/api/channels/:id/sync', handleChannelSync);

app.post('/api/channels/:id/refresh', async (req, res) => {
    const { id } = req.params;
    console.log('\n' + '='.repeat(80));
    console.log('[Refresh Channel] POST /api/channels/' + id + '/refresh');
    console.log('='.repeat(80));

    try {
        if (!savedChannels.has(id)) {
            return res.status(404).json({ success: false, error: 'Channel not found' });
        }

        const channel = savedChannels.get(id);
        console.log('[Refresh Channel] Channel:', channel.name);
        console.log('[Refresh Channel] Current video count:', (channel.videos || []).length);

        const channelData = await fetchChannelInfo(channel.youtubeId, channel.url);
        const freshVideos = channelData.videos || [];

        const existingVideoIds = new Set((channel.videos || []).map(v => v.id || v.videoId));
        const newVideos = [];

        freshVideos.forEach(freshVideo => {
            const vidId = freshVideo.id;
            if (!existingVideoIds.has(vidId)) {
                newVideos.push(freshVideo);
            }
        });

        console.log('[Refresh Channel] Fresh videos from YouTube:', freshVideos.length);
        console.log('[Refresh Channel] Already known:', freshVideos.length - newVideos.length);
        console.log('[Refresh Channel] New videos found:', newVideos.length);

        if (newVideos.length > 0) {
            const existingVideos = channel.videos || [];
            const combinedVideos = [...newVideos, ...existingVideos];
            const dedupedVideos = resolveDuplicatesWithDuration(combinedVideos);

            channel.videos = dedupedVideos;
            channel.videoCount = dedupedVideos.length;
            channel.lastChecked = new Date().toISOString();

            savedChannels.set(channel.id, channel);
            saveDatabase();

            const scanRes = performDiskScanForChannel(channel);
            saveDatabase();

            res.json({
                success: true,
                message: `Channel refreshed: ${newVideos.length} new video(s) found`,
                newVideoCount: newVideos.length,
                totalVideoCount: dedupedVideos.length,
                previousVideoCount: existingVideoIds.size,
                newVideos: newVideos.map(v => ({
                    id: v.id,
                    title: v.title,
                    duration: v.duration,
                    views: v.views,
                    uploadDate: v.uploadDate,
                    finalFilename: v.finalFilename,
                    syncStatus: v.syncStatus,
                    displayTitle: v.displayTitle
                })),
                channel: channel,
                scanResults: {
                    total: scanRes.total,
                    downloaded: scanRes.downloaded,
                    remaining: scanRes.total - scanRes.downloaded
                }
            });
        } else {
            channel.lastChecked = new Date().toISOString();
            savedChannels.set(channel.id, channel);
            saveDatabase();

            res.json({
                success: true,
                message: 'Channel is already up to date  no new videos found',
                newVideoCount: 0,
                totalVideoCount: (channel.videos || []).length,
                previousVideoCount: existingVideoIds.size,
                newVideos: [],
                channel: channel
            });
        }

        console.log('='.repeat(80) + '\n');

    } catch (error) {
        console.error('[Refresh Channel]  Error:', error.message);
        console.log('='.repeat(80) + '\n');
        res.status(500).json({
            success: false,
            error: 'Failed to refresh channel: ' + error.message
        });
    }
});

app.post('/api/channels/:id/stop', (req, res) => {
    const { id } = req.params;
    console.log(`\n[Channel Action]  STOP requested for channel downloads: ${id}`);

    let stoppedCount = 0;

    const filterFunc = job => {
        const downloadObj = downloadManager.get(job.downloadId);
        const matches = downloadObj && downloadObj.channelId === id;
        if (matches) {
            downloadManager.update(job.downloadId, { status: 'cancelled', cancelledAt: new Date().toISOString() });
            stoppedCount++;
        }
        return !matches;
    };
    downloadQueue.queue = downloadQueue.queue.filter(filterFunc);
    downloadQueue.pendingBuffer = downloadQueue.pendingBuffer.filter(filterFunc);
    downloadQueue.replenishQueue();

    const allDownloads = downloadManager.getAll();
    allDownloads.forEach(d => {
        if (d.channelId === id && (d.status === 'downloading' || d.status === 'queued')) {
            downloadManager.update(d.id, { status: 'cancelled', cancelledAt: new Date().toISOString() });
            stoppedCount++;
        }
    });

    res.json({
        success: true,
        channelId: id,
        stoppedCount: stoppedCount,
        message: `Stopped ${stoppedCount} downloads for channel`
    });
});

app.delete('/api/channels/:id', (req, res) => {
    const { id } = req.params;
    console.log('\n[Channels] DELETE /api/channels/' + id);

    if (savedChannels.has(id)) {
        savedChannels.delete(id);
        try { sqliteDb.deleteChannel(id); } catch (e) { console.warn('[Database] Delete failed:', e.message); }
        res.json({ success: true, message: 'Channel deleted successfully' });
    } else {
        res.status(404).json({ success: false, error: 'Channel not found' });
    }
});

// =============================================================================
// DOWNLOAD QUEUE ENDPOINTS
// =============================================================================

app.get('/api/download-queue', (req, res) => {
    const queueStatus = downloadQueue.getStatus();

    const active = queueStatus.activeDownloads.map(d => {
        const fullDl = downloadManager.get(d.id) || {};
        return {
            id: d.id,
            videoId: fullDl.videoId,
            title: d.title || fullDl.title,
            filename: fullDl.filename,
            channelName: fullDl.channelName || null,
            status: 'downloading',
            progress: fullDl.progress || 0,
            speed: fullDl.speed || null,
            downloaded: fullDl.downloaded || null,
            total: fullDl.total || null,
            startTime: fullDl.startTime,
            url: fullDl.url,
            format: fullDl.format,
            quality: fullDl.quality,
            finalFilename: fullDl.finalFilename || null,
            renamedFrom: fullDl.renamedFrom || null,
            error: fullDl.error || null
        };
    });

    const queued = downloadQueue.queue.map(job => {
        const fullDl = downloadManager.get(job.downloadId) || {};
        return {
            id: job.downloadId,
            videoId: fullDl.videoId,
            title: job.videoTitle || fullDl.title,
            filename: fullDl.filename,
            channelName: fullDl.channelName || null,
            status: 'queued',
            progress: 0,
            url: fullDl.url
        };
    });

    const activeAndQueued = [...active, ...queued];

    const completed = downloadManager.getCompleted().map(d => ({
        id: d.id,
        videoId: d.videoId,
        title: d.title,
        filename: d.filename,
        status: d.status,
        progress: 100,
        finalFilename: d.finalFilename || d.filename,
        renamedFrom: d.renamedFrom || null,
        completedAt: d.endTime,
        size: d.finalSize || null,
        error: d.error || null
    }));

    res.json({
        success: true,
        queue: {
            active: activeAndQueued,
            completed: completed
        },
        pendingBufferCount: downloadQueue.pendingBuffer.length,
        timestamp: new Date().toISOString()
    });
});

app.delete('/api/download-queue', (req, res) => {
    const completed = downloadManager.getCompleted();
    completed.forEach(d => downloadManager.remove(d.id));

    res.json({
        success: true,
        message: `Cleared ${completed.length} completed downloads`,
        remaining: downloadManager.getAll().length
    });
});

// =============================================================================
// DOWNLOAD EXECUTION
// =============================================================================

function executeSmartDownload(downloadId, videoUrl, outputPath, videoTitle) {
    if (_activeDownloadIds.has(downloadId)) {
        console.warn(`[Smart Download]  DUPLICATE SPAWN BLOCKED: ${videoTitle?.substring(0, 30)}...`);
        return Promise.resolve({ success: true, message: 'Download already in progress (duplicate spawn blocked)' });
    }

    _activeDownloadIds.add(downloadId);

    const download = downloadManager.get(downloadId);
    if (!download) {
        _activeDownloadIds.delete(downloadId);
        console.error('[Smart Download] Download not found:', downloadId);
        return Promise.reject(new Error('Download not found'));
    }

    console.log(`\n[Smart Download]  Starting SMART download for: ${videoTitle}`);
    console.log(`[Smart Download] ID: ${downloadId}`);

    downloadManager.update(downloadId, { status: 'downloading', startTime: Date.now() });

    return analyzeVideoFormats(videoUrl)
        .then(formatInfo => {
            console.log(`[Smart Download]  Format analysis complete:`);
            console.log(`   Selected: ${formatInfo.formatId} (${formatInfo.resolution}, ${formatInfo.ext})`);

            downloadManager.update(downloadId, { selectedFormat: formatInfo });

            return executeDownloadWithFormat(downloadId, videoUrl, outputPath, formatInfo, videoTitle);
        })
        .then(result => {
            console.log(`[Smart Download]  Download complete!`);
            return renameDownloadedFile(download, outputPath);
        })
        .then(renameResult => {
            console.log(`[Smart Download]  Rename result:`, renameResult);

            downloadManager.update(downloadId, {
                status: 'completed',
                progress: 100,
                endTime: Date.now(),
                ...(renameResult.success ? {
                    finalFilename: renameResult.filename,
                    renamedFrom: renameResult.originalFilename,
                    finalSize: renameResult.size
                } : {})
            });

            console.log(`[Smart Download]  Download job ${downloadId} completed successfully`);
            return renameResult;
        })
        .catch(error => {
            console.error(`[Smart Download]  Error:`, error.message);

            downloadManager.update(downloadId, {
                status: 'error',
                error: error.message,
                endTime: Date.now()
            });

            throw error;
        })
        .finally(() => {
            _activeDownloadIds.delete(downloadId);
        });
}

function executeDownloadWithFormat(downloadId, videoUrl, outputPath, formatInfo, videoTitle) {
    return new Promise(async (resolve, reject) => {
        const download = downloadManager.get(downloadId);
        if (!download) return reject(new Error('Download not found'));

        console.log(`\n[Execute Download] Starting: ${videoTitle}`);
        console.log(`[Execute Download] Format: ${formatInfo.formatId} (${formatInfo.resolution})`);

        const isLiveStreamVideo = videoTitle.toLowerCase().includes('live') ||
                                   videoTitle.toLowerCase().includes('stream') ||
                                   formatInfo.isLiveStream;

        const outputDir = path.dirname(outputPath);
        const tempFilename = `ytl_${downloadId}.mp4`;
        const tempPath = path.join(outputDir, tempFilename);

        console.log(`[Execute Download]  WINDOWS PATH FIX ACTIVE`);
        console.log(`[Execute Download] Temp file (short): ${tempFilename}`);

        //  3-step format escalation ladder.
        //    attemptIndex = 0 -> baseline format
        //    attemptIndex = 1 -> next-higher existing format
        //    attemptIndex = 2 -> one more higher
        //    On 403 -> increment. Cap at 2 (3 attempts total).
        const escalationLadder = Array.isArray(formatInfo.escalationLadder) && formatInfo.escalationLadder.length > 0
            ? formatInfo.escalationLadder
            : [{ formatId: formatInfo.formatId, resolution: formatInfo.resolution, vcodec: formatInfo.vcodec, ext: formatInfo.ext }];
        let attemptIndex = 0;

        const buildSelectorForAttempt = (idx) => {
            // Each rung carries its own needsMerge + audioFormatId so mixed
            // muxed/merge ladders work without a global "needsMerge" flag.
            const step = escalationLadder[Math.min(idx, escalationLadder.length - 1)];
            if (step.needsMerge) {
                const audio = step.audioFormatId || formatInfo.audioFormatId || 'bestaudio';
                return `${step.formatId}+${audio}`;
            }
            return step.formatId;
        };

        let formatSelector = buildSelectorForAttempt(0);
        if (escalationLadder.length > 1) {
            console.log(`[Execute Download]  Escalation ladder ready: ${escalationLadder.length} step(s) (${escalationLadder.map(s => s.formatId).join(' -> ')})`);
        }

        const baseArgs = YTDLP_GLOBAL_FLAGS_ARR.concat([
            '-f', formatSelector,
            '-o', tempPath,
            '--no-playlist',
            '--merge-output-format', 'mp4',
            videoUrl                          //  PATCH: URL must be in baseArgs
        ]);                                   //    so escalation retries include it

        if (isLiveStreamVideo) {
            baseArgs.push('--wait-for-video', '0.1');
            baseArgs.push('--no-check-certificates');
            baseArgs.push('--socket-timeout', '60');
            console.log(`[Execute Download]  Added live stream compatibility flags`);
        }

        if (FFMPEG_AVAILABLE) {
            console.log('[Execute Download]  FFmpeg available for merging');
        } else {
            console.warn('[Execute Download]  FFmpeg NOT detected  DASH merge may fail');
        }

        const cookieStrategies = [];
        cookieStrategies.push({
            name: 'No cookies (public access)',
            args: []
        });
        if (isCookiesFileValid(false) && fs.existsSync(AUTH_CONFIG.cookieFilePath)) {
            cookieStrategies.push({
                name: 'cookies.txt file',
                args: ['--cookies', AUTH_CONFIG.cookieFilePath],
                type: 'file'
            });
        }
        const browserName = AUTH_CONFIG.browserName || 'edge';
        cookieStrategies.push({
            name: `Browser (${browserName})`,
            args: ['--cookies-from-browser', browserName],
            type: 'browser'
        });
        cookieStrategies.push({
            name: 'Refresh cookies via Edge browse (Strategy 4)',
            args: [],
            type: 'refresh'
        });

        let strategyIdx = 0;

        const tryDownloadWithStrategy = () => {
            if (strategyIdx >= cookieStrategies.length) {
                reject(new Error('All cookie strategies failed - see previous error logs in server terminal'));
                return;
            }

            const strategy = cookieStrategies[strategyIdx];
            strategyIdx++;

            if (strategy.type === 'refresh') {
                if (strategy._consumed) {
                    console.log('[Execute Download]  Strategy 4 already consumed in this chain  skipping past');
                    tryDownloadWithStrategy();
                    return;
                }
                strategy._consumed = true;

                console.log(`\n[Execute Download]  Strategy ${strategyIdx}/${cookieStrategies.length}: Refreshing cookies via Edge browse...`);
                refreshCookiesViaEdgeBrowse().then(refreshResult => {
                    if (refreshResult.success || refreshResult.reason === 'cooldown') {
                        const hasFileStrat = cookieStrategies.some(s => s.type === 'file');
                        if (!hasFileStrat
                            && isCookiesFileValid(false)
                            && fs.existsSync(AUTH_CONFIG.cookieFilePath)) {
                            const insertIdx = strategyIdx - 1;
                            cookieStrategies.splice(insertIdx, 0, {
                                name: 'cookies.txt file',
                                args: ['--cookies', AUTH_CONFIG.cookieFilePath],
                                type: 'file'
                            });
                            console.log('[Execute Download]  Spliced cookies.txt entry after Strategy 4 refresh');
                            strategyIdx = insertIdx;
                        } else if (hasFileStrat) {
                            const fileIdx = cookieStrategies.findIndex(s => s.type === 'file');
                            strategyIdx = fileIdx;
                            console.log(`[Execute Download]  Retrying Strategy 2 (cookies.txt) at index ${fileIdx}`);
                        } else {
                            console.error('[Execute Download]  Strategy 4 completed but cookies.txt still missing/invalid');
                            reject(new Error('Strategy 4 (' + refreshResult.reason + '): cookies.txt still invalid after refresh'));
                            return;
                        }
                        tryDownloadWithStrategy();
                    } else {
                        console.error(`[Execute Download]  Strategy 4 failed (${refreshResult.reason})`);
                        reject(new Error('Strategy 4 (' + refreshResult.reason + '): all cookie strategies failed'));
                    }
                }).catch(err => {
                    console.error('[Execute Download]  Strategy 4 unexpected error:', err.message);
                    reject(err);
                });
                return;
            }

            const args = baseArgs.concat(strategy.args);
            //  PATCH: URL already in baseArgs  no need to push again

            console.log(`\n[Execute Download] Cookie strategy ${strategyIdx}/${cookieStrategies.length}: ${strategy.name}`);
            console.log(`[Execute Download] Command: ${YTDLP_BIN} ${args.join(' ').substring(0, 200)}...`);

            const ytDlpProcess = spawn(YTDLP_BIN, args, {
                stdio: ['pipe', 'pipe', 'pipe'],
                shell: false,
                windowsHide: true,
                cwd: outputDir
            });

            activeChildProcesses.set(downloadId, {
                proc: ytDlpProcess,
                videoUrl,
                outputPath,
                videoTitle,
                formatInfo
            });

            let stdoutData = '';
            let stderrData = '';

            ytDlpProcess.stdout.on('data', (data) => {
                stdoutData += data.toString();

                const progressMatch = stdoutData.match(/(\d+\.?\d*)%/);
                if (progressMatch) {
                    const percent = parseFloat(progressMatch[1]);
                    downloadManager.update(downloadId, { progress: percent });

                    const speedMatch = stdoutData.match(/(\d+\.?\d*\s*(?:MiB|KiB|GiB)\/s)/);
                    const sizeMatch = stdoutData.match(/of\s+(\d+\.?\d*\s*(?:MiB|KiB|GiB))/);

                    if (speedMatch) downloadManager.update(downloadId, { speed: speedMatch[1] });
                    if (sizeMatch) downloadManager.update(downloadId, { total: sizeMatch[1] });
                }
            });

            ytDlpProcess.stderr.on('data', (data) => {
                stderrData += data.toString();
            });

            ytDlpProcess.on('error', (err) => {
                activeChildProcesses.delete(downloadId);
                console.error(`[Execute Download] Spawn error (strategy ${strategyIdx}):`, err.message);
                tryDownloadWithStrategy();
            });

            ytDlpProcess.on('close', (code) => {
                activeChildProcesses.delete(downloadId);
                if (code === 0) {
                    console.log(`[Execute Download] Download complete (strategy ${strategyIdx}: ${strategy.name})`);

                    let actualFile = path.join(outputDir, `ytl_${downloadId}.mp4`);
                    let orphanedTempFiles = [];

                    if (!fs.existsSync(actualFile)) {
                        const possibleExts = ['.mp4', '.webm', '.mkv'];
                        for (const ext of possibleExts) {
                            const candidate = path.join(outputDir, `ytl_${downloadId}${ext}`);
                            if (fs.existsSync(candidate)) {
                                actualFile = candidate;
                                break;
                            }
                        }

                        //  FIX: yt-dlp may leave format-tagged files like
                        //   ytl_<uuid>.f160.mp4, ytl_<uuid>.f251.webm when ffmpeg
                        //   merge fails. Scan the directory for any file starting
                        //   with "ytl_<uuid>" and pick the largest (video stream).
                        if (!fs.existsSync(actualFile)) {
                            try {
                                const allFiles = fs.readdirSync(outputDir);
                                const prefix = `ytl_${downloadId}`;
                                const candidates = allFiles
                                    .filter(f => f.startsWith(prefix) && !f.endsWith('.part') && !f.endsWith('.ytdl'))
                                    .map(f => ({
                                        name: f,
                                        path: path.join(outputDir, f),
                                        size: fs.statSync(path.join(outputDir, f)).size
                                    }))
                                    .sort((a, b) => b.size - a.size);

                                if (candidates.length > 0) {
                                    actualFile = candidates[0].path;
                                    orphanedTempFiles = candidates.map(c => c.path);
                                    console.warn(`[Execute Download]  FFmpeg merge failed  using largest partial: ${candidates[0].name} (${(candidates[0].size / 1024 / 1024).toFixed(2)} MB)`);
                                    if (candidates.length > 1) {
                                        console.warn(`[Execute Download]    ${candidates.length - 1} orphan(s) will be cleaned up after rename`);
                                    }
                                }
                            } catch (scanErr) {
                                console.warn(`[Execute Download]  Fallback scan failed:`, scanErr.message);
                            }
                        }
                    }

                    if (!actualFile || !fs.existsSync(actualFile)) {
                        reject(new Error('Download completed but output file not found'));
                        return;
                    }

                    const stats = fs.statSync(actualFile);
                    console.log(`[Execute Download] Downloaded: ${path.basename(actualFile)} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);

                    try {
                        const originalBaseName = path.basename(outputPath, '.mp4');
                        const sanitizedBaseName = sanitizeViaPython(originalBaseName);

                        const MAX_TOTAL_PATH = process.platform === 'win32' ? 250 : 1024;
                        const ext = '.mp4';
                        const dateSuffixBudget = 12;
                        const dirLen = outputDir.length + 1;
                        const maxBaseLen = Math.max(20, MAX_TOTAL_PATH - dirLen - ext.length - dateSuffixBudget);

                        let safeBaseName = sanitizedBaseName;
                        if (safeBaseName.length > maxBaseLen) {
                            safeBaseName = safeBaseName.substring(0, maxBaseLen);
                            console.log(`[Execute Download]  Base name truncated to ${maxBaseLen} chars`);
                        }

                        const safeFilename = ensureUniqueOnDisk(outputDir, safeBaseName + ext);
                        let finalPath = path.join(outputDir, safeFilename);

                        fs.renameSync(actualFile, finalPath);
                        console.log(`[Execute Download]  Renamed to: ${path.basename(finalPath)}`);

                        let currentFilename = path.basename(finalPath);

                        //  FIX: if the file still has a ytl_<uuid> temp name
                        // (because the title-based rename was skipped by
                        // renameDownloadedFile due to a truthy finalFilename
                        // from the frontend), force a rename using the download's
                        // title BEFORE the date-stamp step runs.
                        const leakCheck = recoverFromTempNameLeak(finalPath, download, outputDir);
                        if (leakCheck.recovered) {
                            finalPath = leakCheck.path;
                            currentFilename = leakCheck.filename;
                        }

                        //  FIX: Clean up orphaned format-tagged temp files
                        // (e.g. ytl_<uuid>.f251.webm audio stream left behind
                        // when ffmpeg couldn't merge).
                        if (orphanedTempFiles.length > 0) {
                            for (const orphanPath of orphanedTempFiles) {
                                if (orphanPath === actualFile) continue;
                                try {
                                    if (fs.existsSync(orphanPath)) {
                                        fs.unlinkSync(orphanPath);
                                        console.log(`[Execute Download]  Cleaned up orphan: ${path.basename(orphanPath)}`);
                                    }
                                } catch (cleanErr) {
                                    console.warn(`[Execute Download]  Could not clean orphan ${path.basename(orphanPath)}:`, cleanErr.message);
                                }
                            }
                        }

                        let vidId = download.videoId;
                        if (!vidId) {
                            const vMatch = (videoUrl || '').match(/(?:v=|\/v\/|youtu\.be\/|embed\/)([a-zA-Z0-9_-]{11})/);
                            if (vMatch) vidId = vMatch[1];
                        }

                        const applyDateStampAndFinish = (uploadDate) => {
                            try {
                                if (uploadDate) {
                                    const stampedFilename = applyDateStampToFilename(currentFilename, uploadDate, undefined, vidId);
                                    if (stampedFilename && stampedFilename !== currentFilename) {
                                        const safeStampedName = ensureUniqueOnDisk(outputDir, stampedFilename);
                                        const stampedPath = path.join(outputDir, safeStampedName);
                                        fs.renameSync(finalPath, stampedPath);
                                        console.log(`[Execute Download]  Date-stamped: ${path.basename(stampedPath)}`);

                                        downloadManager.update(downloadId, {
                                            filename: safeStampedName,
                                            finalFilename: safeStampedName,
                                            uploadDate: uploadDate
                                        });

                                        try {
                                            if (download.channelId && savedChannels.has(download.channelId)) {
                                                const ch = savedChannels.get(download.channelId);
                                                const vids = ch.videos || [];
                                                const v = vids.find(x => (x.id || x.videoId) === vidId);
                                                if (v) {
                                                    v.finalFilename = safeStampedName;
                                                    v.uploadDate = uploadDate;
                                                    saveDatabase();
                                                }
                                            }
                                        } catch (dbErr) {
                                            console.warn(`[Execute Download]  Could not sync DB finalFilename:`, dbErr.message);
                                        }
                                    }
                                }
                                resolve({
                                    success: true,
                                    path: finalPath,
                                    size: stats.size,
                                    renamedFrom: path.basename(actualFile)
                                });
                            } catch (stampErr) {
                                console.warn(`[Execute Download]  Date-stamp step failed (non-fatal):`, stampErr.message);
                                resolve({
                                    success: true,
                                    path: finalPath,
                                    size: stats.size,
                                    renamedFrom: path.basename(actualFile),
                                    warning: 'Date-stamp failed: ' + stampErr.message
                                });
                            }
                        };

                        if (hasDateStampSuffix(currentFilename)) {
                            console.log(`[Execute Download]  File already has date suffix  skipping`);
                            applyDateStampAndFinish(null);
                        } else if (!vidId) {
                            console.log(`[Execute Download]  No videoId available  skipping date stamp`);
                            applyDateStampAndFinish(null);
                        } else {
                            console.log(`[Execute Download]  Fetching upload date for ${vidId}`);
                            getVideoUploadDateFromYouTube(vidId).then(applyDateStampAndFinish);
                        }

                    } catch (renameErr) {
                        console.error(`[Execute Download]  Rename failed:`, renameErr.message);
                        const tempFile = path.join(outputDir, `ytl_${downloadId}.mp4`);
                        if (fs.existsSync(tempFile)) {
                            resolve({
                                success: true,
                                path: tempFile,
                                size: fs.statSync(tempFile).size,
                                warning: 'Could not rename to desired filename, using temp name'
                            });
                        } else {
                            reject(new Error('Download completed but file rename failed: ' + renameErr.message));
                        }
                    }

                } else {
                    const errorMsg = stderrData.substring(stderrData.length - 500);
                    console.error(`[Execute Download] Strategy ${strategyIdx} failed (code ${code}): ${errorMsg}`);

                    //  403 -> escalate to the next format step BEFORE trying
                    //    another cookie strategy. Cap at 3 total attempts.
                    const is403Error =
                        /HTTP Error (403|500)/i.test(errorMsg) ||
                        /unable to download video data/i.test(errorMsg) ||
                        /Requested format is not available/i.test(errorMsg) ||
                        /Incomplete data received/i.test(errorMsg) ||
                        /nsig extraction failed/i.test(errorMsg);

                    if (is403Error && attemptIndex < escalationLadder.length - 1 && attemptIndex < 4) {
                        const prev = escalationLadder[attemptIndex];
                        attemptIndex++;
                        const next = escalationLadder[attemptIndex];
                        console.warn(`[Execute Download]  403 on format ${prev.formatId} (${prev.resolution})  escalating to attempt ${attemptIndex + 1}/3`);
                        console.warn(`[Execute Download]    next: format ${next.formatId} (${next.resolution}${next.vcodec ? ', ' + next.vcodec : ''})`);

                        // Rebuild args for the new attempt. Do NOT advance the
                        // cookie strategy  that happens only after escalation
                        // is exhausted.
                        formatSelector = buildSelectorForAttempt(attemptIndex);
                        //  PATCH: rebuild from baseArgs + current strategy's
                        //    cookie args so the retry uses the same auth path.
                        const retryArgs = baseArgs.concat(strategy.args || []);
                        // Find and replace the -f value in the cloned arg list
                        const fIdx = retryArgs.indexOf('-f');
                        if (fIdx >= 0 && fIdx + 1 < retryArgs.length) {
                            retryArgs[fIdx + 1] = formatSelector;
                        } else {
                            retryArgs.push('-f', formatSelector);
                        }

                        console.log(`[Execute Download] Trying: ${YTDLP_BIN} ${retryArgs.join(' ').substring(0, 200)}...`);

                        const retryProc = spawn(YTDLP_BIN, retryArgs, {
                            stdio: ['pipe', 'pipe', 'pipe'],
                            shell: false,
                            windowsHide: true,
                            cwd: outputDir
                        });

                        activeChildProcesses.set(downloadId, {
                            proc: retryProc,
                            videoUrl,
                            outputPath,
                            videoTitle,
                            formatInfo
                        });

                        let retryStdout = '';
                        let retryStderr = '';

                        retryProc.stdout.on('data', (data) => {
                            retryStdout += data.toString();
                            const pm = retryStdout.match(/(\d+\.?\d*)%/);
                            if (pm) downloadManager.update(downloadId, { progress: parseFloat(pm[1]) });
                        });
                        retryProc.stderr.on('data', (data) => { retryStderr += data.toString(); });

                        retryProc.on('error', (err) => {
                            activeChildProcesses.delete(downloadId);
                            console.error(`[Execute Download] Escalation spawn error:`, err.message);
                            // Fall through to the original error path by
                            // recursing into the strategy retry.
                            tryDownloadWithStrategy();
                        });

                        retryProc.on('close', (retryCode) => {
                            activeChildProcesses.delete(downloadId);
                            if (retryCode === 0) {
                                console.log(`[Execute Download]  Escalation succeeded on attempt ${attemptIndex + 1}/3 (format ${escalationLadder[attemptIndex].formatId})`);
                                // Re-run the success path by calling the same code
                                // path the original close handler would have used.
                                // Simplest: re-invoke the outer success handler by
                                // faking a zero-code close on the original command.
                                // We do this by re-spawning the ORIGINAL command so
                                // the file lands in the same tempPath.
                                // ---
                                // Actually: the file is already on disk at tempPath
                                // (same -o argument). Just resolve the promise the
                                // same way the success branch would.
                                try {
                                    let actualFile = path.join(outputDir, `ytl_${downloadId}.mp4`);
                                    if (!fs.existsSync(actualFile)) {
                                        for (const ext of ['.mp4', '.webm', '.mkv']) {
                                            const c = path.join(outputDir, `ytl_${downloadId}${ext}`);
                                            if (fs.existsSync(c)) { actualFile = c; break; }
                                        }
                                    }
                                    if (!fs.existsSync(actualFile)) {
                                        // No output  treat as failure and try next
                                        // cookie strategy.
                                        console.warn(`[Execute Download] Escalation returned code 0 but no file  falling through`);
                                        tryDownloadWithStrategy();
                                        return;
                                    }
                                    const stats = fs.statSync(actualFile);
                                    console.log(`[Execute Download] Downloaded (escalated): ${path.basename(actualFile)} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);

                                    //  PATCH Q1: update downloadManager with the ACTUAL on-disk
                                    //    filename and path so renameDownloadedFile() can find it.
                                    //    Without this, the rename step looks for the title-based name,
                                    //    fails with 'file_not_found', and the file stays as ytl_<uuid>.mp4.
                                    downloadManager.update(downloadId, {
                                        filename: path.basename(actualFile),
                                        outputPath: actualFile
                                    });

                                    resolve({ success: true, path: actualFile, size: stats.size });
                                } catch (e) {
                                    console.error(`[Execute Download] Post-escalation error:`, e.message);
                                    tryDownloadWithStrategy();
                                }
                            } else {
                                const retryErr = retryStderr.substring(retryStderr.length - 500);
                                console.warn(`[Execute Download] Escalation attempt ${attemptIndex + 1}/3 failed (code ${retryCode}): ${retryErr.substring(0, 200)}`);

                                const is403Again =
                                    /HTTP Error (403|500)/i.test(retryErr) ||
                                    /unable to download video data/i.test(retryErr) ||
                                    /Requested format is not available/i.test(retryErr) ||
                                    /Incomplete data received/i.test(retryErr) ||
                                    /nsig extraction failed/i.test(retryErr);

                                if (is403Again && attemptIndex < escalationLadder.length - 1 && attemptIndex < 4) {
                                    // Recursively escalate using the same close
                                    // handler logic  easiest is to just let the
                                    // outer close handler run again by faking a
                                    // non-zero close on the original process.
                                    // We emulate that by calling the escalate
                                    // block again via a small helper.
                                    //  PATCH R3: handleEscalationLoop was never defined; fall through
                                    //    to the cookie-strategy retry path instead.
                                    console.warn('[Execute Download]  Double-403 during escalation  falling back to next cookie strategy');
                                    tryDownloadWithStrategy();
                                    return;
                                }

                                // Escalation exhausted for this strategy
                                console.warn(`[Execute Download]  All ${attemptIndex + 1} format attempt(s) exhausted for this cookie strategy`);
                                tryDownloadWithStrategy();
                            }
                        });
                        return;
                    }

                    if (is403Error && attemptIndex >= escalationLadder.length - 1) {
                        console.warn(`[Execute Download]  Format escalation exhausted (${attemptIndex + 1} attempts)  falling back to next cookie strategy`);
                    }

                    // ---- Original auth-error handling (unchanged) ----
                    const isAuthError = /Sign in to confirm your age|Use --cookies-from-browser|Use --cookies for the authentication|cookies are locked|Unable to extract|Login required|Sign in to confirm/i.test(errorMsg);
                    const hasNext = strategyIdx < cookieStrategies.length;
                    if (isAuthError && hasNext) {
                        console.warn(`[Execute Download] Auth error detected - retrying with strategy ${strategyIdx + 1}/${cookieStrategies.length}...`);
                        if (strategy.name === 'cookies.txt file') {
                            logMissingAuthCookies();
                        }
                        tryDownloadWithStrategy();
                        return;
                    }

                    if (isAuthError && !hasNext) {
                        console.error('\n[Execute Download] ============================================================');
                        console.error('[Execute Download]  ALL COOKIE STRATEGIES FAILED for age-restricted video');
                        console.error('[Execute Download] ============================================================');
                        logMissingAuthCookies();
                        console.error('[Execute Download] ============================================================\n');
                    }

                    reject(new Error(`yt-dlp exited with code ${code}: ${errorMsg}`));
                }
            });

            setTimeout(() => {
                if (ytDlpProcess && !ytDlpProcess.killed) {
                    //  PATCH: check if output file already exists  if so,
                    //    yt-dlp finished its work but is lingering on a socket.
                    const outExists = ['.mp4', '.webm', '.mkv'].some(ext =>
                        fs.existsSync(path.join(outputDir, `ytl_${downloadId}${ext}`))
                    );
                    if (outExists) {
                        console.log('[Execute Download]  Cleaning up lingering process (file already complete)');
                    } else {
                        console.log('[Execute Download]  Timeout reached, killing process');
                    }
                    ytDlpProcess.kill();
                    if (!outExists) reject(new Error('Download timeout (45 minutes)'));
                }
            }, 45 * 60 * 1000);   //  PATCH: bumped from 30 to 45 minutes
        };

        tryDownloadWithStrategy();
    });
}

async function renameDownloadedFile(downloadObj, originalPath) {
    return new Promise((resolve) => {
        console.log('\n[Rename] ==================================================');
        console.log('[Rename] Starting rename process...');

        const originalOnDisk = path.basename(originalPath || '');
        const originalIsTemp = /^ytl_[0-9a-f]{8}-[0-9a-f]{4}-/i.test(originalOnDisk);

        // PATCH T1: fall back to downloadObj.outputPath if original missing
        if (!fs.existsSync(originalPath) && downloadObj && downloadObj.outputPath && fs.existsSync(downloadObj.outputPath)) {
            console.log('[Rename] Original path missing - falling back to downloadObj.outputPath:', path.basename(downloadObj.outputPath));
            originalPath = downloadObj.outputPath;
        }
        //  PATCH S2: If Q1's escalation-rename step updated
        //    downloadManager.filename to the on-disk temp name, the old
        //    skip condition would take the 'SKIPPING RENAME' path and
        //    leave the file as ytl_<uuid>.mp4. Detect that case and
        //    fall through to the real rename logic instead.
        const downloadObjFilenameIsTemp =
            /^ytl_[0-9a-f]{8}-[0-9a-f]{4}-/i.test(String(downloadObj?.filename || ''));

        if (downloadObj && downloadObj.filename && !downloadObj.needsRename && !originalIsTemp && !downloadObjFilenameIsTemp) {
            console.log('[Rename]  SKIPPING RENAME - has correct filename from dedup system!');

            const expectedPath = path.join(path.dirname(originalPath), downloadObj.filename);
            if (fs.existsSync(originalPath)) {
                if (originalPath !== expectedPath) {
                    try {
                        fs.renameSync(originalPath, expectedPath);
                        console.log('[Rename]  Renamed temp  final:', downloadObj.filename);
                        resolve({ success: true, filename: downloadObj.filename, originalFilename: path.basename(originalPath) });
                    } catch (err) {
                        console.error('[Rename]  Rename failed:', err.message);
                        resolve({ success: false, reason: 'rename_error', filename: downloadObj.filename, error: err.message });
                    }
                } else {
                    resolve({ success: true, filename: downloadObj.filename, originalFilename: downloadObj.filename });
                }
            } else if (fs.existsSync(expectedPath)) {
                resolve({ success: true, filename: downloadObj.filename, originalFilename: downloadObj.filename });
            } else {
                console.log('[Rename]  File not found at either location');
                resolve({ success: false, reason: 'file_not_found', filename: null });
            }
            return;
        }

        const currentFilename = path.basename(originalPath);

        //  FIX: If the on-disk file still looks like a temp name (ytl_<uuid>),
        // do NOT trust downloadObj.filename  force a rename from the title.
        const onDiskIsTemp = /^ytl_[0-9a-f]{8}-[0-9a-f]{4}-/i.test(currentFilename);

        if (onDiskIsTemp) {
            console.warn(`[Rename]  On-disk file is still a temp name: "${currentFilename}"  ignoring downloadObj.filename and forcing rename`);
        }

        if (!onDiskIsTemp && downloadObj.filename && currentFilename === downloadObj.filename) {
            console.log('[Rename]  FILE ALREADY HAS CORRECT NAME - skipping rename!');

            if (fs.existsSync(originalPath)) {
                const stats = fs.statSync(originalPath);
                resolve({
                    success: true,
                    filename: currentFilename,
                    originalFilename: currentFilename,
                    size: stats.size,
                    reason: 'already_correct'
                });
            } else {
                resolve({ success: false, reason: 'file_not_found', filename: null });
            }
            return;
        }

        if (!downloadObj || !downloadObj.title) {
            console.log('[Rename]  No title available, skipping rename');
            resolve({ success: false, reason: 'no_title', filename: null, originalFilename: null });
            return;
        }

        const videoTitle = downloadObj.title;
        let sanitizedTitle = sanitizeViaPython(videoTitle).trim();

        const maxTitleLength = 230;
        if (sanitizedTitle.length > maxTitleLength) {
            sanitizedTitle = sanitizedTitle.substring(0, maxTitleLength);
        }

        const newFilename = sanitizedTitle.endsWith('.mp4') ? sanitizedTitle : `${sanitizedTitle}.mp4`;
        const originalDir = path.dirname(originalPath);
        const newPath = path.join(originalDir, newFilename);

        if (!fs.existsSync(originalPath)) {
            console.log('[Rename]  Original file not found:', originalPath);

            const extensions = ['.mp4', '.webm', '.mkv'];
            let foundAlternate = false;

            for (const ext of extensions) {
                const altPath = originalPath.replace(/\.[^.]+$/, ext);
                if (fs.existsSync(altPath)) {
                    console.log('[Rename] Found alternate file:', altPath);
                    originalPath = altPath;
                    foundAlternate = true;
                    break;
                }
            }

            if (!foundAlternate) {
                resolve({ success: false, reason: 'source_not_found', filename: null, originalFilename: null });
                return;
            }
        }

        let finalNewPath = newPath;
        let finalNewFilename = newFilename;
        let counter = 1;

        while (fs.existsSync(finalNewPath)) {
            counter++;
            finalNewFilename = `${sanitizedTitle} (${counter}).mp4`;
            finalNewPath = path.join(originalDir, finalNewFilename);
            console.log('[Rename]  DUPLICATE DETECTED! Trying:', finalNewFilename);
        }

        try {
            fs.renameSync(originalPath, finalNewPath);
            const stats = fs.statSync(finalNewPath);

            console.log('[Rename]  Rename successful!');
            console.log('[Rename] To:', finalNewFilename);

            resolve({
                success: true,
                filename: finalNewFilename,
                originalFilename: path.basename(originalPath),
                path: finalNewPath,
                size: stats.size,
                renamedAt: new Date().toISOString()
            });

        } catch (err) {
            console.error('[Rename]  Rename failed:', err.message);
            resolve({
                success: false,
                reason: err.code || 'unknown_error',
                error: err.message,
                filename: path.basename(originalPath),
                originalFilename: path.basename(originalPath)
            });
        }
    });
}

// =============================================================================
// FORMAT ANALYZER
// =============================================================================

// =============================================================================
//  Build a 3-step format escalation ladder from a parsed format list.
//
// Rule:
//   - Step 1 = the baseline format the analyzer already chose.
//   - Steps 2 and 3 = the next-higher distinct resolutions that ACTUALLY exist
//     in this video's format list (measured by pixel area).
//   - Cap at 3 total steps. Never invent formats the video doesn't have.
//
// Also avoids picking an audio-only format as a video step.
// =============================================================================
function buildEscalationLadder(formats, baseline) {
    // Flat two-phase ladder:
    //   Phase 1 (muxed):  394, 395 -- only added if they actually exist.
    //   Phase 2 (merge):  up to 3 lowest DASH (https) video-only rungs,
    //                     ascending by resolution, paired with best DASH audio.
    //
    // HLS (m3u8) video formats are SKIPPED in Phase 2 because yt-dlp cannot
    // merge an HLS video stream with a DASH audio stream via -f X+Y.
    const ladder = [];

    // ---- Phase 1: muxed rungs (only if present in the format list) ----
    const MUXED_TRY_IDS = ['394', '395'];
    for (const id of MUXED_TRY_IDS) {
        const match = formats.find(f => String(f.formatId) === id && !f.isAudioOnly);
        if (match) {
            ladder.push({
                formatId: match.formatId,
                resolution: match.resolution,
                vcodec: match.vcodec || 'unknown',
                ext: match.ext || 'mp4',
                needsMerge: false,
                audioFormatId: null,
                phase: 1,
            });
        }
        // no else -- skip phantom rungs
    }

    // ---- Phase 2: DASH-only video rungs + DASH audio ----
    const audioFormatId = findBestAudioFormat(formats);

    const videoOnly = formats
        .filter(f => !f.isAudioOnly)
        .filter(f => f.proto === 'https')   // DASH only -- pairs with DASH audio
        .map(f => ({ ...f, _area: parseResolutionArea(f.resolution) }))
        .filter(f => f._area > 0)
        .sort((a, b) => a._area - b._area);

    const seenAreas = new Set();
    const phase2Rungs = [];
    for (const f of videoOnly) {
        if (seenAreas.has(f._area)) continue;
        seenAreas.add(f._area);
        phase2Rungs.push(f);
        if (phase2Rungs.length >= 3) break;
    }

    for (const r of phase2Rungs) {
        ladder.push({
            formatId: r.formatId,
            resolution: r.resolution,
            vcodec: r.vcodec || 'unknown',
            ext: r.ext || 'mp4',
            needsMerge: true,
            audioFormatId: audioFormatId,
            phase: 2,
        });
    }

    return ladder;
}

function parseResolutionArea(res) {
    if (!res || typeof res !== 'string') return 0;
    const m = res.match(/(\d+)\s*x\s*(\d+)/i);
    if (m) return parseInt(m[1], 10) * parseInt(m[2], 10);
    const p = res.match(/(\d+)\s*p\b/i);
    if (p) return parseInt(p[1], 10) * 9999;   // "720p" -> 720*9999, coarser but ordered
    return 0;
}

function analyzeVideoFormats(videoUrl) {
    return new Promise((resolve, reject) => {
        console.log('\n[Format Analyzer] Starting analysis for:', videoUrl);

        const cmd = 'yt-dlp --list-formats';
        const strategies = buildCommandsWithCookieStrategies(cmd, videoUrl);

        executeWithRetry(
            strategies,
            0,
            (stdout) => {
                console.log('[Format Analyzer]  Got format list, parsing...');

                try {
                    const formats = parseFormatsFromText(stdout);
                    console.log('[Format Analyzer] Parsed', formats.length, 'formats');

                    if (formats.length === 0) {
                        throw new Error('No formats found');
                    }

                    const selected = selectBestFormat(formats);

                    console.log('[Format Analyzer]  Selected format:');
                    console.log('   ID:', selected.formatId);
                    console.log('   Resolution:', selected.resolution);
                    console.log('   Size:', selected.filesizeMB || 'unknown', 'MB');

                    //  Build a 3-step escalation ladder (baseline + 2 higher tiers).
                    //    Used by executeDownloadWithFormat() when a 403 hits.
                    const escalationLadder = buildEscalationLadder(formats, selected);
                    if (escalationLadder.length > 1) {
                        console.log('[Format Analyzer]  Escalation ladder (max 3 attempts):');
                        escalationLadder.forEach((c, i) => {
                            console.log(`   step ${i + 1}/3: format ${c.formatId} (${c.resolution}${c.vcodec ? ', ' + c.vcodec : ''})`);
                        });
                    }

                    resolve({
                        ...selected,
                        escalationLadder,
                    });

                } catch (parseError) {
                    console.error('[Format Analyzer] Parse error:', parseError.message);
                    reject(parseError);
                }
            },
            (error) => {
                console.log('[Format Analyzer]  All strategies failed, using default:', error.message);
                resolve({
                    formatId: 'best[ext=mp4]/best',
                    resolution: 'auto',
                    ext: 'mp4',
                    filesize: null,
                    filesizeMB: null,
                    vcodec: 'auto',
                    acodec: 'auto',
                    needsMerge: false
                });
            }
        );
    });
}

function parseFormatsFromText(text) {
    const formats = [];
    const lines = text.split('\n');

    for (const line of lines) {
        if (!line.includes('mp4') && !line.includes('webm') && !line.includes('m4a')) continue;
        if (line.includes('ID') || line.includes('---') || line.includes('ext')) continue;

        const parts = line.trim().split(/\s{2,}/);

        if (parts.length >= 2) {
            let rawFormatId = parts[0].trim();
            const formatId = rawFormatId.split(/\s+/)[0];
            const extPart = parts[1].trim();

            const extMatch = extPart.match(/(mp4|webm|m4a|mkv)/i);
            const ext = extMatch ? extMatch[1].toLowerCase() : 'mp4';

            const resolutionMatch = line.match(/(\d+)x(\d+)|(\d+p)/);
            const resolution = resolutionMatch ? resolutionMatch[0] : 'audio only';

                        // Parse FILESIZE strictly from its column position.
            // yt-dlp columns:  ID  EXT  RESOLUTION  FPS  CH  |  FILESIZE  TBR  PROTO  |  VCODEC ...
            // The first size-like token after the pipe is the FILESIZE. Any later
            // size-like token (audio bitrate labels, etc.) is ignored.
            let filesize = null;
            let filesizeMB = null;

            const _tokens = line.split(/\\s+/);
            let _seenPipe = false;
            for (const _tok of _tokens) {
                if (_tok === '' || _tok === '|') { _seenPipe = true; continue; }
                if (!_seenPipe) continue;
                const _m = _tok.match(/^~?([\\d.]+)(KiB|MiB|GiB)$/i);
                if (_m) {
                    filesize = parseFloat(_m[1]);
                    const unit = _m[2].toUpperCase();
                    if (unit === 'GiB') filesizeMB = filesize * 1024;
                    else if (unit === 'KiB') filesizeMB = filesize / 1024;
                    else filesizeMB = filesize;
                    break;
                }
            }

            const isAudioOnly = line.includes('audio only');

            const vcodecMatch = line.match(/avc[\d.]+|vp\d+|av1/i);
            const acodecMatch = line.match(/mp4a\.\d+|opus|aac/i);

            const vcodec = vcodecMatch ? vcodecMatch[0] : (isAudioOnly ? null : 'unknown');
            const acodec = acodecMatch ? acodecMatch[0] : (isAudioOnly ? 'opus' : 'unknown');

            // Extract PROTO column: https (DASH) vs m3u8 (HLS) vs mhtml (storyboard).
            // Simple regex on the raw line  safe against column-position drift.
            const protoMatch = line.match(/\s(https|m3u8|mhtml)\s/);
            const proto = protoMatch ? protoMatch[1] : 'unknown';

            formats.push({
                formatId: formatId,
                ext: ext,
                resolution: resolution,
                filesize: filesize,
                filesizeMB: filesizeMB ? Math.round(filesizeMB * 100) / 100 : null,
                vcodec: vcodec,
                acodec: acodec,
                isAudioOnly: isAudioOnly,
                proto: proto,
                needsMerge: false
            });
        }
    }

    formats.forEach(f => {
        if (f.isAudioOnly) {
            f.needsMerge = false;
        } else if (!f.acodec || f.acodec === 'unknown' || !f.vcodec || f.vcodec === 'unknown') {
            f.needsMerge = true;
        } else {
            f.needsMerge = false;
        }
    });

    return formats;
}

function selectBestFormat(formats) {
    const videoFormats = formats.filter(f => !f.isAudioOnly);
    const muxed = videoFormats.filter(f => f.ext === 'mp4' && f.vcodec && f.vcodec !== 'unknown' && f.acodec && f.acodec !== 'unknown' && !f.needsMerge);
    if (muxed.length > 0) {
        const sorted = [...muxed].sort((a, b) => {
            const areaA = parseResolutionArea(a.resolution) || 1e12;
            const areaB = parseResolutionArea(b.resolution) || 1e12;
            if (areaA !== areaB) return areaA - areaB;
            const sizeA = (a.filesizeMB == null) ? Number.POSITIVE_INFINITY : a.filesizeMB;
            const sizeB = (b.filesizeMB == null) ? Number.POSITIVE_INFINITY : b.filesizeMB;
            return sizeA - sizeB;
        });
        const chosen = sorted[0];
        console.log('[Format Analyzer] R1b: preferring LOWEST muxed format', chosen.formatId, '(' + chosen.resolution + ', ' + (chosen.filesizeMB || '?') + ' MB)');
        return Object.assign({}, chosen, { needsMerge: false });
    }
    if (videoFormats.length === 0) {
        return formats[0] || { formatId: 'best[ext=mp4]/best', resolution: 'auto', ext: 'mp4', filesize: null, filesizeMB: null, vcodec: 'auto', acodec: 'auto', needsMerge: false };
    }
    const dashVideo = videoFormats.filter(f => f.proto === 'https');
    const pool = dashVideo.length > 0 ? dashVideo : videoFormats;
    const sortedByArea = [...pool].sort((a, b) => {
        const areaA = parseResolutionArea(a.resolution) || 1e12;
        const areaB = parseResolutionArea(b.resolution) || 1e12;
        return areaA - areaB;
    });
    const lowestVideo = sortedByArea[0];
    const audioFormatId = findBestAudioFormat(formats);
    console.log('[Format Analyzer] R1b-fallback: no muxed, using video-only', lowestVideo.formatId, '+ audio', audioFormatId || 'bestaudio');
    return Object.assign({}, lowestVideo, { needsMerge: true, audioFormatId: audioFormatId });
}
function findBestAudioFormat(formats) {
    // Prefer DASH (https) audio-only so it pairs correctly with DASH video
    // in the -f VIDEO+AUDIO selector. HLS audio (m3u8) is used only if no
    // DASH audio is available.
    const audioFormats = formats.filter(f => f.isAudioOnly && f.ext === 'm4a');
    const dashAudio = audioFormats.filter(f => f.proto === 'https');
    const pool = dashAudio.length > 0 ? dashAudio : audioFormats;

    if (pool.length > 0) {
        return pool.sort((a, b) => (a.filesizeMB || 0) - (b.filesizeMB || 0))[0].formatId;
    }

    return null;
}

// =============================================================================
// BATCH DOWNLOAD ENDPOINT
// =============================================================================

app.post('/api/download/batch', async (req, res) => {
    console.log('\n' + '='.repeat(80));
    console.log(' [Batch Download] POST /api/download/batch');
    console.log('='.repeat(80));

    try {
        const { videos, format, quality, channelId, channelName } = req.body;

        if (!videos || !Array.isArray(videos) || videos.length === 0) {
            return res.status(400).json({ success: false, error: 'Videos array required' });
        }

        const outputDir = channelName ? getChannelDownloadDir(channelName) : DOWNLOADS_DIR;

        const results = [];
        let queuedCount = 0;

        for (let i = 0; i < videos.length; i++) {
            const video = videos[i];
            const videoId = video.id || video.videoId;
            const videoTitle = video.title || `Video ${i + 1}`;
            const videoUrl = video.url || `https://www.youtube.com/watch?v=${videoId}`;

            const downloadId = uuidv4();
            const safeTitle = videoTitle.replace(/[^a-zA-Z0-9._-]/g, '_').substring(0, 100);
            let outputFilename = `${safeTitle}_${downloadId}.mp4`;
            outputFilename = ensureUniqueOnDisk(outputDir, outputFilename);
            const outputPath = path.join(outputDir, outputFilename);

            downloadManager.add({
                id: downloadId,
                url: videoUrl,
                videoId: videoId,
                channelId: channelId,
                title: videoTitle,
                filename: outputFilename,
                outputPath: outputPath,
                format: format || 'best',
                quality: quality || 'lowest',
                status: 'queued',
                progress: 0,
                createdAt: new Date().toISOString()
            });

            downloadQueue.enqueue(downloadId, videoUrl, outputPath, videoTitle);

            queuedCount++;
            results.push({
                index: i,
                videoId: videoId,
                title: videoTitle,
                status: 'queued',
                jobId: downloadId,
                filename: outputFilename
            });
        }

        res.json({
            success: true,
            message: `Batch download initiated: ${queuedCount} videos added to queue (max 2 concurrent)`,
            summary: {
                total: videos.length,
                queued: queuedCount,
                skipped: 0,
                errors: 0
            },
            results: results,
            batchId: uuidv4()
        });

    } catch (error) {
        console.error('[Batch Download]  Error:', error.message);
        res.status(500).json({ success: false, error: 'Batch download failed: ' + error.message });
    }
});

// =============================================================================
// SEQUENTIAL DOWNLOAD
// =============================================================================

let sequentialQueue = {
    isRunning: false,
    isPaused: false,
    currentIndex: 0,
    totalVideos: 0,
    videos: [],
    results: [],
    batchId: null,
    startTime: null,
    cancelRequested: false
};

app.post('/api/download/sequential', async (req, res) => {
    console.log('\n' + '='.repeat(80));
    console.log(' [Sequential Download] POST /api/download/sequential');
    console.log('='.repeat(80));

    try {
        const { videos, format, quality, channelId, channelName } = req.body;

        if (!videos || !Array.isArray(videos) || videos.length === 0) {
            return res.status(400).json({ success: false, error: 'Videos array required' });
        }

        if (sequentialQueue.isRunning && !sequentialQueue.cancelRequested) {
            return res.status(409).json({
                success: false,
                error: 'Sequential download already in progress'
            });
        }

        sequentialQueue = {
            isRunning: true,
            isPaused: false,
            currentIndex: 0,
            totalVideos: videos.length,
            videos: videos.map((v, idx) => ({
                ...v,
                index: idx,
                videoId: v.id || v.videoId,
                title: v.title || `Video ${idx + 1}`,
                url: v.url || `https://www.youtube.com/watch?v=${v.id || v.videoId}`
            })),
            results: [],
            batchId: uuidv4(),
            startTime: new Date(),
            cancelRequested: false
        };

        const outputDir = channelName ? getChannelDownloadDir(channelName) : DOWNLOADS_DIR;

        res.json({
            success: true,
            message: `Sequential download started: ${videos.length} videos will download one at a time`,
            mode: 'sequential',
            batchId: sequentialQueue.batchId,
            totalVideos: videos.length
        });

        processSequentialQueue(outputDir, format, quality, channelId);

    } catch (error) {
        console.error('[Sequential Download]  Error:', error.message);
        if (!res.headersSent) {
            res.status(500).json({
                success: false,
                error: 'Sequential download failed: ' + error.message
            });
        }
    }
});

async function processSequentialQueue(outputDir, format, quality, channelId) {
    console.log('\n[Sequential Queue]  Starting sequential processing...');

    while (sequentialQueue.currentIndex < sequentialQueue.totalVideos) {
        if (sequentialQueue.cancelRequested) {
            console.log('[Sequential Queue]  Cancellation requested, stopping...');
            break;
        }

        while (sequentialQueue.isPaused && !sequentialQueue.cancelRequested) {
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        if (sequentialQueue.cancelRequested) break;

        if (!networkMonitor.isOnline()) {
            console.log('[Sequential Queue] \u23f8\ufe0f Network offline - waiting for connection...');
            while (!networkMonitor.isOnline() && !sequentialQueue.cancelRequested) {
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
            if (sequentialQueue.cancelRequested) break;
            console.log('[Sequential Queue] \u25b6\ufe0f Network restored - continuing');
        }

        const video = sequentialQueue.videos[sequentialQueue.currentIndex];
        const index = sequentialQueue.currentIndex + 1;

        try {
            const downloadId = uuidv4();
            const safeTitle = video.title.replace(/[^a-zA-Z0-9._-]/g, '_').substring(0, 100);
            let outputFilename = `${safeTitle}.mp4`;
            outputFilename = ensureUniqueOnDisk(outputDir, outputFilename);
            const outputPath = path.join(outputDir, outputFilename);

            downloadManager.add({
                id: downloadId,
                url: video.url,
                videoId: video.videoId,
                channelId: channelId,
                title: video.title,
                filename: outputFilename,
                outputPath: outputPath,
                format: format || 'best',
                quality: quality || 'lowest',
                status: 'queued',
                progress: 0,
                createdAt: new Date().toISOString()
            });

            downloadQueue.enqueue(downloadId, video.url, outputPath, video.title);

            await new Promise((resolve) => {
                const checkInterval = setInterval(() => {
                    const currentDl = downloadManager.get(downloadId);
                    if (!currentDl || currentDl.status === 'completed' || currentDl.status === 'error' || currentDl.status === 'cancelled') {
                        clearInterval(checkInterval);
                        resolve();
                    }
                }, 500);
            });

            sequentialQueue.results.push({
                index: sequentialQueue.currentIndex,
                videoId: video.videoId,
                title: video.title,
                status: 'completed',
                jobId: downloadId,
                filename: outputFilename,
                completedAt: new Date().toISOString()
            });

        } catch (error) {
            console.error(`[Sequential Queue]  Video [${index}] FAILED:`, error.message);

            sequentialQueue.results.push({
                index: sequentialQueue.currentIndex,
                videoId: video.videoId,
                title: video.title,
                status: 'failed',
                error: error.message,
                failedAt: new Date().toISOString()
            });

            await new Promise(resolve => setTimeout(resolve, 3000));
        }

        sequentialQueue.currentIndex++;

        if (sequentialQueue.currentIndex < sequentialQueue.totalVideos) {
            console.log('[Sequential Queue]  Waiting 5 seconds before next download...');
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
    }

    sequentialQueue.isRunning = false;
    const endTime = new Date();
    const duration = Math.round((endTime - sequentialQueue.startTime) / 1000);

    const successCount = sequentialQueue.results.filter(r => r.status === 'completed').length;
    const failCount = sequentialQueue.results.filter(r => r.status === 'failed').length;

    console.log(`\n[Sequential Queue]  SEQUENTIAL DOWNLOAD COMPLETE!`);
    console.log(`[Sequential Queue] Total time: ${Math.floor(duration / 60)}m ${duration % 60}s`);
    console.log(`[Sequential Queue] Successful: ${successCount}/${sequentialQueue.totalVideos}`);
    console.log(`[Sequential Queue] Failed: ${failCount}/${sequentialQueue.totalVideos}`);
}

app.get('/api/download/sequential/status', (req, res) => {
    const currentVideo = sequentialQueue.videos[sequentialQueue.currentIndex] || null;
    const activeDownload = currentVideo ?
        downloadManager.get(d => d.videoId === currentVideo.videoId && d.status === 'downloading') : null;

    res.json({
        success: true,
        isRunning: sequentialQueue.isRunning,
        isPaused: sequentialQueue.isPaused,
        batchId: sequentialQueue.batchId,
        progress: {
            current: sequentialQueue.currentIndex,
            total: sequentialQueue.totalVideos,
            percent: sequentialQueue.totalVideos > 0 ?
                Math.round((sequentialQueue.currentIndex / sequentialQueue.totalVideos) * 100) : 0
        },
        currentVideo: currentVideo ? {
            title: currentVideo.title,
            videoId: currentVideo.videoId,
            index: sequentialQueue.currentIndex + 1
        } : null,
        currentProgress: activeDownload ? {
            jobId: activeDownload.id,
            percent: activeDownload.progress || 0,
            speed: activeDownload.speed || null,
            status: activeDownload.status
        } : null,
        results: sequentialQueue.results,
        cancelled: sequentialQueue.cancelRequested,
        elapsedTime: sequentialQueue.startTime ?
            Math.round((new Date() - sequentialQueue.startTime) / 1000) : 0
    });
});

app.post('/api/download/sequential/pause', (req, res) => {
    const { pause } = req.body;

    if (!sequentialQueue.isRunning) {
        return res.status(400).json({ success: false, error: 'No sequential download in progress' });
    }

    sequentialQueue.isPaused = pause === true;

    res.json({
        success: true,
        isPaused: sequentialQueue.isPaused,
        message: pause ? 'Sequential download paused' : 'Sequential download resumed'
    });
});

app.post('/api/download/sequential/cancel', (req, res) => {
    if (!sequentialQueue.isRunning) {
        return res.status(400).json({ success: false, error: 'No sequential download in progress' });
    }

    sequentialQueue.cancelRequested = true;

    const currentVideo = sequentialQueue.videos[sequentialQueue.currentIndex];
    if (currentVideo) {
        const activeDownload = downloadManager.get(d =>
            d.videoId === currentVideo.videoId && d.status === 'downloading'
        );
        if (activeDownload) {
            downloadManager.update(activeDownload.id, { status: 'cancelled' });
        }
    }

    res.json({
        success: true,
        message: 'Cancellation requested.',
        resultsSoFar: sequentialQueue.results,
        nextIndex: sequentialQueue.currentIndex
    });
});

// =============================================================================
// QUEUE STATUS
// =============================================================================

app.get('/api/download/queue/status', (req, res) => {
    const queueStatus = downloadQueue.getStatus();

    res.json({
        success: true,
        queue: queueStatus,
        activeDownloads: queueStatus.activeDownloads,
        message: `Running ${queueStatus.active}/${queueStatus.maxConcurrent} downloads, ${queueStatus.queued} waiting in queue`
    });
});

app.post('/api/download/queue/clear', (req, res) => {
    const cleared = downloadQueue.clearQueue();

    res.json({
        success: true,
        message: `Cleared ${cleared} downloads from queue`,
        clearedCount: cleared
    });
});

// =============================================================================
// INDIVIDUAL QUEUE ITEM ACTIONS
// =============================================================================

app.post('/api/download/:id/stop', (req, res) => {
    const { id } = req.params;
    const download = downloadManager.get(id);

    if (!download) {
        return res.status(404).json({ success: false, error: 'Download not found' });
    }

    downloadManager.update(id, { status: 'paused', pausedAt: new Date().toISOString() });

    res.json({
        success: true,
        message: 'Download paused successfully',
        downloadId: id,
        newStatus: 'paused'
    });
});

app.post('/api/download/:id/cancel', (req, res) => {
    const { id } = req.params;
    const { reason = 'user_cancelled' } = req.body;

    const download = downloadManager.get(id);

    if (!download) {
        return res.status(404).json({ success: false, error: 'Download not found' });
    }

    downloadManager.update(id, {
        status: 'cancelled',
        cancelledAt: new Date().toISOString(),
        cancelReason: reason
    });

    downloadQueue.removeFromQueue(id);

    res.json({
        success: true,
        message: 'Download cancelled successfully',
        downloadId: id,
        newStatus: 'cancelled'
    });
});

app.delete('/api/download/:id/remove', (req, res) => {
    const { id } = req.params;
    const download = downloadManager.get(id);

    if (!download) {
        return res.status(404).json({ success: false, error: 'Download not found' });
    }

    if (download.status === 'downloading') {
        return res.status(400).json({
            success: false,
            error: 'Cannot remove active download. Use Cancel or Force Stop instead.'
        });
    }

    const removed = downloadQueue.removeFromQueue(id);
    downloadManager.remove(id);

    res.json({
        success: true,
        message: 'Download removed from queue',
        downloadId: id,
        removed: removed
    });
});

app.post('/api/download/:id/force-stop', (req, res) => {
    const { id } = req.params;
    const download = downloadManager.get(id);

    if (!download) {
        return res.status(404).json({ success: false, error: 'Download not found' });
    }

    downloadManager.update(id, {
        status: 'force_stopped',
        forceStoppedAt: new Date().toISOString()
    });

    downloadQueue.removeFromQueue(id);

    res.json({
        success: true,
        message: 'Download force stopped. Process killed.',
        downloadId: id,
        newStatus: 'force_stopped',
        warning: 'Partial file may be corrupted'
    });
});

// =============================================================================
// SYSTEM STATUS
// =============================================================================

app.get('/api/network/status', (req, res) => {
    res.json({
        success: true,
        ...networkMonitor.status(),
        queuePaused: downloadQueue.isPausedByNetwork(),
        activeDownloads: downloadQueue.activeJobs.length,
        queuedDownloads: downloadQueue.queue.length,
        bufferedDownloads: downloadQueue.pendingBuffer.length
    });
});

const _networkSSEClients = new Set();
function sseBroadcastNetwork(state) {
    const payload = 'event: network\ndata: ' + JSON.stringify({ state, ...networkMonitor.status() }) + '\n\n';
    for (const client of _networkSSEClients) {
        try { client.write(payload); } catch {}
    }
}

app.get('/api/network/stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    _networkSSEClients.add(res);
    try {
        res.write('event: network\ndata: ' + JSON.stringify({
            state: networkMonitor.isOnline() ? 'online' : 'offline',
            ...networkMonitor.status()
        }) + '\n\n');
    } catch {}
    const hb = setInterval(() => {
        try { res.write(': hb\n\n'); } catch {}
    }, 15000);
    req.on('close', () => {
        clearInterval(hb);
        _networkSSEClients.delete(res);
    });
});

app.get('/api/system/status', (req, res) => {
    const activeDownloads = downloadManager.getActive();
    const completedDownloads = downloadManager.getCompleted();

    res.json({
        success: true,
        system: {
            uptime: process.uptime(),
            memory: process.memoryUsage(),
            platform: process.platform,
            nodeVersion: process.version
        },
        downloads: {
            dir: DOWNLOADS_DIR,
            exists: fs.existsSync(DOWNLOADS_DIR),
            activeCount: activeDownloads.length,
            completedCount: completedDownloads.length,
            totalCount: downloadManager.getAll().length
        },
        channels: {
            saved: savedChannels.size
        },
        tools: {
            ffmpeg: FFMPEG_AVAILABLE,
            ffmpegPath: FFMPEG_PATH,
            cookies: isCookiesFileValid(false),
            ytdlp: YTDLP_BIN,
            node: NODE_BIN
        }
    });
});

// =============================================================================
// FILE SERVING
// =============================================================================

app.get('/api/files', (req, res) => {
    try {
        const files = fs.readdirSync(DOWNLOADS_DIR)
            .filter(f => f.endsWith('.mp4') || f.endsWith('.webm'))
            .map(f => {
                const filePath = path.join(DOWNLOADS_DIR, f);
                const stats = fs.statSync(filePath);
                return {
                    name: f,
                    size: stats.size,
                    sizeMB: Math.round(stats.size / 1024 / 1024 * 100) / 100,
                    modified: stats.mtime,
                    created: stats.birthtime
                };
            })
            .sort((a, b) => new Date(b.modified) - new Date(a.modified));

        res.json({
            success: true,
            files: files,
            count: files.length
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/download-file/:filename', (req, res) => {
    const filename = req.params.filename;
    const filePath = path.join(DOWNLOADS_DIR, filename);

    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
        return res.status(400).json({ error: 'Invalid filename' });
    }

    if (fs.existsSync(filePath)) {
        res.download(filePath);
    } else {
        res.status(404).json({ error: 'File not found' });
    }
});

// =============================================================================
// DATE STAMP ENDPOINTS
// =============================================================================

function sseSend(res, event, data) {
    try {
        res.write(`event: ${event}\n`);
        res.write(`data: ${JSON.stringify(data)}\n\n`);
    } catch (e) {
        console.warn('[SSE] write failed:', e.message);
    }
}

async function applyDateStampsForChannel(channel, res) {
    const videos = channel.videos || [];
    const channelDir = getChannelDownloadDir(channel.name);

    const alreadyStamped = [];
    const notOnDisk = [];
    const pending = [];

    for (const video of videos) {
        const currentName = video.finalFilename;
        if (!currentName) continue;
        if (hasDateStampSuffix(currentName)) {
            alreadyStamped.push({ video, currentName });
            continue;
        }
        const fullPath = path.join(channelDir, currentName);
        if (fs.existsSync(fullPath)) {
            pending.push({ video, currentName, fullPath });
        } else {
            notOnDisk.push({ video, currentName });
        }
    }

    const total = alreadyStamped.length + notOnDisk.length + pending.length;
    let processed = 0;
    let renamed = 0;
    let failed = 0;

    sseSend(res, 'start', {
        channelId: channel.id,
        channelName: channel.name,
        totalVideos: total,
        pendingCount: pending.length,
        alreadyStampedCount: alreadyStamped.length,
        notOnDiskCount: notOnDisk.length,
        message: `Starting Fix-Dates on "${channel.name}"`
    });

    const emitVideo = (item, status, extra = {}) => {
        processed++;
        const vidId = item.video.id || item.video.videoId;
        sseSend(res, 'video', {
            index: processed, total,
            channelId: channel.id,
            videoId: vidId,
            title: item.video.title,
            status,
            filename: item.currentName,
            ...extra
        });
        sseSend(res, 'progress', {
            channelId: channel.id,
            processed, total,
            percentage: total > 0 ? Math.round((processed / total) * 100) : 100,
            renamed,
            skippedAlready: alreadyStamped.length,
            skippedMissing: notOnDisk.length,
            failed
        });
    };

    for (const item of alreadyStamped) {
        emitVideo(item, 'already_stamped', { message: 'Already has date suffix' });
    }

    for (const item of notOnDisk) {
        emitVideo(item, 'not_on_disk', { message: 'File not found on disk  skipping' });
    }

    if (pending.length > 0) {
        const pendingMap = new Map();
        const videoIds = [];
        for (const item of pending) {
            const vidId = item.video.id || item.video.videoId;
            if (vidId) {
                pendingMap.set(vidId, item);
                videoIds.push(vidId);
            }
        }

        sseSend(res, 'fetching_start', {
            channelId: channel.id,
            count: videoIds.length,
            message: `Fetching upload dates for ${videoIds.length} videos...`
        });

        let dbDirty = false;

        await getVideoUploadDatesParallel(videoIds, 4, (vidId, uploadDate) => {
            const item = pendingMap.get(vidId);
            if (!item) return;
            pendingMap.delete(vidId);

            const newName = applyDateStampToFilename(item.currentName, uploadDate, undefined, vidId);
            if (newName && newName !== item.currentName) {
                const safeNewName = ensureUniqueOnDisk(channelDir, newName);
                const newPath = path.join(channelDir, safeNewName);
                try {
                    fs.renameSync(item.fullPath, newPath);
                    renamed++;
                    item.video.finalFilename = safeNewName;
                    item.video.uploadDate = uploadDate;
                    dbDirty = true;
                    emitVideo(item, 'renamed', {
                        oldFilename: item.currentName,
                        newFilename: safeNewName,
                        uploadDate,
                        message: `Renamed  ${safeNewName}`
                    });
                } catch (renameErr) {
                    failed++;
                    emitVideo(item, 'rename_failed', { error: renameErr.message });
                }
            } else {
                emitVideo(item, 'unchanged', { message: 'Date stamp already present or invalid' });
            }
        }, (round, remainingCount) => {
            sseSend(res, 'retry', {
                channelId: channel.id,
                round,
                remaining: remainingCount,
                message: `YouTube rate-limited  retry round ${round}`
            });
        });

        for (const [vidId, item] of pendingMap) {
            failed++;
            emitVideo(item, 'fetch_failed', { message: 'Could not fetch upload date' });
        }

        if (dbDirty) {
            saveDatabase();
        }
    }

    sseSend(res, 'done', {
        channelId: channel.id,
        channelName: channel.name,
        total,
        processed,
        renamed,
        skippedAlready: alreadyStamped.length,
        skippedMissing: notOnDisk.length,
        failed,
        message: `Done: ${renamed} renamed`
    });

    return {
        total,
        processed,
        renamed,
        skippedAlready: alreadyStamped.length,
        skippedMissing: notOnDisk.length,
        failed
    };
}

async function applyDateStampsForSingleFileFolder(res) {
    const singleDir = getSingleFileDir();
    let filesOnDisk = [];
    try {
        filesOnDisk = fs.readdirSync(singleDir)
            .filter(f => /\.(mp4|webm|mkv)$/i.test(f));
    } catch (err) {
        sseSend(res, 'error', { message: `Cannot read Single-File folder: ${err.message}` });
        return { total: 0, renamed: 0, skippedAlready: 0, skippedMissing: 0, failed: 0, noVideoId: 0 };
    }

    const knownVideos = [];
    for (const [, ch] of savedChannels.entries()) {
        for (const v of (ch.videos || [])) {
            knownVideos.push({
                videoId: v.id || v.videoId,
                finalFilename: v.finalFilename,
                sanitizedBase: v.sanitizedBase,
                title: v.title
            });
        }
    }

    const alreadyStamped = [];
    const noVideoIdFiles = [];
    const pending = [];

    for (const filename of filesOnDisk) {
        const fullPath = path.join(singleDir, filename);
        if (hasDateStampSuffix(filename)) {
            alreadyStamped.push({ filename, fullPath });
            continue;
        }
        const lowerName = filename.toLowerCase();
        const match = knownVideos.find(v => {
            if (v.finalFilename && v.finalFilename.toLowerCase() === lowerName) return true;
            if (v.sanitizedBase && `${v.sanitizedBase.toLowerCase()}.mp4` === lowerName) return true;
            const sanTitle = sanitizeViaPython(v.title || '').toLowerCase() + '.mp4';
            if (sanTitle === lowerName) return true;
            return false;
        });
        if (match && match.videoId) {
            pending.push({ filename, fullPath, videoId: match.videoId, title: match.title });
        } else {
            noVideoIdFiles.push({ filename, fullPath });
        }
    }

    const total = filesOnDisk.length;
    let processed = 0;
    let renamed = 0;
    let failed = 0;

    sseSend(res, 'start', {
        folder: 'Single-File',
        totalFiles: total,
        pendingCount: pending.length,
        alreadyStampedCount: alreadyStamped.length,
        noVideoIdCount: noVideoIdFiles.length,
        message: `Starting Fix-Dates on Single-File folder`
    });

    const emitVideo = (item, status, extra = {}) => {
        processed++;
        sseSend(res, 'video', {
            index: processed, total,
            folder: 'Single-File',
            filename: item.filename,
            status,
            ...extra
        });
        sseSend(res, 'progress', {
            folder: 'Single-File',
            channelId: 'single-file',
            processed, total,
            percentage: total > 0 ? Math.round((processed / total) * 100) : 100,
            renamed,
            skippedAlready: alreadyStamped.length,
            noVideoId: noVideoIdFiles.length,
            failed
        });
    };

    for (const item of alreadyStamped) {
        emitVideo(item, 'already_stamped', { message: 'Already has date suffix' });
    }

    for (const item of noVideoIdFiles) {
        emitVideo(item, 'no_video_id', { message: 'Cannot identify videoId from filename' });
    }

    if (pending.length > 0) {
        const pendingMap = new Map();
        const videoIds = [];
        for (const item of pending) {
            pendingMap.set(item.videoId, item);
            videoIds.push(item.videoId);
        }

        sseSend(res, 'fetching_start', {
            folder: 'Single-File',
            count: videoIds.length,
            message: `Fetching upload dates for ${videoIds.length} files...`
        });

        let dbDirty = false;

        await getVideoUploadDatesParallel(videoIds, 4, (vidId, uploadDate) => {
            const item = pendingMap.get(vidId);
            if (!item) return;
            pendingMap.delete(vidId);

            const newName = applyDateStampToFilename(item.filename, uploadDate, undefined, vidId);
            if (newName && newName !== item.filename) {
                const safeNewName = ensureUniqueOnDisk(singleDir, newName);
                const newPath = path.join(singleDir, safeNewName);
                try {
                    fs.renameSync(item.fullPath, newPath);
                    renamed++;
                    for (const [, ch] of savedChannels.entries()) {
                        for (const v of (ch.videos || [])) {
                            const vid = v.id || v.videoId;
                            if (vid === vidId) {
                                v.uploadDate = uploadDate;
                                if (v.finalFilename === item.filename) {
                                    v.finalFilename = safeNewName;
                                }
                                dbDirty = true;
                            }
                        }
                    }
                    emitVideo(item, 'renamed', {
                        videoId: vidId,
                        oldFilename: item.filename,
                        newFilename: safeNewName,
                        uploadDate,
                        message: `Renamed  ${safeNewName}`
                    });
                } catch (renameErr) {
                    failed++;
                    emitVideo(item, 'rename_failed', { error: renameErr.message });
                }
            } else {
                emitVideo(item, 'unchanged', { message: 'Date stamp already present or invalid' });
            }
        }, (round, remainingCount) => {
            sseSend(res, 'retry', {
                folder: 'Single-File',
                round,
                remaining: remainingCount,
                message: `YouTube rate-limited  retry round ${round}`
            });
        });

        for (const [vidId, item] of pendingMap) {
            failed++;
            emitVideo(item, 'fetch_failed', { message: 'Could not fetch upload date' });
        }

        if (dbDirty) {
            saveDatabase();
        }
    }

    sseSend(res, 'done', {
        folder: 'Single-File',
        total,
        processed,
        renamed,
        skippedAlready: alreadyStamped.length,
        noVideoId: noVideoIdFiles.length,
        failed,
        message: `Single-File done: ${renamed} renamed`
    });

    return {
        total,
        processed,
        renamed,
        skippedAlready: alreadyStamped.length,
        skippedMissing: 0,
        noVideoId: noVideoIdFiles.length,
        failed
    };
}

app.post('/api/channels/:id/update-database', async (req, res) => {
    const { id } = req.params;
    console.log(`\n[Update DB] POST /api/channels/${id}/update-database`);

    if (!savedChannels.has(id)) {
        return res.status(404).json({ success: false, error: 'Channel not found' });
    }
    const channel = savedChannels.get(id);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const heartbeat = setInterval(() => {
        try { res.write(': heartbeat\n\n'); } catch (e) {}
    }, 15000);

    try {
        const videos = channel.videos || [];
        const channelDir = getChannelDownloadDir(channel.name);

        const VIDEO_EXTENSIONS = ['.mp4', '.webm', '.mkv', '.m4a', '.mp3', '.m4v', '.mov', '.avi'];
        const hasVideoExtension = (filename) => {
            const lower = filename.toLowerCase();
            return VIDEO_EXTENSIONS.some(ext => lower.endsWith(ext));
        };

        let downloadedFiles = [];
        if (fs.existsSync(channelDir)) {
            try {
                downloadedFiles = fs.readdirSync(channelDir)
                    .filter(hasVideoExtension)
                    .map(file => ({
                        name: file,
                        path: path.join(channelDir, file),
                        size: fs.statSync(path.join(channelDir, file)).size
                    }));
            } catch (err) {
                console.error(`[Update DB] Error reading ${channelDir}:`, err.message);
            }
        }

        if (fs.existsSync(DOWNLOADS_DIR) && path.resolve(DOWNLOADS_DIR) !== path.resolve(channelDir)) {
            try {
                const rootFiles = fs.readdirSync(DOWNLOADS_DIR)
                    .filter(hasVideoExtension)
                    .map(file => ({
                        name: file,
                        path: path.join(DOWNLOADS_DIR, file),
                        size: fs.statSync(path.join(DOWNLOADS_DIR, file)).size
                    }));
                downloadedFiles.push(...rootFiles);
            } catch (err) {
                console.error(`[Update DB] Error reading ${DOWNLOADS_DIR}:`, err.message);
            }
        }

        sseSend(res, 'start', {
            channelId: channel.id,
            channelName: channel.name,
            totalVideos: videos.length,
            diskFiles: downloadedFiles.length,
            message: `Scanning ${downloadedFiles.length} disk files against ${videos.length} DB videos`
        });

        const stripDateSuffix = (filename) => {
            if (!filename) return filename;
            let result = filename.replace(/_\d{2}-\d{2}-\d{2}--[a-zA-Z0-9_-]{11}\.(mp4|webm|mkv|m4a|mp3)$/i, '.$1');
            result = result.replace(/_\d{2}-\d{2}-\d{2}\.(mp4|webm|mkv|m4a|mp3)$/i, '.$1');
            return result;
        };

        const consumedFiles = new Set();
        let updated = 0;
        let alreadyOk = 0;
        let notOnDisk = 0;
        let orphanedAdded = 0;
        let processed = 0;

        for (const video of videos) {
            processed++;
            const vidId = (video.id || video.videoId || '').toLowerCase();
            const expectedFilename = (video.finalFilename || '').toLowerCase();
            const expectedNoDate = stripDateSuffix(expectedFilename);
            const sanitizedBase = video.sanitizedBase ? `${video.sanitizedBase.toLowerCase()}.mp4` : '';
            const titleSanitized = sanitizeViaPython(video.title || '').toLowerCase() + '.mp4';

            let matchingFile = downloadedFiles.find(f => {
                if (consumedFiles.has(f.path)) return false;
                const fname = f.name.toLowerCase();
                const fnameNoDate = stripDateSuffix(fname);

                if (expectedFilename && fname === expectedFilename) return true;
                if (expectedNoDate && fnameNoDate === expectedNoDate) return true;
                if (expectedNoDate && fname === expectedNoDate) return true;
                if (sanitizedBase && fname === sanitizedBase) return true;
                if (sanitizedBase && fnameNoDate === stripDateSuffix(sanitizedBase)) return true;
                if (titleSanitized && fname === titleSanitized) return true;
                if (titleSanitized && fnameNoDate === stripDateSuffix(titleSanitized)) return true;
                if (vidId && fname.includes(vidId)) return true;
                return false;
            });

            if (matchingFile) {
                consumedFiles.add(matchingFile.path);
                if (video.finalFilename !== matchingFile.name) {
                    video.finalFilename = matchingFile.name;
                    updated++;
                } else {
                    alreadyOk++;
                }
                video.filePath = matchingFile.path;
                video.downloadStatus = 'completed';
                video.syncStatus = 'downloaded';
            } else {
                notOnDisk++;
                video.syncStatus = 'new';
                if (video.downloadStatus === 'completed') {
                    video.downloadStatus = null;
                }
            }

            if (processed % 50 === 0 || processed === videos.length) {
                sseSend(res, 'progress', {
                    processed,
                    total: videos.length,
                    percentage: Math.round((processed / videos.length) * 50),
                    updated,
                    alreadyOk,
                    notOnDisk,
                    orphanedAdded,
                    message: `Matching DB videos: ${processed}/${videos.length}`
                });
            }
        }

        const orphanedFiles = downloadedFiles.filter(f => !consumedFiles.has(f.path));
        if (orphanedFiles.length > 0) {
            console.log(`[Update DB]  Adding ${orphanedFiles.length} orphaned files as new DB entries`);
            sseSend(res, 'orphaned_start', {
                count: orphanedFiles.length,
                message: `Adding ${orphanedFiles.length} orphaned disk files to DB`
            });

            for (const orphan of orphanedFiles) {
                const vidIdMatch = orphan.name.match(/--([a-zA-Z0-9_-]{11})\.(mp4|webm|mkv)$/i);
                const newVideo = {
                    id: vidIdMatch ? vidIdMatch[1] : `disk_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                    title: orphan.name.replace(/\.[^.]+$/, ''),
                    finalFilename: orphan.name,
                    filePath: orphan.path,
                    downloadStatus: 'completed',
                    syncStatus: 'downloaded',
                    uploadDate: null
                };
                videos.push(newVideo);
                orphanedAdded++;
                sseSend(res, 'orphaned', {
                    filename: orphan.name,
                    count: orphanedAdded,
                    total: orphanedFiles.length
                });
            }
        }

        channel.videos = videos;
        savedChannels.set(channel.id, channel);
        saveDatabase();

        clearInterval(heartbeat);

        const total = videos.length;
        const downloaded = updated + alreadyOk + orphanedAdded;

        sseSend(res, 'done', {
            channelId: channel.id,
            channelName: channel.name,
            totalVideos: total,
            diskFiles: downloadedFiles.length,
            updated: updated,
            alreadyOk: alreadyOk,
            notOnDisk: notOnDisk,
            orphanedAdded: orphanedAdded,
            downloaded: downloaded,
            message: `DB updated: ${downloaded}/${total} marked as downloaded`
        });

        sseSend(res, 'complete', {
            success: true,
            channelId: channel.id,
            totalVideos: total,
            downloaded: downloaded,
            updated: updated,
            orphanedAdded: orphanedAdded,
            message: `DB updated: ${downloaded}/${total} downloaded`
        });

        res.end();
    } catch (err) {
        console.error(`[Update DB]  Error:`, err.message);
        clearInterval(heartbeat);
        sseSend(res, 'error', { message: err.message });
        res.end();
    }
});

app.post('/api/channels/:id/fix-dates', async (req, res) => {
    const { id } = req.params;
    console.log(`\n[Fix-Dates] POST /api/channels/${id}/fix-dates`);

    if (!savedChannels.has(id)) {
        return res.status(404).json({ success: false, error: 'Channel not found' });
    }
    const channel = savedChannels.get(id);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const heartbeat = setInterval(() => {
        try { res.write(': heartbeat\n\n'); } catch (e) {}
    }, 15000);

    try {
        const result = await applyDateStampsForChannel(channel, res);
        clearInterval(heartbeat);
        sseSend(res, 'complete', { channelId: id, ...result });
        res.end();
    } catch (err) {
        console.error(`[Fix-Dates]  Channel ${id} error:`, err.message);
        clearInterval(heartbeat);
        sseSend(res, 'error', { message: err.message });
        res.end();
    }
});

app.post('/api/files/fix-dates-single-file', async (req, res) => {
    console.log(`\n[Fix-Dates] POST /api/files/fix-dates-single-file`);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const heartbeat = setInterval(() => {
        try { res.write(': heartbeat\n\n'); } catch (e) {}
    }, 15000);

    try {
        const result = await applyDateStampsForSingleFileFolder(res);
        clearInterval(heartbeat);
        sseSend(res, 'complete', { folder: 'Single-File', ...result });
        res.end();
    } catch (err) {
        console.error(`[Fix-Dates]  Single-File error:`, err.message);
        clearInterval(heartbeat);
        sseSend(res, 'error', { message: err.message });
        res.end();
    }
});

app.post('/api/files/fix-dates-all', async (req, res) => {
    console.log(`\n[Fix-Dates] POST /api/files/fix-dates-all`);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const heartbeat = setInterval(() => {
        try { res.write(': heartbeat\n\n'); } catch (e) {}
    }, 15000);

    const allChannels = Array.from(savedChannels.values());
    const channelCount = allChannels.length;

    sseSend(res, 'start', {
        scope: 'all',
        totalChannels: channelCount,
        message: `Starting Fix-Dates on ${channelCount} channel(s) + Single-File folder`
    });

    const perChannel = [];
    let totalRenamed = 0;
    let totalFailed = 0;

    try {
        for (let i = 0; i < allChannels.length; i++) {
            const ch = allChannels[i];
            sseSend(res, 'channel_start', {
                index: i + 1, total: channelCount,
                channelId: ch.id,
                channelName: ch.name,
                message: `Processing channel ${i + 1}/${channelCount}: ${ch.name}`
            });

            const result = await applyDateStampsForChannel(ch, res);
            perChannel.push({ channelId: ch.id, channelName: ch.name, ...result });
            totalRenamed += result.renamed || 0;
            totalFailed += result.failed || 0;

            sseSend(res, 'channel_done', {
                index: i + 1, total: channelCount,
                channelId: ch.id,
                channelName: ch.name,
                ...result
            });
        }

        sseSend(res, 'channel_start', {
            index: channelCount + 1, total: channelCount + 1,
            channelId: 'single-file',
            channelName: 'Single-File',
            message: `Processing Single-File folder`
        });
        const sfResult = await applyDateStampsForSingleFileFolder(res);
        totalRenamed += sfResult.renamed || 0;
        totalFailed += sfResult.failed || 0;
        sseSend(res, 'channel_done', {
            index: channelCount + 1, total: channelCount + 1,
            channelId: 'single-file',
            channelName: 'Single-File',
            ...sfResult
        });

        clearInterval(heartbeat);
        sseSend(res, 'complete', {
            scope: 'all',
            totalChannels: channelCount + 1,
            perChannel,
            singleFile: sfResult,
            totalRenamed,
            totalFailed,
            message: `All done. Renamed: ${totalRenamed}, Failed: ${totalFailed}`
        });
        res.end();
    } catch (err) {
        console.error(`[Fix-Dates]  All error:`, err.message);
        clearInterval(heartbeat);
        sseSend(res, 'error', { message: err.message });
        res.end();
    }
});

// =============================================================================
// REPAIR FILENAMES  fixes ytl_<uuid>.fXXX_* leaks from failed merges
// =============================================================================

app.post('/api/channels/:id/repair-filenames', async (req, res) => {
    const { id } = req.params;
    console.log(`\n[Repair Filenames] POST /api/channels/${id}/repair-filenames`);

    if (!savedChannels.has(id)) {
        return res.status(404).json({ success: false, error: 'Channel not found' });
    }
    const channel = savedChannels.get(id);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const heartbeat = setInterval(() => {
        try { res.write(': heartbeat\n\n'); } catch (e) {}
    }, 15000);

    try {
        const channelDir = getChannelDownloadDir(channel.name);
        const videos = channel.videos || [];
        const vidById = new Map();
        for (const v of videos) {
            const vid = v.id || v.videoId;
            if (vid) vidById.set(vid, v);
        }

        if (!fs.existsSync(channelDir)) {
            sseSend(res, 'start', { total: 0, message: 'Channel folder does not exist' });
            clearInterval(heartbeat);
            sseSend(res, 'complete', { total: 0, renamed: 0, failed: 0, skipped: 0 });
            return res.end();
        }

        const files = fs.readdirSync(channelDir);
        const brokenPattern = /^ytl_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\.f\d+(?:\.\w+)?)?(_\d{2}-\d{2}-\d{2})?(--[a-zA-Z0-9_-]{11})?\.(mp4|webm|mkv)$/i;
        const brokenFiles = files.filter(f => brokenPattern.test(f));

        sseSend(res, 'start', {
            channelId: id,
            channelName: channel.name,
            total: brokenFiles.length,
            message: `Found ${brokenFiles.length} broken file(s) in ${channel.name}`
        });

        let renamed = 0;
        let failed = 0;
        let skipped = 0;
        let processed = 0;

        for (const filename of brokenFiles) {
            processed++;
            const fullPath = path.join(channelDir, filename);
            const match = filename.match(brokenPattern);
            const videoId = match[3] ? match[3].slice(2) : null;
            const dateSuffix = match[2] || '';
            const video = videoId ? vidById.get(videoId) : null;

            if (!video) {
                skipped++;
                sseSend(res, 'progress', {
                    processed, total: brokenFiles.length,
                    renamed, failed, skipped,
                    percentage: Math.round((processed / brokenFiles.length) * 100),
                    message: `Skipped "${filename}"  no matching video in DB`
                });
                continue;
            }

            let baseName = sanitizeViaPython(video.title || 'Untitled');
            baseName = baseName.replace(/_\d{2}-\d{2}-\d{2}(--[a-zA-Z0-9_-]{11})?$/, '');
            baseName = baseName.replace(/--[a-zA-Z0-9_-]{11}$/, '');

            let newName;
            if (dateSuffix && videoId) {
                newName = `${baseName}${dateSuffix}--${videoId}.mp4`;
            } else if (dateSuffix) {
                newName = `${baseName}${dateSuffix}.mp4`;
            } else if (videoId) {
                newName = `${baseName}--${videoId}.mp4`;
            } else {
                newName = `${baseName}.mp4`;
            }

            if (newName === filename) {
                skipped++;
                continue;
            }

            const safeNewName = ensureUniqueOnDisk(channelDir, newName);
            const newPath = path.join(channelDir, safeNewName);

            try {
                fs.renameSync(fullPath, newPath);
                renamed++;

                video.finalFilename = safeNewName;
                video.filePath = newPath;
                video.syncStatus = 'downloaded';
                video.downloadStatus = 'completed';

                sseSend(res, 'progress', {
                    processed, total: brokenFiles.length,
                    renamed, failed, skipped,
                    percentage: Math.round((processed / brokenFiles.length) * 100),
                    videoId,
                    oldFilename: filename,
                    newFilename: safeNewName,
                    message: ` ${filename}  ${safeNewName}`
                });
            } catch (err) {
                failed++;
                sseSend(res, 'progress', {
                    processed, total: brokenFiles.length,
                    renamed, failed, skipped,
                    percentage: Math.round((processed / brokenFiles.length) * 100),
                    videoId,
                    error: err.message,
                    message: ` Failed to rename "${filename}": ${err.message}`
                });
            }
        }

        saveDatabase();
        clearInterval(heartbeat);

        sseSend(res, 'complete', {
            success: true,
            channelId: id,
            total: brokenFiles.length,
            renamed,
            failed,
            skipped,
            message: `Repair complete: ${renamed} renamed, ${skipped} skipped, ${failed} failed`
        });
        res.end();
    } catch (err) {
        console.error(`[Repair Filenames]  Error:`, err.message);
        clearInterval(heartbeat);
        sseSend(res, 'error', { message: err.message });
        res.end();
    }
});

// =============================================================================
// ERROR HANDLING
// =============================================================================

app.use((err, req, res, next) => {
    console.error('\n [Server Error]', err.message);
    res.status(500).json({
        error: 'Internal server error',
        message: err.message
    });
});

app.use((req, res) => {
    console.log('\n[404] Not Found:', req.method, req.originalUrl);

    res.status(404).json({
        error: 'Not found',
        endpoint: req.method + ' ' + req.originalUrl,
        availableEndpoints: [
            'GET    /api/health',
            'GET    /api/settings',
            'PUT    /api/settings',
            'POST   /api/settings/test-folder',
            'GET    /api/channels',
            'POST   /api/channels',
            'GET    /api/channels/:id',
            'GET    /api/channels/:id/videos',
            'DELETE /api/channels/:id',
            'POST   /api/channels/save-all',
            'POST   /api/channels/sync-all',
            'POST   /api/channels/sync-all-stream',
            'GET    /api/channels/:id/sync-status',
            'POST   /api/channels/:id/refresh',
            'POST   /api/channels/:id/stop',
            'POST   /api/channels/:id/fix-dates',
            'POST   /api/channels/:id/update-database',
            'POST   /api/video/info',
            'POST   /api/download',
            'POST   /api/download/start',
            'POST   /api/download/batch',
            'POST   /api/download/sequential',
            'GET    /api/download/sequential/status',
            'POST   /api/download/sequential/pause',
            'POST   /api/download/sequential/cancel',
            'GET    /api/download/queue/status',
            'POST   /api/download/queue/clear',
            'POST   /api/download/:id/stop',
            'POST   /api/download/:id/cancel',
            'DELETE /api/download/:id/remove',
            'POST   /api/download/:id/force-stop',
            'GET    /api/download-queue',
            'DELETE /api/download-queue',
            'POST   /api/download-single',
            'POST   /api/download-single/confirm',
            'GET    /api/single-file/files',
            'GET    /api/files',
            'GET    /api/download-file/:filename',
            'POST   /api/files/fix-dates-single-file',
            'POST   /api/files/fix-dates-all',
            'GET    /api/cookies/validate',
            'POST   /api/cookies/repair',
            'POST   /api/cookies/extract',
            'GET    /api/system/status',
            'GET    /api/logs',
            'DELETE /api/logs',
            'POST   /api/login',
            'POST   /api/logout',
            'GET    /api/auth/status'
        ]
    });
});

// =============================================================================
// SERVER STARTUP
// =============================================================================

validateAuthConfig();

//  FIX: Resolve Node FIRST (used by --js-runtimes), then populate the flags
detectNodeBinary();
//  FIX: always pass just "node" and let yt-dlp resolve via PATH.
// Passing the full path breaks when the path contains spaces
// (yt-dlp's CLI parser splits on whitespace).
YTDLP_GLOBAL_FLAGS_ARR = ['--js-runtimes', 'node'];
YTDLP_GLOBAL_FLAGS_STR = '--js-runtimes node';

//  FIX: Resolve yt-dlp binary
detectYtDlpBinary();

//  FIX: Detect ffmpeg (PATH + imageio-ffmpeg fallback)
detectFfmpeg();

getNativeCookiePath();

console.log('\n[Startup]  Checking yt-dlp version...');
try {
    const versionOut = execFileSync(YTDLP_BIN, ['--version'], {
        encoding: 'utf-8', windowsHide: true, timeout: 10000
    }).trim();
    console.log(`[Startup]  yt-dlp version: ${versionOut}`);
    console.log(`[Startup]    Global flags: ${YTDLP_GLOBAL_FLAGS_STR}`);
    console.log('[Startup]    If you see "Signature solving failed" errors, run:');
    console.log('[Startup]      python -m pip install -U "yt-dlp[default]" yt-dlp-ejs');
} catch (e) {
    console.warn(`[Startup]  Could not verify yt-dlp: ${e.message}`);
}

console.log('\n[Startup]  Checking cookies.txt for format issues...');
const repairResult = repairCookiesFile(AUTH_CONFIG.cookieFilePath);
if (repairResult.repaired) {
    console.log(`[Startup]  cookies.txt auto-repaired: ${repairResult.fixedCount} line(s) fixed`);
    console.log(`[Startup]    Backup saved to: ${repairResult.backupPath}`);
} else if (repairResult.reason && !repairResult.reason.includes('does not exist') && !repairResult.reason.includes('No issues')) {
    console.log(`[Startup]  cookies.txt repair skipped: ${repairResult.reason}`);
} else if (repairResult.reason === 'No issues found') {
    console.log(`[Startup]  cookies.txt format is valid (no repair needed)`);
}

if (!isCookiesFileValid(false)) {
    console.log('\n[Startup]  cookies.txt missing or invalid  attempting auto-extraction from browser...');
    autoExtractCookiesViaPython({ browser: 'auto' }).then(extractResult => {
        if (extractResult.success) {
            console.log(`\n[Startup]  Auto-extraction succeeded! cookies.txt created (${extractResult.sizeBytes} bytes)`);
        } else {
            console.log(`\n[Startup]  Auto-extraction failed: ${extractResult.error}`);
            if (extractResult.installCommand) {
                console.log(`[Startup]    Fix: Run "${extractResult.installCommand}" then restart server`);
            }
        }
    });
} else {
    console.log('[Startup]  cookies.txt is valid  auto-extraction not needed');
}

console.log('\n' + '='.repeat(70));
console.log(' COOKIE MODE DETECTION');
console.log('='.repeat(70));

if (isCookiesFileValid()) {
    console.log(' Mode: cookies.txt file (RECOMMENDED)');
    console.log('   Path:', AUTH_CONFIG.cookieFilePath);
} else {
    console.log('  Mode: Browser fallback (' + AUTH_CONFIG.browserName + ')');
    console.log('   Reason: cookies.txt not found or invalid format');
}
console.log('='.repeat(70) + '\n');

// =============================================================================
// NETWORK MONITOR WIRING + STARTUP
// =============================================================================
networkMonitor.on('offline', () => {
    downloadQueue.pauseForNetwork();
    sseBroadcastNetwork('offline');
});
networkMonitor.on('online', () => {
    downloadQueue.resumeFromNetwork();
    sseBroadcastNetwork('online');
});

networkMonitor.start();

process.on('SIGINT', () => {
    console.log('\n[Shutdown] SIGINT received - cleaning up...');
    networkMonitor.stop();
    for (const { proc } of activeChildProcesses.values()) {
        try { proc.kill('SIGTERM'); } catch {}
    }
    activeChildProcesses.clear();
    process.exit(0);
});

app.listen(PORT, () => {
    console.log('');
    console.log('                    SERVER STARTED!                       ');
    console.log('                                                              ');
    console.log(`   Server:     http://localhost:${PORT}                            `);
    console.log(`   Downloads:  ${DOWNLOADS_DIR}`);
    console.log(`   FFmpeg:     ${FFMPEG_AVAILABLE ? ' ' + (FFMPEG_PATH || 'on PATH') : ' Not found'}`);
    console.log(`   Cookies:    ${isCookiesFileValid() ? ' Valid' : ' Using browser'}`);
    console.log(`   yt-dlp:     ${YTDLP_BIN}`);
    console.log(`   Node:       ${NODE_BIN}`);
    console.log('   Auth:        Enabled (Session-based)                    ');
    console.log('                                                              ');
    console.log('');
    console.log('  Available API Endpoints:                                   ');
    console.log('');
    console.log('  GET    /api/settings          View/change download folder     ');
    console.log('  PUT    /api/settings          Update settings                 ');
    console.log('  POST   /api/channels          Load channel videos             ');
    console.log('  POST   /api/download          Download single video (queued)  ');
    console.log('  POST   /api/download/batch    Batch download (sequential)     ');
    console.log('  POST   /api/download/sequential Sequential (one at a time)    ');
    console.log('  GET    /api/download/queue/status Queue status (max 2)        ');
    console.log('  GET    /api/files             List all downloaded files       ');
    console.log('  GET    /api/download-file/:id Download file by ID             ');
    console.log('');
    console.log('');
    console.log(' FEATURES ENABLED:');
    console.log('   -  Authentication (Session-based, 2-day expiry)');
    console.log('   -  Rate limiting (5 login attempts per 15 min)');
    console.log('   -  Duplicate filename handling');
    console.log('   -  Sequential download (one at a time)');
    console.log('   -  Download Queue (MAX 2 concurrent, rest wait in queue)');
    console.log('   -  JS runtime enabled for yt-dlp (--js-runtimes node)');
    console.log('   -  FFmpeg auto-detection (PATH + imageio-ffmpeg fallback)');
    console.log('   -  yt-dlp auto-detection (PATH + python + known locations)');
    console.log('');
});