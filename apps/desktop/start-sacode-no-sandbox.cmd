@echo off
setlocal
set "ELECTRON_RUN_AS_NODE="
if not defined SACODE_DATA_DIR (
  if exist "%~dp0..\..\..\package.json" (
    set "SACODE_DATA_DIR=%~dp0..\..\..\data\sacode"
  ) else (
    set "SACODE_DATA_DIR=%~dp0data\sacode"
  )
)
for %%D in ("%SACODE_DATA_DIR%") do set "SACODE_DATA_DIR=%%~fD"
if not exist "%SACODE_DATA_DIR%\temp" mkdir "%SACODE_DATA_DIR%\temp"
if not exist "%SACODE_DATA_DIR%\temp" (
  echo ERROR: Cannot create the SaCode data folder.
  pause
  exit /b 1
)
set "TEMP=%SACODE_DATA_DIR%\temp"
set "TMP=%TEMP%"
if not exist "%~dp0SaCode.exe" (
  echo ERROR: SaCode.exe was not found beside this launcher.
  pause
  exit /b 1
)
echo WARNING: Chromium sandbox is disabled for this temporary launch.
echo Use this mode only for trusted local work. Do not distribute as a release.
echo Data folder: %SACODE_DATA_DIR%
"%~dp0SaCode.exe" --no-sandbox %*
set "SACODE_LAUNCH_EXIT=%ERRORLEVEL%"
endlocal & exit /b %SACODE_LAUNCH_EXIT%
