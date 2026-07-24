@echo off
setlocal
chcp 65001 >nul
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\deploy-worker.ps1"
set "EXIT_CODE=%ERRORLEVEL%"
echo.
if not "%EXIT_CODE%"=="0" (
  echo 検査に失敗しました。終了コード: %EXIT_CODE%
) else (
  echo 検査が完了しました。本番デプロイは行っていません。
)
pause
endlocal & exit /b %EXIT_CODE%
