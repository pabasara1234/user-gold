@echo off
setlocal
cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
  echo Python environment not found. Follow the setup instructions in README.md first.
  pause
  exit /b 1
)
if not exist "dist\index.html" (
  echo Built app not found. Run npm run build first.
  pause
  exit /b 1
)

if exist "%~dp0api\.env.backend" (
  for /f "usebackq eol=# tokens=1,* delims==" %%A in ("%~dp0api\.env.backend") do if not "%%A"=="" set "%%A=%%B"
)

curl.exe --silent --fail --max-time 2 "http://127.0.0.1:8000/" >nul 2>nul
if errorlevel 1 (
  start "MyView Market Lab" /D "%~dp0api" "%~dp0.venv\Scripts\python.exe" -m uvicorn main:app --host 127.0.0.1 --port 8000
)
timeout /t 3 /nobreak >nul
start "" "http://127.0.0.1:8000"
