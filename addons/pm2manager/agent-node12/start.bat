@echo off
setlocal enabledelayedexpansion

:: ─────────────────────────────────────────────────────────────────────────────
:: pm2-agent\start.bat  –  Start the agent.
::              With PM2 available: registers it as a PM2 process and saves the
::              process list, so it comes back after a reboot (pm2 resurrect).
::              Otherwise: runs in the foreground with Node.js.
::
:: Pass `nopause` as the first argument to skip the trailing pause (install.bat does).
:: ─────────────────────────────────────────────────────────────────────────────

for %%I in ("%~dp0.") do set "AGENT=%%~fI"

for /f %%a in ('echo prompt $E^| cmd /Q') do set "ESC=%%a"
set "CY=%ESC%[36m" & set "GN=%ESC%[32m" & set "YW=%ESC%[33m"
set "RD=%ESC%[31m" & set "BD=%ESC%[1m"  & set "RS=%ESC%[0m"

echo.
echo %BD%%CY%pm2-agent ^— Start%RS%
echo.

where node >nul 2>&1 || (echo %RD%[ERROR]%RS% Node.js not found. Run install.bat first. & pause & exit /b 1)

cd /d "%AGENT%"

if not exist ".env" (echo %RD%[ERROR]%RS% .env not found. Run install.bat first. & pause & exit /b 1)
if not exist "node_modules" (echo %RD%[ERROR]%RS% Dependencies not installed. Run install.bat first. & pause & exit /b 1)

:: Read PORT and HOST from .env
:: (pipe through findstr so cmd strips \r from CRLF line endings)
set "AGENT_PORT=7003"
set "AGENT_HOST=0.0.0.0"
for /f "tokens=1,* delims==" %%A in ('findstr /B /C:"PORT=" /C:"HOST=" "%AGENT%\.env"') do (
    if "%%A"=="PORT" set "AGENT_PORT=%%B"
    if "%%A"=="HOST" set "AGENT_HOST=%%B"
)
set "APP_NAME=pm2-agent:%AGENT_PORT%"

:: ── PM2 branch ────────────────────────────────────────────────────────────────
where pm2 >nul 2>&1
if not errorlevel 1 (
    echo %CY%[INFO]%RS%  PM2 detected — starting as a PM2 process.
    echo.

    call pm2 describe "%APP_NAME%" >nul 2>&1
    if not errorlevel 1 (
        echo %YW%[WARN]%RS%  Existing PM2 process '%APP_NAME%' found ^— deleting...
        call pm2 delete "%APP_NAME%"
    )

    :: --cwd pins the process to the agent folder so PM2 keeps it there across resurrects,
    :: which is what makes the .env next to it load on every restart.
    call pm2 start "%AGENT%\src\app.js" --name "%APP_NAME%" --cwd "%AGENT%" --log-date-format "YYYY-MM-DD HH:mm:ss" --restart-delay 3000 --max-restarts 10
    if errorlevel 1 (
        echo %RD%[ERROR]%RS% PM2 start failed. Check output above.
        if /i not "%~1"=="nopause" pause
        exit /b 1
    )

    call pm2 save
    echo.
    :: `!` escaped as `^!` — delayed expansion otherwise eats it as a variable marker
    echo %GN%[ OK ]%RS%  pm2-agent is running^!
    echo   Health : %BD%http://%AGENT_HOST%:%AGENT_PORT%/health%RS%
    echo   Logs   : %BD%pm2 logs %APP_NAME%%RS%
    echo   Status : %BD%pm2 status%RS%
    echo   Stop   : %BD%pm2 stop %APP_NAME%%RS%
    echo.
    if /i not "%~1"=="nopause" pause
    exit /b 0
)

:: ── Node fallback ─────────────────────────────────────────────────────────────
echo %YW%[WARN]%RS%  PM2 not found — starting in foreground with Node.js.
echo %CY%[INFO]%RS%  Press Ctrl-C to stop.
echo.
node "%AGENT%\src\app.js"
