@echo off
title YouTube Downloader

REM ── Locate bash.exe from Git for Windows ──
set "BASH_EXE="

REM 1) Try PATH first
where bash >nul 2>&1 && for /f "delims=" %%i in ('where bash') do set "BASH_EXE=%%i" & goto :found

REM 2) Common install locations
for %%p in (
    "%ProgramFiles%\Git\bin\bash.exe"
    "%ProgramFiles(x86)%\Git\bin\bash.exe"
    "%LocalAppData%\Programs\Git\bin\bash.exe"
    "%USERPROFILE%\scoop\apps\git\current\bin\bash.exe"
) do (
    if exist %%p set "BASH_EXE=%%~p" & goto :found
)

REM 3) Derive from git.exe in PATH
for /f "delims=" %%i in ('where git 2^>nul') do (
    set "BASH_EXE=%%~dpi\bash.exe"
    if exist "!BASH_EXE!" goto :found
)

echo ERROR: Could not find bash.exe. Is Git for Windows installed?
echo.
pause
exit /b 1

:found
REM Kill orphan processes that are hogging PTY slots.
REM This runs BEFORE bash starts, so it actually works.
taskkill /F /IM mintty.exe  >nul 2>&1
taskkill /F /IM sleep.exe   >nul 2>&1

REM Wait a moment for handles to release.
timeout /t 1 /nobreak >nul

REM Run 1.sh in THIS console window (no new mintty = no PTY fork).
REM %~dp0 expands to the folder where this .bat lives.
"%BASH_EXE%" --login "%~dp01.sh"

REM If bash exits with error, keep window open so user can read it.
if errorlevel 1 (
    echo.
    echo Script exited with an error. Press any key to close...
    pause >nul
)
