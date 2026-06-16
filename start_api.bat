@echo off
chcp 65001 > nul
echo ============================================
echo   Pre Check Export - API Server
echo ============================================
echo.

REM Check Node.js
node --version > nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] ไม่พบ Node.js - กรุณารัน setup.bat ก่อน
    pause
    exit /b 1
)

REM Check node_modules
if not exist "%~dp0node_modules" (
    echo [ERROR] ยังไม่ได้ติดตั้ง dependencies
    echo กรุณารัน setup.bat ก่อน
    pause
    exit /b 1
)

cd /d "%~dp0"

echo [OK] เริ่มต้น API Server...
echo.
echo ============================================
echo   API Server พร้อมใช้งานที่ port 3002
echo.
echo   วิธีใช้:
echo   1. เปิดลิ้งระบบในเบราว์เซอร์
echo   2. คลิก "เชื่อมต่อฐานข้อมูล"
echo   3. API Server URL: http://localhost:3002
echo   4. กรอกข้อมูลฐานข้อมูลของโรงพยาบาลคุณ
echo.
echo   *** อย่าปิดหน้าต่างนี้ขณะใช้งาน ***
echo ============================================
echo.

node api_example_nodejs.js

echo.
echo [หยุดทำงาน] กด Enter เพื่อปิดหน้าต่าง
pause > nul
