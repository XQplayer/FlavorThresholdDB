@echo off
setlocal
cd /d "%~dp0"

set "CODEX_NODE_BIN=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin"
set "CODEX_PYTHON_EXE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
set "CODEX_PNPM=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\fallback\pnpm.cmd"

where node >nul 2>nul
if errorlevel 1 if exist "%CODEX_NODE_BIN%\node.exe" set "PATH=%CODEX_NODE_BIN%;%PATH%"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install Node.js 22 or start this project from Codex.
  exit /b 1
)

set "PYTHON_EXE=python"
set "PYTHON_AVAILABLE="
python -c "import sys" >nul 2>nul
if not errorlevel 1 set "PYTHON_AVAILABLE=1"
if not defined PYTHON_AVAILABLE if exist "%CODEX_PYTHON_EXE%" (
  set "PYTHON_EXE=%CODEX_PYTHON_EXE%"
  set "PYTHON_AVAILABLE=1"
)

if /i "%~1"=="--check" (
  echo Node.js runtime: available
  if defined PYTHON_AVAILABLE (echo Python runtime: available) else (echo Python runtime: unavailable; FEMA proxy disabled)
  where npm >nul 2>nul
  if not errorlevel 1 (
    echo Package manager: npm
    exit /b 0
  )
  if exist "%CODEX_PNPM%" (
    echo Package manager: pnpm
    exit /b 0
  )
  echo Package manager: unavailable
  exit /b 1
)

if defined PYTHON_AVAILABLE (
  start "FEMA flavor proxy" /min "%PYTHON_EXE%" "%~dp0fema_proxy_server.py"
) else (
  echo Python was not found. The frontend will start without the FEMA proxy.
)

cd /d "%~dp0frontend"
if not exist "node_modules" (
  where npm >nul 2>nul
  if not errorlevel 1 (
    call npm install
  ) else if exist "%CODEX_PNPM%" (
    call "%CODEX_PNPM%" install
  ) else (
    echo npm or pnpm was not found.
    exit /b 1
  )
  if errorlevel 1 exit /b 1
)

where npm >nul 2>nul
if not errorlevel 1 (
  call npm run dev -- --host 127.0.0.1 --port 5173
) else if exist "%CODEX_PNPM%" (
  call "%CODEX_PNPM%" run dev --host 127.0.0.1 --port 5173
) else (
  echo npm or pnpm was not found.
  exit /b 1
)
endlocal
