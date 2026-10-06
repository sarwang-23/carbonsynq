@echo off
setlocal
cd /d "%~dp0frontend"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required. Install Node.js 22 or 24, then run this file again.
  pause
  exit /b 1
)
echo Installing the locked frontend dependencies...
call npm ci
if errorlevel 1 (
  echo Installation failed. Check your internet connection and Node.js version.
  pause
  exit /b 1
)
echo.
echo Open http://localhost:3000/auth/signin
echo Click "Open university demo". For invoice uploads, keep your configured backend running on port 5000.
call npm run dev -- --hostname 127.0.0.1
pause
