@echo off
setlocal EnableExtensions EnableDelayedExpansion
title AI Infinite Canvas - One Click Start
color 0B

cd /d "%~dp0"
set "ROOT=%CD%"
set "BACKEND_DIR=%ROOT%\backend"
set "FRONTEND_URL=http://127.0.0.1:3000"
set "BACKEND_URL=http://127.0.0.1:8000/health"

echo ==========================================
echo    AI Infinite Canvas - One Click Start
echo ==========================================
echo.

call :check_cmd node "Node.js"
if errorlevel 1 exit /b 1
call :check_cmd npm "npm"
if errorlevel 1 exit /b 1
call :check_cmd python "Python"
if errorlevel 1 exit /b 1

if not exist "%BACKEND_DIR%\main.py" (
  echo [ERROR] Backend entry not found: "%BACKEND_DIR%\main.py"
  pause
  exit /b 1
)

echo [1/5] Clearing ports 3000 and 8000...
for %%P in (3000 8000) do (
  for /f "tokens=5" %%I in ('netstat -ano ^| findstr :%%P ^| findstr LISTENING') do (
    taskkill /PID %%I /F >nul 2>nul
  )
)

echo [2/5] Preparing .env.local...
if not exist ".env.local" (
  (
    echo VITE_GEMINI_API_KEY=
    echo VITE_DEV_MODE_PASSWORD=change-this-password
    echo VITE_NODE_VAULT_PASSWORD=change-this-password
    echo VITE_BACKEND_URL=http://127.0.0.1:8000
    echo VITE_EXECUTE_TIMEOUT_MS=0
  ) > ".env.local"
  echo Created .env.local
)

echo [3/5] Checking frontend dependencies...
if not exist "node_modules" (
  echo node_modules not found. Running npm install...
  npm install
  if errorlevel 1 (
    echo [ERROR] npm install failed.
    pause
    exit /b 1
  )
)

echo [4/5] Checking backend dependencies...
python -c "import fastapi, uvicorn, openai, dotenv, pydantic" >nul 2>nul
if errorlevel 1 (
  echo Backend dependencies missing. Running pip install...
  python -m pip install -r "%BACKEND_DIR%\requirements.txt"
  if errorlevel 1 (
    echo [ERROR] Backend dependency install failed.
    pause
    exit /b 1
  )
)

echo [5/5] Starting backend and frontend...
start "AI Canvas Backend" cmd /k "cd /d ""%BACKEND_DIR%"" && python main.py"
start "AI Canvas Frontend" cmd /k "cd /d ""%ROOT%"" && npm run dev -- --host 127.0.0.1 --port 3000"

echo.
echo Backend:  %BACKEND_URL%
echo Frontend: %FRONTEND_URL%
echo.
start "" "%FRONTEND_URL%"
echo If the page opens too early, wait a few seconds and refresh.
pause
exit /b 0

:check_cmd
where %~1 >nul 2>nul
if errorlevel 1 (
  echo [ERROR] %~2 not found in PATH.
  pause
  exit /b 1
)
exit /b 0
