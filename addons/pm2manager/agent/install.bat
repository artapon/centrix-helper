@echo off
setlocal enabledelayedexpansion

:: ─────────────────────────────────────────────────────────────────────────────
:: pm2-agent\install.bat  –  Install the agent on a server that pm2-admin polls.
::                          Copy the whole pm2-agent folder to the target machine
::                          and run this file there.
:: ─────────────────────────────────────────────────────────────────────────────

:: AGENT = the folder this file lives in
for %%I in ("%~dp0.") do set "AGENT=%%~fI"

:: ANSI colours (Windows 10 1511+)
for /f %%a in ('echo prompt $E^| cmd /Q') do set "ESC=%%a"
set "CY=%ESC%[36m" & set "GN=%ESC%[32m" & set "YW=%ESC%[33m"
set "RD=%ESC%[31m" & set "BD=%ESC%[1m"  & set "RS=%ESC%[0m"

echo.
echo %BD%%CY%pm2-agent ^— Install%RS%
echo.

:: ── 1. Node.js ────────────────────────────────────────────────────────────────
where node >nul 2>&1 || (
    echo %RD%[ERROR]%RS% Node.js not found. Install v16+ from https://nodejs.org
    pause & exit /b 1
)
set "NODE_MAJOR=0"
for /f "tokens=*" %%V in ('node -e "process.stdout.write(process.versions.node.split('.')[0])" 2^>nul') do set "NODE_MAJOR=%%V"
if !NODE_MAJOR! LSS 16 (
    echo %RD%[ERROR]%RS% Node.js v16+ required. Found: & node -v
    pause & exit /b 1
)
echo %GN%[ OK ]%RS%  Node.js & node -v

:: ── 2. PM2 ────────────────────────────────────────────────────────────────────
:: The agent reads PM2 through its module (or the CLI as a fallback), so PM2 must be
:: present even before the agent is registered as a PM2 process itself.
where pm2 >nul 2>&1
if errorlevel 1 (
    echo %YW%[WARN]%RS%  PM2 not found. Installing globally...
    call npm install -g pm2 || ( echo %RD%[ERROR]%RS% PM2 install failed. & pause & exit /b 1 )
)
echo %GN%[ OK ]%RS%  PM2 & call pm2 -v

:: The config comes first: a failed npm install must not leave the agent without a .env,
:: or start.bat refuses to run and the fix is not obvious.
:: ── 3. Environment file + agent token ─────────────────────────────────────────
echo.
echo %CY%Configuring environment...%RS%
cd /d "%AGENT%"
call node "%AGENT%\scripts\setup-env.js" || ( echo %RD%[ERROR]%RS% Could not create .env. & pause & exit /b 1 )

:: ── 4. Dependencies ───────────────────────────────────────────────────────────
echo.
echo %CY%Installing dependencies...%RS%
call npm install || ( echo %RD%[ERROR]%RS% npm install failed. & pause & exit /b 1 )
echo %GN%[ OK ]%RS%  Dependencies installed.

:: ── 5. Read back the port for the hints below ─────────────────────────────────
set "AGENT_PORT=7003"
for /f "tokens=1,* delims==" %%A in ('findstr /B /C:"PORT=" "%AGENT%\.env"') do (
    if "%%A"=="PORT" set "AGENT_PORT=%%B"
)

:: ── 6. Register with PM2 ──────────────────────────────────────────────────────
echo.
set /p "START_NOW=Start the agent under PM2 now? [Y/n]: "
if /i "!START_NOW!"=="n" goto :done
call "%AGENT%\start.bat" nopause
if errorlevel 1 (
    echo %RD%[ERROR]%RS% Agent failed to start. See the output above.
    pause & exit /b 1
)

:done
echo.
:: `!` must be escaped as `^!` — delayed expansion otherwise eats it as a variable marker
echo %GN%Installation complete^!%RS%
echo.
echo   Next steps:
echo   1. Allow the port through the firewall ^(run as Administrator^):
echo      %BD%netsh advfirewall firewall add rule name="pm2-agent" dir=in action=allow protocol=TCP localport=!AGENT_PORT!%RS%
echo   2. Restrict who may call it — set %BD%AGENT_ALLOWED_IPS%RS% in %BD%.env%RS% to the pm2-admin server IP.
echo   3. In pm2-admin, add this server with its address, port and the AGENT_TOKEN above.
echo.
echo   Verify from the pm2-admin machine:
echo     %BD%curl http://^<this-server^>:!AGENT_PORT!/health%RS%
echo.
pause
