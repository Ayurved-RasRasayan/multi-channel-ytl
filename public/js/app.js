/**
 * YTL - Multi-Channel YouTube Downloader
 * Frontend Application Logic (v2.0)
 * 
 * Handles: State management, API calls, UI rendering, user interactions
 */

// =============================================================================
// GLOBAL STATE MANAGEMENT
// =============================================================================

const AppState = {
    // Data
    channels: new Map(),           // channelId -> channel object
    activeChannelId: null,         // Currently viewed channel
    openTabs: [],                   // Array of open channel IDs (tab order)
    
    // Selection state
    selectedVideos: new Set(),      // Set of selected video IDs
    currentFilter: 'all',          // Current status filter
    searchQuery: '',               // Current search text
    
    // Download queue
    downloadQueue: {
        active: [],
        queued: [],
        completed: []
    },
    
    // UI state
    currentView: 'dashboard',      // 'dashboard' | 'channel'
    sidebarCollapsed: false,
    queuePanelCollapsed: false,
    loading: false,
    
    // Pagination
    currentPage: 1,
    videosPerPage: 20,
    
    // Auto-sync
    autoSyncEnabled: true,
    schedulerStatus: null
};

// =============================================================================
// API SERVICE LAYER
// =============================================================================

const API = {
    baseURL: '/api',
    
    async request(endpoint, options = {}) {
        const url = `${this.baseURL}${endpoint}`;
        const config = {
            headers: {
                'Content-Type': 'application/json',
                ...options.headers
            },
            ...options
        };
        
        try {
            const response = await fetch(url, config);
            const data = await response.json();
            
            if (!response.ok) {
                throw new Error(data.error || `HTTP ${response.status}`);
            }
            
            return data;
        } catch (error) {
            console.error(`API Error [${endpoint}]:`, error);
            throw error;
        }
    },
    
    // Channel APIs
    async getChannels() {
        return this.request('/channels');
    },
    
    async addChannel(channelData) {
        return this.request('/channels', {
            method: 'POST',
            body: JSON.stringify(channelData)
        });
    },
    
    async updateChannel(channelId, updates) {
        return this.request(`/channels/${channelId}`, {
            method: 'PUT',
            body: JSON.stringify(updates)
        });
    },
    
    async deleteChannel(channelId) {
        return this.request(`/channels/${channelId}`, {
            method: 'DELETE'
        });
    },
    
    async syncChannel(channelId) {
        return this.request(`/channels/${channelId}/sync`, {
            method: 'POST'
        });
    },
    
    async syncAllChannels() {
        return this.request('/channels/sync-all', {
            method: 'POST'
        });
    },
    
    async getSyncStatus(channelId) {
        return this.request(`/channels/${channelId}/sync-status`);
    },
    
    // Dashboard
    async getDashboardStats() {
        return this.request('/dashboard/stats');
    },
    
    // Download Queue APIs
    async getQueueStatus() {
        return this.request('/downloads/queue');
    },
    
    async pauseAllDownloads() {
        return this.request('/downloads/pause-all', {
            method: 'POST'
        });
    },
    
    async resumeAllDownloads() {
        return this.request('/downloads/resume-all', {
            method: 'POST'
        });
    },
    
    async cancelDownload(downloadId) {
        return this.request(`/downloads/${downloadId}`, {
            method: 'DELETE'
        });
    },
    
    // Scheduler APIs
    async getSchedulerStatus() {
        return this.request('/scheduler/status');
    },
    
    async startScheduler(intervalHours = 2) {
        return this.request('/scheduler/start', {
            method: 'POST',
            body: JSON.stringify({ intervalHours })
        });
    },
    
    async stopScheduler() {
        return this.request('/scheduler/stop', {
            method: 'POST'
        });
    },
    
    async triggerScheduler() {
        return this.request('/scheduler/trigger', {
            method: 'POST'
        });
    }
};

// =============================================================================
// TOAST NOTIFICATION SYSTEM
// =============================================================================

function showToast(message, type = 'info', duration = 4000) {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    const icons = {
        success: '<i class="fas fa-check-circle"></i>',
        error: '<i class="fas fa-exclamation-circle"></i>',
        warning: '<i class="fas fa-exclamation-triangle"></i>',
        info: '<i class="fas fa-info-circle"></i>'
    };
    
    toast.innerHTML = `${icons[type] || icons.info} ${message}`;
    container.appendChild(toast);
    
    // Auto-remove after duration
    setTimeout(() => {
        toast.style.animation = 'slideInRight 0.3s ease reverse';
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

// =============================================================================
// MODAL MANAGEMENT
// =============================================================================

function showModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.add('show');
        document.body.style.overflow = 'hidden';
    }
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.remove('show');
        document.body.style.overflow = '';
    }
}

// Close modals on overlay click
document.addEventListener('click', (e) => {
    if (e.target.classList.contains('modal-overlay')) {
        e.target.classList.remove('show');
        document.body.style.overflow = '';
    }
});

// Close on Escape key
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        document.querySelectorAll('.modal-overlay.show').forEach(modal => {
            modal.classList.remove('show');
        });
        document.body.style.overflow = '';
    }
});

// =============================================================================
// CHANNEL MANAGEMENT FUNCTIONS
// =============================================================================

async function loadChannels() {
    try {
        AppState.loading = true;
        const data = await API.getChannels();
        
        if (data.success && data.channels) {
            AppState.channels.clear();
            data.channels.forEach(ch => {
                AppState.channels.set(ch.id, ch);
            });
            
            renderSidebar();
            renderDashboard();
            
            // If we have an active channel, refresh its view
            if (AppState.activeChannelId && AppState.channels.has(AppState.activeChannelId)) {
                renderChannelView(AppState.activeChannelId);
            } else if (data.channels.length > 0) {
                // Auto-open first channel
                openChannelTab(data.channels[0].id);
            }
        }
        
        AppState.loading = false;
    } catch (error) {
        console.error('Failed to load channels:', error);
        showToast('Failed to load channels: ' + error.message, 'error');
        AppState.loading = false;
    }
}

async function addNewChannel(event) {
    event.preventDefault();
    
    const url = document.getElementById('channelUrl').value.trim();
    const customName = document.getElementById('customName').value.trim();
    const outputDir = document.getElementById('outputDirectory').value.trim();
    const quality = document.getElementById('qualitySelect').value;
    const format = document.getElementById('formatSelect').value;
    const autoSync = document.getElementById('autoSyncCheck').checked;
    
    if (!url) {
        showToast('Please enter a channel URL', 'warning');
        return;
    }
    
    try {
        showToast('Adding channel... Please wait', 'info', 6000);
        
        const result = await API.addChannel({
            url,
            name: customName || null,
            outputDir: outputDir || null,
            settings: { quality, format, autoSync }
        });
        
        if (result.success) {
            showToast(`Channel "${result.channel.name}" added successfully!`, 'success');
            closeModal('channelModal');
            
            // Reset form
            document.getElementById('channelForm').reset();
            
            // Reload channels list
            await loadChannels();
            
            // Open the new channel tab
            if (result.channel && result.channel.id) {
                openChannelTab(result.channel.id);
            }
        } else {
            throw new Error(result.error || 'Failed to add channel');
        }
    } catch (error) {
        console.error('Add channel error:', error);
        showToast('Failed to add channel: ' + error.message, 'error');
    }
}

async function removeChannel(channelId) {
    if (!channelId) return;
    
    const channel = AppState.channels.get(channelId);
    if (!channel) return;
    
    // Show confirmation with channel name
    document.getElementById('deleteChannelName').textContent = channel.name;
    showModal('deleteConfirmModal');
    
    // Store ID for confirm action
    window.pendingDeleteChannelId = channelId;
}

async function confirmDeleteChannel() {
    const channelId = window.pendingDeleteChannelId;
    if (!channelId) return;
    
    try {
        const result = await API.deleteChannel(channelId);
        
        if (result.success) {
            showToast('Channel removed successfully', 'success');
            
            // Remove from state
            AppState.channels.delete(channelId);
            AppState.openTabs = AppState.openTabs.filter(id => id !== channelId);
            AppState.selectedVideos.clear();
            
            // Close tab if it was the deleted one
            if (AppState.activeChannelId === channelId) {
                AppState.activeChannelId = null;
                showDashboard();
            }
            
            closeModal('deleteConfirmModal');
            renderSidebar();
            renderTabBar();
            renderDashboard();
        } else {
            throw new Error(result.error || 'Failed to delete channel');
        }
    } catch (error) {
        console.error('Delete channel error:', error);
        showToast('Failed to delete channel: ' + error.message, 'error');
    }
}

async function updateChannelSettings(channelId, settings) {
    try {
        const result = await API.updateChannel(channelId, settings);
        
        if (result.success) {
            // Update local state
            const channel = AppState.channels.get(channelId);
            if (channel) {
                Object.assign(channel, result.channel);
            }
            
            showToast('Channel settings updated', 'success');
            renderSidebar();
            renderChannelView(channelId);
        }
    } catch (error) {
        console.error('Update settings error:', error);
        showToast('Failed to update settings: ' + error.message, 'error');
    }
}

// =============================================================================
// NAVIGATION & VIEW RENDERING
// =============================================================================

function showDashboard() {
    AppState.currentView = 'dashboard';
    AppState.activeChannelId = null;
    
    document.getElementById('dashboardView').classList.remove('hidden');
    document.getElementById('channelView').classList.add('hidden');
    
    // Update nav highlighting
    document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
    document.querySelector('.dashboard-nav')?.classList.add('active');
    
    renderDashboard();
}

function openChannelTab(channelId) {
    if (!channelId || !AppState.channels.has(channelId)) return;
    
    // Add to tabs if not already open
    if (!AppState.openTabs.includes(channelId)) {
        AppState.openTabs.push(channelId);
    }
    
    AppState.activeChannelId = channelId;
    AppState.currentView = 'channel';
    AppState.selectedVideos.clear();
    AppState.currentPage = 1;
    
    // Switch views
    document.getElementById('dashboardView').classList.add('hidden');
    document.getElementById('channelView').classList.remove('hidden');
    
    // Update nav
    document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
    
    renderTabBar();
    renderSidebar();
    renderChannelView(channelId);
}

function closeChannelTab(channelId, event) {
    if (event) event.stopPropagation();
    
    AppState.openTabs = AppState.openTabs.filter(id => id !== channelId);
    
    if (AppState.activeChannelId === channelId) {
        // Switch to another tab or dashboard
        if (AppState.openTabs.length > 0) {
            openChannelTab(AppState.openTabs[AppState.openTabs.length - 1]);
        } else {
            showDashboard();
        }
    }
    
    renderTabBar();
}

function switchToTab(channelId) {
    if (AppState.channels.has(channelId)) {
        openChannelTab(channelId);
    }
}

// =============================================================================
// SIDEBAR RENDERING
// =============================================================================

function renderSidebar() {
    const container = document.getElementById('channelList');
    if (!container) return;
    
    // Calculate totals for "All Channels"
    let totalVideos = 0, totalDownloaded = 0;
    AppState.channels.forEach(ch => {
        totalVideos += ch.stats?.totalVideos || ch.videos?.length || 0;
        totalDownloaded += ch.stats?.downloadedCount || 0;
    });
    
    let html = `
        <div class="nav-item ${AppState.currentView === 'dashboard' ? 'active' : ''}" onclick="showDashboard()">
            <i class="fas fa-chart-line"></i>
            <span>Dashboard</span>
            <span class="badge">${AppState.channels.size}</span>
        </div>
        <div class="nav-item" onclick="syncAllChannels()" title="Sync All Channels">
            <i class="fas fa-sync-alt"></i>
            <span>All Channels</span>
            <span class="badge small">${totalDownloaded}/${totalVideos}</span>
        </div>
        <div class="sidebar-divider"></div>
    `;
    
    // Channel items
    AppState.channels.forEach((channel, id) => {
        const isActive = AppState.activeChannelId === id;
        const downloaded = channel.stats?.downloadedCount || 0;
        const total = channel.stats?.totalVideos || channel.videos?.length || 0;
        const percent = total > 0 ? Math.round((downloaded / total) * 100) : 0;
        
        html += `
            <div class="channel-item ${isActive ? 'active' : ''}" 
                 onclick="openChannelTab('${id}')"
                 style="border-left-color: ${channel.color || '#3b82f6'}">
                <div class="channel-item-header">
                    <span class="channel-name">${escapeHtml(channel.name)}</span>
                    <span class="channel-percent">${percent}%</span>
                </div>
                <div class="channel-progress">
                    <div class="progress-bar small" style="width: ${percent}%"></div>
                </div>
                <div class="channel-meta">
                    <span><i class="fas fa-check"></i> ${downloaded}</span>
                    <span><i class="fas fa-video"></i> ${total}</span>
                </div>
            </div>
        `;
    });
    
    container.innerHTML = html;
}

// =============================================================================
// TAB BAR RENDERING
// =============================================================================

function renderTabBar() {
    const container = document.getElementById('tabsContainer');
    if (!container) return;
    
    let html = '';
    
    AppState.openTabs.forEach((channelId, index) => {
        const channel = AppState.channels.get(channelId);
        if (!channel) return;
        
        const isActive = AppState.activeChannelId === channelId;
        
        html += `
            <div class="tab ${isActive ? 'active' : ''}" 
                 onclick="switchToTab('${channelId}')"
                 style="--tab-color: ${channel.color || '#3b82f6'}">
                <span class="tab-dot" style="background: ${channel.color || '#3b82f6'}"></span>
                ${escapeHtml(channel.name)}
                <button class="tab-close" onclick="closeChannelTab('${channelId}', event)" 
                        title="Close tab">
                    <i class="fas fa-times"></i>
                </button>
            </div>
        `;
    });
    
    container.innerHTML = html;
}

// =============================================================================
// DASHBOARD VIEW RENDERING
// =============================================================================

function renderDashboard() {
    // Update stats cards
    let totalVideos = 0, totalDownloaded = 0, totalRemaining = 0;
    
    AppState.channels.forEach(ch => {
        totalVideos += ch.stats?.totalVideos || ch.videos?.length || 0;
        totalDownloaded += ch.stats?.downloadedCount || 0;
        totalRemaining += ch.stats?.remainingCount || 0;
    });
    
    updateElement('dashTotalChannels', AppState.channels.size);
    updateElement('dashTotalVideos', totalVideos);
    updateElement('dashDownloaded', totalDownloaded);
    updateElement('dashRemaining', totalRemaining);
    
    // Render channel cards grid
    renderChannelCardsGrid();
}

function renderChannelCardsGrid() {
    const container = document.getElementById('channelCardsGrid');
    if (!container) return;
    
    if (AppState.channels.size === 0) {
        container.innerHTML = `
            <div class="empty-state large">
                <i class="fas fa-tv"></i>
                <h3>No channels yet</h3>
                <p>Add your first YouTube channel to get started!</p>
                <button class="btn-primary" onclick="showAddChannelModal()">
                    <i class="fas fa-plus"></i> Add Channel
                </button>
            </div>
        `;
        return;
    }
    
    let html = '';
    
    AppState.channels.forEach((channel, id) => {
        const downloaded = channel.stats?.downloadedCount || 0;
        const total = channel.stats?.totalVideos || channel.videos?.length || 0;
        const remaining = total - downloaded;
        const percent = total > 0 ? Math.round((downloaded / total) * 100) : 0;
        const lastSync = channel.stats?.lastSync 
            ? formatRelativeTime(new Date(channel.stats.lastSync))
            : 'Never';
        
        html += `
            <div class="channel-card" onclick="openChannelTab('${id}')">
                <div class="card-header" style="background: linear-gradient(135deg, ${channel.color || '#3b82f6'}22, ${channel.color || '#3b82f6'}44)">
                    <h4>${escapeHtml(channel.name)}</h4>
                    <span class="status-badge ${percent === 100 ? 'complete' : 'active'}">
                        ${percent === 100 ? '✅ Complete' : '🔄 Active'}
                    </span>
                </div>
                <div class="card-body">
                    <div class="card-stats">
                        <div class="card-stat">
                            <span class="value">${total}</span>
                            <span class="label">Videos</span>
                        </div>
                        <div class="card-stat downloaded">
                            <span class="value">${downloaded}</span>
                            <span class="label">Done</span>
                        </div>
                        <div class="card-stat remaining">
                            <span class="value">${remaining}</span>
                            <span class="label">Left</span>
                        </div>
                    </div>
                    <div class="progress-bar-container">
                        <div class="progress-bar" style="width: ${percent}%; background: ${channel.color || '#3b82f6'}"></div>
                    </div>
                    <div class="card-footer">
                        <span class="last-sync"><i class="fas fa-clock"></i> Synced: ${lastSync}</span>
                        <button class="btn-sm btn-secondary" onclick="event.stopPropagation(); syncSingleChannel('${id}')">
                            <i class="fas fa-sync-alt"></i>
                        </button>
                    </div>
                </div>
            </div>
        `;
    });
    
    container.innerHTML = html;
}

// =============================================================================
// CHANNEL VIEW RENDERING
// =============================================================================

function renderChannelView(channelId) {
    const channel = AppState.channels.get(channelId);
    if (!channel) return;
    
    // Update header
    updateElement('channelName', channel.name);
    updateElement('channelBadge', channel.status || 'Active');
    
    // Update stats bar
    const total = channel.stats?.totalVideos || channel.videos?.length || 0;
    const downloaded = channel.stats?.downloadedCount || 0;
    const remaining = total - downloaded;
    const percent = total > 0 ? Math.round((downloaded / total) * 100) : 0;
    
    updateElement('statTotal', total);
    updateElement('statDownloaded', downloaded);
    updateElement('statRemaining', remaining);
    
    const progressBar = document.getElementById('channelProgressBar');
    if (progressBar) progressBar.style.width = `${percent}%`;
    updateElement('channelProgressText', `${percent}%`);
    
    // Render video table
    renderVideoTable(channel);
    
    // Update batch actions button states
    updateBatchActionButtons();
}

function renderVideoTable(channel) {
    const tbody = document.getElementById('videoTableBody');
    const emptyState = document.getElementById('emptyState');
    if (!tbody) return;
    
    const videos = channel.videos || [];
    const filteredVideos = filterVideosList(videos);
    
    // Pagination
    const startIndex = (AppState.currentPage - 1) * AppState.videosPerPage;
    const endIndex = startIndex + AppState.videosPerPage;
    const paginatedVideos = filteredVideos.slice(startIndex, endIndex);
    
    if (paginatedVideos.length === 0) {
        tbody.innerHTML = '';
        emptyState?.classList.remove('hidden');
        return;
    }
    
    emptyState?.classList.add('hidden');
    
    let html = '';
    
    paginatedVideos.forEach(video => {
        const isSelected = AppState.selectedVideos.has(video.id);
        const isDownloaded = video.isDownloaded || false;
        const sanitizedTitle = video.sanitizedTitle || video.title || video.displayTitle || 'Untitled';
        const duration = video.duration ? formatDuration(video.duration) : '--:--';
        const size = video.fileInfo?.fileSizeMB || '--';
        
        // Determine status icon and class
        let statusIcon, statusClass;
        if (isDownloaded) {
            statusIcon = '<i class="fas fa-check-circle" style="color: #10b981"></i>';
            statusClass = 'downloaded';
        } else if (video.isDownloading) {
            statusIcon = `<i class="fas fa-spinner fa-spin" style="color: #3b82f6"></i>`;
            statusClass = 'downloading';
        } else {
            statusIcon = '<i class="far fa-circle" style="color: #d1d5db"></i>';
            statusClass = 'not-downloaded';
        }
        
        html += `
            <tr class="${isSelected ? 'selected' : ''} ${statusClass}" data-video-id="${video.id}">
                <td class="checkbox-col">
                    <input type="checkbox" 
                           ${isSelected ? 'checked' : ''} 
                           onchange="toggleVideoSelection('${video.id}')">
                </td>
                <td class="status-col">${statusIcon}</td>
                <td class="title-col">
                    <div class="video-title" title="${escapeHtml(sanitizedTitle)}">
                        ${escapeHtml(sanitizedTitle)}
                    </div>
                    ${video.matchingStrategy ? `<small class="strategy-tag">${video.matchingStrategy}</small>` : ''}
                </td>
                <td class="duration-col">${duration}</td>
                <td class="size-col">${size} MB</td>
                <td class="actions-col">
                    ${!isDownloaded ? `
                        <button class="btn-icon" onclick="downloadSingleVideo('${channel.id}', '${video.id}')" 
                                title="Download video">
                            <i class="fas fa-download"></i>
                        </button>
                    ` : `
                        <button class="btn-icon success" title="Downloaded">
                            <i class="fas fa-check"></i>
                        </button>
                    `}
                </td>
            </tr>
        `;
    });
    
    tbody.innerHTML = html;
    
    // Render pagination
    renderPagination(filteredVideos.length);
}

function filterVideosList(videos) {
    let filtered = [...videos];
    
    // Apply search filter
    if (AppState.searchQuery) {
        const query = AppState.searchQuery.toLowerCase();
        filtered = filtered.filter(v => {
            const title = (v.title || v.displayTitle || '').toLowerCase();
            const sanitized = (v.sanitizedTitle || '').toLowerCase();
            return title.includes(query) || sanitized.includes(query);
        });
    }
    
    // Apply status filter
    if (AppState.currentFilter !== 'all') {
        switch (AppState.currentFilter) {
            case 'downloaded':
                filtered = filtered.filter(v => v.isDownloaded);
                break;
            case 'not_downloaded':
                filtered = filtered.filter(v => !v.isDownloaded);
                break;
            case 'downloading':
                filtered = filtered.filter(v => v.isDownloading);
                break;
            case 'error':
                filtered = filtered.filter(v => v.hasError);
                break;
        }
    }
    
    return filtered;
}

function filterVideos() {
    AppState.searchQuery = document.getElementById('videoSearchInput')?.value || '';
    AppState.currentFilter = document.getElementById('statusFilter')?.value || 'all';
    AppState.currentPage = 1; // Reset to first page
    
    if (AppState.activeChannelId) {
        const channel = AppState.channels.get(AppState.activeChannelId);
        if (channel) renderVideoTable(channel);
    }
}

function renderPagination(totalItems) {
    const container = document.getElementById('pagination');
    if (!container) return;
    
    const totalPages = Math.ceil(totalItems / AppState.videosPerPage);
    
    if (totalPages <= 1) {
        container.innerHTML = '';
        return;
    }
    
    let html = '';
    
    // Previous button
    html += `<button class="page-btn" ${AppState.currentPage === 1 ? 'disabled' : ''} 
             onclick="goToPage(${AppState.currentPage - 1})">
                <i class="fas fa-chevron-left"></i>
            </button>`;
    
    // Page numbers
    const maxVisiblePages = 5;
    let startPage = Math.max(1, AppState.currentPage - Math.floor(maxVisiblePages / 2));
    let endPage = Math.min(totalPages, startPage + maxVisiblePages - 1);
    
    if (endPage - startPage < maxVisiblePages - 1) {
        startPage = Math.max(1, endPage - maxVisiblePages + 1);
    }
    
    if (startPage > 1) {
        html += `<button class="page-btn" onclick="goToPage(1)">1</button>`;
        if (startPage > 2) html += `<span class="page-dots">...</span>`;
    }
    
    for (let i = startPage; i <= endPage; i++) {
        html += `<button class="page-btn ${i === AppState.currentPage ? 'active' : ''}" 
                 onclick="goToPage(${i})">${i}</button>`;
    }
    
    if (endPage < totalPages) {
        if (endPage < totalPages - 1) html += `<span class="page-dots">...</span>`;
        html += `<button class="page-btn" onclick="goToPage(${totalPages})">${totalPages}</button>`;
    }
    
    // Next button
    html += `<button class="page-btn" ${AppState.currentPage === totalPages ? 'disabled' : ''} 
             onclick="goToPage(${AppState.currentPage + 1})">
                <i class="fas fa-chevron-right"></i>
            </button>`;
    
    container.innerHTML = html;
    
    // Update showing X of Y text
    const start = (AppState.currentPage - 1) * AppState.videosPerPage + 1;
    const end = Math.min(start + AppState.videosPerPage - 1, totalItems);
    // Could add a counter element here if needed
}

function goToPage(page) {
    AppState.currentPage = page;
    if (AppState.activeChannelId) {
        const channel = AppState.channels.get(AppState.activeChannelId);
        if (channel) renderVideoTable(channel);
    }
}

// =============================================================================
// VIDEO SELECTION & ACTIONS
// =============================================================================

function toggleVideoSelection(videoId) {
    if (AppState.selectedVideos.has(videoId)) {
        AppState.selectedVideos.delete(videoId);
    } else {
        AppState.selectedVideos.add(videoId);
    }
    
    updateSelectionUI();
}

function toggleSelectAll() {
    const checkbox = document.getElementById('selectAllCheckbox');
    if (!checkbox || !AppState.activeChannelId) return;
    
    const channel = AppState.channels.get(AppState.activeChannelId);
    if (!channel) return;
    
    const videos = filterVideosList(channel.videos || []);
    
    if (checkbox.checked) {
        videos.forEach(v => AppState.selectedVideos.add(v.id));
    } else {
        AppState.selectedVideos.clear();
    }
    
    // Re-render table to update checkboxes
    renderVideoTable(channel);
    updateSelectionUI();
}

function updateSelectionUI() {
    const count = AppState.selectedVideos.size;
    updateElement('selectedCount', `${count} selected`);
    
    // Enable/disable download selected button
    const btn = document.getElementById('downloadSelectedBtn');
    if (btn) btn.disabled = count === 0;
}

function updateBatchActionButtons() {
    updateSelectionUI();
    
    const channel = AppState.activeChannelId ? AppState.channels.get(AppState.activeChannelId) : null;
    const hasNewVideos = channel ? (channel.stats?.remainingCount || 0) > 0 : false;
    
    const btn = document.getElementById('downloadAllNewBtn');
    if (btn) btn.disabled = !hasNewVideos;
}

// =============================================================================
// DOWNLOAD OPERATIONS
// =============================================================================

async function downloadSelected() {
    if (!AppState.activeChannelId || AppState.selectedVideos.size === 0) return;
    
    const videoIds = Array.from(AppState.selectedVideos);
    
    try {
        showToast(`Starting download of ${videoIds.length} video(s)...`, 'info');
        
        // Call download API (implementation depends on backend endpoint)
        // For now, show a message since the exact endpoint may vary
        console.log('Would download videos:', videoIds);
        
        // TODO: Implement actual download call when backend endpoint is ready
        // await API.startDownloads({
        //     channelId: AppState.activeChannelId,
        //     videoIds: videoIds
        // });
        
        showToast(`${videoIds.length} downloads queued!`, 'success');
        
        // Clear selection
        AppState.selectedVideos.clear();
        if (AppState.activeChannelId) {
            const channel = AppState.channels.get(AppState.activeChannelId);
            if (channel) renderVideoTable(channel);
        }
        
        // Refresh queue
        refreshQueueStatus();
        
    } catch (error) {
        console.error('Download error:', error);
        showToast('Failed to start downloads: ' + error.message, 'error');
    }
}

async function downloadAllNew() {
    if (!AppState.activeChannelId) return;
    
    const channel = AppState.channels.get(AppState.activeChannelId);
    if (!channel) return;
    
    // Get all non-downloaded video IDs
    const newVideoIds = (channel.videos || [])
        .filter(v => !v.isDownloaded)
        .map(v => v.id);
    
    if (newVideoIds.length === 0) {
        showToast('No new videos to download!', 'info');
        return;
    }
    
    try {
        showToast(`Queuing ${newVideoIds.length} new video(s) for download...`, 'info');
        
        // TODO: Implement actual download call
        console.log('Would download all new videos:', newVideoIds);
        
        showToast(`${newVideoIds.length} videos queued for download!`, 'success');
        refreshQueueStatus();
        
    } catch (error) {
        console.error('Download all error:', error);
        showToast('Failed to queue downloads: ' + error.message, 'error');
    }
}

async function downloadSingleVideo(channelId, videoId) {
    try {
        showToast('Starting download...', 'info');
        
        // TODO: Implement single video download
        console.log('Would download single video:', { channelId, videoId });
        
        showToast('Download started!', 'success');
        refreshQueueStatus();
        
    } catch (error) {
        console.error('Single download error:', error);
        showToast('Download failed: ' + error.message, 'error');
    }
}

// =============================================================================
// SYNC OPERATIONS
// =============================================================================

async function syncCurrentChannel() {
    if (!AppState.activeChannelId) return;
    
    await syncSingleChannel(AppState.activeChannelId);
}

async function syncSingleChannel(channelId) {
    try {
        showToast('Syncing channel... This may take a moment.', 'info', 8000);
        
        const result = await API.syncChannel(channelId);
        
        if (result.success) {
            const channel = AppState.channels.get(channelId);
            if (channel && result.channel) {
                // Update channel data
                Object.assign(channel, result.channel);
                
                const downloaded = result.statistics?.downloaded || 0;
                const total = result.statistics?.total || 0;
                
                showToast(`Sync complete! ${downloaded}/${total} videos downloaded`, 'success');
                
                // Refresh views
                renderSidebar();
                renderChannelView(channelId);
                renderDashboard();
            }
        } else {
            throw new Error(result.error || 'Sync failed');
        }
    } catch (error) {
        console.error('Sync error:', error);
        showToast('Sync failed: ' + error.message, 'error');
    }
}

async function syncAllChannels() {
    try {
        const count = AppState.channels.size;
        if (count === 0) {
            showToast('No channels to sync', 'warning');
            return;
        }
        
        showToast(`Syncing all ${count} channel(s)... This may take a while.`, 'info', 10000);
        
        const result = await API.syncAllChannels();
        
        if (result.success) {
            let totalDownloaded = 0;
            let totalVideos = 0;
            
            // Update each channel's data
            if (result.results) {
                result.results.forEach(r => {
                    if (r.channelId && r.data) {
                        const channel = AppState.channels.get(r.channelId);
                        if (channel) {
                            Object.assign(channel, r.data.channel || r.data);
                        }
                    }
                    totalDownloaded += r.statistics?.downloaded || 0;
                    totalVideos += r.statistics?.total || 0;
                });
            }
            
            showToast(`All channels synced! ${totalDownloaded}/${totalVideos} videos downloaded`, 'success');
            
            // Refresh everything
            await loadChannels();
            
        } else {
            throw new Error(result.error || 'Sync all failed');
        }
    } catch (error) {
        console.error('Sync all error:', error);
        showToast('Failed to sync channels: ' + error.message, 'error');
    }
}

// =============================================================================
// QUEUE PANEL MANAGEMENT
// =============================================================================

function toggleQueuePanel() {
    const panel = document.getElementById('queuePanel');
    if (panel) {
        panel.classList.toggle('collapsed');
        AppState.queuePanelCollapsed = panel.classList.contains('collapsed');
    }
}

async function refreshQueueStatus() {
    try {
        const status = await API.getQueueStatus();
        
        if (status.success) {
            AppState.downloadQueue = {
                active: status.active || [],
                queued: status.queued || [],
                completed: status.completed || []
            };
            
            renderQueuePanel();
        }
    } catch (error) {
        console.error('Queue status error:', error);
    }
}

function renderQueuePanel() {
    const listContainer = document.getElementById('queueList');
    const emptyState = document.getElementById('queueEmpty');
    
    if (!listContainer) return;
    
    const { active, queued } = AppState.downloadQueue;
    const hasItems = active.length > 0 || queued.length > 0;
    
    if (!hasItems) {
        listContainer.innerHTML = '';
        emptyState?.classList.remove('hidden');
    } else {
        emptyState?.classList.add('hidden');
        
        let html = '';
        
        // Active downloads
        active.forEach(dl => {
            const progress = dl.progress || 0;
            const speed = dl.speed ? `${dl.speed} MB/s` : '';
            const eta = dl.eta ? formatDuration(dl.eta) : '';
            
            html += `
                <div class="queue-item active">
                    <div class="queue-item-info">
                        <span class="queue-item-title">${escapeHtml(dl.videoTitle || dl.title || 'Unknown')}</span>
                        <span class="queue-item-channel">${escapeHtml(dl.channelName || '')}</span>
                    </div>
                    <div class="queue-item-progress">
                        <div class="progress-bar" style="width: ${progress}%"></div>
                        <span class="progress-text">${progress}%</span>
                    </div>
                    <div class="queue-item-meta">
                        ${speed ? `<span>${speed}</span>` : ''}
                        ${eta ? `<span>${eta} left</span>` : ''}
                        <button class="btn-icon danger" onclick="cancelDownload('${dl.id}')" title="Cancel">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                </div>
            `;
        });
        
        // Queued downloads (show first 10)
        queued.slice(0, 10).forEach(dl => {
            html += `
                <div class="queue-item queued">
                    <div class="queue-item-info">
                        <span class="queue-item-title">${escapeHtml(dl.videoTitle || dl.title || 'Unknown')}</span>
                        <span class="queue-item-channel">Queued</span>
                    </div>
                    <button class="btn-icon" onclick="cancelDownload('${dl.id}')" title="Remove from queue">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
            `;
        });
        
        if (queued.length > 10) {
            html += `<div class="queue-more">+${queued.length - 10} more in queue...</div>`;
        }
        
        listContainer.innerHTML = html;
    }
    
    // Update stats
    updateElement('queueActiveCount', active.length);
    updateElement('queueQueuedCount', queued.length);
    updateElement('queueCompletedCount', AppState.downloadQueue.completed.length);
}

async function pauseAllDownloads() {
    try {
        await API.pauseAllDownloads();
        showToast('All downloads paused', 'info');
        refreshQueueStatus();
    } catch (error) {
        showToast('Failed to pause: ' + error.message, 'error');
    }
}

async function resumeAllDownloads() {
    try {
        await API.resumeAllDownloads();
        showToast('Downloads resumed', 'success');
        refreshQueueStatus();
    } catch (error) {
        showToast('Failed to resume: ' + error.message, 'error');
    }
}

async function cancelDownload(downloadId) {
    try {
        await API.cancelDownload(downloadId);
        showToast('Download cancelled', 'info');
        refreshQueueStatus();
    } catch (error) {
        showToast('Failed to cancel: ' + error.message, 'error');
    }
}

function clearCompletedQueue() {
    AppState.downloadQueue.completed = [];
    renderQueuePanel();
    showToast('Cleared completed downloads', 'info');
}

// =============================================================================
// SETTINGS MANAGEMENT
// =============================================================================

function editChannelSettings() {
    if (!AppState.activeChannelId) return;
    
    const channel = AppState.channels.get(AppState.activeChannelId);
    if (!channel) return;
    
    // Pre-fill form with current values
    document.getElementById('channelUrl').value = channel.url || '';
    document.getElementById('customName').value = channel.name || '';
    document.getElementById('outputDirectory').value = channel.outputDir || '';
    document.getElementById('qualitySelect').value = channel.settings?.quality || 'best';
    document.getElementById('formatSelect').value = channel.settings?.format || 'mp4';
    document.getElementById('autoSyncCheck').checked = channel.settings?.autoSync !== false;
    
    document.getElementById('channelModalTitle').textContent = 'Edit Channel';
    document.getElementById('submitChannelBtn').innerHTML = '<i class="fas fa-save"></i> Save Changes';
    
    showModal('channelModal');
}

function showAddChannelModal() {
    // Reset form
    document.getElementById('channelForm')?.reset();
    document.getElementById('channelModalTitle').textContent = 'Add New Channel';
    document.getElementById('submitChannelBtn').innerHTML = '<i class="fas fa-plus"></i> Add Channel';
    
    showModal('channelModal');
}

async function saveSettings() {
    const settings = {
        maxConcurrent: parseInt(document.getElementById('maxConcurrent')?.value) || 3,
        defaultQuality: document.getElementById('defaultQuality')?.value || 'best',
        enableAutoSync: document.getElementById('enableAutoSync')?.checked ?? true,
        syncInterval: parseInt(document.getElementById('syncInterval')?.value) || 2
    };
    
    try {
        // Save global settings (would need API endpoint)
        console.log('Saving settings:', settings);
        
        showToast('Settings saved successfully!', 'success');
        closeModal('settingsModal');
        
        // Apply auto-sync setting
        if (settings.enableAutoSync) {
            await startAutoSync(settings.syncInterval);
        } else {
            await stopAutoSync();
        }
        
    } catch (error) {
        showToast('Failed to save settings: ' + error.message, 'error');
    }
}

// =============================================================================
// AUTO-SYNC SCHEDULER
// =============================================================================

async function startAutoSync(intervalHours = 2) {
    try {
        await API.startScheduler(intervalHours);
        AppState.autoSyncEnabled = true;
        updateAutoSyncStatus();
        showToast(`Auto-sync enabled (every ${intervalHours} hours)`, 'success');
    } catch (error) {
        console.error('Start scheduler error:', error);
        showToast('Failed to start auto-sync: ' + error.message, 'error');
    }
}

async function stopAutoSync() {
    try {
        await API.stopScheduler();
        AppState.autoSyncEnabled = false;
        updateAutoSyncStatus();
        showToast('Auto-sync disabled', 'info');
    } catch (error) {
        console.error('Stop scheduler error:', error);
    }
}

async function checkSchedulerStatus() {
    try {
        const status = await API.getSchedulerStatus();
        AppState.schedulerStatus = status;
        updateAutoSyncStatus();
    } catch (error) {
        console.error('Scheduler status error:', error);
    }
}

function updateAutoSyncStatus() {
    const el = document.getElementById('autoSyncStatus');
    if (!el) return;
    
    if (AppState.autoSyncEnabled && AppState.schedulerStatus?.running) {
        el.innerHTML = `
            <i class="fas fa-clock" style="color: #10b981"></i>
            <span>Auto-sync: ON (${AppState.schedulerStatus.intervalHours || 2}h)</span>
        `;
    } else {
        el.innerHTML = `
            <i class="fas fa-clock" style="color: #64748b"></i>
            <span>Auto-sync: OFF</span>
        `;
    }
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function updateElement(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
}

function formatDuration(seconds) {
    if (!seconds) return '--:--';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    
    if (h > 0) {
        return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function formatRelativeTime(date) {
    if (!date) return 'Never';
    
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);
    
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    
    return date.toLocaleDateString();
}

// =============================================================================
// INITIALIZATION
// =============================================================================

async function initializeApp() {
    console.log('🌿 YTL Multi-Channel Downloader v2.0 Initializing...');
    
    try {
        // Load channels from server
        await loadChannels();
        
        // Check scheduler status
        await checkSchedulerStatus();
        
        // Initial queue status
        await refreshQueueStatus();
        
        // Start periodic queue updates (every 5 seconds)
        setInterval(refreshQueueStatus, 5000);
        
        // Start periodic scheduler status checks (every 30 seconds)
        setInterval(checkSchedulerStatus, 30000);
        
        console.log('✅ YTL initialized successfully!');
        
    } catch (error) {
        console.error('❌ Failed to initialize app:', error);
        showToast('Failed to initialize application', 'error');
    }
}

// Start the app when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeApp);
} else {
    initializeApp();
}

// =============================================================================
// EXPORT FOR DEBUGGING (optional)
// =============================================================================

window.YTL = {
    state: AppState,
    API,
    utils: {
        escapeHtml,
        formatDuration,
        formatRelativeTime
    }
};

console.log('🌿 YTL Multi-Channel YouTube Downloader v2.0 loaded');
console.log('Access debug info via: window.YTL');
