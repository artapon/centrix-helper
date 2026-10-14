@echo off
:: Check if .env already exists
if not exist ".env" (
    echo .env does not exist. Renaming .env.example to .env...
    :: Check if .env.example exists
    if exist ".env.example" (
        rename ".env.example" ".env"
        echo Renamed .env.example to .env successfully.
    ) else (
        echo .env.example does not exist. Cannot rename.
    )
) else (
    echo .env already exists. No action needed.
)

:: Check if db.config.js already exists
if not exist "db.config.js" (
    echo db.config.js does not exist. Renaming db.config.example.js to db.config.js...
    :: Check if db.config.example.js exists
    if exist "db.config.example.js" (
        rename "db.config.example.js" "db.config.js"
        echo Renamed db.config.example.js to db.config.js successfully.
    ) else (
        echo db.config.example.js does not exist. Cannot rename.
    )
) else (
    echo db.config.js already exists. No action needed.
)

:: Check if link.config.js already exists
if not exist "link.config.js" (
    echo link.config.js does not exist. Renaming link.config.example.js to link.config.js...
    :: Check if link.config.example.js exists
    if exist "link.config.example.js" (
        rename "link.config.example.js" "link.config.js"
        echo Renamed link.config.example.js to link.config.js successfully.
    ) else (
        echo link.config.example.js does not exist. Cannot rename.
    )
) else (
    echo link.config.js already exists. No action needed.
)

:: Check if menu.config.js already exists
if not exist "menu.config.js" (
    echo menu.config.js does not exist. Renaming menu.config.example.js to menu.config.js...
    :: Check if menu.config.example.js exists
    if exist "menu.config.example.js" (
        rename "menu.config.example.js" "menu.config.js"
        echo Renamed menu.config.example.js to menu.config.js successfully.
    ) else (
        echo menu.config.example.js does not exist. Cannot rename.
    )
) else (
    echo menu.config.js already exists. No action needed.
)

npm install
pause