@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\local_runtime.ps1" start
exit /b %errorlevel%
