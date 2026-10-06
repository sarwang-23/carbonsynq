@echo off
setlocal
cd /d "%~dp0backend"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required. Install Node.js 22 or 24.
  pause
  exit /b 1
)
if not exist ".env" (
  echo Copy your WORKING invoice backend .env into the backend folder first.
  echo Reuse your existing Supabase, database and provider credentials.
  echo If that backend is already running on port 5000, start only START_DEMO_WINDOWS.bat.
  pause
  exit /b 1
)
if not exist "node_modules\.bin\tsx.cmd" (
  echo Installing backend dependencies...
  call npm ci
  if errorlevel 1 (
    echo Installation failed. Check internet access and the Node.js version.
    pause
    exit /b 1
  )
)
echo Starting invoice backend on its configured port, normally 5000.
call npm run dev
pause
