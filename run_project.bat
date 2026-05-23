@echo off
echo ==============================================
echo        Starting MedicaLy Application
echo ==============================================

:: ============================================================
:: Step 0: Kill any stale processes on port 8000
:: ============================================================
echo [0/2] Cleaning up stale processes...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8000.*LISTENING" 2^>nul') do (
    taskkill /PID %%a /F >nul 2>&1
)
timeout /t 2 /nobreak > nul

:: ============================================================
:: Step 1: Start Backend Server using venv Python
:: ============================================================
echo [1/2] Starting Server...

IF NOT EXIST "%~dp0backend\venv\Scripts\python.exe" (
    echo ERROR: venv not found at backend\venv\Scripts\python.exe
    echo Please run: cd backend ^&^& python -m venv venv ^&^& venv\Scripts\pip install -r ..\requirements.txt
    pause
    exit /b 1
)

start "MedicaLy Server" cmd /k "cd /d "%~dp0backend" && venv\Scripts\python.exe -m uvicorn main:app --reload --host 127.0.0.1 --port 8000"

:: ============================================================
:: Step 2: Wait and open browser
:: ============================================================
echo [2/2] Opening browser in 3 seconds...
timeout /t 3 /nobreak > nul
start http://127.0.0.1:8000/index.html

echo.
echo =============================================
echo  MedicaLy is running!
echo  Application is available at: http://127.0.0.1:8000
echo =============================================
echo  Close the server window to stop.
echo =============================================
pause
