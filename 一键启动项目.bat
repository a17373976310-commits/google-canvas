@echo off
setlocal EnableExtensions EnableDelayedExpansion
title AI Infinite Canvas - One Click Start
color 0B

cd /d "%~dp0"
set "ROOT=%CD%"
set "BACKEND_DIR=%ROOT%\backend"
set "FRONTEND_PORT=5173"
set "FRONTEND_URL=http://127.0.0.1:%FRONTEND_PORT%"
set "BACKEND_URL=http://127.0.0.1:8000/health"
set "STARTUP_TIMEOUT_SECONDS=60"

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

echo [1/5] Clearing ports 3000, %FRONTEND_PORT% and 8000...
for %%P in (3000 %FRONTEND_PORT% 8000) do (
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
start "AI Canvas Frontend" cmd /k "cd /d ""%ROOT%"" && npm run dev -- --host 127.0.0.1 --port %FRONTEND_PORT%"

echo.
echo Backend:  %BACKEND_URL%
echo Frontend: %FRONTEND_URL%
echo.

echo Waiting for frontend to become available...
call :wait_url "%FRONTEND_URL%" %STARTUP_TIMEOUT_SECONDS%
if errorlevel 1 (
  echo [WARN] Frontend did not respond within %STARTUP_TIMEOUT_SECONDS% seconds.
  echo Keep the server windows open, then open this URL manually when ready:
  echo %FRONTEND_URL%
  pause
  exit /b 1
)

echo Frontend is ready. Opening browser...
start "" "%FRONTEND_URL%"
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

:wait_url
set "WAIT_URL=%~1"
set /a "WAIT_TIMEOUT=%~2"
if %WAIT_TIMEOUT% LEQ 0 set "WAIT_TIMEOUT=60"

for /l %%S in (1,1,%WAIT_TIMEOUT%) do (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $r = Invoke-WebRequest -Uri '%WAIT_URL%' -UseBasicParsing -TimeoutSec 2; if ($r.StatusCode -ge 200 -and $r.StatusCode -lt 500) { exit 0 } } catch { }; exit 1" >nul 2>nul
  if not errorlevel 1 (
    exit /b 0
  )
  <nul set /p="."
  timeout /t 1 /nobreak >nul
)
echo.
exit /b 1
