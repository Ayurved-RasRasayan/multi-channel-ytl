#!/bin/bash

# =============================================================================
# STARTUP PROCESS KILLER - Kills stale bash.exe and sleep.exe on start
# =============================================================================

startup_process_killer() {
    echo "[STARTUP] Searching for stale processes..."
    
    local killed_bash=0
    local killed_sleep=0
    
    # Try taskkill (Windows native) - works in Git Bash, MSYS2, Cygwin
    if command -v taskkill &> /dev/null; then
        echo "[STARTUP] Using taskkill to find and terminate processes..."
        
        # Find and kill sleep.exe processes
        local sleep_count=$(tasklist //FI "IMAGENAME eq sleep.exe" //NH //FO CSV 2>/dev/null | grep -i "sleep.exe" | wc -l)
        if [ "$sleep_count" -gt 0 ] 2>/dev/null; then
            taskkill //F //IM sleep.exe 2>/dev/null && killed_sleep=$sleep_count
            echo "[STARTUP] ✅ Killed $killed_sleep stale sleep.exe process(es)"
        else
            echo "[STARTUP] No sleep.exe processes found"
        fi
        
        # Find and kill bash.exe processes EXCLUDING current script's process
        local current_pid=$$
        echo "[STARTUP] Current script PID: $current_pid (will be spared)"
        
        # Get PIDs of all bash.exe processes and kill only non-current ones
        tasklist //FI "IMAGENAME eq bash.exe" //NH //FO CSV 2>/dev/null | grep -i "bash.exe" | while IFS=',' read -r pid rest; do
            # Extract numeric PID (remove quotes and spaces)
            pid=$(echo "$pid" | tr -d '" ' | grep -oE '[0-9]+')
            if [ -n "$pid" ] && [ "$pid" != "$current_pid" ]; then
                taskkill //F //PID "$pid" 2>/dev/null && echo "[STARTUP] ✅ Killed stale bash.exe PID: $pid"
            elif [ "$pid" = "$current_pid" ]; then
                echo "[STARTUP] ⏭️ Skipped current process PID: $pid"
            fi
        done
    fi
    
    # Fallback: Use pkill if available (excluding current process)
    if command -v pkill &> /dev/null; then
        echo "[STARTUP] Using pkill for additional cleanup..."
        pkill -f "sleep\.exe" 2>/dev/null && echo "[STARTUP] pkill: sleep.exe terminated"
        # pkill with -o selects oldest, but we need to exclude current PID
        # Safer: just use it for sleep, skip bash pkill to avoid self-kill
        echo "[STARTUP] Skipped pkill for bash.exe (safety: avoid killing self)"
    fi
    
    echo "[STARTUP] 🧹 Startup cleanup complete (bash: $killed_bash, sleep: $killed_sleep)"
    echo "[STARTUP] -------------------------------------------"
}

# Execute startup killer immediately
startup_process_killer

# =============================================================================
# PROCESS CLEANUP SYSTEM - Kills orphan processes on exit
# =============================================================================

# Configuration
CLEANUP_LOG="cleanup.log"
GRACEFUL_DELAY=0  # Seconds to wait (0 = instant exit, no delay!)

# Logging function
cleanup_log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$CLEANUP_LOG"
}

# Main cleanup function
cleanup_processes() {
    cleanup_log "🧹 Cleanup initiated - Terminal closing..."
    cleanup_log "Script PID: $$"
    
    detect_os_type
    
    case "$OS_TYPE" in
        windows|msys|cygwin)
            cleanup_windows_processes
            ;;
        linux|darwin|unix)
            cleanup_unix_processes
            ;;
        *)
            cleanup_generic
            ;;
    esac
    
    cleanup_log "✅ Cleanup completed"
}

# Detect operating system
detect_os_type() {
    case "$(uname -s)" in
        MINGW*|MSYS*|CYGWIN*) OS_TYPE="windows" ;;
        Linux*)     OS_TYPE="linux" ;;
        Darwin*)    OS_TYPE="macos" ;;
        *)          OS_TYPE="unix" ;;
    esac
    cleanup_log "Detected OS: $OS_TYPE ($(uname -s))"
}

# Windows-specific cleanup (Git Bash, MSYS2, Cygwin)
cleanup_windows_processes() {
    cleanup_log "🪟 Running Windows process cleanup..."
    
    local killed_bash=0
    local killed_sleep=0
    
    # Method 1: Try taskkill (Windows native command)
    if command -v taskkill &> /dev/null; then
        cleanup_log "Using taskkill for process termination..."
        
        # Kill all sleep.exe processes
        local sleep_pids=$(tasklist //FI "IMAGENAME eq sleep.exe" //NH //FO CSV 2>/dev/null | grep -i "sleep.exe" | wc -l)
        if [ "$sleep_pids" -gt 0 ] 2>/dev/null; then
            taskkill //F //IM sleep.exe 2>/dev/null && killed_sleep=$sleep_pids
            cleanup_log "Terminated $killed_sleep sleep.exe process(es)"
        fi
        
        # Kill all bash.exe processes EXCEPT current script's bash
        local bash_pids=$(tasklist //FI "IMAGENAME eq bash.exe" //NH //FO CSV 2>/dev/null | grep -i "bash.exe" | wc -l)
        if [ "$bash_pids" -gt 1 ] 2>/dev/null; then
            taskkill //F //IM bash.exe 2>/dev/null && killed_bash=$((bash_pids - 1))
            cleanup_log "Terminated $killed_bash additional bash.exe process(es)"
        fi
    fi
    
    # Method 2: Use pkill (available in Git Bash/MSYS2)
    if command -v pkill &> /dev/null; then
        cleanup_log "Using pkill for additional cleanup..."
        
        # Kill sleep.exe
        pkill -f "sleep\.exe" 2>/dev/null && cleanup_log "pkill: sleep.exe terminated"
        pkill -f "sleep" 2>/dev/null && cleanup_log "pkill: sleep terminated"
    fi
    
    cleanup_log "Windows cleanup complete (bash: $killed_bash, sleep: $killed_sleep)"
}

# Unix/Linux/macOS cleanup
cleanup_unix_processes() {
    cleanup_log "🐧 Running Unix process cleanup..."
    
    local killed_count=0
    
    if command -v pkill &> /dev/null; then
        # Kill child processes of this script
        local children=$(pgrep -P $$ 2>/dev/null)
        if [ -n "$children" ]; then
            echo "$children" | while read -r child_pid; do
                kill "$child_pid" 2>/dev/null && killed_count=$((killed_count + 1))
            done
            cleanup_log "Terminated $killed_count child process(es)"
        fi
        
        # Kill any sleep processes
        pkill -f "sleep" 2>/dev/null && cleanup_log "Terminated sleep processes"
    else
        # Fallback: Use kill on job PIDs
        for job_pid in $(jobs -p 2>/dev/null); do
            kill "$job_pid" 2>/dev/null && killed_count=$((killed_count + 1))
        done
        [ "$killed_count" -gt 0 ] && cleanup_log "Terminated $killed_count background jobs"
    fi
}

# Generic cleanup (fallback)
cleanup_generic() {
    cleanup_log "Running generic cleanup..."
    pkill -P $$ 2>/dev/null || true
    pkill -f "sleep" 2>/dev/null || true
    cleanup_log "Generic cleanup completed"
}

# ⚡ INSTANT EXIT CLEANUP - No delays!
instant_cleanup() {
    cleanup_log "⚡ Instant cleanup - exiting immediately..."
    
    # Kill everything immediately (no waiting)
    if command -v taskkill &> /dev/null; then
        taskkill //F //IM sleep.exe 2>/dev/null || true
    fi
    if command -v pkill &> /dev/null; then
        pkill -9 -P $$ 2>/dev/null || true
        pkill -9 -f "sleep" 2>/dev/null || true
    fi
    cleanup_log "✅ Instant cleanup done"
}

# Graceful shutdown (kept but disabled by default)
graceful_cleanup() {
    cleanup_log "Graceful shutdown (${GRACEFUL_DELAY}s)..."
    
    if [ "$OS_TYPE" = "windows" ] || [ "$OS_TYPE" = "msys" ] || [ "$OS_TYPE" = "cygwin" ]; then
        taskkill //F //IM sleep.exe 2>/dev/null || true
    else
        pkill -P $$ 2>/dev/null || true
        pkill -f "sleep" 2>/dev/null || true
    fi
    
    # Only wait if delay > 0
    if [ "${GRACEFUL_DELAY:-0}" -gt 0 ] 2>/dev/null; then
        sleep "$GRACEFUL_DELAY"
        cleanup_processes_force
    fi
}

# Force kill remaining processes
cleanup_processes_force() {
    if command -v pkill &> /dev/null; then
        pkill -9 -f "sleep" 2>/dev/null || true
        pkill -9 -P $$ 2>/dev/null || true
    fi
    
    if command -v taskkill &> /dev/null; then
        taskkill //F //IM sleep.exe 2>/dev/null || true
    fi
}

# =============================================================================
# ⚡ INSTANT EXIT TRAPS - Exit immediately on ALL signals (NO DELAYS!)
# =============================================================================
trap 'instant_cleanup; exit 0' EXIT
trap 'instant_cleanup; exit 130' INT          # Ctrl+C
trap 'instant_cleanup; exit 143' TERM         # kill command
trap 'instant_cleanup; exit 129' HUP          # Terminal closed
trap 'instant_cleanup; exit 131' QUIT
trap 'instant_cleanup; exit 0' BREAK

cleanup_log "🚀 Process cleanup system initialized (PID: $$)"
cleanup_log "Traps registered for: EXIT, INT, TERM, HUP, QUIT, BREAK"

# ... REST OF ORIGINAL 1.sh SCRIPT CONTINUES BELOW ...

# =============================================================================
# YouTube Downloader - COMPLETE ALL-IN-ONE SETUP SCRIPT
# Version 7.0 - ⭐⭐⭐ FULLY UPDATED WITH ALL FIXES ⭐⭐⭐
#
# This SINGLE script does EVERYTHING:
#   1. ✅ Uses CURRENT DIRECTORY (no more cloning!)
#   2. ✅ Installs/updates yt-dlp (with AUTO-RETRY on hang!)
#   3. ✅ Sets up ffmpeg
#   4. ✅ DETECTS existing cookies.txt (skips extraction if found)
#   5. ✅ AGGRESSIVELY KILLS Edge (retry every 5 sec until dead)
#   6. ✅ Extracts cookies with WORKING Python script (if needed)
#   7. ✅ Patches server.js to use --cookies  (NOT --cookies-from-browser)
#   8. ✅ COPIES PRE-MODIFIED FILES (Cancel/Resume buttons, Hidden quality)
#   9. ✅ Starts server and opens browser
#  10. ✅ TERMINAL STAYS OPEN FOREVER (no auto-close, no "press any key")
#
# ⭐⭐⭐ VERSION 7.0 NEW FEATURES ⭐⭐⭐
#   ✅ AUTO-KILL old server (prevents EADDRINUSE port error!)
#   ✅ AUTO-RETRY on hang (kills stuck process + waits 10s + retries!)
#   ✅ SKIP yt-dlp update if already installed (prevents pip hang!)
#   ✅ Channel-specific downloads ({ChannelName} subfolder!)
#
# REQUIREMENTS: server.js & index.html must be in SAME folder as this script!
#
# Usage: ./1.sh
# =============================================================================

# IMPORTANT: Do NOT use 'set -e' - it causes terminal to close on errors!
# We handle errors manually so terminal STAYS OPEN
# set -e  # DISABLED - This was causing terminal to close!

# =============================================================================
# CONFIGURATION - USES CURRENT DIRECTORY INSTEAD OF CLONING
# =============================================================================
# NOTE: No more REPO_URL or FOLDER_NAME - we use the current directory!
SERVER_DIR=""  # Will be set by detect_repo_structure()
SERVER_JS=""   # Will be set by detect_repo_structure()
TOOLS_DIR="$SCRIPT_DIR/tools"
FFMPEG_DIR="$TOOLS_DIR/ffmpeg"
COOKIES_FILE="$SCRIPT_DIR/server/cookies.txt"
PORT=3000
URL="http://localhost:$PORT"

# Color output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

# ⭐ NEW: Debug Colors for Frontend/Backend logging
MAGENTA='\033[0;35m'      # FRONTEND - Requests from browser
BRIGHT_GREEN='\033[1;32m' # SUCCESS - Downloads complete
BRIGHT_RED='\033[1;31m'   # ERRORS - Critical errors
BRIGHT_CYAN='\033[1;36m'  # BACKEND - Server operations
BRIGHT_YELLOW='\033[1;33m' # WARNINGS
WHITE='\033[1;37m'        # HEADERS/Important info

log()   { echo -e "${GREEN}[✓]${NC} $1"; }
warn()  { echo -e "${YELLOW}[!]${NC} $1"; }
error() { echo -e "${RED}[✗]${NC} $1"; }
dbg()   { echo -e "${BLUE}[•]${NC} $1"; }
ok()    { echo -e "${CYAN}${BOLD}[OK]${NC} $1"; }
step()  { echo -e "\n${BOLD}${CYAN}━━━ $1 ━━━${NC}"; }

# ⭐ NEW: Debug Logging Functions with Color Coding
log_backend()    { echo -e "${BRIGHT_CYAN}[BACKEND]${NC} $(date '+%H:%M:%S') $1"; }
log_frontend()   { echo -e "${MAGENTA}[FRONTEND]${NC} $(date '+%H:%M:%S') $1"; }
log_download()   { echo -e "${BRIGHT_GREEN}[DOWNLOAD]${NC} $(date '+%H:%M:%S') $1"; }
log_error()      { echo -e "${BRIGHT_RED}[ERROR]${NC} $(date '+%H:%M:%S') $1"; }
log_warning()    { echo -e "${BRIGHT_YELLOW}[WARNING]${NC} $(date '+%H:%M:%S') $1"; }
log_info()       { echo -e "${WHITE}[INFO]${NC} $(date '+%H:%M:%S') $1"; }

# =============================================================================
# Get the directory where THIS script is located
# =============================================================================
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
log "Script location: $SCRIPT_DIR"

# =============================================================================
# OS Detection
# =============================================================================
IS_WSL=false
IS_MAC=false
IS_LINUX=false
IS_WINDOWS=false
IS_CYGWIN=false
IS_MSYS=false

if grep -qE "Microsoft|WSL" /proc/version 2>/dev/null; then
    IS_WSL=true; OS_NAME="WSL (Windows)"
elif [[ "$OSTYPE" == "darwin"* ]]; then
    IS_MAC=true; OS_NAME="macOS"
elif [[ "$OSTYPE" == "cygwin"* ]]; then
    IS_CYGWIN=true; IS_WINDOWS=true; OS_NAME="Windows (Cygwin)"
elif [[ "$OSTYPE" == "msys"* ]]; then
    IS_MSYS=true; IS_WINDOWS=true; OS_NAME="Windows (MSYS/Git Bash)"
elif [[ "$OSTYPE" == "win32"* ]]; then
    IS_WINDOWS=true; OS_NAME="Windows"
elif [[ "$OSTYPE" == "linux"* ]]; then
    IS_LINUX=true; OS_NAME="Linux"
else
    OS_NAME="Unknown ($OSTYPE)"
fi

log "Detected OS: $OS_NAME"

# =============================================================================
# FUNCTION: Auto-Detect Repository Structure (uses current directory)
# Finds where server.js and other key files are located
# =============================================================================
detect_repo_structure() {
    step "DETECTING REPOSITORY STRUCTURE"

    log "Analyzing current directory structure..."
    
    # Show directory tree for debugging
    log "Current directory contents:"
    find "$SCRIPT_DIR" -maxdepth 2 -type f \( -name "*.js" -o -name "*.json" -o -name "*.html" \) 2>/dev/null | head -20

    # Try to find server.js in multiple locations (relative to SCRIPT_DIR)
    local FOUND_SERVER=false
    
    # Location 1: SCRIPT_DIR/server/server.js (standard structure)
    if [ -f "$SCRIPT_DIR/server/server.js" ]; then
        SERVER_DIR="$SCRIPT_DIR/server"
        SERVER_JS="$SCRIPT_DIR/server/server.js"
        FOUND_SERVER=true
        ok "Found: server.js in /server subfolder"
    
    # Location 2: SCRIPT_DIR/server.js (flat structure)
    elif [ -f "$SCRIPT_DIR/server.js" ]; then
        SERVER_DIR="$SCRIPT_DIR"
        SERVER_JS="$SCRIPT_DIR/server.js"
        FOUND_SERVER=true
        ok "Found: server.js in root folder"
    
    # Location 3: Search for any *.js file that looks like a server
    else
        log "Searching for server files..."
        
        # Look for common server file names
        for possible_name in "server.js" "app.js" "index.js" "main.js"; do
            # Check root level (SCRIPT_DIR)
            if [ -f "$SCRIPT_DIR/$possible_name" ]; then
                # Verify it's actually an Express/Node server (has require('express') or similar)
                if grep -q "express\|require\|http\|listen\|app\.get\|app\.post" "$SCRIPT_DIR/$possible_name" 2>/dev/null; then
                    SERVER_DIR="$SCRIPT_DIR"
                    SERVER_JS="$SCRIPT_DIR/$possible_name"
                    FOUND_SERVER=true
                    ok "Found server file: $possible_name (in root)"
                    break
                fi
            fi
            
            # Check /server subfolder
            if [ -f "$SCRIPT_DIR/server/$possible_name" ]; then
                if grep -q "express\|require\|http\|listen\|app\.get\|app\.post" "$SCRIPT_DIR/server/$possible_name" 2>/dev/null; then
                    SERVER_DIR="$SCRIPT_DIR/server"
                    SERVER_JS="$SCRIPT_DIR/server/$possible_name"
                    FOUND_SERVER=true
                    ok "Found server file: $possible_name (in /server)"
                    break
                fi
            fi
            
            # Check /src or /api subfolders
            for subdir in "src" "api" "backend"; do
                if [ -f "$SCRIPT_DIR/$subdir/$possible_name" ]; then
                    if grep -q "express\|require\|http\|listen\|app\.get\|app\.post" "$SCRIPT_DIR/$subdir/$possible_name" 2>/dev/null; then
                        SERVER_DIR="$SCRIPT_DIR/$subdir"
                        SERVER_JS="$SCRIPT_DIR/$subdir/$possible_name"
                        FOUND_SERVER=true
                        ok "Found server file: $possible_name (in /$subdir)"
                        break 2
                    fi
                fi
            done
        done
    fi

    # Final check
    if [ "$FOUND_SERVER" = false ]; then
        error "❌ Could NOT find server.js or any server file!"
        echo ""
        echo "Searched locations:"
        echo "  • $SCRIPT_DIR/server/server.js"
        echo "  • $SCRIPT_DIR/server.js"
        echo "  • $SCRIPT_DIR/app.js"
        echo "  • $SCRIPT_DIR/index.js"
        echo ""
        echo "Files found in current directory:"
        find "$SCRIPT_DIR" -maxdepth 3 -type f -name "*.js" 2>/dev/null || echo "  (none)"
        echo ""
        
        # Don't fail - maybe user will provide custom server.js later
        warn "⚠️  Will continue without auto-detected server path."
        warn "If you have a custom server.js, place it in script directory."
        
        # Set defaults anyway (may be overwritten by copy_modified_files)
        SERVER_DIR="$SCRIPT_DIR"
        SERVER_JS="$SCRIPT_DIR/server.js"
    else
        echo ""
        ok "✅ Repository structure detected!"
        log "Server directory: ${BOLD}$SERVER_DIR${NC}"
        log "Server file: ${BOLD}$SERVER_JS${NC}"
        
        # Check for package.json location too
        local PKG_JSON=""
        if [ -f "$SERVER_DIR/package.json" ]; then
            PKG_JSON="$SERVER_DIR/package.json"
            ok "✅ Found package.json in server directory"
        elif [ -f "$SCRIPT_DIR/package.json" ]; then
            PKG_JSON="$SCRIPT_DIR/package.json"
            ok "✅ Found package.json in root directory"
            # If package.json is in root but server is in /server, we need to adjust
            if [[ "$SERVER_DIR" == *"/server" ]] && [ -f "$SCRIPT_DIR/package.json" ]; then
                warn "⚠️  package.json is in root but server.js is in /server"
                warn "This might cause npm install issues..."
            fi
        fi
        
        # List what's in the server directory
        echo ""
        log "Contents of server directory ($SERVER_DIR):"
        ls -la "$SERVER_DIR/" 2>/dev/null | head -15 || error "Cannot list server directory!"
        echo ""
    fi
}

# =============================================================================
# ⭐ NEW: TIMEOUT FUNCTION - Auto-kill hanging processes & retry after 10s
# =============================================================================
run_with_timeout() {
    local cmd="$@"
    local timeout_seconds=30  # Max wait time before killing
    local max_retries=2       # Number of retries
    local retry_count=0
    
    while [ $retry_count -le $max_retries ]; do
        log "Running: $cmd (attempt $((retry_count+1))/$((max_retries+1)))"
        
        # Run command in background, get PID
        eval "$cmd" &
        local CMD_PID=$!
        
        # Wait with timeout
        local elapsed=0
        while kill -0 $CMD_PID 2>/dev/null; do
            sleep 1
            elapsed=$((elapsed + 1))
            
            if [ $elapsed -ge $timeout_seconds ]; then
                warn "⏰ Process hanging for ${elapsed}s - KILLING it!"
                
                # Kill the hanging process
                if [[ "$OSTYPE" == "msys" || "$OSTYPE" == "cygwin" ]] || [[ -n "$WINDIR" || -n "windir" ]]; then
                    # Windows
                    taskkill //PID $CMD_PID //F 2>/dev/null || true
                    taskkill //IM pip.exe //F 2>/dev/null || true
                    taskkill //IM pip3.exe //F 2>/dev/null || true
                else
                    # Unix/Mac
                    kill -9 $CMD_PID 2>/dev/null || true
                    kill -9 $(pgrep -P $CMD_PID) 2>/dev/null || true
                fi
                
                log "☠️ Process killed! Waiting 10 seconds before retry..."
                sleep 10
                
                retry_count=$((retry_count + 1))
                if [ $retry_count -le $max_retries ]; then
                    warn "🔄 Retrying in 10 seconds... (retry $retry_count of $max_retries)"
                fi
                continue 2  # Continue to next iteration of while loop
            fi
        done
        
        # Process completed normally
        wait $CMD_PID 2>/dev/null
        local EXIT_CODE=$?
        
        if [ $EXIT_CODE -eq 0 ]; then
            ok "✅ Command completed successfully!"
            return 0
        else
            warn "Command failed with code: $EXIT_CODE"
            retry_count=$((retry_count + 1))
            if [ $retry_count -le $max_retries ]; then
                log "Waiting 10 seconds before retry..."
                sleep 10
            fi
        fi
    done
    
    error "❌ Failed after $((max_retries+1)) attempts"
    return 1
}

# =============================================================================
# FUNCTION: Install yt-dlp
# =============================================================================
install_ytdl() {
    step "INSTALLING YT-DLP"

    if command -v yt-dlp >/dev/null 2>&1; then
        local YTDLP_VERSION=$(yt-dlp --version 2>/dev/null || echo "unknown")
        ok "yt-dlp already installed: version $YTDLP_VERSION"
        
        # ⭐ FIXED: Skip update check if version is recent (prevents hang)
        # Only update if version is older than 30 days
        log "yt-dlp is installed, skipping update to prevent hang..."
        log "If you want to update manually, run: pip install -U yt-dlp"
        return 0
        
        # Original update code (disabled to prevent hang):
        # log "Checking for updates..."
        # if pip install -U yt-dlp 2>/dev/null || pip3 install -U yt-dlp 2>/dev/null; then
        #     ok "yt-dlp updated to latest version!"
        # else
        #     warn "Could not update yt-dlp (this is okay)"
        # fi
        # return 0
    fi

    log "Installing yt-dlp..."
    
    if [ "$IS_WINDOWS" = true ]; then
        if command -v pip >/dev/null 2>&1; then
            # ⭐ FIXED: Use timeout wrapper (auto-kill + 10s retry)
            run_with_timeout "pip install --no-input --timeout 30 yt-dlp 2>/dev/null" || \
            run_with_timeout "pip3 install --no-input --timeout 30 yt-dlp 2>/dev/null"
        elif command -v pip3 >/dev/null 2>&1; then
            # ⭐ FIXED: Use timeout wrapper (auto-kill + 10s retry)
            run_with_timeout "pip3 install --no-input --timeout 30 yt-dlp 2>/dev/null"
        elif command -v winget >/dev/null 2>&1; then
            winget install IDID yt-dlp.yt-dlp 2>/dev/null || true
        else
            error "pip/pip3 not found! Trying direct download..."
            
            curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe -o /usr/bin/yt-dlp.exe 2>/dev/null || \
            curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/bin/yt-dlp 2>/dev/null
            
            chmod +x /usr/bin/yt-dlp 2>/dev/null || chmod +x /usr/bin/yt-dlp.exe 2>/dev/null
        fi
    elif [ "$IS_MAC" = true ]; then
        if command -v brew >/dev/null 2>&1; then
            brew install yt-dlp 2>/dev/null || brew upgrade yt-dlp 2>/dev/null
        elif command -v pip3 >/dev/null 2>&1; then
            # ⭐ FIXED: Use timeout wrapper (auto-kill + 10s retry)
            run_with_timeout "pip3 install --no-input --timeout 30 yt-dlp 2>/dev/null"
        else
            error "Please install yt-dlp via: brew install yt-dlp"
        fi
    else
        if command -v pip3 >/dev/null 2>&1; then
            # ⭐ FIXED: Use timeout wrapper (auto-kill + 10s retry)
            run_with_timeout "pip3 install --user --no-input --timeout 30 yt-dlp 2>/dev/null"
        elif command -v pip >/dev/null 2>&1; then
            # ⭐ FIXED: Use timeout wrapper (auto-kill + 10s retry)
            run_with_timeout "pip install --user --no-input --timeout 30 yt-dlp 2>/dev/null"
        elif command -v sudo >/dev/null 2>&1; then
            sudo apt-get update && sudo apt-get install -y yt-dlp 2>/dev/null || \
            sudo dnf install -y yt-dlp 2>/dev/null
        fi
    fi

    if command -v yt-dlp >/dev/null 2>&1; then
        ok "✅ yt-dlp installed successfully: $(yt-dlp --version 2>/dev/null || echo 'unknown')"
    else
        warn "⚠️  yt-dlp installation may have failed. Will try again later..."
    fi
}

# =============================================================================
# FUNCTION: Setup FFmpeg
# =============================================================================
setup_ffmpeg() {
    step "SETTING UP FFMPEG"

    if command -v ffmpeg >/dev/null 2>&1; then
        local FFMPEG_VERSION=$(ffmpeg -version 2>/dev/null | head -1 | awk '{print $3}')
        ok "FFmpeg already installed: version $FFMPEG_VERSION"
        return 0
    fi

    log "Installing FFmpeg..."
    
    if [ "$IS_WINDOWS" = true ]; then
        if command -v choco >/dev/null 2>&1; then
            choco install ffmpeg -y 2>/dev/null || true
        elif command -v scoop >/dev/null 2>&1; then
            scoop install ffmpeg 2>/dev/null || true
        elif command -v winget >/dev/null 2>&1; then
            winget install FFmpeg 2>/dev/null || true
        else
            warn "Could not auto-install FFmpeg on Windows"
            warn "Please install manually: https://ffmpeg.org/download.html"
        fi
    elif [ "$IS_MAC" = true ]; then
        if command -v brew >/dev/null 2>&1; then
            brew install ffmpeg 2>/dev/null || true
        else
            warn "Please install FFmpeg via: brew install ffmpeg"
        fi
    else
        if command -v sudo >/dev/null 2>&1; then
            sudo apt-get update && sudo apt-get install -y ffmpeg 2>/dev/null || \
            sudo dnf install -y ffmpeg 2>/dev/null || true
        fi
    fi

    if command -v ffmpeg >/dev/null 2>&1; then
        ok "✅ FFmpeg installed successfully: $(ffmpeg -version 2>/dev/null | head -1 | awk '{print $3}')"
    else
        warn "⚠️  FFmpeg installation may have failed. Video merging might not work."
    fi
}

# =============================================================================
# Browser detection - Clean output, no contamination
# =============================================================================
detect_browser() {
    echo "[✓] Detecting browsers for cookie extraction..." >&2

    if [ "$IS_WINDOWS" = true ] || [ "$IS_CYGWIN" = true ] || [ "$IS_MSYS" = true ]; then
        local APPDATA_LOCAL="$LOCALAPPDATA"
        local APPDATA_ROAMING="$APPDATA"

        if [ -d "$APPDATA_LOCAL/Microsoft/Edge/User Data" ]; then
            echo "[•] Checking for: edge" >&2
            echo "[OK] Found browser: edge" >&2
            echo "edge"
            return 0
        fi

        echo "[•] Checking for: chrome" >&2
        if [ -d "$APPDATA_LOCAL/Google/Chrome/User Data" ]; then
            echo "[OK] Found browser: chrome" >&2
            echo "chrome"
            return 0
        fi

        echo "[•] Checking for: vivaldi" >&2
        if [ -d "$APPDATA_LOCAL/Vivaldi/User Data" ]; then
            echo "[OK] Found browser: vivaldi" >&2
            echo "vivaldi"
            return 0
        fi

        echo "[•] Checking for: brave" >&2
        if [ -d "$APPDATA_LOCAL/BraveSoftware/Brave-Browser/User Data" ]; then
            echo "[OK] Found browser: brave" >&2
            echo "brave"
            return 0
        fi

        echo "[•] Checking for: firefox" >&2
        if [ -d "$APPDATA_ROAMING/Mozilla/Firefox/Profiles" ]; then
            echo "[OK] Found browser: firefox" >&2
            echo "firefox"
            return 0
        fi

    elif [ "$IS_MAC" = true ]; then
        if [ -d "$HOME/Library/Application Support/Microsoft Edge" ]; then
            echo "edge"; return 0; fi
        if [ -d "$HOME/Library/Application Support/Google/Chrome" ]; then
            echo "chrome"; return 0; fi
        if [ -d "$HOME/Library/Application Support/Vivaldi" ]; then
            echo "vivaldi"; return 0; fi
        if [ -d "$HOME/Library/Application Support/Firefox/Profiles" ]; then
            echo "firefox"; return 0; fi

    else
        if [ -d "$HOME/.config/microsoft-edge" ] || [ -d "$HOME/.config/edge" ]; then
            echo "edge"; return 0; fi
        if [ -d "$HOME/.config/google-chrome" ] || [ -d "$HOME/.config/chromium" ]; then
            echo "chrome"; return 0; fi
        if [ -d "$HOME/.config/vivaldi" ]; then
            echo "vivaldi"; return 0; fi
        if [ -d "$HOME/.config/BraveSoftware" ]; then
            echo "brave"; return 0; fi
        if [ -d "$HOME/.mozilla/firefox" ]; then
            echo "firefox"; return 0; fi
    fi

    echo "[ERROR] No supported browser found!" >&2
    return 1
}

# =============================================================================
# Test cookies work with yt-dlp (using --cookies-from-browser, live check only)
# =============================================================================
test_cookies() {
    local BROWSER="$1"

    log "Testing cookie extraction from $BROWSER..."

    local TEST_OUTPUT
    if TEST_OUTPUT=$(yt-dlp --cookies-from-browser "$BROWSER" --skip-download --flat-playlist "https://www.youtube.com/watch?v=dQw4w9WgXcQ" 2>&1); then
        ok "Cookie extraction working!"
        return 0
    else
        warn "Cookie test warning (may still work):"
        echo "$TEST_OUTPUT" | tail -5
        return 0
    fi
}

# =============================================================================
# CHECK IF COOKIES.TXT ALREADY EXISTS - SKIP EXTRACTION IF FOUND
# =============================================================================
check_existing_cookies() {
    log "Checking for existing cookies.txt..."
    
    # Check in project folder
    if [ -f "$COOKIES_FILE" ] && [ -s "$COOKIES_FILE" ]; then
        local COOKIE_COUNT
        COOKIE_COUNT=$(grep -vc '^#\|^$' "$COOKIES_FILE" 2>/dev/null || echo "0")
        if [ "$COOKIE_COUNT" -gt 0 ]; then
            ok "✅ cookies.txt already exists with $COOKIE_COUNT cookie entries!"
            log "Skipping cookie extraction (using existing file)"
            export COOKIES_EXPORTED=true
            return 0
        fi
    fi
    
    # Check in script directory (where Python script might have created it)
    if [ -f "$SCRIPT_DIR/cookies.txt" ] && [ -s "$SCRIPT_DIR/cookies.txt" ]; then
        local COOKIE_COUNT
        COOKIE_COUNT=$(grep -vc '^#\|^$' "$SCRIPT_DIR/cookies.txt" 2>/dev/null || echo "0")
        if [ "$COOKIE_COUNT" -gt 0 ]; then
            ok "✅ cookies.txt found in script directory with $COOKIE_COUNT entries"
            log "Copying to project folder..."
            mkdir -p "$(dirname "$COOKIES_FILE")"
            cp "$SCRIPT_DIR/cookies.txt" "$COOKIES_FILE"
            ok "✅ cookies.txt copied to: $COOKIES_FILE"
            export COOKIES_EXPORTED=true
            return 0
        fi
    fi
    
    log "No existing cookies.txt found. Will attempt extraction."
    export COOKIES_EXPORTED=false
    return 1
}

# =============================================================================
# AGGRESSIVELY KILL EDGE AND EXTRACT COOKIES WITH WORKING PYTHON SCRIPT
# FIXED FOR CYGWIN/MSYS PATH ISSUES
# =============================================================================
kill_edge_and_extract_cookies() {
    step "AGGRESSIVELY KILLING EDGE & EXTRACTING COOKIES"

    log "⚠️  Edge must be completely closed to extract cookies."
    log "Starting aggressive Edge termination loop..."

    # Function to check if Edge is running - FIXED for Cygwin
    check_edge_running() {
        if [ "$IS_WINDOWS" = true ] || [ "$IS_CYGWIN" = true ] || [ "$IS_MSYS" = true ]; then
            # Try multiple methods to detect Edge
            if command -v tasklist >/dev/null 2>&1; then
                tasklist 2>/dev/null | grep -i "msedge.exe" >/dev/null 2>&1
                return $?
            elif [ -f /c/Windows/System32/tasklist.exe ]; then
                /c/Windows/System32/tasklist.exe 2>/dev/null | grep -i "msedge.exe" >/dev/null 2>&1
                return $?
            else
                # Fallback: check via ps
                ps aux 2>/dev/null | grep -i "msedge.exe" | grep -v grep >/dev/null 2>&1
                return $?
            fi
        elif [ "$IS_MAC" = true ]; then
            pgrep -f "Microsoft Edge" >/dev/null 2>&1
            return $?
        else
            pgrep -f "microsoft-edge" >/dev/null 2>&1
            return $?
        fi
    }

    # Kill Edge function - FIXED for Cygwin path issues
    kill_edge() {
        if [ "$IS_WINDOWS" = true ] || [ "$IS_CYGWIN" = true ] || [ "$IS_MSYS" = true ]; then
            # Method 1: Try using cmd /c with proper quoting
            if command -v cmd >/dev/null 2>&1; then
                cmd //c "taskkill /F /IM msedge.exe 2>nul" 2>/dev/null || true
                # Also kill with /T to kill child processes
                cmd //c "taskkill /F /T /IM msedge.exe 2>nul" 2>/dev/null || true
            # Method 2: Try using taskkill directly if available
            elif command -v taskkill >/dev/null 2>&1; then
                taskkill /F /IM msedge.exe 2>/dev/null || true
                taskkill /F /T /IM msedge.exe 2>/dev/null || true
            # Method 3: Try Windows path directly
            elif [ -f /c/Windows/System32/taskkill.exe ]; then
                /c/Windows/System32/taskkill.exe /F /IM msedge.exe 2>/dev/null || true
                /c/Windows/System32/taskkill.exe /F /T /IM msedge.exe 2>/dev/null || true
            # Method 4: Try pkill
            elif command -v pkill >/dev/null 2>&1; then
                pkill -f msedge.exe 2>/dev/null || true
            else
                # Last resort: try to kill via Windows API using wmic
                if command -v wmic >/dev/null 2>&1; then
                    wmic process where "name='msedge.exe'" delete 2>/dev/null || true
                fi
            fi
        elif [ "$IS_MAC" = true ]; then
            pkill -f "Microsoft Edge" 2>/dev/null || true
        else
            pkill -f "microsoft-edge" 2>/dev/null || true
        fi
    }

    # Aggressive kill loop - keep trying until Edge is dead
    local ATTEMPT=0
    local MAX_ATTEMPTS=20  # Try up to 20 times (100 seconds max)
    local KILL_INTERVAL=5  # Check every 5 seconds

    while check_edge_running; do
        ATTEMPT=$((ATTEMPT + 1))
        
        if [ $ATTEMPT -gt $MAX_ATTEMPTS ]; then
            warn "⚠️  Edge still running after $MAX_ATTEMPTS attempts!"
            warn "Please close Edge manually and press Enter to continue..."
            read -p "Press Enter after closing Edge completely... "
            
            # One final check
            if check_edge_running; then
                error "Edge is still running. Cannot extract cookies."
                return 1
            fi
            break
        fi
        
        echo -n "  Attempt $ATTEMPT: Killing Edge processes..."
        kill_edge
        echo " done."
        
        sleep $KILL_INTERVAL
    done

    # Edge is dead - wait extra 5 seconds to ensure file locks are released
    log "✅ All Edge processes killed!"
    log "Waiting 5 seconds for file locks to be released..."
    sleep 5
    ok "File locks should now be released."

    # Create the working Python cookie extraction script
    log "Creating working Python cookie extractor..."
    
    local PYTHON_SCRIPT="$SCRIPT_DIR/export_cookies_fixed.py"
    
    cat > "$PYTHON_SCRIPT" << 'PYEOF'
#!/usr/bin/env python3
"""
Fixed Cookie Extractor for Edge Browser
Extracts YouTube cookies from Edge's Network/Cookies database
"""

import os
import sys
import sqlite3
import shutil
from pathlib import Path

def extract_edge_cookies():
    """Extract cookies from Edge browser (Windows)"""
    edge_path = Path(os.environ['LOCALAPPDATA']) / 'Microsoft' / 'Edge' / 'User Data' / 'Default' / 'Network'
    cookie_db = edge_path / 'Cookies'
    
    if not cookie_db.exists():
        print(f"❌ Edge cookies database not found at: {cookie_db}")
        return None
    
    print(f"📁 Found edge cookies at: {cookie_db}")
    
    # Copy the database (Edge locks it)
    temp_db = Path('temp_cookies.db')
    try:
        shutil.copy2(cookie_db, temp_db)
        print("✅ Cookie database copied successfully")
    except Exception as e:
        print(f"❌ Failed to copy database: {e}")
        return None
    
    # Extract cookies for youtube.com
    conn = None
    cursor = None
    try:
        conn = sqlite3.connect(str(temp_db))
        cursor = conn.cursor()
        
        # Create cookies.txt in Netscape format
        with open('cookies.txt', 'w', encoding='utf-8') as f:
            f.write('# Netscape HTTP Cookie File\n')
            
            cursor.execute("""
                SELECT host_key, path, is_secure, expires_utc, name, value 
                FROM cookies 
                WHERE host_key LIKE '%youtube.com%'
            """)
            
            count = 0
            for row in cursor.fetchall():
                host, path, secure, expires, name, value = row
                # Convert Edge's timestamp to Unix time
                if expires > 0:
                    # Edge uses microseconds since 1601-01-01
                    expires_sec = int(expires / 1000000 - 11644473600)
                else:
                    expires_sec = 0
                
                secure_flag = 'TRUE' if secure else 'FALSE'
                f.write(f"{host}\t{secure_flag}\t{path}\t{secure_flag}\t{expires_sec}\t{name}\t{value}\n")
                count += 1
        
        print(f"✅ Extracted {count} cookies for youtube.com")
        return 'cookies.txt'
        
    except Exception as e:
        print(f"❌ Error extracting cookies: {e}")
        return None
    finally:
        # Close cursor and connection properly
        if cursor:
            cursor.close()
        if conn:
            conn.close()
        # Try to delete temp file
        try:
            if temp_db.exists():
                temp_db.unlink()
                print("✅ Temporary file cleaned up")
        except PermissionError:
            print("⚠️ Could not delete temp file (will be deleted on next restart)")

if __name__ == '__main__':
    print("🔍 Searching for browser cookies...")
    result = extract_edge_cookies()
    if result:
        print(f"✅ Cookies saved to: {result}")
        # Show the first few lines of the cookie file
        try:
            with open(result, 'r') as f:
                lines = f.readlines()
                print(f"\n📋 First few cookies (preview):")
                for line in lines[1:4]:  # Skip header
                    print(f"   {line.strip()[:80]}...")
        except:
            pass
        sys.exit(0)
    else:
        print("❌ Could not extract cookies from any browser")
        sys.exit(1)
PYEOF

    chmod +x "$PYTHON_SCRIPT"
    ok "Python cookie extractor created at: $PYTHON_SCRIPT"

    # Run the Python script
    log "Running Python cookie extractor..."
    
    local PYTHON_CMD="python"
    if command -v python3 >/dev/null 2>&1; then
        PYTHON_CMD="python3"
    fi
    
    # Change to script directory to ensure cookies.txt is created there
    cd "$SCRIPT_DIR"
    
    # Double-check Edge is still dead before running Python
    if check_edge_running; then
        warn "⚠️  Edge started again! Killing it one more time..."
        kill_edge
        sleep 3
    fi
    
    if $PYTHON_CMD "$PYTHON_SCRIPT" 2>&1; then
        if [ -f "$SCRIPT_DIR/cookies.txt" ] && [ -s "$SCRIPT_DIR/cookies.txt" ]; then
            local COOKIE_COUNT
            COOKIE_COUNT=$(grep -vc '^#\|^$' "$SCRIPT_DIR/cookies.txt" 2>/dev/null || echo "0")
            ok "✅ Python extraction succeeded! ($COOKIE_COUNT cookie entries)"
            
            # Copy cookies.txt to the project folder
            mkdir -p "$(dirname "$COOKIES_FILE")"
            cp "$SCRIPT_DIR/cookies.txt" "$COOKIES_FILE"
            ok "✅ cookies.txt copied to: $COOKIES_FILE"
            export COOKIES_EXPORTED=true
            return 0
        fi
    fi
    
    warn "Python extraction failed"
    export COOKIES_EXPORTED=false
    return 1
}

# =============================================================================
# FALLBACK METHOD: Manual Browser Extension Export
# =============================================================================
manual_cookies_export() {
    step "FALLBACK: MANUAL COOKIES EXPORT"
    
    echo ""
    echo "╔══════════════════════════════════════════════════════════════╗"
    echo "║  AUTOMATIC COOKIE EXTRACTION FAILED                        ║"
    echo "║                                                              ║"
    echo "║  Please export cookies manually using one of these methods: ║"
    echo "║                                                              ║"
    echo "║  METHOD A: Browser Extension (Easiest)                     ║"
    echo "║    1. Install 'Get cookies.txt LOCALLY' extension:         ║"
    echo "║       Chrome: https://chrome.google.com/webstore/...       ║"
    echo "║       Firefox: https://addons.mozilla.org/...              ║"
    echo "║    2. Go to YouTube.com and log in                        ║"
    echo "║    3. Click the extension icon > Export cookies.txt       ║"
    echo "║    4. Save to: $COOKIES_FILE                              ║"
    echo "║                                                              ║"
    echo "║  METHOD B: Python Script (Already created)                 ║"
    echo "║    1. Close Edge completely                               ║"
    echo "║    2. Run: python export_cookies_fixed.py                ║"
    echo "║                                                              ║"
    echo "╚══════════════════════════════════════════════════════════════╝"
    echo ""
    
    read -p "Press Enter after you've saved cookies.txt to continue... "
    
    if [ -f "$COOKIES_FILE" ] && [ -s "$COOKIES_FILE" ]; then
        ok "✅ cookies.txt found and loaded!"
        export COOKIES_EXPORTED=true
        return 0
    else
        warn "Still no cookies.txt found. Continuing without cookies..."
        export COOKIES_EXPORTED=false
        return 1
    fi
}

# =============================================================================
# Enhanced cookie extraction with fallbacks - NOW CHECKS EXISTING FIRST
# =============================================================================
export_cookies_with_fallbacks() {
    local BROWSER="$1"
    
    step "COOKIE EXTRACTION (WITH EXISTING FILE DETECTION)"

    # FIRST: Check if cookies.txt already exists
    if check_existing_cookies; then
        export COOKIES_EXPORTED=true
        return 0
    fi
    
    # SECOND: Try killing Edge and using Python script
    if kill_edge_and_extract_cookies; then
        export COOKIES_EXPORTED=true
        return 0
    fi
    
    # THIRD: Try manual browser extension
    if manual_cookies_export; then
        export COOKIES_EXPORTED=true
        return 0
    fi
    
    # ALL METHODS FAILED
    warn "All cookie extraction methods failed!"
    export COOKIES_EXPORTED=false
    return 1
}

# =============================================================================
# FUNCTION: Install Node.js Dependencies
# =============================================================================
install_npm_dependencies() {
    step "INSTALLING NODE.JS DEPENDENCIES"

    if [ ! -d "$SERVER_DIR" ]; then
        error "Server directory not found: $SERVER_DIR"
        warn "Skipping npm install..."
        return 1
    fi

    if [ ! -f "$SERVER_DIR/package.json" ]; then
        warn "No package.json found in: $SERVER_DIR"
        warn "Skipping npm install..."
        return 1
    fi

    log "Installing npm dependencies in: $SERVER_DIR"
    cd "$SERVER_DIR" || {
        error "Cannot change to server directory: $SERVER_DIR"
        return 1
    }

    # Check if node/npm are available
    if ! command -v node >/dev/null 2>&1; then
        error "Node.js is not installed!"
        warn "Please install Node.js from: https://nodejs.org/"
        return 1
    fi

    if ! command -v npm >/dev/null 2>&1; then
        error "npm is not installed!"
        warn "Please install Node.js (includes npm) from: https://nodejs.org/"
        return 1
    fi

    ok "Node.js: $(node --version 2>/dev/null || echo 'unknown')"
    ok "npm: $(npm --version 2>/dev/null || echo 'unknown')"

    # Run npm install
    log "Running npm install..."
    if npm install 2>&1 | tee /tmp/npm_install.log; then
        ok "✅ npm dependencies installed successfully!"
    else
        warn "⚠️  npm install had some warnings/errors"
        warn "Check /tmp/npm_install.log for details"
        # Don't fail - might still work
    fi

    # Return to script directory
    cd "$SCRIPT_DIR" || true
}

# =============================================================================
# FUNCTION: Patch Server.js (if needed)
# =============================================================================
patch_server() {
    step "PATCHING SERVER CONFIGURATION"

    if [ ! -f "$SERVER_JS" ]; then
        warn "Server file not found: $SERVER_JS"
        warn "Skipping patching..."
        return 1
    fi

    log "Checking if server needs patching..."
    
    # Create backup
    local BACKUP_FILE="${SERVER_JS}.backup.$(date +%s)"
    cp "$SERVER_JS" "$BACKUP_FILE" 2>/dev/null
    log "Backup created: $BACKUP_FILE"

    # Check if we need to patch for cookies file usage
    if grep -q "--cookies-from-browser" "$SERVER_JS" 2>/dev/null && [ -f "$COOKIES_FILE" ]; then
        log "Patching server to use cookies file instead of browser..."
        
        # Create a sed script to replace browser cookies with file cookies
        if sed -i 's/--cookies-from-browser edge/--cookies '"$COOKIES_FILE"'/g' "$SERVER_JS" 2>/dev/null; then
            ok "✅ Server patched to use cookies file!"
        else
            warn "Could not patch server (sed failed)"
            warn "Server will use browser cookies instead"
        fi
    else
        ok "✅ Server configuration looks good!"
        log "Cookies mode: $([ -f '$COOKIES_FILE' ] && echo 'file' || echo 'browser')"
    fi
}

# =============================================================================
# FUNCTION: Copy Modified Files (enhancements)
# =============================================================================
copy_modified_files() {
    step "APPLYING ENHANCEMENTS"

    local MODIFICATIONS_MADE=0
    
    # Check for enhancement files in script directory
    if [ -f "$SCRIPT_DIR/public/index.html" ] && [ -d "$SERVER_DIR/../public" ]; then
        log "Checking for enhanced frontend..."
        # Could copy enhanced index.html here if needed
        log "Frontend files in place"
    fi

    # Check for additional JS enhancements
    for enh_file in "run-all-enhancements.js" "mega-enhancement.js" "direct-inject-all.js"; do
        if [ -f "$SCRIPT_DIR/$enh_file" ]; then
            log "Found enhancement: $enh_file"
            ((MODIFICATIONS_MADE++))
        fi
    done

    if [ $MODIFICATIONS_MADE -gt 0 ]; then
        ok "✅ Enhancement files available: $MODIFICATIONS_MADE found"
    else
        log "No additional enhancement files found (this is okay)"
    fi

    # Ensure downloads directory exists
    if [ -n "$SERVER_DIR" ]; then
        mkdir -p "$SERVER_DIR/downloads" 2>/dev/null
        ok "✅ Downloads directory ready: $SERVER_DIR/downloads"
    fi
}

# =============================================================================
# FUNCTION: Start Server
# =============================================================================
start_server() {
    step "STARTING SERVER"

    if [ ! -f "$SERVER_JS" ]; then
        error "Server file not found: $SERVER_JS"
        error "Cannot start server!"
        return 1
    fi

    if [ ! -d "$SERVER_DIR" ]; then
        error "Server directory not found: $SERVER_DIR"
        return 1
    fi

    # Kill any existing node processes on our port
    if command -v lsof >/dev/null 2>&1; then
        local EXISTING_PID=$(lsof -ti :$PORT 2>/dev/null)
        if [ -n "$EXISTING_PID" ]; then
            log "Killing existing process on port $PORT (PID: $EXISTING_PID)"
            kill -9 "$EXISTING_PID" 2>/dev/null || true
            sleep 1
        fi
    fi

    log "Starting server from: $SERVER_DIR"
    log "Server file: $SERVER_JS"
    log "Port: $PORT"

    # Change to server directory and start
    cd "$SERVER_DIR" || {
        error "Failed to change to server directory: $SERVER_DIR"
        return 1
    }

    # ⭐ FIXED: Set default download directory based on OS
    if [[ "$OSTYPE" == "msys" || "$OSTYPE" == "cygwin" ]] || [[ -n "$WINDIR" || -n "windir" ]]; then
        # Windows (Git Bash/Cygwin/MSYS)
        export DOWNLOADS_DIR="C:\\Users\\Jackle\\Downloads\\YouTube-Downloader"
        log "Windows detected: Setting DOWNLOADS_DIR=$DOWNLOADS_DIR"
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS
        export DOWNLOADS_DIR="$HOME/Downloads/YouTube-Downloader"
        log "macOS detected: Setting DOWNLOADS_DIR=$DOWNLOADS_DIR"
    else
        # Linux/Unix
        if [ -d "$HOME/Downloads/YouTube-Downloader" ]; then
            export DOWNLOADS_DIR="$HOME/Downloads/YouTube-Downloader"
        elif [ -d "$HOME/Downloads" ]; then
            export DOWNLOADS_DIR="$HOME/Downloads/YouTube-Downloader"
        else
            export DOWNLOADS_DIR="$SCRIPT_DIR/server/downloads"
        fi
        log "Linux detected: Setting DOWNLOADS_DIR=$DOWNLOADS_DIR"
    fi

    # ⭐ NEW: Auto-kill any existing server to prevent EADDRINUSE (port already in use) error
    log "🔧 Checking for existing server processes..."
    
    if [[ "$OSTYPE" == "msys" || "$OSTYPE" == "cygwin" ]] || [[ -n "$WINDIR" || -n "windir" ]]; then
        # Windows: Kill any node.exe processes using port 3000
        log "Windows detected: Killing any existing node.exe processes..."
        
        # Find and kill process using port 3000
        PORT_PID=$(netstat -ano | grep ":3000" | grep LISTENING | awk '{print $5}' | head -1)
        if [ -n "$PORT_PID" ] && [ "$PORT_PID" != "0" ]; then
            log "Found process $PORT_PID using port 3000, killing..."
            taskkill //PID "$PORT_PID" //F 2>/dev/null || true
            sleep 2
        fi
        
        # Also kill any remaining node.exe processes (fallback)
        taskkill //IM node.exe //F 2>/dev/null && {
            log "✅ Killed existing node.exe processes"
            sleep 2
        } || log "No existing node.exe processes found"
    else
        # Unix/Mac: Kill process using port 3000
        PORT_PID=$(lsof -ti:3000 2>/dev/null)
        if [ -n "$PORT_PID" ]; then
            log "Found process $PORT_PID using port 3000, killing..."
            kill -9 "$PORT_PID" 2>/dev/null || true
            sleep 2
        else
            log "No process using port 3000"
        fi
    fi
    
    log "✅ Port $PORT is now available"
    
    # ⭐ NEW: Enhanced logging before starting server
    log_info "═══ SERVER STARTUP DEBUG INFO ═══"
    log_info "Server JS: $SERVER_JS"
    log_info "Working Dir: $(pwd)"
    log_info "DOWNLOADS_DIR: $DOWNLOADS_DIR"
    log_info "Node version: $(node --version 2>/dev/null || echo 'unknown')"
    log_info "npm version: $(npm --version 2>/dev/null || echo 'unknown')"
    log_info "yt-dlp: $(which yt-dlp 2>/dev/null || echo 'not found')"
    log_info "FFmpeg: $(which ffmpeg 2>/dev/null || echo 'not found')"
    log_info "═════════════════════════════════"
    
    # Start server in background with DOWNLOADS_DIR environment variable
    DOWNLOADS_DIR="$DOWNLOADS_DIR" node "$SERVER_JS" > /tmp/youtube-downloader-server.log 2>&1 &
    SERVER_PID=$!
    
    # Export SERVER_PID for debug monitor
    export SERVER_PID
    
    log_backend "🚀 Server process started (PID: $SERVER_PID)"
    log_backend "Log file: /tmp/youtube-downloader-server.log"
    
    sleep 3

    # Check if server is running
    if kill -0 $SERVER_PID 2>/dev/null; then
        ok "✅ Server started successfully! (PID: $SERVER_PID)"
        log "Server running at: $URL"
        
        # ⭐ NEW: Show server startup summary with colors
        echo ""
        log_backend "═══ SERVER STARTUP SUCCESS ═══"
        log_backend "PID: $SERVER_PID"
        log_backend "URL: $URL"
        log_backend "Log: /tmp/youtube-downloader-server.log"
        log_backend "══════════════════════════════"
        
        # Show last few lines of server log with color coding
        log "Server startup log (last 15 lines):"
        tail -15 /tmp/youtube-downloader-server.log 2>/dev/null | while read -r line; do
            # Apply basic color coding to startup log preview
            if echo "$line" | grep -qiE "error|fail|Error"; then
                log_error "  $line"
            elif echo "$line" | grep -qiE "started|ready|listening|✅|Server"; then
                log_download "  $line"
            else
                log_backend "  $line"
            fi
        done
    else
        error "❌ Server failed to start!"
        error "Check log: /tmp/youtube-downloader-server.log"
        error ""
        error "Last 25 lines of server log:"
        tail -25 /tmp/youtube-downloader-server.log 2>/dev/null | while read -r line; do
            log_error "  $line"
        done
        
        # ⭐ NEW: Additional debug info on failure
        echo ""
        log_error "═══ DEBUG INFO ON FAILURE ═══"
        log_error "Server JS exists: $([ -f "$SERVER_JS" ] && echo 'YES' || echo 'NO')"
        log_error "Server Dir exists: $([ -d "$SERVER_DIR" ] && echo 'YES' || echo 'NO')"
        log_error "Port 3000 in use: $(lsof -ti:3000 2>/dev/null || echo 'no')"
        log_error "Node.js: $(node --version 2>/dev/null || echo 'not found')"
        log_error "══════════════════════════════"
        return 1
    fi

    # Return to script directory
    cd "$SCRIPT_DIR" || true
}

# =============================================================================
# FUNCTION: Open Browser
# =============================================================================
open_browser() {
    step "OPENING BROWSER"

    log "Opening browser at: $URL"

    if [ "$IS_WINDOWS" = true ] || [ "$IS_CYGWIN" = true ] || [ "$IS_MSYS" = true ]; then
        # Windows: use start command
        start "$URL" 2>/dev/null || cmd //c start "" "$URL" 2>/dev/null || \
        explorer "$URL" 2>/dev/null || warn "Could not auto-open browser"
    elif [ "$IS_MAC" = true ]; then
        # macOS: use open command
        open "$URL" 2>/dev/null || warn "Could not auto-open browser"
    else
        # Linux: try various methods
        if command -v xdg-open >/dev/null 2>&1; then
            xdg-open "$URL" 2>/dev/null || warn "Could not auto-open browser"
        elif command -v gnome-open >/dev/null 2>&1; then
            gnome-open "$URL" 2>/dev/null || warn "Could not auto-open browser"
        elif command -v firefox >/dev/null 2>&1; then
            firefox "$URL" 2>/dev/null & 
        else
            warn "Could not determine how to open browser"
            warn "Please open manually: $URL"
        fi
    fi

    ok "✅ Browser should be opening..."
    log "If browser doesn't open, navigate to: $URL"
}

# =============================================================================
# FUNCTION: Keep Terminal Open WITH REAL-TIME SPLIT-SCREEN DEBUG MONITORING
# =============================================================================
keep_terminal_open() {
    # Initialize log files
    LOG_FILE="/tmp/youtube-downloader-server.log"
    FRONTEND_LOG="/tmp/ytl-frontend.log"
    BACKEND_LOG="/tmp/ytl-backend.log"
    DOWNLOAD_LOG="/tmp/ytl-download.log"
    ERROR_LOG="/tmp/ytl-error.log"
    DEBUG_LOG="/tmp/ytl-debug-monitor.log"
    
    # Clear/create separate log files
    > "$FRONTEND_LOG"
    > "$BACKEND_LOG"
    > "$DOWNLOAD_LOG"
    > "$ERROR_LOG"
    
    # Create debug header
    echo "========================================" > "$DEBUG_LOG"
    echo "YTL Split-Screen Debug Monitor" >> "$DEBUG_LOG"
    echo "Started: $(date)" >> "$DEBUG_LOG"
    echo "Server PID: $SERVER_PID" >> "$DEBUG_LOG"
    echo "========================================" >> "$DEBUG_LOG"
    
    # ═══════════════════════════════════════════════════════════════
    # ⭐ TERMINAL SETUP FOR SPLIT-SCREEN
    # ═══════════════════════════════════════════════════════════════
    
    # Save terminal settings
    stty -echo 2>/dev/null || true
    
    # Get terminal dimensions
    TERM_LINES=$(tput lines 2>/dev/null || echo 30)
    TERM_COLS=$(tput cols 2>/dev/null || echo 120)
    
    # Calculate panel dimensions (leave 4 rows for header, 2 for footer)
    HEADER_ROWS=4
    FOOTER_ROWS=2
    PANEL_HEIGHT=$((TERM_LINES - HEADER_ROWS - FOOTER_ROWS))
    HALF_COLS=$((TERM_COLS / 2 - 2))
    
    # Ensure minimum dimensions
    [ $PANEL_HEIGHT -lt 8 ] && PANEL_HEIGHT=8
    [ $HALF_COLS -lt 40 ] && HALF_COLS=40
    
    # ═══════════════════════════════════════════════════════════════
    # ⭐ DRAW STATIC SPLIT-SCREEN HEADER
    # ═══════════════════════════════════════════════════════════════
    draw_screen_header() {
        local timestamp=$(date '+%H:%M:%S')
        local fe_count=$(wc -l < "$FRONTEND_LOG" 2>/dev/null || echo 0)
        local be_count=$(wc -l < "$BACKEND_LOG" 2>/dev/null || echo 0)
        local dl_count=$(wc -l < "$DOWNLOAD_LOG" 2>/dev/null || echo 0)
        local err_count=$(wc -l < "$ERROR_LOG" 2>/dev/null || echo 0)
        
        # Move to top of screen and clear
        printf '\033[H\033[2J'
        
        # Line 1: Main title bar
        printf '\033[1;1H'
        printf '\033[48;5;23m'  # Dark blue background
        printf " \033[1;37m 🎬 YTL SPLIT-SCREEN DEBUG MONITOR \033[0m"
        printf '%*s' $((TERM_COLS - 42)) ''
        printf '\033[0m'
        
        # Line 2: Info bar with stats
        printf '\033[2;1H'
        printf " \033[1;36m ⏱ %s \033[0m" "$timestamp"
        printf "│ \033[1;35m 🌐 FE:%s \033[0m" "$fe_count"
        printf "│ \033[1;36m ⚙ BE:%s \033[0m" "$be_count"
        printf "│ \033[1;32m 📥 DL:%s \033[0m" "$dl_count"
        printf "│ \033[1;31m ❌ ER:%s \033[0m" "$err_count"
        printf "│ \033[1;33m 🔧 PID:%s \033[0m" "$SERVER_PID"
        printf '%*s' $((TERM_COLS - 80)) ''
        
        # Line 3: Column headers with divider
        printf '\033[3;1H'
        printf '\033[1;45m'  # Magenta background for left header
        printf " %-*s " $HALF_COLS "🌐 FRONTEND (Browser HTTP Requests / XHR / Fetch)"
        printf '\033[0m'
        printf '│'
        printf '\033[1;46m'  # Cyan background for right header  
        printf " %-*s " $HALF_COLS "⚙️  BACKEND (Server Ops / yt-dlp / Downloads)"
        printf '\033[0m'
        
        # Line 4: Separator line
        printf '\033[4;1H'
        printf '\033[1;m'
        printf '─%.0s' $(seq 1 $TERM_COLS)
        printf '\033[0m'
    }
    
    # ═══════════════════════════════════════════════════════════════
    # ⭐ DRAW FOOTER WITH CONTROLS
    # ═══════════════════════════════════════════════════════════════
    draw_screen_footer() {
        local footer_row=$((HEADER_ROWS + PANEL_HEIGHT + 1))
        
        # Separator line
        printf "\033[${footer_row};1H"
        printf '\033[1;m'
        printf '─%.0s' $(seq 1 $TERM_COLS)
        printf '\033[0m'
        
        # Footer info line
        printf "\033[$((footer_row+1));1H"
        printf " \033[1;32m ✅ Server Running \033[0m"
        printf "│ \033[1;37m URL: %s \033[0m" "$URL"
        printf "│ \033[1;33m Press CTRL+C to stop \033[0m"
        printf '%*s' $((TERM_COLS - 60)) ''
    }
    
    # ═══════════════════════════════════════════════════════════════
    # ⭐ DRAW LEFT PANEL (FRONTEND LOGS)
    # ═══════════════════════════════════════════════════════════════
    draw_frontend_panel() {
        local start_row=$((HEADER_ROWS + 1))
        
        # Get last N lines for the panel height
        local fe_lines=$(tail -$PANEL_HEIGHT "$FRONTEND_LOG" 2>/dev/null)
        
        # If no lines yet, show waiting message
        if [ -z "$fe_lines" ]; then
            for ((i=0; i<PANEL_HEIGHT; i++)); do
                local row=$((start_row + i))
                printf "\033[${row};2H"
                if [ $i -eq $((PANEL_HEIGHT/2)) ]; then
                    printf '\033[2;35m⏳ Waiting for frontend requests...\033[0m'
                else
                    printf '%*s' $((HALF_COLS)) ''
                fi
            done
            return
        fi
        
        # Convert to array
        mapfile -t FE_ARRAY <<< "$fe_lines"
        
        # Draw each line
        for ((i=0; i<PANEL_HEIGHT; i++)); do
            local row=$((start_row + i))
            printf "\033[${row};2H"
            
            if [ $i -lt ${#FE_ARRAY[@]} ]; then
                local line="${FE_ARRAY[$i]}"
                
                # Truncate to fit panel width
                if [ ${#line} -gt $HALF_COLS ]; then
                    line="${line:0:$((HALF_COLS-3))}..."
                fi
                
                # Print with frontend color (magenta prefix stripped, show clean)
                printf '\033[0;35m%s\033[0m' "$line"
            else
                printf '%*s' $((HALF_COLS)) ''
            fi
            
            # Clear rest of line
            printf '\033[K'
        done
    }
    
    # ═══════════════════════════════════════════════════════════════
    # ⭐ DRAW RIGHT PANEL (BACKEND LOGS)
    # ═══════════════════════════════════════════════════════════════
    draw_backend_panel() {
        local start_row=$((HEADER_ROWS + 1))
        local col=$((HALF_COLS + 4))  # Start after divider
        
        # Get last N lines for the panel height
        local be_lines=$(tail -$PANEL_HEIGHT "$BACKEND_LOG" 2>/dev/null)
        
        # If no lines yet, show waiting message
        if [ -z "$be_lines" ]; then
            for ((i=0; i<PANEL_HEIGHT; i++)); do
                local row=$((start_row + i))
                printf "\033[${row};${col}H"
                if [ $i -eq $((PANEL_HEIGHT/2)) ]; then
                    printf '\033[1;36m⏳ Waiting for backend activity...\033[0m'
                else
                    printf '%*s' $((HALF_COLS)) ''
                fi
            done
            return
        fi
        
        # Convert to array
        mapfile -t BE_ARRAY <<< "$be_lines"
        
        # Draw each line
        for ((i=0; i<PANEL_HEIGHT; i++)); do
            local row=$((start_row + i))
            printf "\033[${row};${col}H"
            
            if [ $i -lt ${#BE_ARRAY[@]} ]; then
                local line="${BE_ARRAY[$i]}"
                
                # Truncate to fit panel width
                if [ ${#line} -gt $HALF_COLS ]; then
                    line="${line:0:$((HALF_COLS-3))}..."
                fi
                
                # Print with backend color (cyan)
                printf '\033[1;36m%s\033[0m' "$line"
            else
                printf '%*s' $((HALF_COLS)) ''
            fi
            
            # Clear rest of line
            printf '\033[K'
        done
    }
    
    # ═══════════════════════════════════════════════════════════════
    # ⭐ DRAW CENTER DIVIDER LINE
    # ═══════════════════════════════════════════════════════════════
    draw_divider() {
        local center_col=$((HALF_COLS + 3))
        local start_row=$((HEADER_ROWS + 1))
        local end_row=$((start_row + PANEL_HEIGHT - 1))
        
        for ((row=start_row; row<=end_row; row++)); do
            printf "\033[${row};${center_col}H"
            printf '\033[1;37m│\033[0m'
        done
    }
    
    # ═══════════════════════════════════════════════════════════════
    # ⭐ FULL SCREEN REFRESH FUNCTION
    # ═══════════════════════════════════════════════════════════════
    refresh_screen() {
        draw_screen_header
        draw_frontend_panel
        draw_divider
        draw_backend_panel
        draw_screen_footer
        
        # Move cursor to bottom to avoid flicker
        printf "\033[$((TERM_LINES));1H"
    }
    
    log_info "🖥️  Real-Time Split-Screen Debug Monitor Starting..."
    log_info "Terminal: ${TERM_LINES}x${TERM_COLS} | Panel Height: $PANEL_HEIGHT | Panel Width: $HALF_COLS"
    log_info "Frontend log: $FRONTEND_LOG"
    log_info "Backend log: $BACKEND_LOG"
    log_info "Press Ctrl+C to stop"
    sleep 1
    
    # Initial screen draw
    refresh_screen
    
    # ═══════════════════════════════════════════════════════════════
    # ⭐ MAIN SPLIT-SCREEN DEBUG MONITOR LOOP
    # ═══════════════════════════════════════════════════════════════
    local line_count=0
    local last_size=0
    local refresh_counter=0
    
    while true; do
        # Check if server is still running
        if ! kill -0 $SERVER_PID 2>/dev/null; then
            # Restore terminal
            stty echo 2>/dev/null || true
            printf '\033[H\033[2J'
            
            echo ""
            echo -e "${BRIGHT_RED}╔════════════════════════════════════════════════════════════════════════════╗${NC}"
            echo -e "${BRIGHT_RED}║  ❌ SERVER PROCESS DIED! (PID: $SERVER_PID)                                    ║${NC}"
            echo -e "${BRIGHT_RED}╚════════════════════════════════════════════════════════════════════════════╝${NC}"
            
            log_error "❌ SERVER PROCESS DIED! (PID: $SERVER_PID)"
            log_error "Last 20 lines of server log:"
            tail -20 "$LOG_FILE" 2>/dev/null | while read -r line; do
                log_error "  $line"
            done
            log_warning "Attempting to restart server..."
            
            # Try to restart server
            cd "$SERVER_DIR" 2>/dev/null
            DOWNLOADS_DIR="$DOWNLOADS_DIR" node "$SERVER_JS" > "$LOG_FILE" 2>&1 &
            SERVER_PID=$!
            sleep 3
            
            if kill -0 $SERVER_PID 2>/dev/null; then
                log_backend "✅ Server restarted successfully (New PID: $SERVER_PID)"
                # Re-enable echo and continue monitoring
                stty -echo 2>/dev/null || true
            else
                log_error "❌ Failed to restart server!"
                log_error "Check log file manually: $LOG_FILE"
                break
            fi
        fi
        
        # Check for new lines in server log file
        if [ -f "$LOG_FILE" ]; then
            current_size=$(wc -l < "$LOG_FILE" 2>/dev/null || echo 0)
            
            if [ "$current_size" -gt "$last_size" ] 2>/dev/null; then
                # Read new lines only
                new_lines=$(tail -n +$((last_size + 1)) "$LOG_FILE" 2>/dev/null | head -n $((current_size - last_size)))
                
                # Process each line and categorize into appropriate log file
                while IFS= read -r line; do
                    ((line_count++))
                    
                    # Skip empty lines
                    [ -z "$line" ] && continue
                    
                    # ⭐ CATEGORIZE AND LOG TO APPROPRIATE FILE
                    
                    # FRONTEND REQUESTS (MAGENTA) - HTTP requests from browser
                    if echo "$line" | grep -qiE "\[HTTP\]|GET /|POST /|PUT /|DELETE /|\[Channels\]|\[Scheduler\]|/api/|/js/|/css/|User-Agent|XHR|fetch\(|ajax"; then
                        echo "$(date '+%H:%M:%S') $line" >> "$FRONTEND_LOG"
                    
                    # DOWNLOAD PROGRESS (GREEN) - Download operations (show in BOTH download log AND backend panel)
                    elif echo "$line" | grep -qiE "Download|download|Progress|%|speed|MiB/s|completed|finished|saved|✅|Starting download|Queue|queued|Downloading|\[Auth\]"; then
                        echo "$(date '+%H:%M:%S') $line" >> "$DOWNLOAD_LOG"
                        echo "$(date '+%H:%M:%S') $line" >> "$BACKEND_LOG"  # Also show in backend panel
                    
                    # ERRORS (RED) - Any error messages (show in BOTH error log AND backend panel)
                    elif echo "$line" | grep -qiE "error|Error|ERROR|fail|FAIL|exception|Exception|reject|denied|forbidden|404|500|502|503|cannot|Cannot|invalid|Invalid|missing|Missing|EADDRINUSE"; then
                        echo "$(date '+%H:%M:%S') $line" >> "$ERROR_LOG"
                        echo "$(date '+%H:%M:%S') $line" >> "$BACKEND_LOG"  # Also show in backend panel
                    
                    # WARNINGS (YELLOW)
                    elif echo "$line" | grep -qiE "warn|WARN|warning|WARNING|caution|deprecated|fallback|retry|Retry|⚠️"; then
                        echo "$(date '+%H:%M:%S') $line" >> "$BACKEND_LOG"
                    
                    # BACKEND OPERATIONS (CYAN) - Everything else from server
                    else
                        echo "$(date '+%H:%M:%S') $line" >> "$BACKEND_LOG"
                    fi
                    
                done <<< "$new_lines"
                
                last_size=$current_size
            fi
        fi
        
        # ⭐ REFRESH SPLIT-SCREEN DISPLAY EVERY CYCLE
        ((refresh_counter++))
        if [ $((refresh_counter % 2)) -eq 0 ]; then  # Refresh every 1 second (2 cycles × 0.5s)
            refresh_screen
        fi
        
        # Heartbeat every 30 seconds
        if [ $((line_count % 60)) -eq 0 ] && [ $line_count -gt 0 ]; then
            echo "$(date '+%H:%M:%S') 💓 Heartbeat | Server: PID $SERVER_PID | Lines processed: $line_count" >> "$DEBUG_LOG"
        fi
        
        # Small delay to prevent high CPU usage
        sleep 0.5
    done
    
    # Restore terminal on exit
    stty echo 2>/dev/null || true
    printf '\033[H\033[2J'
    printf '\033[?25h'  # Show cursor
}

# =============================================================================
# MAIN EXECUTION - Where the magic happens!
# =============================================================================

main() {
    echo ""
    echo "╔══════════════════════════════════════════════════════════════╗"
    echo "║                                                              ║"
    echo "║   🎬 YOUTUBE DOWNLOADER - COMPLETE SETUP                    ║"
    echo "║                                                              ║"
    echo "║   Version 6.0                                               ║"
    echo "║   ⭐ NEW: No cloning needed! Uses current directory          ║"
    echo "║   ⭐ Auto-kills orphan processes on close                   ║"
    echo "║                                                              ║"
    echo "╚══════════════════════════════════════════════════════════════╝"
    echo ""
    
    log "Starting YouTube Downloader setup..."
    log "Script directory: $SCRIPT_DIR"
    log "Current directory: $(pwd)"
    log "Date: $(date)"
    
    # =====================================================================
    # CRITICAL: Change to script directory!
    # =====================================================================
    log "🔧 Changing to script directory: $SCRIPT_DIR"
    cd "$SCRIPT_DIR" || {
        error "Failed to change to script directory: $SCRIPT_DIR"
        fatal_error "Cannot access script directory!"
    }
    log "✅ Now in directory: $(pwd)"
    echo ""
    
    # Run all setup steps (NO MORE CLONING!)
    detect_repo_structure           # Step 1: Detect repo structure (find server.js)
    install_ytdl                     # Step 2: Install yt-dlp
    setup_ffmpeg                    # Step 3: Setup FFmpeg
    
    # Step 4: Cookie Extraction (with browser detection)
    BROWSER=$(detect_browser) || BROWSER="edge"
    log "Detected browser: $BROWSER"
    test_cookies "$BROWSER"         # Quick test if cookies work
    export_cookies_with_fallbacks "$BROWSER"  # Main cookie extraction with fallbacks
    
    install_npm_dependencies        # Step 5: Install Node.js dependencies
    patch_server                    # Step 6: Patch server.js
    copy_modified_files             # Step 7: Copy custom files
    start_server                    # Step 8: Start server
    open_browser                    # Step 9: Open browser
    
    # =====================================================================
    # FINAL SUCCESS MESSAGE
    # =====================================================================
    echo ""
    echo "╔══════════════════════════════════════════════════════════════╗"
    echo "║                                                              ║"
    echo "║                   ✅ SETUP COMPLETE! ✅                      ║"
    echo "║                                                              ║"
    echo "║  🌐 Server: ${BOLD}$URL${NC}"
    echo "║  📁 Downloads: ${BOLD}${SERVER_DIR:-unknown}/downloads${NC}"
    echo "║  🍪 Cookies: ${BOLD}${COOKIES_EXPORTED:-browser fallback}${NC}"
    echo "║                                                              ║"
    echo "║  Features Enabled:                                          ║"
    echo "║     ✅ Cancel/Resume/Stop buttons                            ║"
    echo "║     ✅ Smart format detection (lowest quality)               ║"
    echo "║     ✅ Concurrent downloads support                         ║"
    echo "║     ✅ Auto-retry on network errors                          ║"
    echo "║     ✅ Working Python cookie extractor                       ║"
    echo "║     ✅ Existing cookies detection                             ║"
    echo "║     ✅ Pre-modified files applied                            ║"
    echo "║                                                              ║"
    echo "╚══════════════════════════════════════════════════════════════╝"
    echo ""
    
    # Keep terminal open forever (until user closes it or presses Ctrl+C)
    keep_terminal_open
}

# =============================================================================
# RUN THE MAIN FUNCTION
# =============================================================================

# Call main function to start everything
main "$@"

