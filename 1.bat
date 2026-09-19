@echo off
setlocal DisableDelayedExpansion
chcp 65001 >nul 2>&1 || chcp 437 >nul 2>&1

REM =========================================================================
REM  YouTube Downloader - Windows Bootstrap + Embedded Bash Runtime
REM  Version 19.0  (banner-highlighted success/failure + CDP-first cookies)
REM
REM  Usage:
REM    1.bat                 Normal run
REM    1.bat --fresh         Ignore checkpoints
REM    1.bat --no-install    Skip dependency installer
REM    1.bat --debug         Verbose tracing
REM    1.bat --keep-logs     Keep *.log files on exit
REM    1.bat --setup-cdp     Open Edge with debug profile for initial sign-in
REM
REM  NEW in v19.0:
REM    - Server stdout is piped through a live line-filter that prints
REM      full-width colored boxes on SUCCESS / FAILURE / WARNING events.
REM    - server.log still receives the raw, unfiltered Node output.
REM =========================================================================

set "SCRIPT_DIR=%~dp0"
if "%SCRIPT_DIR:~-1%"=="\" set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"

set "BASH_EXE="
set "BASH_TMP=%SCRIPT_DIR%\.1sh_runtime.sh"
set "PS_HELPER=%TEMP%\.1sh_extract.ps1"
set "PG_DIR=%SCRIPT_DIR%\tools\git"
set "PG_DEST=%SCRIPT_DIR%\PortableGit.7z.exe"
set "PG_URL=https://github.com/git-for-windows/git/releases/latest/download/PortableGit-64-bit.7z.exe"

echo.
echo +==============================================================+
echo ^|   YOUTUBE DOWNLOADER - WINDOWS BOOTSTRAP                     ^|
echo ^|   Version 19.0  (banner highlights + CDP cookies)            ^|
echo +==============================================================+
echo.
echo [i] Invoked as : %~nx0
echo [i] Args       : %*
echo [i] Working dir: %CD%
echo [i] Script dir : %SCRIPT_DIR%
echo.

REM =========================================================================
REM  STEP 1: Locate real bash.exe
REM =========================================================================
echo [1/4] Searching for bash.exe...

call :find_bash
if defined BASH_EXE goto :bash_ready

echo     No valid bash.exe found. Attempting installation.
goto :install_git


:find_bash
set "BASH_EXE="
for %%P in (
    "%ProgramFiles%\Git\bin\bash.exe"
    "%ProgramFiles(x86)%\Git\bin\bash.exe"
    "%LOCALAPPDATA%\Programs\Git\bin\bash.exe"
    "%USERPROFILE%\scoop\apps\git\current\bin\bash.exe"
    "C:\msys64\usr\bin\bash.exe"
    "C:\cygwin64\bin\bash.exe"
    "C:\cygwin\bin\bash.exe"
    "%PG_DIR%\bin\bash.exe"
) do (
    if exist %%P (
        set "BASH_EXE=%%~P"
        goto :eof
    )
)
call :find_bash_in_path
goto :eof


:find_bash_in_path
setlocal EnableDelayedExpansion
for %%P in (bash.exe) do (
    set "CAND=%%~$PATH:P"
    if not "!CAND!"=="" (
        set "SKIP=0"
        echo !CAND! | findstr /i /c:"WindowsApps" >nul && set "SKIP=1"
        echo !CAND! | findstr /i /c:"System32"    >nul && set "SKIP=1"
        echo !CAND! | findstr /i /c:"\wsl"        >nul && set "SKIP=1"
        if "!SKIP!"=="0" (
            endlocal & set "BASH_EXE=!CAND!"
            goto :eof
        )
    )
)
endlocal
goto :eof


REM =========================================================================
REM  SUBROUTINE: cleanup_temp_files
REM =========================================================================
:cleanup_temp_files
del "%SCRIPT_DIR%\.1sh_runtime.sh"         >nul 2>&1
del "%SCRIPT_DIR%\.1sh.state"              >nul 2>&1
del "%SCRIPT_DIR%\.1sh.pids"               >nul 2>&1
del "%SCRIPT_DIR%\.ps-install.log"         >nul 2>&1
del "%SCRIPT_DIR%\.pathdump.tmp"           >nul 2>&1
del "%SCRIPT_DIR%\export_cookies_fixed.py" >nul 2>&1
del "%SCRIPT_DIR%\.extract_cookies.py"     >nul 2>&1
del "%SCRIPT_DIR%\.openbrowser.ps1"        >nul 2>&1
del "%SCRIPT_DIR%\npm_install.log"         >nul 2>&1
del "%TEMP%\.1sh_extract.ps1"              >nul 2>&1
del "%SCRIPT_DIR%\.ytdlp_cookies.tmp"      >nul 2>&1
del "%SCRIPT_DIR%\.pycookiecheat_out.tmp"  >nul 2>&1

del "%SCRIPT_DIR%\cookies.txt"             >nul 2>&1
del "%SCRIPT_DIR%\server\cookies.txt"      >nul 2>&1

del "%SCRIPT_DIR%\.runtool.*.out"          >nul 2>&1
del "%SCRIPT_DIR%\cookies.txt.bak.*"       >nul 2>&1
del "%SCRIPT_DIR%\cookies.txt.backup.*"    >nul 2>&1
del "%SCRIPT_DIR%\server\cookies.txt.bak.*"    >nul 2>&1
del "%SCRIPT_DIR%\server\cookies.txt.backup.*" >nul 2>&1
del "%SCRIPT_DIR%\server.js.backup.*"      >nul 2>&1
del "%SCRIPT_DIR%\server.js.bak.*"         >nul 2>&1
del "%SCRIPT_DIR%\server\server.js.backup.*" >nul 2>&1
del "%SCRIPT_DIR%\server\server.js.bak.*"    >nul 2>&1
del "%SCRIPT_DIR%\*.log.bak.*"             >nul 2>&1

echo %* | findstr /i /c:"--keep-logs" >nul
if errorlevel 1 (
    del "%SCRIPT_DIR%\1sh.log"     >nul 2>&1
    del "%SCRIPT_DIR%\cleanup.log" >nul 2>&1
    del "%SCRIPT_DIR%\server.log"  >nul 2>&1
)
goto :eof


REM =========================================================================
REM  STEP 2: Install Git Bash via winget
REM =========================================================================
:install_git
echo.
echo [2/4] Installing Git Bash via winget...

set "WINGET_OK=0"
where winget >nul 2>&1
if %errorlevel%==0 set "WINGET_OK=1"

set "WG_RC=1"
setlocal EnableDelayedExpansion
if "!WINGET_OK!"=="1" (
    echo     Running: winget install Git.Git
    winget install --id Git.Git -e --source winget ^
        --accept-package-agreements --accept-source-agreements --silent
    set "WG_RC=!errorlevel!"
) else (
    echo     winget not available.
    set "WG_RC=1"
)
endlocal & set "WG_RC=%WG_RC%"

if "%WINGET_OK%"=="1" if "%WG_RC%"=="0" (
    echo     winget returned success. Waiting 6 seconds...
    timeout /t 6 /nobreak >nul
    call :find_bash
    if defined BASH_EXE (
        echo     Found after install: %BASH_EXE%
        goto :bash_ready
    )
    echo     winget reported success but bash.exe not yet visible.
    echo     Close and reopen this window, then run 1.bat again.
    pause
    exit /b 1
)
if "%WINGET_OK%"=="1" if not "%WG_RC%"=="0" (
    echo     winget install failed ^(exit code %WG_RC%^)
)

echo.
echo     Trying PortableGit direct download...
set "DL_OK=0"

where curl >nul 2>&1
if %errorlevel%==0 (
    echo     Downloading via curl...
    curl -L --fail --retry 2 --connect-timeout 20 -o "%PG_DEST%" "%PG_URL%"
    if %errorlevel%==0 set "DL_OK=1"
)

if "%DL_OK%"=="0" (
    where powershell >nul 2>&1
    if %errorlevel%==0 (
        echo     Downloading via PowerShell...
        powershell -NoProfile -Command ^
            "try { [Net.ServicePointManager]::SecurityProtocol = 'Tls12'; Invoke-WebRequest -Uri '%PG_URL%' -OutFile '%PG_DEST%' -UseBasicParsing; exit 0 } catch { exit 1 }"
        if %errorlevel%==0 set "DL_OK=1"
    )
)

if "%DL_OK%"=="0" goto :install_failed
if not exist "%PG_DEST%" goto :install_failed

echo     Extracting PortableGit to %PG_DIR% ...
if not exist "%PG_DIR%" mkdir "%PG_DIR%" >nul 2>&1
"%PG_DEST%" -y -o"%PG_DIR%" >nul 2>&1

if exist "%PG_DIR%\bin\bash.exe" (
    set "BASH_EXE=%PG_DIR%\bin\bash.exe"
    echo     PortableGit ready: %BASH_EXE%
    del "%PG_DEST%" >nul 2>&1
    goto :bash_ready
)

:install_failed
echo.
echo +==============================================================+
echo ^|  Could not install Git Bash automatically.                   ^|
echo ^|                                                              ^|
echo ^|  Install manually:                                           ^|
echo ^|    winget install --id Git.Git -e --source winget            ^|
echo ^|                                                              ^|
echo ^|  Or download from: https://git-scm.com/download/win          ^|
echo ^|                                                              ^|
echo ^|  Then run 1.bat again.                                       ^|
echo +==============================================================+
pause
exit /b 1


:bash_ready
echo     Using: %BASH_EXE%


REM =========================================================================
REM  STEP 3: Extract embedded bash script
REM =========================================================================
echo.
echo [3/4] Extracting embedded bash script...

call :cleanup_temp_files

> "%PS_HELPER%" echo $ErrorActionPreference = 'Stop'
>>"%PS_HELPER%" echo $bat = $env:BAT_PATH
>>"%PS_HELPER%" echo $out = $env:OUT_PATH
>>"%PS_HELPER%" echo $lines = Get-Content -LiteralPath $bat -Encoding UTF8
>>"%PS_HELPER%" echo $start = -1
>>"%PS_HELPER%" echo $end = -1
>>"%PS_HELPER%" echo for ($i = 0; $i -lt $lines.Count; $i++) {
>>"%PS_HELPER%" echo   if ($lines[$i] -match '^REM\s+BASH_SCRIPT_START\s*$') { $start = $i + 1 }
>>"%PS_HELPER%" echo   if ($lines[$i] -match '^REM\s+BASH_SCRIPT_END\s*$')   { $end   = $i - 1; break }
>>"%PS_HELPER%" echo }
>>"%PS_HELPER%" echo if ($start -lt 0) { Write-Error 'START marker missing'; exit 1 }
>>"%PS_HELPER%" echo if ($end   -lt 0) { Write-Error 'END marker missing';   exit 1 }
>>"%PS_HELPER%" echo $slice = $lines[$start..$end]
>>"%PS_HELPER%" echo $lf = [char]10
>>"%PS_HELPER%" echo $crlf = [string][char]13 + [string][char]10
>>"%PS_HELPER%" echo $joined = [string]::Join($lf, $slice)
>>"%PS_HELPER%" echo $text = $joined.Replace($crlf, $lf)
>>"%PS_HELPER%" echo $utf8 = New-Object System.Text.UTF8Encoding($false)
>>"%PS_HELPER%" echo [System.IO.File]::WriteAllText($out, $text, $utf8)
>>"%PS_HELPER%" echo Write-Host ('     Wrote ' + $slice.Count + ' lines to ' + $out)

set "BAT_PATH=%~f0"
set "OUT_PATH=%BASH_TMP%"

powershell -NoProfile -ExecutionPolicy Bypass -File "%PS_HELPER%"

if not exist "%BASH_TMP%" (
    echo     Extraction failed.
    del "%PS_HELPER%" >nul 2>&1
    pause
    exit /b 1
)
del "%PS_HELPER%" >nul 2>&1
echo     OK


REM =========================================================================
REM  STEP 4: Run embedded bash script
REM =========================================================================
echo.
echo [4/4] Running embedded bash script...
echo.

set "BASH_TMP_UNIX=%BASH_TMP:\=/%"
echo     bash path: %BASH_TMP_UNIX%
echo.

"%BASH_EXE%" "%BASH_TMP_UNIX%" %*
set "EXIT_CODE=%errorlevel%"

echo.
echo [i] Bash script exited with code %EXIT_CODE%

call :cleanup_temp_files

del "%BASH_TMP%" >nul 2>&1

echo.
if not "%EXIT_CODE%"=="0" (
    echo [!] Non-zero exit code - press any key to close.
) else (
    echo Press any key to close this window...
)
pause >nul

endlocal
if "%EXIT_CODE%"=="" set "EXIT_CODE=0"
exit /b %EXIT_CODE%

exit /b 0


REM =========================================================================
REM  BELOW: EMBEDDED BASH SCRIPT
REM =========================================================================
REM BASH_SCRIPT_START
#!/usr/bin/env bash
# -------------------------------------------------------------------------
#  Embedded runtime — v19.0
#  Dedicated debug profile + CDP-first cookie extraction
#  + live banner highlighting for Node stdout
# -------------------------------------------------------------------------

SCRIPT_DIR_EARLY="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLEANUP_LOG="$SCRIPT_DIR_EARLY/cleanup.log"
GRACEFUL_DELAY=0

export PYTHONIOENCODING=utf-8
export PYTHONUTF8=1

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR" 2>/dev/null || true

STATE_FILE="$SCRIPT_DIR/.1sh.state"
PID_FILE="$SCRIPT_DIR/.1sh.pids"
LOG_FILE="$SCRIPT_DIR/1sh.log"

SERVER_DIR=""
SERVER_JS=""
TOOLS_DIR="$SCRIPT_DIR/tools"
FFMPEG_DIR="$TOOLS_DIR/ffmpeg"
COOKIES_FILE="$SCRIPT_DIR/server/cookies.txt"
PORT=3000
URL="http://localhost:$PORT"
CDP_PORT=9222
CDP_URL="http://127.0.0.1:$CDP_PORT"

# ⭐ Resolve Windows user profile path correctly (v18 fix retained)
_win_user=""
if command -v cygpath >/dev/null 2>&1 && [ -n "$USERPROFILE" ]; then
    _win_user="$(cygpath -w "$USERPROFILE" 2>/dev/null || echo "")"
fi
if [ -z "$_win_user" ]; then
    _win_user="C:\\Users\\${USERNAME:-${USER:-Jackle}}"
fi
EDGE_DEBUG_PROFILE_WIN="${_win_user}\\EdgeDebugProfile"
EDGE_DEBUG_PROFILE_UNIX="$(cygpath -u "$EDGE_DEBUG_PROFILE_WIN" 2>/dev/null || echo "$SCRIPT_DIR/EdgeDebugProfile")"

FRESH_RUN=false
SKIP_INSTALL=false
DEBUG_MODE=false
KEEP_LOGS=false
SETUP_CDP=false
for arg in "$@"; do
    case "$arg" in
        --fresh)      FRESH_RUN=true ;;
        --no-install) SKIP_INSTALL=true ;;
        --debug)      DEBUG_MODE=true; set -x ;;
        --keep-logs)  KEEP_LOGS=true ;;
        --setup-cdp)  SETUP_CDP=true ;;
    esac
done

[ "$FRESH_RUN" = true ] && rm -f "$STATE_FILE"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

# Banner palette (bg + fg)
BG_GREEN='\033[42m'
BG_RED='\033[41m'
BG_YELLOW='\033[43m'
BG_CYAN='\033[46m'
FG_WHITE='\033[97m'
FG_BLACK='\033[30m'

_log() { echo "[$(date '+%F %T')] $*" >> "$LOG_FILE" 2>/dev/null || true; }
log()   { echo -e "${GREEN}[v]${NC} $*"; _log "INFO $*"; }
warn()  { echo -e "${YELLOW}[!]${NC} $*"; _log "WARN $*"; }
error() { echo -e "${RED}[x]${NC} $*"; _log "ERR  $*"; }
dbg()   { [ "$DEBUG_MODE" = true ] && echo -e "${BLUE}[.]${NC} $*"; _log "DBG  $*"; }
ok()    { echo -e "${CYAN}${BOLD}[OK]${NC} $*"; _log "OK   $*"; }
step()  { echo -e "\n${BOLD}${CYAN}━━━ $* ━━━${NC}"; _log "STEP $*"; }

# =========================================================================
# BANNER PRINTER — full-width colored box for important events
# =========================================================================
# Usage:   banner "SUCCESS" "DOWNLOAD SUCCESS" "Body line 1" "Body line 2"
# Types:   SUCCESS / ERROR / WARN / INFO
banner() {
    local kind="$1"; shift
    local title="$1"; shift

    local clr="" icon="" border=""

    case "$kind" in
        SUCCESS) clr="${BG_GREEN}${FG_WHITE}${BOLD}"; icon=" ✅ "; border="═" ;;
        ERROR)   clr="${BG_RED}${FG_WHITE}${BOLD}";   icon=" ❌ "; border="═" ;;
        WARN)    clr="${BG_YELLOW}${FG_BLACK}${BOLD}"; icon=" ⚠️ "; border="═" ;;
        *)       clr="${BG_CYAN}${FG_BLACK}${BOLD}";  icon=" ℹ️ "; border="═" ;;
    esac

    # Box width (inner text = WIDTH - 2 for the ║ borders)
    local WIDTH=70
    local inner=$((WIDTH - 2))

    # Helper: pad string to inner width (measures char count, not bytes)
    _pad() {
        local s="$1"
        # Strip ANSI for length
        local plain
        plain=$(printf '%s' "$s" | sed 's/\x1b\[[0-9;]*m//g')
        local len=${#plain}
        local pad=$((inner - len - 2))   # 2 = leading spaces inside ║
        if [ $pad -lt 0 ]; then pad=0; fi
        printf '  %s%*s' "$s" "$pad" ""
    }

    echo ""
    printf "╔"
    printf '═%.0s' $(seq 1 $((WIDTH - 2)))
    printf "╗\n"

    printf "${clr}║%s║${NC}\n" "$(_pad "${icon}${title}")"

    printf "╠"
    printf '═%.0s' $(seq 1 $((WIDTH - 2)))
    printf "╣\n"

    # Body lines (each arg becomes its own row)
    while [ $# -gt 0 ]; do
        local line="$1"; shift
        # Truncate to fit
        if [ ${#line} -gt $((inner - 2)) ]; then
            line="${line:0:$((inner - 2))}"
        fi
        printf "║%s║\n" "$(_pad "$line")"
    done

    printf "╚"
    printf '═%.0s' $(seq 1 $((WIDTH - 2)))
    printf "╝\n"
    echo ""
}

# =========================================================================
# LINE FILTER — inspects each line from Node's stdout and decides whether
# to print it as-is, or wrap it in a colored banner first.
# =========================================================================
# Case-sensitive match on purpose: avoids false positives from generic words.
highlight_line() {
    local line="$1"

    # ----- SUCCESS patterns -----
    case "$line" in
        *"Job completed"*|*"completed successfully"*|*"[Execute Download] Download complete"*)
            banner "SUCCESS" "DOWNLOAD SUCCESS" "$line"
            return 0
            ;;
    esac

    # ----- FAILURE patterns -----
    case "$line" in
        *"Job failed"*)
            banner "ERROR" "DOWNLOAD FAILED" "$line"
            return 0
            ;;
    esac
    case "$line" in
        *"[Smart Download]"*"Error"*)
            banner "ERROR" "DOWNLOAD ERROR" "$line"
            return 0
            ;;
    esac
    case "$line" in
        *"ALL COOKIE STRATEGIES FAILED"*)
            banner "ERROR" "AUTH FAILED - ALL STRATEGIES EXHAUSTED" "$line"
            return 0
            ;;
    esac
    case "$line" in
        *"yt-dlp exited with code"*)
            banner "ERROR" "YT-DLP EXIT CODE NON-ZERO" "$line"
            return 0
            ;;
    esac
    case "$line" in
        *"[FATAL-GUARD]"*)
            banner "ERROR" "FATAL SERVER ERROR" "$line"
            return 0
            ;;
    esac
    case "$line" in
        *"Unhandled Rejection"*)
            banner "ERROR" "UNHANDLED PROMISE REJECTION" "$line"
            return 0
            ;;
    esac
    case "$line" in
        *"Uncaught Exception"*)
            banner "ERROR" "UNCAUGHT EXCEPTION" "$line"
            return 0
            ;;
    esac
    case "$line" in
        *"EADDRINUSE"*)
            banner "ERROR" "PORT ALREADY IN USE" "$line" \
                "Another server is already running on this port." \
                "Fix: close the other node.exe or change PORT in server.js"
            return 0
            ;;
    esac

    # ----- WARNING patterns (ASCII-safe) -----
    case "$line" in
        *"WARNING"*)
            banner "WARN" "WARNING" "$line"
            return 0
            ;;
    esac
    case "$line" in
        *"[AutoExtract]"*"failed"*)
            banner "WARN" "COOKIE EXTRACTION" "$line"
            return 0
            ;;
    esac

    # No match — print the raw line unchanged
    echo "$line"
    return 0
}

# =========================================================================
# OS DETECTION
# =========================================================================

IS_WSL=false; IS_MAC=false; IS_LINUX=false; IS_WINDOWS=false; IS_CYGWIN=false; IS_MSYS=false

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
[ -n "$WINDIR" ] || [ -n "$windir" ] && IS_WINDOWS=true

# =========================================================================
# PROCESS CLEANUP
# =========================================================================

cleanup_log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$CLEANUP_LOG"; }

detect_os_type() {
    case "$(uname -s)" in
        MINGW*|MSYS*|CYGWIN*) OS_TYPE="windows" ;;
        Linux*)               OS_TYPE="linux" ;;
        Darwin*)              OS_TYPE="macos" ;;
        *)                    OS_TYPE="unix" ;;
    esac
}

cleanup_windows_processes() {
    local killed=0
    if [ -n "${SCRIPT_DIR:-}" ] && [ -f "$SCRIPT_DIR/.1sh.pids" ]; then
        while read -r p; do
            [ -n "$p" ] || continue
            taskkill //F //PID "$p" 2>/dev/null && killed=$((killed + 1))
        done < "$SCRIPT_DIR/.1sh.pids"
        rm -f "$SCRIPT_DIR/.1sh.pids"
    fi
    if [ -n "${SERVER_PID:-}" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
        kill "$SERVER_PID" 2>/dev/null
    fi
}

cleanup_unix_processes() {
    if command -v pkill &> /dev/null; then
        local children=$(pgrep -P $$ 2>/dev/null)
        if [ -n "$children" ]; then
            echo "$children" | while read -r child_pid; do
                kill "$child_pid" 2>/dev/null
            done
        fi
    fi
}

cleanup_processes_force() {
    if [ -n "${SCRIPT_DIR:-}" ] && [ -f "$SCRIPT_DIR/.1sh.pids" ]; then
        while read -r p; do
            [ -n "$p" ] && taskkill //F //PID "$p" 2>/dev/null || true
        done < "$SCRIPT_DIR/.1sh.pids"
        rm -f "$SCRIPT_DIR/.1sh.pids"
    fi
    if [ -n "${SERVER_PID:-}" ]; then
        kill -9 "$SERVER_PID" 2>/dev/null || true
    fi
}

graceful_cleanup() {
    detect_os_type
    case "$OS_TYPE" in
        windows|msys|cygwin) cleanup_windows_processes ;;
        *)                   cleanup_unix_processes ;;
    esac
    cleanup_processes_force
}

cleanup_temp_files() {
    set +e 2>/dev/null
    local removed=0
    local files=(
        "$SCRIPT_DIR/.1sh_runtime.sh"
        "$SCRIPT_DIR/.1sh.state"
        "$SCRIPT_DIR/.1sh.pids"
        "$SCRIPT_DIR/.ps-install.log"
        "$SCRIPT_DIR/.pathdump.tmp"
        "$SCRIPT_DIR/.openbrowser.ps1"
        "$SCRIPT_DIR/export_cookies_fixed.py"
        "$SCRIPT_DIR/.extract_cookies.py"
        "$SCRIPT_DIR/.ytdlp_cookies.tmp"
        "$SCRIPT_DIR/.pycookiecheat_out.tmp"
        "$SCRIPT_DIR/npm_install.log"
        "/tmp/npm_install.log"
        "$TEMP/.1sh_extract.ps1"
        "$SCRIPT_DIR/cookies.txt"
        "$SCRIPT_DIR/server/cookies.txt"
    )
    for f in "${files[@]}"; do
        [ -e "$f" ] && rm -f "$f" 2>/dev/null && removed=$((removed + 1))
    done
    for pattern in \
        "$SCRIPT_DIR/.runtool."*".out" \
        "$SCRIPT_DIR/cookies.txt.bak."* \
        "$SCRIPT_DIR/cookies.txt.backup."* \
        "$SCRIPT_DIR/server/cookies.txt.bak."* \
        "$SCRIPT_DIR/server/cookies.txt.backup."* \
        "$SCRIPT_DIR/server.js.backup."* \
        "$SCRIPT_DIR/server.js.bak."* \
        "$SCRIPT_DIR/server/server.js.backup."* \
        "$SCRIPT_DIR/server/server.js.bak."*
    do
        [ -e "$pattern" ] && rm -f "$pattern" 2>/dev/null && removed=$((removed + 1))
    done
    if [ "$KEEP_LOGS" != true ]; then
        for f in "$SCRIPT_DIR/1sh.log" "$SCRIPT_DIR/cleanup.log" "$SCRIPT_DIR/server.log"; do
            [ -e "$f" ] && rm -f "$f" 2>/dev/null && removed=$((removed + 1))
        done
    fi
    [ "$DEBUG_MODE" = true ] && echo "[cleanup] removed $removed temp file(s)"
    return 0
}

trap 'graceful_cleanup; cleanup_temp_files' EXIT
trap 'cleanup_processes_force; cleanup_temp_files; exit 130' INT
trap 'graceful_cleanup; cleanup_temp_files; exit 143' TERM
trap 'graceful_cleanup; cleanup_temp_files; exit 129' HUP
trap 'graceful_cleanup; cleanup_temp_files; exit 131' QUIT

# =========================================================================
# ACTIVITY-AWARE TIMEOUT
# =========================================================================
run_with_timeout() {
    local timeout_seconds="${RUN_TIMEOUT_SECONDS:-300}"
    local max_retries="${RUN_TIMEOUT_RETRIES:-2}"
    local hard_cap_mult="${RUN_TIMEOUT_HARD_CAP:-20}"
    local retry_count=0
    local cmd="$@"

    while [ $retry_count -le $max_retries ]; do
        log "Running: $cmd (attempt $((retry_count+1))/$((max_retries+1)))"

        local outlog="$SCRIPT_DIR/.runtool.$$.out"
        : > "$outlog"

        eval "$cmd" < /dev/null > "$outlog" 2>&1 &
        local CMD_PID=$!

        local elapsed=0
        local last_size=0
        local idle_seconds=0
        local hard_cap=$((timeout_seconds * hard_cap_mult))
        local last_progress_print=0

        while kill -0 $CMD_PID 2>/dev/null; do
            sleep 5
            elapsed=$((elapsed + 5))

            local current_size=0
            if [ -f "$outlog" ]; then
                current_size=$(wc -c < "$outlog" 2>/dev/null | tr -d ' \r\n')
                [ -z "$current_size" ] && current_size=0
            fi

            if [ "$current_size" -gt "$last_size" ]; then
                idle_seconds=0
                last_size=$current_size
            else
                idle_seconds=$((idle_seconds + 5))
            fi

            if [ $((elapsed - last_progress_print)) -ge 30 ]; then
                last_progress_print=$elapsed
                log "  ... running (${elapsed}s elapsed, idle ${idle_seconds}s, output ${current_size} bytes)"
            fi

            if [ "$idle_seconds" -ge "$timeout_seconds" ]; then
                warn "Process IDLE for ${idle_seconds}s - killing"
                if [ "$IS_WINDOWS" = true ]; then
                    taskkill //PID $CMD_PID //F //T 2>/dev/null || true
                    taskkill //IM pip.exe //F 2>/dev/null || true
                    taskkill //IM pip3.exe //F 2>/dev/null || true
                    taskkill //IM winget.exe //F //T 2>/dev/null || true
                    taskkill //IM node.exe //F 2>/dev/null || true
                else
                    kill -9 $CMD_PID 2>/dev/null || true
                fi
                sleep 3
                wait $CMD_PID 2>/dev/null || true
                rm -f "$outlog"
                log "Waiting 10s before retry..."
                sleep 10
                retry_count=$((retry_count + 1))
                continue 2
            fi

            if [ "$elapsed" -ge "$hard_cap" ]; then
                warn "Process HARD CAP reached (${elapsed}s) - killing"
                if [ "$IS_WINDOWS" = true ]; then
                    taskkill //PID $CMD_PID //F //T 2>/dev/null || true
                    taskkill //IM winget.exe //F //T 2>/dev/null || true
                else
                    kill -9 $CMD_PID 2>/dev/null || true
                fi
                sleep 3
                wait $CMD_PID 2>/dev/null || true
                rm -f "$outlog"
                retry_count=$((retry_count + 1))
                continue 2
            fi
        done

        wait $CMD_PID 2>/dev/null
        local EXIT_CODE=$?

        if [ -s "$outlog" ] && [ "$DEBUG_MODE" = true ]; then
            dbg "Final output:"
            tail -n 20 "$outlog" | while read -r line; do
                dbg "  | $line"
            done
        fi
        rm -f "$outlog"

        if [ $EXIT_CODE -eq 0 ]; then
            ok "Command completed successfully!"
            return 0
        else
            warn "Command failed with exit code: $EXIT_CODE"
            retry_count=$((retry_count + 1))
            [ $retry_count -le $max_retries ] && {
                log "Waiting 10 seconds before retry..."
                sleep 10
            }
        fi
    done
    error "Failed after $((max_retries+1)) attempts"
    return 1
}

# =========================================================================
# PATH AUGMENTATION
# =========================================================================
add_known_tool_dirs() {
    local candidates=(
        "$LOCALAPPDATA/Microsoft/WinGet/Links"
        "/c/Program Files/Git/bin"
        "/c/Program Files/Git/usr/bin"
        "/c/Program Files/Git/usr/local/bin"
        "/c/Program Files/nodejs"
        "/c/Program Files/Python313"
        "/c/Program Files/Python313/Scripts"
        "/c/Program Files/Python312"
        "/c/Program Files/Python312/Scripts"
        "/c/Program Files/Python311"
        "/c/Program Files/Python311/Scripts"
        "$LOCALAPPDATA/Programs/Python/Python313"
        "$LOCALAPPDATA/Programs/Python/Python313/Scripts"
        "$LOCALAPPDATA/Programs/Python/Python312"
        "$LOCALAPPDATA/Programs/Python/Python312/Scripts"
        "$LOCALAPPDATA/Programs/Python/Python311"
        "$LOCALAPPDATA/Programs/Python/Python311/Scripts"
        "$USERPROFILE/AppData/Local/Microsoft/WinGet/Links"
        "/usr/local/bin"
        "$HOME/.local/bin"
    )
    local n=0
    for d in "${candidates[@]}"; do
        if [ -d "$d" ]; then
            case ":$PATH:" in
                *":$d:"*) ;;
                *) PATH="$d:$PATH"; n=$((n + 1)) ;;
            esac
        fi
    done
    [ "$n" -gt 0 ] && ok "PATH: added $n known tool directories"
    return 0
}

# =========================================================================
# REAL BINARY RESOLVER
# =========================================================================
resolve_real_binary() {
    local name="$1"
    local candidates=()
    case "$name" in
        node|node.exe) candidates=( "/c/Program Files/nodejs/node.exe" "/c/Program Files/nodejs/node" "$LOCALAPPDATA/Programs/nodejs/node.exe" ) ;;
        npm|npm.cmd) candidates=( "/c/Program Files/nodejs/npm.cmd" "/c/Program Files/nodejs/npm" "$LOCALAPPDATA/Programs/nodejs/npm.cmd" ) ;;
        npx|npx.cmd) candidates=( "/c/Program Files/nodejs/npx.cmd" "/c/Program Files/nodejs/npx" ) ;;
        python|python.exe)
            candidates=(
                "$LOCALAPPDATA/Programs/Python/Python313/python.exe"
                "$LOCALAPPDATA/Programs/Python/Python312/python.exe"
                "$LOCALAPPDATA/Programs/Python/Python311/python.exe"
                "/c/Program Files/Python313/python.exe"
                "/c/Program Files/Python312/python.exe"
                "/c/Program Files/Python311/python.exe"
            ) ;;
        python3|python3.exe)
            local py; py=$(resolve_real_binary "python") || true
            [ -n "$py" ] && { echo "$py"; return 0; } ;;
        pip|pip.exe|pip3|pip3.exe)
            local py; py=$(resolve_real_binary "python") || true
            if [ -n "$py" ]; then
                local pydir; pydir="$(dirname "$py")"
                for f in pip.exe pip3.exe pip pip3; do
                    [ -x "$pydir/Scripts/$f" ] && { echo "$pydir/Scripts/$f"; return 0; }
                    [ -x "$pydir/$f" ] && { echo "$pydir/$f"; return 0; }
                done
            fi
            return 1 ;;
        yt-dlp|yt-dlp.exe)
            local py; py=$(resolve_real_binary "python") || true
            if [ -n "$py" ]; then
                local pydir; pydir="$(dirname "$py")"
                for f in yt-dlp.exe yt-dlp; do
                    [ -x "$pydir/Scripts/$f" ] && { echo "$pydir/Scripts/$f"; return 0; }
                    [ -x "$pydir/$f" ] && { echo "$pydir/$f"; return 0; }
                done
            fi
            candidates=(
                "$LOCALAPPDATA/Microsoft/WinGet/Links/yt-dlp.exe"
                "$LOCALAPPDATA/Programs/Python/Python313/Scripts/yt-dlp.exe"
                "$LOCALAPPDATA/Programs/Python/Python312/Scripts/yt-dlp.exe"
                "$HOME/.local/bin/yt-dlp.exe"
                "$HOME/.local/bin/yt-dlp"
            ) ;;
        pycookiecheat|pycookiecheat.exe)
            local py; py=$(resolve_real_binary "python") || true
            if [ -n "$py" ]; then
                local pydir; pydir="$(dirname "$py")"
                for f in pycookiecheat.exe pycookiecheat; do
                    [ -x "$pydir/Scripts/$f" ] && { echo "$pydir/Scripts/$f"; return 0; }
                    [ -x "$pydir/$f" ] && { echo "$pydir/$f"; return 0; }
                done
            fi ;;
        ffmpeg|ffmpeg.exe)
            local py; py=$(resolve_real_binary "python") || true
            if [ -n "$py" ]; then
                local pydir; pydir="$(dirname "$py")"
                for sub in "Lib/site-packages/imageio_ffmpeg/binaries" "lib/site-packages/imageio_ffmpeg/binaries"; do
                    if [ -d "$pydir/$sub" ]; then
                        local f; f=$(find "$pydir/$sub" -maxdepth 1 -name "ffmpeg*.exe" 2>/dev/null | head -1)
                        [ -n "$f" ] && [ -x "$f" ] && { echo "$f"; return 0; }
                    fi
                done
            fi
            candidates=(
                "/c/ProgramData/chocolatey/bin/ffmpeg.exe"
                "/c/Program Files/ffmpeg/bin/ffmpeg.exe"
                "$LOCALAPPDATA/Microsoft/WinGet/Links/ffmpeg.exe"
            ) ;;
    esac
    local c
    for c in "${candidates[@]}"; do
        [ -x "$c" ] && { echo "$c"; return 0; }
    done
    local found=""
    while IFS= read -r line; do
        case "$line" in
            *WindowsApps*) continue ;;
            *wsl*)         continue ;;
            *)             found="$line"; break ;;
        esac
    done < <(command -v -a "$name" 2>/dev/null)
    [ -n "$found" ] && { echo "$found"; return 0; }
    return 1
}

safe_version() {
    local bin="$1"
    [ -z "$bin" ] && { echo "unknown"; return 1; }
    local v
    v=$("$bin" --version 2>&1 | head -1 | tr -d '\r\n\0')
    [ -z "$v" ] && echo "(version unknown)" || echo "$v"
}

run_native_binary() {
    local bin="$1"; shift
    case "$bin" in
        *.cmd|*.CMD)
            local winpath; winpath=$(cygpath -w "$bin" 2>/dev/null || echo "$bin")
            MSYS_NO_PATHCONV=1 cmd //c "$winpath" "$@" < /dev/null ;;
        *) "$bin" "$@" < /dev/null ;;
    esac
}

refresh_windows_path() {
    [ "$IS_WINDOWS" != true ] && return 0
    local ps_exe=""
    if command -v pwsh >/dev/null 2>&1; then
        ps_exe="pwsh"
    elif [ -f "/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe" ]; then
        ps_exe="/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe"
    elif command -v powershell >/dev/null 2>&1; then
        ps_exe="powershell"
    fi
    [ -z "$ps_exe" ] && return 0
    local tmp="$SCRIPT_DIR/.pathdump.tmp"
    : > "$tmp"
    RUN_TIMEOUT_SECONDS=15 RUN_TIMEOUT_RETRIES=0 \
        run_with_timeout "env MSYS_NO_PATHCONV=1 $ps_exe -NoProfile -NonInteractive -Command \"[Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')\"" \
        > "$tmp" 2>/dev/null
    if [ ! -s "$tmp" ]; then
        rm -f "$tmp"
        return 0
    fi
    local raw
    raw=$(tr -d '\r' < "$tmp" 2>/dev/null)
    rm -f "$tmp"
    [ -z "$raw" ] && return 0
    local unix_path=""
    command -v cygpath >/dev/null 2>&1 && unix_path=$(cygpath -up "$raw" 2>/dev/null)
    [ -z "$unix_path" ] && unix_path=$(echo "$raw" | tr ';' ':' | sed -E 's|([A-Za-z]):\\|/\L\1/|g; s|\\|/|g')
    [ -n "$unix_path" ] && export PATH="$unix_path:$PATH"
    ok "PATH refreshed from Windows registry"
    return 0
}

# =========================================================================
# GENERATE EXTRACTOR SCRIPTS (self-contained)
# =========================================================================
generate_extractor_scripts() {
    step "GENERATING EXTRACTOR SCRIPTS"

    local PW_JS="$SCRIPT_DIR/extract_cookies_playwright.js"
    log "Writing extract_cookies_playwright.js ..."
    cat > "$PW_JS" << 'PWJSEOF'
#!/usr/bin/env node
/**
 * extract_cookies_playwright.js — Extract YouTube cookies via Playwright.
 * Supports CDP connect (YTL_CDP_URL env) and fresh launch mode.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const BROWSER = (process.argv[2] || 'edge').toLowerCase();
const OUTPUT = process.argv[3] || 'cookies.txt';
const HEADLESS = process.env.YTL_HEADLESS === '1';
const CDP_URL = process.env.YTL_CDP_URL || null;
const PROFILE_DIR = process.env.YTL_PROFILE_DIR || null;

console.log('======================================================');
console.log('  Cookie Extractor (Playwright)');
console.log('======================================================');
console.log(`Browser:  ${BROWSER}`);
console.log(`Output:   ${OUTPUT}`);
console.log(`CDP URL:  ${CDP_URL || '(fresh launch mode)'}`);
console.log(`Profile:  ${PROFILE_DIR || '(default)'}`);
console.log('');

let playwright;
try { playwright = require('playwright'); }
catch (e) { console.error('❌ Playwright not installed'); process.exit(1); }

function findEdgePath() {
    const cands = process.platform === 'win32'
        ? [
            'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
            'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
        ]
        : process.platform === 'darwin'
            ? ['/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge']
            : ['/usr/bin/microsoft-edge', '/usr/bin/microsoft-edge-stable'];
    for (const p of cands) if (fs.existsSync(p)) return p;
    return null;
}

const YOUTUBE_DOMAINS = ['youtube.com','google.com','accounts.google.com','m.youtube.com'];

function isYoutubeDomain(domain) {
    if (!domain) return false;
    const d = domain.toLowerCase().replace(/^\./, '');
    return YOUTUBE_DOMAINS.some(yt => d === yt || d.endsWith('.' + yt));
}

function toNetscapeLine(cookie) {
    const domain = cookie.domain || '';
    const flag = domain.startsWith('.') ? 'TRUE' : 'FALSE';
    const path_ = cookie.path || '/';
    const secure = cookie.secure ? 'TRUE' : 'FALSE';
    const expires = cookie.expires && cookie.expires > 0 ? Math.floor(cookie.expires) : 0;
    const name = String(cookie.name || '').replace(/\t/g, '\\t').replace(/\n/g, '\\n');
    const value = String(cookie.value || '').replace(/\t/g, '\\t').replace(/\n/g, '\\n');
    return `${domain}\t${flag}\t${path_}\t${secure}\t${expires}\t${name}\t${value}`;
}

function writeCookies(cookies, outputPath) {
    const header = [
        '# Netscape HTTP Cookie File',
        `# Generated by extract_cookies_playwright.js on ${new Date().toISOString()}`,
        '# https://curl.se/docs/http-cookies.html',
        '#',
        '',
    ].join('\n');
    const lines = cookies.map(toNetscapeLine);
    fs.writeFileSync(outputPath, header + lines.join('\n') + '\n', 'utf8');
    console.log(`✅ Wrote ${cookies.length} cookies to: ${outputPath}`);
}

function verifyCritical(cookies) {
    const critical = ['SID','SSID','HSID','APISID','SAPISID','LOGIN_INFO','VISITOR_INFO1_LIVE','__Secure-3PSID'];
    const names = new Set(cookies.map(c => c.name));
    console.log('');
    console.log('Critical YouTube cookies check:');
    let allOk = true;
    for (const name of critical) {
        if (names.has(name)) { console.log(`  ✅ ${name}`); }
        else { console.log(`  ❌ ${name} MISSING`); allOk = false; }
    }
    return allOk;
}

(async () => {
    let context, cdpBrowser;

    if (CDP_URL) {
        console.log(`Connecting to CDP: ${CDP_URL}`);
        try {
            cdpBrowser = await playwright.chromium.connectOverCDP(CDP_URL);
            context = cdpBrowser.contexts()[0];
            if (!context) throw new Error('No existing context');
            console.log('✅ Connected to running Edge via CDP');
        } catch (e) {
            console.error(`❌ CDP connect failed: ${e.message}`);
            process.exit(1);
        }
    } else {
        const edgePath = findEdgePath();
        if (!edgePath) { console.error('❌ Edge not found'); process.exit(1); }
        const profile = PROFILE_DIR || path.join(os.homedir(), 'EdgeDebugProfile');
        console.log(`Launching Edge with profile: ${profile}`);
        try {
            context = await playwright.chromium.launchPersistentContext(profile, {
                executablePath: edgePath,
                channel: 'msedge',
                headless: HEADLESS,
                viewport: { width: 1280, height: 800 },
                args: ['--disable-blink-features=AutomationControlled','--no-first-run','--no-default-browser-check'],
            });
        } catch (e) {
            console.error(`❌ Launch failed: ${e.message}`);
            process.exit(1);
        }
    }

    try {
        const page = await context.newPage();
        console.log('Navigating to YouTube...');
        await page.goto('https://www.youtube.com', { waitUntil: 'domcontentloaded', timeout: 45000 });

        const signedIn = await page.evaluate(() => {
            return !!(document.querySelector('#avatar-btn') ||
                     document.querySelector('button[aria-label*="Account"]'));
        }).catch(() => false);

        if (!signedIn) {
            console.log('');
            console.log('⚠️  NOT SIGNED IN');
            console.log('   You have 120 seconds to sign into YouTube in the browser window.');
            console.log('');
            const start = Date.now();
            while (Date.now() - start < 120000) {
                await page.waitForTimeout(3000);
                const now = await page.evaluate(() => {
                    return !!(document.querySelector('#avatar-btn') ||
                             document.querySelector('button[aria-label*="Account"]'));
                }).catch(() => false);
                if (now) { console.log('✅ Sign-in detected'); break; }
            }
        } else {
            console.log('✅ Already signed in');
        }

        console.log('Visiting a YouTube video...');
        try { await page.goto('https://www.youtube.com/watch?v=dQw4w9WgXcQ', { waitUntil: 'domcontentloaded', timeout: 45000 }); } catch {}
        await page.waitForTimeout(5000);

        const allCookies = await context.cookies();
        const yt = allCookies.filter(c => isYoutubeDomain(c.domain));
        console.log(`Total cookies: ${allCookies.length}`);
        console.log(`YouTube/Google: ${yt.length}`);

        if (yt.length === 0) { console.error('❌ No YouTube cookies'); process.exit(1); }

        writeCookies(yt, OUTPUT);
        const ok = verifyCritical(yt);

        if (cdpBrowser) { try { await cdpBrowser.close(); } catch {} }
        else if (context) { try { await context.close(); } catch {} }
        process.exit(ok ? 0 : 1);
    } catch (e) {
        console.error(`❌ Error: ${e.message}`);
        try { if (cdpBrowser) await cdpBrowser.close(); else if (context) await context.close(); } catch {}
        process.exit(1);
    }
})();
PWJSEOF
    ok "Created: extract_cookies_playwright.js"

    # ---------- extract_cookies.py ----------
    local PY_SCRIPT="$SCRIPT_DIR/extract_cookies.py"
    log "Writing extract_cookies.py ..."
    cat > "$PY_SCRIPT" << 'PYEOF'
#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Multi-strategy YouTube cookie extractor (fallback)."""
import argparse, io, os, shutil, sqlite3, subprocess, sys, time, tempfile
from datetime import datetime
from pathlib import Path

if sys.platform == 'win32':
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
        sys.stderr.reconfigure(encoding='utf-8', errors='replace')
    except Exception: pass

YOUTUBE_DOMAINS = {'.youtube.com','youtube.com','.google.com','google.com','accounts.google.com','.accounts.google.com','m.youtube.com'}
CRITICAL = ['SID','SSID','HSID','APISID','SAPISID','LOGIN_INFO','VISITOR_INFO1_LIVE','__Secure-3PSID','YSC','PREF']

def is_yt(d):
    if not d: return False
    dd = d.lower().lstrip('.')
    return any(dd == y.lstrip('.') or dd.endswith('.'+y.lstrip('.')) for y in YOUTUBE_DOMAINS)

def write_file(rows, out):
    out = Path(out)
    out.parent.mkdir(parents=True, exist_ok=True)
    lines = ["# Netscape HTTP Cookie File", f"# {datetime.now().isoformat()}", "#"]
    for r in rows:
        flag = 'TRUE' if r['domain'].startswith('.') else 'FALSE'
        sec = 'TRUE' if r['secure'] else 'FALSE'
        lines.append(f"{r['domain']}\t{flag}\t{r['path'] or '/'}\t{sec}\t{int(r['expires'] or 0)}\t{r['name']}\t{r['value']}")
    with open(out, 'wb') as f:
        f.write(('\n'.join(lines)+'\n').encode('utf-8'))
    print(f"[extract] Wrote {len(rows)} cookies to {out}")
    return len(rows)

def verify(rows):
    names = {r['name']: r['expires'] or 0 for r in rows}
    now = time.time()
    missing = []
    for c in CRITICAL:
        if c not in names:
            print(f"  X {c} MISSING"); missing.append(c)
        elif names[c] and names[c] < now:
            print(f"  X {c} EXPIRED"); missing.append(c)
        else:
            print(f"  + {c}")
    return len(missing) == 0

def s_bc3(browser):
    print("[extract] Strategy 1: browser_cookie3")
    try: import browser_cookie3
    except ImportError: return None
    try:
        cj = {'edge':browser_cookie3.edge,'chrome':browser_cookie3.chrome,'firefox':browser_cookie3.firefox,'brave':browser_cookie3.brave}.get(browser, browser_cookie3.edge)()
        rows = []
        for c in cj:
            if not is_yt(c.domain): continue
            exp = getattr(c, 'expires', None)
            exp_ts = int(exp.timestamp()) if hasattr(exp, 'timestamp') else (int(exp) if isinstance(exp, (int,float)) else 0)
            rows.append({'domain':c.domain,'path':c.path or '/','secure':bool(c.secure),'expires':exp_ts,'name':c.name,'value':c.value or ''})
        return rows if rows else None
    except Exception as e:
        print(f"[extract] browser_cookie3 failed: {e}")
        return None

def s_ytdlp(browser):
    print("[extract] Strategy 2: yt-dlp")
    ytdlp = shutil.which('yt-dlp') or shutil.which('yt-dlp.exe')
    if not ytdlp: return None
    tmp = Path(tempfile.gettempdir()) / f'ytdlp_{os.getpid()}.txt'
    try:
        subprocess.run([ytdlp, '--cookies-from-browser', browser, '--cookies', str(tmp), '--skip-download','--flat-playlist','--no-warnings','--quiet','https://www.youtube.com/watch?v=dQw4w9WgXcQ'], capture_output=True, timeout=60)
        if tmp.exists() and tmp.stat().st_size > 0:
            rows = []
            for line in tmp.read_text(encoding='utf-8', errors='replace').splitlines():
                if not line or line.startswith('#'): continue
                f = line.split('\t')
                if len(f) >= 7 and is_yt(f[0]):
                    rows.append({'domain':f[0],'path':f[2],'secure':f[3].upper()=='TRUE','expires':int(f[4]) if f[4].isdigit() else 0,'name':f[5],'value':f[6]})
            tmp.unlink(missing_ok=True)
            return rows if rows else None
    except Exception as e:
        print(f"[extract] yt-dlp failed: {e}")
    tmp.unlink(missing_ok=True)
    return None

def s_pcc(browser):
    print("[extract] Strategy 3: pycookiecheat")
    try: import pycookiecheat
    except ImportError:
        try: subprocess.run([sys.executable,'-m','pip','install','--quiet','--no-input','pycookiecheat'], capture_output=True, timeout=120); import pycookiecheat
        except Exception: return None
    try:
        ck = pycookiecheat.chrome_cookies('https://www.youtube.com', browser={'edge':'edge','chrome':'chrome','brave':'brave','firefox':'firefox'}.get(browser,'edge')) or {}
        return [{'domain':'.youtube.com','path':'/','secure':True,'expires':0,'name':n,'value':v} for n,v in ck.items()] or None
    except Exception as e:
        print(f"[extract] pycookiecheat failed: {e}")
        return None

def s_win32(browser):
    print("[extract] Strategy 4: win32crypt")
    if sys.platform != 'win32': return None
    try: import win32crypt
    except ImportError:
        try: subprocess.run([sys.executable,'-m','pip','install','--quiet','--no-input','pywin32'], capture_output=True, timeout=180); import win32crypt
        except Exception: return None
    local = os.environ.get('LOCALAPPDATA','')
    cands = {'edge':Path(local)/'Microsoft'/'Edge'/'User Data'/'Default'/'Network'/'Cookies','chrome':Path(local)/'Google'/'Chrome'/'User Data'/'Default'/'Network'/'Cookies','brave':Path(local)/'BraveSoftware'/'Brave-Browser'/'User Data'/'Default'/'Network'/'Cookies'}
    db = cands.get(browser)
    if not db or not db.exists(): return None
    tmp = Path(tempfile.gettempdir()) / f'cc_{os.getpid()}.db'
    try: shutil.copy2(db, tmp)
    except Exception: return None
    rows = []
    try:
        conn = sqlite3.connect(str(tmp))
        cur = conn.cursor()
        cur.execute("SELECT host_key, path, is_secure, expires_utc, name, value, encrypted_value FROM cookies WHERE host_key LIKE '%youtube.com%' OR host_key LIKE '%google.com%'")
        for host, path, secure, expires, name, value, enc in cur.fetchall():
            if value: fv = value
            elif enc:
                try:
                    if enc[:3] in (b'v10', b'v11'): enc = enc[3:]
                    fv = win32crypt.CryptUnprotectData(enc, None, None, None, 0)[1].decode('utf-8', errors='replace')
                except Exception: continue
            else: continue
            exp_ts = int(expires/1000000 - 11644473600) if expires and expires > 0 else 0
            rows.append({'domain':host,'path':path,'secure':bool(secure),'expires':exp_ts,'name':name,'value':fv})
        conn.close()
    except Exception as e:
        print(f"[extract] win32crypt error: {e}")
    finally:
        tmp.unlink(missing_ok=True)
    return rows if rows else None

def main():
    p = argparse.ArgumentParser()
    p.add_argument('--browser', default='edge', choices=['edge','chrome','firefox','brave','auto'])
    p.add_argument('--output','-o', default='cookies.txt')
    p.add_argument('--cookie-path', default=None)
    args = p.parse_args()
    out = args.cookie_path or args.output
    browser = args.browser if args.browser != 'auto' else 'edge'
    print("="*60)
    print("Cookie Extractor")
    print("="*60)
    print(f"Browser: {browser}")
    print(f"Output:  {out}")
    strategies = [s_bc3, s_ytdlp, s_pcc, s_win32]
    for s in strategies:
        try:
            rows = s(browser)
            if rows:
                has_login = any(r['name'] == 'LOGIN_INFO' for r in rows)
                if has_login:
                    print(f"[extract] {s.__name__} got {len(rows)} cookies with LOGIN_INFO")
                    write_file(rows, out)
                    verify(rows)
                    sys.exit(0)
                else:
                    print(f"[extract] {s.__name__} got {len(rows)} cookies but no LOGIN_INFO")
                    if not Path(out).exists():
                        write_file(rows, out)
        except Exception as e:
            print(f"[extract] {s.__name__} raised: {e}")
    print("[extract] No strategy produced LOGIN_INFO")
    sys.exit(1)

if __name__ == '__main__':
    main()
PYEOF
    ok "Created: extract_cookies.py"
}

# =========================================================================
# TOOL INSTALL HELPERS
# =========================================================================
winget_install_if_missing() {
    local resolver_name="$1"; local winget_id="$2"; local display_name="$3"
    local existing; existing=$(resolve_real_binary "$resolver_name") || true
    if [ -n "$existing" ]; then ok "$display_name already present"; return 0; fi
    if ! command -v winget >/dev/null 2>&1; then warn "winget not available"; return 1; fi
    log "$display_name not found - installing..."
    RUN_TIMEOUT_SECONDS=600 RUN_TIMEOUT_RETRIES=1 RUN_TIMEOUT_HARD_CAP=20 \
        run_with_timeout "env MSYS_NO_PATHCONV=1 winget install --id $winget_id -e --source winget --accept-package-agreements --accept-source-agreements --silent"
    add_known_tool_dirs; refresh_windows_path
    existing=$(resolve_real_binary "$resolver_name") || true
    [ -n "$existing" ] && { ok "$display_name installed"; return 0; } || { warn "install may have failed"; return 1; }
}

pip_install_or_upgrade() {
    local pkg="$1"; local display_name="$2"; local resolver_name="${3:-}"
    local py_bin; py_bin=$(resolve_real_binary "python") || true
    if [ -z "$py_bin" ]; then error "Python not available"; return 1; fi
    log "pip install $display_name..."
    if RUN_TIMEOUT_SECONDS=600 RUN_TIMEOUT_RETRIES=1 RUN_TIMEOUT_HARD_CAP=20 \
        run_with_timeout "\"$py_bin\" -m pip install --no-input --no-cache-dir --upgrade $pkg"; then
        add_known_tool_dirs; refresh_windows_path
        if [ -n "$resolver_name" ]; then
            local existing; existing=$(resolve_real_binary "$resolver_name") || true
            [ -n "$existing" ] && ok "$display_name ready" || warn "$display_name not on PATH"
        fi
        return 0
    else
        warn "pip install of $pkg failed"
        return 1
    fi
}

# =========================================================================
# INSTALL DEPENDENCIES
# =========================================================================
install_missing_tools() {
    step "INSTALLING / UPDATING TOOLS"
    if [ "$SKIP_INSTALL" = true ]; then warn "--no-install: skipping"; return 0; fi
    export PATH="$LOCALAPPDATA/Microsoft/WinGet/Links:$PATH"

    echo ""
    log "== Step 1/9: Git Bash =="
    [ -x "/c/Program Files/Git/bin/bash.exe" ] && ok "Git Bash present" || winget_install_if_missing "bash" "Git.Git" "Git Bash"

    echo ""
    log "== Step 2/9: Python =="
    winget_install_if_missing "python" "Python.Python.3.12" "Python 3.12"

    echo ""
    log "== Step 3/9: Node.js =="
    winget_install_if_missing "node" "OpenJS.NodeJS.LTS" "Node.js LTS"

    echo ""
    log "== Step 4/9: yt-dlp =="
    pip_install_or_upgrade "yt-dlp" "yt-dlp" "yt-dlp"

    echo ""
    log "== Step 5/9: FFmpeg =="
    if ! pip_install_or_upgrade "imageio-ffmpeg" "FFmpeg" "ffmpeg"; then
        pip_install_or_upgrade "static-ffmpeg" "FFmpeg (alt)" "ffmpeg"
    fi

    echo ""
    log "== Step 6/9: Python cookie libraries =="
    pip_install_or_upgrade "browser_cookie3" "browser_cookie3" ""
    pip_install_or_upgrade "pycookiecheat" "pycookiecheat" "pycookiecheat"
    pip_install_or_upgrade "pywin32" "pywin32" ""
    pip_install_or_upgrade "cryptography" "cryptography" ""

    echo ""
    log "== Step 7/9: Playwright =="
    local NPM_BIN; NPM_BIN=$(resolve_real_binary "npm") || true
    if [ -n "$NPM_BIN" ]; then
        cd "$SCRIPT_DIR"
        RUN_TIMEOUT_SECONDS=300 RUN_TIMEOUT_RETRIES=1 RUN_TIMEOUT_HARD_CAP=20 \
            run_with_timeout "run_native_binary \"$NPM_BIN\" install playwright --no-audit --no-fund" || true
        RUN_TIMEOUT_SECONDS=300 RUN_TIMEOUT_RETRIES=1 RUN_TIMEOUT_HARD_CAP=20 \
            run_with_timeout "run_native_binary \"$NPM_BIN\" exec --no -- playwright install msedge" || true
        [ -d "$SCRIPT_DIR/node_modules/playwright" ] && ok "Playwright installed"
    fi

    echo ""
    log "== Step 8/9: chrome-cookies-secure =="
    [ -n "$NPM_BIN" ] && RUN_TIMEOUT_SECONDS=180 RUN_TIMEOUT_RETRIES=1 RUN_TIMEOUT_HARD_CAP=20 \
        run_with_timeout "run_native_binary \"$NPM_BIN\" install -g chrome-cookies-secure --no-audit --no-fund --silent" || true

    echo ""
    log "== Step 9/9: puppeteer-core =="
    [ -n "$NPM_BIN" ] && RUN_TIMEOUT_SECONDS=180 RUN_TIMEOUT_RETRIES=1 RUN_TIMEOUT_HARD_CAP=20 \
        run_with_timeout "run_native_binary \"$NPM_BIN\" install -g puppeteer-core --no-audit --no-fund --silent" || true

    add_known_tool_dirs; refresh_windows_path
    return 0
}

detect_repo_structure() {
    step "DETECTING REPOSITORY STRUCTURE"
    log "Files in project root:"
    find "$SCRIPT_DIR" -maxdepth 2 -type f \( -name "*.js" -o -name "*.json" -o -name "*.html" \) 2>/dev/null | head -20
    if [ -f "$SCRIPT_DIR/server/server.js" ]; then
        SERVER_DIR="$SCRIPT_DIR/server"; SERVER_JS="$SCRIPT_DIR/server/server.js"
        ok "Found server.js in /server"
    elif [ -f "$SCRIPT_DIR/server.js" ]; then
        SERVER_DIR="$SCRIPT_DIR"; SERVER_JS="$SCRIPT_DIR/server.js"
        ok "Found server.js in root"
    else
        error "Could NOT find server.js!"
        SERVER_DIR="$SCRIPT_DIR"; SERVER_JS="$SCRIPT_DIR/server.js"
    fi
    [ -n "$SERVER_DIR" ] && COOKIES_FILE="$SERVER_DIR/cookies.txt"
}

install_ytdl() {
    step "YT-DLP VERIFICATION"
    local YTDLP_BIN; YTDLP_BIN=$(resolve_real_binary "yt-dlp") || true
    [ -n "$YTDLP_BIN" ] && { ok "yt-dlp: $(safe_version "$YTDLP_BIN")"; return 0; }
    pip_install_or_upgrade "yt-dlp" "yt-dlp" "yt-dlp"
}

setup_ffmpeg() {
    step "FFMPEG VERIFICATION"
    local FF_BIN; FF_BIN=$(resolve_real_binary "ffmpeg") || true
    [ -n "$FF_BIN" ] && { ok "FFmpeg: $FF_BIN"; return 0; }
    pip_install_or_upgrade "imageio-ffmpeg" "FFmpeg" "ffmpeg" || \
        pip_install_or_upgrade "static-ffmpeg" "FFmpeg (alt)" "ffmpeg"
}

detect_browser() {
    [ "$IS_WINDOWS" = true ] || [ "$IS_CYGWIN" = true ] || [ "$IS_MSYS" = true ] && {
        [ -d "$LOCALAPPDATA/Microsoft/Edge/User Data" ] && { echo "edge"; return 0; }
        [ -d "$LOCALAPPDATA/Google/Chrome/User Data" ] && { echo "chrome"; return 0; }
    }
    echo "edge"; return 0
}

test_cookies() {
    local BROWSER="$1"
    log "Testing cookie extraction from $BROWSER..."
    local YTDLP_BIN; YTDLP_BIN=$(resolve_real_binary "yt-dlp") || YTDLP_BIN="yt-dlp"
    local OUT
    if OUT=$("$YTDLP_BIN" --cookies-from-browser "$BROWSER" --skip-download --flat-playlist "https://www.youtube.com/watch?v=dQw4w9WgXcQ" 2>&1); then
        ok "Cookie extraction working!"
    else
        warn "Cookie test warning (may still work):"
        echo "$OUT" | tail -3
    fi
}

check_existing_cookies() {
    log "Checking for existing cookies.txt..."
    if [ -f "$COOKIES_FILE" ] && [ -s "$COOKIES_FILE" ]; then
        local n; n=$(grep -vc '^#\|^$' "$COOKIES_FILE" 2>/dev/null || echo "0")
        if [ "$n" -gt 5 ] && grep -q "LOGIN_INFO" "$COOKIES_FILE"; then
            ok "cookies.txt valid ($n entries, LOGIN_INFO present)"
            export COOKIES_EXPORTED=true; return 0
        fi
    fi
    export COOKIES_EXPORTED=false
    return 1
}

# =========================================================================
# CDP HELPERS
# =========================================================================
check_cdp_running() {
    command -v curl >/dev/null 2>&1 && curl -s --max-time 2 "$CDP_URL/json/version" >/dev/null 2>&1
}

find_edge_exe() {
    for c in \
        "/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" \
        "/c/Program Files/Microsoft/Edge/Application/msedge.exe" \
        ; do
        [ -f "$c" ] && { echo "$c"; return 0; }
    done
    return 1
}

launch_edge_with_cdp_debug_profile() {
    local edge_exe; edge_exe=$(find_edge_exe) || { warn "Edge not found"; return 1; }

    mkdir -p "$EDGE_DEBUG_PROFILE_UNIX" 2>/dev/null || true

    log "Launching Edge with dedicated debug profile:"
    log "  Executable: $edge_exe"
    log "  Profile:    $EDGE_DEBUG_PROFILE_WIN"
    log "  CDP port:   $CDP_PORT"

    taskkill //F //T //IM msedge.exe 2>/dev/null || true
    sleep 3

    MSYS_NO_PATHCONV=1 "$edge_exe" \
        --user-data-dir="$EDGE_DEBUG_PROFILE_WIN" \
        --remote-debugging-port="$CDP_PORT" \
        --no-first-run \
        --no-default-browser-check \
        --no-restore-session-state \
        "https://www.youtube.com" > /dev/null 2>&1 &

    local waited=0
    while [ $waited -lt 30 ]; do
        sleep 1
        waited=$((waited + 1))
        if check_cdp_running; then
            ok "Edge CDP up after ${waited}s"
            sleep 5
            return 0
        fi
    done
    warn "Edge CDP did not come up in 30s"
    return 1
}

# =========================================================================
# KILL EDGE + EXTRACT COOKIES
# =========================================================================
kill_edge_and_extract_cookies() {
    step "EXTRACTING COOKIES (CDP + multi-method cascade)"

    local PY_BIN; PY_BIN=$(resolve_real_binary "python") || true
    local NODE_BIN; NODE_BIN=$(resolve_real_binary "node") || true
    local PW_SCRIPT="$SCRIPT_DIR/extract_cookies_playwright.js"

    # =====================================================================
    # Method 2.5a — Playwright CDP with dedicated debug profile (BEST)
    # =====================================================================
    if [ -f "$PW_SCRIPT" ] && [ -n "$NODE_BIN" ]; then
        log "Method 2.5a: Playwright CDP (dedicated debug profile)..."

        if [ ! -d "$SCRIPT_DIR/node_modules/playwright" ]; then
            local NPM_BIN; NPM_BIN=$(resolve_real_binary "npm") || true
            [ -n "$NPM_BIN" ] && {
                (cd "$SCRIPT_DIR" && RUN_TIMEOUT_SECONDS=300 RUN_TIMEOUT_RETRIES=1 RUN_TIMEOUT_HARD_CAP=20 \
                    run_with_timeout "run_native_binary \"$NPM_BIN\" install playwright --no-audit --no-fund") || true
                (cd "$SCRIPT_DIR" && RUN_TIMEOUT_SECONDS=300 RUN_TIMEOUT_RETRIES=1 RUN_TIMEOUT_HARD_CAP=20 \
                    run_with_timeout "run_native_binary \"$NPM_BIN\" exec --no -- playwright install msedge") || true
            }
        fi

        local cdp_ready=false
        if check_cdp_running; then
            cdp_ready=true
            ok "  Existing CDP endpoint on $CDP_PORT"
        else
            log "  Launching Edge with dedicated debug profile..."
            launch_edge_with_cdp_debug_profile && cdp_ready=true
        fi

        if [ "$cdp_ready" = true ]; then
            local WIN_COOKIE_PATH; WIN_COOKIE_PATH=$(cygpath -w "$COOKIES_FILE" 2>/dev/null || echo "$COOKIES_FILE")
            log "  Connecting to CDP..."
            log "  You have 120s to sign in if needed."

            ( cd "$SCRIPT_DIR"
              YTL_CDP_URL="$CDP_URL" YTL_TIMEOUT_MS=120000 "$NODE_BIN" "$PW_SCRIPT" edge "$WIN_COOKIE_PATH" 2>&1
            ) | tail -40

            if [ -f "$COOKIES_FILE" ] && [ -s "$COOKIES_FILE" ]; then
                local n; n=$(grep -vc '^#\|^$' "$COOKIES_FILE" 2>/dev/null || echo "0")
                if grep -q "LOGIN_INFO" "$COOKIES_FILE"; then
                    ok "Method 2.5a SUCCESS! ($n cookies, LOGIN_INFO present)"
                    taskkill //F //T //IM msedge.exe 2>/dev/null || true
                    sleep 2
                    export COOKIES_EXPORTED=true
                    return 0
                fi
                warn "Method 2.5a: $n cookies but no LOGIN_INFO"
            fi
            taskkill //F //T //IM msedge.exe 2>/dev/null || true
            sleep 2
        fi
    fi

    # =====================================================================
    # Method 2.5b — Playwright fresh launch with dedicated profile
    # =====================================================================
    if [ -f "$PW_SCRIPT" ] && [ -n "$NODE_BIN" ]; then
        log "Method 2.5b: Playwright fresh launch (dedicated profile)..."
        local WIN_COOKIE_PATH; WIN_COOKIE_PATH=$(cygpath -w "$COOKIES_FILE" 2>/dev/null || echo "$COOKIES_FILE")
        taskkill //F //T //IM msedge.exe 2>/dev/null || true
        sleep 3
        ( cd "$SCRIPT_DIR"
          YTL_PROFILE_DIR="$EDGE_DEBUG_PROFILE_WIN" YTL_TIMEOUT_MS=120000 "$NODE_BIN" "$PW_SCRIPT" edge "$WIN_COOKIE_PATH" 2>&1
        ) | tail -60
        if [ -f "$COOKIES_FILE" ] && [ -s "$COOKIES_FILE" ]; then
            local n; n=$(grep -vc '^#\|^$' "$COOKIES_FILE" 2>/dev/null || echo "0")
            if grep -q "LOGIN_INFO" "$COOKIES_FILE"; then
                ok "Method 2.5b SUCCESS! ($n cookies)"
                export COOKIES_EXPORTED=true
                return 0
            fi
        fi
        warn "Method 2.5b did not produce LOGIN_INFO"
    fi

    log "Killing any remaining Edge processes..."
    taskkill //F //T //IM msedge.exe 2>/dev/null || true
    sleep 5

    # =====================================================================
    # Method 1 — Python multi-strategy
    # =====================================================================
    local EXTRACTOR="$SCRIPT_DIR/extract_cookies.py"
    if [ -f "$EXTRACTOR" ] && [ -n "$PY_BIN" ]; then
        log "Method 1: Python multi-strategy..."
        if "$PY_BIN" "$EXTRACTOR" --browser edge --cookie-path "$COOKIES_FILE" 2>&1 | tail -30; then
            if [ -f "$COOKIES_FILE" ] && [ -s "$COOKIES_FILE" ]; then
                local n; n=$(grep -vc '^#\|^$' "$COOKIES_FILE" 2>/dev/null || echo "0")
                if grep -q "LOGIN_INFO" "$COOKIES_FILE"; then
                    ok "Method 1 SUCCESS! ($n cookies)"
                    export COOKIES_EXPORTED=true
                    return 0
                fi
            fi
        fi
        warn "Method 1 did not produce LOGIN_INFO"
    fi

    # =====================================================================
    # Method 4 — yt-dlp
    # =====================================================================
    local YTDLP_BIN; YTDLP_BIN=$(resolve_real_binary "yt-dlp") || true
    if [ -n "$YTDLP_BIN" ]; then
        log "Method 4: yt-dlp --cookies-from-browser..."
        local TMP_COOKIES="$SCRIPT_DIR/.ytdlp_cookies.tmp"
        "$YTDLP_BIN" --cookies-from-browser edge --cookies "$TMP_COOKIES" \
            --skip-download --flat-playlist --no-warnings --quiet \
            "https://www.youtube.com/watch?v=dQw4w9WgXcQ" 2>&1 | tail -5 || true
        if [ -f "$TMP_COOKIES" ] && [ -s "$TMP_COOKIES" ]; then
            mkdir -p "$(dirname "$COOKIES_FILE")"
            cp "$TMP_COOKIES" "$COOKIES_FILE"
            rm -f "$TMP_COOKIES"
            if grep -q "LOGIN_INFO" "$COOKIES_FILE"; then
                ok "Method 4 SUCCESS!"
                export COOKIES_EXPORTED=true
                return 0
            fi
        fi
    fi

    warn "All extraction methods failed"
    export COOKIES_EXPORTED=false
    return 1
}

manual_cookies_export() {
    step "FALLBACK: MANUAL COOKIES EXPORT"
    echo ""
    echo "=============================================================="
    echo "  AUTOMATIC COOKIE EXTRACTION FAILED"
    echo ""
    echo "  MANUAL EXPORT (one-time, works forever after):"
    echo ""
    echo "  1. Open Edge with the debug profile:"
    echo "     \"C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe\" \\"
    echo "       --user-data-dir=\"$EDGE_DEBUG_PROFILE_WIN\" \\"
    echo "       --remote-debugging-port=$CDP_PORT \\"
    echo "       https://www.youtube.com"
    echo ""
    echo "  2. Sign into YouTube in that window"
    echo "  3. Run 1.bat again — cookies will be auto-extracted"
    echo "=============================================================="
    echo ""
    read -p "Press Enter to continue... " || true
    export COOKIES_EXPORTED=false
    return 1
}

export_cookies_with_fallbacks() {
    local BROWSER="$1"
    step "COOKIE EXTRACTION"
    if kill_edge_and_extract_cookies; then
        export COOKIES_EXPORTED=true
        return 0
    fi
    if check_existing_cookies; then
        export COOKIES_EXPORTED=true
        return 0
    fi
    if declare -F manual_cookies_export >/dev/null 2>&1; then
        if manual_cookies_export; then
            export COOKIES_EXPORTED=true
            return 0
        fi
    fi
    warn "All cookie extraction methods failed!"
    export COOKIES_EXPORTED=false
    return 1
}

# =========================================================================
# NPM DEPENDENCIES
# =========================================================================
install_npm_dependencies() {
    step "INSTALLING NODE.JS DEPENDENCIES"
    [ ! -d "$SERVER_DIR" ] && { error "Server dir not found"; return 1; }
    [ ! -f "$SERVER_DIR/package.json" ] && { warn "No package.json"; return 1; }
    cd "$SERVER_DIR" || { error "Cannot cd"; return 1; }
    local NPM_BIN; NPM_BIN=$(resolve_real_binary "npm") || true
    [ -z "$NPM_BIN" ] && { error "npm not found"; cd "$SCRIPT_DIR"; return 1; }
    RUN_TIMEOUT_SECONDS=600 RUN_TIMEOUT_RETRIES=1 RUN_TIMEOUT_HARD_CAP=20 \
        run_with_timeout "run_native_binary \"$NPM_BIN\" install --no-audit --no-fund"
    cd "$SCRIPT_DIR" || true
}

patch_server() {
    step "PATCHING SERVER CONFIGURATION"
    [ ! -f "$SERVER_JS" ] && { warn "Server file not found"; return 1; }
    local BACKUP_FILE="${SERVER_JS}.backup.$(date +%s)"
    cp "$SERVER_JS" "$BACKUP_FILE" 2>/dev/null
    log "Backup: $BACKUP_FILE"
    if grep -q -- "--cookies-from-browser" "$SERVER_JS" 2>/dev/null && [ -f "$COOKIES_FILE" ]; then
        local SAFE_COOKIES_FILE
        SAFE_COOKIES_FILE=$(echo "$COOKIES_FILE" | sed 's/[\/&]/\\&/g')
        sed -i 's|--cookies-from-browser [^"'\'' ]*|--cookies '"$SAFE_COOKIES_FILE"'|g' "$SERVER_JS" 2>/dev/null && \
            ok "Server patched!" || warn "sed failed"
    else
        ok "Server config looks good!"
    fi
}

copy_modified_files() {
    step "APPLYING ENHANCEMENTS"
    [ -n "$SERVER_DIR" ] && { mkdir -p "$SERVER_DIR/downloads" 2>/dev/null; ok "Downloads dir ready"; }
}

# =========================================================================
# START SERVER (with banner-highlighted output)
# =========================================================================
start_server() {
    step "STARTING SERVER"
    [ ! -f "$SERVER_JS" ] && { error "Server file not found"; return 1; }
    [ ! -d "$SERVER_DIR" ] && { error "Server dir not found"; return 1; }

    local NODE_BIN; NODE_BIN=$(resolve_real_binary "node") || true
    [ -z "$NODE_BIN" ] && { error "node.exe not found"; return 1; }
    log "Using node: $NODE_BIN"

    if [ "$IS_WINDOWS" = true ]; then
        if command -v netstat >/dev/null 2>&1; then
            local PORT_PID
            PORT_PID=$(netstat -ano 2>/dev/null | grep ":$PORT " | grep LISTENING | awk '{print $5}' | head -1 | tr -d '\r')
            [ -n "$PORT_PID" ] && [ "$PORT_PID" != "0" ] && {
                log "Killing PID $PORT_PID on port $PORT"
                taskkill //F //PID "$PORT_PID" 2>/dev/null || true
                sleep 2
            }
        fi
        taskkill //IM node.exe //F 2>/dev/null && { log "Killed node.exe"; sleep 2; } || log "No node.exe running"
    fi

    if [ "$IS_WINDOWS" = true ]; then
        local _win_home="${USERPROFILE:-${HOME}}"
        export DOWNLOADS_DIR="$_win_home/Downloads/YouTube-Downloader"
    else
        export DOWNLOADS_DIR="$HOME/Downloads/YouTube-Downloader"
    fi
    log "DOWNLOADS_DIR=$DOWNLOADS_DIR"

    local FF_BIN; FF_BIN=$(resolve_real_binary "ffmpeg") || true
    [ -n "$FF_BIN" ] && { export PATH="$(dirname "$FF_BIN"):$PATH"; log "FFmpeg dir added to PATH"; }

    cd "$SERVER_DIR" || { error "Cannot cd to server"; return 1; }
    [ ! -d "node_modules/express" ] && {
        warn "express missing - npm install..."
        local NPM_BIN; NPM_BIN=$(resolve_real_binary "npm") || true
        [ -n "$NPM_BIN" ] && RUN_TIMEOUT_SECONDS=600 RUN_TIMEOUT_RETRIES=1 RUN_TIMEOUT_HARD_CAP=20 \
            run_with_timeout "run_native_binary \"$NPM_BIN\" install --no-audit --no-fund"
    }

    # =====================================================================
    # ⭐ Launch Node so that:
    #   - We can filter every line through highlight_line()
    #   - server.log receives the RAW, unfiltered output
    #   - $! is the actual Node PID (not tee's)
    #
    # Technique: exec node inside a subshell so $! is Node's PID.
    # =====================================================================
    local SERVER_LOG="$SCRIPT_DIR/server.log"
    : > "$SERVER_LOG"

    (
        exec "$NODE_BIN" "$SERVER_JS"
    ) > >(
        # Background: tee every raw line into server.log while our
        # foreground process substitution below is fed the same stream.
        tee -a "$SERVER_LOG"
    ) 2>&1 | while IFS= read -r line; do
        highlight_line "$line"
    done &

    # Grab the PID of the *pipeline* leader — which is the subshell
    # running `exec node`. That subshell's PID is Node's PID after exec.
    SERVER_PID=$!

    local _sp_winpid=0
    command -v ps >/dev/null 2>&1 && _sp_winpid=$(ps -W 2>/dev/null | awk -v pid=$SERVER_PID '$1==pid {print $4; exit}')
    _sp_winpid=${_sp_winpid:-0}
    [ "$_sp_winpid" -gt 0 ] 2>/dev/null && { echo "$_sp_winpid" >> "$SCRIPT_DIR/.1sh.pids"; log "Recorded WinPID $_sp_winpid"; }

    log "Waiting for port $PORT..."
    local waited=0 port_up=false
    while [ $waited -lt 15 ]; do
        sleep 1; waited=$((waited + 1))
        command -v netstat >/dev/null 2>&1 && netstat -ano 2>/dev/null | grep -q ":$PORT .*LISTENING" && { port_up=true; break; }
    done

    # Check if node is still alive. Because $SERVER_PID is the pipeline
    # leader, `kill -0` on it is a good liveness check.
    if kill -0 $SERVER_PID 2>/dev/null; then
        [ "$port_up" = true ] && ok "Server up! (PID: $SERVER_PID)" || warn "Server alive but port not listening"
        log "Server at: $URL"
        log "Startup log:"
        tail -10 "$SERVER_LOG" 2>/dev/null | while read line; do log "  $line"; done
        return 0
    else
        error "Server failed to start!"
        tail -20 "$SERVER_LOG" 2>/dev/null | while read line; do error "  $line"; done
        return 1
    fi
}

open_browser() {
    step "OPENING BROWSER"
    if [ "$IS_WINDOWS" = true ]; then
        [ -f /c/Windows/explorer.exe ] && {
            MSYS_NO_PATHCONV=1 /c/Windows/explorer.exe "$URL" < /dev/null > /dev/null 2>&1
            sleep 2; ok "Browser opened: $URL"; return 0
        }
    elif [ "$IS_MAC" = true ]; then
        open "$URL" 2>/dev/null && ok "Browser opened"
    else
        command -v xdg-open >/dev/null 2>&1 && xdg-open "$URL" 2>/dev/null && ok "Browser opened"
    fi
    warn "Please open manually: $URL"
}

keep_terminal_open() {
    echo ""
    echo "+==============================================================+"
    echo "|   SERVER IS RUNNING - KEEP THIS WINDOW OPEN                  |"
    echo "|   URL: ${BOLD}$URL${NC}"
    echo "|   Downloads: ${BOLD}${DOWNLOADS_DIR:-unknown}${NC}"
    echo "|   Cookies: ${BOLD}${COOKIES_EXPORTED:-false}${NC}"
    echo "|   Press Ctrl+C to stop                                       |"
    echo "+==============================================================+"
    echo ""
    while true; do sleep 3600; done
}

# =========================================================================
# MAIN
# =========================================================================
main() {
    echo ""
    echo "+==============================================================+"
    echo "|                                                              |"
    echo "|   YOUTUBE DOWNLOADER - COMPLETE SETUP                        |"
    echo "|                                                              |"
    echo "|   Version 19.0 (banner highlights + CDP cookies)             |"
    echo "|                                                              |"
    echo "+==============================================================+"
    echo ""

    log "Starting setup..."
    log "Script dir: $SCRIPT_DIR"
    log "Debug profile: $EDGE_DEBUG_PROFILE_WIN"
    log "Date: $(date)"
    cd "$SCRIPT_DIR" || { error "Cannot cd"; return 1; }
    echo ""

    add_known_tool_dirs
    refresh_windows_path
    generate_extractor_scripts
    install_missing_tools
    detect_repo_structure
    install_ytdl
    setup_ffmpeg

    local BROWSER
    BROWSER=$(detect_browser) || BROWSER="edge"
    log "Detected browser: $BROWSER"
    test_cookies "$BROWSER"
    export_cookies_with_fallbacks "$BROWSER"

    install_npm_dependencies
    patch_server
    copy_modified_files

    if start_server; then
        open_browser
        echo ""
        echo "+==============================================================+"
        echo "|                   SETUP COMPLETE                             |"
        echo "|  Server: ${BOLD}$URL${NC}"
        echo "|  Downloads: ${BOLD}${DOWNLOADS_DIR:-unknown}${NC}"
        echo "|  Cookies: ${BOLD}${COOKIES_EXPORTED:-false}${NC}"
        echo "+==============================================================+"
        echo ""
        keep_terminal_open
    else
        error "Server failed to start."
        return 1
    fi
}

main "$@"
REM BASH_SCRIPT_END