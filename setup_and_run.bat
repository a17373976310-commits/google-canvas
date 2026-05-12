@echo off
setlocal EnableExtensions
title AI Infinite Canvas - Setup and Run

cd /d "%~dp0"
set "ROOT=%CD%"
set "BACKEND_DIR=%ROOT%\backend"
set "FRONTEND_PORT=5173"

echo ========================================
echo AI Infinite Canvas - Setup and Run
echo ========================================
echo.

echo [1/6] Checking Node.js / npm...
where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] node not found in PATH.
  echo Install Node.js 22-24 and run this script again.
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo [ERROR] npm not found in PATH.
  echo Install Node.js 22-24 and run this script again.
  pause
  exit /b 1
)

echo [2/6] Checking Python...
where python >nul 2>nul
if errorlevel 1 (
  echo [ERROR] python not found in PATH.
  echo Install Python 3.11+ and run this script again.
  pause
  exit /b 1
)

echo [3/6] Preparing .env.local...
if not exist ".env.local" (
  (
    echo VITE_GEMINI_API_KEY=
    echo VITE_DEV_MODE_PASSWORD=change-this-password
    echo VITE_NODE_VAULT_PASSWORD=change-this-password
    echo VITE_BACKEND_URL=http://127.0.0.1:8000
    echo VITE_EXECUTE_TIMEOUT_MS=0
  ) > ".env.local"
  echo Created .env.local
) else (
  findstr /b /c:"VITE_BACKEND_URL=" ".env.local" >nul
  if errorlevel 1 >> ".env.local" echo VITE_BACKEND_URL=http://127.0.0.1:8000
)

echo [4/6] Installing backend dependencies...
python -m pip install -r "%BACKEND_DIR%\requirements.txt"
if errorlevel 1 (
  echo [ERROR] Backend dependency install failed.
  pause
  exit /b 1
)

echo [5/6] Installing frontend dependencies...
npm install
if errorlevel 1 (
  echo [ERROR] Frontend dependency install failed.
  pause
  exit /b 1
)

echo [6/6] Starting backend...
start "AI Canvas Backend" cmd /k "cd /d ""%BACKEND_DIR%"" && python main.py"

echo.
echo Backend:  http://127.0.0.1:8000/health
echo Frontend: http://127.0.0.1:%FRONTEND_PORT%
echo.
echo Starting frontend now...
npm run dev -- --host 127.0.0.1 --port %FRONTEND_PORT%

pause
