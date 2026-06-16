-- ============================================================
-- สคริปต์สร้างฐานข้อมูลทดสอบ
-- สำหรับระบบตรวจสอบข้อมูลก่อนส่งออก
-- ============================================================

-- สร้างฐานข้อมูล
CREATE DATABASE IF NOT EXISTS hos_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE hos_test;

-- ============================================================
-- ตาราง opdconfig - ข้อมูลการตั้งค่าโรงพยาบาล
-- ============================================================
CREATE TABLE IF NOT EXISTS opdconfig (
    hospitalcode VARCHAR(5) PRIMARY KEY,
    hospitalname VARCHAR(255) NOT NULL,
    hostype VARCHAR(10),
    hoscity VARCHAR(100),
    hossubdistrict VARCHAR(100),
    hosdistrict VARCHAR(100),
    hosprovince VARCHAR(100),
    hostel VARCHAR(50),
    hosfax VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- เพิ่มข้อมูลโรงพยาบาลตัวอย่าง
INSERT INTO opdconfig (hospitalcode, hospitalname, hostype, hoscity, hosprovince, hostel)
VALUES
    ('10001', 'โรงพยาบาลทดสอบระบบ', 'รพ.', 'เมือง', 'กรุงเทพมหานคร', '02-123-4567'),
    ('10002', 'โรงพยาบาลสมมติ', 'รพช.', 'บางกะปิ', 'กรุงเทพมหานคร', '02-234-5678')
ON DUPLICATE KEY UPDATE
    hospitalname = VALUES(hospitalname),
    hostype = VALUES(hostype),
    hoscity = VALUES(hoscity),
    hosprovince = VALUES(hosprovince),
    hostel = VALUES(hostel);

-- ============================================================
-- ตาราง patient - ข้อมูลผู้ป่วย
-- ============================================================
CREATE TABLE IF NOT EXISTS patient (
    hn VARCHAR(20) PRIMARY KEY,
    pname VARCHAR(50),
    fname VARCHAR(100),
    lname VARCHAR(100),
    cid VARCHAR(13),
    birthday DATE,
    sex VARCHAR(1),
    addrpart VARCHAR(100),
    moo VARCHAR(5),
    tmbpart VARCHAR(100),
    amppart VARCHAR(100),
    chwpart VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- เพิ่มข้อมูลผู้ป่วยตัวอย่าง
INSERT INTO patient (hn, pname, fname, lname, cid, birthday, sex)
VALUES
    ('HN001', 'นาย', 'สมชาย', 'ใจดี', '1234567890123', '1980-05-15', '1'),
    ('HN002', 'นาง', 'สมหญิง', 'รักสุข', '1234567890124', '1985-08-20', '2'),
    ('HN003', 'นาย', 'สมศักดิ์', 'มั่นคง', '1234567890125', '1975-03-10', '1'),
    ('HN101', 'นาย', 'วิชัย', 'สุขสันต์', '1234567890126', '1990-12-25', '1'),
    ('HN102', 'นาง', 'สุภา', 'ดีงาม', '1234567890127', '1988-07-14', '2')
ON DUPLICATE KEY UPDATE
    fname = VALUES(fname),
    lname = VALUES(lname);

-- ============================================================
-- ตาราง ovst - ข้อมูลการรับบริการผู้ป่วยนอก
-- ============================================================
CREATE TABLE IF NOT EXISTS ovst (
    vn VARCHAR(20) PRIMARY KEY,
    hn VARCHAR(20),
    vstdate DATE,
    vsttime TIME,
    pttype VARCHAR(10),
    pttypeno VARCHAR(20),
    income DECIMAL(10,2),
    status VARCHAR(20),
    doctor VARCHAR(10),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (hn) REFERENCES patient(hn)
);

-- เพิ่มข้อมูลการรับบริการผู้ป่วยนอก
INSERT INTO ovst (vn, hn, vstdate, vsttime, pttype, income, status)
VALUES
    ('VN001', 'HN001', '2026-03-23', '09:30:00', 'CSOP', 1500.00, 'รอตรวจสอบ'),
    ('VN002', 'HN002', '2026-03-23', '10:15:00', 'CSOP', 2300.00, 'ผ่าน'),
    ('VN003', 'HN003', '2026-03-22', '14:20:00', 'CSOP', 1800.00, 'รอตรวจสอบ'),
    ('VN004', 'HN001', '2026-03-20', '11:00:00', 'SSOP', 800.00, 'ผ่าน'),
    ('VN005', 'HN002', '2026-03-21', '15:30:00', 'SSOP', 950.00, 'รอตรวจสอบ')
ON DUPLICATE KEY UPDATE
    vstdate = VALUES(vstdate),
    income = VALUES(income),
    status = VALUES(status);

-- ============================================================
-- ตาราง ipt - ข้อมูลการรับบริการผู้ป่วยใน
-- ============================================================
CREATE TABLE IF NOT EXISTS ipt (
    an VARCHAR(20) PRIMARY KEY,
    hn VARCHAR(20),
    regdate DATE,
    regtime TIME,
    dchdate DATE,
    dchtime TIME,
    pttype VARCHAR(10),
    income DECIMAL(10,2),
    status VARCHAR(20),
    ward VARCHAR(10),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (hn) REFERENCES patient(hn)
);

-- เพิ่มข้อมูลการรับบริการผู้ป่วยใน
INSERT INTO ipt (an, hn, regdate, regtime, dchdate, dchtime, pttype, income, status)
VALUES
    ('AN001', 'HN101', '2026-03-20', '08:00:00', '2026-03-23', '10:00:00', 'CIPN', 15000.00, 'รอตรวจสอบ'),
    ('AN002', 'HN102', '2026-03-21', '09:00:00', '2026-03-26', '11:00:00', 'CIPN', 22500.00, 'ผ่าน'),
    ('AN003', 'HN101', '2026-03-19', '14:00:00', '2026-03-23', '09:00:00', 'AIPN', 18000.00, 'รอตรวจสอบ'),
    ('AN004', 'HN102', '2026-03-20', '10:00:00', '2026-03-26', '12:00:00', 'AIPN', 25000.00, 'ผ่าน')
ON DUPLICATE KEY UPDATE
    regdate = VALUES(regdate),
    dchdate = VALUES(dchdate),
    income = VALUES(income),
    status = VALUES(status);

-- ============================================================
-- ตาราง feeschedule - ข้อมูลรายการค่าบริการ
-- ============================================================
CREATE TABLE IF NOT EXISTS feeschedule (
    code VARCHAR(20) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    price DECIMAL(10,2),
    status VARCHAR(20),
    category VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- เพิ่มข้อมูลรายการค่าบริการ
INSERT INTO feeschedule (code, name, price, status, category)
VALUES
    ('FS001', 'ค่าตรวจรักษาทั่วไป', 500.00, 'ใช้งาน', 'ค่าตรวจ'),
    ('FS002', 'ค่าห้องตรวจ', 300.00, 'ใช้งาน', 'ค่าห้อง'),
    ('FS003', 'ค่ายา', 800.00, 'ใช้งาน', 'ยา'),
    ('FS004', 'ค่าเลือด', 450.00, 'ใช้งาน', 'ค่าตรวจ'),
    ('FS005', 'ค่าเอกซเรย์', 600.00, 'ใช้งาน', 'ค่าตรวจ'),
    ('FS006', 'ค่าอุปกรณ์', 200.00, 'ใช้งาน', 'ค่าวัสดุ')
ON DUPLICATE KEY UPDATE
    name = VALUES(name),
    price = VALUES(price),
    status = VALUES(status);

-- ============================================================
-- แสดงข้อมูลที่สร้างเสร็จ
-- ============================================================
SELECT '✅ สร้างฐานข้อมูลทดสอบเสร็จสิ้น' AS message;
SELECT '📊 จำนวนข้อมูลในแต่ละตาราง:' AS summary;

SELECT 'opdconfig' AS table_name, COUNT(*) AS record_count FROM opdconfig
UNION ALL
SELECT 'patient', COUNT(*) FROM patient
UNION ALL
SELECT 'ovst', COUNT(*) FROM ovst
UNION ALL
SELECT 'ipt', COUNT(*) FROM ipt
UNION ALL
SELECT 'feeschedule', COUNT(*) FROM feeschedule;

-- แสดงข้อมูลโรงพยาบาล
SELECT '🏥 ข้อมูลโรงพยาบาล:' AS info;
SELECT * FROM opdconfig;
