# คู่มือการติดตั้งฐานข้อมูลทดสอบ

## 📋 ข้อกำหนดเบื้องต้น

1. **MySQL Server** (แนะนำ version 8.0 หรือสูงกว่า)
2. **Node.js** (สำหรับ Backend API)
3. **npm** (สำหรับติดตั้ง dependencies)

---

## 🚀 ขั้นตอนการติดตั้ง

### 1. ติดตั้ง MySQL Server (ถ้ายังไม่มี)

#### Windows:
- ดาวน์โหลดจาก: https://dev.mysql.com/downloads/installer/
- เลือก "MySQL Installer for Windows"
- ติดตั้งด้วย default settings
- จดจำ **root password** ที่ตั้งไว้

#### MacOS:
```bash
brew install mysql
brew services start mysql
```

#### Linux (Ubuntu/Debian):
```bash
sudo apt update
sudo apt install mysql-server
sudo systemctl start mysql
```

---

### 2. สร้างฐานข้อมูลทดสอบ

#### วิธีที่ 1: ใช้ MySQL Command Line
```bash
# เข้าสู่ MySQL
mysql -u root -p

# รันสคริปต์สร้างฐานข้อมูล
source "d:/work/งาน IM/Project/Project pre check export/create_test_database.sql"

# หรือใน Linux/Mac
source /path/to/create_test_database.sql
```

#### วิธีที่ 2: ใช้ MySQL Workbench
1. เปิด MySQL Workbench
2. เชื่อมต่อกับ MySQL Server
3. เปิดไฟล์ `create_test_database.sql`
4. คลิก ⚡ Execute (หรือกด Ctrl+Shift+Enter)

#### วิธีที่ 3: ใช้ Command Line โดยตรง
```bash
mysql -u root -p < "d:/work/งาน IM/Project/Project pre check export/create_test_database.sql"
```

---

### 3. ตรวจสอบว่าฐานข้อมูลสร้างสำเร็จ

```bash
# เข้า MySQL
mysql -u root -p

# ตรวจสอบฐานข้อมูล
SHOW DATABASES;

# ใช้ฐานข้อมูลทดสอบ
USE hos_test;

# ตรวจสอบตาราง
SHOW TABLES;

# ดูข้อมูลโรงพยาบาล
SELECT * FROM opdconfig;
```

**ผลลัพธ์ที่คาดหวัง:**
```
+--------------+--------------------------------+
| hospitalcode | hospitalname                   |
+--------------+--------------------------------+
| 10001        | โรงพยาบาลทดสอบระบบ           |
| 10002        | โรงพยาบาลสมมติ                |
+--------------+--------------------------------+
```

---

### 4. เริ่มต้น Backend API

```bash
# ติดตั้ง dependencies (ถ้ายังไม่ได้ติดตั้ง)
cd "d:/work/งาน IM/Project/Project pre check export"
npm install express mysql2 cors

# เริ่ม Backend server
node api_example_nodejs.js
```

**ผลลัพธ์ที่คาดหวัง:**
```
✅ Backend API running on http://localhost:3002
📊 Available endpoints:
   POST /api/test-connection
   POST /api/get-hospital-name
   POST /api/get-patient-data
   POST /api/get-statistics
```

---

### 5. ทดสอบการเชื่อมต่อจาก Frontend

1. เปิด `index.html` ในเบราว์เซอร์
2. คลิก "เชื่อมต่อฐานข้อมูล"
3. กรอกข้อมูล:
   - **ประเภทฐานข้อมูล:** MySQL
   - **IP Server:** `localhost` หรือ `127.0.0.1`
   - **Port:** `3306`
   - **Database:** `hos_test`
   - **User:** `root`
   - **Password:** [รหัสผ่าน root ของคุณ]
4. คลิก "ทดสอบการเชื่อมต่อ"

**ผลลัพธ์ที่ถูกต้อง:**
```
✅ เชื่อมต่อสำเร็จ!

ฐานข้อมูล: MYSQL
Server: localhost:3306
Database: hos_test
```

5. คลิก "บันทึกการตั้งค่า"
6. ระบบจะแสดงชื่อโรงพยาบาล: **"โรงพยาบาลทดสอบระบบ"**

---

## 📊 โครงสร้างฐานข้อมูล

### ตาราง `opdconfig` - ข้อมูลโรงพยาบาล
| Column | Type | Description |
|--------|------|-------------|
| hospitalcode | VARCHAR(5) | รหัสโรงพยาบาล (PK) |
| hospitalname | VARCHAR(255) | ชื่อโรงพยาบาล |
| hostype | VARCHAR(10) | ประเภทโรงพยาบาล |
| hoscity | VARCHAR(100) | อำเภอ |
| hosprovince | VARCHAR(100) | จังหวัด |
| hostel | VARCHAR(50) | เบอร์โทรศัพท์ |

### ตาราง `patient` - ข้อมูลผู้ป่วย
| Column | Type | Description |
|--------|------|-------------|
| hn | VARCHAR(20) | เลข HN (PK) |
| pname | VARCHAR(50) | คำนำหน้า |
| fname | VARCHAR(100) | ชื่อ |
| lname | VARCHAR(100) | นามสกุล |
| cid | VARCHAR(13) | เลขบัตรประชาชน |
| birthday | DATE | วันเกิด |
| sex | VARCHAR(1) | เพศ (1=ชาย, 2=หญิง) |

### ตาราง `ovst` - การรับบริการผู้ป่วยนอก
| Column | Type | Description |
|--------|------|-------------|
| vn | VARCHAR(20) | เลข VN (PK) |
| hn | VARCHAR(20) | เลข HN (FK) |
| vstdate | DATE | วันที่รับบริการ |
| vsttime | TIME | เวลารับบริการ |
| pttype | VARCHAR(10) | สิทธิ์การรักษา |
| income | DECIMAL(10,2) | ยอดเงิน |
| status | VARCHAR(20) | สถานะ |

### ตาราง `ipt` - การรับบริการผู้ป่วยใน
| Column | Type | Description |
|--------|------|-------------|
| an | VARCHAR(20) | เลข AN (PK) |
| hn | VARCHAR(20) | เลข HN (FK) |
| regdate | DATE | วันที่ admit |
| dchdate | DATE | วันที่ discharge |
| pttype | VARCHAR(10) | สิทธิ์การรักษา |
| income | DECIMAL(10,2) | ยอดเงิน |
| status | VARCHAR(20) | สถานะ |

### ตาราง `feeschedule` - รายการค่าบริการ
| Column | Type | Description |
|--------|------|-------------|
| code | VARCHAR(20) | รหัสรายการ (PK) |
| name | VARCHAR(255) | ชื่อรายการ |
| price | DECIMAL(10,2) | ราคา |
| status | VARCHAR(20) | สถานะ |
| category | VARCHAR(50) | หมวดหมู่ |

---

## 🔧 การแก้ไขปัญหา

### ปัญหา: ไม่สามารถเชื่อมต่อ MySQL ได้

**วิธีแก้:**
1. ตรวจสอบว่า MySQL Server กำลังทำงาน:
```bash
# Windows
net start MySQL80

# Linux/Mac
sudo systemctl status mysql
```

2. ตรวจสอบ port 3306:
```bash
netstat -an | findstr 3306
```

3. ลองใช้ `127.0.0.1` แทน `localhost`

### ปัญหา: Access denied for user 'root'

**วิธีแก้:**
```bash
# Reset MySQL root password
mysql -u root -p
ALTER USER 'root'@'localhost' IDENTIFIED BY 'new_password';
FLUSH PRIVILEGES;
```

### ปัญหา: Cannot find module 'express'

**วิธีแก้:**
```bash
cd "d:/work/งาน IM/Project/Project pre check export"
npm install express mysql2 cors
```

### ปัญหา: connect ETIMEDOUT

**สาเหตุ:** MySQL Server ไม่ได้เปิด หรือ Firewall บล็อก

**วิธีแก้:**
1. เปิด MySQL Server
2. ตรวจสอบ Firewall settings
3. ใช้ `127.0.0.1` แทน `localhost`

---

## 📝 ข้อมูลตัวอย่างในฐานข้อมูล

### ข้อมูลผู้ป่วย (5 คน)
- HN001: นายสมชาย ใจดี
- HN002: นางสมหญิง รักสุข
- HN003: นายสมศักดิ์ มั่นคง
- HN101: นายวิชัย สุขสันต์
- HN102: นางสุภา ดีงาม

### ข้อมูลผู้ป่วยนอก (5 visits)
- CSOP: 3 visits
- SSOP: 2 visits

### ข้อมูลผู้ป่วยใน (4 admissions)
- CIPN: 2 admissions
- AIPN: 2 admissions

### ข้อมูล Fee Schedule (6 รายการ)
- ค่าตรวจรักษาทั่วไป: 500 บาท
- ค่าห้องตรวจ: 300 บาท
- ค่ายา: 800 บาท
- ค่าเลือด: 450 บาท
- ค่าเอกซเรย์: 600 บาท
- ค่าอุปกรณ์: 200 บาท

---

## 🎯 ขั้นตอนถัดไป

หลังจากติดตั้งฐานข้อมูลทดสอบเสร็จแล้ว คุณสามารถ:

1. ✅ ทดสอบการเชื่อมต่อฐานข้อมูล
2. ✅ ดูชื่อโรงพยาบาลจริงบนหน้า index.html
3. 🔄 พัฒนา Backend API endpoints เพิ่มเติม
4. 🔄 เชื่อมต่อข้อมูลจริงกับหน้า index_fund.html และ check_c.html
5. 🔄 เพิ่มข้อมูลตัวอย่างเพิ่มเติมตามต้องการ

---

## 📞 ติดต่อ & สนับสนุน

หากพบปัญหาหรือต้องการความช่วยเหลือ:
- ตรวจสอบ Console Log ในเบราว์เซอร์ (F12)
- ตรวจสอบ Backend API logs
- ตรวจสอบ MySQL error logs

---

**สร้างโดย:** Claude Code
**วันที่:** 23 มีนาคม 2026
**เวอร์ชัน:** 1.0
