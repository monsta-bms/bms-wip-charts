@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\deploy-worker.ps1"
set "EXIT_CODE=%ERRORLEVEL%"
echo.
if not "%EXIT_CODE%"=="0" (
  echo Safety check failed. Exit code: %EXIT_CODE%
) else (
  echo Safety check completed. No production deployment was performed.
)
echo.
if not defined SAFE_WORKER_DEPLOY_NO_PAUSE pause
endlocal & exit /b %EXIT_CODE%
