rem Check if PM2 is installed
where pm2 >nul 2>nul
if %errorlevel% neq 0 (
    echo PM2 is not installed. Please install PM2 before running this script.
    exit /b 1
)

rem If PM2 is installed, start the server and check its status
pm2 start server.js --name "centrix-helper:9999" --log-date-format "YYYY-MM-DD HH:mm:ss" && pm2 save && start "" "http://localhost:9999"
pause