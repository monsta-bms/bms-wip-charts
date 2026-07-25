@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\deploy-worker.ps1" -Deploy
set "EXIT_CODE=%ERRORLEVEL%"
echo.
if not "%EXIT_CODE%"=="0" (
  echo Deployment failed or was canceled. Exit code: %EXIT_CODE%
) else (
  echo Deployment to the API Worker completed successfully.
)
echo.
if not defined SAFE_WORKER_DEPLOY_NO_PAUSE pause
endlocal & exit /b %EXIT_CODE%
