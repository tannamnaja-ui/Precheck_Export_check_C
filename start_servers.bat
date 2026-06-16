@echo off
chcp 65001 > nul
echo ============================================
echo   Pre Check Export - Host Machine
echo   (สำหรับเครื่อง Host + Cloudflare Tunnel)
echo ============================================
echo.

cd /d "%~dp0"

start "Static Server (port 8080)" cmd /k "cd /d "%~dp0" && npx serve . --listen 8080"

timeout /t 2 /nobreak > nul

start "API Server (port 3002)" cmd /k "cd /d "%~dp0" && node api_example_nodejs.js"

timeout /t 3 /nobreak > nul

echo.
echo [OK] Servers started!
echo.
echo   Web (local):  http://localhost:8080
echo   API:          http://localhost:3002
echo.
echo ต้องการเปิด Cloudflare Tunnel ด้วยไหม?
echo กด Y เพื่อเปิด Tunnel, Enter เพื่อข้าม
choice /c YN /n /t 10 /d N
if %errorlevel%==1 (
    start "Cloudflare Tunnel" cmd /k "C:\Users\%USERNAME%\cloudflared.exe tunnel --url http://localhost:3002 --no-autoupdate"
    echo [OK] Cloudflare Tunnel กำลังเริ่มต้น...
    echo      URL จะแสดงในหน้าต่าง Cloudflare Tunnel
)

echo.
pause
