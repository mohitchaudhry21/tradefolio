@echo off
title TradeFolio Launcher
echo.
echo  TradeFolio - Starting up...
echo  ============================================
echo.

:: Move to app folder
cd /d "%~dp0"

:: ── Check Python ─────────────────────────────
where python >nul 2>&1
if errorlevel 1 (
    echo  ERROR: Python not found.
    echo  Please install Python from https://python.org
    echo  Make sure to tick "Add Python to PATH" during install.
    echo.
    pause
    exit /b
)

:: ── Check Node / npm ─────────────────────────
where npm >nul 2>&1
if errorlevel 1 (
    echo  ERROR: Node.js / npm not found.
    echo  Please install Node.js from https://nodejs.org
    echo  Then restart your computer and try again.
    echo.
    pause
    exit /b
)

:: ── Install packages if missing ───────────────
if not exist "%~dp0node_modules" (
    echo  node_modules missing - running npm install...
    echo  This takes 1-2 minutes on first run. Please wait.
    echo.
    call npm install
    echo.
)

:: ── Launch server in its own window ──────────
echo  Starting sync server...
start "TradeFolio - Sync Server" /d "%~dp0sync-server" cmd /k python server.py

:: ── Wait a moment ─────────────────────────────
timeout /t 2 /nobreak >nul

:: ── Launch app in its own window ─────────────
echo  Starting app...
start "TradeFolio - App" /d "%~dp0" cmd /k npm start

echo.
echo  ============================================
echo  Both are starting!
echo  Browser will open at http://localhost:3000
echo  Keep both black windows OPEN.
echo  ============================================
echo.
pause
