@echo off
setlocal
cd /d "%~dp0"

where python >nul 2>nul
if errorlevel 1 (
  echo Python was not found. The frontend will start without the FEMA proxy.
) else (
  start "FEMA flavor proxy" /min python "%cd%\fema_proxy_server.py"
)

cd /d "%~dp0frontend"
if not exist "node_modules" (
  call npm install
  if errorlevel 1 exit /b 1
)

call npm run dev -- --host 127.0.0.1 --port 5173
endlocal
