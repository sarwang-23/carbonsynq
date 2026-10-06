@echo off
setlocal
cd /d "%~dp0"
if not exist "backend\.env" (
  echo Copy your WORKING invoice backend .env to backend\.env first.
  echo If the backend already runs on port 5000, use START_DEMO_WINDOWS.bat instead.
  pause
  exit /b 1
)
start "CarbonSynq Invoice Backend" cmd /c call "%~dp0START_INVOICE_BACKEND_WINDOWS.bat"
start "CarbonSynq University Frontend" cmd /c call "%~dp0START_DEMO_WINDOWS.bat"
echo Keep both terminal windows open.
echo Open http://localhost:3000/auth/signin and click Open university demo.
