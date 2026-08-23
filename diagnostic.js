#!/usr/bin/env node
/**
 * ============================================================================
 * YTL DIAGNOSTIC TOOL
 * ============================================================================
 * 
 * Run this script to diagnose common issues with the YouTube downloader:
 * 
 *   node diagnostic.js
 * 
 * It will check:
 * 1. Node.js version
 * 2. npm dependencies
 * 3. yt-dlp installation and version
 * 4. FFmpeg availability
 * 5. Network connectivity to YouTube
 * 6. File system permissions
 * 7. Port availability
 * 8. Common configuration issues
 * 
 * ============================================================================
 */

const { execSync, exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Colors for terminal output
const colors = {
    reset: '\x1b[0m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m',
    white: '\x1b[37m'
};

function log(type, message, details = null) {
    const icons = {
        info: `${colors.blue}ℹ${colors.reset}`,
        success: `${colors.green}✅${colors.reset}`,
        warn: `${colors.yellow}⚠️${colors.reset}`,
        error: `${colors.red}❌${colors.reset}`,
        header: `${colors.cyan}🔍${colors.reset}`
    };
    
    console.log(`${icons[type] || ''} ${message}`);
    if (details) {
        console.log(`   ${colors.dim || ''}${details}${colors.reset}`);
    }
}

function runCommand(cmd, options = {}) {
    try {
        const result = execSync(cmd, {
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'pipe'],
            timeout: options.timeout || 10000,
            ...options
        });
        return { success: true, output: result.trim() };
    } catch (error) {
        return { 
            success: false, 
            output: error.stdout?.trim() || '',
            error: error.stderr?.trim() || error.message,
            code: error.status
        };
    }
}

console.log('\n');
console.log('╔══════════════════════════════════════════════════════════════╗');
console.log('║          YTL - YouTube Downloader Diagnostic Tool           ║');
console.log('║              Version 1.0.0 | ' + new Date().toISOString().split('T')[0] + '               ║');
console.log('╚══════════════════════════════════════════════════════════════╝');
console.log('\n');

let allPassed = true;
const issues = [];

// =========================================================================
// 1. NODE.JS CHECK
// =========================================================================

log('header', 'Checking Node.js Environment...');
const nodeVersion = process.version;
const nodeMajor = parseInt(nodeVersion.slice(1).split('.')[0]);

if (nodeMajor >= 16) {
    log('success', `Node.js version: ${nodeVersion} (✓ Requires 16+)`);
} else {
    log('error', `Node.js version: ${nodeVersion} (✗ Requires 16+)`);
    issues.push('Update Node.js to v16 or higher');
    allPassed = false;
}

// Check npm
const npmCheck = runCommand('npm --version');
if (npmCheck.success) {
    log('success', `npm version: ${npmCheck.output}`);
} else {
    log('warn', 'Could not determine npm version');
}

// =========================================================================
// 2. PROJECT STRUCTURE CHECK
// =========================================================================

console.log('');
log('header', 'Checking Project Structure...');

const requiredFiles = [
    'server/server.js',
    'server/package.json',
    'public/index.html'
];

requiredFiles.forEach(file => {
    if (fs.existsSync(file)) {
        log('success', `Found: ${file}`);
    } else {
        log('error', `Missing: ${file}`);
        issues.push(`Required file missing: ${file}`);
        allPassed = false;
    }
});

// Check node_modules
if (fs.existsSync('server/node_modules')) {
    log('success', 'node_modules exists (dependencies installed)');
} else {
    log('warn', 'node_modules not found - run: cd server && npm install');
    issues.push('Dependencies not installed');
}

// =========================================================================
// 3. YT-DLP CHECK
// =========================================================================

console.log('');
log('header', 'Checking yt-dlp Installation...');

const ytdlpCheck = runCommand('yt-dlp --version');
if (ytdlpCheck.success) {
    log('success', `yt-dlp installed: v${ytdlpCheck.output}`);
    
    // Check if it's outdated (basic check)
    log('info', 'Tip: Update yt-dlp with: pip install --upgrade yt-dlp');
} else {
    log('error', 'yt-dlp NOT FOUND or not working!');
    log('info', 'Installation methods:');
    log('info', '  • pip install yt-dlp');
    log('info', '  • brew install yt-dlp (macOS)');
    log('info', '  • sudo apt install yt-dlp (Ubuntu/Debian)');
    issues.push('yt-dlp is required for downloading');
    allPassed = false;
}

// Test yt-dlp with a simple command
console.log('');
log('header', 'Testing yt-dlp Functionality...');

const ytdlpTest = runCommand('yt-dlp --list-extractors | head -5', { timeout: 15000 });
if (ytdlpTest.success) {
    log('success', 'yt-dlp can list extractors');
    const extractors = ytdlpTest.output.split('\n').slice(0, 3);
    extractors.forEach(e => log('info', `  Extractor: ${e}`));
} else {
    log('warn', 'Could not test yt-dlp extractors');
}

// =========================================================================
// 4. FFMPEG CHECK
// =========================================================================

console.log('');
log('header', 'Checking FFmpeg (for video merging)...');

const ffmpegCheck = runCommand('ffmpeg -version | head -1');
if (ffmpegCheck.success) {
    const versionMatch = ffmpegCheck.output.match(/version (\S+)/i);
    log('success', `FFmpeg installed: ${versionMatch ? versionMatch[1] : 'unknown'}`);
} else {
    log('warn', 'FFmpeg not found - video merging may fail');
    log('info', 'Install FFmpeg:');
    log('info', '  • sudo apt install ffmpeg (Linux)');
    log('info', '  • brew install ffmpeg (macOS)');
    log('info', '  • choco install ffmpeg (Windows)');
    // Not a critical failure - some downloads work without it
}

// =========================================================================
// 5. NETWORK CONNECTIVITY CHECK
// =========================================================================

console.log('');
log('header', 'Checking Network Connectivity...');

// Test YouTube accessibility
const youtubeTest = runCommand('curl -s -o /dev/null -w "%{http_code}" --max-time 10 https://www.youtube.com', { timeout: 15000 });
if (youtubeTest.success && youtubeTest.output === '200') {
    log('success', 'YouTube accessible (HTTP 200)');
} else if (youtubeTest.success) {
    log('warn', `YouTube returned HTTP ${youtubeTest.output} (may be region-restricted)`);
    issues.push('YouTube may be blocked in your region - consider VPN');
} else {
    log('error', 'Cannot reach YouTube!');
    log('info', 'Check your internet connection and firewall settings');
    issues.push('Network connectivity issue to YouTube');
    allPassed = false;
}

// Test Google API
const googleTest = runCommand('curl -s -o /dev/null -w "%{http_code}" --max-time 10 https://www.googleapis.com', { timeout: 15000 });
if (googleTest.success && googleTest.output === '200') {
    log('success', 'Google APIs accessible');
} else {
    log('warn', 'Google APIs may be inaccessible');
}

// =========================================================================
// 6. FILE SYSTEM CHECK
// =========================================================================

console.log('');
log('header', 'Checking File System Permissions...');

// Check downloads directory
const downloadDirs = [
    path.join(os.homedir(), 'Downloads', 'YouTube-Downloader'),
    path.join(process.cwd(), 'downloads'),
    '/tmp/ytl-downloads'
];

let validDownloadDir = null;

downloadDirs.forEach(dir => {
    try {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
            log('success', `Created download directory: ${dir}`);
        }
        
        // Test write permission
        const testFile = path.join(dir, '.write-test-' + Date.now());
        fs.writeFileSync(testFile, 'test');
        fs.unlinkSync(testFile);
        
        log('success', `Write permissions OK: ${dir}`);
        validDownloadDir = dir;
    } catch (error) {
        log('warn', `Cannot write to: ${dir} (${error.code})`);
    }
});

if (!validDownloadDir) {
    log('error', 'No writable download directory found!');
    issues.push('File system permissions issue');
    allPassed = false;
}

// Check disk space
try {
    const stats = fs.statSync(validDownloadDir || process.cwd());
    // Note: This doesn't give disk space, just file stats
    log('info', `Working directory: ${process.cwd()}`);
} catch (e) {}

// =========================================================================
// 7. PORT CHECK
// =========================================================================

console.log('');
log('header', 'Checking Server Port...');

const PORT = process.env.PORT || 3000;
const portCheck = runCommand(`lsof -i :${PORT} -t 2>/dev/null || netstat -an | grep :${PORT} | grep LISTEN`);

if (portCheck.output && portCheck.output.trim()) {
    log('warn', `Port ${PORT} is already in use!`);
    log('info', `Process using port: ${portCheck.output.trim()}`);
    log('info', `Use different port: PORT=3001 node server.js`);
    issues.push(`Port ${PORT} already in use`);
} else {
    log('success', `Port ${PORT} is available`);
}

// =========================================================================
// 8. CONFIGURATION CHECK
// =========================================================================

console.log('');
log('header', 'Checking Configuration...');

// Check package.json
try {
    const pkg = JSON.parse(fs.readFileSync('server/package.json', 'utf8'));
    log('success', 'package.json is valid JSON');
    log('info', `Project: ${pkg.name || 'unknown'} v${pkg.version || 'unknown'}`);
    
    // Check key dependencies
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    const keyDeps = ['express', 'cors', 'uuid', 'node-cron'];
    
    keyDeps.forEach(dep => {
        if (deps[dep]) {
            log('success', `Dependency: ${deps[dep]}`);
        } else {
            log('warn', `Missing dependency: ${dep}`);
        }
    });
} catch (e) {
    log('error', 'Invalid or missing package.json');
    issues.push('Configuration error');
}

// Check for .env file
if (fs.existsSync('.env')) {
    log('success', '.env file found');
    // Don't print contents - may contain secrets
} else {
    log('info', 'No .env file (using defaults)');
}

// =========================================================================
// 9. COMMON ISSUES CHECK
// =========================================================================

console.log('');
log('header', 'Checking for Common Issues...');

// Check if running as root (not recommended)
if (process.getuid && process.getuid() === 0) {
    log('warn', 'Running as root - this may cause permission issues');
    issues.push('Avoid running as root');
}

// Check memory
const totalMem = Math.round(os.totalmem() / (1024 * 1024 * 1024));
const freeMem = Math.round(os.freemem() / (1024 * 1024 * 1024));
log('info', `Memory: ${freeMem}GB free / ${totalMem}GB total`);

// Check platform
log('info', `Platform: ${os.platform()} ${os.release()}`);
log('info', `Architecture: ${os.arch()}`);

// Check Node.js memory limits
log('info', `Node.js heap limit: ${--heap_size_limit / (1024 * 1024)}MB`);

// =========================================================================
// SUMMARY
// =========================================================================

console.log('\n');
console.log('╔══════════════════════════════════════════════════════════════╗');
console.log('║                      DIAGNOSTIC SUMMARY                     ║');
console.log('╚══════════════════════════════════════════════════════════════╝');
console.log('');

if (allPassed) {
    log('success', 'All critical checks passed! ✓');
    console.log('');
    console.log('You can now start the server:');
    console.log('  cd server && node server.js');
    console.log('');
    console.log('Then open: http://localhost:' + PORT);
} else {
    log('error', 'Some checks failed. Please fix the issues above.');
    console.log('');
    console.log('Issues found:');
    issues.forEach((issue, i) => {
        console.log(`  ${i + 1}. ${issue}`);
    });
}

console.log('');
console.log('─────────────────────────────────────────────────────────────');
console.log('TROUBLESHOOTING TIPS:');
console.log('─────────────────────────────────────────────────────────────');
console.log('');
console.log('📥 Download not starting?');
console.log('   1. Open browser DevTools (F12) → Console tab');
console.log('   2. Look for red error messages');
console.log('   3. Check the Debug Console panel (bottom-right)');
console.log('   4. Visit /api/logs in browser for server logs');
console.log('');
console.log('🔒 Authentication/Cookie errors?');
console.log('   1. Some videos require login/cookies');
console.log('   2. Export cookies from browser to cookies.txt');
console.log('   3. Or use --cookies-from-browser flag');
console.log('');
console.log('🌐 Network errors?');
console.log('   1. Check if YouTube is accessible in your country');
console.log('   2. Try using a VPN');
console.log('   3. Check firewall/proxy settings');
console.log('');
console.log('📁 File system errors?');
console.log('   1. Ensure download folder has write permissions');
console.log('   2. Check available disk space');
console.log('   3. Try running with sudo (not recommended long-term)');
console.log('');

process.exit(allPassed ? 0 : 1);
