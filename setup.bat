@echo off
chcp 65001 > nul
echo ============================================
echo   ติดตั้งระบบ Pre Check Export
echo   (รันครั้งแรกเท่านั้น)
echo ============================================
echo.

REM Check Node.js
node --version > nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] ไม่พบ Node.js บนเครื่องนี้
    echo.
    echo กรุณาติดตั้ง Node.js ก่อน:
    echo   1. เปิดเว็บ https://nodejs.org
    echo   2. ดาวน์โหลด LTS version
    echo   3. ติดตั้งแล้วรัน setup.bat อีกครั้ง
    echo.
    pause
    exit /b 1
)

echo [OK] พบ Node.js version:
node --version
echo.

REM Install dependencies
echo กำลังติดตั้ง dependencies...
cd /d "%~dp0"
npm install

if %errorlevel% neq 0 (
    echo.
    echo [ERROR] ติดตั้ง dependencies ไม่สำเร็จ
    pause
    exit /b 1
)

echo.
echo ============================================
echo   ติดตั้งเสร็จสมบูรณ์!
echo   ครั้งต่อไปให้ double-click: start_api.bat
echo ============================================
echo.
pause
