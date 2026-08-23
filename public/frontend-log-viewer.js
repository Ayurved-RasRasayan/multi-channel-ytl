/**
 * ============================================================================
 * FRONTEND LOG VIEWER & DEBUGGER FOR multi-channel-ytl
 * ============================================================================
 * 
 * This script adds:
 * 1. A floating log viewer panel that shows all API activity
 * 2. Console.log interception and display
 * 3. API request/response logging with timing
 * 4. Error highlighting and diagnostics
 * 5. Download progress tracking in real-time
 * 6. Network request monitoring
 * 
 * USAGE: Add this script to your index.html before closing </body> tag
 *        <script src="frontend-log-viewer.js"></script>
 * ============================================================================
 */

(function() {
    'use strict';

    // =========================================================================
    // CONFIGURATION
    // =========================================================================
    
    const CONFIG = {
        maxLogEntries: 500,
        autoScroll: true,
        showTimestamps: true,
        logLevels: {
            debug: { color: '#6b7280', icon: '🔍', visible: false },
            info: { color: '#3b82f6', icon: 'ℹ️', visible: true },
            success: { color: '#10b981', icon: '✅', visible: true },
            warn: { color: '#f59e0b', icon: '⚠️', visible: true },
            error: { color: '#ef4444', icon: '❌', visible: true },
            api: { color: '#8b5cf6', icon: '🌐', visible: true },
            download: { color: '#06b6d4', icon: '⬇️', visible: true }
        },
        apiBaseUrl: window.location.origin,
        storageKey: 'ytl-debug-logs'
    };

    // =========================================================================
    // LOG STORAGE
    // =========================================================================

    class LogStore {
        constructor() {
            this.logs = [];
            this.listeners = [];
            this.loadFromStorage();
        }

        add(entry) {
            const logEntry = {
                id: Date.now() + Math.random(),
                timestamp: new Date().toISOString(),
                ...entry
            };

            this.logs.push(logEntry);
            
            // Trim if needed
            if (this.logs.length > CONFIG.maxLogEntries) {
                this.logs.shift();
            }

            this.notifyListeners(logEntry);
            this.saveToStorage();
            
            return logEntry;
        }

        getLogs(filter = {}) {
            let filtered = [...this.logs];
            
            if (filter.level) {
                filtered = filtered.filter(l => l.level === filter.level);
            }
            if (filter.category) {
                filtered = filtered.filter(l => l.category === filter.category);
            }
            if (filter.search) {
                const searchLower = filter.search.toLowerCase();
                filtered = filtered.filter(l => 
                    JSON.stringify(l).toLowerCase().includes(searchLower)
                );
            }
            if (filter.limit) {
                filtered = filtered.slice(-filter.limit);
            }

            return filtered;
        }

        clear() {
            this.logs = [];
            this.saveToStorage();
            this.notifyListeners(null, 'cleared');
        }

        onLog(callback) {
            this.listeners.push(callback);
            return () => {
                this.listeners = this.listeners.filter(l => l !== callback);
            };
        }

        notifyListeners(logEntry, action = 'added') {
            this.listeners.forEach(cb => cb(logEntry, action));
        }

        saveToStorage() {
            try {
                localStorage.setItem(CONFIG.storageKey, JSON.stringify(this.logs.slice(-100)));
            } catch (e) {
                // Storage full or unavailable
            }
        }

        loadFromStorage() {
            try {
                const saved = localStorage.getItem(CONFIG.storageKey);
                if (saved) {
                    this.logs = JSON.parse(saved);
                }
            } catch (e) {
                // Invalid data
            }
        }

        getStats() {
            const stats = {
                total: this.logs.length,
                byLevel: {},
                byCategory: {},
                errors: 0,
                lastError: null
            };

            this.logs.forEach(log => {
                stats.byLevel[log.level] = (stats.byLevel[log.level] || 0) + 1;
                stats.byCategory[log.category] = (stats.byCategory[log.category] || 0) + 1;
                
                if (log.level === 'error') {
                    stats.errors++;
                    stats.lastError = log;
                }
            });

            return stats;
        }
    }

    // Global log store instance
    const logStore = new LogStore();

    // =========================================================================
    // LOGGER FUNCTIONS
    // =========================================================================

    const Logger = {
        debug(category, message, data) {
            return logStore.add({ level: 'debug', category, message, data });
        },
        
        info(category, message, data) {
            return logStore.add({ level: 'info', category, message, data });
        },
        
        success(category, message, data) {
            return logStore.add({ level: 'success', category, message, data });
        },
        
        warn(category, message, data) {
            return logStore.add({ level: 'warn', category, message, data });
        },
        
        error(category, message, data) {
            return logStore.add({ level: 'error', category, message, data });
        },
        
        api(method, url, requestData, responseData, duration, status) {
            const level = status >= 400 ? 'error' : 'api';
            return logStore.add({
                level,
                category: 'API',
                message: `${method} ${url}`,
                data: {
                    method,
                    url,
                    requestData,
                    responseStatus: status,
                    duration: `${duration}ms`,
                    responseData: responseData ? JSON.stringify(responseData).substring(0, 500) : null
                }
            });
        },

        download(action, details) {
            return logStore.add({
                level: 'download',
                category: 'Download',
                message: action,
                data: details
            });
        }
    };

    // Make Logger globally available
    window.YTLLogger = Logger;
    window.YTLLogStore = logStore;

    // =========================================================================
    // CONSOLE INTERCEPTION
    // =========================================================================

    const originalConsole = {
        log: console.log.bind(console),
        error: console.error.bind(console),
        warn: console.warn.bind(console),
        info: console.info.bind(console)
    };

    console.log = function(...args) {
        originalConsole.log(...args);
        Logger.debug('Console', args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '));
    };

    console.error = function(...args) {
        originalConsole.error(...args);
        Logger.error('Console', args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '));
    };

    console.warn = function(...args) {
        originalConsole.warn(...args);
        Logger.warn('Console', args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '));
    };

    // =========================================================================
    // FETCH/XHR INTERCEPTION
    // =========================================================================

    // Intercept fetch API
    const originalFetch = window.fetch;
    window.fetch = async function(url, options = {}) {
        const startTime = performance.now();
        const method = (options.method || 'GET').toUpperCase();
        
        Logger.api(method, url, options.body, null, 0, 'pending');

        try {
            const response = await originalFetch.call(this, url, options);
            const duration = Math.round(performance.now() - startTime);
            
            let responseData = null;
            try {
                const clone = response.clone();
                responseData = await clone.json();
            } catch (e) {
                // Not JSON response
            }

            Logger.api(method, url, options.body, responseData, duration, response.status);

            return response;
        } catch (error) {
            const duration = Math.round(performance.now() - startTime);
            Logger.error('Fetch', `Request failed: ${method} ${url}`, { error: error.message, duration });
            throw error;
        }
    };

    // Intercept XMLHttpRequest
    const originalXHROpen = XMLHttpRequest.prototype.open;
    const originalXHRSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function(method, url, ...rest) {
        this._ytlMethod = method;
        this._ytlUrl = url;
        this._ytlStartTime = performance.now();
        return originalXHROpen.call(this, method, url, ...rest);
    };

    XMLHttpRequest.prototype.send = function(body) {
        this.addEventListener('load', function() {
            const duration = Math.round(performance.now() - this._ytlStartTime);
            Logger.api(this._ytlMethod, this._ytlUrl, body, null, duration, this.status);
        });

        this.addEventListener('error', function() {
            const duration = Math.round(performance.now() - this._ytlStartTime);
            Logger.error('XHR', `Request failed: ${this._ytlMethod} ${this._ytlUrl}`, { duration });
        });

        return originalXHRSend.call(this, body);
    };

    // =========================================================================
    // UI COMPONENTS
    // =========================================================================

    /**
     * Create the log viewer panel UI
     */
    function createLogViewer() {
        // Create main container
        const panel = document.createElement('div');
        panel.id = 'ytl-log-viewer';
        panel.innerHTML = `
            <style>
                #ytl-log-viewer {
                    position: fixed;
                    bottom: 20px;
                    right: 20px;
                    width: 450px;
                    max-height: 500px;
                    background: #1e293b;
                    border-radius: 12px;
                    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
                    font-family: 'Consolas', 'Monaco', monospace;
                    font-size: 12px;
                    z-index: 99999;
                    display: flex;
                    flex-direction: column;
                    overflow: hidden;
                    transition: all 0.3s ease;
                }

                #ytl-log-viewer.minimized {
                    width: 200px;
                    height: 50px;
                    max-height: 50px;
                }

                #ytl-log-viewer.hidden {
                    transform: translateY(calc(100% + 30px));
                    opacity: 0;
                    pointer-events: none;
                }

                .ytl-log-header {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    padding: 10px 15px;
                    background: linear-gradient(135deg, #3b82f6, #8b5cf6);
                    color: white;
                    cursor: move;
                    user-select: none;
                }

                .ytl-log-header h3 {
                    margin: 0;
                    font-size: 13px;
                    font-weight: 600;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                }

                .ytl-log-header-controls {
                    display: flex;
                    gap: 8px;
                }

                .ytl-log-btn {
                    width: 28px;
                    height: 28px;
                    border: none;
                    background: rgba(255,255,255,0.2);
                    color: white;
                    border-radius: 6px;
                    cursor: pointer;
                    font-size: 14px;
                    transition: background 0.2s;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }

                .ytl-log-btn:hover {
                    background: rgba(255,255,255,0.3);
                }

                .ytl-log-toolbar {
                    display: flex;
                    align-items: center;
                    padding: 8px 15px;
                    background: #334155;
                    gap: 10px;
                    flex-wrap: wrap;
                }

                .ytl-log-search {
                    flex: 1;
                    min-width: 150px;
                    padding: 6px 10px;
                    border: 1px solid #475569;
                    border-radius: 6px;
                    background: #1e293b;
                    color: #e2e8f0;
                    font-size: 11px;
                    outline: none;
                }

                .ytl-log-search:focus {
                    border-color: #3b82f6;
                }

                .ytl-log-filter {
                    padding: 5px 10px;
                    border: 1px solid #475569;
                    border-radius: 6px;
                    background: #1e293b;
                    color: #e2e8f0;
                    font-size: 11px;
                    cursor: pointer;
                    outline: none;
                }

                .ytl-log-level-filters {
                    display: flex;
                    gap: 5px;
                }

                .ytl-log-level-btn {
                    padding: 4px 8px;
                    border: 1px solid transparent;
                    border-radius: 4px;
                    background: transparent;
                    color: #94a3b8;
                    font-size: 10px;
                    cursor: pointer;
                    transition: all 0.2s;
                }

                .ytl-log-level-btn.active {
                    border-color: currentColor;
                }

                .ytl-log-level-btn[data-level="debug"] { color: #6b7280; }
                .ytl-log-level-btn[data-level="info"] { color: #3b82f6; }
                .ytl-log-level-btn[data-level="success"] { color: #10b981; }
                .ytl-log-level-btn[data-level="warn"] { color: #f59e0b; }
                .ytl-log-level-btn[data-level="error"] { color: #ef4444; }
                .ytl-log-level-btn[data-level="api"] { color: #8b5cf6; }
                .ytl-log-level-btn[data-level="download"] { color: #06b6d4; }

                .ytl-log-content {
                    flex: 1;
                    overflow-y: auto;
                    padding: 10px 15px;
                    background: #0f172a;
                }

                .ytl-log-entry {
                    padding: 8px 10px;
                    margin-bottom: 6px;
                    border-radius: 6px;
                    background: #1e293b;
                    border-left: 3px solid transparent;
                    animation: slideIn 0.2s ease;
                }

                @keyframes slideIn {
                    from { opacity: 0; transform: translateX(20px); }
                    to { opacity: 1; transform: translateX(0); }
                }

                .ytl-log-entry[level="debug"] { border-left-color: #6b7280; }
                .ytl-log-entry[level="info"] { border-left-color: #3b82f6; }
                .ytl-log-entry[level="success"] { border-left-color: #10b981; }
                .ytl-log-entry[level="warn"] { border-left-color: #f59e0b; }
                .ytl-log-entry[level="error"] { border-left-color: #ef4444; background: rgba(239, 68, 68, 0.1); }
                .ytl-log-entry[level="api"] { border-left-color: #8b5cf6; }
                .ytl-log-entry[level="download"] { border-left-color: #06b6d4; }

                .ytl-log-time {
                    color: #64748b;
                    font-size: 10px;
                    margin-right: 8px;
                }

                .ytl-log-icon {
                    margin-right: 6px;
                }

                .ytl-log-category {
                    color: #94a3b8;
                    font-weight: 600;
                    margin-right: 6px;
                }

                .ytl-log-message {
                    color: #e2e8f0;
                    word-break: break-word;
                }

                .ytl-log-data {
                    margin-top: 6px;
                    padding: 8px;
                    background: #0f172a;
                    border-radius: 4px;
                    font-size: 11px;
                    color: #94a3b8;
                    max-height: 150px;
                    overflow: auto;
                    white-space: pre-wrap;
                    word-break: break-all;
                }

                .ytl-log-footer {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    padding: 8px 15px;
                    background: #334155;
                    border-top: 1px solid #475569;
                    font-size: 11px;
                    color: #94a3b8;
                }

                .ytl-log-stats {
                    display: flex;
                    gap: 15px;
                }

                .ytl-log-stat {
                    display: flex;
                    align-items: center;
                    gap: 4px;
                }

                .ytl-log-footer-actions {
                    display: flex;
                    gap: 8px;
                }

                .ytl-log-footer-btn {
                    padding: 4px 10px;
                    border: 1px solid #475569;
                    border-radius: 4px;
                    background: transparent;
                    color: #94a3b8;
                    font-size: 10px;
                    cursor: pointer;
                    transition: all 0.2s;
                }

                .ytl-log-footer-btn:hover {
                    background: #475569;
                    color: white;
                }

                /* Toggle button */
                #ytl-log-toggle {
                    position: fixed;
                    bottom: 20px;
                    right: 20px;
                    width: 50px;
                    height: 50px;
                    border: none;
                    border-radius: 50%;
                    background: linear-gradient(135deg, #3b82f6, #8b5cf6);
                    color: white;
                    font-size: 20px;
                    cursor: pointer;
                    box-shadow: 0 10px 25px -5px rgba(59, 130, 246, 0.5);
                    z-index: 99998;
                    transition: all 0.3s ease;
                    display: none;
                }

                #ytl-log-toggle:hover {
                    transform: scale(1.1);
                }

                /* Empty state */
                .ytl-log-empty {
                    text-align: center;
                    padding: 40px 20px;
                    color: #64748b;
                }

                .ytl-log-empty-icon {
                    font-size: 40px;
                    margin-bottom: 10px;
                }
            </style>

            <div class="ytl-log-header">
                <h3>
                    <span>📋</span>
                    <span>Debug Console</span>
                    <span class="ytl-badge" id="ytl-log-count">0</span>
                </h3>
                <div class="ytl-log-header-controls">
                    <button class="ytl-log-btn" id="ytl-minimize" title="Minimize">−</button>
                    <button class="ytl-log-btn" id="ytl-hide" title="Hide">×</button>
                </div>
            </div>

            <div class="ytl-log-toolbar">
                <input type="text" class="ytl-log-search" placeholder="Search logs..." id="ytl-search">
                <select class="ytl-log-filter" id="ytl-category-filter">
                    <option value="">All Categories</option>
                    <option value="API">API</option>
                    <option value="Download">Download</option>
                    <option value="Console">Console</option>
                    <option value="UI">UI</option>
                </select>
                <div class="ytl-log-level-filters">
                    <button class="ytl-log-level-btn active" data-level="error">Err</button>
                    <button class="ytl-log-level-btn active" data-level="warn">Warn</button>
                    <button class="ytl-log-level-btn active" data-level="info">Info</button>
                    <button class="ytl-log-level-btn active" data-level="api">API</button>
                    <button class="ytl-log-level-btn" data-level="debug">Debug</button>
                </div>
            </div>

            <div class="ytl-log-content" id="ytl-log-content">
                <div class="ytl-log-empty">
                    <div class="ytl-log-empty-icon">🔍</div>
                    <div>Waiting for logs...</div>
                    <div style="font-size: 11px; margin-top: 5px;">Actions will appear here</div>
                </div>
            </div>

            <div class="ytl-log-footer">
                <div class="ytl-log-stats">
                    <span class="ytl-log-stat"><span id="ytl-total-count">0</span> entries</span>
                    <span class="ytl-log-stat" id="ytl-error-count" style="color: #ef4444;">0 errors</span>
                </div>
                <div class="ytl-footer-actions">
                    <button class="ytl-log-footer-btn" id="ytl-fetch-server-logs">Server Logs</button>
                    <button class="ytl-log-footer-btn" id="ytl-export-logs">Export</button>
                    <button class="ytl-log-footer-btn" id="ytl-clear-logs">Clear</button>
                </div>
            </div>
        `;

        document.body.appendChild(panel);

        // Create toggle button
        const toggleBtn = document.createElement('button');
        toggleBtn.id = 'ytl-log-toggle';
        toggleBtn.innerHTML = '📋';
        toggleBtn.title = 'Show Debug Console';
        document.body.appendChild(toggleBtn);

        return panel;
    }

    /**
     * Render logs to the viewer
     */
    function renderLogs() {
        const content = document.getElementById('ytl-log-content');
        const searchInput = document.getElementById('ytl-search');
        const categoryFilter = document.getElementById('ytl-category-filter');
        const countBadge = document.getElementById('ytl-log-count');
        const totalCount = document.getElementById('ytl-total-count');
        const errorCount = document.getElementById('ytl-error-count');

        if (!content) return;

        const search = searchInput?.value || '';
        const category = categoryFilter?.value || '';
        
        // Get active level filters
        const activeLevels = new Set();
        document.querySelectorAll('.ytl-log-level-btn.active').forEach(btn => {
            activeLevels.add(btn.dataset.level);
        });

        const filteredLogs = logStore.getLogs({ search, category }).filter(log => 
            activeLevels.has(log.level)
        );

        // Update counts
        const stats = logStore.getStats();
        if (countBadge) countBadge.textContent = filteredLogs.length;
        if (totalCount) totalCount.textContent = stats.total;
        if (errorCount) errorCount.textContent = `${stats.errors} errors`;

        // Render entries
        if (filteredLogs.length === 0) {
            content.innerHTML = `
                <div class="ytl-log-empty">
                    <div class="ytl-log-empty-icon">🔍</div>
                    <div>No matching logs</div>
                    <div style="font-size: 11px; margin-top: 5px;">Try adjusting your filters</div>
                </div>
            `;
            return;
        }

        // Show most recent first
        const reversedLogs = [...filteredLogs].reverse();
        
        content.innerHTML = reversedLogs.map(log => {
            const levelConfig = CONFIG.logLevels[log.level] || CONFIG.logLevels.info;
            const time = new Date(log.timestamp).toLocaleTimeString();
            
            let dataHtml = '';
            if (log.data && Object.keys(log.data).length > 0) {
                const dataStr = typeof log.data === 'string' ? log.data : JSON.stringify(log.data, null, 2);
                dataHtml = `<div class="ytl-log-data">${escapeHtml(dataStr.substring(0, 1000))}</div>`;
            }

            return `
                <div class="ytl-log-entry" level="${log.level}">
                    <span class="ytl-log-time">${time}</span>
                    <span class="ytl-log-icon">${levelConfig.icon}</span>
                    <span class="ytl-log-category">[${log.category}]</span>
                    <span class="ytl-log-message">${escapeHtml(log.message)}</span>
                    ${dataHtml}
                </div>
            `;
        }).join('');

        // Auto-scroll to bottom if enabled
        if (CONFIG.autoScroll) {
            content.scrollTop = 0; // Because we reversed the array
        }
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // =========================================================================
    // EVENT HANDLERS
    // =========================================================================

    function setupEventListeners(panel) {
        // Minimize/Maximize
        document.getElementById('ytl-minimize')?.addEventListener('click', () => {
            panel.classList.toggle('minimized');
            document.getElementById('ytl-minimize').textContent = panel.classList.contains('minimized') ? '+' : '−';
        });

        // Hide/Show
        document.getElementById('ytl-hide')?.addEventListener('click', () => {
            panel.classList.add('hidden');
            document.getElementById('ytl-log-toggle').style.display = 'flex';
        });

        // Show from toggle button
        document.getElementById('ytl-log-toggle')?.addEventListener('click', () => {
            panel.classList.remove('hidden');
            document.getElementById('ytl-log-toggle').style.display = 'none';
        });

        // Search
        document.getElementById('ytl-search')?.addEventListener('input', renderLogs);

        // Category filter
        document.getElementById('ytl-category-filter')?.addEventListener('change', renderLogs);

        // Level filters
        document.querySelectorAll('.ytl-log-level-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                btn.classList.toggle('active');
                renderLogs();
            });
        });

        // Clear logs
        document.getElementById('ytl-clear-logs')?.addEventListener('click', () => {
            if (confirm('Clear all frontend logs?')) {
                logStore.clear();
                renderLogs();
            }
        });

        // Export logs
        document.getElementById('ytl-export-logs')?.addEventListener('click', () => {
            const logs = logStore.getLogs();
            const text = logs.map(l => 
                `[${l.timestamp}] [${l.level.toUpperCase()}] [${l.category}] ${l.message}` +
                (l.data ? `\n  ${JSON.stringify(l.data, null, 2)}` : '')
            ).join('\n\n');

            const blob = new Blob([text], { type: 'text/plain' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `ytl-frontend-logs-${Date.now()}.txt`;
            a.click();
            URL.revokeObjectURL(url);
        });

        // Fetch server logs
        document.getElementById('ytl-fetch-server-logs')?.addEventListener('click', async () => {
            try {
                Logger.info('LogViewer', 'Fetching server logs...');
                const response = await fetch('/api/logs?limit=50');
                const data = await response.json;
                
                if (data.logs) {
                    data.logs.forEach(log => {
                        logStore.add({
                            level: log.level === 'progress' ? 'info' : log.level,
                            category: `[SERVER] ${log.category}`,
                            message: log.message,
                            data: log.data
                        });
                    });
                    renderLogs();
                    Logger.success('LogViewer', `Fetched ${data.logs.length} server logs`);
                }
            } catch (error) {
                Logger.error('LogViewer', 'Failed to fetch server logs', { error: error.message });
            }
        });
    }

    // =========================================================================
    // INITIALIZATION
    // =========================================================================

    function init() {
        // Wait for DOM to be ready
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', setup);
        } else {
            setup();
        }
    }

    function setup() {
        const panel = createLogViewer();
        setupEventListeners(panel);

        // Listen for new logs
        logStore.onLog(() => {
            renderLogs();
        });

        // Initial render
        renderLogs();

        // Log initialization
        Logger.success('LogViewer', 'Debug console initialized', {
            version: '1.0.0',
            features: ['Console capture', 'API intercept', 'Log filtering', 'Export']
        });

        // Keyboard shortcut to toggle (Ctrl+Shift+D)
        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.shiftKey && e.key === 'D') {
                e.preventDefault();
                const panel = document.getElementById('ytl-log-viewer');
                if (panel.classList.contains('hidden')) {
                    panel.classList.remove('hidden');
                    document.getElementById('ytl-log-toggle').style.display = 'none';
                } else {
                    panel.classList.add('hidden');
                    document.getElementById('ytl-log-toggle').style.display = 'flex';
                }
            }
        });

        Logger.info('LogViewer', 'Press Ctrl+Shift+D to toggle debug console');
    }

    // Start
    init();

})();
