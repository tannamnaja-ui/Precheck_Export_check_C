-- ============================================================
-- เมนู: Billtran (บิลทั่วไป) -- endpoint: /api/get-billtran
-- ============================================================

-- ▶ PostgreSQL
SELECT
    rd.debt_id, ov.vstdate, ov.vn, vp.auth_code AS authcode,
    rd.debt_date_time AS dttran,
    op.hospitalcode AS hcode,
    rd.debt_id AS invno,
    (CASE WHEN rd.debt_id IS NOT NULL THEN 'Y' ELSE 'N' END) AS check_invno,
    rc.rcpno AS billno, p.hn,
    p.cid AS memberno, rd.amount, rc.bill_amount AS paid,
    rd.sss_approval_code AS vercode,
    (CASE WHEN (rd.sss_approval_code IS NOT NULL AND rd.sss_approval_code <> '') THEN 'Y' ELSE 'N' END) AS check_vercode,
    'A' AS tflag, p.cid AS pid,
    CONCAT(p.pname, p.fname, ' ', p.lname) AS name,
    vp.hospmain AS hmain,
    put.pttype_upp_type_code AS payplan,
    rd.total_amount AS claimamt, NULL AS otherpayplan, NULL AS otherpay
FROM ovst ov
LEFT JOIN vn_stat vn ON vn.vn = ov.vn
LEFT JOIN visit_pttype vp ON vp.vn = ov.vn
LEFT JOIN patient p ON p.hn = ov.hn
LEFT JOIN rcpt_print rc ON rc.vn = ov.vn
LEFT JOIN rcpt_debt rd ON rd.vn = ov.vn AND rd.total_amount > 0
LEFT JOIN opdconfig op ON op.hospitalcode = op.hospitalcode
LEFT JOIN pttype ptt ON ptt.pttype = vp.pttype AND ptt.hipdata_code = 'FDH'
LEFT JOIN pttype_upp_type put ON put.pttype_upp_type_id = ptt.pttype_upp_type_id
WHERE ov.vstdate BETWEEN '2026-06-15' AND '2026-06-15'
AND vp.pttype IN (SELECT pttype FROM pttype WHERE isuse = 'Y' AND hipdata_code = 'FDH')
AND ov.vn IN (SELECT vn FROM opitemrece WHERE vstdate::date BETWEEN '2026-06-15' AND '2026-06-15' AND paidst = '02')
GROUP BY
    rd.debt_id, vp.auth_code, vp.hospmain, vp.pttypeno,
    rc.rcpno, rc.bill_amount, rd.sss_approval_code, rd.debt_date_time,
    ov.vn, ov.vstdate,
    rd.amount,
    p.hn, p.cid,
    op.hospitalcode, p.pname, p.fname, p.lname, put.pttype_upp_type_code
ORDER BY ov.vn;

-- ▶ MySQL
SELECT
    rd.debt_id, ov.vstdate, ov.vn, vp.auth_code AS authcode,
    rd.debt_date_time AS dttran,
    op.hospitalcode AS hcode,
    rd.debt_id AS invno,
    (CASE WHEN rd.debt_id IS NOT NULL THEN 'Y' ELSE 'N' END) AS check_invno,
    rc.rcpno AS billno, p.hn,
    p.cid AS memberno, rd.amount, rc.bill_amount AS paid,
    rd.sss_approval_code AS vercode,
    (CASE WHEN (rd.sss_approval_code IS NOT NULL AND rd.sss_approval_code <> '') THEN 'Y' ELSE 'N' END) AS check_vercode,
    'A' AS tflag, p.cid AS pid,
    CONCAT(p.pname, p.fname, ' ', p.lname) AS name,
    vp.hospmain AS hmain,
    put.pttype_upp_type_code AS payplan,
    rd.total_amount AS claimamt, NULL AS otherpayplan, NULL AS otherpay
FROM ovst ov
LEFT JOIN vn_stat vn ON vn.vn = ov.vn
LEFT JOIN visit_pttype vp ON vp.vn = ov.vn
LEFT JOIN patient p ON p.hn = ov.hn
LEFT JOIN rcpt_print rc ON rc.vn = ov.vn
LEFT JOIN rcpt_debt rd ON rd.vn = ov.vn AND rd.total_amount > 0
LEFT JOIN opdconfig op ON op.hospitalcode = op.hospitalcode
LEFT JOIN pttype ptt ON ptt.pttype = vp.pttype AND ptt.hipdata_code = 'FDH'
LEFT JOIN pttype_upp_type put ON put.pttype_upp_type_id = ptt.pttype_upp_type_id
WHERE ov.vstdate BETWEEN '2026-06-15' AND '2026-06-15'
AND vp.pttype IN (SELECT pttype FROM pttype WHERE isuse = 'Y' AND hipdata_code = 'FDH')
AND ov.vn IN (SELECT vn FROM opitemrece WHERE DATE(vstdate) BETWEEN '2026-06-15' AND '2026-06-15' AND paidst = '02')
GROUP BY
    rd.debt_id, vp.auth_code, vp.hospmain, vp.pttypeno,
    rc.rcpno, rc.bill_amount, rd.sss_approval_code, rd.debt_date_time,
    ov.vn, ov.vstdate,
    rd.amount,
    p.hn, p.cid,
    op.hospitalcode, p.pname, p.fname, p.lname, put.pttype_upp_type_code
ORDER BY ov.vn;

-- ============================================================
-- เมนู: BillItems (รายการบิล) -- endpoint: /api/get-billitems
-- ============================================================

-- ▶ PostgreSQL
SELECT ov.hn, CONCAT(pt.pname, pt.fname,' ',pt.lname) AS ptname, ov.vn,
    rd.debt_id AS invno, (CASE WHEN rd.debt_id IS NOT NULL THEN 'Y' ELSE 'N' END) AS check_debt_id,
    ov.vstdate,
    substring(dc.chrgitem_code1,1,1) AS billmuad,
    (CASE WHEN dc.chrgitem_code1 IS NOT NULL THEN 'Y' ELSE 'N' END) AS check_billmuad,
    op.icode,
    (CASE WHEN op.income = '03' THEN dr.sks_drug_code ELSE n.billcode END) AS stdcode,
    (CASE WHEN dr.sks_drug_code IS NOT NULL OR n.billcode IS NOT NULL THEN 'Y' ELSE 'N' END) AS check_stdcode,
    (CASE WHEN op.income = '03' THEN CONCAT(dr.name,' ',dr.strength,' ',dr.units) ELSE n.name END) AS "desc",
    op.qty,
    (CASE WHEN op.qty IS NOT NULL THEN 'Y' ELSE 'N' END) AS check_qty,
    op.unitprice AS up,
    (CASE WHEN op.unitprice IS NOT NULL THEN 'Y' ELSE 'N' END) AS check_up,
    op.sum_price AS chargeamt,
    (CASE WHEN op.sum_price IS NOT NULL THEN 'Y' ELSE 'N' END) AS check_chargeamt,
    (CASE WHEN op.income IN ('03','17') THEN dr.sks_price ELSE n.sks_coverage_price END) AS claimup,
    (CASE WHEN (dr.sks_price IS NOT NULL OR n.sks_coverage_price IS NOT NULL OR dr.sks_price > 0 OR n.sks_coverage_price > 0) THEN 'Y' ELSE 'N' END) AS check_claimup,
    (op.qty * op.unitprice) AS claimamount, ds.icode AS ds_icode,
    (CASE
        WHEN ((n.sks_coverage_price > 0 AND (n.enable_sks_opd = 'N' OR n.enable_sks_opd = '' OR n.enable_sks_opd IS NULL))
            OR (dr.sks_price > 0 AND ds.icode IS NULL)) THEN 'N'
        WHEN ((n.sks_coverage_price < 1 AND (n.enable_sks_opd = 'N' OR n.enable_sks_opd = '' OR n.enable_sks_opd IS NULL))
            OR (dr.sks_price < 1 AND ds.icode IS NULL)) THEN 'N'
        WHEN ((n.sks_coverage_price < 1 AND (n.enable_sks_opd = 'Y' OR n.enable_sks_opd <> '' OR n.enable_sks_opd IS NOT NULL))
            OR (dr.sks_price < 1 AND ds.icode IS NOT NULL)) THEN 'N'
        ELSE 'Y'
    END) AS check_claimamount,
    ov.vn AS svrefid, 'OP1' AS claimcat,
    (CASE WHEN (ds.icode IS NOT NULL OR n.enable_sks_opd = 'Y') THEN 'Y' ELSE 'N' END) AS enable_sks_opd
FROM ovst ov
    LEFT JOIN opitemrece op ON op.vn = ov.vn
    LEFT JOIN rcpt_debt rd ON rd.vn = ov.vn
    LEFT JOIN nondrugitems n ON n.icode = op.icode
    LEFT JOIN rcpt_debt_detail rdd ON rdd.debt_id = rd.debt_id
    LEFT JOIN drugitems dr ON dr.icode = op.icode
    LEFT JOIN nondrugitems_sks_bc ns ON ns.icode = n.icode
    LEFT JOIN patient pt ON pt.hn = ov.hn
    LEFT JOIN income ic ON ic.income = op.income
    LEFT JOIN drg_chrgitem dc ON dc.drg_chrgitem_id = ic.drg_chrgitem_id
    LEFT JOIN drugitems_sks ds ON ds.icode = dr.icode
WHERE ov.vstdate BETWEEN '2026-06-15' AND '2026-06-15'
AND ov.pttype IN (SELECT p.pttype FROM pttype p WHERE p.isuse='Y' AND hipdata_code IN ('UCS','WEL'))
AND ov.vn IN (SELECT vn FROM opitemrece WHERE vstdate::date BETWEEN '2026-06-15' AND '2026-06-15' AND paidst = '02')
GROUP BY ov.hn, pt.pname, pt.fname, pt.lname, rd.debt_id, ov.vstdate,
    op.income, dc.chrgitem_code1, ds.icode, op.icode, dr.sks_drug_code, n.billcode,
    dr.name, dr.strength, dr.units, n.name,
    op.qty, op.unitprice, op.sum_price, op.paidst, dr.sks_price, n.sks_coverage_price,
    rdd.total_amount, ov.vn, n.enable_sks_opd
LIMIT 1000;

-- ▶ MySQL
SELECT ov.hn, CONCAT(pt.pname, pt.fname,' ',pt.lname) AS ptname, ov.vn,
    rd.debt_id AS invno, (CASE WHEN rd.debt_id IS NOT NULL THEN 'Y' ELSE 'N' END) AS check_debt_id,
    ov.vstdate,
    substring(dc.chrgitem_code1,1,1) AS billmuad,
    (CASE WHEN dc.chrgitem_code1 IS NOT NULL THEN 'Y' ELSE 'N' END) AS check_billmuad,
    op.icode,
    (CASE WHEN op.income = '03' THEN dr.sks_drug_code ELSE n.billcode END) AS stdcode,
    (CASE WHEN dr.sks_drug_code IS NOT NULL OR n.billcode IS NOT NULL THEN 'Y' ELSE 'N' END) AS check_stdcode,
    (CASE WHEN op.income = '03' THEN CONCAT(dr.name,' ',dr.strength,' ',dr.units) ELSE n.name END) AS `desc`,
    op.qty,
    (CASE WHEN op.qty IS NOT NULL THEN 'Y' ELSE 'N' END) AS check_qty,
    op.unitprice AS up,
    (CASE WHEN op.unitprice IS NOT NULL THEN 'Y' ELSE 'N' END) AS check_up,
    op.sum_price AS chargeamt,
    (CASE WHEN op.sum_price IS NOT NULL THEN 'Y' ELSE 'N' END) AS check_chargeamt,
    (CASE WHEN op.income IN ('03','17') THEN dr.sks_price ELSE n.sks_coverage_price END) AS claimup,
    (CASE WHEN (dr.sks_price IS NOT NULL OR n.sks_coverage_price IS NOT NULL OR dr.sks_price > 0 OR n.sks_coverage_price > 0) THEN 'Y' ELSE 'N' END) AS check_claimup,
    (op.qty * op.unitprice) AS claimamount, ds.icode AS ds_icode,
    (CASE
        WHEN ((n.sks_coverage_price > 0 AND (n.enable_sks_opd = 'N' OR n.enable_sks_opd = '' OR n.enable_sks_opd IS NULL))
            OR (dr.sks_price > 0 AND ds.icode IS NULL)) THEN 'N'
        WHEN ((n.sks_coverage_price < 1 AND (n.enable_sks_opd = 'N' OR n.enable_sks_opd = '' OR n.enable_sks_opd IS NULL))
            OR (dr.sks_price < 1 AND ds.icode IS NULL)) THEN 'N'
        WHEN ((n.sks_coverage_price < 1 AND (n.enable_sks_opd = 'Y' OR n.enable_sks_opd <> '' OR n.enable_sks_opd IS NOT NULL))
            OR (dr.sks_price < 1 AND ds.icode IS NOT NULL)) THEN 'N'
        ELSE 'Y'
    END) AS check_claimamount,
    ov.vn AS svrefid, 'OP1' AS claimcat,
    (CASE WHEN (ds.icode IS NOT NULL OR n.enable_sks_opd = 'Y') THEN 'Y' ELSE 'N' END) AS enable_sks_opd
FROM ovst ov
    LEFT JOIN opitemrece op ON op.vn = ov.vn
    LEFT JOIN rcpt_debt rd ON rd.vn = ov.vn
    LEFT JOIN nondrugitems n ON n.icode = op.icode
    LEFT JOIN rcpt_debt_detail rdd ON rdd.debt_id = rd.debt_id
    LEFT JOIN drugitems dr ON dr.icode = op.icode
    LEFT JOIN nondrugitems_sks_bc ns ON ns.icode = n.icode
    LEFT JOIN patient pt ON pt.hn = ov.hn
    LEFT JOIN income ic ON ic.income = op.income
    LEFT JOIN drg_chrgitem dc ON dc.drg_chrgitem_id = ic.drg_chrgitem_id
    LEFT JOIN drugitems_sks ds ON ds.icode = dr.icode
WHERE ov.vstdate BETWEEN '2026-06-15' AND '2026-06-15'
AND ov.pttype IN (SELECT p.pttype FROM pttype p WHERE p.isuse='Y' AND hipdata_code IN ('UCS','WEL'))
AND ov.vn IN (SELECT vn FROM opitemrece WHERE DATE(vstdate) BETWEEN '2026-06-15' AND '2026-06-15' AND paidst = '02')
GROUP BY ov.hn, pt.pname, pt.fname, pt.lname, rd.debt_id, ov.vstdate,
    op.income, dc.chrgitem_code1, ds.icode, op.icode, dr.sks_drug_code, n.billcode,
    dr.name, dr.strength, dr.units, n.name,
    op.qty, op.unitprice, op.sum_price, op.paidst, dr.sks_price, n.sks_coverage_price,
    rdd.total_amount, ov.vn, n.enable_sks_opd
LIMIT 1000;

-- ============================================================
-- เมนู: OPService (บริการผู้ป่วยนอก) -- endpoint: /api/get-opservice
-- ============================================================

-- ▶ PostgreSQL
SELECT ov.vstdate, ov.vn,
  CONCAT(pa.pname, pa.fname, ' ', pa.lname) AS name,
  MAX(rc.debt_id) AS invno,
  MAX(CASE WHEN rc.debt_id IS NOT NULL THEN 'Y' ELSE 'N' END) AS check_invno,
  ov.vn AS svid,
  MAX(CASE
    WHEN n.income='11' THEN 'OP'
    WHEN n.income='12' THEN 'EC'
    WHEN n.income='07' THEN 'LB'
    WHEN n.income='08' THEN 'XR'
    WHEN n.income='09' THEN 'IV'
    ELSE 'ZZ' END) AS class,
  (SELECT hospitalcode FROM opdconfig LIMIT 1) AS hcode,
  pa.hn, pa.cid AS pid, '1' AS careaccount,
  NULL AS typeserv, ot.export_code AS typein,
  CASE WHEN ot.export_code IS NOT NULL THEN 'Y' ELSE 'N' END AS check_typein,
  st.export_code AS typeout,
  CASE WHEN st.export_code IS NOT NULL THEN 'Y' ELSE 'N' END AS check_typeout,
  oa.nextdate AS dtappoint,
  MAX(d.licenseno) AS svpid,
  MAX(CASE WHEN d.licenseno IS NOT NULL THEN 'Y' ELSE 'N' END) AS check_svpid,
  s.nhso_code AS clinic,
  CONCAT(ov.vstdate, ' ', ov.vsttime) AS begdt,
  NULL AS enddt,
  n.billcode AS lccode,
  MAX(CASE WHEN di.icd10 IS NOT NULL AND di.icd10<>'' THEN 'TT' ELSE '' END) AS codeset,
  MAX(CASE WHEN di.icd10 IS NOT NULL AND di.icd10<>'' THEN 'Y' ELSE 'N' END) AS check_codeset,
  MAX(n.billcode) AS stdcode,
  MAX(CASE WHEN n.billcode IS NOT NULL THEN 'Y' ELSE 'N' END) AS check_stdcode,
  NULL AS svcharge,
  (CASE WHEN oa.nextdate IS NOT NULL THEN 'Y' ELSE 'N' END) AS completion,
  NULL AS svtxcode, 'OPD1' AS claimcat
FROM ovst ov
  LEFT JOIN patient pa ON pa.hn = ov.hn
  LEFT JOIN rcpt_debt rc ON rc.vn = ov.vn
  LEFT JOIN ovstist ot ON ot.ovstist = ov.ovstist
  LEFT JOIN ovstost st ON st.ovstost = ov.ovstost
  LEFT JOIN opitemrece oi ON oi.vn = ov.vn
  LEFT JOIN nondrugitems n ON n.icode = oi.icode
  LEFT JOIN ovstdiag di ON di.vn = ov.vn AND di.diagtype = '1'
  LEFT JOIN doctor d ON d.code = di.doctor
  LEFT JOIN oapp oa ON oa.vn = ov.vn
  LEFT JOIN spclty s ON s.spclty = ov.spclty
WHERE ov.vstdate BETWEEN '2026-06-15' AND '2026-06-15'
AND ov.pttype IN (SELECT p.pttype FROM pttype p WHERE p.isuse='Y' AND hipdata_code IN ('UCS','WEL'))
AND ov.vn IN (SELECT vn FROM opitemrece WHERE vstdate::date BETWEEN '2026-06-15' AND '2026-06-15' AND paidst = '02')
GROUP BY ov.vn, ov.vstdate, ov.vsttime, oa.nextdate,
  pa.pname, pa.fname, pa.lname, pa.hn, pa.cid,
  ov.ovstist, ov.ovstost, s.nhso_code, n.billcode, ot.export_code, st.export_code
ORDER BY ov.vn;

-- ▶ MySQL
SELECT ov.vstdate, ov.vn,
  CONCAT(pa.pname, pa.fname, ' ', pa.lname) AS name,
  MAX(rc.debt_id) AS invno,
  MAX(CASE WHEN rc.debt_id IS NOT NULL THEN 'Y' ELSE 'N' END) AS check_invno,
  ov.vn AS svid,
  MAX(CASE
    WHEN n.income='11' THEN 'OP'
    WHEN n.income='12' THEN 'EC'
    WHEN n.income='07' THEN 'LB'
    WHEN n.income='08' THEN 'XR'
    WHEN n.income='09' THEN 'IV'
    ELSE 'ZZ' END) AS class,
  (SELECT hospitalcode FROM opdconfig LIMIT 1) AS hcode,
  pa.hn, pa.cid AS pid, '1' AS careaccount,
  NULL AS typeserv, ot.export_code AS typein,
  CASE WHEN ot.export_code IS NOT NULL THEN 'Y' ELSE 'N' END AS check_typein,
  st.export_code AS typeout,
  CASE WHEN st.export_code IS NOT NULL THEN 'Y' ELSE 'N' END AS check_typeout,
  oa.nextdate AS dtappoint,
  MAX(d.licenseno) AS svpid,
  MAX(CASE WHEN d.licenseno IS NOT NULL THEN 'Y' ELSE 'N' END) AS check_svpid,
  s.nhso_code AS clinic,
  CONCAT(ov.vstdate, ' ', ov.vsttime) AS begdt,
  NULL AS enddt,
  n.billcode AS lccode,
  MAX(CASE WHEN di.icd10 IS NOT NULL AND di.icd10<>'' THEN 'TT' ELSE '' END) AS codeset,
  MAX(CASE WHEN di.icd10 IS NOT NULL AND di.icd10<>'' THEN 'Y' ELSE 'N' END) AS check_codeset,
  MAX(n.billcode) AS stdcode,
  MAX(CASE WHEN n.billcode IS NOT NULL THEN 'Y' ELSE 'N' END) AS check_stdcode,
  NULL AS svcharge,
  (CASE WHEN oa.nextdate IS NOT NULL THEN 'Y' ELSE 'N' END) AS completion,
  NULL AS svtxcode, 'OPD1' AS claimcat
FROM ovst ov
  LEFT JOIN patient pa ON pa.hn = ov.hn
  LEFT JOIN rcpt_debt rc ON rc.vn = ov.vn
  LEFT JOIN ovstist ot ON ot.ovstist = ov.ovstist
  LEFT JOIN ovstost st ON st.ovstost = ov.ovstost
  LEFT JOIN opitemrece oi ON oi.vn = ov.vn
  LEFT JOIN nondrugitems n ON n.icode = oi.icode
  LEFT JOIN ovstdiag di ON di.vn = ov.vn AND di.diagtype = '1'
  LEFT JOIN doctor d ON d.code = di.doctor
  LEFT JOIN oapp oa ON oa.vn = ov.vn
  LEFT JOIN spclty s ON s.spclty = ov.spclty
WHERE ov.vstdate BETWEEN '2026-06-15' AND '2026-06-15'
AND ov.pttype IN (SELECT p.pttype FROM pttype p WHERE p.isuse='Y' AND hipdata_code IN ('UCS','WEL'))
AND ov.vn IN (SELECT vn FROM opitemrece WHERE DATE(vstdate) BETWEEN '2026-06-15' AND '2026-06-15' AND paidst = '02')
GROUP BY ov.vn, ov.vstdate, ov.vsttime, oa.nextdate,
  pa.pname, pa.fname, pa.lname, pa.hn, pa.cid,
  ov.ovstist, ov.ovstost, s.nhso_code, n.billcode, ot.export_code, st.export_code
ORDER BY ov.vn;

-- ============================================================
-- เมนู: DispensedItem (รายการจ่ายยา) -- endpoint: /api/get-dispenseditem
-- ============================================================

-- ▶ PostgreSQL
SELECT od.opi_dispense_id,
  (CASE WHEN od.opi_dispense_id IS NOT NULL THEN 'Y' ELSE 'N' END) AS check_opi_dispense_id,
  op.vn,
  op.icode,
  (CASE WHEN op.icode IS NOT NULL THEN 'Y' ELSE 'N' END) AS check_icode,
  op.qty,
  (CASE WHEN op.qty IS NOT NULL THEN 'Y' ELSE 'N' END) AS check_qty,
  op.drugusage,
  (CASE WHEN (op.drugusage IS NULL OR op.drugusage = '') THEN 'N' ELSE 'Y' END) AS check_drugusaged,
  op.vstdate,
  op.sum_price,
  (CASE WHEN op.sum_price IS NOT NULL THEN 'Y' ELSE 'N' END) AS check_sum_price,
  no.sks_product_category_id,
  di.icode AS icode1,
  (CASE WHEN di.icode IS NOT NULL THEN 'Y' ELSE 'N' END) AS check_icode1,
  di.sks_drug_code,
  (CASE WHEN di.sks_drug_code IS NOT NULL THEN 'Y' ELSE 'N' END) AS check_sks_drug_code,
  di.units,
  (CASE WHEN di.units IS NOT NULL THEN 'Y' ELSE 'N' END) AS check_units,
  ds.shortlist,
  (CASE WHEN ds.shortlist IS NOT NULL THEN 'Y' ELSE 'N' END) AS check_shortlist,
  ds.drugusage AS drugusage1,
  (CASE WHEN ds.drugusage IS NOT NULL THEN 'Y' ELSE 'N' END) AS check_drugusage,
  op.unitprice AS unitprice1,
  (CASE WHEN op.unitprice IS NOT NULL THEN 'Y' ELSE 'N' END) AS check_unitprice,
  di.sks_reimb_price,
  (CASE WHEN di.sks_reimb_price IS NOT NULL THEN 'Y' ELSE 'N' END) AS check_sks_reimb_price,
  SUM(op.qty * di.sks_reimb_price) AS reimbamt,
  'prdSeCode' AS prdSeCode,
  'claimcout' AS claimcout,
  'claimcat' AS claimcat,
  'multiDisp' AS multiDisp,
  'supplyfor' AS supplyfor
FROM opitemrece op
  INNER JOIN ovst ov ON ov.vn = op.vn
  LEFT JOIN opi_dispense od ON od.hos_guid = op.hos_guid
  LEFT JOIN nondrugitems no ON no.icode = op.icode
  LEFT JOIN drugitems di ON di.icode = op.icode
  LEFT JOIN drugusage ds ON ds.drugusage = op.drugusage
WHERE op.vstdate BETWEEN '2026-06-15' AND '2026-06-15'
AND ov.pttype IN (SELECT p.pttype FROM pttype p WHERE p.isuse='Y' AND hipdata_code IN ('UCS','WEL'))
AND ov.vn IN (SELECT vn FROM opitemrece WHERE vstdate::date BETWEEN '2026-06-15' AND '2026-06-15' AND paidst = '02')
GROUP BY op.vn, od.opi_dispense_id, op.icode, op.qty, op.drugusage, op.vstdate,
  op.sum_price, no.sks_product_category_id, di.icode, di.sks_drug_code,
  od.dose, od.unit_name, od.frequency_code, od.usage_unit_code,
  di.units, ds.shortlist, ds.drugusage, op.unitprice, di.sks_reimb_price
LIMIT 1000;

-- ▶ MySQL
SELECT od.opi_dispense_id,
  (CASE WHEN od.opi_dispense_id IS NOT NULL THEN 'Y' ELSE 'N' END) AS check_opi_dispense_id,
  op.vn,
  op.icode,
  (CASE WHEN op.icode IS NOT NULL THEN 'Y' ELSE 'N' END) AS check_icode,
  op.qty,
  (CASE WHEN op.qty IS NOT NULL THEN 'Y' ELSE 'N' END) AS check_qty,
  op.drugusage,
  (CASE WHEN (op.drugusage IS NULL OR op.drugusage = '') THEN 'N' ELSE 'Y' END) AS check_drugusaged,
  op.vstdate,
  op.sum_price,
  (CASE WHEN op.sum_price IS NOT NULL THEN 'Y' ELSE 'N' END) AS check_sum_price,
  no.sks_product_category_id,
  di.icode AS icode1,
  (CASE WHEN di.icode IS NOT NULL THEN 'Y' ELSE 'N' END) AS check_icode1,
  di.sks_drug_code,
  (CASE WHEN di.sks_drug_code IS NOT NULL THEN 'Y' ELSE 'N' END) AS check_sks_drug_code,
  di.units,
  (CASE WHEN di.units IS NOT NULL THEN 'Y' ELSE 'N' END) AS check_units,
  ds.shortlist,
  (CASE WHEN ds.shortlist IS NOT NULL THEN 'Y' ELSE 'N' END) AS check_shortlist,
  ds.drugusage AS drugusage1,
  (CASE WHEN ds.drugusage IS NOT NULL THEN 'Y' ELSE 'N' END) AS check_drugusage,
  op.unitprice AS unitprice1,
  (CASE WHEN op.unitprice IS NOT NULL THEN 'Y' ELSE 'N' END) AS check_unitprice,
  di.sks_reimb_price,
  (CASE WHEN di.sks_reimb_price IS NOT NULL THEN 'Y' ELSE 'N' END) AS check_sks_reimb_price,
  SUM(op.qty * di.sks_reimb_price) AS reimbamt,
  'prdSeCode' AS prdSeCode,
  'claimcout' AS claimcout,
  'claimcat' AS claimcat,
  'multiDisp' AS multiDisp,
  'supplyfor' AS supplyfor
FROM opitemrece op
  INNER JOIN ovst ov ON ov.vn = op.vn
  LEFT JOIN opi_dispense od ON od.hos_guid = op.hos_guid
  LEFT JOIN nondrugitems no ON no.icode = op.icode
  LEFT JOIN drugitems di ON di.icode = op.icode
  LEFT JOIN drugusage ds ON ds.drugusage = op.drugusage
WHERE op.vstdate BETWEEN '2026-06-15' AND '2026-06-15'
AND ov.pttype IN (SELECT p.pttype FROM pttype p WHERE p.isuse='Y' AND hipdata_code IN ('UCS','WEL'))
AND ov.vn IN (SELECT vn FROM opitemrece WHERE DATE(vstdate) BETWEEN '2026-06-15' AND '2026-06-15' AND paidst = '02')
GROUP BY op.vn, od.opi_dispense_id, op.icode, op.qty, op.drugusage, op.vstdate,
  op.sum_price, no.sks_product_category_id, di.icode, di.sks_drug_code,
  od.dose, od.unit_name, od.frequency_code, od.usage_unit_code,
  di.units, ds.shortlist, ds.drugusage, op.unitprice, di.sks_reimb_price
LIMIT 1000;

-- ============================================================
-- เมนู: Dispensing (การจ่ายยา) -- endpoint: /api/get-dispensing
-- ============================================================

-- ▶ PostgreSQL
SELECT ov.vstdate,
  CONCAT(pa.pname, pa.fname, ' ', pa.lname) AS name,
  (SELECT hospitalcode FROM opdconfig LIMIT 1) AS providerid,
  ov.vn AS dispid,
  MAX(rc.debt_id) AS invno,
  MAX(CASE WHEN rc.debt_id IS NOT NULL THEN 'Y' ELSE 'N' END) AS check_invno,
  pa.hn, pa.cid AS pid,
  NULL AS dispdt,
  MAX(d.licenseno) AS prescb,
  COUNT(oi.icode) AS itemcnt,
  SUM(oi.unitprice) AS chargeamt,
  NULL AS claimamt,
  rc.paid AS paid,
  NULL AS otherpay,
  'HP' AS reimburser,
  'CS' AS benefitplan,
  '1' AS dispestat,
  ov.vn AS svid,
  NULL AS daycover
FROM ovst ov
  LEFT JOIN patient pa ON pa.hn = ov.hn
  LEFT JOIN rcpt_debt rc ON rc.vn = ov.vn
  LEFT JOIN opitemrece oi ON oi.vn = ov.vn
  LEFT JOIN ovstdiag di ON di.vn = ov.vn AND di.diagtype = '1'
  LEFT JOIN doctor d ON d.code = di.doctor
WHERE ov.vstdate BETWEEN '2026-06-15' AND '2026-06-15'
AND ov.pttype IN (SELECT p.pttype FROM pttype p WHERE p.isuse='Y' AND hipdata_code IN ('UCS','WEL'))
AND ov.vn IN (SELECT vn FROM opitemrece WHERE vstdate::date BETWEEN '2026-06-15' AND '2026-06-15' AND paidst = '02')
GROUP BY ov.vn, ov.vstdate,
  pa.pname, pa.fname, pa.lname, pa.hn, pa.cid,
  rc.paid
ORDER BY ov.vn;

-- ▶ MySQL
SELECT ov.vstdate,
  CONCAT(pa.pname, pa.fname, ' ', pa.lname) AS name,
  (SELECT hospitalcode FROM opdconfig LIMIT 1) AS providerid,
  ov.vn AS dispid,
  MAX(rc.debt_id) AS invno,
  MAX(CASE WHEN rc.debt_id IS NOT NULL THEN 'Y' ELSE 'N' END) AS check_invno,
  pa.hn, pa.cid AS pid,
  NULL AS dispdt,
  MAX(d.licenseno) AS prescb,
  COUNT(oi.icode) AS itemcnt,
  SUM(oi.unitprice) AS chargeamt,
  NULL AS claimamt,
  rc.paid AS paid,
  NULL AS otherpay,
  'HP' AS reimburser,
  'CS' AS benefitplan,
  '1' AS dispestat,
  ov.vn AS svid,
  NULL AS daycover
FROM ovst ov
  LEFT JOIN patient pa ON pa.hn = ov.hn
  LEFT JOIN rcpt_debt rc ON rc.vn = ov.vn
  LEFT JOIN opitemrece oi ON oi.vn = ov.vn
  LEFT JOIN ovstdiag di ON di.vn = ov.vn AND di.diagtype = '1'
  LEFT JOIN doctor d ON d.code = di.doctor
WHERE ov.vstdate BETWEEN '2026-06-15' AND '2026-06-15'
AND ov.pttype IN (SELECT p.pttype FROM pttype p WHERE p.isuse='Y' AND hipdata_code IN ('UCS','WEL'))
AND ov.vn IN (SELECT vn FROM opitemrece WHERE DATE(vstdate) BETWEEN '2026-06-15' AND '2026-06-15' AND paidst = '02')
GROUP BY ov.vn, ov.vstdate,
  pa.pname, pa.fname, pa.lname, pa.hn, pa.cid,
  rc.paid
ORDER BY ov.vn;

-- ============================================================
-- เมนู: OPDx (วินิจฉัยผู้ป่วยนอก) -- endpoint: /api/get-opdx
-- ============================================================

-- ▶ PostgreSQL
SELECT
  ov.hn AS HN,
  ov.vn AS VN,
  ov.vstdate AS vsdate,
  CONCAT(pt.pname, pt.fname, ' ', pt.lname) AS Name,
  (CASE WHEN di.icd10 BETWEEN '0' AND '99999' THEN 'OP' ELSE 'EC' END) AS class,
  CASE WHEN di.icd10 IS NOT NULL THEN 'Y' ELSE 'N' END AS check_class,
  ov.vn AS SvID,
  CASE
    WHEN di.diagtype = '1' THEN '1'
    WHEN di.diagtype = '2' THEN '2'
    WHEN di.diagtype = '3' THEN '3'
    WHEN di.diagtype = '4' THEN '4'
    WHEN di.diagtype IS NULL OR di.diagtype = '' THEN 'N'
    ELSE 'N'
  END AS sl,
  CASE WHEN di.diagtype IS NOT NULL THEN 'Y' ELSE 'N' END AS check_sl,
  CASE
    WHEN EXISTS (
      SELECT 1 FROM doctor_operation dp
      WHERE dp.vn = di.vn AND dp.icd9 IS NOT NULL AND dp.icd9 <> ''
    ) THEN 'IN'
    WHEN EXISTS (
      SELECT 1 FROM opitemrece op
      INNER JOIN nondrugitems n ON n.icode = op.icode
      INNER JOIN lab_items li ON li.icode = n.icode
      WHERE op.vn = ov.vn AND li.tmlt_code IS NOT NULL AND li.tmlt_code <> ''
    ) THEN 'LC'
    WHEN di.icd10 IS NOT NULL AND di.icd10 <> '' THEN 'TT'
    ELSE ''
  END AS codeset,
  CASE
    WHEN EXISTS (
      SELECT 1 FROM doctor_operation dp
      WHERE dp.vn = di.vn AND dp.icd9 IS NOT NULL AND dp.icd9 <> ''
    ) THEN 'Y'
    WHEN EXISTS (
      SELECT 1 FROM opitemrece op
      INNER JOIN nondrugitems n ON n.icode = op.icode
      INNER JOIN lab_items li ON li.icode = n.icode
      WHERE op.vn = ov.vn AND li.tmlt_code IS NOT NULL AND li.tmlt_code <> ''
    ) THEN 'Y'
    WHEN di.icd10 IS NOT NULL AND di.icd10 <> '' THEN 'Y'
    ELSE ''
  END AS check_codeset,
  di.icd10 AS Code,
  CASE WHEN di.icd10 IS NOT NULL THEN 'Y' ELSE 'N' END AS check_code,
  i.name AS Desc
FROM ovst ov
LEFT JOIN patient pt ON ov.hn = pt.hn
LEFT JOIN ovstdiag di ON ov.vn = di.vn
LEFT JOIN icd101 i ON di.icd10 = i.code
WHERE ov.vstdate BETWEEN '2026-06-15' AND '2026-06-15'
AND ov.pttype IN (SELECT p.pttype FROM pttype p WHERE p.isuse='Y' AND hipdata_code IN ('UCS','WEL'))
AND ov.vn IN (SELECT vn FROM opitemrece WHERE vstdate::date BETWEEN '2026-06-15' AND '2026-06-15' AND paidst = '02')
ORDER BY ov.vn, sl;

-- ▶ MySQL
SELECT
  ov.hn AS HN,
  ov.vn AS VN,
  ov.vstdate AS vsdate,
  CONCAT(pt.pname, pt.fname, ' ', pt.lname) AS Name,
  (CASE WHEN di.icd10 BETWEEN '0' AND '99999' THEN 'OP' ELSE 'EC' END) AS class,
  CASE WHEN di.icd10 IS NOT NULL THEN 'Y' ELSE 'N' END AS check_class,
  ov.vn AS SvID,
  CASE
    WHEN di.diagtype = '1' THEN '1'
    WHEN di.diagtype = '2' THEN '2'
    WHEN di.diagtype = '3' THEN '3'
    WHEN di.diagtype = '4' THEN '4'
    WHEN di.diagtype IS NULL OR di.diagtype = '' THEN 'N'
    ELSE 'N'
  END AS sl,
  CASE WHEN di.diagtype IS NOT NULL THEN 'Y' ELSE 'N' END AS check_sl,
  CASE
    WHEN EXISTS (
      SELECT 1 FROM doctor_operation dp
      WHERE dp.vn = di.vn AND dp.icd9 IS NOT NULL AND dp.icd9 <> ''
    ) THEN 'IN'
    WHEN EXISTS (
      SELECT 1 FROM opitemrece op
      INNER JOIN nondrugitems n ON n.icode = op.icode
      INNER JOIN lab_items li ON li.icode = n.icode
      WHERE op.vn = ov.vn AND li.tmlt_code IS NOT NULL AND li.tmlt_code <> ''
    ) THEN 'LC'
    WHEN di.icd10 IS NOT NULL AND di.icd10 <> '' THEN 'TT'
    ELSE ''
  END AS codeset,
  CASE
    WHEN EXISTS (
      SELECT 1 FROM doctor_operation dp
      WHERE dp.vn = di.vn AND dp.icd9 IS NOT NULL AND dp.icd9 <> ''
    ) THEN 'Y'
    WHEN EXISTS (
      SELECT 1 FROM opitemrece op
      INNER JOIN nondrugitems n ON n.icode = op.icode
      INNER JOIN lab_items li ON li.icode = n.icode
      WHERE op.vn = ov.vn AND li.tmlt_code IS NOT NULL AND li.tmlt_code <> ''
    ) THEN 'Y'
    WHEN di.icd10 IS NOT NULL AND di.icd10 <> '' THEN 'Y'
    ELSE ''
  END AS check_codeset,
  di.icd10 AS Code,
  CASE WHEN di.icd10 IS NOT NULL THEN 'Y' ELSE 'N' END AS check_code,
  i.name AS Desc
FROM ovst ov
LEFT JOIN patient pt ON ov.hn = pt.hn
LEFT JOIN ovstdiag di ON ov.vn = di.vn
LEFT JOIN icd101 i ON di.icd10 = i.code
WHERE ov.vstdate BETWEEN '2026-06-15' AND '2026-06-15'
AND ov.pttype IN (SELECT p.pttype FROM pttype p WHERE p.isuse='Y' AND hipdata_code IN ('UCS','WEL'))
AND ov.vn IN (SELECT vn FROM opitemrece WHERE DATE(vstdate) BETWEEN '2026-06-15' AND '2026-06-15' AND paidst = '02')
ORDER BY ov.vn, sl;
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
