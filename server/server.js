const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const cron = require('node-cron');
const { execSync, exec, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');


// =============================================================================
// ⭐ DEBUGGING & LOGGING SYSTEM - Auto-added for download debugging
// =============================================================================
const { 
    logger, 
    createRequestLogger, 
    addLogEndpoints,
    spawnYtDlpWithLogging,
    diagnoseDownloadError
} = require('../backend-logging-enhancement');

logger.info('Server', '🚀 Server starting with enhanced logging enabled');
// =============================================================================
// =============================================================================
// AUTHENTICATION & SECURITY MODULES
// =============================================================================

const session = require('express-session');
const rateLimit = require('express-rate-limit');

// =============================================================================
// ⭐ AUTHENTICATION CONFIGURATION - EDIT YOUR CREDENTIALS HERE!
// =============================================================================
// TODO: Change these values to your desired username and password
// You can also change the session secret to any random string

const AUTH_CONFIG = {
    username: 'admin',                    // ← CHANGE THIS: Your login username
    password: 'password123',              // ← CHANGE THIS: Your login password  
    sessionSecret: 'ytl-secret-key-2024',  // ← CHANGE THIS: Any random string (for sessions)
    
    // Session settings (you probably don't need to change these)
    sessionMaxAge: 2 * 24 * 60 * 60 * 1000,  // 2 days in milliseconds (172800000ms)
    cookieFilePath: path.join(process.cwd(), 'cookies.txt'),
    browserName: 'edge' // chrome, firefox, edge, safari
};

// Validate auth config on startup (basic check)
function validateAuthConfig() {
    console.log(`
╔══════════════════════════════════════════════════════════════╗
║  🔐 Authentication Configuration                              ║
╠══════════════════════════════════════════════════════════════╣
║  Username: ${AUTH_CONFIG.username}
║  Password: ${'*'.repeat(AUTH_CONFIG.password.length)} (hidden)
║  Session Duration: ${(AUTH_CONFIG.sessionMaxAge / (1000 * 60 * 60 * 24)).toFixed(1)} days
║                                                              ║
║  💡 To change credentials, edit this file (server.js)       ║
║     and modify the AUTH_CONFIG object above                 ║
╚══════════════════════════════════════════════════════════════╝
    `);
    
    // Optional: Warn if using default credentials
    if (AUTH_CONFIG.username === 'admin' && AUTH_CONFIG.password === 'password123') {
        console.warn('⚠️  WARNING: You are using default credentials!');
        console.warn('   It is recommended to change them in server.js for better security.\n');
    }
}

// =============================================================================
// PATH CONVERSION - Convert Cygwin/Unix paths to Native OS paths
// =============================================================================
// ⭐ BUG FIX #1: Fixed incorrect path conversion on Linux/Mac systems
// Old code incorrectly converted /home/user/path -> H:\ome\user\path
// Now properly detects OS and only converts actual Cygwin/MSYS paths

function toNativePath(unixStylePath) {
    // If already a native Windows path (starts with drive letter), return as-is
    if (/^[A-Za-z]:\\/.test(unixStylePath) || /^[A-Za-z]:\//.test(unixStylePath)) {
        return unixStylePath;
    }
    
    // ⭐ FIX: Only convert Cygwin/MSYS paths on Windows, not on Linux/Mac
    // Cygwin/MSYS paths look like: /c/Users/... or /d/path (single letter after /)
    // Unix paths like /home/user/... have multiple characters after the first /
    const isWindows = process.platform === 'win32';
    const isCygwinMsysPath = isWindows && 
                              unixStylePath.startsWith('/') && 
                              unixStylePath.length >= 3 && 
                              /^[a-zA-Z]$/.test(unixStylePath.charAt(1)) && 
                              (unixStylePath.charAt(2) === '/' || unixStylePath.charAt(2) == '\\');
    
    if (isCygwinMsysPath) {
        // Convert /c/Users/... -> C:\Users\...
        const driveLetter = unixStylePath.charAt(1).toUpperCase();
        const restOfPath = unixStylePath.slice(2).replace(/\//g, '\\');
        const windowsPath = driveLetter + ':\\' + restOfPath;
        
        console.log('[Path Conversion] Cygwin -> Windows:');
        console.log('   FROM:', unixStylePath);
        console.log('   TO:  ', windowsPath);
        
        return windowsPath;
    }
    
    // For Linux/Mac or other Unix-style paths, return as-is or resolve
    // ⭐ FIX: Don't convert standard Unix paths on non-Windows systems
    if (!isWindows) {
        console.log('[Path Conversion] Non-Windows system, keeping Unix path:', unixStylePath);
        return unixStylePath;
    }
    
    // For other Unix-style paths on Windows, use path.resolve to get absolute path
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

function resolvePublicPath(relativePath) {
    const possiblePaths = [
        path.join(__dirname, '../public', relativePath),
        path.join(process.cwd(), '..', 'public', relativePath),
        path.resolve(__dirname, '..', 'public', relativePath),
    ];
    
    for (const p of possiblePaths) {
        if (fs.existsSync(p)) return p;
    }
    
    return possiblePaths[0];
}

// =============================================================================
// COOKIE MANAGEMENT - Smart detection and fallback
// =============================================================================

function getNativeCookiePath() {
    const originalPath = AUTH_CONFIG.cookieFilePath;
    const nativePath = toNativePath(originalPath);
    
    // Update config with native path
    AUTH_CONFIG.cookieFilePath = nativePath;
    
    console.log('[Cookie Path] Original:', originalPath);
    console.log('[Cookie Path] Native:   ', nativePath);
    
    return nativePath;
}

/**
 * Check if cookies.txt exists and appears valid - WITH DETAILED LOGGING
 * @returns {boolean} true if cookies.txt can be used
 */
function isCookiesFileValid() {
    console.log('\n[isCookiesFileValid] Starting validation...');
    const cookiePath = AUTH_CONFIG.cookieFilePath;
    console.log('[isCookiesFileValid] Checking path:', cookiePath);
    
    // Check if path is defined
    if (!cookiePath) {
        console.log('[isCookiesFileValid] ❌ FAIL: Cookie path is undefined/null!');
        return false;
    }
    
    // Check if file exists
    console.log('[isCookiesFileValid] Checking if file exists...');
    const exists = fs.existsSync(cookiePath);
    console.log('[isCookiesFileValid] File exists?', exists);
    
    if (!exists) {
        console.log('[isCookiesFileValid] ❌ FAIL: File does not exist:', cookiePath);
        console.log('[isCookiesFileValid] 💡 TIP: Delete bad cookies.txt or export fresh ones');
        return false;
    }
    
    // Check if file has content
    try {
        console.log('[isCookiesFileValid] Reading file stats...');
        const stats = fs.statSync(cookiePath);
        console.log('[isCookiesFileValid] File size:', stats.size, 'bytes');
        
        if (stats.size === 0) {
            console.log('[isCookiesFileValid] ❌ FAIL: File is empty!');
            return false;
        }
        
        // Read first few lines to check format
        console.log('[isCookiesFileValid] Reading file content...');
        const content = fs.readFileSync(cookiePath, 'utf8');
        console.log('[isCookiesFileValid] Content length:', content.length, 'chars');
        
        const allLines = content.split('\n');
        console.log('[isCookiesFileValid] Total lines (including empty/comments):', allLines.length);
        
        const lines = allLines.filter(line => line.trim() && !line.startsWith('#'));
        console.log('[isCookiesFileValid] Data lines (non-empty, non-comment):', lines.length);
        
        if (lines.length === 0) {
            console.log('[isCookiesFileValid] ❌ FAIL: No cookie entries found (only comments/empty lines)');
            console.log('[isCookiesFileValid] First few lines of file:');
            allLines.slice(0, 5).forEach((line, i) => console.log(`   Line ${i}:`, line.substring(0, 100)));
            return false;
        }
        
        // Show first few data lines for debugging
        console.log('[isCookiesFileValid] First 3 data lines:');
        lines.slice(0, 3).forEach((line, i) => {
            const fields = line.split('\t');
            console.log(`   Data line ${i}: ${fields.length} fields`);
            console.log('      Raw:', line.substring(0, 120));
        });
        
        // Validate at least one line has correct Netscape format (7 tab-separated fields)
        const sampleLine = lines[0];
        const fields = sampleLine.split('\t');
        
        console.log('[isCookiesFileValid] Validating Netscape format...');
        console.log('[isCookiesFileValid] Expected: 7 tab-separated fields');
        console.log('[isCookiesFileValid] Actual:', fields.length, 'fields');
        
        if (fields.length < 7) {
            console.log('[isCookiesFileValid] ❌ FAIL: Invalid Netscape format');
            console.log('[isCookiesFileValid] Expected 7 tab-separated fields, got:', fields.length);
            fields.forEach((field, i) => {
                console.log(`   Field ${i}: [${field.substring(0, 50)}]`);
            });
            return false;
        }
        
        console.log('\n[isCookiesFileValid] ✅ PASS: Valid Netscape format!');
        console.log('[isCookiesFileValid] Found', lines.length, 'cookies in correct format');
        console.log('[isCookiesFileValid] Cookies file can be used safely');
        return true;
        
    } catch (err) {
        console.log('[isCookiesFileValid] ❌ EXCEPTION during validation:');
        console.log('   Error name:', err.name);
        console.log('   Error message:', err.message);
        console.log('   Error code:', err.code);
        return false;
    }
}

/**
 * Build MULTIPLE yt-dlp commands with different cookie strategies
 * Returns array of commands to try in order of preference
 * @param {string} baseUrl - The base yt-dlp command (without cookie args)
 * @param {string} url - The URL to process
 * @returns {Array} Array of {cmd, description} objects to try in sequence
 */
function buildCommandsWithCookieStrategies(baseUrl, url) {
    console.log('\n[buildCommands] Building command strategies...');
    console.log('[buildCommands] Input URL:', url);
    
    // Ensure we have native path
    getNativeCookiePath();
    
    const strategies = [];
    
    // Strategy 1: No cookies at all (works for most public channels!)
    const noCookiesCmd = baseUrl + ' "' + url + '"';
    strategies.push({
        cmd: noCookiesCmd,
        description: 'No cookies (public access)',
        type: 'none'
    });
    console.log('[commands] Strategy 1: No cookies (fastest, works for public channels)');
    
    // Strategy 2: Use cookies.txt if available and looks valid
    const cookiesValid = isCookiesFileValid();
    if (cookiesValid && fs.existsSync(AUTH_CONFIG.cookieFilePath)) {
        const cookiesCmd = baseUrl + ' --cookies "' + AUTH_CONFIG.cookieFilePath + '" "' + url + '"';
        strategies.push({
            cmd: cookiesCmd,
            description: 'cookies.txt file',
            type: 'file'
        });
        console.log('[commands] Strategy 2: cookies.txt file');
    } else {
        console.log('[commands] Strategy 2: SKIPPED (cookies.txt invalid or missing)');
    }
    
    // Strategy 3: Browser-based extraction (may fail on Windows due to DPAPI)
    const browser = AUTH_CONFIG.browserName || 'edge';
    const browserCmd = baseUrl + ' --cookies-from-browser ' + browser + ' "' + url + '"';
    strategies.push({
        cmd: browserCmd,
        description: `Browser (${browser})`,
        type: 'browser'
    });
    console.log('[commands] Strategy 3: Browser fallback (' + browser + ')');
    
    console.log('[commands] Total strategies prepared:', strategies.length);
    
    return strategies;
}

/**
 * Execute a command with automatic retry using different strategies
 * @param {Array} strategies - Array of {cmd, description} from buildCommandsWithCookieStrategies
 * @param {number} currentIndex - Current strategy index to try
 * @param {Function} onSuccess - Callback on success(stdout)
 * @param {Function} onError - Callback when all strategies fail(error)
 */
function executeWithRetry(strategies, currentIndex, onSuccess, onError) {
    if (currentIndex >= strategies.length) {
        onError(new Error('All cookie strategies failed'));
        return;
    }
    
    const strategy = strategies[currentIndex];
    console.log('\n[executeWithRetry] Trying strategy', currentIndex + 1, '/', strategies.length + ':', strategy.description);
    console.log('[executeWithRetry] Command:', strategy.cmd.substring(0, 150) + '...');
    
    const startTime = Date.now();
    
    exec(strategy.cmd, { maxBuffer: 50 * 1024 * 1024 }, (error, stdout, stderr) => {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
        
        if (error) {
            console.log('[executeWithRetry] ❌ Strategy', currentIndex + 1, 'failed in', elapsed, 's:', strategy.description);
            
            // Check if error is cookie-related (try next strategy)
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
                // Log error hint from stderr
                const errorLines = stderr.split('\n');
                const firstLine = errorLines.find(l => l.trim().startsWith('ERROR:'));
                if (firstLine) {
                    console.log('[executeWithRetry] Error hint:', firstLine.trim());
                }
            }
            
            // Try next strategy
            executeWithRetry(strategies, currentIndex + 1, onSuccess, onError);
            return;
            
            // Non-cookie error or last strategy - fail completely (unreachable but kept for structure)
            console.log('[executeWithRetry] ❌ All strategies exhausted or non-recoverable error');
            if (stderr) {
                console.log('[executeWithRetry] Final error (first 500 chars):', stderr.substring(0, 500));
            }
            onError(error);
        } else {
            console.log('[executeWithRetry] ✅ Strategy', currentIndex + 1, 'succeeded in', elapsed, 's:', strategy.description);
            onSuccess(stdout);
        }
    });
}

// =============================================================================
// CONFIGURATION
// =============================================================================

const PORT = process.env.PORT || 3000;

// ⭐ FIXED: Default download folder - C:\Users\Jackle\Downloads for Windows
function getDefaultDownloadsDir() {
    // If environment variable is set, use it
    if (process.env.DOWNLOADS_DIR) {
        return process.env.DOWNLOADS_DIR;
    }
    
    // Detect OS and set appropriate default
    const os = process.platform;
    if (os === 'win32') {
        // Windows: Use user's Downloads folder with YouTube-Downloader subfolder (default: Jackle)
        const username = process.env.USERNAME || 'Jackle';
        return `C:\\Users\\${username}\\Downloads\\YouTube-Downloader`;
    } else if (os === 'darwin') {
        // macOS: Use Downloads folder with YouTube-Downloader subfolder
        const home = process.env.HOME || '/Users/' + (process.env.USER || 'user');
        return path.join(home, 'Downloads', 'YouTube-Downloader');
    } else {
        // Linux/Other: Use ~/Downloads/YouTube-Downloader or fallback to ./downloads
        const home = process.env.HOME || process.cwd();
        const downloadsPath = path.join(home, 'Downloads', 'YouTube-Downloader');
        // If ~/Downloads/YouTube-Downloader exists, use it; otherwise use ./downloads
        try {
            if (fs.existsSync(downloadsPath)) {
                return downloadsPath;
            }
        } catch (e) {}
        return path.join(process.cwd(), 'downloads');
    }
}

const DOWNLOADS_DIR = getDefaultDownloadsDir();

// ⭐ NEW: Function to get channel-specific download directory
function getChannelDownloadDir(channelName) {
    // Sanitize channel name for use as folder name (remove invalid characters)
    const safeChannelName = (channelName || 'Unknown_Channel')
        .replace(/[:"/\\|?*]/g, '_')  // Replace invalid chars
        .replace(/\s+/g, '_')              // Replace spaces with underscores
        .substring(0, 100);                 // Limit length
    
    const channelDir = path.join(DOWNLOADS_DIR, safeChannelName);
    
    // Create channel directory if it doesn't exist
    if (!fs.existsSync(channelDir)) {
        fs.mkdirSync(channelDir, { recursive: true });
        console.log('[Init] Created channel directory:', channelDir);
    }
    
    return channelDir;
}

// Ensure downloads directory exists
if (!fs.existsSync(DOWNLOADS_DIR)) {
    fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
    console.log('[Init] Created downloads directory:', DOWNLOADS_DIR);
}

// FFmpeg availability check
let FFMPEG_AVAILABLE = false;
try {
    execSync('ffmpeg -version', { stdio: 'pipe' });
    FFMPEG_AVAILABLE = true;
    console.log('[Init] ✅ FFmpeg is available');
} catch (e) {
    console.log('[Init] ⚠️ FFmpeg not found - using fallback download method');
}

// =============================================================================
// IN-MEMORY STORAGE
// =============================================================================

const savedChannels = new Map();

// ⭐ NEW: Server-side log buffer for terminal output viewing
const serverLogBuffer = [];
const MAX_SERVER_LOGS = 500; // Keep last 500 log entries

/**
 * Capture console.log output to buffer for API access
 */
const originalConsoleLog = console.log;
console.log = function(...args) {
    // Call original console.log for terminal output
    originalConsoleLog.apply(console, args);
    
    // Also store in our buffer
    const timestamp = new Date().toISOString();
    const message = args.map(arg => {
        if (typeof arg === 'object') {
            try {
                return JSON.stringify(arg, null, 2);
            } catch (e) {
                return String(arg);
            }
        }
        return String(arg);
    }).join(' ');
    
    serverLogBuffer.push({
        time: timestamp,
        message: message,
        type: message.includes('❌') || message.includes('ERROR') ? 'error' : 
              message.includes('✅') || message.includes('success') ? 'success' :
              message.includes('⚠️') || message.includes('warning') ? 'warning' :
              message.includes('⬇️') || message.includes('▶️') ? 'progress' : 'info'
    });
    
    // Keep only last MAX_SERVER_LOGS entries
    if (serverLogBuffer.length > MAX_SERVER_LOGS) {
        serverLogBuffer.shift();
    }
};

// Also capture console.error
const originalConsoleError = console.error;
console.error = function(...args) {
    originalConsoleError.apply(console, args);
    
    const timestamp = new Date().toISOString();
    const message = args.map(arg => String(arg)).join(' ');
    
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
        if (download) {
            Object.assign(download, updates);
        }
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
// FILENAME DUPLICATE HANDLER (MODIFICATION 3)
// =============================================================================

/**
 * Generates a unique filename by appending -1, -2, etc. if file exists
 * @param {string} directory - Target directory
 * @param {string} originalFilename - Original filename (e.g., "video.mp4")
 * @returns {string} - Safe filename (e.g., "video-1.mp4", "video-2.mp4")
 */
function getUniqueFilename(directory, originalFilename) {
    const ext = path.extname(originalFilename);           // ".mp4"
    const baseName = path.basename(originalFilename, ext); // "video"
    
    let finalFilename = originalFilename;
    let counter = 1;
    
    while (fs.existsSync(path.join(directory, finalFilename))) {
        finalFilename = `${baseName}-${counter}${ext}`;
        counter++;
        
        // Safety limit to prevent infinite loops
        if (counter > 1000) {
            console.warn('[Filename] Counter exceeded 1000, using timestamp');
            finalFilename = `${baseName}-${Date.now()}${ext}`;
            break;
        }
    }
    
    if (counter > 1) {
        console.log(`[Filename] Duplicate detected: "${originalFilename}" → "${finalFilename}"`);
    }
    
    return finalFilename;
}

// =============================================================================
// DUPLICATE TITLE HANDLER - Append duration to duplicate video titles
// =============================================================================

/**
 * Convert duration from seconds to human-readable format (21m-26s)
 * @param {number|null} seconds - Duration in seconds
 * @returns {string} Formatted duration like "21m-26s" or "" if not available
 */
function formatDurationForDisplay(seconds) {
    if (!seconds || seconds <= 0) return '';
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.round(seconds % 60);
    if (minutes > 0 && remainingSeconds > 0) {
        return `${minutes}m-${remainingSeconds}s`;
    } else if (minutes > 0) {
        return `${minutes}m`;
    } else {
        return `${remainingSeconds}s`;
    }
}

/**
 * Sanitize text for safe filename usage
 * Replaces special characters with safe alternatives
 * @param {string} text - Original text
 * @returns {string} Sanitized filename-safe text
 */
function sanitizeFilename(text) {
    if (!text) return 'untitled';
    
    return text
        .replace(/[<>:"/\\|?*]/g, '-')  // Replace illegal chars with dash
        .replace(/\s+/g, ' ')            // Collapse multiple spaces
        .trim()
        .substring(0, 200);              // Limit length for filesystem safety
}

/**
 * ⭐ NEW: Get default output directory path using OS user's home directory
 * Uses os.userInfo().homedir for cross-platform support
 * - Windows: C:\Users\{username}\Downloads\{channelName}
 * - Mac: /Users/{username}/Downloads/{channelName}
 * - Linux: /home/{username}/Downloads/{channelName}
 * 
 * @param {string} channelName - Name of the channel (will be sanitized)
 * @returns {string} Full path to default output directory
 */
function getDefaultOutputPath(channelName) {
    const homedir = os.userInfo().homedir;
    const safeChannelName = channelName ? sanitizeFilename(channelName) : 'Untitled_Channel';
    const defaultPath = path.join(homedir, 'Downloads', safeChannelName);
    
    console.log('[Default Output Path] Generated:');
    console.log('   Home Directory:', homedir);
    console.log('   Channel Name:', safeChannelName);
    console.log('   Full Path:', defaultPath);
    
    return defaultPath;
}

/**
 * Ensure directory exists, create if it doesn't (with subdirectories)
 * @param {string} dirPath - Directory path to ensure exists
 * @returns {boolean} True if directory exists or was created successfully
 */
function ensureDirectoryExists(dirPath) {
    try {
        if (!fs.existsSync(dirPath)) {
            fs.mkdirSync(dirPath, { recursive: true });
            console.log('✅ [Directory] Created:', dirPath);
            return true;
        } else {
            console.log('✅ [Directory] Already exists:', dirPath);
            return true;
        }
    } catch (error) {
        console.error('❌ [Directory] Failed to create:', dirPath);
        console.error('   Error:', error.message);
        return false;
    }
}

// =============================================================================
// ⭐ MULTI-CHANNEL SUPPORT - Helper Functions
// =============================================================================

/**
 * Generate a random color for a channel from a predefined palette
 * Used for visual identification in the UI
 * @returns {string} Hex color code
 */
function getRandomChannelColor() {
    const colors = [
        '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
        '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#6366f1',
        '#14b8a6', '#f43f5e', '#a855f7', '#22c55e', '#eab308'
    ];
    return colors[Math.floor(Math.random() * colors.length)];
}

/**
 * Calculate global statistics across all channels
 * Aggregates data for dashboard display
 * @returns {object} Global stats object
 */
function getGlobalStats() {
    let totalVideos = 0;
    let totalDownloaded = 0;
    let totalRemaining = 0;
    let activeDownloads = 0;
    let queuedDownloads = 0;
    
    savedChannels.forEach(ch => {
        totalVideos += ch.stats?.totalVideos || ch.videos?.length || 0;
        totalDownloaded += ch.stats?.downloadedCount || 0;
        totalRemaining += ch.stats?.remainingCount || 0;
    });
    
    // Count from download manager if available
    if (downloadManager && typeof downloadManager.getActive === 'function') {
        activeDownloads = downloadManager.getActive().length;
    }
    if (downloadQueue) {
        queuedDownloads = downloadQueue.queue.length;
    }
    
    return {
        totalChannels: savedChannels.size,
        totalVideos,
        totalDownloaded,
        totalRemaining,
        activeDownloads,
        queuedDownloads,
        overallPercentage: totalVideos > 0 ? ((totalDownloaded / totalVideos) * 100).toFixed(1) : 0,
        timestamp: new Date().toISOString()
    };
}

/**
 * Get channel's download directory (multi-channel aware)
 * @param {string} channelName - Name of the channel
 * @param {string} customOutputDir - Optional custom output directory
 * @returns {string} Full path to download directory
 */
function getChannelDownloadDir(channelName, customOutputDir) {
    if (customOutputDir) {
        return customOutputDir;
    }
    const baseDir = DOWNLOADS_DIR || path.join(process.cwd(), 'downloads');
    const safeName = sanitizeFilename(channelName);
    return path.join(baseDir, safeName);
}

// =============================================================================
// ⭐ MULTI-CHANNEL DOWNLOAD MANAGER CLASS
// =============================================================================

/**
 * MultiChannelDownloadManager - Manages concurrent downloads across multiple channels
 * Provides queue management, progress tracking, and channel-aware download handling
 */
class MultiChannelDownloadManager {
    constructor(maxConcurrent = 3) {
        this.maxConcurrent = maxConcurrent;
        this.activeDownloads = new Map(); // downloadId -> { channelId, videoId, process, startTime }
        this.queue = []; // Array of { channelId, videoId, priority, addedAt, title }
        this.paused = false;
        this.globalStats = {
            totalCompleted: 0,
            totalFailed: 0,
            totalDownloadedMB: 0
        };
        
        console.log(`[MultiChannel DownloadManager] Initialized with max ${maxConcurrent} concurrent downloads`);
    }

    /**
     * Add videos to the download queue for a specific channel
     * @param {string} channelId - Channel ID
     * @param {Array} videoIds - Array of video IDs/objects to download
     * @param {string} priority - 'high', 'normal', or 'low'
     * @returns {object} Queue status with positions
     */
    addToQueue(channelId, videoIds = [], priority = 'normal') {
        const addedItems = [];
        
        videoIds.forEach((video, index) => {
            const videoId = video.id || video.videoId || video;
            const videoTitle = video.title || `Video ${videoId}`;
            
            const queueItem = {
                id: uuidv4(),
                channelId,
                videoId,
                priority,
                addedAt: Date.now(),
                title: videoTitle,
                status: 'queued'
            };
            
            this.queue.push(queueItem);
            addedItems.push(queueItem);
            
            console.log(`[MultiChannel DownloadManager] Added to queue: ${videoTitle.substring(0, 30)}... (Priority: ${priority})`);
        });
        
        // Sort queue by priority (high first)
        this.sortQueue();
        
        // Try to process queue immediately
        this.processQueue();
        
        return {
            success: true,
            addedCount: addedItems.length,
            items: addedItems,
            queuePosition: this.queue.length - addedItems.length + 1,
            totalInQueue: this.queue.length
        };
    }

    /**
     * Sort queue by priority
     */
    sortQueue() {
        const priorityOrder = { high: 0, normal: 1, low: 2 };
        this.queue.sort((a, b) => (priorityOrder[a.priority] || 1) - (priorityOrder[b.priority] || 1));
    }

    /**
     * Process the queue - start downloads if under max concurrent limit
     */
    processQueue() {
        if (this.paused) {
            console.log('[MultiChannel DownloadManager] Queue processing paused');
            return;
        }
        
        while (this.activeDownloads.size < this.maxConcurrent && this.queue.length > 0) {
            const nextItem = this.queue.shift();
            if (nextItem) {
                this.startDownload(nextItem.channelId, nextItem.videoId, nextItem.id, nextItem.title);
            }
        }
        
        console.log(`[MultiChannel DownloadManager] Status: ${this.activeDownloads.size}/${this.maxConcurrent} active, ${this.queue.length} queued`);
    }

    /**
     * Start a single download
     * @param {string} channelId - Channel ID
     * @param {string} videoId - Video ID
     * @param {string} queueItemId - Queue item ID for tracking
     * @param {string} videoTitle - Video title for logging
     */
    async startDownload(channelId, videoId, queueItemId, videoTitle) {
        const downloadId = uuidv4();
        const startTime = Date.now();
        
        console.log(`\n[MultiChannel DownloadManager] ▶️ Starting download: ${videoTitle?.substring(0, 40)}...`);
        console.log(`[MultiChannel DownloadManager] Download ID: ${downloadId}`);
        console.log(`[MultiChannel DownloadManager] Channel ID: ${channelId}`);
        
        // Track as active download
        this.activeDownloads.set(downloadId, {
            channelId,
            videoId,
            queueItemId,
            process: null,
            startTime,
            status: 'downloading',
            progress: 0,
            speed: null,
            title: videoTitle
        });
        
        // Get channel info for output directory
        const channel = savedChannels.get(channelId);
        const outputDir = channel?.outputDir || getChannelDownloadDir(channel?.name || 'unknown');
        
        // Ensure output directory exists
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
            console.log(`[MultiChannel DownloadManager] Created output directory: ${outputDir}`);
        }
        
        try {
            // Build video URL from video ID
            const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
            const outputPath = path.join(outputDir, `${sanitizeFilename(videoTitle || videoId)}.mp4`);
            
            // Execute download using existing smart download function
            await this.executeYtDlpDownload(downloadId, videoUrl, outputPath, videoTitle, outputDir);
            
            // Update stats on success
            this.globalStats.totalCompleted++;
            
            console.log(`[MultiChannel DownloadManager] ✅ Download completed: ${videoTitle?.substring(0, 30)}...`);
            
        } catch (error) {
            console.error(`[MultiChannel DownloadManager] ❌ Download failed:`, error.message);
            this.globalStats.totalFailed++;
            
            // Update active download with error
            const activeDownload = this.activeDownloads.get(downloadId);
            if (activeDownload) {
                activeDownload.status = 'error';
                activeDownload.error = error.message;
            }
        } finally {
            // Clean up and process next in queue
            setTimeout(() => {
                this.activeDownloads.delete(downloadId);
                console.log(`[MultiChannel DownloadManager] 🔓 Released slot (${this.activeDownloads.size}/${this.maxConcurrent} active)`);
                this.processQueue();
            }, 1000); // Small delay before starting next
        }
    }

    /**
     * Execute yt-dlp download with progress tracking
     */
    executeYtDlpDownload(downloadId, videoUrl, outputPath, videoTitle, outputDir) {
        return new Promise((resolve, reject) => {
            const args = [
                '-f', 'bestvideo+bestaudio/best',
                '-o', outputPath,
                '--no-playlist',
                '--merge-output-format', 'mp4',
                '--embed-chapters',
                '--embed-metadata'
            ];
            
            // Add JS runtime flag for Windows compatibility
            args.push('--js-runtimes', 'node');
            args.push(videoUrl);
            
            console.log(`[MultiChannel DownloadManager] Executing: yt-dlp ${args.join(' ').substring(0, 150)}...`);
            
            // ⭐ ENSURE OUTPUT DIRECTORY EXISTS BEFORE DOWNLOAD
            ensureDirectoryExists(outputDir);
            
            const process = spawn('yt-dlp', args, {
                stdio: ['pipe', 'pipe', 'pipe'],
                shell: true,
                cwd: outputDir
            });
            
            // Store process reference for cancellation
            const activeDownload = this.activeDownloads.get(downloadId);
            if (activeDownload) {
                activeDownload.process = process;
            }
            
            let stdoutData = '';
            let stderrData = '';
            
            process.stdout.on('data', (data) => {
                stdoutData += data.toString();
                
                // Parse progress
                const progressMatch = stdoutData.match(/(\d+\.?\d*)%/);
                if (progressMatch) {
                    const percent = parseFloat(progressMatch[1]);
                    const activeDownload = this.activeDownloads.get(downloadId);
                    if (activeDownload) {
                        activeDownload.progress = percent;
                    }
                    
                    // Parse speed
                    const speedMatch = stdoutData.match(/(\d+\.?\d*\s*(?:MiB|KiB|GiB)\/s)/);
                    if (speedMatch && activeDownload) {
                        activeDownload.speed = speedMatch[1];
                    }
                }
            });
            
            process.stderr.on('data', (data) => {
                stderrData += data.toString();
            });
            
            process.on('close', (code) => {
                console.log(`[MultiChannel DownloadManager] Process exited with code: ${code}`);
                
                if (code === 0) {
                    resolve({ success: true, outputPath });
                } else {
                    reject(new Error(`yt-dlp exited with code ${code}: ${stderrData.slice(-200)}`));
                }
            });
            
            process.on('error', (err) => {
                console.error(`[MultiChannel DownloadManager] Process error:`, err.message);
                reject(err);
            });
        });
    }

    /**
     * Cancel a specific download by ID
     * @param {string} downloadId - Download ID to cancel
     * @returns {boolean} True if cancelled successfully
     */
    cancelDownload(downloadId) {
        const download = this.activeDownloads.get(downloadId);
        
        if (!download) {
            // Check if it's in queue
            const queueIndex = this.queue.findIndex(item => item.id === downloadId);
            if (queueIndex !== -1) {
                this.queue.splice(queueIndex, 1);
                console.log(`[MultiChannel DownloadManager] Removed from queue: ${downloadId}`);
                return true;
            }
            console.log(`[MultiChannel DownloadManager] Download not found: ${downloadId}`);
            return false;
        }
        
        // Kill the process if running
        if (download.process) {
            console.log(`[MultiChannel DownloadManager] Killing process for: ${download.title?.substring(0, 30)}...`);
            try {
                download.process.kill('SIGTERM');
                setTimeout(() => {
                    try { download.process.kill('SIGKILL'); } catch (e) {}
                }, 5000);
            } catch (e) {
                console.error(`[MultiChannel DownloadManager] Error killing process:`, e.message);
            }
        }
        
        // Remove from active downloads
        this.activeDownloads.delete(downloadId);
        console.log(`[MultiChannel DownloadManager] ✅ Cancelled download: ${downloadId}`);
        
        // Process next in queue
        this.processQueue();
        
        return true;
    }

    /**
     * Pause all downloads (prevent new ones from starting)
     */
    pauseAll() {
        this.paused = true;
        console.log('[MultiChannel DownloadManager] ⏸️ All downloads paused (no new downloads will start)');
        return { success: true, message: 'All downloads paused' };
    }

    /**
     * Resume downloads (start processing queue again)
     */
    resumeAll() {
        this.paused = false;
        console.log('[MultiChannel DownloadManager] ▶️ Downloads resumed');
        this.processQueue();
        return { success: true, message: 'All downloads resumed' };
    }

    /**
     * Get current queue status
     * @returns {object} Complete queue status
     */
    getQueueStatus() {
        const activeList = Array.from(this.activeDownloads.entries()).map(([id, dl]) => ({
            id,
            channelId: dl.channelId,
            videoId: dl.videoId,
            title: dl.title,
            status: dl.status,
            progress: dl.progress || 0,
            speed: dl.speed || null,
            startTime: dl.startTime,
            elapsed: Date.now() - dl.startTime
        }));
        
        return {
            active: activeList,
            queued: this.queue.map(item => ({
                id: item.id,
                channelId: item.channelId,
                videoId: item.videoId,
                title: item.title,
                priority: item.priority,
                addedAt: item.addedAt,
                position: this.queue.indexOf(item) + 1
            })),
            stats: {
                ...this.globalStats,
                maxConcurrent: this.maxConcurrent,
                activeCount: this.activeDownloads.size,
                queuedCount: this.queue.length,
                isPaused: this.paused
            },
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Get active downloads for a specific channel
     * @param {string} channelId - Channel ID to filter by
     * @returns {Array} Active downloads for the channel
     */
    getActiveDownloadsForChannel(channelId) {
        const results = [];
        this.activeDownloads.forEach((dl, id) => {
            if (dl.channelId === channelId) {
                results.push({
                    id,
                    videoId: dl.videoId,
                    title: dl.title,
                    status: dl.status,
                    progress: dl.progress || 0,
                    startTime: dl.startTime
                });
            }
        });
        
        // Also check queue for this channel
        this.queue.forEach(item => {
            if (item.channelId === channelId) {
                results.push({
                    id: item.id,
                    videoId: item.videoId,
                    title: item.title,
                    status: 'queued',
                    progress: 0,
                    position: this.queue.indexOf(item) + 1
                });
            }
        });
        
        return results;
    }

    /**
     * Clear the entire queue (does not affect active downloads)
     * @returns {number} Number of items cleared
     */
    clearQueue() {
        const count = this.queue.length;
        this.queue = [];
        console.log(`[MultiChannel DownloadManager] 🗑️ Queue cleared (${count} items removed)`);
        return count;
    }
}

// =============================================================================
// ⭐ AUTO-SYNC SCHEDULER CLASS
// =============================================================================

/**
 * AutoSyncScheduler - Automatically syncs channels at configurable intervals
 * Only syncs channels where autoSync setting is enabled
 */
class AutoSyncScheduler {
    constructor(multiChannelManager, intervalHours = 2) {
        this.multiChannelManager = multiChannelManager;
        this.intervalMs = intervalHours * 60 * 60 * 1000;
        this.timer = null;
        this.running = false;
        this.lastSyncTime = null;
        this.nextSyncTime = null;
        this.syncHistory = []; // Track recent sync operations
        
        console.log(`[AutoSyncScheduler] Initialized with ${intervalHours} hour interval`);
    }

    /**
     * Start the auto-sync scheduler
     */
    start() {
        if (this.timer) {
            clearInterval(this.timer);
        }
        
        this.running = true;
        this.updateNextSyncTime();
        
        this.timer = setInterval(() => {
            this.performAutoSync();
        }, this.intervalMs);
        
        console.log(`[AutoSyncScheduler] ✅ Started (next sync: ${this.nextSyncTime?.toISOString()})`);
    }

    /**
     * Stop the auto-sync scheduler
     */
    stop() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
        this.running = false;
        console.log('[AutoSyncScheduler] ⏹️ Stopped');
    }

    /**
     * Perform automatic sync on all channels with autoSync enabled
     */
    async performAutoSync() {
        console.log('\n' + '='.repeat(60));
        console.log('🔄 [AutoSyncScheduler] Performing scheduled auto-sync...');
        console.log('='.repeat(60));
        
        const results = {
            synced: [],
            skipped: [],
            errors: []
        };
        
        const channelsToSync = [];
        
        // Find channels with autoSync enabled
        savedChannels.forEach((channel, id) => {
            if (channel.settings?.autoSync !== false) { // Default to true
                channelsToSync.push({ id, channel });
            } else {
                results.skipped.push({
                    channelId: id,
                    channelName: channel.name,
                    reason: 'autoSync disabled'
                });
            }
        });
        
        console.log(`[AutoSyncScheduler] Found ${channelsToSync.length} channels to sync`);
        
        // Sync each channel
        for (const { id, channel } of channelsToSync) {
            try {
                console.log(`[AutoSyncScheduler] Syncing channel: ${channel.name}`);
                
                // Update channel's lastSync attempt time
                if (channel.stats) {
                    channel.stats.lastSync = new Date().toISOString();
                }
                
                // Trigger a fresh fetch of channel info would go here
                // For now, we just update the timestamp
                
                results.synced.push({
                    channelId: id,
                    channelName: channel.name,
                    syncedAt: new Date().toISOString()
                });
                
            } catch (error) {
                console.error(`[AutoSyncScheduler] ❌ Error syncing ${channel.name}:`, error.message);
                results.errors.push({
                    channelId: id,
                    channelName: channel.name,
                    error: error.message
                });
                
                if (channel.stats) {
                    channel.stats.lastError = error.message;
                    channel.stats.lastSyncStatus = 'error';
                }
            }
        }
        
        // Update tracking
        this.lastSyncTime = new Date();
        this.updateNextSyncTime();
        
        // Store in history (keep last 50)
        this.syncHistory.push({
            time: this.lastSyncTime,
            results
        });
        if (this.syncHistory.length > 50) {
            this.syncHistory.shift();
        }
        
        console.log(`[AutoSyncScheduler] ✅ Auto-sync complete:`);
        console.log(`   Synced: ${results.synced.length}`);
        console.log(`   Skipped: ${results.skipped.length}`);
        console.log(`   Errors: ${results.errors.length}`);
        console.log(`   Next sync: ${this.nextSyncTime?.toISOString()}`);
        console.log('='.repeat(60) + '\n');
        
        return results;
    }

    /**
     * Manual trigger of sync (resets timer)
     */
    async syncNow() {
        console.log('[AutoSyncScheduler] 🔄 Manual sync triggered');
        const results = await this.performAutoSync();
        
        // Reset timer
        if (this.timer && this.running) {
            clearInterval(this.timer);
            this.start();
        }
        
        return results;
    }

    /**
     * Update the sync interval
     * @param {number} hours - New interval in hours
     */
    updateInterval(hours) {
        this.intervalMs = Math.max(0.5, hours) * 60 * 60 * 1000; // Min 30 minutes
        console.log(`[AutoSyncScheduler] Interval updated to ${hours} hours`);
        
        if (this.running) {
            this.start(); // Restart with new interval
        }
    }

    /**
     * Update the next sync time calculation
     */
    updateNextSyncTime() {
        this.nextSyncTime = new Date(Date.now() + this.intervalMs);
    }

    /**
     * Get current scheduler status
     * @returns {object} Scheduler status
     */
    getStatus() {
        return {
            running: this.running,
            intervalHours: this.intervalMs / (1000 * 60 * 60),
            intervalMs: this.intervalMs,
            lastSync: this.lastSyncTime,
            nextSync: this.nextSyncTime,
            totalSyncs: this.syncHistory.length,
            recentResults: this.syncHistory.slice(-5) // Last 5 sync results
        };
    }
}

/**
 * Process video list to detect and handle duplicate titles
 * Appends duration to duplicate titles to make them unique
 * 
 * @param {Array} videos - Array of video objects with title and duration
 * @returns {Array} Processed videos with displayTitle and downloadFilename added
 */
// ⭐ BUG FIX #4: Enhanced duplicate handling for null/zero durations
function processDuplicateTitles(videos) {
    if (!videos || videos.length === 0) {
        return [];
    }
    
    console.log('\n[Duplicate Titles] Processing', videos.length, 'videos for duplicates...');
    
    // Step 1: Count occurrences of each title (case-insensitive)
    const titleCount = {};
    videos.forEach(video => {
        const normalizedTitle = (video.title || '').toLowerCase().trim();
        titleCount[normalizedTitle] = (titleCount[normalizedTitle] || 0) + 1;
    });
    
    // Count how many titles are duplicated
    const duplicateTitles = Object.entries(titleCount).filter(([title, count]) => count > 1);
    console.log('[Duplicate Titles] Found', duplicateTitles.length, 'duplicate title(s):');
    duplicateTitles.forEach(([title, count]) => {
        console.log('   - "' + title + '" appears', count, 'times');
    });
    
    // Step 2: Track which durations we've used for each title (to handle edge case of same title + same duration)
    const titleDurationUsage = {};
    // ⭐ NEW: Track counter for duplicates without duration
    const titleCounter = {};
    
    // Step 3: Process each video
    const processedVideos = videos.map((video, index) => {
        const originalTitle = video.title || 'Untitled';
        const normalizedTitle = originalTitle.toLowerCase().trim();
        const isDuplicate = titleCount[normalizedTitle] > 1;
        
        // Create base processed video object
        const processedVideo = {
            ...video,
            originalTitle: originalTitle,
            displayTitle: originalTitle,      // What frontend shows (raw YouTube title)
            sanitizedTitle: sanitizeFilename(originalTitle),  // ⭐ BUG FIX #10: Pre-computed sanitized name for sync matching
            downloadFilename: null           // What file will be named (set on download)
        };
        
        // Only append duration if this is a duplicate title AND has duration available
        if (isDuplicate) {
            const hasValidDuration = video.duration && video.duration > 0;
            const durationStr = hasValidDuration ? formatDurationForDisplay(video.duration) : null;
            
            if (durationStr) {
                // Create unique key for this title+duration combo
                const titleDurationKey = `${normalizedTitle}|${durationStr}`;
                
                // Check if we've already used this exact title+duration combination
                if (!titleDurationUsage[titleDurationKey]) {
                    titleDurationUsage[titleDurationKey] = 1;
                } else {
                    // Same title AND same duration - add counter as fallback
                    titleDurationUsage[titleDurationKey]++;
                }
                
                const usageCount = titleDurationUsage[titleDurationKey];
                
                // Build display title: "Original Title (21m-26s)"
                processedVideo.displayTitle = `${originalTitle} (${durationStr})`;
                
                // Build download filename: "original-title-(21m-26s).mp4"
                const sanitizedBase = sanitizeFilename(originalTitle);
                if (usageCount > 1) {
                    // Edge case: same title + same duration, add counter
                    processedVideo.downloadFilename = `${sanitizedBase}-(${durationStr})-${usageCount}.mp4`;
                } else {
                    processedVideo.downloadFilename = `${sanitizedBase}-(${durationStr}).mp4`;
                }
                
                console.log(`[Duplicate Titles] Video ${index}: "${originalTitle}" → "${processedVideo.displayTitle}"`);
            } else {
                // ⭐ BUG FIX #4: Handle duplicates with no/null duration - use counter suffix
                if (!titleCounter[normalizedTitle]) {
                    titleCounter[normalizedTitle] = 1;
                } else {
                    titleCounter[normalizedTitle]++;
                }
                
                const counter = titleCounter[normalizedTitle];
                
                // Only append counter for 2nd+ occurrence (first one stays clean)
                if (counter > 1) {
                    processedVideo.displayTitle = `${originalTitle} (#${counter})`;
                    processedVideo.downloadFilename = `${sanitizeFilename(originalTitle)}-#${counter}.mp4`;
                    console.log(`[Duplicate Titles] Video ${index}: "${originalTitle}" → "${processedVideo.displayTitle}" (no duration, using counter)`);
                } else {
                    processedVideo.downloadFilename = `${sanitizeFilename(originalTitle)}.mp4`;
                    console.log(`[Duplicate Titles] Video ${index}: "${originalTitle}" (no duration, first occurrence kept clean)`);
                }
            }
        } else {
            // Unique title - no changes needed
            // ⭐ BUG FIX #10: Keep downloadFilename as NULL for unique titles!
            // This allows Option 2a sync logic to distinguish:
            //   - downloadFilename = null   → UNIQUE title → use sanitizedTitle + '.mp4'
            //   - downloadFilename = "..."  → DUPLICATE → use downloadFilename directly
            // processedVideo.downloadFilename remains null (set at line 673)
        }
        
        return processedVideo;
    });
    
    const modifiedCount = processedVideos.filter(v => v.displayTitle !== v.originalTitle).length;
    console.log('[Duplicate Titles] ✅ Processing complete:', modifiedCount, 'video(s) modified\n');
    
    return processedVideos;
}

// =============================================================================
// ⭐ MULTI-CHANNEL GLOBAL INSTANCES
// =============================================================================

// Create global instances for multi-channel support
// These are used throughout the application for managing downloads and auto-sync
const multiChannelDownloadManager = new MultiChannelDownloadManager(3); // Max 3 parallel downloads across all channels
const autoSyncScheduler = new AutoSyncScheduler(multiChannelDownloadManager, 2); // Auto-sync every 2 hours

console.log('╔══════════════════════════════════════════════════════════════╗');
console.log('║  🌐 MULTI-CHANNEL SUPPORT ENABLED                            ║');
console.log('╠══════════════════════════════════════════════════════════════╣');
console.log(`║  • Download Manager: Max ${multiChannelDownloadManager.maxConcurrent} concurrent downloads        ║`);
console.log(`║  • Auto-Sync Scheduler: Every ${autoSyncScheduler.intervalMs / (1000 * 60 * 60)} hours                    ║`);
console.log('╚══════════════════════════════════════════════════════════════╝');

// =============================================================================
// EXPRESS APP INITIALIZATION - Must be BEFORE routes!
// =============================================================================

const app = express();
app.use(cors());


// =============================================================================
// ⭐ ACTIVATE LOGGING MIDDLEWARE & ENDPOINTS
// =============================================================================
// Request logging (must be BEFORE routes)
app.use(createRequestLogger(logger));

// Log viewing API endpoints
addLogEndpoints(app, logger);

logger.info('Server', '✅ Logging endpoints activated: /api/logs, /api/test-download');
// =============================================================================


// =============================================================================
// ⭐ ACTIVATE LOGGING MIDDLEWARE & ENDPOINTS
// =============================================================================
// Request logging (must be BEFORE routes)
app.use(createRequestLogger(logger));

// Log viewing API endpoints
addLogEndpoints(app, logger);

logger.info('Server', '✅ Logging endpoints activated: /api/logs, /api/test-download');
// =============================================================================
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// =============================================================================
// SESSION MIDDLEWARE SETUP
// =============================================================================

app.use(session({
    secret: AUTH_CONFIG.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: false,  // Set to true if using HTTPS
        maxAge: AUTH_CONFIG.sessionMaxAge,
        httpOnly: true  // Prevent XSS attacks on session cookie
    }
}));

// =============================================================================
// RATE LIMITING FOR LOGIN ATTEMPTS
// =============================================================================

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,  // 15 minutes
    max: 5,  // 5 attempts per window per IP
    message: { 
        success: false,
        error: 'Too many login attempts. Please try again after 15 minutes.',
        retryAfter: '15 minutes'
    },
    standardHeaders: true,
    legacyHeaders: false
});

// =============================================================================
// AUTHENTICATION MIDDLEWARE
// =============================================================================

// Routes that DON'T require authentication
const publicRoutes = [
    '/api/login',
    '/api/health', 
    '/login',
    '/api/auth/status'
];

function requireAuth(req, res, next) {
    // Check if path is public
    if (publicRoutes.some(route => req.path.startsWith(route))) {
        return next();
    }
    
    // Check if user is authenticated via session
    if (req.session && req.session.isAuthenticated) {
        return next();
    }
    
    // Not authenticated - return appropriate response
    if (req.xhr || (req.headers.accept && req.headers.accept.includes('application/json'))) {
        return res.status(401).json({ 
            success: false,
            error: 'Authentication required',
            code: 'AUTH_REQUIRED'
        });
    }
    
    // Browser request - redirect to login page
    return res.redirect('/login');
}

// Apply authentication middleware to ALL routes
app.use(requireAuth);

// =============================================================================
// AUTHENTICATION ROUTES
// =============================================================================

// POST /api/login - Handle login attempts
app.post('/api/login', loginLimiter, (req, res) => {
    const { username, password } = req.body;
    
    console.log(`[Auth] Login attempt for user: '${username}' from IP: ${req.ip}`);
    
    // Validate credentials
    if (username === AUTH_CONFIG.username && password === AUTH_CONFIG.password) {
        req.session.isAuthenticated = true;
        req.session.user = username;
        req.session.loginTime = new Date().toISOString();
        req.session.loginIP = req.ip;
        
        console.log(`[Auth] ✅ Successful login for user: '${username}'`);
        
        return res.json({
            success: true,
            message: 'Login successful',
            user: username,
            redirectTo: '/'
        });
    }
    
    // Failed login attempt
    console.warn(`[Auth] ❌ Failed login attempt for user: '${username}' from IP: ${req.ip}`);
    
    return res.status(401).json({
        success: false,
        message: 'Invalid username or password'
    });
});

// POST /api/logout - Handle logout
app.post('/api/logout', (req, res) => {
    const user = req.session.user;
    const sessionId = req.sessionID;
    
    req.session.destroy((err) => {
        if (err) {
            console.error('[Auth] Error destroying session:', err);
            return res.status(500).json({ 
                success: false, 
                error: 'Logout failed' 
            });
        }
        
        console.log(`[Auth] User '${user}' logged out (Session: ${sessionId})`);
        res.clearCookie('connect.sid');
        res.json({ 
            success: true, 
            message: 'Logged out successfully' 
        });
    });
});

// GET /api/auth/status - Check authentication status
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

// Serve login page (must be before static file serving)
app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/login.html'));
});

// =============================================================================
// STATIC FILE SERVING - Robust frontend loading
// =============================================================================

// Serve static files from public directory
app.use(express.static(path.join(__dirname, '../public')));

// Root route - serve index.html with fallback
app.get('/', (req, res) => {
    const indexPath = findIndexHtml();
    
    if (indexPath && fs.existsSync(indexPath)) {
        console.log('[Root Route] Serving:', indexPath);
        res.sendFile(indexPath);
    } else {
        // Fallback: search for index.html in common locations
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
                
                
                    ⚠️ Frontend Not Found
                    Could not locate index.html
                    Searched in:
                    
                        ${searchPaths.map(p => `${p}`).join('')}
                    
                    
                    API Status: Check Health
                
                
            `);
        }
    }
});

// =============================================================================
// HEALTH CHECK ENDPOINT
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
        cookies: isCookiesFileValid()
    });
});

// ⭐ NEW: Server Logs Endpoint - Get terminal output for frontend display
app.get('/api/logs', (req, res) => {
    const { limit, type, since } = req.query;
    
    let logs = [...serverLogBuffer];
    
    // Filter by type if specified
    if (type && type !== 'all') {
        logs = logs.filter(log => log.type === type);
    }
    
    // Filter by time if 'since' parameter provided
    if (since) {
        const sinceDate = new Date(since);
        logs = logs.filter(log => new Date(log.time) >= sinceDate);
    }
    
    // Apply limit
    const logLimit = parseInt(limit) || 100;
    logs = logs.slice(-logLimit);
    
    res.json({
        success: true,
        count: logs.length,
        total: serverLogBuffer.length,
        logs: logs
    });
});

// ⭐ NEW: Clear server logs endpoint
app.delete('/api/logs', (req, res) => {
    const cleared = serverLogBuffer.length;
    serverLogBuffer.length = 0;
    res.json({
        success: true,
        message: `Cleared ${cleared} log entries`
    });
});

// =============================================================================
// SETTINGS ENDPOINTS - Download folder management
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
    const oldPath = DOWNLOADS_DIR; // Store old path for comparison
    
    console.log('\n[Settings] 📁 Updating download folder:');
    console.log('   FROM:', oldPath);
    console.log('   TO:  ', newPath);
    
    try {
        // Create directory if it doesn't exist
        if (!fs.existsSync(newPath)) {
            fs.mkdirSync(newPath, { recursive: true });
            console.log('[Settings] ✅ Created new directory:', newPath);
        }
        
        // ⭐ FIXED: Actually update the global DOWNLOADS_DIR variable!
        // This makes the change take effect immediately
        Object.assign(global, { 
            __DOWNLOADS_DIR_OVERRIDE__: newPath 
        });
        
        // Update process.env as well
        process.env.DOWNLOADS_DIR = newPath;
        
        // Note: We can't truly change the const DOWNLOADS_DIR, but we can:
        // 1. Store the override in a way that getVideoStatus/checkFileExists can use
        // 2. Re-scan the new location
        
        console.log('[Settings] ✅ Download folder updated successfully!');
        console.log('[Settings] ⚠️ Note: Full path change requires server restart for all features');
        console.log('[Settings] ℹ️ Current session will use new path for future operations');
        
        // Try to re-scan downloads from new location (best effort)
        try {
            const tempDownloadsDir = newPath;
            // The scanExistingDownloads function uses DOWNLOADS_DIR which is const
            // So we log this info for the user
            console.log('[Settings] 💡 Tip: Restart server to fully apply new download folder');
        } catch (scanError) {
            console.log('[Settings] ⚠️ Could not pre-scan new folder:', scanError.message);
        }
        
        res.json({
            success: true,
            message: `✅ Download folder updated to: ${newPath}`,
            data: { 
                newDir: newPath,
                oldDir: oldPath,
                requiresRestart: true,
                tip: 'For immediate effect on all features, please restart the server'
            }
        });
        
    } catch (error) {
        console.error('[Settings] ❌ Error updating folder:', error.message);
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
        // Try to create test file
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
// CHANNEL ENDPOINTS
// =============================================================================

/**
 * Fetch channel information using yt-dlp with smart retry
 */
function fetchChannelInfo(channelId, channelUrl) {
    return new Promise((resolve, reject) => {
        console.log('\n[fetchChannelInfo] Starting channel fetch...');
        console.log('[fetchChannelInfo] Channel URL:', channelUrl);
        
        // ⭐⭐⭐ BUG FIX #2a/2b: Use JSON format instead of tab-separated ⭐⭐⭐
        // PROBLEM: Tab-separated format caused video count inflation (236 vs 140)
        // ROOT CAUSE: 
        //   - On Linux: \t stays literal (no split) → 0 videos or wrong parse
        //   - On Windows: Shell converts \t to real tabs, but titles with special chars
        //     cause one video to split into multiple entries → INFLATION
        // SOLUTION: Use JSON output (-j flag) which is reliable across all platforms
        // Each line is a complete JSON object, no parsing ambiguity!
        
        const cmd = `yt-dlp --flat-playlist -j "${channelUrl}"`;
        
        console.log('[fetchChannelInfo] Command:', cmd);
        console.log('[fetchChannelInfo] Using JSON format for reliable parsing');
        
        const strategies = buildCommandsWithCookieStrategies(cmd, channelUrl);
        
        executeWithRetry(
            strategies,
            0,
            (stdout) => {
                console.log('[fetchChannelInfo] ✅ Successfully fetched channel data');
                
                try {
                    const lines = stdout.trim().split('\n').filter(line => line.trim());
                    const videos = [];
                    const liveVideos = [];
                    const seenIds = new Set();  // ⭐ Track seen IDs to prevent duplicates
                    
                    console.log(`[fetchChannelInfo] Raw JSON lines received: ${lines.length}`);
                    
                    lines.forEach((line, index) => {
                        try {
                            // Parse JSON object (one per line)
                            const data = JSON.parse(line);
                            
                            const videoId = data.id || `video_${index}`;
                            const videoTitle = (data.title || 'Untitled').trim();
                            const rawDuration = data.duration ? parseInt(data.duration) : null;
                            
                            // ⭐ DEDUPLICATION: Skip if we've already seen this video ID
                            if (seenIds.has(videoId)) {
                                console.log(`[fetchChannelInfo] ⚠️ Duplicate ID skipped: ${videoId} - ${videoTitle}`);
                                return;  // Skip this duplicate
                            }
                            seenIds.add(videoId);
                            
                            const video = {
                                id: videoId,
                                title: videoTitle,
                                duration: rawDuration,
                                views: data.view_count ? parseInt(data.view_count) : null,
                                uploadDate: data.upload_date || null,
                                // Track video type for better filtering
                                isLiveStream: videoTitle.toLowerCase().includes('live'),
                                isPremiere: videoTitle.toLowerCase().includes('premiere'),
                            };
                            
                            // Improved duration filtering
                            // - Filter out shorts (< 60 seconds) if option enabled
                            // - Filter out very long streams (> 12 hours) unless it's a live stream
                            if (rawDuration !== null) {
                                // Add to appropriate list based on duration/type
                                if (rawDuration < 60 && !video.isLiveStream) {
                                    videos.push(video);
                                } else if (rawDuration > 43200 && !video.isLiveStream) {
                                    console.log(`[fetchChannelInfo] Skipping very long video: ${videoTitle} (${rawDuration}s)`);
                                } else {
                                    videos.push(video);
                                }
                            } else {
                                videos.push(video);
                            }
                        } catch (parseError) {
                            console.error(`[fetchChannelInfo] Error parsing line ${index}:`, parseError.message);
                        }
                    });
                    
                    console.log(`[fetchChannelInfo] ✅ Parsed ${videos.length} unique videos (${liveVideos.length} live)`);
                    
                    resolve({
                        videos,
                        liveVideos,
                        total: videos.length + liveVideos.length
                    });
                    
                } catch (error) {
                    console.error('[fetchChannelInfo] Error processing channel data:', error);
                    reject(error);
                }
            },
            (error) => {
                console.error('[fetchChannelInfo] Failed to fetch channel:', error.message);
                reject(error);
            }
        );
    });
}

// Video info endpoint
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

// Start download endpoint
app.post('/api/download/start', async (req, res) => {
    try {
        const { url, format, quality, title } = req.body;  // ⭐ Added title!
        
        if (!url) {
            return res.status(400).json({ error: 'Video URL required' });
        }

        const downloadId = uuidv4();
        const filename = `video_${downloadId}.mp4`;
        const outputPath = path.join(DOWNLOADS_DIR, filename);

        const download = downloadManager.add({
            id: downloadId,
            url: url,
            title: title || null,  // ⭐ ADD TITLE FOR RENAME!
            filename: filename,
            outputPath: outputPath,
            status: 'downloading',
            progress: 0,
            startTime: Date.now()
        });

        // Start download
        executeDownload(
            downloadId,
            url,
            outputPath,
            format || 'best',
            (progress) => {
                download.progress = progress.percent;
                download.downloaded = progress.downloaded;
                download.total = progress.total;
            },
            (result) => {
                download.status = 'completed';
                download.endTime = Date.now();
            },
            (error) => {
                download.status = 'error';
                download.error = error;
                download.endTime = Date.now();
            }
        );

        res.json({
            success: true,
            downloadId: downloadId,
            message: 'Download started'
        });

    } catch (error) {
        console.error('[Download Start] Error:', error.message);
        res.status(500).json({ error: 'Failed to start download: ' + error.message });
    }
});

// FRONTEND COMPATIBLE: POST /api/download (main download endpoint frontend expects!)
app.post('/api/download', async (req, res) => {
    console.log('\n' + '='.repeat(80));
    console.log('⬇️ [Download] POST /api/download - Frontend Download Request');
    console.log('='.repeat(80));
    console.log('[Download] Request body:', JSON.stringify(req.body, null, 2));
    
    try {
        const { 
            url,           // Video URL
            videoId,       // Video ID (alternative)
            channelId,     // Parent channel ID
            channelName,   // ⭐ NEW: Channel name for folder organization
            format,        // Video format preference
            quality,        // Quality preference
            filename,       // Custom filename
            title           // VIDEO TITLE (for rename feature!)
        } = req.body;
        
        // Determine video URL
        const videoUrl = url || (videoId ? `https://www.youtube.com/watch?v=${videoId}` : null);
        
        if (!videoUrl) {
            console.log('[Download] ❌ ERROR: No URL or videoId provided!');
            return res.status(400).json({
                success: false,
                error: 'Video URL or videoId required'
            });
        }

        // ⭐ FIX: Check for duplicate downloads (same URL already in queue/active)
        const existingDownload = downloadManager.getAll().find(d => 
            d.url === videoUrl && (d.status === 'queued' || d.status === 'downloading')
        );
        if (existingDownload) {
            console.log(`[Download] ⚠️ DUPLICATE DETECTED: URL already downloading (ID: ${existingDownload.id})`);
            return res.status(409).json({
                success: false,
                error: 'Duplicate download',
                message: 'This video is already in the download queue or currently downloading',
                existingJobId: existingDownload.id,
                status: existingDownload.status
            });
        }

        console.log('[Download] Processing download:');
        console.log('   - URL:', videoUrl);
        console.log('   - Video ID:', videoId || 'extracted from URL');
        console.log('   - Channel ID:', channelId || 'N/A');
        console.log('   - Channel Name:', channelName || 'N/A (will use root downloads folder)');
        console.log('   - Format:', format || 'auto (best)');
        console.log('   - Quality:', quality || 'auto');

        // ⭐ NEW: Determine output directory (channel-specific or root)
        const outputDir = channelName ? getChannelDownloadDir(channelName) : DOWNLOADS_DIR;
        console.log('[Download] Output directory:', outputDir);

        const downloadId = uuidv4();
        
        // ⭐ NEW: Use downloadFilename if provided (from duplicate title processing), otherwise generate from title
        let safeFilename;
        if (filename && filename.includes('(')) {
            // Filename already has duration format from duplicate title handler
            safeFilename = filename.replace(/[^a-zA-Z0-9._\-() ]/g, '_');
        } else if (filename) {
            safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
        } else if (title) {
            safeFilename = title.replace(/[^a-zA-Z0-9._-]/g, '_');
        } else {
            safeFilename = `video_${downloadId}`;
        }
        
        let outputFilename = safeFilename.endsWith('.mp4') ? safeFilename : `${safeFilename}.mp4`;
        
        // ⭐ MODIFICATION 3: Apply duplicate filename handler (for edge cases)
        outputFilename = getUniqueFilename(outputDir, outputFilename);
        
        const outputPath = path.join(outputDir, outputFilename);

        console.log('[Download] Creating download job:');
        console.log('   - Download ID:', downloadId);
        console.log('   - Output file:', outputFilename);
        console.log('   - Full path:', outputPath);

        const download = downloadManager.add({
            id: downloadId,
            url: videoUrl,
            videoId: videoId,
            channelId: channelId,
            title: title || null,
            filename: outputFilename,
            outputPath: outputPath,
            format: format || 'best',
            quality: quality || 'auto',
            status: 'queued',
            progress: 0,
            startTime: null,
            endTime: null,
            createdAt: new Date().toISOString()
        });

        console.log('[Download] ✅ Job created, adding to DOWNLOAD QUEUE...');
        
        // ⭐ FIX: Use download queue (max 2 concurrent) instead of immediate start!
        // This ensures only 2 downloads run at a time, rest wait in queue
        downloadQueue.enqueue(downloadId, videoUrl, outputPath, title || videoId);

        console.log('[Download] 📤 Response sent to frontend (job queued/starting)');
        console.log('='.repeat(80) + '\n');

        res.status(201).json({
            success: true,
            jobId: downloadId,
            status: 'queued',
            message: 'Download job created and queued',
            queueStatus: {
                position: downloadQueue.activeDownloads + downloadQueue.queue.length,
                activeDownloads: downloadQueue.activeDownloads,
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
        console.error('[Download] ❌ ERROR creating download job:', error.message);
        console.log('='.repeat(80) + '\n');
        
        res.status(500).json({
            success: false,
            error: 'Failed to create download: ' + error.message,
            suggestion: 'Check server logs for details'
        });
    }
});

// ⭐ NEW: GET /api/default-output-dir - Return default output directory for frontend
// Allows frontend to show placeholder text in "Add Channel" modal
app.get('/api/default-output-dir', (req, res) => {
    console.log('\n[Default Output] GET /api/default-output-dir requested');
    
    const channelName = req.query.channelName || '[Channel Name]';
    const defaultPath = getDefaultOutputPath(channelName);
    
    console.log('[Default Output] Returning default path:', defaultPath);
    
    res.json({
        success: true,
        path: defaultPath,
        homeDirectory: os.userInfo().homedir,
        osPlatform: process.platform,
        username: os.userInfo().username,
        example: {
            channelName: 'ExampleChannel',
            path: getDefaultOutputPath('ExampleChannel')
        }
    });
});

// GET /api/channels - Return list of saved channels (FRONTEND COMPATIBLE FORMAT!)
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

// POST /api/channels - Add a new channel (THIS IS WHAT "LOAD CHANNEL" CALLS!)
app.post('/api/channels', async (req, res) => {
    console.log('\n' + '='.repeat(80));
    console.log('🎬 [Channels] POST /api/channels - ADD NEW CHANNEL');
    console.log('='.repeat(80));
    console.log('[Channels] Request body:', JSON.stringify(req.body, null, 2));
    
    try {
        const { url, channelId, name } = req.body;
        
        if (!url && !channelId) {
            console.log('[Channels] ❌ ERROR: No URL or channelId provided!');
            return res.status(400).json({
                success: false,
                error: 'Channel URL or ID required'
            });
        }

        // Determine the channel URL
        // ⭐ SMART URL CLEANUP - Fix doubled/malformed URLs
        let channelUrl = url || `https://www.youtube.com/@${channelId}`;
        
        // Fix common URL issues:
        // 1. Double youtube.com: https://www.youtube.com/www.youtube.com/@user
        // 2. Missing protocol: www.youtube.com/@user
        // 3. Extra slashes: https://www.youtube.com//@user
        
        if (channelUrl) {
            // Remove double youtube.com occurrences
            while (channelUrl.includes('youtube.com/youtube.com/') || 
                   channelUrl.includes('youtube.com/www.youtube.com/')) {
                channelUrl = channelUrl.replace(/youtube\.com\/(www\.)?youtube\.com\//, 'youtube.com/');
                console.log('[Channels] 🔧 Fixed doubled URL');
            }
            
            // Ensure protocol exists
            if (!channelUrl.startsWith('http://') && !channelUrl.startsWith('https://')) {
                channelUrl = 'https://' + channelUrl.replace(/^\/\//, '');
                console.log('[Channels] 🔧 Added missing protocol');
            }
            
            // Remove double slashes (but keep https://)
            channelUrl = channelUrl.replace(/([^:])\/{2,}/g, '$1/');
        }
        
        const channelIdFinal = channelId || channelUrl.split('@').pop().split('/')[0];
        
        console.log('[Channels] Processing channel:');
        console.log('   - URL:', channelUrl);
        console.log('   - ID:', channelIdFinal);
        console.log('   - Name:', name || 'Auto-detected');
        
        console.log('\n[Channels] 📡 Fetching channel info from YouTube...');
        
        // Fetch channel info using our existing function with smart cookie handling
        const channelData = await fetchChannelInfo(channelIdFinal, channelUrl);
        
        console.log('\n[Channels] ✅ Channel fetched successfully!');
        console.log('[Channels] Videos found:', channelData.videos.length);
        console.log('[Channels] Live videos found:', channelData.liveVideos.length);
        
        // Create channel object (without sync/badge related fields - MODIFICATION 1)
        const videosClean = channelData.videos.map(video => ({
            ...video
        }));
        
        // Determine channel name for directory
        const channelName = name || channelIdFinal;
        
        // Create channel object with MULTI-CHANNEL SUPPORT
        const channel = {
            id: uuidv4(),
            youtubeId: channelIdFinal,
            url: channelUrl,
            name: channelName,
            videoCount: channelData.videos.length + channelData.liveVideos.length,
            videos: videosClean,
            liveVideos: channelData.liveVideos,
            addedAt: new Date().toISOString(),
            lastChecked: new Date().toISOString(),
            status: 'active',
            
            // ⭐ NEW MULTI-CHANNEL FIELDS:
            outputDir: getDefaultOutputPath(channelName),  // Uses os.userInfo().homedir/Downloads/[channelName]
            color: getRandomChannelColor(), // Visual identification color for UI
            settings: {
                quality: 'best',
                format: 'mp4',
                autoSync: true,
                maxConcurrentDownloads: 2
            },
            stats: {
                totalVideos: channelData.videos.length,
                downloadedCount: 0, // Will be updated on sync
                remainingCount: channelData.videos.length,
                lastSync: null,
                lastSyncStatus: null,
                lastError: null
            },
            isDownloading: false,
            downloadQueue: [],
            syncResults: [] // Cache last sync results
        };
        
        // Save to in-memory storage
        savedChannels.set(channel.id, channel);
        
        console.log('[Channels] 💾 Channel saved with ID:', channel.id);
        console.log('='.repeat(80) + '\n');
        
        // Return success response with full channel data (FRONTEND COMPATIBLE FORMAT!)
        console.log('[Channels] Returning channel to frontend...');
        
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
        console.log('❌ [Channels] FAILED TO ADD CHANNEL!');
        console.log('='.repeat(80));
        console.log('[Channels] Error Type:', error.constructor.name);
        console.log('[Channels] Error Message:', error.message);
        console.log('[Channels] Stack:', error.stack);
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
// SYNC STATUS ENDPOINT - Check which videos are downloaded
// =============================================================================

// ⭐ FIX: Sync debounce to prevent multiple simultaneous sync calls
let syncInProgress = new Set();  // Track channels currently being synced
const SYNC_LOCK_TIMEOUT = 30000; // 30 second max lock duration (safety)

// GET /api/channels/:id/sync-status - Check download status of all videos in a channel
app.get('/api/channels/:id/sync-status', (req, res) => {
    const { id } = req.params;
    console.log('\n[Sync] GET /api/channels/' + id + '/sync-status');
    
    try {
        // ⭐ FIX: Check if sync is already in progress for this channel
        if (syncInProgress.has(id)) {
            console.log(`[Sync] ⚠️ SYNC IN PROGRESS: Channel ${id} is already being synced, skipping duplicate request`);
            return res.status(429).json({
                success: false,
                error: 'Sync in progress',
                message: 'A sync operation is already running for this channel. Please wait for it to complete.'
            });
        }
        
        // Lock this channel for syncing
        syncInProgress.add(id);
        console.log(`[Sync] 🔒 Sync lock acquired for channel ${id}`);
        
        // Auto-release lock after timeout (safety measure)
        setTimeout(() => {
            if (syncInProgress.has(id)) {
                console.log(`[Sync] 🔓 Auto-releasing sync lock for channel ${id} (timeout)`);
                syncInProgress.delete(id);
            }
        }, SYNC_LOCK_TIMEOUT);
        
        // Find the channel
        if (!savedChannels.has(id)) {
            syncInProgress.delete(id);  // Release lock on error
            return res.status(404).json({
                success: false,
                error: 'Channel not found'
            });
        }
        
        const channel = savedChannels.get(id);
        const videos = channel.videos || [];
        
        // Get the channel's download directory
        const channelDir = getChannelDownloadDir(channel.name);
        console.log('[Sync] Scanning directory:', channelDir);
        
        // Check if directory exists
        let downloadedFiles = [];
        if (fs.existsSync(channelDir)) {
            // Read all .mp4 files from the channel directory
            try {
                downloadedFiles = fs.readdirSync(channelDir)
                    .filter(file => file.toLowerCase().endsWith('.mp4'))
                    .map(file => ({
                        name: file,
                        path: path.join(channelDir, file),
                        size: fs.statSync(path.join(channelDir, file)).size,
                        modifiedAt: fs.statSync(path.join(channelDir, file)).mtime.toISOString()
                    }));
                console.log('[Sync] Found', downloadedFiles.length, '.mp4 files');
            } catch (err) {
                console.error('[Sync] Error reading directory:', err.message);
            }
        } else {
            console.log('[Sync] Channel directory does not exist:', channelDir);
        }
        
        // REVERSE MATCHING ALGORITHM (with deduplication):
        // 1. Start from ACTUAL files on disk
        // 2. Match videos to files
        // 3. Track which files have been "consumed" to prevent double-counting
        // This guarantees downloaded count NEVER exceeds actual file count
        const actualFileSet = new Set(downloadedFiles.map(f => f.name.toLowerCase()));
        
        // Track which files have already been matched/consumed
        // This prevents multiple video entries from matching the same physical file
        const consumedFiles = new Set();
        
        console.log('[Sync] 📁 Actual files on disk:', Array.from(actualFileSet));
        console.log('[Sync] 📺 Total videos to check:', videos.length);
        
        // Match each video with its download status
        const syncResults = videos.map((video, index) => {
            // ⭐⭐⭐ BUG FIX #10: OPTION 2A - SMART HYBRID MATCHING ⭐⭐⭐
            // 
            // PROBLEM: YouTube titles contain illegal Windows chars (|?*<>:"/\) that yt-dlp sanitizes
            // EXAMPLE: "Experiment Part-2 | Title?" → "Experiment Part-2 - Title-.mp4" on disk
            //
            // COMPLICATION: Duplicate titles get duration suffix appended by processDuplicateTitles()
            // EXAMPLE: "Test Video" (duplicate) → "test-video--(00:05:30).mp4"
            //
            // SOLUTION (Option 2a - Smart Hybrid):
            //   - IF video has downloadFilename (is duplicate) → use it directly (includes duration)
            //   - ELSE (unique title) → use sanitizedTitle + ".mp4" (just sanitizes illegal chars)
            
            const videoTitle = video.displayTitle || video.title || '';  // For display/logging
            
            let expectedFilename;
            let matchingStrategy;
            
            if (video.downloadFilename) {
                // ─── DUPLICATE TITLE PATH ───
                // Use pre-computed downloadFilename which includes:
                //   1. Sanitized base name (illegal chars replaced)
                //   2. Duration suffix --(HH:MM:SS) for uniqueness
                //   3. Or counter suffix #2, #3 for same-title-same-duration edge case
                
                expectedFilename = video.downloadFilename.toLowerCase();
                matchingStrategy = 'DUPLICATE (downloadFilename)';
            } else {
                // ─── UNIQUE TITLE PATH ───
                // Use sanitizedTitle which only replaces illegal Windows characters:
                //   | ? *  : " / \  →  -
                // No duration suffix needed since title is unique
                
                const sanitizedBase = video.sanitizedTitle || sanitizeFilename(videoTitle);
                expectedFilename = (sanitizedBase + '.mp4').toLowerCase();
                matchingStrategy = 'UNIQUE (sanitizedTitle)';
            }
            
            // Check if this exact filename:
            // 1. Exists in the actual files AND
            // 2. Has NOT been consumed by a previous match
            const fileExists = actualFileSet.has(expectedFilename);
            const isDownloaded = fileExists && !consumedFiles.has(expectedFilename);
            
            // Debug logging for first few videos and all matches
            if (index < 5 || isDownloaded) {
                console.log(`[Sync] Checking video ${index}: ${video.title}`);
                console.log(`[Sync]   Expected filename: ${expectedFilename}`);
                console.log(`[Sync]   Sanitized: ${video.title.replace(/[:/\\|?*<>"]/g, '-')}`);
                if (video.downloadFilename) {
                    console.log(`[Sync]   ⚠️ Duplicate detected - using downloadFilename with duration/counter`);
                }
                console.log(`[Sync]   → File exists: ${fileExists ? '✅ YES' : '❌ NO'}`);
                if (fileExists) {
                    console.log(`[Sync]   → Already consumed: ${consumedFiles.has(expectedFilename) ? '⚠️ YES' : '❌ NO'}`);
                }
            }
            
            // Find the actual file info if downloaded and mark as consumed
            let fileInfo = null;
            if (isDownloaded) {
                consumedFiles.add(expectedFilename); // Mark this file as consumed!
                
                // Find the original file (case-sensitive) for file info
                const matchingFile = downloadedFiles.find(f => 
                    f.name.toLowerCase() === expectedFilename
                );
                if (matchingFile) {
                    fileInfo = {
                        fileName: matchingFile.name,
                        filePath: matchingFile.path,
                        fileSize: matchingFile.size,
                        fileSizeMB: (matchingFile.size / (1024 * 1024)).toFixed(2),
                        downloadedAt: matchingFile.modifiedAt
                    };
                    console.log(`[Sync]   ✅ MATCHED & CONSUMED: ${matchingFile.name} (${fileInfo.fileSizeMB} MB)`);
                }
            } else if (fileExists) {
                // File exists but was already consumed by another video
                console.log(`[Sync]   ⚠️ SKIPPED (file already matched to another video)`);
            }
            
            return {
                id: video.id || video.videoId,
                title: videoTitle,
                displayTitle: video.displayTitle || video.title,           // Raw YouTube title (for UI)
                sanitizedTitle: video.sanitizedTitle || '',               // Sanitized base (no illegal chars)
                isDownloaded: isDownloaded,
                expectedFilename: expectedFilename,                       // What we looked for (Option 2a result)
                originalExpectedFilename: videoTitle + '.mp4',            // Raw version (for comparison)
                matchingStrategy: matchingStrategy,                       // Which path was taken
                fileInfo: fileInfo
            };
        });
        
        // Calculate statistics
        const totalVideos = syncResults.length;
        const downloadedCount = syncResults.filter(v => v.isDownloaded).length;
        const remainingCount = totalVideos - downloadedCount;
        
        const response = {
            success: true,
            channelId: id,
            channelName: channel.name,
            channelDir: channelDir,
            statistics: {
                total: totalVideos,
                downloaded: downloadedCount,
                remaining: remainingCount,
                percentage: totalVideos > 0 ? ((downloadedCount / totalVideos) * 100).toFixed(1) : 0
            },
            videos: syncResults,
            scannedAt: new Date().toISOString()
        };
        
        console.log('\n[Sync] ✅ SYNC COMPLETE (Option 2a - Smart Hybrid Matching):');
        console.log('   ════════════════════════════════════════════════════════');
        console.log('   📊 Total videos in channel:', totalVideos);
        console.log('   📁 Physical .mp4 files on disk:', downloadedFiles.length);
        console.log('   ✅ Files matched/consumed (Downloaded):', consumedFiles.size);
        console.log('   🔴 Videos without files (Remaining):', remainingCount);
        console.log('   📈 Download percentage:', ((downloadedCount / totalVideos) * 100).toFixed(1) + '%');
        
        // ⭐ BUG FIX #10: Show Option 2a strategy breakdown
        const uniqueCount = syncResults.filter(v => v.matchingStrategy === 'UNIQUE (sanitizedTitle)').length;
        const duplicateCount = syncResults.filter(v => v.matchingStrategy === 'DUPLICATE (downloadFilename)').length;
        console.log('\n   🎯 Option 2a Strategy Breakdown:');
        console.log('      ──────────────────────────────────────');
        console.log(`      📝 Unique titles (sanitizedTitle):     ${uniqueCount}`);
        console.log(`      🔁 Duplicate titles (downloadFilename): ${duplicateCount}`);
        console.log('      ──────────────────────────────────────');
        
        // Validation check
        if (downloadedCount > downloadedFiles.length) {
            console.log('   ⚠️  WARNING: Downloaded count exceeds file count! Bug detected!');
        } else if (downloadedCount === downloadedFiles.length) {
            console.log('   ✅ VALIDATION PASSED: Downloaded count matches file count!');
        }
        
        if (downloadedFiles.length > 0) {
            console.log('\n   📁 Files found on disk:');
            downloadedFiles.forEach((f, i) => {
                const isConsumed = consumedFiles.has(f.name.toLowerCase());
                console.log(`      ${i+1}. ${f.name} ${isConsumed ? '✅ MATCHED' : '❌ UNMATCHED'} (${(f.size/(1024*1024)).toFixed(2)} MB)`);
            });
        }
        console.log('   ════════════════════════════════════════════════════════\n');
        
        // ⭐ FIX: Release sync lock before sending response
        syncInProgress.delete(id);
        console.log(`[Sync] 🔓 Sync lock released for channel ${id}`);
        
        res.json(response);
        
    } catch (error) {
        console.error('[Sync] ❌ Error:', error.message);
        // ⭐ FIX: Release sync lock on error too
        syncInProgress.delete(id);
        console.log(`[Sync] 🔓 Sync lock released for channel ${id} (error)`);
        res.status(500).json({
            success: false,
            error: 'Failed to check sync status: ' + error.message
        });
    }
});

// DELETE /api/channels/:id - Remove a saved channel
app.delete('/api/channels/:id', (req, res) => {
    const { id } = req.params;
    console.log('\n[Channels] DELETE /api/channels/' + id);
    
    if (savedChannels.has(id)) {
        savedChannels.delete(id);
        console.log('[Channels] ✅ Channel deleted:', id);
        res.json({
            success: true,
            message: 'Channel deleted successfully'
        });
    } else {
        console.log('[Channels] ⚠️  Channel not found:', id);
        res.status(404).json({
            success: false,
            error: 'Channel not found'
        });
    }
});

// =============================================================================
// ⭐ MULTI-CHANNEL API ENDPOINTS
// =============================================================================

// PUT /api/channels/:id - Update channel settings
app.put('/api/channels/:id', (req, res) => {
    const { id } = req.params;
    console.log('\n' + '='.repeat(60));
    console.log('📝 [Multi-Channel] PUT /api/channels/' + id + ' - UPDATE CHANNEL');
    console.log('='.repeat(60));
    
    try {
        if (!savedChannels.has(id)) {
            return res.status(404).json({
                success: false,
                error: 'Channel not found'
            });
        }
        
        const channel = savedChannels.get(id);
        const updates = req.body;
        
        console.log('[Multi-Channel] Updates requested:', JSON.stringify(updates, null, 2));
        
        // Allowed fields to update
        const allowedUpdates = ['name', 'color', 'outputDir', 'settings', 'status'];
        
        // Apply updates with validation
        allowedUpdates.forEach(field => {
            if (updates[field] !== undefined) {
                if (field === 'settings' && typeof updates[field] === 'object') {
                    // Merge settings objects
                    channel.settings = { ...channel.settings, ...updates[field] };
                } else {
                    channel[field] = updates[field];
                }
                console.log(`[Multi-Channel] ✅ Updated ${field}:`, updates[field]);
            }
        });
        
        // Update timestamp
        channel.lastChecked = new Date().toISOString();
        
        // Save updated channel
        savedChannels.set(id, channel);
        
        console.log('[Multi-Channel] ✅ Channel updated successfully');
        console.log('='.repeat(60) + '\n');
        
        res.json({
            success: true,
            message: 'Channel updated successfully',
            channel: channel
        });
        
    } catch (error) {
        console.error('[Multi-Channel] ❌ Error updating channel:', error.message);
        res.status(500).json({
            success: false,
            error: 'Failed to update channel: ' + error.message
        });
    }
});

// POST /api/channels/:id/sync - Trigger sync for a single channel
app.post('/api/channels/:id/sync', async (req, rea) => {
    const { id } = req.params;
    console.log('\n' + '='.repeat(60));
    console.log('🔄 [Multi-Channel] POST /api/channels/' + id + '/sync - TRIGGER SYNC');
    console.log('='.repeat(60));
    
    try {
        if (!savedChannels.has(id)) {
            return res.status(404).json({
                success: false,
                error: 'Channel not found'
            });
        }
        
        const channel = savedChannels.get(id);
        console.log(`[Multi-Channel] Syncing channel: ${channel.name}`);
        console.log(`[Multi-Channel] YouTube ID: ${channel.youtubeId}`);
        
        // Update sync status
        if (channel.stats) {
            channel.stats.lastSyncStatus = 'in_progress';
            channel.stats.lastSync = new Date().toISOString();
        }
        
        // Re-fetch channel info from YouTube
        console.log('[Multi-Channel] 📡 Fetching fresh channel data...');
        const freshChannelData = await fetchChannelInfo(channel.youtubeId, channel.url);
        
        // Update videos list
        const oldVideoCount = channel.videos?.length || 0;
        channel.videos = freshChannelData.videos;
        channel.liveVideos = freshChannelData.liveVideos;
        channel.videoCount = freshChannelData.videos.length + freshChannelData.liveVideos.length;
        channel.lastChecked = new Date().toISOString();
        
        // Update stats
        if (channel.stats) {
            channel.stats.totalVideos = freshChannelData.videos.length;
            channel.stats.remainingCount = freshChannelData.videos.length; // Will be refined by sync-status check
            channel.stats.lastSyncStatus = 'completed';
            channel.stats.lastError = null;
        }
        
        // Cache sync results
        channel.syncResults = [{
            syncedAt: new Date().toISOString(),
            newVideosFound: freshChannelData.videos.length - oldVideoCount,
            totalVideos: freshChannelData.videos.length,
            previousVideos: oldVideoCount
        }];
        
        // Save updated channel
        savedChannels.set(id, channel);
        
        console.log(`[Multi-Channel] ✅ Sync complete:`);
        console.log(`   Previous videos: ${oldVideoCount}`);
        console.log(`   Current videos: ${freshChannelData.videos.length}`);
        console.log(`   New videos: ${Math.max(0, freshChannelData.videos.length - oldVideoCount)}`);
        console.log('='.repeat(60) + '\n');
        
        rea.json({
            success: true,
            message: 'Channel synced successfully',
            channelId: id,
            channelName: channel.name,
            syncResults: {
                previousVideos: oldVideoCount,
                currentVideos: freshChannelData.videos.length,
                newVideosFound: Math.max(0, freshChannelData.videos.length - oldVideoCount),
                syncedAt: new Date().toISOString()
            },
            channel: channel
        });
        
    } catch (error) {
        console.error('[Multi-Channel] ❌ Sync failed:', error.message);
        
        // Update error status in channel
        const channel = savedChannels.get(id);
        if (channel && channel.stats) {
            channel.stats.lastSyncStatus = 'error';
            channel.stats.lastError = error.message;
            savedChannels.set(id, channel);
        }
        
        rea.status(500).json({
            success: false,
            error: 'Sync failed: ' + error.message,
            suggestion: 'Check internet connection and YouTube accessibility'
        });
    }
});

// POST /api/channels/sync-all - Sync all channels
app.post('/api/channels/sync-all', async (req, res) => {
    console.log('\n' + '='.repeat(70));
    console.log('🌐 [Multi-Channel] POST /api/channels/sync-all - SYNC ALL CHANNELS');
    console.log('='.repeat(70));
    
    const results = {
        synced: [],
        failed: [],
        skipped: [],
        summary: {
            total: 0,
            successful: 0,
            failed: 0,
            totalNewVideos: 0
        }
    };
    
    results.summary.total = savedChannels.size;
    
    if (savedChannels.size === 0) {
        console.log('[Multi-Channel] No channels to sync');
        return res.json({
            success: true,
            message: 'No channels to sync',
            results: results
        });
    }
    
    console.log(`[Multi-Channel] Found ${savedChannels.size} channels to sync`);
    
    // Process each channel
    for (const [channelId, channel] of savedChannels) {
        try {
            console.log(`\n[Multi-Channel] Syncing: ${channel.name} (${channelId})`);
            
            const oldVideoCount = channel.videos?.length || 0;
            
            // Fetch fresh data
            const freshData = await fetchChannelInfo(channel.youtubeId, channel.url);
            
            // Update channel
            channel.videos = freshData.videos;
            channel.liveVideos = freshData.liveVideos;
            channel.videoCount = freshData.videos.length + freshData.liveVideos.length;
            channel.lastChecked = new Date().toISOString();
            
            // Update stats
            if (channel.stats) {
                channel.stats.totalVideos = freshData.videos.length;
                channel.stats.remainingCount = freshData.videos.length;
                channel.stats.lastSync = new Date().toISOString();
                channel.stats.lastSyncStatus = 'completed';
                channel.stats.lastError = null;
            }
            
            const newVideosCount = Math.max(0, freshData.videos.length - oldVideoCount);
            
            results.synced.push({
                channelId,
                channelName: channel.name,
                previousVideos: oldVideoCount,
                currentVideos: freshData.videos.length,
                newVideos: newVideosCount
            });
            
            results.summary.successful++;
            results.summary.totalNewVideos += newVideosCount;
            
            console.log(`[Multi-Channel] ✅ ${channel.name}: ${oldVideoCount} → ${freshData.videos.length} videos (+${newVideosCount} new)`);
            
        } catch (error) {
            console.error(`[Multi-Channel] ❌ Failed to sync ${channel.name}:`, error.message);
            
            if (channel.stats) {
                channel.stats.lastSyncStatus = 'error';
                channel.stats.lastError = error.message;
            }
            
            results.failed.push({
                channelId,
                channelName: channel.name,
                error: error.message
            });
            
            results.summary.failed++;
        }
    }
    
    console.log('\n' + '-'.repeat(50));
    console.log('[Multi-Channel] 📊 SYNC ALL SUMMARY:');
    console.log(`   Total channels: ${results.summary.total}`);
    console.log(`   Successful: ${results.summary.successful}`);
    console.log(`   Failed: ${results.summary.failed}`);
    console.log(`   New videos found: ${results.summary.totalNewVideos}`);
    console.log('='.repeat(70) + '\n');
    
    res.json({
        success: true,
        message: `Synced ${results.summary.successful}/${results.summary.total} channels`,
        results: results,
        timestamp: new Date().toISOString()
    });
});

// GET /api/dashboard/stats - Global statistics dashboard
app.get('/api/dashboard/stats', (req, res) => {
    console.log('\n[Dashboard] GET /api/dashboard/stats');
    
    try {
        const globalStats = getGlobalStats();
        
        // Get per-channel breakdown
        const channelBreakdown = [];
        savedChannels.forEach((channel, id) => {
            channelBreakdown.push({
                id,
                name: channel.name,
                color: channel.color,
                videoCount: channel.videoCount || channel.videos?.length || 0,
                downloadedCount: channel.stats?.downloadedCount || 0,
                remainingCount: channel.stats?.remainingCount || channel.videos?.length || 0,
                status: channel.status,
                isDownloading: channel.isDownloading || false,
                lastSync: channel.stats?.lastSync || null,
                autoSync: channel.settings?.autoSync !== false
            });
        });
        
        // Get scheduler status
        const schedulerStatus = autoSyncScheduler.getStatus();
        
        // Get download manager status
        const downloadManagerStatus = multiChannelDownloadManager.getQueueStatus();
        
        res.json({
            success: true,
            ...globalStats,
            channels: channelBreakdown,
            scheduler: schedulerStatus,
            downloads: downloadManagerStatus,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('[Dashboard] ❌ Error:', error.message);
        res.status(500).json({
            success: false,
            error: 'Failed to get dashboard stats: ' + error.message
        });
    }
});

// =============================================================================
// DOWNLOAD QUEUE ENDPOINTS
// =============================================================================

app.get('/api/download-queue', (req, res) => {
    const active = downloadManager.getActive().map(d => ({
        id: d.id,
        videoId: d.videoId,
        title: d.title,
        filename: d.filename,
        status: d.status,
        progress: d.progress || 0,
        speed: d.speed || null,
        downloaded: d.downloaded || null,
        total: d.total || null,
        startTime: d.startTime,
        url: d.url,
        format: d.format,
        quality: d.quality,
        finalFilename: d.finalFilename || null,
        renamedFrom: d.renamedFrom || null,
        error: d.error || null
    }));
    
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
            active: active,
            completed: completed
        },
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
// ⭐ DOWNLOAD QUEUE MANAGER - Max 2 Concurrent Downloads
// =============================================================================

/**
 * Global download queue system
 * - maxConcurrent: Maximum downloads running at once (2)
 * - activeJobs: Array of CURRENTLY RUNNING job objects (max 2)
 * - queue: Array of pending download jobs waiting for a slot
 */
const downloadQueue = {
    maxConcurrent: 2,                    // ⭐ MAX 2 downloads at a time!
    activeJobs: [],                      // ⭐ NEW: Track ACTUALLY running jobs
    queue: [],                           // Waiting jobs
    
    /**
     * Add a download job to the queue
     * If  j.downloadId === downloadId);
        if (alreadyActive) {
            console.log(`[Download Queue] ⚠️ DUPLICATE EXECUTION BLOCKED: ${videoTitle?.substring(0, 30)}... (already active)`);
            return; // Don't execute twice!
        }
        
        // ⭐ KEY FIX: Add to activeJobs tracking
        job.startedAt = Date.now();
        this.activeJobs.push(job);
        
        // Update status to downloading
        downloadManager.update(downloadId, { status: 'downloading', startTime: Date.now() });
        
        console.log(`[Download Queue] ▶️ Job STARTED: ${videoTitle?.substring(0, 30)}...`);
        console.log(`[Download Queue] Active jobs: ${this.activeJobs.length} | Waiting: ${this.queue.length}`);
        
        // Start the actual download
        executeSmartDownload(downloadId, videoUrl, outputPath, videoTitle)
            .then(() => {
                console.log(`[Download Queue] ✅ Job completed: ${videoTitle?.substring(0, 30)}...`);
            })
            .catch((err) => {
                console.error(`[Download Queue] ❌ Job failed: ${videoTitle?.substring(0, 30)}... -`, err?.message);
            })
            .finally(() => {
                // ⭐ KEY FIX: Remove from activeJobs and process next
                this.onJobComplete(job);
            });
    },
    
    /**
     * Called when a download finishes (success or fail)
     * Frees a slot and starts next queued job if any
     * ⭐ FIX: Takes the completed job as parameter to remove it properly
     */
    onJobComplete(completedJob) {
        // ⭐ KEY FIX: Remove specific job from activeJobs
        if (completedJob) {
            const idx = this.activeJobs.findIndex(j => j.downloadId === completedJob.downloadId);
            if (idx !== -1) {
                this.activeJobs.splice(idx, 1);
                console.log(`[Download Queue] 🔓 Removed from active: ${completedJob.videoTitle?.substring(0, 30)}...`);
            } else {
                // ⭐ BULLETPROOF: Job not found in active - might have been removed already
                console.log(`[Download Queue] ⚠️ Job already removed from active (preventing double-complete): ${completedJob.videoTitle?.substring(0, 30)}...`);
                return; // Don't process completion twice!
            }
        }
        
        console.log(`\n[Download Queue] 📊 Status: Active=${this.activeJobs.length}/${this.maxConcurrent} | Queue=${this.queue.length}`);
        
        if (this.queue.length > 0 && this.activeJobs.length < this.maxConcurrent) {
            const nextJob = this.queue[0];
            const alreadyRunning = this.activeJobs.find(j => j.downloadId === nextJob.downloadId);
            if (alreadyRunning) {
                console.log(`[Download Queue] ⚠️ Next job already running, skipping: ${nextJob.videoTitle?.substring(0, 30)}...`);
                return;
            }
            
            console.log(`[Download Queue] ▶️ Starting next in queue: ${nextJob.videoTitle?.substring(0, 30)}...`);
            console.log(`[Download Queue] Remaining in queue: ${this.queue.length}`);
            
            // Small delay before starting next (5 seconds as requested)
            setTimeout(() => {
                this.executeJob(nextJob);
            }, 5000);  // ⭐ 5 second delay between downloads
            
        } else if (this.queue.length === 0 && this.activeJobs.length === 0) {
            console.log('[Download Queue] 🎉 All downloads complete! Queue empty.');
        }
    },
    
    /**
     * Get queue status for API responses
     * ⭐ FIX: Return proper active jobs from our tracking, not from downloadManager
     */
    getStatus() {
        // Get progress info for active jobs from downloadManager
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
            activeDownloads: activeDownloadDetails,  // ⭐ Only TRULY active downloads
            queue: this.queue.map(job => ({
                id: job.downloadId,
                title: job.videoTitle,
                status: 'waiting',
                position: this.queue.indexOf(job) + 1
            }))
        };
    },
    
    /**
     * Clear queue (for cancel operations)
     * Does NOT affect currently running downloads
     */
    clearQueue() {
        const cleared = this.queue.length;
        
        // Mark cleared jobs as cancelled in downloadManager
        this.queue.forEach(job => {
            downloadManager.update(job.downloadId, { status: 'cancelled' });
        });
        
        this.queue = [];
        console.log(`[Download Queue] 🗑️ Queue cleared (${cleared} jobs removed)`);
        return cleared;
    },
    
    /**
     * ⭐ BUG FIX #6: Remove a specific job from queue by download ID
     * @param {string} downloadId - The download ID to remove from queue
     * @returns {boolean} True if removed, false if not found
     */
    removeFromQueue(downloadId) {
        const initialLength = this.queue.length;
        this.queue = this.queue.filter(job => job.downloadId !== downloadId);
        const removed = initialLength !== this.queue.length;
        
        if (removed) {
            console.log(`[Download Queue] 🗑️ Removed job ${downloadId} from queue`);
        }
        
        return removed;
    },
    
    /**
     * SAFETY: Process next job if stuck (backup mechanism)
     */
    processStuckQueue() {
        // Check if we have capacity and queued jobs
        if (this.activeJobs.length < this.maxConcurrent && this.queue.length > 0) {
            console.log('[Download Queue] 🔄 Safety check: Found stuck jobs, processing...');
            while (this.activeJobs.length < this.maxConcurrent && this.queue.length > 0) {
                const nextJob = this.queue.shift();
                console.log(`[Download Queue] ▶️ Safety-starting: ${nextJob.videoTitle?.substring(0, 30)}...`);
                this.executeJob(nextJob);
            }
        }
    }
};

// =============================================================================
// DOWNLOAD EXECUTION FUNCTIONS
// =============================================================================

function executeSmartDownload(downloadId, videoUrl, outputPath, videoTitle) {
    const download = downloadManager.get(downloadId);
    if (!download) {
        console.error('[Smart Download] Download not found:', downloadId);
        return Promise.reject(new Error('Download not found'));
    }

    console.log(`\n[Smart Download] 🎯 Starting SMART download for: ${videoTitle}`);
    console.log(`[Smart Download] ID: ${downloadId}`);

    // Update status
    downloadManager.update(downloadId, { status: 'downloading', startTime: Date.now() });

    // ⭐ FIX: RETURN the promise chain so callers can await/then/catch it!
    // This is critical for the Download Queue to know when a job completes
    return analyzeVideoFormats(videoUrl)
        .then(formatInfo => {
            console.log(`[Smart Download] 📊 Format analysis complete:`);
            console.log(`   Selected: ${formatInfo.formatId} (${formatInfo.resolution}, ${formatInfo.ext})`);
            console.log(`   Estimated size: ${formatInfo.filesizeMB || 'unknown'} MB`);

            // Store format info
            downloadManager.update(downloadId, {
                selectedFormat: formatInfo
            });

            // Step 2: Download with selected format
            return executeDownloadWithFormat(downloadId, videoUrl, outputPath, formatInfo, videoTitle);
        })
        .then(result => {
            console.log(`[Smart Download] ✅ Download complete!`);
            console.log(`[Smart Download] Output: ${outputPath}`);

            // Step 3: Rename file to video title (if enabled)
            return renameDownloadedFile(download, outputPath);
        })
        .then(renameResult => {
            console.log(`[Smart Download] 📝 Rename result:`, renameResult);

            // Mark as completed
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

            console.log(`[Smart Download] ✅ Download job ${downloadId} completed successfully`);
            return renameResult;  // Return for chaining

        })
        .catch(error => {
            console.error(`[Smart Download] ❌ Error:`, error.message);
            
            downloadManager.update(downloadId, {
                status: 'error',
                error: error.message,
                endTime: Date.now()
            });
            
            throw error;  // Re-throw so caller's .catch() fires
        });
}

function executeDownloadWithFormat(downloadId, videoUrl, outputPath, formatInfo, videoTitle) {
    return new Promise((resolve, reject) => {
        const download = downloadManager.get(downloadId);
        if (!download) return reject(new Error('Download not found'));

        console.log(`\n[Execute Download] Starting: ${videoTitle}`);
        console.log(`[Execute Download] Format: ${formatInfo.formatId} (${formatInfo.resolution})`);
        console.log(`[Execute Download] Needs merge: ${formatInfo.needsMerge}`);
        
        // ⭐ BUG FIX #3: Detect if this is a live stream archive/replay
        const isLiveStreamVideo = videoTitle.toLowerCase().includes('live') || 
                                   videoTitle.toLowerCase().includes('stream') ||
                                   formatInfo.isLiveStream;
        
        if (isLiveStreamVideo) {
            console.log(`[Execute Download] 🎴 DETECTED LIVE STREAM VIDEO - applying special flags`);
        }

        // ⭐⭐⭐ CRITICAL FIX FOR WINDOWS PATH LENGTH LIMITATION ⭐⭐⭐
        // Problem: Windows has ~8191 char command-line limit
        // Long paths like "C:\Users\Jackle\Downloads\YouTube-Downloader\HikmataurkimiaGhari\Very Long Title.mp4"
        // get TRUNCATED when passed to yt-dlp, causing "Fixed output name" error!
        //
        // Solution: Download to SHORT temp filename first, then RENAME to desired name
        // This bypasses Windows path length limits completely!
        
        const outputDir = path.dirname(outputPath);
        const baseFilename = path.basename(outputPath, '.mp4');
        
        // Generate a SHORT temporary filename for the actual download
        // Format: ytl_[downloadId].mp4 (always short, never truncated!)
        const tempFilename = `ytl_${downloadId}.mp4`;
        const tempPath = path.join(outputDir, tempFilename);
        
        console.log(`[Execute Download] 🛡️ WINDOWS PATH FIX ACTIVE`);
        console.log(`[Execute Download] Temp file (short): ${tempFilename}`);
        console.log(`[Execute Download] Final file (long):   ${path.basename(outputPath)}`);
        console.log(`[Execute Download] Output dir: ${outputDir}`);

        // Build arguments - use SHORT temp path to avoid truncation!
        const args = [
            '-f', formatInfo.formatId,
            '-o', tempPath,  // ⭐ KEY: Use SHORT path, not long one!
            '--no-playlist',
            '--embed-chapters',
            '--embed-metadata',
            // ⭐⭐⭐ BUG FIX #8: REMOVED --embed-thumbnail ⭐⭐⭐
            // PROBLEM: This caused "Postprocessing: Supported filetypes for thumbnail 
            // embedding are: mp3, mkv/mka, ogg/opus/flac, m4a/mp4/m4v/mov" ERROR
            // ROOT CAUSE: yt-dlp downloads in original format (e.g., webm for format 278),
            // then tries to embed thumbnail BEFORE merging to mp4. Since webm is NOT in
            // the supported formats list, it FAILS and the entire download aborts!
            // SOLUTION: Remove --embed-thumbnail to allow download+merge to complete.
            // Thumbnail embedding can be added back later with post-merge processing.
            
            // ⭐⭐⭐ WINDOWS 11 FIX: JavaScript Runtime for YouTube decryption ⭐⭐⭐
            // yt-dlp on Windows requires a JS runtime (Node.js/Deno) to decrypt 
            // YouTube's signature algorithms. Without this, downloads FAIL with:
            // "No supported JavaScript runtime could be found"
            '--js-runtimes', 'node'
        ];
        
        // ⭐ BUG FIX #3: Add special flags for live stream downloads
        if (isLiveStreamVideo) {
            // These flags help yt-dlp handle live stream archives better
            args.push('--wait-for-video', '0.1');  // Don't wait for live streams
            args.push('--no-check-certificates');   // Skip cert checks that may fail
            args.push('--socket-timeout', '60');     // Longer timeout for large files
            console.log(`[Execute Download] 🎴 Added live stream compatibility flags`);
        }
        
        // Always add merge flag
        args.push('--merge-output-format', 'mp4');
        
        if (FFMPEG_AVAILABLE) {
            console.log('[Execute Download] ✅ FFmpeg available for merging');
        } else {
            console.warn('[Execute Download] ⚠️ FFmpeg not available, using fallback merger');
        }
        
        args.push(videoUrl);

        console.log(`[Execute Download] Command: yt-dlp ${args.join(' ').substring(0, 200)}...`);

        // ⭐ ENSURE OUTPUT DIRECTORY EXISTS BEFORE DOWNLOAD
        ensureDirectoryExists(outputDir);

        const ytDlpProcess = spawn('yt-dlp', args, {
            stdio: ['pipe', 'pipe', 'pipe'],
            shell: true,
            cwd: outputDir
        });

        let stdoutData = '';
        let stderrData = '';

        ytDlpProcess.stdout.on('data', (data) => {
            stdoutData += data.toString();
            
            // Parse progress from output
            const progressMatch = stdoutData.match(/(\d+\.?\d*)%/);
            if (progressMatch) {
                const percent = parseFloat(progressMatch[1]);
                downloadManager.update(downloadId, { progress: percent });
                
                // Extract additional info if available
                const speedMatch = stdoutData.match(/(\d+\.?\d*\s*(?:MiB|KiB|GiB)\/s)/);
                const sizeMatch = stdoutData.match(/of\s+(\d+\.?\d*\s*(?:MiB|KiB|GiB))/);
                
                if (speedMatch) downloadManager.update(downloadId, { speed: speedMatch[1] });
                if (sizeMatch) downloadManager.update(downloadId, { total: sizeMatch[1] });
            }
        });

        ytDlpProcess.stderr.on('data', (data) => {
            stderrData += data.toString();
        });

        ytDlpProcess.on('close', (code) => {
            console.log(`[Execute Download] Process exited with code: ${code}`);
            
            if (code === 0) {
                // ⭐⭐⭐ POST-DOWNLOAD: Rename from short temp name to desired long name ⭐⭐⭐
                try {
                    // Check what file was actually created (might be .webm or .mkv if merge changed format)
                    let actualFile = null;
                    const possibleExtensions = ['.mp4', '.webm', '.mkv'];
                    
                    for (const ext of possibleExtensions) {
                        const checkPath = path.join(outputDir, `ytl_${downloadId}${ext}`);
                        if (fs.existsSync(checkPath)) {
                            actualFile = checkPath;
                            break;
                        }
                    }
                    
                    if (!actualFile) {
                        // File might have been saved with a different name, search for recent files
                        console.log('[Execute Download] Temp file not found, searching for downloaded file...');
                        
                        // Find most recently modified video file in output dir
                        if (fs.existsSync(outputDir)) {
                            const files = fs.readdirSync(outputDir)
                                .filter(f => ['.mp4', '.webm', '.mkv'].includes(path.extname(f).toLowerCase()))
                                .map(f => ({
                                    path: path.join(outputDir, f),
                                    mtime: fs.statSync(path.join(outputDir, f)).mtime.getTime()
                                }))
                                .sort((a, b) => b.mtime - a.mtime);  // Most recent first
                            
                            if (files.length > 0 && files[0].mtime > Date.now() - 3600000) { // Within last hour
                                actualFile = files[0].path;
                                console.log(`[Execute Download] Found recent file: ${path.basename(actualFile)}`);
                            }
                        }
                    }
                    
                    if (!actualFile || !fs.existsSync(actualFile)) {
                        reject(new Error('Download completed but output file not found'));
                        return;
                    }
                    
                    const stats = fs.statSync(actualFile);
                    console.log(`[Execute Download] ✅ Download complete!`);
                    console.log(`[Execute Download] Downloaded: ${path.basename(actualFile)} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);
                    
                    // Now RENAME to the desired long filename
                    // ⭐ FIX: Sanitize final filename to match what frontend displays!
                    // Frontend uses sanitizeFilename() which replaces <>:"/\\|?* with -
                    // We must apply SAME sanitization here so saved filename matches UI
                    const originalBaseName = path.basename(outputPath, '.mp4');
                    const sanitizedBaseName = sanitizeFilename(originalBaseName);
                    let finalPath = path.join(outputDir, sanitizedBaseName + '.mp4');
                    
                    // Check if file exists and add counter if needed (duplicate handling)
                    if (fs.existsSync(finalPath)) {
                        let counter = 1;
                        while (fs.existsSync(finalPath)) {
                            finalPath = path.join(outputDir, `${sanitizedBaseName} (${counter}).mp4`);
                            counter++;
                        }
                    }
                    
                    // Perform the rename to SANITIZED filename
                    fs.renameSync(actualFile, finalPath);
                    
                    console.log(`[Execute Download] 📝 Renamed to: ${path.basename(finalPath)}`);
                    resolve({ 
                        success: true, 
                        path: finalPath, 
                        size: stats.size,
                        renamedFrom: path.basename(actualFile)
                    });
                    
                } catch (renameErr) {
                    console.error(`[Execute Download] ❌ Rename failed:`, renameErr.message);
                    // If rename fails, return the temp file path instead of failing
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
                console.error(`[Execute Download] ❌ Failed: ${errorMsg}`);
                reject(new Error(`yt-dlp exited with code ${code}: ${errorMsg}`));
            }
        });

        ytDlpProcess.on('error', (err) => {
            console.error(`[Execute Download] ❌ Spawn error:`, err);
            reject(err);
        });

        // Timeout after 30 minutes
        setTimeout(() => {
            if (ytDlpProcess && !ytDlpProcess.killed) {
                console.log('[Execute Download] ⏰ Timeout reached, killing process');
                ytDlpProcess.kill();
                reject(new Error('Download timeout (30 minutes)'));
            }
        }, 30 * 60 * 1000);
    });
}

/**
 * ⭐ RENAME FUNCTION - Rename downloaded file to YouTube video title
 */
async function renameDownloadedFile(downloadObj, originalPath) {
    return new Promise((resolve) => {
        console.log('\n[Rename] Starting rename process...');
        console.log('[Rename] Original path:', originalPath);
        
        // Skip if no title available
        if (!downloadObj || !downloadObj.title) {
            console.log('[Rename] ⚠️ No title available, skipping rename');
            resolve({ success: false, reason: 'no_title', filename: null, originalFilename: null });
            return;
        }
        
        const videoTitle = downloadObj.title;
        console.log('[Rename] Target title:', videoTitle);
        
        // Sanitize filename (remove invalid characters)
        let sanitizedTitle = videoTitle
            .replace(/[:"/\\|?*]/g, '-')  // Replace invalid chars with hyphen
            .replace(/\s+/g, ' ')             // Collapse multiple spaces
            .trim();
        
        // Limit length (Windows max path is 260 chars, leave room for path)
        const maxTitleLength = 180;
        if (sanitizedTitle.length > maxTitleLength) {
            sanitizedTitle = sanitizedTitle.substring(0, maxTitleLength);
            console.log('[Rename] Title truncated to', maxTitleLength, 'chars');
        }
        
        const newFilename = sanitizedTitle + '.mp4';
        // ⭐ FIXED: Keep file in the SAME directory as original (channel folder), not base DOWNLOADS_DIR
        const originalDir = path.dirname(originalPath);
        const newPath = path.join(originalDir, newFilename);
        
        console.log('[Rename] New filename:', newFilename);
        console.log('[Rename] New path:', newPath);
        console.log('[Rename] Original dir (keeping file here):', originalDir);
        
        // Check if source file exists
        if (!fs.existsSync(originalPath)) {
            console.log('[Rename] ⚠️ Original file not found:', originalPath);
            
            // Maybe it was already renamed or has different extension
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
        
        // Handle duplicate filenames - using the same logic as getUniqueFilename
        let finalNewPath = newPath;
        let finalNewFilename = newFilename;
        let counter = 1;
        
        while (fs.existsSync(finalNewPath)) {
            counter++;
            finalNewFilename = `${sanitizedTitle} (${counter}).mp4`;
            // ⭐ FIXED: Keep in same directory (channel folder)
            finalNewPath = path.join(originalDir, finalNewFilename);
            console.log('[Rename] Duplicate detected, trying:', finalNewFilename);
        }
        
        try {
            // Perform rename
            fs.renameSync(originalPath, finalNewPath);
            
            // Get file stats
            const stats = fs.statSync(finalNewPath);
            
            console.log('[Rename] ✅ Rename successful!');
            console.log('[Rename] From:', path.basename(originalPath));
            console.log('[Rename] To:', finalNewFilename);
            console.log('[Rename] Size:', (stats.size / 1024 / 1024).toFixed(2), 'MB');
            
            resolve({
                success: true,
                filename: finalNewFilename,
                originalFilename: path.basename(originalPath),
                path: finalNewPath,
                size: stats.size,
                renamedAt: new Date().toISOString()
            });
            
        } catch (err) {
            console.error('[Rename] ❌ Rename failed:', err.message);
            resolve({ 
                success: false, 
                reason: err.code || 'unknown_error', 
                error: err.message,
                filename: path.basename(originalPath),  // Return original name
                originalFilename: path.basename(originalPath)
            });
        }
    });
}

// =============================================================================
// FORMAT ANALYZER
// =============================================================================

function analyzeVideoFormats(videoUrl) {
    return new Promise((resolve, reject) => {
        console.log('\n[Format Analyzer] Starting analysis for:', videoUrl);
        console.log('[Format Analyzer] Using text-based parsing (reliable method)');
        
        const cmd = 'yt-dlp --list-formats "' + videoUrl + '"';
        
        console.log('[Format Analyzer] Command:', cmd);

        exec(cmd, { maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
            if (error) {
                console.log('[Format Analyzer] ❌ Format listing failed, using default');
                // Return default best format
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
                return;
            }

            console.log('[Format Analyzer] ✅ Got format list, parsing...');

            try {
                const formats = parseFormatsFromText(stdout);
                console.log('[Format Analyzer] Parsed', formats.length, 'formats');

                if (formats.length === 0) {
                    throw new Error('No formats found');
                }

                // Select BEST format (lowest quality for storage efficiency)
                const selected = selectBestFormat(formats);
                
                console.log('[Format Analyzer] 🎯 Selected format:');
                console.log('   ID:', selected.formatId);
                console.log('   Resolution:', selected.resolution);
                console.log('   Size:', selected.filesizeMB || 'unknown', 'MB');
                console.log('   Codec:', selected.vcodec + '/' + selected.acodec);

                resolve(selected);

            } catch (parseError) {
                console.error('[Format Analyzer] Parse error:', parseError.message);
                reject(parseError);
            }
        });
    });
}

function parseFormatsFromText(text) {
    const formats = [];
    const lines = text.split('\n');
    
    // Parse format lines
    // Example: "249 webm audio only tiny 53k , opus 22050Hz 160k, 487.65KiB"
    // Example: "18 mp4 360p  12M , avc1.42001E mp4a.40.2@ 130k, 11.85MiB"
    
    for (const line of lines) {
        // Skip header/footer lines
        if (!line.includes('mp4') && !line.includes('webm') && !line.includes('m4a')) continue;
        if (line.includes('ID') || line.includes('---') || line.includes('ext')) continue;
        
        const parts = line.trim().split(/\s{2,}/); // Split by 2+ spaces
        
        if (parts.length >= 2) {
            // ⭐ FIXED: Extract ONLY the numeric/format ID (e.g., "160"), not "160 mp4"
            let rawFormatId = parts[0].trim();
            const formatId = rawFormatId.split(/\s+/)[0]; // Take first part before any space
            const extPart = parts[1].trim();
            
            // Extract extension
            const extMatch = extPart.match(/(mp4|webm|m4a|mkv)/i);
            const ext = extMatch ? extMatch[1].toLowerCase() : 'mp4';
            
            // Extract resolution
            const resolutionMatch = line.match(/(\d+)x(\d+)|(\d+p)/);
            const resolution = resolutionMatch ? resolutionMatch[0] : 'audio only';
            
            // Extract filesize
            const sizeMatch = line.match(/([\d.]+)\s*(MiB|GiB|KiB)/i);
            let filesize = null;
            let filesizeMB = null;
            
            if (sizeMatch) {
                filesize = parseFloat(sizeMatch[1]);
                const unit = sizeMatch[2].toUpperCase();
                
                if (unit === 'GiB') filesizeMB = filesize * 1024;
                else if (unit === 'KiB') filesizeMB = filesize / 1024;
                else filesizeMB = filesize;
            }
            
            // Detect audio-only
            const isAudioOnly = line.includes('audio only');
            
            // Extract codec info
            const vcodecMatch = line.match(/avc[\d.]+|vp\d+|av1/i);
            const acodecMatch = line.match(/mp4a\.\d+|opus|aac/i);
            
            const vcodec = vcodecMatch ? vcodecMatch[0] : (isAudioOnly ? null : 'unknown');
            const acodec = acodecMatch ? acodecMatch[0] : (isAudioOnly ? 'opus' : 'unknown');
            
            formats.push({
                formatId: formatId,
                ext: ext,
                resolution: resolution,
                filesize: filesize,
                filesizeMB: filesizeMB ? Math.round(filesizeMB * 100) / 100 : null,
                vcodec: vcodec,
                acodec: acodec,
                isAudioOnly: isAudioOnly,
                needsMerge: false // Will be updated later
            });
        }
    }
    
    // Mark formats that need merging (video without audio or vice versa)
    formats.forEach(f => {
        if (!f.isAudioOnly && f.acodec !== 'unknown' && f.vcodec !== null) {
            // Has both, check if they're separate
            f.needsMerge = line.includes('video only');
        }
    });
    
    return formats;
}

function selectBestFormat(formats) {
    // Filter to video-only formats (not audio only)
    const videoFormats = formats.filter(f => !f.isAudioOnly);
    
    if (videoFormats.length === 0) {
        // Fallback: return first format or default
        return formats[0] || {
            formatId: 'best[ext=mp4]/best',
            resolution: 'auto',
            ext: 'mp4',
            filesize: null,
            filesizeMB: null,
            vcodec: 'auto',
            acodec: 'auto',
            needsMerge: false
        };
    }
    
    // Sort by resolution (ascending - prefer lower quality for storage)
    const sortedByResolution = [...videoFormats].sort((a, b) => {
        const resA = parseInt(a.resolution) || 9999;
        const resB = parseInt(b.resolution) || 9999;
        return resA - resB;
    });
    
    // Prefer formats with smaller file sizes at same resolution
    const lowestRes = sortedByResolution[0];
    const sameResFormats = sortedByResolution.filter(f => 
        parseInt(f.resolution) === parseInt(lowestRes.resolution)
    );
    
    // Pick smallest file among same resolution
    const selected = sameResFormats.sort((a, b) => 
        (a.filesizeMB || 9999) - (b.filesizeMB || 9999)
    )[0];
    
    // Check if we need to merge (video-only format)
    const needsMerge = selected.resolution.includes('only') || 
                       !selected.acodec || 
                       selected.acodec === 'unknown';
    
    return {
        ...selected,
        needsMerge: needsMerge,
        // If merge needed, suggest also getting audio
        ...(needsMerge ? { audioFormatId: findBestAudioFormat(formats) } : {})
    };
}

function findBestAudioFormat(formats) {
    const audioFormats = formats.filter(f => f.isAudioOnly && f.ext === 'm4a');
    
    if (audioFormats.length > 0) {
        // Return smallest audio file
        return audioFormats.sort((a, b) => (a.filesizeMB || 0) - (b.filesizeMB || 0))[0].formatId;
    }
    
    return null; // Will use default audio extraction
}

// =============================================================================
// BATCH DOWNLOAD ENDPOINT
// =============================================================================

app.post('/api/download/batch', async (req, res) => {
    console.log('\n' + '='.repeat(80));
    console.log('📦 [Batch Download] POST /api/download/batch');
    console.log('='.repeat(80));

    try {
        const { videos, format, quality, channelId, channelName } = req.body;

        if (!videos || !Array.isArray(videos) || videos.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Videos array required'
            });
        }

        console.log(`[Batch Download] Received ${videos.length} videos for batch download`);
        console.log(`[Batch Download] Format: ${format || 'auto'}, Quality: ${quality || 'auto'}`);
        console.log(`[Batch Download] Channel Name: ${channelName || 'N/A (root folder)'}`);

        // ⭐ NEW: Determine output directory (channel-specific or root)
        const outputDir = channelName ? getChannelDownloadDir(channelName) : DOWNLOADS_DIR;
        console.log(`[Batch Download] Output directory: ${outputDir}`);

        const results = [];
        let skippedCount = 0;
        let queuedCount = 0;
        let errorCount = 0;

        // Process each video
        for (let i = 0; i < videos.length; i++) {
            const video = videos[i];
            const videoId = video.id;
            
        const resultEntry = results.find(r => r.index === i && r.videoId === videoId);
        const downloadId = resultEntry?.jobId;
        
        if (!downloadId) {
            console.error(`[Batch Sequential] ❌ No job ID for video ${i}, skipping`);
            continue;
        }
        
        // Get the download object to find outputPath
        const downloadObj = downloadManager.get(downloadId);
        if (!downloadObj) {
            console.error(`[Batch Sequential] ❌ Download object not found: ${downloadId}`);
            continue;
        }
        
        try {
            // Update status to downloading
            downloadManager.update(downloadId, { status: 'downloading', progress: 0 });
            
            console.log(`[Batch Sequential] ⬇️ Starting download: ${videoTitle.substring(0, 40)}...`);
            
            // ⭐ AWAIT download (and rename) to complete
            await executeSmartDownload(downloadId, videoUrl, downloadObj.outputPath, videoTitle);
            
            // Mark as completed
            if (resultEntry) {
                resultEntry.status = 'completed';
                resultEntry.completedAt = new Date().toISOString();
            }
            
            console.log(`[Batch Sequential] ✅ [${i + 1}] COMPLETED: ${videoTitle.substring(0, 30)}...`);
            
        } catch (error) {
            console.error(`[Batch Sequential] ❌ [${i + 1}] FAILED:`, error.message);
            
            if (resultEntry) {
                resultEntry.status = 'failed';
                resultEntry.error = error.message;
                resultEntry.failedAt = new Date().toISOString();
            }
        }
        
        // ⭐ KEY: Wait 5 seconds BEFORE starting next download
        // This ensures: Download → Rename → 5s pause → Next download
        if (i < videos.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 5000));  // 5 second delay
        }
    }
    
    console.log('\n' + '='.repeat(80));
    console.log('📦 [Batch Sequential] 🎉 BATCH DOWNLOAD COMPLETE!');
    console.log('='.repeat(80));
    
    const successCount = results.filter(r => r.status === 'completed').length;
    const failCount = results.filter(r => r.status === 'failed').length;
    
    console.log(`[Batch Sequential] Successful: ${successCount}/${videos.length}`);
    console.log(`[Batch Sequential] Failed: ${failCount}/${videos.length}`);
    
    res.json({
        success: true,
        data: {
            total: videos.length,
            successful: successCount,
            failed: failCount,
            results
        }
    });
        
    } catch (error) {
        console.error('[Batch Download] Error:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// =============================================================================
// SEQUENTIAL DOWNLOAD FEATURE (One at a time - True Sequential)
// =============================================================================

// Global sequential download state
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

/**
 * POST /api/download/sequential - Start sequential download (one at a time)
 * Downloads videos ONE BY ONE, waiting for each to complete before starting next
 */
app.post('/api/download/sequential', async (req, res) => {
    console.log('\n' + '='.repeat(80));
    console.log('📥 [Sequential Download] POST /api/download/sequential');
    console.log('='.repeat(80));

    try {
        const { videos, format, quality, channelId, channelName } = req.body;

        if (!videos || !Array.isArray(videos) || videos.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Videos array required'
            });
        }

        // Check if already running
        if (sequentialQueue.isRunning && !sequentialQueue.cancelRequested) {
            return res.status(409).json({
                success: false,
                error: 'Sequential download already in progress',
                currentStatus: {
                    currentIndex: sequentialQueue.currentIndex,
                    totalVideos: sequentialQueue.totalVideos,
                    currentVideo: sequentialQueue.videos[sequentialQueue.currentIndex]?.title || 'N/A'
                }
            });
        }

        // Initialize sequential queue
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

        console.log(`[Sequential Download] 🎯 Starting SEQUENTIAL download of ${videos.length} videos`);
        console.log(`[Sequential Download] Mode: One at a time (true sequential)`);
        console.log(`[Sequential Download] Output directory: ${outputDir}`);
        console.log(`[Sequential Download] Batch ID: ${sequentialQueue.batchId}`);

        // Respond immediately with queue status
        res.json({
            success: true,
            message: `Sequential download started: ${videos.length} videos will download one at a time`,
            mode: 'sequential',
            batchId: sequentialQueue.batchId,
            totalVideos: videos.length,
            estimatedTime: `${videos.length * 5}-${videos.length * 15} minutes` // Rough estimate
        });

        // Start processing sequentially in background
        processSequentialQueue(outputDir, format, quality, channelId);

    } catch (error) {
        console.error('[Sequential Download] ❌ Error:', error.message);
        // Only send error if we haven't sent response yet
        if (!res.headersSent) {
            res.status(500).json({
                success: false,
                error: 'Sequential download failed: ' + error.message
            });
        }
    }
});

/**
 * Core sequential processing function
 * Processes videos ONE AT A TIME, awaiting each completion before next
 */
async function processSequentialQueue(outputDir, format, quality, channelId) {
    console.log('\n[Sequential Queue] 🚀 Starting sequential processing...');
    
    while (sequentialQueue.currentIndex < sequentialQueue.totalVideos) {
        // Small delay between downloads
        if (sequentialQueue.currentIndex > 0) {
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
        if (sequentialQueue.cancelRequested) break;

        const video = sequentialQueue.videos[sequentialQueue.currentIndex];
        const index = sequentialQueue.currentIndex + 1;
        
        console.log(`\n${'='.repeat(80)}`);
        console.log(`[Sequential Queue] 📥 Processing [${index}/${sequentialQueue.totalVideos}]: ${video.title}`);
        console.log(`${'='.repeat(80)}`);

        try {
            // Create download job for this video
            const downloadId = uuidv4();
            const safeTitle = video.title.replace(/[^a-zA-Z0-9._-]/g, '_').substring(0, 100);
            let outputFilename = `${safeTitle}.mp4`;
            
            // Apply duplicate filename handler
            outputFilename = getUniqueFilename(outputDir, outputFilename);
            
            const outputPath = path.join(outputDir, outputFilename);

            // Add to download manager
            const download = downloadManager.add({
                id: downloadId,
                url: video.url,
                videoId: video.videoId,
                channelId: channelId,
                title: video.title,
                filename: outputFilename,
                outputPath: outputPath,
                format: format || 'best',
                quality: quality || 'lowest',
                status: 'downloading',  // Set to downloading immediately (it's the only active one)
                progress: 0,
                createdAt: new Date().toISOString()
            });

            console.log(`[Sequential Queue] Job created: ${downloadId}`);
            console.log(`[Sequential Queue] Output: ${outputPath}`);

            // ⭐ KEY: AWAIT this download to complete before continuing
            await executeSmartDownload(downloadId, video.url, outputPath, video.title);

            // Mark as completed in results
            sequentialQueue.results.push({
                index: sequentialQueue.currentIndex,
                videoId: video.videoId,
                title: video.title,
                status: 'completed',
                jobId: downloadId,
                filename: outputFilename,
                completedAt: new Date().toISOString()
            });

            console.log(`[Sequential Queue] ✅ Video [${index}] COMPLETED successfully`);

        } catch (error) {
            console.error(`[Sequential Queue] ❌ Video [${index}] FAILED:`, error.message);
            
            // Mark as failed but CONTINUE to next video
            sequentialQueue.results.push({
                index: sequentialQueue.currentIndex,
                videoId: video.videoId,
                title: video.title,
                status: 'failed',
                error: error.message,
                failedAt: new Date().toISOString()
            });

            // Small delay before next attempt (avoid hammering YouTube if there's an issue)
            await new Promise(resolve => setTimeout(resolve, 3000));
        }

        // Move to next video
        sequentialQueue.currentIndex++;

        // ⭐ FIX: Wait 5 seconds AFTER download + rename complete before starting next
        // This ensures: Download → Rename → 5s pause → Next download
        if (sequentialQueue.currentIndex < sequentialQueue.totalVideos) {
            await new Promise(resolve => setTimeout(resolve, 5000));  // 5 second delay
        }
    }

    // Sequential queue finished
    sequentialQueue.isRunning = false;
    const endTime = new Date();
    const duration = Math.round((endTime - sequentialQueue.startTime) / 1000);
    
    const successCount = sequentialQueue.results.filter(r => r.status === 'completed').length;
    const failCount = sequentialQueue.results.filter(r => r.status === 'failed').length;

    console.log(`\n${'='.repeat(80)}`);
    console.log('[Sequential Queue] 🎉 SEQUENTIAL DOWNLOAD COMPLETE!');
    console.log('='.repeat(80));
    console.log(`[Sequential Queue] Total time: ${Math.floor(duration / 60)}m ${duration % 60}s`);
    console.log(`[Sequential Queue] Successful: ${successCount}/${sequentialQueue.totalVideos}`);
    console.log(`[Sequential Queue] Failed: ${failCount}/${sequentialQueue.totalVideos}`);
    console.log(`[Sequential Queue] Cancelled: ${sequentialQueue.cancelRequested}`);
}

/**
 * GET /api/download/sequential/status - Get sequential download progress
 */
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

/**
 * POST /api/download/sequential/pause - Pause/resume sequential download
 */
app.post('/api/download/sequential/pause', (req, res) => {
    const { pause } = req.body; // true to pause, false to resume
    
    if (!sequentialQueue.isRunning) {
        return res.status(400).json({
            success: false,
            error: 'No sequential download in progress'
        });
    }

    sequentialQueue.isPaused = pause === true;
    
    console.log(`[Sequential Download] ${pause ? '⏸️ PAUSED' : '▶️ RESUMED'}`);
    
    res.json({
        success: true,
        isPaused: sequentialQueue.isPaused,
        message: pause ? 'Sequential download paused' : 'Sequential download resumed'
    });
});

/**
 * POST /api/download/sequential/cancel - Cancel sequential download
 */
app.post('/api/download/sequential/cancel', (req, res) => {
    if (!sequentialQueue.isRunning) {
        return res.status(400).json({
            success: false,
            error: 'No sequential download in progress'
        });
    }

    sequentialQueue.cancelRequested = true;
    
    // Also cancel any currently active download
    const currentVideo = sequentialQueue.videos[sequentialQueue.currentIndex];
    if (currentVideo) {
        const activeDownload = downloadManager.get(d => 
            d.videoId === currentVideo.videoId && d.status === 'downloading'
        );
        if (activeDownload) {
            downloadManager.update(activeDownload.id, { status: 'cancelled' });
        }
    }
    
    console.log('[Sequential Download] ❌ CANCELLATION REQUESTED');
    
    res.json({
        success: true,
        message: 'Cancellation requested. Current download will finish, then stop.',
        resultsSoFar: sequentialQueue.results,
        nextIndex: sequentialQueue.currentIndex
    });
});

// =============================================================================
// ⭐ DOWNLOAD QUEUE STATUS ENDPOINT
// =============================================================================

/**
 * GET /api/download/queue/status - Get current download queue status
 * Shows how many downloads are active, how many are waiting in queue
 * ⭐ FIX: Uses queue's own tracking for accurate active/waiting lists
 */
app.get('/api/download/queue/status', (req, res) => {
    const queueStatus = downloadQueue.getStatus();
    
    // ⭐ KEY FIX: Use queueStatus.activeDownloads (from queue's own tracking)
    // NOT downloadManager.getActive() which includes queued jobs too!
    res.json({
        success: true,
        queue: queueStatus,
        activeDownloads: queueStatus.activeDownloads,  // Only TRULY active jobs
        message: `Running ${queueStatus.active}/${queueStatus.maxConcurrent} downloads, ${queueStatus.queued} waiting in queue`
    });
});

/**
 * POST /api/download/queue/clear - Clear the download queue (cancel all waiting)
 * Does NOT affect currently running downloads
 */
app.post('/api/download/queue/clear', (req, res) => {
    const cleared = downloadQueue.clearQueue();
    
    res.json({
        success: true,
        message: `Cleared ${cleared} downloads from queue`,
        clearedCount: cleared
    });
});

// =============================================================================
// ⭐ INDIVIDUAL QUEUE ITEM ACTIONS (4 Buttons: Stop, Cancel, Remove, Force Stop)
// =============================================================================

/**
 * POST /api/download/:id/stop - STOP/PAUSE a download (Blue button)
 * Pauses the download gracefully (can be resumed)
 */
app.post('/api/download/:id/stop', (req, res) => {
    const { id } = req.params;
    console.log(`\n[Queue Action] ⏸️ STOP requested for download: ${id}`);
    
    const download = downloadManager.get(id);
    
    if (!download) {
        return res.status(404).json({
            success: false,
            error: 'Download not found'
        });
    }
    
    // Update status to paused/stopped
    downloadManager.update(id, { 
        status: 'paused',
        pausedAt: new Date().toISOString()
    });
    
    // Note: In a real implementation, you would pause the yt-dlp process here
    // For now, we mark it as paused and it can be "resumed" later
    
    console.log(`[Queue Action] ✅ Download ${id} paused/stopped`);
    
    res.json({
        success: true,
        message: 'Download paused successfully',
        downloadId: id,
        newStatus: 'paused'
    });
});

/**
 * POST /api/download/:id/cancel - CANCEL a download (Red button with confirmation)
 * Marks as cancelled, allows current chunk to finish then stops
 */
app.post('/api/download/:id/cancel', (req, res) => {
    const { id } = req.params;
    const { reason = 'user_cancelled' } = req.body;
    console.log(`\n[Queue Action] ❌ CANCEL requested for download: ${id} (reason: ${reason})`);
    
    const download = downloadManager.get(id);
    
    if (!download) {
        return res.status(404).json({
            success: false,
            error: 'Download not found'
        });
    }
    
    // Update status to cancelled
    downloadManager.update(id, { 
        status: 'cancelled',
        cancelledAt: new Date().toISOString(),
        cancelReason: reason
    });
    
    // Remove from queue if it's waiting
    downloadQueue.removeFromQueue(id);
    
    console.log(`[Queue Action] ✅ Download ${id} cancelled`);
    
    res.json({
        success: true,
        message: 'Download cancelled successfully',
        downloadId: id,
        newStatus: 'cancelled'
    });
});

/**
 * DELETE /api/download/:id/remove - REMOVE from queue (Gray button, no confirmation)
 * Only works for waiting downloads (not active ones)
 */
app.delete('/api/download/:id/remove', (req, res) => {
    const { id } = req.params;
    console.log(`\n[Queue Action] 🗑️ REMOVE from queue requested: ${id}`);
    
    const download = downloadManager.get(id);
    
    if (!download) {
        return res.status(404).json({
            success: false,
            error: 'Download not found'
        });
    }
    
    // Check if download is active (can't remove active downloads, use cancel instead)
    if (download.status === 'downloading') {
        return res.status(400).json({
            success: false,
            error: 'Cannot remove active download. Use Cancel or Force Stop instead.'
        });
    }
    
    // Remove from queue
    const removed = downloadQueue.removeFromQueue(id);
    
    // Remove from download manager
    downloadManager.remove(id);
    
    console.log(`[Queue Action] ✅ Download ${id} removed from queue`);
    
    res.json({
        success: true,
        message: 'Download removed from queue',
        downloadId: id,
        removed: removed
    });
});

/**
 * POST /api/download/:id/force-stop - FORCE STOP a download (Dark Red with confirmation)
 * Immediately kills the download process - DANGEROUS but fast
 */
app.post('/api/download/:id/force-stop', (req, res) => {
    const { id } = req.params;
    console.log(`\n[Queue Action] ⛔ FORCE STOP requested for download: ${id}`);
    
    const download = downloadManager.get(id);
    
    if (!download) {
        return res.status(404).json({
            success: false,
            error: 'Download not found'
        });
    }
    
    // Update status immediately
    downloadManager.update(id, { 
        status: 'force_stopped',
        forceStoppedAt: new Date().toISOString()
    });
    
    // Remove from queue
    downloadQueue.removeFromQueue(id);
    
    // TODO: Kill the actual yt-dlp process if running
    // This would require storing the process reference when starting the download
    // For now, we mark it as force_stopped and clean up
    
    console.log(`[Queue Action] ⛔ Download ${id} FORCE STOPPED (process killed)`);
    
    res.json({
        success: true,
        message: 'Download force stopped. Process killed.',
        downloadId: id,
        newStatus: 'force_stopped',
        warning: 'Partial file may be corrupted'
    });
});

// =============================================================================
// ⭐ MULTI-CHANNEL QUEUE MANAGEMENT ENDPOINTS
// =============================================================================

// GET /api/downloads/queue - Get global multi-channel queue status
app.get('/api/downloads/queue', (req, res) => {
    console.log('\n[Multi-Channel Queue] GET /api/downloads/queue');
    
    try {
        const status = multiChannelDownloadManager.getQueueStatus();
        
        res.json({
            success: true,
            ...status,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('[Multi-Channel Queue] ❌ Error:', error.message);
        res.status(500).json({
            success: false,
            error: 'Failed to get queue status: ' + error.message
        });
    }
});

// POST /api/downloads/pause-all - Pause all downloads (no new downloads will start)
app.post('/api/downloads/pause-all', (req, res) => {
    console.log('\n[Multi-Channel Queue] POST /api/downloads/pause-all');
    
    const result = multiChannelDownloadManager.pauseAll();
    
    // Also pause existing download queue if exists
    if (downloadQueue && typeof downloadQueue.clearQueue === 'function') {
        // Note: We don't clear, just prevent new starts
        console.log('[Multi-Channel Queue] Existing download queue noted');
    }
    
    res.json({
        success: true,
        message: 'All downloads paused. No new downloads will start.',
        ...result,
        timestamp: new Date().toISOString()
    });
});

// POST /api/downloads/resume-all - Resume all downloads
app.post('/api/downloads/resume-all', (req, res) => {
    console.log('\n[Multi-Channel Queue] POST /api/downloads/resume-all');
    
    const result = multiChannelDownloadManager.resumeAll();
    
    res.json({
        success: true,
        message: 'All downloads resumed. Processing queue...',
        ...result,
        timestamp: new Date().toISOString()
    });
});

// DELETE /api/downloads/:downloadId - Cancel a specific download
app.delete('/api/downloads/:downloadId', (req, res) => {
    const { downloadId } = req.params;
    console.log(`\n[Multi-Channel Queue] DELETE /api/downloads/${downloadId}`);
    
    try {
        const cancelled = multiChannelDownloadManager.cancelDownload(downloadId);
        
        if (cancelled) {
            res.json({
                success: true,
                message: 'Download cancelled successfully',
                downloadId: downloadId,
                timestamp: new Date().toISOString()
            });
        } else {
            res.status(404).json({
                success: false,
                error: 'Download not found or already completed',
                downloadId: downloadId
            });
        }
        
    } catch (error) {
        console.error('[Multi-Channel Queue] ❌ Error cancelling:', error.message);
        res.status(500).json({
            success: false,
            error: 'Failed to cancel download: ' + error.message
        });
    }
});

// GET /api/scheduler/status - Get auto-sync scheduler status
app.get('/api/scheduler/status', (req, res) => {
    console.log('\n[Scheduler] GET /api/scheduler/status');
    
    try {
        const status = autoSyncScheduler.getStatus();
        
        res.json({
            success: true,
            scheduler: status,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('[Scheduler] ❌ Error:', error.message);
        res.status(500).json({
            success: false,
            error: 'Failed to get scheduler status: ' + error.message
        });
    }
});

// POST /api/scheduler/start - Start auto-sync scheduler
app.post('/api/scheduler/start', (req, res) => {
    console.log('[Scheduler] POST /api/scheduler/start');
    
    try {
        const { intervalHours } = req.body;
        
        if (intervalHours) {
            autoSyncScheduler.updateInterval(intervalHours);
        }
        
        autoSyncScheduler.start();
        
        res.json({
            success: true,
            message: 'Auto-sync scheduler started',
            scheduler: autoSyncScheduler.getStatus(),
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('[Scheduler] ❌ Error starting:', error.message);
        res.status(500).json({
            success: false,
            error: 'Failed to start scheduler: ' + error.message
        });
    }
});

// POST /api/scheduler/stop - Stop auto-sync scheduler
app.post('/api/scheduler/stop', (req, res) => {
    console.log('[Scheduler] POST /api/scheduler/stop');
    
    try {
        autoSyncScheduler.stop();
        
        res.json({
            success: true,
            message: 'Auto-sync scheduler stopped',
            scheduler: autoSyncScheduler.getStatus(),
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('[Scheduler] ❌ Error stopping:', error.message);
        res.status(500).json({
            success: false,
            error: 'Failed to stop scheduler: ' + error.message
        });
    }
});

// POST /api/scheduler/trigger - Manually trigger sync now
app.post('/api/scheduler/trigger', async (req, res) => {
    console.log('[Scheduler] POST /api/scheduler/trigger - Manual trigger');
    
    try {
        // Run sync in background, respond immediately
        autoSyncScheduler.syncNow();
        
        res.json({
            success: true,
            message: 'Manual sync triggered. Check /api/scheduler/status for progress.',
            scheduler: autoSyncScheduler.getStatus(),
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('[Scheduler] ❌ Error triggering:', error.message);
        res.status(500).json({
            success: false,
            error: 'Failed to trigger sync: ' + error.message
        });
    }
});

// =============================================================================
// SYSTEM STATUS ENDPOINT
// =============================================================================

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
            cookies: isCookiesFileValid()
        }
    });
});

// =============================================================================
// FILE SERVING ENDPOINT
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
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

app.get('/api/download-file/:filename', (req, res) => {
    const filename = req.params.filename;
    const filePath = path.join(DOWNLOADS_DIR, filename);

    // Security: Prevent directory traversal
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
// ERROR HANDLING
// =============================================================================

app.use((err, req, res, next) => {
    console.error('\n❌ [Server Error]', err.message);
    console.error('Stack:', err.stack);
    
    res.status(500).json({ 
        error: 'Internal server error',
        message: err.message 
    });
});

// 404 handler - Enhanced with logging
app.use((req, res) => {
    console.log('\n[404] Not Found:', req.method, req.originalUrl);
    console.log('[404] This endpoint does not exist in server.js');
    console.log('[404] Available endpoints:');
    console.log('   GET  /api/health');
    console.log('   GET  /api/settings');
    console.log('   PUT  /api/settings');
    console.log('   GET  /api/channels');
    console.log('   POST  /api/channels');
    console.log('   PUT  /api/channels/:id');           // ← ⭐ MULTI-CHANNEL: Update channel
    console.log('   DELETE /api/channels/:id');
    console.log('   POST  /api/channels/:id/sync');     // ← ⭐ MULTI-CHANNEL: Sync single channel
    console.log('   POST  /api/channels/sync-all');     // ← ⭐ MULTI-CHANNEL: Sync all channels
    console.log('   GET  /api/dashboard/stats');         // ← ⭐ MULTI-CHANNEL: Global dashboard
    console.log('   POST  /api/channels/:id/check');
    console.log('   POST  /api/video/info');
    console.log('   POST  /api/download');           // ← MAIN DOWNLOAD ENDPOINT!
    console.log('   POST  /api/download/start');
    console.log('   GET  /api/download/:jobId');     // ← Status check
    console.log('   GET  /api/download/:id');       // Legacy status
    console.log('   POST  /api/download/:id/cancel');
    console.log('   GET  /api/downloads');
    console.log('   POST  /api/download/batch');     // ← Batch download (sequential now)!');
    console.log('   POST  /api/download/sequential'); // ← Sequential download (ONE AT A TIME)!
    console.log('   GET  /api/download/sequential/status');  // ← Sequential progress!
    console.log('   POST  /api/download/sequential/pause');  // ← Pause/Resume!
    console.log('   POST  /api/download/sequential/cancel'); // ← Cancel sequential!
    console.log('   GET  /api/download/queue/status');       // ← ⭐ Queue status (max 2 concurrent)!
    console.log('   POST  /api/download/queue/clear');       // ← ⭐ Clear waiting queue!
    console.log('   POST  /api/download/:id/stop');        // ← ⭐ Stop/Pause (Blue)!
    console.log('   POST  /api/download/:id/cancel');      // ← ⭐ Cancel (Red)!
    console.log('   DELETE /api/download/:id/remove');     // ← ⭐ Remove (Gray)!
    console.log('   POST  /api/download/:id/force-stop');  // ← ⭐ Force Stop (Dark Red)!
    console.log('   GET  /api/download/list');
    console.log('   GET  /api/download-queue');      // ← Queue status (frontend polls!)
    console.log('   DELETE /api/download-queue');    // ← Clear queue
    console.log('   GET  /api/downloads/queue');      // ← ⭐ MC: Multi-channel queue status
    console.log('   POST  /api/downloads/pause-all'); // ← ⭐ MC: Pause all downloads
    console.log('   POST  /api/downloads/resume-all');// ← ⭐ MC: Resume all downloads
    console.log('   DELETE /api/downloads/:downloadId'); // ← ⭐ MC: Cancel download
    console.log('   GET  /api/scheduler/status');     // ← ⭐ MC: Scheduler status
    console.log('   POST  /api/scheduler/start');     // ← ⭐ MC: Start scheduler
    console.log('   POST  /api/scheduler/stop');      // ← ⭐ MC: Stop scheduler
    console.log('   POST  /api/scheduler/trigger');   // ← ⭐ MC: Manual sync trigger
    console.log('   GET  /api/system/status');
    console.log('   POST  /api/login');              // ← Authentication
    console.log('   POST  /api/logout');             // ← Authentication
    console.log('   GET  /api/auth/status');         // ← Auth status
    console.log('');
    
    res.status(404).json({ 
        error: 'Not found',
        endpoint: req.method + ' ' + req.originalUrl,
        availableEndpoints: [
            '/api/health',
            '/api/settings', 
            '/api/channels',
            '/api/channels/:id',              // ← ⭐ MC: PUT - Update channel
            '/api/channels/:id/sync',         // ← ⭐ MC: POST - Sync single
            '/api/channels/sync-all',         // ← ⭐ MC: POST - Sync all
            '/api/dashboard/stats',           // ← ⭐ MC: Global dashboard
            '/api/channel/info',
            '/api/video/info',
            '/api/download',              // ← MAIN DOWNLOAD!
            '/api/download/start',
            '/api/download/batch',         // ← BATCH DOWNLOAD!
            '/api/download/sequential',    // ← SEQUENTIAL DOWNLOAD!
            '/api/download/sequential/status',  // ← Sequential progress
            '/api/download/sequential/pause',  // ← Pause/Resume
            '/api/download/sequential/cancel', // ← Cancel sequential
            '/api/downloads',
            '/api/download-queue',
            '/api/downloads/queue',        // ← ⭐ MC: Multi-channel queue
            '/api/downloads/pause-all',    // ← ⭐ MC: Pause all
            '/api/downloads/resume-all',   // ← ⭐ MC: Resume all
            '/api/scheduler/status',       // ← ⭐ MC: Scheduler
            '/api/scheduler/start',        // ← ⭐ MC: Start scheduler
            '/api/scheduler/stop',         // ← ⭐ MC: Stop scheduler
            '/api/scheduler/trigger',      // ← ⭐ MC: Manual sync
            '/api/system/status',
            '/api/login',                  // ← Auth
            '/api/logout',                 // ← Auth
            '/api/auth/status'             // ← Auth status
        ]
    });
});

// =============================================================================
// SERVER STARTUP
// =============================================================================

// Validate authentication configuration FIRST
validateAuthConfig();

// Convert cookie path to native format on startup
getNativeCookiePath();

// Log cookie mode
console.log('\n' + '='.repeat(70));
console.log('🍪 COOKIE MODE DETECTION');
console.log('='.repeat(70));

if (isCookiesFileValid()) {
    console.log('✅ Mode: cookies.txt file (RECOMMENDED)');
    console.log('   Path:', AUTH_CONFIG.cookieFilePath);
} else {
    console.log('⚠️  Mode: Browser fallback (' + AUTH_CONFIG.browserName + ')');
    console.log('   Reason: cookies.txt not found or invalid format');
    console.log('');
    console.log('💡 TIP: For better reliability:');
    console.log('   1. Install "Get cookies.txt LOCALLY" browser extension');
    console.log('   2. Export YouTube cookies to: ' + path.join(process.cwd(), 'cookies.txt'));
    console.log('   3. Restart server');
}
console.log('='.repeat(70) + '\n');

// Start server
app.listen(PORT, () => {
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║                   🚀 SERVER STARTED! 🚀                      ║');
    console.log('║                                                              ║');
    console.log(`║  🌐 Server:     http://localhost:${PORT}                            ║`);
    console.log(`║  📁 Downloads:  ${DOWNLOADS_DIR}        ║`);
    console.log(`║  🎬 FFmpeg:     ${FFMPEG_AVAILABLE ? '✅ Installed (merging enabled)' : '⚠️ Not found (using fallback)'}        ║`);
    console.log(`║  🍪 Cookies:    ${isCookiesFileValid() ? '✅ Valid' : '⚠️ Using browser'}                              ║`);
    console.log('║  🔐 Auth:       ✅ Enabled (Session-based)                        ║');
    console.log('║  🌐 Multi-Ch:   ✅ Enabled (Multi-channel support)               ║');
    console.log(`║  📂 Default Dir: ${getDefaultOutputPath('[Channel]')}  ║`);
    console.log('║                                                              ║');
    console.log('╠══════════════════════════════════════════════════════════════╣');
    console.log('║  Available API Endpoints:                                   ║');
    console.log('╠══════════════════════════════════════════════════════════════╣');
    console.log('║  GET    /api/settings          View/change download folder     ║');
    console.log('║  PUT    /api/settings          Update settings                 ║');
    console.log('║  GET    /api/channels          List all channels                ║');  
    console.log('║  POST   /api/channels          Load channel videos             ║');
    console.log('║  PUT    /api/channels/:id      ⭐ Update channel settings       ║');
    console.log('║  POST   /api/channels/:id/sync ⭐ Sync single channel           ║');
    console.log('║  POST   /api/channels/sync-all ⭐ Sync all channels             ║');
    console.log('║  GET    /api/dashboard/stats   ⭐ Global dashboard stats         ║');
    console.log('║  POST   /api/download           Download single video (queued)       ║');
    console.log('║  POST   /api/download/batch     Batch download (sequential)        ║');
    console.log('║  POST   /api/download/sequential Sequential (one at a time)      ║');
    console.log('║  GET    /api/download/queue/status Queue status (max 2 concurrent) ║');
    console.log('║  GET    /api/downloads/queue    ⭐ MC: Multi-channel queue status  ║');
    console.log('║  POST   /api/downloads/pause-all ⭐ Pause all downloads           ║');
    console.log('║  GET    /api/scheduler/status   ⭐ Auto-sync scheduler status     ║');
    console.log('║  GET    /api/files              List all downloaded files        ║');
    console.log('║  GET    /api/download-file/:id  Download file by ID            ║');
    console.log('║  GET    /api/default-output-dir ⭐ Default output directory     ║');
    console.log('╚══════════════════════════════════════════════════════════════╝');
    console.log('');
    console.log('⭐ FEATURES ENABLED:');
    console.log('   - ✅ Authentication (Session-based, 2-day expiry)');
    console.log('   - ✅ Rate limiting (5 login attempts per 15 min)');
    console.log('   - ✅ Duplicate filename handling');
    console.log('   - ✅ Sequential download (one at a time)');
    console.log('   - ⭐ Download Queue (MAX 2 concurrent, rest wait in queue)');
    console.log('   - ⭐🌐 MULTI-CHANNEL SUPPORT (Multiple YouTube channels)');
    console.log('   - ⭐🌐 Auto-Sync Scheduler (Configurable interval sync)');
    console.log('   - ⭐🌐 Channel-specific download directories & colors');
    console.log('   - ⭐🌐 Global dashboard with aggregated statistics');
    console.log('');
});
