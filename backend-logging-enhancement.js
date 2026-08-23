/**
 * ============================================================================
 * BACKEND LOGGING ENHANCEMENT FOR multi-channel-ytl
 * ============================================================================
 * 
 * This script adds comprehensive logging to help debug download issues.
 * It provides:
 * 1. Request/Response logging for all API endpoints
 * 2. Detailed download process logging with yt-dlp output
 * 3. Error stack traces and diagnostics
 * 4. A /api/logs endpoint to view logs from browser
 * 5. Performance timing for all operations
 * 
 * USAGE: Add this to your server.js or require() it
 * ============================================================================
 */

// =============================================================================
// ENHANCED LOGGER CLASS
// =============================================================================

class EnhancedLogger {
    constructor(options = {}) {
        this.maxLogs = options.maxLogs || 1000;
        this.logs = [];
        this.enableConsole = options.enableConsole !== false; // Default true
        this.logLevel = options.logLevel || 'debug'; // debug, info, warn, error
        this.levels = { debug: 0, info: 1, warn: 2, error: 3 };
        
        // Statistics tracking
        this.stats = {
            totalRequests: 0,
            totalErrors: 0,
            totalDownloads: 0,
            failedDownloads: 0,
            startTime: new Date()
        };
    }

    /**
     * Main log method - stores and optionally prints to console
     */
    log(level, category, message, data = null) {
        // Check if we should log at this level
        if (this.levels[level] < this.levels[this.logLevel]) {
            return;
        }

        const timestamp = new Date().toISOString();
        const logEntry = {
            id: this.logs.length + 1,
            timestamp,
            level,
            category,
            message,
            data: data ? this.sanitizeData(data) : null,
            stack: level === 'error' ? new Error().stack?.split('\n').slice(2, 6).join('\n') : undefined
        };

        // Add to buffer
        this.logs.push(logEntry);
        
        // Trim if needed
        if (this.logs.length > this.maxLogs) {
            this.logs.shift();
        }

        // Console output with colors
        if (this.enableConsole) {
            const colors = {
                debug: '\x1b[36m',   // cyan
                info: '\x1b[32m',    // green
                warn: '\x1b[33m',    // yellow
                error: '\x1b[31m',   // red
                reset: '\x1b[0m'
            };
            
            let consoleMsg = `${colors[level] || ''}[${timestamp}] [${level.toUpperCase()}] [${category}] ${message}${colors.reset || ''}`;
            
            if (data && this.logLevel === 'debug') {
                consoleMsg += ` ${JSON.stringify(data, null, 2).substring(0, 500)}`;
            }
            
            switch(level) {
                case 'error': console.error(consoleMsg); break;
                case 'warn': console.warn(consoleMsg); break;
                default: console.log(consoleMsg); break;
            }
        }

        return logEntry;
    }

    // Convenience methods
    debug(category, message, data) { return this.log('debug', category, message, data); }
    info(category, message, data) { return this.log('info', category, message, data); }
    warn(category, message, data) { return this.log('warn', category, message, data); }
    error(category, message, data) { 
        this.stats.totalErrors++;
        return this.log('error', category, message, data); 
    }

    /**
     * Sanitize sensitive data before logging
     */
    sanitizeData(data) {
        if (typeof data !== 'object') return data;
        
        const sanitized = { ...data };
        const sensitiveKeys = ['password', 'token', 'cookie', 'secret', 'authorization'];
        
        for (const key of Object.keys(sanitized)) {
            if (sensitiveKeys.some(sk => key.toLowerCase().includes(sk))) {
                sanitized[key] = '[REDACTED]';
            }
        }
        
        return sanitized;
    }

    /**
     * Get logs with filtering options
     */
    getLogs(options = {}) {
        let filteredLogs = [...this.logs];

        // Filter by level
        if (options.level) {
            filteredLogs = filteredLogs.filter(l => l.level === options.level);
        }

        // Filter by category
        if (options.category) {
            filteredLogs = filteredLogs.filter(l => l.category === options.category);
        }

        // Filter by time range
        if (options.since) {
            const sinceDate = new Date(options.since);
            filteredLogs = filteredLogs.filter(l => new Date(l.timestamp) >= sinceDate);
        }

        // Limit results
        if (options.limit) {
            filteredLogs = filteredLogs.slice(-options.limit);
        }

        return {
            logs: filteredLogs,
            total: filteredLogs.length,
            stats: this.getStats(),
            filters: options
        };
    }

    /**
     * Get current statistics
     */
    getStats() {
        return {
            ...this.stats,
            uptime: Date.now() - this.stats.startTime.getTime(),
            logCount: this.logs.length,
            errorsByCategory: this._countBy('category', 'error'),
            recentErrors: this.logs.filter(l => l.level === 'error').slice(-10)
        };
    }

    /**
     * Count logs by field value
     */
    _countBy(field, level) {
        const counts = {};
        this.logs
            .filter(l => l.level === level)
            .forEach(l => {
                const val = l[field] || 'unknown';
                counts[val] = (counts[val] || 0) + 1;
            });
        return counts;
    }

    /**
     * Clear all logs
     */
    clear() {
        this.logs = [];
        this.stats = {
            totalRequests: 0,
            totalErrors: 0,
            totalDownloads: 0,
            failedDownloads: 0,
            startTime: new Date()
        };
        this.info('Logger', 'Logs cleared');
    }

    /**
     * Export logs as text for downloading
     */
    exportAsText(options = {}) {
        const { logs } = this.getLogs(options);
        return logs.map(l => 
            `[${l.timestamp}] [${l.level.toUpperCase()}] [${l.category}] ${l.message}` +
            (l.data ? `\n  Data: ${JSON.stringify(l.data, null, 2)}` : '') +
            (l.stack ? `\n  Stack: ${l.stack}` : '')
        ).join('\n');
    }
}

// Create global logger instance
const logger = new EnhancedLogger({ maxLogs: 1000, logLevel: 'debug' });

// =============================================================================
// EXPRESS REQUEST LOGGING MIDDLEWARE
// =============================================================================

/**
 * Middleware to log all HTTP requests with details
 */
function createRequestLogger(loggerInstance) {
    return (req, res, next) => {
        const startTime = Date.now();
        const requestId = Math.random().toString(36).substring(7);
        
        // Attach request ID for tracing
        req.requestId = requestId;
        
        // Log request start
        logger.info('HTTP', `${req.method} ${req.url}`, {
            requestId,
            method: req.method,
            url: req.url,
            query: req.query,
            hasBody: !!req.body && Object.keys(req.body).length > 0,
            contentType: req.headers['content-type'],
            userAgent: req.headers['user-agent']?.substring(0, 100),
            ip: req.ip || req.connection?.remoteAddress
        });

        loggerInstance.stats.totalRequests++;

        // Capture response
        const originalEnd = res.end;
        const originalJson = res.json;

        res.json = function(body) {
            const duration = Date.now() - startTime;
            logger.debug('HTTP-Response', `${req.method} ${req.url} -> ${res.statusCode} (${duration}ms)`, {
                requestId,
                statusCode: res.statusCode,
                duration,
                responseType: typeof body,
                responseSize: JSON.stringify(body)?.length || 0
            });
            return originalJson.call(this, body);
        };

        res.end = function(chunk, encoding) {
            const duration = Date.now() - startTime;
            logger.debug('HTTP-Response', `${req.method} ${req.url} -> ${res.statusCode} (${duration}ms)`, {
                requestId,
                statusCode: res.statusCode,
                duration
            });
            return originalEnd.call(this, chunk, encoding);
        };

        next();
    };
}

// =============================================================================
// DOWNLOAD-SPECIFIC LOGGING
// =============================================================================

/**
 * Enhanced download function wrapper with comprehensive logging
 */
function createDownloadLogger(loggerInstance, originalDownloadFn) {
    return async function(downloadOptions) {
        const downloadId = downloadOptions.id || Date.now().toString();
        const startTime = Date.now();
        
        loggerInstance.info('Download', `▶️ STARTING DOWNLOAD: ${downloadOptions.title || downloadOptions.videoId}`, {
            downloadId,
            videoId: downloadOptions.videoId,
            title: downloadOptions.title,
            format: downloadOptions.format,
            quality: downloadOptions.quality,
            channelId: downloadOptions.channelId,
            outputPath: downloadOptions.outputPath
        });

        loggerInstance.stats.totalDownloads++;

        try {
            // Log yt-dlp command that will be executed
            const cmd = buildYtDlpCommand(downloadOptions);
            loggerInstance.debug('Download', 'yt-dlp command:', { command: cmd.substring(0, 200) });

            // Execute original download function
            const result = await originalDownloadFn.call(this, downloadOptions);

            const duration = ((Date.now() - startTime) / 1000).toFixed(2);
            loggerInstance.info('Download', `✅ DOWNLOAD COMPLETED: ${downloadOptions.title?.substring(0, 50)}`, {
                downloadId,
                duration: `${duration}s`,
                outputPath: result?.outputPath,
                fileSize: result?.fileSize
            });

            return result;

        } catch (error) {
            const duration = ((Date.now() - startTime) / 1000).toFixed(2);
            loggerInstance.stats.failedDownloads++;
            
            loggerInstance.error('Download', `❌ DOWNLOAD FAILED: ${downloadOptions.title?.substring(0, 50)}`, {
                downloadId,
                duration: `${duration}s`,
                error: error.message,
                errorCode: error.code,
                errorStack: error.stack?.split('\n').slice(0, 10).join('\n'),
                ytDlpOutput: error.stderr || error.stdout || 'No output captured'
            });

            // Provide diagnostic suggestions based on error type
            const diagnosis = diagnoseDownloadError(error);
            loggerInstance.warn('Download-Diagnosis', 'Suggested fix:', diagnosis);

            throw error;
        }
    };
}

/**
 * Build yt-dlp command string for logging
 */
function buildYtDlpCommand(options) {
    const parts = ['yt-dlp'];
    
    if (options.format) {
        parts.push('-f', options.format === 'mp3' ? 'bestaudio' : 'bestvideo+bestaudio/best');
    }
    
    if (options.quality) {
        // Quality mapping would go here
    }
    
    parts.push('-o', `"${options.outputPath || '%(title)s.%(ext)s'}"`);
    parts.push('--no-playlist');
    
    if (options.format === 'mp4') {
        parts.push('--merge-output-format', 'mp4');
    }
    
    parts.push(`"${options.url || `https://www.youtube.com/watch?v=${options.videoId}`}"`);
    
    return parts.join(' ');
}

/**
 * Diagnose common download errors and suggest fixes
 */
function diagnoseDownloadError(error) {
    const errorMsg = (error.message + ' ' + (error.stderr || '')).toLowerCase();
    
    if (errorMsg.includes('cookie') || errorMsg.includes('login') || errorMsg.includes('sign in')) {
        return {
            cause: 'Authentication/Cookie issue',
            suggestion: 'Try: 1) Export cookies from browser, 2) Use --cookies-from-browser flag, 3) Check if video is private',
            severity: 'high'
        };
    }
    
    if (errorMsg.includes('403') || errorMsg.includes('forbidden')) {
        return {
            cause: 'Access forbidden - may need cookies or VPN',
            suggestion: 'Try: 1) Use VPN to different region, 2) Update yt-dlp, 3) Add browser cookies',
            severity: 'high'
        };
    }
    
    if (errorMsg.includes('not found') || errorMsg.includes('404')) {
        return {
            cause: 'Video not found or removed',
            suggestion: 'Check if video URL is correct and video still exists on YouTube',
            severity: 'medium'
        };
    }
    
    if (errorMsg.includes('copyright') || errorMsg.includes('blocked')) {
        return {
            cause: 'Copyright restriction or region block',
            suggestion: 'Try: 1) Use VPN, 2) Try different format, 3) Video may be restricted in your region',
            severity: 'medium'
        };
    }
    
    if (errorMsg.includes('ffmpeg') || errorMsg.includes('codec')) {
        return {
            cause: 'FFmpeg issue - post-processing failed',
            suggestion: 'Install FFmpeg: apt install ffmpeg (Linux) / brew install ffmpeg (Mac)',
            severity: 'high'
        };
    }
    
    if (errorMsg.includes('network') || errorMsg.includes('connection') || errorMsg.includes('timeout')) {
        return {
            cause: 'Network connectivity issue',
            suggestion: 'Check: 1) Internet connection, 2) Firewall settings, 3) YouTube accessibility',
            severity: 'medium'
        };
    }
    
    if (errorMsg.includes('permission') || errorMsg.includes('eacces') || errorMsg.includes('denied')) {
        return {
            cause: 'File system permission error',
            suggestion: 'Check: 1) Write permissions on download folder, 2) Disk space, 3) Run as admin?',
            severity: 'high'
        };
    }
    
    return {
        cause: 'Unknown error',
        suggestion: 'Check full error logs above. Consider updating yt-dlp: pip install --upgrade yt-dlp',
        severity: 'unknown'
    };
}

// =============================================================================
// YT-DLP PROCESS WRAPPER WITH DETAILED OUTPUT CAPTURE
// =============================================================================

/**
 * Spawn yt-dlp with complete stdout/stderr capture for debugging
 */
function spawnYtDlpWithLogging(args, options = {}, loggerInstance) {
    const { spawn } = require('child_process');
    const downloadId = options.downloadId || 'unknown';
    
    return new Promise((resolve, reject) => {
        loggerInstance.debug('yt-dlp', 'Spawning process', { args: args.join(' ').substring(0, 200) });
        
        const startTime = Date.now();
        const process = spawn('yt-dlp', args, {
            shell: true,
            cwd: options.cwd || process.cwd(),
            env: process.env,
            ...options.spawnOptions
        });

        let stdout = '';
        let stderr = '';
        let lastProgress = null;

        // Capture stdout line by line
        process.stdout.on('data', (data) => {
            const chunk = data.toString();
            stdout += chunk;
            
            // Parse and log progress
            const lines = chunk.split('\n').filter(l => l.trim());
            lines.forEach(line => {
                // Match progress pattern: [download]  45.5% of 15.00MiB at 2.50MiB/s ETA 00:04
                const progressMatch = line.match(/\[download\]\s+(\d+\.?\d*)%.*?at\s+([\d.]+\s*\w+\/s).*?ETA\s+(\S+)/);
                if (progressMatch) {
                    lastProgress = {
                        percent: parseFloat(progressMatch[1]),
                        speed: progressMatch[2],
                        eta: progressMatch[3],
                        timestamp: Date.now()
                    };
                    
                    // Log progress every ~10% or every 30 seconds
                    if (lastProgress.percent % 10 < 1 || !lastProgress.lastLogged || 
                        Date.now() - lastProgress.lastLogged > 30000) {
                        lastProgress.lastLogged = Date.now();
                        loggerInstance.debug('Download-Progress', `${lastProgress.percent}% @ ${lastProgress.speed} - ETA: ${lastProgress.eta}`, {
                            downloadId,
                            percent: lastProgress.percent,
                            speed: lastProgress.speed,
                            eta: lastProgress.eta
                        });
                    }
                    
                    // Call progress callback if provided
                    if (options.onProgress) {
                        options.onProgress(lastProgress);
                    }
                }
                
                // Log important non-progress lines
                if (!progressMatch && line.trim()) {
                    loggerInstance.debug('yt-dlp-stdout', line.trim().substring(0, 200));
                }
            });
        });

        // Capture stderr (yt-dlp uses stderr for most output)
        process.stderr.on('data', (data) => {
            const chunk = data.toString();
            stderr += chunk;
            
            const lines = chunk.split('\n').filter(l => l.trim());
            lines.forEach(line => {
                // Categorize and log appropriately
                const trimmedLine = line.trim();
                
                if (trimmedLine.toLowerCase().includes('error') || 
                    trimmedLine.toLowerCase().includes('failed') ||
                    trimmedLine.toLowerCase().includes('warning')) {
                    loggerInstance.warn('yt-dlp-stderr', trimmedLine.substring(0, 200));
                } else if (trimmedLine.startsWith('[download]') || 
                           trimmedLine.startsWith('[Merger]') ||
                           trimmedLine.startsWith('[ExtractAudio]')) {
                    loggerInstance.debug('yt-dlp-status', trimmedLine.substring(0, 200));
                } else if (trimmedLine.trim()) {
                    loggerInstance.debug('yt-dlp-info', trimmedLine.substring(0, 200));
                }
            });
        });

        process.on('close', (code) => {
            const duration = ((Date.now() - startTime) / 1000).toFixed(2);
            
            loggerInstance.info('yt-dlp', `Process exited with code ${code} after ${duration}s`, {
                downloadId,
                exitCode: code,
                duration: `${duration}s`,
                stdoutLength: stdout.length,
                stderrLength: stderr.length,
                lastProgress
            });

            if (code === 0) {
                resolve({
                    success: true,
                    code,
                    stdout,
                    stderr,
                    duration: parseFloat(duration),
                    lastProgress
                });
            } else {
                // Extract relevant error info
                const errorLines = stderr.split('\n')
                    .filter(l => l.toLowerCase().includes('error') || 
                                 l.toLowerCase().includes('failed') ||
                                 l.toLowerCase().includes('warning'))
                    .slice(-5);
                
                const error = new Error(`yt-dlp exited with code ${code}`);
                error.code = code;
                error.stdout = stdout;
                error.stderr = stderr;
                error.relevantErrors = errorLines;
                
                reject(error);
            }
        });

        process.on('error', (err) => {
            loggerInstance.error('yt-dlp', 'Failed to spawn process', {
                downloadId,
                error: err.message,
                code: err.code
            });
            reject(err);
        });

        // Return process reference for external control
        if (options.returnProcess) {
            options.returnProcess(process);
        }
    });
}

// =============================================================================
// API ENDPOINT FOR LOG VIEWING
// =============================================================================

/**
 * Add log viewing endpoints to Express app
 */
function addLogEndpoints(app, loggerInstance) {
    /**
     * GET /api/logs - Get all logs with optional filtering
     * Query params: level, category, since, limit
     */
    app.get('/api/logs', (req, res) => {
        try {
            const options = {
                level: req.query.level,
                category: req.query.category,
                since: req.query.since,
                limit: parseInt(req.query.limit) || 100
            };
            
            const result = loggerInstance.getLogs(options);
            res.json(result);
        } catch (error) {
            loggerInstance.error('API', 'Error fetching logs', { error: error.message });
            res.status(500).json({ error: 'Failed to fetch logs', details: error.message });
        }
    });

    /**
     * GET /api/logs/stats - Get logging statistics
     */
    app.get('/api/logs/stats', (req, res) => {
        try {
            res.json(loggerInstance.getStats());
        } catch (error) {
            res.status(500).json({ error: 'Failed to get stats' });
        }
    });

    /**
     * DELETE /api/logs - Clear all logs
     */
    app.delete('/api/logs', (req, res) => {
        try {
            loggerInstance.clear();
            res.json({ success: true, message: 'Logs cleared' });
        } catch (error) {
            res.status(500).json({ error: 'Failed to clear logs' });
        }
    });

    /**
     * GET /api/logs/download - Export logs as text file
     */
    app.get('/api/logs/download', (req, res) => {
        try {
            const text = loggerInstance.exportAsText({
                limit: parseInt(req.query.limit) || 500
            });
            
            res.setHeader('Content-Type', 'text/plain');
            res.setHeader('Content-Disposition', `attachment; filename="ytl-logs-${Date.now()}.txt"`);
            res.send(text);
        } catch (error) {
            res.status(500).json({ error: 'Failed to export logs' });
        }
    });

    /**
     * POST /api/test-download - Test download endpoint with full logging
     * Body: { url, videoId, title, format, quality }
     */
    app.post('/api/test-download', async (req, res) => {
        const testId = Date.now().toString();
        loggerInstance.info('Test-Download', '🧪 Starting test download', { 
            testId, 
            body: req.body 
        });

        try {
            const { url, videoId, title, format = 'mp4', quality = 'best' } = req.body;
            const videoUrl = url || `https://www.youtube.com/watch?v=${videoId}`;

            // Validate input
            if (!videoUrl && !videoId) {
                throw new Error('URL or videoId is required');
            }

            // Test yt-dlp availability
            loggerInstance.info('Test-Download', 'Checking yt-dlp availability...');
            const { execSync } = require('child_process');
            
            let ytDlpVersion;
            try {
                ytDlpVersion = execSync('yt-dlp --version', { encoding: 'utf8' }).trim();
                loggerInstance.info('Test-Download', `yt-dlp version: ${ytDlpVersion}`);
            } catch (e) {
                throw new Error('yt-dlp not found. Install with: pip install yt-dlp');
            }

            // Test FFmpeg
            let ffmpegAvailable = false;
            try {
                execSync('ffmpeg -version', { stdio: 'pipe' });
                ffmpegAvailable = true;
                loggerInstance.info('Test-Download', 'FFmpeg: Available ✅');
            } catch (e) {
                loggerInstance.warn('Test-Download', 'FFmpeg: Not found ⚠️ (audio/video merge may fail)');
            }

            // Build args for dry run (just get info, don't download)
            const args = [
                '--dump-json',
                '--no-download',
                '--no-playlist',
                videoUrl
            ];

            loggerInstance.info('Test-Download', 'Testing video info retrieval...', { url: videoUrl });

            const result = await spawnYtDlpWithLogging(args, {
                downloadId: testId,
                cwd: require('path').join(process.cwd(), 'downloads'),
                logger: loggerInstance
            }, loggerInstance);

            // Parse video info
            let videoInfo = null;
            try {
                videoInfo = JSON.parse(result.stdout);
                loggerInstance.info('Test-Download', 'Video info retrieved successfully', {
                    title: videoInfo.title,
                    duration: videoInfo.duration,
                    uploader: videoInfo.uploader,
                    formats: videoInfo.formats?.length || 0
                });
            } catch (e) {
                loggerInstance.warn('Test-Download', 'Could not parse video info JSON');
            }

            res.json({
                success: true,
                testId,
                diagnostics: {
                    ytDlpVersion,
                    ffmpegAvailable,
                    videoAccessible: true,
                    videoInfo: {
                        id: videoInfo?.id,
                        title: videoInfo?.title,
                        duration: videoInfo?.duration_string,
                        uploader: videoInfo?.uploader,
                        viewCount: videoInfo?.view_count,
                        formatCount: videoInfo?.formats?.length || 0
                    },
                    suggestedFormats: videoInfo?.formats
                        ?.filter(f => f.ext === 'mp4' || f.ext === 'webm')
                        ?.slice(-5)
                        .map(f => ({ 
                            format_id: f.format_id, 
                            ext: f.ext, 
                            resolution: f.resolution, 
                            filesize: f.filesize 
                        }))
                },
                message: 'Test completed successfully! Check logs for details.'
            });

        } catch (error) {
            loggerInstance.error('Test-Download', 'Test download failed', {
                testId,
                error: error.message,
                stderr: error.stderr?.slice(-500)
            });

            res.status(500).json({
                success: false,
                testId,
                error: error.message,
                diagnostics: {
                    ytDlpAvailable: !error.message.includes('not found'),
                    possibleCause: diagnoseDownloadError(error),
                    stderrPreview: error.stderr?.slice(-1000)
                },
                suggestion: 'Check /api/logs for detailed information'
            });
        }
    });

    loggerInstance.info('API', 'Log endpoints registered: GET /api/logs, GET /api/logs/stats, POST /api/test-download');
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
    EnhancedLogger,
    logger,
    createRequestLogger,
    createDownloadLogger,
    spawnYtDlpWithLogging,
    addLogEndpoints,
    diagnoseDownloadError
};

console.log('✅ [Logging Module] Backend logging enhancement loaded');
console.log('   Available endpoints:');
console.log('   - GET  /api/logs          View filtered logs');
console.log('   - GET  /api/logs/stats    Get statistics');
console.log('   - GET  /api/logs/download Export logs as file');
console.log('   - POST /api/test-download Test download with diagnostics');
console.log('   - DEL  /api/logs          Clear logs');
