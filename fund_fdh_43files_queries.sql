-- ============================================================
-- เมนู: FDH-INS (สิทธิการรักษา) -- endpoint: /api/get-fdh-ins
-- ============================================================

-- ▶ PostgreSQL
SELECT
  pt.pname, pt.fname, pt.lname,
  v.vstdate AS visit_date,
  pt.hn, p.hipdata_code,
  CASE WHEN p.hipdata_code IS NOT NULL THEN 'Y' ELSE 'N' END AS check_hipdata_code,
  vp.pttype,
  CASE WHEN vp.pttype IS NOT NULL THEN 'Y' ELSE 'N' END AS check_pttype,
  pt.cid,
  CASE WHEN pt.cid IS NOT NULL THEN 'Y' ELSE 'N' END AS check_cid,
  vp.expire_date,
  CASE WHEN vp.expire_date IS NOT NULL THEN 'Y' ELSE 'N' END AS check_expire_date,
  vp.hospmain,
  CASE WHEN vp.hospmain IS NOT NULL THEN 'Y' ELSE 'N' END AS check_hospmain,
  vp.hospsub,
  CASE WHEN vp.hospsub IS NOT NULL THEN 'Y' ELSE 'N' END AS check_hospsub,
  vp.auth_code,
  CASE WHEN vp.auth_code IS NOT NULL THEN 'Y' ELSE 'N' END AS check_auth_code,
  vp.vn,
  p.hipdata_code AS htype,
  CASE WHEN p.hipdata_code IS NOT NULL THEN 'Y' ELSE 'N' END AS check_hipdata_code_dup,
  vp.claim_code,
  CASE WHEN vp.claim_code IS NOT NULL THEN 'Y' ELSE 'N' END AS check_claim_code,
  p.hipdata_pttype,
  NULL AS ipt_type,
  NULL AS ipt_admit_type_id
FROM ovst v
  LEFT OUTER JOIN patient pt ON pt.hn = v.hn
  LEFT OUTER JOIN visit_pttype vp ON vp.vn = v.vn
  LEFT OUTER JOIN pttype p ON p.pttype = vp.pttype
WHERE v.vstdate BETWEEN '2026-06-15' AND '2026-06-15'
AND v.pttype IN (SELECT p.pttype FROM pttype p WHERE p.isuse='Y' AND hipdata_code IN ('UCS','WEL'))
UNION ALL
SELECT
  pt.pname, pt.fname, pt.lname,
  v.dchdate AS visit_date,
  pt.hn, p.hipdata_code,
  CASE WHEN p.hipdata_code IS NOT NULL THEN 'Y' ELSE 'N' END AS check_hipdata_code,
  vp.pttype,
  CASE WHEN vp.pttype IS NOT NULL THEN 'Y' ELSE 'N' END AS check_pttype,
  pt.cid,
  CASE WHEN pt.cid IS NOT NULL THEN 'Y' ELSE 'N' END AS check_cid,
  vp.expire_date,
  CASE WHEN vp.expire_date IS NOT NULL THEN 'Y' ELSE 'N' END AS check_expire_date,
  vp.hospmain,
  CASE WHEN vp.hospmain BETWEEN '00000' AND '99999' THEN 'Y' ELSE 'N' END AS check_hospmain,
  vp.hospsub,
  CASE WHEN vp.hospsub IS NOT NULL THEN 'Y' ELSE 'N' END AS check_hospsub,
  vp.auth_code,
  CASE WHEN vp.auth_code IS NOT NULL THEN 'Y' ELSE 'N' END AS check_auth_code,
  vp.an,
  p.hipdata_code AS htype,
  CASE WHEN p.hipdata_code IS NOT NULL THEN 'Y' ELSE 'N' END AS check_hipdata_code_dup,
  vp.claim_code,
  CASE WHEN vp.claim_code IS NOT NULL THEN 'Y' ELSE 'N' END AS check_claim_code,
  p.hipdata_pttype,
  v.ipt_type,
  v.ipt_admit_type_id
FROM ipt v
  LEFT OUTER JOIN patient pt ON pt.hn = v.hn
  LEFT OUTER JOIN ipt_pttype vp ON vp.an = v.an
  LEFT OUTER JOIN pttype p ON p.pttype = vp.pttype
WHERE v.dchdate BETWEEN '2026-06-15' AND '2026-06-15'
AND vp.pttype IN (SELECT p.pttype FROM pttype p WHERE p.isuse='Y' AND hipdata_code IN ('UCS','WEL'));

-- ▶ MySQL
SELECT
  pt.pname, pt.fname, pt.lname,
  v.vstdate AS visit_date,
  pt.hn, p.hipdata_code,
  CASE WHEN p.hipdata_code IS NOT NULL THEN 'Y' ELSE 'N' END AS check_hipdata_code,
  vp.pttype,
  CASE WHEN vp.pttype IS NOT NULL THEN 'Y' ELSE 'N' END AS check_pttype,
  pt.cid,
  CASE WHEN pt.cid IS NOT NULL THEN 'Y' ELSE 'N' END AS check_cid,
  vp.expire_date,
  CASE WHEN vp.expire_date IS NOT NULL THEN 'Y' ELSE 'N' END AS check_expire_date,
  vp.hospmain,
  CASE WHEN vp.hospmain IS NOT NULL THEN 'Y' ELSE 'N' END AS check_hospmain,
  vp.hospsub,
  CASE WHEN vp.hospsub IS NOT NULL THEN 'Y' ELSE 'N' END AS check_hospsub,
  vp.auth_code,
  CASE WHEN vp.auth_code IS NOT NULL THEN 'Y' ELSE 'N' END AS check_auth_code,
  vp.vn,
  p.hipdata_code AS htype,
  CASE WHEN p.hipdata_code IS NOT NULL THEN 'Y' ELSE 'N' END AS check_hipdata_code_dup,
  vp.claim_code,
  CASE WHEN vp.claim_code IS NOT NULL THEN 'Y' ELSE 'N' END AS check_claim_code,
  p.hipdata_pttype,
  NULL AS ipt_type,
  NULL AS ipt_admit_type_id
FROM ovst v
  LEFT OUTER JOIN patient pt ON pt.hn = v.hn
  LEFT OUTER JOIN visit_pttype vp ON vp.vn = v.vn
  LEFT OUTER JOIN pttype p ON p.pttype = vp.pttype
WHERE v.vstdate BETWEEN '2026-06-15' AND '2026-06-15'
AND v.pttype IN (SELECT p.pttype FROM pttype p WHERE p.isuse='Y' AND hipdata_code IN ('UCS','WEL'))
UNION ALL
SELECT
  pt.pname, pt.fname, pt.lname,
  v.dchdate AS visit_date,
  pt.hn, p.hipdata_code,
  CASE WHEN p.hipdata_code IS NOT NULL THEN 'Y' ELSE 'N' END AS check_hipdata_code,
  vp.pttype,
  CASE WHEN vp.pttype IS NOT NULL THEN 'Y' ELSE 'N' END AS check_pttype,
  pt.cid,
  CASE WHEN pt.cid IS NOT NULL THEN 'Y' ELSE 'N' END AS check_cid,
  vp.expire_date,
  CASE WHEN vp.expire_date IS NOT NULL THEN 'Y' ELSE 'N' END AS check_expire_date,
  vp.hospmain,
  CASE WHEN vp.hospmain BETWEEN '00000' AND '99999' THEN 'Y' ELSE 'N' END AS check_hospmain,
  vp.hospsub,
  CASE WHEN vp.hospsub IS NOT NULL THEN 'Y' ELSE 'N' END AS check_hospsub,
  vp.auth_code,
  CASE WHEN vp.auth_code IS NOT NULL THEN 'Y' ELSE 'N' END AS check_auth_code,
  vp.an,
  p.hipdata_code AS htype,
  CASE WHEN p.hipdata_code IS NOT NULL THEN 'Y' ELSE 'N' END AS check_hipdata_code_dup,
  vp.claim_code,
  CASE WHEN vp.claim_code IS NOT NULL THEN 'Y' ELSE 'N' END AS check_claim_code,
  p.hipdata_pttype,
  v.ipt_type,
  v.ipt_admit_type_id
FROM ipt v
  LEFT OUTER JOIN patient pt ON pt.hn = v.hn
  LEFT OUTER JOIN ipt_pttype vp ON vp.an = v.an
  LEFT OUTER JOIN pttype p ON p.pttype = vp.pttype
WHERE v.dchdate BETWEEN '2026-06-15' AND '2026-06-15'
AND vp.pttype IN (SELECT p.pttype FROM pttype p WHERE p.isuse='Y' AND hipdata_code IN ('UCS','WEL'));

-- ============================================================
-- เมนู: FDH-PAT (ข้อมูลผู้ป่วย) -- endpoint: /api/get-fdh-pat
-- ============================================================

-- ▶ PostgreSQL
SELECT
  (SELECT hospitalcode FROM opdconfig LIMIT 1) AS hcode,
  p.hn,
  p.chwpart,
  CASE WHEN (p.chwpart IS NULL OR p.chwpart = '') THEN 'N' ELSE 'Y' END AS check_chwpart,
  p.amppart,
  CASE WHEN (p.amppart IS NULL OR p.amppart = '') THEN 'N' ELSE 'Y' END AS check_amppart,
  p.birthday,
  CASE WHEN p.birthday IS NULL THEN 'N' ELSE 'Y' END AS check_birthday,
  p.sex,
  CASE WHEN (p.sex IS NULL OR p.sex = '') THEN 'N' ELSE 'Y' END AS check_sex,
  p.marrystatus,
  CASE WHEN (p.marrystatus IS NULL OR p.marrystatus = '') THEN 'N' ELSE 'Y' END AS check_marrystatus,
  p.occupation,
  CASE WHEN (p.occupation IS NULL OR p.occupation = '') THEN 'N' ELSE 'Y' END AS check_occupation,
  p.nationality,
  CASE WHEN (p.nationality IS NULL OR p.nationality = '') THEN 'N' ELSE 'Y' END AS check_nationality,
  p.cid,
  CASE WHEN (p.cid IS NULL OR p.cid = '') THEN 'N' ELSE 'Y' END AS check_cid,
  CONCAT(p.fname, ' ', p.lname) AS ptname,
  CASE WHEN (CONCAT(p.fname, ' ', p.lname) IS NULL OR TRIM(CONCAT(p.fname, ' ', p.lname)) = '') THEN 'N' ELSE 'Y' END AS check_ptname,
  p.pname,
  CASE WHEN (p.pname IS NULL OR p.pname = '') THEN 'N' ELSE 'Y' END AS check_pname,
  p.fname,
  CASE WHEN (p.fname IS NULL OR p.fname = '') THEN 'N' ELSE 'Y' END AS check_fname,
  p.lname,
  CASE WHEN (p.lname IS NULL OR p.lname = '') THEN 'N' ELSE 'Y' END AS check_lname,
  1 AS idtype
FROM patient p
  LEFT OUTER JOIN ovst o ON o.hn = p.hn
WHERE o.vstdate BETWEEN '2026-06-15' AND '2026-06-15'
AND o.pttype IN (SELECT p.pttype FROM pttype p WHERE p.isuse='Y' AND hipdata_code IN ('UCS','WEL'));

-- ▶ MySQL
SELECT
  (SELECT hospitalcode FROM opdconfig LIMIT 1) AS hcode,
  p.hn,
  p.chwpart,
  CASE WHEN (p.chwpart IS NULL OR p.chwpart = '') THEN 'N' ELSE 'Y' END AS check_chwpart,
  p.amppart,
  CASE WHEN (p.amppart IS NULL OR p.amppart = '') THEN 'N' ELSE 'Y' END AS check_amppart,
  p.birthday,
  CASE WHEN p.birthday IS NULL THEN 'N' ELSE 'Y' END AS check_birthday,
  p.sex,
  CASE WHEN (p.sex IS NULL OR p.sex = '') THEN 'N' ELSE 'Y' END AS check_sex,
  p.marrystatus,
  CASE WHEN (p.marrystatus IS NULL OR p.marrystatus = '') THEN 'N' ELSE 'Y' END AS check_marrystatus,
  p.occupation,
  CASE WHEN (p.occupation IS NULL OR p.occupation = '') THEN 'N' ELSE 'Y' END AS check_occupation,
  p.nationality,
  CASE WHEN (p.nationality IS NULL OR p.nationality = '') THEN 'N' ELSE 'Y' END AS check_nationality,
  p.cid,
  CASE WHEN (p.cid IS NULL OR p.cid = '') THEN 'N' ELSE 'Y' END AS check_cid,
  CONCAT(p.fname, ' ', p.lname) AS ptname,
  CASE WHEN (CONCAT(p.fname, ' ', p.lname) IS NULL OR TRIM(CONCAT(p.fname, ' ', p.lname)) = '') THEN 'N' ELSE 'Y' END AS check_ptname,
  p.pname,
  CASE WHEN (p.pname IS NULL OR p.pname = '') THEN 'N' ELSE 'Y' END AS check_pname,
  p.fname,
  CASE WHEN (p.fname IS NULL OR p.fname = '') THEN 'N' ELSE 'Y' END AS check_fname,
  p.lname,
  CASE WHEN (p.lname IS NULL OR p.lname = '') THEN 'N' ELSE 'Y' END AS check_lname,
  1 AS idtype
FROM patient p
  LEFT OUTER JOIN ovst o ON o.hn = p.hn
WHERE o.vstdate BETWEEN '2026-06-15' AND '2026-06-15'
AND o.pttype IN (SELECT p.pttype FROM pttype p WHERE p.isuse='Y' AND hipdata_code IN ('UCS','WEL'));

-- ============================================================
-- เมนู: FDH-OPD (ผู้ป่วยนอก) -- endpoint: /api/get-fdh-opd
-- ============================================================

-- ▶ PostgreSQL
SELECT ovst.hn,
  spclty.provis_code,
  CASE WHEN (spclty.provis_code IS NULL OR spclty.provis_code = '') THEN 'N' ELSE 'Y' END AS check_clinic,
  ovst.vstdate,
  CASE WHEN ovst.vstdate IS NULL THEN 'N' ELSE 'Y' END AS check_dateopd,
  ovst.vsttime,
  CASE WHEN ovst.vsttime IS NULL THEN 'N' ELSE 'Y' END AS check_timeopd,
  ovst.vn,
  CASE WHEN ovst.vn IS NULL THEN 'N' ELSE 'Y' END AS check_seq,
  visit_pttype.request_funds,
  CASE WHEN (visit_pttype.request_funds IS NULL OR visit_pttype.request_funds = '' OR visit_pttype.request_funds = 'N') THEN 'N' ELSE 'Y' END AS check_uuc,
  opdscreen.cc,
  CASE WHEN (opdscreen.cc IS NULL OR opdscreen.cc = '') THEN 'N' ELSE 'Y' END AS check_detail,
  opdscreen.temperature,
  CASE WHEN opdscreen.temperature IS NULL THEN 'N' ELSE 'Y' END AS check_btemp,
  opdscreen.bps,
  CASE WHEN opdscreen.bps IS NULL THEN 'N' ELSE 'Y' END AS check_sbp,
  opdscreen.bpd,
  CASE WHEN opdscreen.bpd IS NULL THEN 'N' ELSE 'Y' END AS check_dbp,
  opdscreen.pulse,
  CASE WHEN opdscreen.pulse IS NULL THEN 'N' ELSE 'Y' END AS check_pr,
  opdscreen.rr,
  CASE WHEN opdscreen.rr IS NULL THEN 'N' ELSE 'Y' END AS check_rr,
  vs.nhso_fee_schedule_list_text,
  CASE WHEN vs.nhso_fee_schedule_list_text IS NULL THEN 'N' ELSE 'Y' END AS check_optype,
  ovst.ovstist,
  CASE WHEN ovst.ovstist IS NULL THEN 'N' ELSE 'Y' END AS check_typein,
  er.er_leave_status_id,
  CASE WHEN er.er_leave_status_id IS NULL THEN 'N' ELSE 'Y' END AS check_typeout
FROM ovst
  LEFT JOIN spclty ON spclty.spclty = ovst.spclty
  LEFT JOIN visit_pttype ON visit_pttype.vn = ovst.vn
  LEFT JOIN opdscreen ON opdscreen.vn = ovst.vn
  LEFT JOIN ovst_seq vs ON vs.vn = ovst.vn
  LEFT JOIN er_regist er ON er.vn = ovst.vn
WHERE ovst.vstdate BETWEEN '2026-06-15' AND '2026-06-15'
AND ovst.pttype IN (SELECT p.pttype FROM pttype p WHERE p.isuse='Y' AND hipdata_code IN ('UCS','WEL'));

-- ▶ MySQL
SELECT ovst.hn,
  spclty.provis_code,
  CASE WHEN (spclty.provis_code IS NULL OR spclty.provis_code = '') THEN 'N' ELSE 'Y' END AS check_clinic,
  ovst.vstdate,
  CASE WHEN ovst.vstdate IS NULL THEN 'N' ELSE 'Y' END AS check_dateopd,
  ovst.vsttime,
  CASE WHEN ovst.vsttime IS NULL THEN 'N' ELSE 'Y' END AS check_timeopd,
  ovst.vn,
  CASE WHEN ovst.vn IS NULL THEN 'N' ELSE 'Y' END AS check_seq,
  visit_pttype.request_funds,
  CASE WHEN (visit_pttype.request_funds IS NULL OR visit_pttype.request_funds = '' OR visit_pttype.request_funds = 'N') THEN 'N' ELSE 'Y' END AS check_uuc,
  opdscreen.cc,
  CASE WHEN (opdscreen.cc IS NULL OR opdscreen.cc = '') THEN 'N' ELSE 'Y' END AS check_detail,
  opdscreen.temperature,
  CASE WHEN opdscreen.temperature IS NULL THEN 'N' ELSE 'Y' END AS check_btemp,
  opdscreen.bps,
  CASE WHEN opdscreen.bps IS NULL THEN 'N' ELSE 'Y' END AS check_sbp,
  opdscreen.bpd,
  CASE WHEN opdscreen.bpd IS NULL THEN 'N' ELSE 'Y' END AS check_dbp,
  opdscreen.pulse,
  CASE WHEN opdscreen.pulse IS NULL THEN 'N' ELSE 'Y' END AS check_pr,
  opdscreen.rr,
  CASE WHEN opdscreen.rr IS NULL THEN 'N' ELSE 'Y' END AS check_rr,
  vs.nhso_fee_schedule_list_text,
  CASE WHEN vs.nhso_fee_schedule_list_text IS NULL THEN 'N' ELSE 'Y' END AS check_optype,
  ovst.ovstist,
  CASE WHEN ovst.ovstist IS NULL THEN 'N' ELSE 'Y' END AS check_typein,
  er.er_leave_status_id,
  CASE WHEN er.er_leave_status_id IS NULL THEN 'N' ELSE 'Y' END AS check_typeout
FROM ovst
  LEFT JOIN spclty ON spclty.spclty = ovst.spclty
  LEFT JOIN visit_pttype ON visit_pttype.vn = ovst.vn
  LEFT JOIN opdscreen ON opdscreen.vn = ovst.vn
  LEFT JOIN ovst_seq vs ON vs.vn = ovst.vn
  LEFT JOIN er_regist er ON er.vn = ovst.vn
WHERE ovst.vstdate BETWEEN '2026-06-15' AND '2026-06-15'
AND ovst.pttype IN (SELECT p.pttype FROM pttype p WHERE p.isuse='Y' AND hipdata_code IN ('UCS','WEL'));

-- ============================================================
-- เมนู: FDH-ORF (ส่งต่อผู้ป่วยนอก) -- endpoint: /api/get-fdh-orf
-- ============================================================

-- ▶ PostgreSQL
SELECT
  v.hn,
  v.vstdate AS dateopd,
  ro.refer_hospcode,
  ro.refer_type,
  ro.referout_type_id,
  CASE WHEN ro.referout_type_id IS NOT NULL THEN 'Y' ELSE 'N' END AS check_referout_type,
  sp.name AS clinic,
  CASE WHEN sp.provis_code IS NOT NULL OR sp.provis_code = '' THEN 'Y' ELSE 'N' END AS check_clinic,
  rn.vn AS referin,
  ro.vn AS referout,
  CASE WHEN rn.vn IS NOT NULL OR ro.vn IS NOT NULL THEN 'Y' ELSE 'N' END AS check_vn
FROM ovst v
  LEFT OUTER JOIN ovstdiag o1 ON o1.hn = v.hn
  LEFT OUTER JOIN spclty sp ON sp.spclty = v.spclty
  LEFT OUTER JOIN referout ro ON ro.vn = v.vn
  LEFT OUTER JOIN referin rn ON rn.vn = v.vn
WHERE v.vstdate BETWEEN '2026-06-15' AND '2026-06-15'
AND v.pttype IN (SELECT p.pttype FROM pttype p WHERE p.isuse='Y' AND hipdata_code IN ('UCS','WEL'))
AND (ro.vn = v.vn OR rn.vn = v.vn)
ORDER BY v.hn, v.vstdate, ro.refer_hospcode, ro.refer_type;

-- ▶ MySQL
SELECT
  v.hn,
  v.vstdate AS dateopd,
  ro.refer_hospcode,
  ro.refer_type,
  ro.referout_type_id,
  CASE WHEN ro.referout_type_id IS NOT NULL THEN 'Y' ELSE 'N' END AS check_referout_type,
  sp.name AS clinic,
  CASE WHEN sp.provis_code IS NOT NULL OR sp.provis_code = '' THEN 'Y' ELSE 'N' END AS check_clinic,
  rn.vn AS referin,
  ro.vn AS referout,
  CASE WHEN rn.vn IS NOT NULL OR ro.vn IS NOT NULL THEN 'Y' ELSE 'N' END AS check_vn
FROM ovst v
  LEFT OUTER JOIN ovstdiag o1 ON o1.hn = v.hn
  LEFT OUTER JOIN spclty sp ON sp.spclty = v.spclty
  LEFT OUTER JOIN referout ro ON ro.vn = v.vn
  LEFT OUTER JOIN referin rn ON rn.vn = v.vn
WHERE v.vstdate BETWEEN '2026-06-15' AND '2026-06-15'
AND v.pttype IN (SELECT p.pttype FROM pttype p WHERE p.isuse='Y' AND hipdata_code IN ('UCS','WEL'))
AND (ro.vn = v.vn OR rn.vn = v.vn)
ORDER BY v.hn, v.vstdate, ro.refer_hospcode, ro.refer_type;

-- ============================================================
-- เมนู: FDH-ODX (วินิจฉัยผู้ป่วยนอก) -- endpoint: /api/get-fdh-odx
-- ============================================================

-- ▶ PostgreSQL
SELECT
  v.hn,
  v.vstdate,
  o1.icd10 AS diag,
  CASE WHEN o1.icd10 IS NOT NULL THEN 'Y' ELSE 'N' END AS check_diag,
  v.spclty,
  CASE WHEN sp.provis_code IS NOT NULL OR sp.provis_code = '' THEN 'Y' ELSE 'N' END AS check_clinic,
  o1.diagtype AS dxtype,
  CASE WHEN o1.diagtype <> '' THEN 'Y' ELSE 'N' END AS check_diagtype,
  d.licenseno,
  CASE WHEN d.licenseno <> '' THEN 'Y' ELSE 'N' END AS check_drdx,
  p.cid,
  v.vn
FROM ovst v
  LEFT OUTER JOIN ovstdiag o1 ON o1.hn = v.hn
  LEFT OUTER JOIN spclty sp ON sp.spclty = v.spclty
  LEFT OUTER JOIN diagtype dx ON dx.diagtype = o1.diagtype
  LEFT OUTER JOIN doctor d ON d.code = o1.doctor
  LEFT OUTER JOIN patient p ON p.hn = v.hn
WHERE v.vstdate BETWEEN '2026-06-15' AND '2026-06-15'
AND v.pttype IN (SELECT p.pttype FROM pttype p WHERE p.isuse='Y' AND hipdata_code IN ('UCS','WEL'))
ORDER BY v.hn, o1.diagtype, o1.diag_no, o1.ovst_diag_id;

-- ▶ MySQL
SELECT
  v.hn,
  v.vstdate,
  o1.icd10 AS diag,
  CASE WHEN o1.icd10 IS NOT NULL THEN 'Y' ELSE 'N' END AS check_diag,
  v.spclty,
  CASE WHEN sp.provis_code IS NOT NULL OR sp.provis_code = '' THEN 'Y' ELSE 'N' END AS check_clinic,
  o1.diagtype AS dxtype,
  CASE WHEN o1.diagtype <> '' THEN 'Y' ELSE 'N' END AS check_diagtype,
  d.licenseno,
  CASE WHEN d.licenseno <> '' THEN 'Y' ELSE 'N' END AS check_drdx,
  p.cid,
  v.vn
FROM ovst v
  LEFT OUTER JOIN ovstdiag o1 ON o1.hn = v.hn
  LEFT OUTER JOIN spclty sp ON sp.spclty = v.spclty
  LEFT OUTER JOIN diagtype dx ON dx.diagtype = o1.diagtype
  LEFT OUTER JOIN doctor d ON d.code = o1.doctor
  LEFT OUTER JOIN patient p ON p.hn = v.hn
WHERE v.vstdate BETWEEN '2026-06-15' AND '2026-06-15'
AND v.pttype IN (SELECT p.pttype FROM pttype p WHERE p.isuse='Y' AND hipdata_code IN ('UCS','WEL'))
ORDER BY v.hn, o1.diagtype, o1.diag_no, o1.ovst_diag_id;

-- ============================================================
-- เมนู: FDH-OOP (หัตถการผู้ป่วยนอก) -- endpoint: /api/get-fdh-oop
-- ============================================================

-- ▶ PostgreSQL
SELECT
  v.hn,
  o.vstdate AS dateopd,
  sp.provis_code AS clinic,
  CASE WHEN sp.provis_code IS NOT NULL THEN 'Y' ELSE 'N' END AS check_clinic,
  r.icd9 AS oper,
  CASE WHEN r.icd9 <> '' THEN 'Y' ELSE 'N' END AS check_oper,
  d.licenseno AS dropid,
  CASE WHEN d.licenseno <> '' THEN 'Y' ELSE 'N' END AS check_dropid,
  pt.cid AS person_id,
  r.vn AS seq
FROM doctor_operation r
  LEFT OUTER JOIN vn_stat v ON v.vn = r.vn
  LEFT OUTER JOIN ovst o ON o.vn = r.vn
  LEFT OUTER JOIN spclty sp ON sp.spclty = o.spclty
  LEFT OUTER JOIN patient pt ON pt.hn = o.hn
  LEFT OUTER JOIN doctor d ON d.code = r.doctor
WHERE o.vstdate BETWEEN '2026-06-15' AND '2026-06-15'
AND o.pttype IN (SELECT p.pttype FROM pttype p WHERE p.isuse='Y' AND hipdata_code IN ('UCS','WEL'));

-- ▶ MySQL
SELECT
  v.hn,
  o.vstdate AS dateopd,
  sp.provis_code AS clinic,
  CASE WHEN sp.provis_code IS NOT NULL THEN 'Y' ELSE 'N' END AS check_clinic,
  r.icd9 AS oper,
  CASE WHEN r.icd9 <> '' THEN 'Y' ELSE 'N' END AS check_oper,
  d.licenseno AS dropid,
  CASE WHEN d.licenseno <> '' THEN 'Y' ELSE 'N' END AS check_dropid,
  pt.cid AS person_id,
  r.vn AS seq
FROM doctor_operation r
  LEFT OUTER JOIN vn_stat v ON v.vn = r.vn
  LEFT OUTER JOIN ovst o ON o.vn = r.vn
  LEFT OUTER JOIN spclty sp ON sp.spclty = o.spclty
  LEFT OUTER JOIN patient pt ON pt.hn = o.hn
  LEFT OUTER JOIN doctor d ON d.code = r.doctor
WHERE o.vstdate BETWEEN '2026-06-15' AND '2026-06-15'
AND o.pttype IN (SELECT p.pttype FROM pttype p WHERE p.isuse='Y' AND hipdata_code IN ('UCS','WEL'));

-- ============================================================
-- เมนู: FDH-IRF (ส่งต่อผู้ป่วยใน) -- endpoint: /api/get-fdh-irf
-- ============================================================

-- ▶ PostgreSQL
SELECT ip.an,
  r.refer_hospcode AS refer,
  CASE WHEN r.refer_hospcode <> '' THEN 'Y' ELSE 'N' END AS check_refer,
  rn.vn AS referin,
  r.vn AS referout,
  CASE WHEN (rn.vn IS NOT NULL OR r.vn IS NOT NULL) THEN 'Y' ELSE 'N' END AS check_refertype
FROM ipt ip
  LEFT OUTER JOIN referout r ON r.vn = ip.an
  LEFT OUTER JOIN referin rn ON rn.vn = ip.an
WHERE ip.dchdate BETWEEN '2026-06-15' AND '2026-06-15'
AND ip.pttype IN (SELECT p.pttype FROM pttype p WHERE p.isuse='Y' AND hipdata_code IN ('UCS','WEL'))
AND LENGTH(r.vn) > 0;

-- ▶ MySQL
SELECT ip.an,
  r.refer_hospcode AS refer,
  CASE WHEN r.refer_hospcode <> '' THEN 'Y' ELSE 'N' END AS check_refer,
  rn.vn AS referin,
  r.vn AS referout,
  CASE WHEN (rn.vn IS NOT NULL OR r.vn IS NOT NULL) THEN 'Y' ELSE 'N' END AS check_refertype
FROM ipt ip
  LEFT OUTER JOIN referout r ON r.vn = ip.an
  LEFT OUTER JOIN referin rn ON rn.vn = ip.an
WHERE ip.dchdate BETWEEN '2026-06-15' AND '2026-06-15'
AND ip.pttype IN (SELECT p.pttype FROM pttype p WHERE p.isuse='Y' AND hipdata_code IN ('UCS','WEL'))
AND LENGTH(r.vn) > 0;

-- ============================================================
-- เมนู: FDH-IPD (ผู้ป่วยใน) -- endpoint: /api/get-fdh-ipd
-- ============================================================

-- ▶ PostgreSQL
SELECT ipt.hn,
  ipt.an,
  ipt.regdate,
  CASE WHEN ipt.regdate IS NULL THEN 'N' ELSE 'Y' END AS check_dateadm,
  ipt.regtime,
  CASE WHEN ipt.regtime IS NULL THEN 'N' ELSE 'Y' END AS check_timeadm,
  ipt.dchdate,
  CASE WHEN ipt.dchdate IS NULL THEN 'N' ELSE 'Y' END AS check_datedsc,
  ipt.dchtime,
  CASE WHEN ipt.dchtime IS NULL THEN 'N' ELSE 'Y' END AS check_timedsc,
  dt.name AS dchstts,
  CASE WHEN ipt.dchstts IS NULL THEN 'N' ELSE 'Y' END AS check_dischs,
  dp.name AS dchtype,
  CASE WHEN ipt.dchtype IS NULL THEN 'N' ELSE 'Y' END AS check_discht,
  w.name AS first_ward,
  CASE WHEN ipt.first_ward IS NULL THEN 'N' ELSE 'Y' END AS check_warddsc,
  s.name AS spclty,
  CASE WHEN ipt.spclty IS NULL THEN 'N' ELSE 'Y' END AS check_dept,
  ipt.bw,
  CASE WHEN ipt.bw IS NULL THEN 'N' ELSE 'Y' END AS check_adm_w,
  visit_pttype.request_funds,
  CASE WHEN (visit_pttype.request_funds IS NULL OR visit_pttype.request_funds = '' OR visit_pttype.request_funds = 'N') THEN 'N' ELSE 'Y' END AS check_uuc,
  ip.ipt_type_name,
  CASE WHEN ipt.ipt_type IS NULL THEN 'N' ELSE 'Y' END AS check_svctype
FROM ipt
  LEFT JOIN ovst ON ovst.an = ipt.an
  LEFT JOIN visit_pttype ON visit_pttype.vn = ovst.vn
  LEFT JOIN dchstts dt ON dt.dchstts = ipt.dchstts
  LEFT JOIN dchtype dp ON dp.dchtype = ipt.dchtype
  LEFT JOIN ward w ON w.ward = ipt.first_ward
  LEFT JOIN spclty s ON s.spclty = ipt.spclty
  LEFT JOIN ipt_type ip ON ip.ipt_type = ipt.ipt_type
WHERE ipt.dchdate BETWEEN '2026-06-15' AND '2026-06-15'
AND ipt.pttype IN (SELECT p.pttype FROM pttype p WHERE p.isuse='Y' AND hipdata_code IN ('UCS','WEL'));

-- ▶ MySQL
SELECT ipt.hn,
  ipt.an,
  ipt.regdate,
  CASE WHEN ipt.regdate IS NULL THEN 'N' ELSE 'Y' END AS check_dateadm,
  ipt.regtime,
  CASE WHEN ipt.regtime IS NULL THEN 'N' ELSE 'Y' END AS check_timeadm,
  ipt.dchdate,
  CASE WHEN ipt.dchdate IS NULL THEN 'N' ELSE 'Y' END AS check_datedsc,
  ipt.dchtime,
  CASE WHEN ipt.dchtime IS NULL THEN 'N' ELSE 'Y' END AS check_timedsc,
  dt.name AS dchstts,
  CASE WHEN ipt.dchstts IS NULL THEN 'N' ELSE 'Y' END AS check_dischs,
  dp.name AS dchtype,
  CASE WHEN ipt.dchtype IS NULL THEN 'N' ELSE 'Y' END AS check_discht,
  w.name AS first_ward,
  CASE WHEN ipt.first_ward IS NULL THEN 'N' ELSE 'Y' END AS check_warddsc,
  s.name AS spclty,
  CASE WHEN ipt.spclty IS NULL THEN 'N' ELSE 'Y' END AS check_dept,
  ipt.bw,
  CASE WHEN ipt.bw IS NULL THEN 'N' ELSE 'Y' END AS check_adm_w,
  visit_pttype.request_funds,
  CASE WHEN (visit_pttype.request_funds IS NULL OR visit_pttype.request_funds = '' OR visit_pttype.request_funds = 'N') THEN 'N' ELSE 'Y' END AS check_uuc,
  ip.ipt_type_name,
  CASE WHEN ipt.ipt_type IS NULL THEN 'N' ELSE 'Y' END AS check_svctype
FROM ipt
  LEFT JOIN ovst ON ovst.an = ipt.an
  LEFT JOIN visit_pttype ON visit_pttype.vn = ovst.vn
  LEFT JOIN dchstts dt ON dt.dchstts = ipt.dchstts
  LEFT JOIN dchtype dp ON dp.dchtype = ipt.dchtype
  LEFT JOIN ward w ON w.ward = ipt.first_ward
  LEFT JOIN spclty s ON s.spclty = ipt.spclty
  LEFT JOIN ipt_type ip ON ip.ipt_type = ipt.ipt_type
WHERE ipt.dchdate BETWEEN '2026-06-15' AND '2026-06-15'
AND ipt.pttype IN (SELECT p.pttype FROM pttype p WHERE p.isuse='Y' AND hipdata_code IN ('UCS','WEL'));
-- ============================================================
-- เมนู: FDH-IOP (หัตถการผู้ป่วยใน) -- endpoint: /api/get-fdh-iop
-- ============================================================

-- ▶ PostgreSQL
SELECT (CASE WHEN i.ipt_admit_type_id = '5' THEN CONCAT('ODS', op.an) ELSE op.an END) AS an,
  ot.name AS oper_type,
  op.icd9 AS oper,
  CASE WHEN op.icd9 <> '' THEN 'Y' ELSE 'N' END AS check_icd9,
  op.opdate AS datein,
  CASE WHEN op.opdate IS NOT NULL THEN 'Y' ELSE 'N' END AS check_datein,
  op.optime AS timein,
  CASE WHEN op.optime IS NOT NULL AND op.optime <> '00:00:00' THEN 'Y' ELSE 'N' END AS check_timein,
  op.enddate AS dateout,
  CASE WHEN op.enddate IS NOT NULL THEN 'Y' ELSE 'N' END AS check_dateout,
  op.endtime AS timeout,
  CASE WHEN op.endtime IS NOT NULL AND op.endtime <> '00:00:00' THEN 'Y' ELSE 'N' END AS check_timeout,
  d.licenseno,
  CASE WHEN d.licenseno <> '' THEN 'Y' ELSE 'N' END AS check_licenseno
FROM iptoprt op
  LEFT OUTER JOIN doctor d ON d.code = op.doctor
  LEFT OUTER JOIN ipt i ON i.an = op.an
  LEFT OUTER JOIN oper_type ot ON ot.oper_type = op.oper_type
WHERE i.dchdate BETWEEN '2026-06-15' AND '2026-06-15'
AND i.pttype IN (SELECT p.pttype FROM pttype p WHERE p.isuse='Y' AND hipdata_code IN ('UCS','WEL'))
ORDER BY op.an, op.priority;

-- ▶ MySQL
SELECT (CASE WHEN i.ipt_admit_type_id = '5' THEN CONCAT('ODS', op.an) ELSE op.an END) AS an,
  ot.name AS oper_type,
  op.icd9 AS oper,
  CASE WHEN op.icd9 <> '' THEN 'Y' ELSE 'N' END AS check_icd9,
  op.opdate AS datein,
  CASE WHEN op.opdate IS NOT NULL THEN 'Y' ELSE 'N' END AS check_datein,
  op.optime AS timein,
  CASE WHEN op.optime IS NOT NULL AND op.optime <> '00:00:00' THEN 'Y' ELSE 'N' END AS check_timein,
  op.enddate AS dateout,
  CASE WHEN op.enddate IS NOT NULL THEN 'Y' ELSE 'N' END AS check_dateout,
  op.endtime AS timeout,
  CASE WHEN op.endtime IS NOT NULL AND op.endtime <> '00:00:00' THEN 'Y' ELSE 'N' END AS check_timeout,
  d.licenseno,
  CASE WHEN d.licenseno <> '' THEN 'Y' ELSE 'N' END AS check_licenseno
FROM iptoprt op
  LEFT OUTER JOIN doctor d ON d.code = op.doctor
  LEFT OUTER JOIN ipt i ON i.an = op.an
  LEFT OUTER JOIN oper_type ot ON ot.oper_type = op.oper_type
WHERE i.dchdate BETWEEN '2026-06-15' AND '2026-06-15'
AND i.pttype IN (SELECT p.pttype FROM pttype p WHERE p.isuse='Y' AND hipdata_code IN ('UCS','WEL'))
ORDER BY op.an, op.priority;

-- ============================================================
-- เมนู: FDH-CHT (ค่าใช้จ่ายรวม) -- endpoint: /api/get-fdh-cht
-- ============================================================

-- ▶ PostgreSQL
SELECT v.hn,
  '' AS an,
  v.vstdate,
  vs.income AS total,
  vs.income,
  CASE WHEN vs.income IS NOT NULL THEN 'Y' ELSE 'N' END AS check_total,
  vs.paid_money AS paid,
  CASE WHEN p1.paidst IN ('01','03') THEN '10' ELSE p1.pcode END AS pttype,
  p.cid AS person_id,
  CASE WHEN p1.paidst IN ('01','03') THEN 'ชำระเงิน' ELSE 'ใช้สิทธิ' END AS check_pttype,
  CASE WHEN v.an <> '' THEN v.an ELSE v.vn END AS seq,
  '' AS opd_memo,
  '' AS invoice_no,
  '' AS invoice_lt
FROM ovst v
  INNER JOIN patient p ON p.hn = v.hn
  INNER JOIN vn_stat vs ON vs.vn = v.vn
  LEFT JOIN visit_pttype vp ON vp.vn = v.vn AND vp.pttype_number = '1'
  LEFT JOIN pttype p1 ON p1.pttype = vp.pttype
WHERE v.vstdate BETWEEN '2026-06-15' AND '2026-06-15'
AND v.pttype IN (SELECT p.pttype FROM pttype p WHERE p.isuse='Y' AND hipdata_code IN ('UCS','WEL'))

UNION ALL

SELECT i.hn,
  CASE WHEN i.ipt_admit_type_id = '5' THEN CONCAT('ODS', i.an) ELSE i.an END AS an,
  i.regdate AS vstdate,
  a.income AS total,
  a.income,
  CASE WHEN a.income IS NOT NULL THEN 'Y' ELSE 'N' END AS check_total,
  a.paid_money AS paid,
  CASE WHEN p1.paidst IN ('01','03') THEN '10' ELSE p1.pcode END AS pttype,
  p.cid AS person_id,
  CASE WHEN p1.paidst IN ('01','03') THEN 'ชำระเงิน' ELSE 'ใช้สิทธิ' END AS check_pttype,
  CASE WHEN i.an <> '' THEN i.an ELSE i.vn END AS seq,
  '' AS opd_memo,
  '' AS invoice_no,
  '' AS invoice_lt
FROM ipt i
  INNER JOIN patient p ON p.hn = i.hn
  INNER JOIN an_stat a ON a.an = i.an
  LEFT JOIN ipt_pttype ip ON ip.an = i.an AND ip.pttype_number = '1'
  LEFT JOIN pttype p1 ON p1.pttype = ip.pttype
WHERE i.dchdate BETWEEN '2026-06-15' AND '2026-06-15'
AND i.pttype IN (SELECT p.pttype FROM pttype p WHERE p.isuse='Y' AND hipdata_code IN ('UCS','WEL'));

-- ▶ MySQL
SELECT v.hn,
  '' AS an,
  v.vstdate,
  vs.income AS total,
  vs.income,
  CASE WHEN vs.income IS NOT NULL THEN 'Y' ELSE 'N' END AS check_total,
  vs.paid_money AS paid,
  CASE WHEN p1.paidst IN ('01','03') THEN '10' ELSE p1.pcode END AS pttype,
  p.cid AS person_id,
  CASE WHEN p1.paidst IN ('01','03') THEN 'ชำระเงิน' ELSE 'ใช้สิทธิ' END AS check_pttype,
  CASE WHEN v.an <> '' THEN v.an ELSE v.vn END AS seq,
  '' AS opd_memo,
  '' AS invoice_no,
  '' AS invoice_lt
FROM ovst v
  INNER JOIN patient p ON p.hn = v.hn
  INNER JOIN vn_stat vs ON vs.vn = v.vn
  LEFT JOIN visit_pttype vp ON vp.vn = v.vn AND vp.pttype_number = '1'
  LEFT JOIN pttype p1 ON p1.pttype = vp.pttype
WHERE v.vstdate BETWEEN '2026-06-15' AND '2026-06-15'
AND v.pttype IN (SELECT p.pttype FROM pttype p WHERE p.isuse='Y' AND hipdata_code IN ('UCS','WEL'))

UNION ALL

SELECT i.hn,
  CASE WHEN i.ipt_admit_type_id = '5' THEN CONCAT('ODS', i.an) ELSE i.an END AS an,
  i.regdate AS vstdate,
  a.income AS total,
  a.income,
  CASE WHEN a.income IS NOT NULL THEN 'Y' ELSE 'N' END AS check_total,
  a.paid_money AS paid,
  CASE WHEN p1.paidst IN ('01','03') THEN '10' ELSE p1.pcode END AS pttype,
  p.cid AS person_id,
  CASE WHEN p1.paidst IN ('01','03') THEN 'ชำระเงิน' ELSE 'ใช้สิทธิ' END AS check_pttype,
  CASE WHEN i.an <> '' THEN i.an ELSE i.vn END AS seq,
  '' AS opd_memo,
  '' AS invoice_no,
  '' AS invoice_lt
FROM ipt i
  INNER JOIN patient p ON p.hn = i.hn
  INNER JOIN an_stat a ON a.an = i.an
  LEFT JOIN ipt_pttype ip ON ip.an = i.an AND ip.pttype_number = '1'
  LEFT JOIN pttype p1 ON p1.pttype = ip.pttype
WHERE i.dchdate BETWEEN '2026-06-15' AND '2026-06-15'
AND i.pttype IN (SELECT p.pttype FROM pttype p WHERE p.isuse='Y' AND hipdata_code IN ('UCS','WEL'));

-- ============================================================
-- เมนู: FDH-CHA (รายการค่าใช้จ่าย) -- endpoint: /api/get-fdh-cha
-- ============================================================

-- ▶ PostgreSQL
SELECT ovst.vn AS vnan,
  ovst.hn,
  pt.pname,
  pt.fname,
  pt.lname,
  ovst.vstdate AS dchdate,
  NULL AS ipt_type,
  pt.cid,
  t.pcode,
  d.chrgitem_code1,
  inc.income AS chrgitem,
  NULL AS ipt_admit_type_id,
  SUM(inc.rcptamt) AS amount
FROM ovst
  LEFT OUTER JOIN incoth inc ON inc.vn = ovst.vn AND inc.paidst = '02'
  LEFT OUTER JOIN patient pt ON pt.hn = ovst.hn
  LEFT OUTER JOIN income ic ON ic.income = inc.income
  LEFT OUTER JOIN drg_chrgitem d ON d.drg_chrgitem_id = ic.drg_chrgitem_id
  LEFT OUTER JOIN pttype t ON t.pttype = ovst.pttype
WHERE ovst.vstdate BETWEEN '2026-06-15' AND '2026-06-15'
AND ovst.pttype IN (SELECT p.pttype FROM pttype p WHERE p.isuse='Y' AND hipdata_code IN ('UCS','WEL'))
GROUP BY ovst.vn, ovst.hn, pt.pname, pt.fname, pt.lname,
  ovst.vstdate, pt.cid, t.pcode, d.chrgitem_code1, inc.income, ovst.an

UNION ALL

SELECT ipt.an AS vnan,
  ipt.hn,
  pt.pname,
  pt.fname,
  pt.lname,
  ipt.dchdate,
  ipt.ipt_type,
  pt.cid,
  t.pcode,
  d.chrgitem_code1,
  inc.income AS chrgitem,
  ipt.ipt_admit_type_id,
  SUM(inc.rcptamt) AS amount
FROM ipt
  LEFT OUTER JOIN incith inc ON inc.an = ipt.an AND inc.paidst = '02'
  LEFT OUTER JOIN income ic ON ic.income = inc.income
  LEFT OUTER JOIN drg_chrgitem d ON d.drg_chrgitem_id = ic.drg_chrgitem_id
  LEFT OUTER JOIN pttype t ON t.pttype = ipt.pttype
  LEFT OUTER JOIN patient pt ON pt.hn = ipt.hn
WHERE ipt.dchdate BETWEEN '2026-06-15' AND '2026-06-15'
AND ipt.pttype IN (SELECT p.pttype FROM pttype p WHERE p.isuse='Y' AND hipdata_code IN ('UCS','WEL'))
GROUP BY ipt.an, ipt.hn, pt.pname, pt.fname, pt.lname,
  ipt.dchdate, ipt.ipt_type, pt.cid, t.pcode, d.chrgitem_code1,
  inc.income, ipt.ipt_admit_type_id

ORDER BY vnan, chrgitem_code1;

-- ▶ MySQL
SELECT ovst.vn AS vnan,
  ovst.hn,
  pt.pname,
  pt.fname,
  pt.lname,
  ovst.vstdate AS dchdate,
  NULL AS ipt_type,
  pt.cid,
  t.pcode,
  d.chrgitem_code1,
  inc.income AS chrgitem,
  NULL AS ipt_admit_type_id,
  SUM(inc.rcptamt) AS amount
FROM ovst
  LEFT OUTER JOIN incoth inc ON inc.vn = ovst.vn AND inc.paidst = '02'
  LEFT OUTER JOIN patient pt ON pt.hn = ovst.hn
  LEFT OUTER JOIN income ic ON ic.income = inc.income
  LEFT OUTER JOIN drg_chrgitem d ON d.drg_chrgitem_id = ic.drg_chrgitem_id
  LEFT OUTER JOIN pttype t ON t.pttype = ovst.pttype
WHERE ovst.vstdate BETWEEN '2026-06-15' AND '2026-06-15'
AND ovst.pttype IN (SELECT p.pttype FROM pttype p WHERE p.isuse='Y' AND hipdata_code IN ('UCS','WEL'))
GROUP BY ovst.vn, ovst.hn, pt.pname, pt.fname, pt.lname,
  ovst.vstdate, pt.cid, t.pcode, d.chrgitem_code1, inc.income, ovst.an

UNION ALL

SELECT ipt.an AS vnan,
  ipt.hn,
  pt.pname,
  pt.fname,
  pt.lname,
  ipt.dchdate,
  ipt.ipt_type,
  pt.cid,
  t.pcode,
  d.chrgitem_code1,
  inc.income AS chrgitem,
  ipt.ipt_admit_type_id,
  SUM(inc.rcptamt) AS amount
FROM ipt
  LEFT OUTER JOIN incith inc ON inc.an = ipt.an AND inc.paidst = '02'
  LEFT OUTER JOIN income ic ON ic.income = inc.income
  LEFT OUTER JOIN drg_chrgitem d ON d.drg_chrgitem_id = ic.drg_chrgitem_id
  LEFT OUTER JOIN pttype t ON t.pttype = ipt.pttype
  LEFT OUTER JOIN patient pt ON pt.hn = ipt.hn
WHERE ipt.dchdate BETWEEN '2026-06-15' AND '2026-06-15'
AND ipt.pttype IN (SELECT p.pttype FROM pttype p WHERE p.isuse='Y' AND hipdata_code IN ('UCS','WEL'))
GROUP BY ipt.an, ipt.hn, pt.pname, pt.fname, pt.lname,
  ipt.dchdate, ipt.ipt_type, pt.cid, t.pcode, d.chrgitem_code1,
  inc.income, ipt.ipt_admit_type_id

ORDER BY vnan, chrgitem_code1;

-- ============================================================
-- เมนู: FDH-IDX (วินิจฉัยผู้ป่วยใน) -- endpoint: /api/get-fdh-idx
-- ============================================================

-- ▶ PostgreSQL
SELECT
  CASE WHEN i2.ipt_admit_type_id = '5' THEN CONCAT('ODS', i2.an) ELSE i2.an END AS an,
  i1.icd10 AS diag,
  CASE WHEN i1.icd10 IS NOT NULL THEN 'Y' ELSE 'N' END AS check_diag,
  i1.diagtype AS dxtype,
  CASE WHEN i1.diagtype <> '' THEN 'Y' ELSE 'N' END AS check_diagtype,
  d.licenseno,
  CASE WHEN d.licenseno <> '' THEN 'Y' ELSE 'N' END AS check_licenceno
FROM ipt i2
  LEFT OUTER JOIN iptdiag i1 ON i1.an = i2.an
  LEFT OUTER JOIN diagtype dx ON dx.diagtype = i1.diagtype
  LEFT OUTER JOIN doctor d ON d.code = i1.doctor
WHERE i2.dchdate BETWEEN '2026-06-15' AND '2026-06-15'
AND i2.pttype IN (SELECT p.pttype FROM pttype p WHERE p.isuse='Y' AND hipdata_code IN ('UCS','WEL'))
ORDER BY i2.an, i1.diagtype, i1.diag_no, i1.ipt_diag_id;

-- ▶ MySQL
SELECT
  CASE WHEN i2.ipt_admit_type_id = '5' THEN CONCAT('ODS', i2.an) ELSE i2.an END AS an,
  i1.icd10 AS diag,
  CASE WHEN i1.icd10 IS NOT NULL THEN 'Y' ELSE 'N' END AS check_diag,
  i1.diagtype AS dxtype,
  CASE WHEN i1.diagtype <> '' THEN 'Y' ELSE 'N' END AS check_diagtype,
  d.licenseno,
  CASE WHEN d.licenseno <> '' THEN 'Y' ELSE 'N' END AS check_licenceno
FROM ipt i2
  LEFT OUTER JOIN iptdiag i1 ON i1.an = i2.an
  LEFT OUTER JOIN diagtype dx ON dx.diagtype = i1.diagtype
  LEFT OUTER JOIN doctor d ON d.code = i1.doctor
WHERE i2.dchdate BETWEEN '2026-06-15' AND '2026-06-15'
AND i2.pttype IN (SELECT p.pttype FROM pttype p WHERE p.isuse='Y' AND hipdata_code IN ('UCS','WEL'))
ORDER BY i2.an, i1.diagtype, i1.diag_no, i1.ipt_diag_id;

-- ============================================================
-- เมนู: FDH-LVD (ข้อมูลการคลอด) -- endpoint: /api/get-fdh-lvd
-- ============================================================

-- ▶ PostgreSQL
SELECT
  hl.ipt_home_leave_id AS seglvd,
  CASE WHEN hl.ipt_home_leave_id IS NOT NULL THEN 'Y' ELSE 'N' END AS check_seglvd,
  hl.dch_date,
  CASE WHEN hl.dch_date IS NOT NULL THEN 'Y' ELSE 'N' END AS check_dch_date,
  hl.dch_time,
  CASE WHEN hl.dch_time IS NOT NULL THEN 'Y' ELSE 'N' END AS check_dch_time,
  hl.reg_date,
  CASE WHEN hl.reg_date IS NOT NULL THEN 'Y' ELSE 'N' END AS check_reg_date,
  hl.reg_time,
  CASE WHEN hl.reg_time IS NOT NULL THEN 'Y' ELSE 'N' END AS check_reg_time,
  hl.an,
  p.hn,
  CONCAT(p.pname, p.fname, ' ', p.lname) AS pt_name,
  i.regdate,
  CASE WHEN hl.reg_date IS NOT NULL AND hl.dch_date IS NOT NULL AND (hl.reg_date - hl.dch_date) > 0
    THEN (hl.reg_date - hl.dch_date)::text ELSE 'N' END AS qty_day,
  CASE WHEN hl.dch_date IS NOT NULL AND hl.reg_date IS NOT NULL AND (hl.reg_date - hl.dch_date) > 0
    THEN 'Y' ELSE 'N' END AS check_qty_day
FROM ipt i
  LEFT JOIN ipt_home_leave hl ON hl.an = i.an
  LEFT JOIN patient p ON p.hn = i.hn
WHERE i.dchdate BETWEEN '2026-06-15' AND '2026-06-15'
AND i.pttype IN (SELECT p.pttype FROM pttype p WHERE p.isuse='Y' AND hipdata_code IN ('UCS','WEL'))
AND hl.an = i.an
ORDER BY hl.an;

-- ▶ MySQL
SELECT
  hl.ipt_home_leave_id AS seglvd,
  CASE WHEN hl.ipt_home_leave_id IS NOT NULL THEN 'Y' ELSE 'N' END AS check_seglvd,
  hl.dch_date,
  CASE WHEN hl.dch_date IS NOT NULL THEN 'Y' ELSE 'N' END AS check_dch_date,
  hl.dch_time,
  CASE WHEN hl.dch_time IS NOT NULL THEN 'Y' ELSE 'N' END AS check_dch_time,
  hl.reg_date,
  CASE WHEN hl.reg_date IS NOT NULL THEN 'Y' ELSE 'N' END AS check_reg_date,
  hl.reg_time,
  CASE WHEN hl.reg_time IS NOT NULL THEN 'Y' ELSE 'N' END AS check_reg_time,
  hl.an,
  p.hn,
  CONCAT(p.pname, p.fname, ' ', p.lname) AS pt_name,
  i.regdate,
  CASE WHEN hl.reg_date IS NOT NULL AND hl.dch_date IS NOT NULL AND DATEDIFF(hl.reg_date, hl.dch_date) > 0
    THEN CAST(DATEDIFF(hl.reg_date, hl.dch_date) AS CHAR) ELSE 'N' END AS qty_day,
  CASE WHEN hl.dch_date IS NOT NULL AND hl.reg_date IS NOT NULL AND DATEDIFF(hl.reg_date, hl.dch_date) > 0
    THEN 'Y' ELSE 'N' END AS check_qty_day
FROM ipt i
  LEFT JOIN ipt_home_leave hl ON hl.an = i.an
  LEFT JOIN patient p ON p.hn = i.hn
WHERE i.dchdate BETWEEN '2026-06-15' AND '2026-06-15'
AND i.pttype IN (SELECT p.pttype FROM pttype p WHERE p.isuse='Y' AND hipdata_code IN ('UCS','WEL'))
AND hl.an = i.an
ORDER BY hl.an;

-- ============================================================
-- เมนู: FDH-DRU (ยาและเวชภัณฑ์) -- endpoint: /api/get-fdh-dru
-- ============================================================

-- ▶ PostgreSQL
SELECT
  (SELECT hospitalcode FROM opdconfig LIMIT 1) AS hcode,
  vst.hn,
  ip.an,
  vst.vn,
  vst.spclty AS clinic,
  v.cid AS person_id,
  vst.vstdate AS date_serv,
  di.did,
  CASE WHEN di.did IS NOT NULL THEN 'Y' ELSE 'N' END AS check_did,
  TRIM(CONCAT(di.name, ' ', di.strength, ' ', di.units)) AS didname,
  op.qty AS amount,
  CASE WHEN op.qty IS NOT NULL THEN 'Y' ELSE 'N' END AS check_amount,
  op.unitprice AS drugprice,
  CASE WHEN op.unitprice IS NOT NULL THEN 'Y' ELSE 'N' END AS check_drugprice,
  op.cost AS drugcost,
  CASE WHEN op.cost IS NOT NULL THEN 'Y' ELSE 'N' END AS check_drugcost,
  di.tmt_tp_code AS didstd,
  CASE WHEN di.tmt_tp_code IS NOT NULL THEN 'Y' ELSE 'N' END AS check_didstd,
  di.units AS unit,
  CASE WHEN di.units IS NOT NULL THEN 'Y' ELSE 'N' END AS check_unit,
  CONCAT(di.packqty, 'x', di.units) AS unit_pack,
  vst.vn AS seq,
  ned.presc_reason AS drugremark,
  CASE WHEN ned.presc_reason IS NOT NULL THEN 'Y' ELSE 'N' END AS check_drugremark,
  ned.nhso_authorize_code AS pa_no,
  op.paidst AS use_status,
  CASE WHEN op.paidst IS NOT NULL THEN 'Y' ELSE 'N' END AS check_use_status,
  SUM(CASE WHEN op.paidst IN ('01','03') THEN op.qty * op.unitprice ELSE 0 END) AS totcopay,
  SUM(CASE WHEN op.paidst IN ('02') THEN op.qty * op.unitprice ELSE 0 END) AS total,
  op.doctor AS provider
FROM ovst vst
  LEFT JOIN opitemrece op ON op.vn = vst.vn AND op.qty > 0 AND op.sum_price > 0 AND op.paidst IN ('01','02','03')
  LEFT JOIN drugitems di ON di.icode = op.icode
  LEFT JOIN vn_stat v ON v.vn = vst.vn
  LEFT JOIN ovst_presc_ned ned ON ned.vn = op.vn AND ned.icode = op.icode AND ned.doctor = op.doctor
  LEFT JOIN drugitems_ned_reason_list dl ON dl.claim_control = ned.presc_reason
  LEFT JOIN ipt ip ON ip.an = vst.an
WHERE vst.vstdate BETWEEN '2026-06-15' AND '2026-06-15'
AND vst.pttype IN (SELECT p.pttype FROM pttype p WHERE p.isuse='Y' AND hipdata_code IN ('UCS','WEL'))
GROUP BY
  vst.hn, ip.an, vst.vn, vst.spclty, v.cid, vst.vstdate,
  di.did, di.name, di.strength, di.units, op.qty, op.unitprice, op.cost,
  di.tmt_tp_code, di.packqty, ned.presc_reason, ned.nhso_authorize_code,
  op.paidst, op.doctor;

-- ▶ MySQL
SELECT
  (SELECT hospitalcode FROM opdconfig LIMIT 1) AS hcode,
  vst.hn,
  ip.an,
  vst.vn,
  vst.spclty AS clinic,
  v.cid AS person_id,
  vst.vstdate AS date_serv,
  di.did,
  CASE WHEN di.did IS NOT NULL THEN 'Y' ELSE 'N' END AS check_did,
  TRIM(CONCAT(di.name, ' ', di.strength, ' ', di.units)) AS didname,
  op.qty AS amount,
  CASE WHEN op.qty IS NOT NULL THEN 'Y' ELSE 'N' END AS check_amount,
  op.unitprice AS drugprice,
  CASE WHEN op.unitprice IS NOT NULL THEN 'Y' ELSE 'N' END AS check_drugprice,
  op.cost AS drugcost,
  CASE WHEN op.cost IS NOT NULL THEN 'Y' ELSE 'N' END AS check_drugcost,
  di.tmt_tp_code AS didstd,
  CASE WHEN di.tmt_tp_code IS NOT NULL THEN 'Y' ELSE 'N' END AS check_didstd,
  di.units AS unit,
  CASE WHEN di.units IS NOT NULL THEN 'Y' ELSE 'N' END AS check_unit,
  CONCAT(di.packqty, 'x', di.units) AS unit_pack,
  vst.vn AS seq,
  ned.presc_reason AS drugremark,
  CASE WHEN ned.presc_reason IS NOT NULL THEN 'Y' ELSE 'N' END AS check_drugremark,
  ned.nhso_authorize_code AS pa_no,
  op.paidst AS use_status,
  CASE WHEN op.paidst IS NOT NULL THEN 'Y' ELSE 'N' END AS check_use_status,
  SUM(CASE WHEN op.paidst IN ('01','03') THEN op.qty * op.unitprice ELSE 0 END) AS totcopay,
  SUM(CASE WHEN op.paidst IN ('02') THEN op.qty * op.unitprice ELSE 0 END) AS total,
  op.doctor AS provider
FROM ovst vst
  LEFT JOIN opitemrece op ON op.vn = vst.vn AND op.qty > 0 AND op.sum_price > 0 AND op.paidst IN ('01','02','03')
  LEFT JOIN drugitems di ON di.icode = op.icode
  LEFT JOIN vn_stat v ON v.vn = vst.vn
  LEFT JOIN ovst_presc_ned ned ON ned.vn = op.vn AND ned.icode = op.icode AND ned.doctor = op.doctor
  LEFT JOIN drugitems_ned_reason_list dl ON dl.claim_control = ned.presc_reason
  LEFT JOIN ipt ip ON ip.an = vst.an
WHERE vst.vstdate BETWEEN '2026-06-15' AND '2026-06-15'
AND vst.pttype IN (SELECT p.pttype FROM pttype p WHERE p.isuse='Y' AND hipdata_code IN ('UCS','WEL'))
GROUP BY
  vst.hn, ip.an, vst.vn, vst.spclty, v.cid, vst.vstdate,
  di.did, di.name, di.strength, di.units, op.qty, op.unitprice, op.cost,
  di.tmt_tp_code, di.packqty, ned.presc_reason, ned.nhso_authorize_code,
  op.paidst, op.doctor;

-- ============================================================
-- เมนู: FDH-LABFU (ผลแล็บติดตาม) -- endpoint: /api/get-fdh-labfu
-- ============================================================

-- ▶ PostgreSQL
SELECT
  (SELECT hospitalcode FROM opdconfig LIMIT 1) AS hcode,
  p.hn,
  p.cid,
  CASE WHEN (p.cid IS NULL OR p.cid = '') THEN 'N' ELSE 'Y' END AS check_person_id,
  ovst.vstdate,
  CASE WHEN ovst.vstdate IS NULL THEN 'N' ELSE 'Y' END AS check_dateopd,
  ovst.vn,
  CASE WHEN ovst.vn IS NULL THEN 'N' ELSE 'Y' END AS check_seq,
  sll.sys_lab_code_id,
  CASE WHEN sll.sys_lab_code_id IS NULL THEN 'N' ELSE 'Y' END AS check_labtest,
  lo.lab_order_result,
  CASE WHEN lo.lab_order_result IS NULL THEN 'N' ELSE 'Y' END AS check_labresult
FROM patient p
  LEFT JOIN ovst ON ovst.hn = p.hn
  LEFT JOIN lab_head l ON l.vn = ovst.vn
  LEFT JOIN lab_order lo ON lo.lab_order_number = l.lab_order_number
  LEFT JOIN lab_items li ON li.lab_items_code = lo.lab_items_code
  LEFT JOIN sys_lab_link sll ON sll.lab_items_code = li.lab_items_code
WHERE ovst.vstdate BETWEEN '2026-06-15' AND '2026-06-15'
AND ovst.pttype IN (SELECT p.pttype FROM pttype p WHERE p.isuse='Y' AND hipdata_code IN ('UCS','WEL'));

-- ▶ MySQL
SELECT
  (SELECT hospitalcode FROM opdconfig LIMIT 1) AS hcode,
  p.hn,
  p.cid,
  CASE WHEN (p.cid IS NULL OR p.cid = '') THEN 'N' ELSE 'Y' END AS check_person_id,
  ovst.vstdate,
  CASE WHEN ovst.vstdate IS NULL THEN 'N' ELSE 'Y' END AS check_dateopd,
  ovst.vn,
  CASE WHEN ovst.vn IS NULL THEN 'N' ELSE 'Y' END AS check_seq,
  sll.sys_lab_code_id,
  CASE WHEN sll.sys_lab_code_id IS NULL THEN 'N' ELSE 'Y' END AS check_labtest,
  lo.lab_order_result,
  CASE WHEN lo.lab_order_result IS NULL THEN 'N' ELSE 'Y' END AS check_labresult
FROM patient p
  LEFT JOIN ovst ON ovst.hn = p.hn
  LEFT JOIN lab_head l ON l.vn = ovst.vn
  LEFT JOIN lab_order lo ON lo.lab_order_number = l.lab_order_number
  LEFT JOIN lab_items li ON li.lab_items_code = lo.lab_items_code
  LEFT JOIN sys_lab_link sll ON sll.lab_items_code = li.lab_items_code
WHERE ovst.vstdate BETWEEN '2026-06-15' AND '2026-06-15'
AND ovst.pttype IN (SELECT p.pttype FROM pttype p WHERE p.isuse='Y' AND hipdata_code IN ('UCS','WEL'));

-- ============================================================
-- เมนู: FDH-PHDB (ข้อมูลสาธารณสุข) -- endpoint: /api/get-fdh-phdb
-- ============================================================

-- ▶ PostgreSQL
SELECT
  vst.vstdate AS service_date,
  NULL AS regdate,
  NULL AS dchdate,
  CONCAT(pt.pname, pt.fname, ' ', pt.lname) AS pt_name,
  vst.hn,
  NULL AS an,
  vst.vn,
  di.income_phdb_code,
  CASE WHEN di.income_phdb_code IS NOT NULL THEN 'Y' ELSE 'N' END AS check_income_phdb_code,
  op.qty,
  CASE WHEN op.qty IS NOT NULL AND op.qty > 0 THEN 'Y' ELSE 'N' END AS check_qty,
  op.unitprice,
  CASE WHEN op.unitprice IS NOT NULL AND op.unitprice > 0 THEN 'Y' ELSE 'N' END AS check_unitprice,
  py.hipdata_code,
  CASE WHEN py.hipdata_code IS NOT NULL THEN 'Y' ELSE 'N' END AS check_hipdata_code,
  'OPD' AS source_type
FROM ovst vst
  LEFT JOIN opitemrece op ON op.vn = vst.vn AND op.qty > 0 AND op.sum_price > 0
  LEFT JOIN nondrugitems di ON di.icode = op.icode
  LEFT JOIN pttype py ON py.pttype = op.pttype
  LEFT JOIN patient pt ON pt.hn = vst.hn
WHERE vst.vstdate BETWEEN '2026-06-15' AND '2026-06-15'
AND vst.pttype IN (SELECT p.pttype FROM pttype p WHERE p.isuse='Y' AND hipdata_code IN ('UCS','WEL'))

UNION ALL

SELECT
  NULL AS service_date,
  ipt.regdate,
  ipt.dchdate,
  CONCAT(pt.pname, pt.fname, ' ', pt.lname) AS pt_name,
  ipt.hn,
  ipt.an,
  ipt.vn,
  di.income_phdb_code,
  CASE WHEN di.income_phdb_code IS NOT NULL THEN 'Y' ELSE 'N' END AS check_income_phdb_code,
  op.qty,
  CASE WHEN op.qty IS NOT NULL AND op.qty > 0 THEN 'Y' ELSE 'N' END AS check_qty,
  op.unitprice,
  CASE WHEN op.unitprice IS NOT NULL AND op.unitprice > 0 THEN 'Y' ELSE 'N' END AS check_unitprice,
  py.hipdata_code,
  CASE WHEN py.hipdata_code IS NOT NULL THEN 'Y' ELSE 'N' END AS check_hipdata_code,
  'IPD' AS source_type
FROM ipt
  LEFT JOIN opitemrece op ON op.an = ipt.an AND op.qty > 0 AND op.sum_price > 0
  LEFT JOIN nondrugitems di ON di.icode = op.icode
  LEFT JOIN pttype py ON py.pttype = op.pttype
  LEFT JOIN patient pt ON pt.hn = ipt.hn
WHERE ipt.dchdate BETWEEN '2026-06-15' AND '2026-06-15'
AND ipt.pttype IN (SELECT p.pttype FROM pttype p WHERE p.isuse='Y' AND hipdata_code IN ('UCS','WEL'));

-- ▶ MySQL
SELECT
  vst.vstdate AS service_date,
  NULL AS regdate,
  NULL AS dchdate,
  CONCAT(pt.pname, pt.fname, ' ', pt.lname) AS pt_name,
  vst.hn,
  NULL AS an,
  vst.vn,
  di.income_phdb_code,
  CASE WHEN di.income_phdb_code IS NOT NULL THEN 'Y' ELSE 'N' END AS check_income_phdb_code,
  op.qty,
  CASE WHEN op.qty IS NOT NULL AND op.qty > 0 THEN 'Y' ELSE 'N' END AS check_qty,
  op.unitprice,
  CASE WHEN op.unitprice IS NOT NULL AND op.unitprice > 0 THEN 'Y' ELSE 'N' END AS check_unitprice,
  py.hipdata_code,
  CASE WHEN py.hipdata_code IS NOT NULL THEN 'Y' ELSE 'N' END AS check_hipdata_code,
  'OPD' AS source_type
FROM ovst vst
  LEFT JOIN opitemrece op ON op.vn = vst.vn AND op.qty > 0 AND op.sum_price > 0
  LEFT JOIN nondrugitems di ON di.icode = op.icode
  LEFT JOIN pttype py ON py.pttype = op.pttype
  LEFT JOIN patient pt ON pt.hn = vst.hn
WHERE vst.vstdate BETWEEN '2026-06-15' AND '2026-06-15'
AND vst.pttype IN (SELECT p.pttype FROM pttype p WHERE p.isuse='Y' AND hipdata_code IN ('UCS','WEL'))

UNION ALL

SELECT
  NULL AS service_date,
  ipt.regdate,
  ipt.dchdate,
  CONCAT(pt.pname, pt.fname, ' ', pt.lname) AS pt_name,
  ipt.hn,
  ipt.an,
  ipt.vn,
  di.income_phdb_code,
  CASE WHEN di.income_phdb_code IS NOT NULL THEN 'Y' ELSE 'N' END AS check_income_phdb_code,
  op.qty,
  CASE WHEN op.qty IS NOT NULL AND op.qty > 0 THEN 'Y' ELSE 'N' END AS check_qty,
  op.unitprice,
  CASE WHEN op.unitprice IS NOT NULL AND op.unitprice > 0 THEN 'Y' ELSE 'N' END AS check_unitprice,
  py.hipdata_code,
  CASE WHEN py.hipdata_code IS NOT NULL THEN 'Y' ELSE 'N' END AS check_hipdata_code,
  'IPD' AS source_type
FROM ipt
  LEFT JOIN opitemrece op ON op.an = ipt.an AND op.qty > 0 AND op.sum_price > 0
  LEFT JOIN nondrugitems di ON di.icode = op.icode
  LEFT JOIN pttype py ON py.pttype = op.pttype
  LEFT JOIN patient pt ON pt.hn = ipt.hn
WHERE ipt.dchdate BETWEEN '2026-06-15' AND '2026-06-15'
AND ipt.pttype IN (SELECT p.pttype FROM pttype p WHERE p.isuse='Y' AND hipdata_code IN ('UCS','WEL'));
