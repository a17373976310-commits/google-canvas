@echo off
setlocal EnableExtensions
title AI Infinite Canvas - Start Only

cd /d "%~dp0"
set "ROOT=%CD%"
set "BACKEND_DIR=%ROOT%\backend"

echo ========================================
echo AI Infinite Canvas - Start Only
echo ========================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] node not found. Please install Node.js first.
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo [ERROR] npm not found. Please install Node.js first.
  pause
  exit /b 1
)

where python >nul 2>nul
if errorlevel 1 (
  echo [ERROR] python not found. Please install Python first.
  pause
  exit /b 1
)

if not exist "%BACKEND_DIR%\main.py" (
  echo [ERROR] backend\main.py not found.
  pause
  exit /b 1
)

echo Starting backend in a new window...
start "AI Canvas Backend" cmd /k "cd /d ""%BACKEND_DIR%"" && python main.py"

echo Starting frontend in this window...
echo Frontend: http://127.0.0.1:3000
echo Backend:  http://127.0.0.1:8000/health
echo.

npm run dev -- --host 127.0.0.1 --port 3000

pause
