@echo off
echo Starting NodeWarden Self-Hosted Server...
echo.

if not exist .env (
    echo Creating .env file from example...
    copy .env.selfhosted.example .env
    echo.
    echo Please edit .env file with your configuration and run again.
    echo.
    notepad .env
    exit /b 1
)

echo Loading environment from .env...
for /f "tokens=1,2 delims==" %%a in (.env) do (
    if not "%%a"=="" if not "%%a:~0,1%"=="#" (
        set "%%a=%%b"
    )
)

echo.
echo Starting server...
node dist/src/selfhosted/index.js
