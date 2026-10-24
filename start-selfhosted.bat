@echo off
setlocal
cd /d "%~dp0"

echo Starting FlexVault Self-Hosted Server...
echo.

if not exist .env (
    copy .env.selfhosted.example .env >nul
    echo Created .env from .env.selfhosted.example.
    echo Edit .env ^(at minimum JWT_SECRET^) and run this script again.
    exit /b 1
)

if not exist node_modules\.bin\tsx.cmd (
    echo Dependencies are not installed. Run: npm install
    exit /b 1
)

rem The server loads .env itself via dotenv; no manual export needed.
call node_modules\.bin\tsx.cmd --loader ./src/selfhosted/cloudflare-workers-loader.mjs ./src/selfhosted/index.ts
