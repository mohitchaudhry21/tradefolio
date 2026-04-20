@echo off
title TradeFolio - Sync Server
cd /d "%~dp0sync-server"
echo.
echo  ============================================
echo   TradeFolio Sync Server
echo  ============================================
echo.
python server.py
pause
