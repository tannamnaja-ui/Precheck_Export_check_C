-- ============================================================
-- สร้างตาราง position_check
-- สำหรับระบุว่าตำแหน่งใดต้องตรวจสอบเลขใบอนุญาตวิชาชีพ
-- ============================================================

-- MySQL
CREATE TABLE IF NOT EXISTS `position_check` (
  `position_check_id` INT NOT NULL AUTO_INCREMENT COMMENT 'PK',
  `position_id`       INT NOT NULL               COMMENT 'รหัสตำแหน่งจากตาราง doctor_position',
  `position_name`     VARCHAR(200) NOT NULL       COMMENT 'ชื่อตำแหน่ง',
  PRIMARY KEY (`position_check_id`),
  UNIQUE INDEX `idx_position_check_id` (`position_check_id`) USING BTREE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='ตำแหน่งที่ต้องตรวจสอบใบอนุญาตวิชาชีพ';

-- ============================================================
-- PostgreSQL (เปิด comment ถ้าใช้ PostgreSQL)
-- ============================================================
-- CREATE TABLE IF NOT EXISTS position_check (
--   position_check_id SERIAL        NOT NULL,
--   position_id       INTEGER        NOT NULL,
--   position_name     VARCHAR(200)   NOT NULL,
--   CONSTRAINT pk_position_check PRIMARY KEY (position_check_id)
-- );
-- CREATE UNIQUE INDEX IF NOT EXISTS idx_position_check_id
--   ON position_check USING BTREE (position_check_id);
