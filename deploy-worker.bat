@echo off
setlocal
chcp 65001 >nul
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\deploy-worker.ps1" -Deploy
set "EXIT_CODE=%ERRORLEVEL%"
echo.
if not "%EXIT_CODE%"=="0" (
  echo デプロイに失敗または中止しました。終了コード: %EXIT_CODE%
) else (
  echo 正しいAPI Workerへのデプロイが完了しました。
)
pause
endlocal & exit /b %EXIT_CODE%
