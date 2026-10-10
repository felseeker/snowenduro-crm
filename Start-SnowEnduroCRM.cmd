@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 24 is required. Install Node.js 24, then run this file again.
  pause
  exit /b 1
)

node -e "if (Number(process.versions.node.split('.')[0]) < 24) process.exit(1)"
if errorlevel 1 (
  echo Node.js 24 or newer is required. Current version:
  node --version
  pause
  exit /b 1
)

if not exist "node_modules\vite\bin\vite.js" (
  echo Installing CRM dependencies...
  call npm ci
  if errorlevel 1 exit /b 1
)

echo Building SnowEnduro CRM...
call npm run build
if errorlevel 1 (
  echo The build failed. CRM was not started.
  pause
  exit /b 1
)

if not defined LOCALAPPDATA (
  echo Windows local application data folder was not found.
  pause
  exit /b 1
)

set "HOST=127.0.0.1"
set "PORT=4173"
set "CRM_DATA_DIR=%LOCALAPPDATA%\SnowEnduroCRM\data"
if not exist "%CRM_DATA_DIR%" mkdir "%CRM_DATA_DIR%"
if not exist "%LOCALAPPDATA%\SnowEnduroCRM\.env" copy /y ".env.example" "%LOCALAPPDATA%\SnowEnduroCRM\.env" >nul

echo.
echo SnowEnduro CRM is available at http://127.0.0.1:4173
echo CRM data stays in %LOCALAPPDATA%\SnowEnduroCRM, outside this GitHub project.
echo Keep this window open while using CRM. Close it to stop the server.
echo The page is not opened automatically.
echo.
node --env-file-if-exists="%LOCALAPPDATA%\SnowEnduroCRM\.env" server\index.mjs
