<?php
// ============================================================
//  HOSxP Data Completeness Checker
//  Supports MySQL and PostgreSQL
// ============================================================
session_start();
define('CFG_FILE', __DIR__ . '/.config.json');

$cfg      = null;
$pdo      = null;
$conn_err = null;
$login_err = null;
$me       = $_SESSION['hosxp_user'] ?? null;  // ['loginname','fullname','officer_group_id']

if (file_exists(CFG_FILE)) {
    $cfg = json_decode(file_get_contents(CFG_FILE), true);
}

// ── AJAX: Test DB connection ────────────────────────────────
if (isset($_GET['test_conn']) && $_SERVER['REQUEST_METHOD'] === 'POST') {
    header('Content-Type: application/json; charset=utf-8');
    $dbtype = in_array($_POST['db_type'] ?? '', ['mysql','pgsql']) ? $_POST['db_type'] : 'mysql';
    $h = trim($_POST['host'] ?? 'localhost');
    $p = (int)($_POST['port'] ?: ($dbtype === 'pgsql' ? 5432 : 3306));
    $d = trim($_POST['db']   ?? '');
    $u = trim($_POST['user'] ?? '');
    $w = $_POST['pass'] ?? '';
    if (!$h || !$d || !$u) { echo json_encode(['ok'=>false,'msg'=>'กรุณากรอกข้อมูลให้ครบ']); exit; }
    try {
        if ($dbtype === 'pgsql') {
            $dsn  = "pgsql:host=$h;port=$p;dbname=$d";
            $opts = [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_TIMEOUT => 5];
        } else {
            $dsn  = "mysql:host=$h;port=$p;dbname=$d;charset=utf8";
            $opts = [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_TIMEOUT => 5,
                     PDO::MYSQL_ATTR_INIT_COMMAND => "SET NAMES utf8"];
        }
        $tpdo = new PDO($dsn, $u, $w, $opts);
        if ($dbtype === 'pgsql') $tpdo->exec("SET client_encoding TO 'UTF8'");
        $tpdo->query("SELECT 1");
        // Count key tables to show DB health
        $tables = ['officer','opduser','drugitems','clinic','pttype'];
        $found = [];
        foreach ($tables as $t) {
            try { $tpdo->query("SELECT 1 FROM $t LIMIT 1"); $found[] = $t; } catch(Exception $e) {}
        }
        echo json_encode(['ok'=>true, 'msg'=>'เชื่อมต่อสำเร็จ',
            'tables_found' => $found, 'db' => $d, 'host' => $h]);
    } catch (PDOException $e) {
        echo json_encode(['ok'=>false, 'msg'=>$e->getMessage()]);
    }
    exit;
}

// ── AJAX: password diagnostic ──────────────────────────────
if (isset($_GET['pw_debug']) && $_SERVER['REQUEST_METHOD'] === 'POST') {
    header('Content-Type: application/json; charset=utf-8');
    if (!$cfg) { echo json_encode(['ok'=>false,'msg'=>'ยังไม่ได้ตั้งค่า DB']); exit; }
    $testLogin = trim($_POST['loginname'] ?? '');
    $testPass  = $_POST['password'] ?? '';
    if (!$testLogin) { echo json_encode(['ok'=>false,'msg'=>'ไม่ได้ระบุ login']); exit; }
    try {
        $dbtype = $cfg['db_type'] ?? 'mysql';
        if ($dbtype === 'pgsql') {
            $dsn  = "pgsql:host={$cfg['host']};port={$cfg['port']};dbname={$cfg['db']}";
            $opts = [PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC];
        } else {
            $dsn  = "mysql:host={$cfg['host']};port={$cfg['port']};dbname={$cfg['db']};charset=utf8";
            $opts = [PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC,
                     PDO::MYSQL_ATTR_INIT_COMMAND=>"SET NAMES utf8"];
        }
        $dpdo = new PDO($dsn, $cfg['user'], $cfg['pass'], $opts);
        if ($dbtype === 'pgsql') $dpdo->exec("SET client_encoding TO 'UTF8'");

        $qfn = fn($n) => ($dbtype==='pgsql') ? '"'.$n.'"' : '`'.$n.'`';
        $md5pass = md5($testPass);
        $result  = ['md5_input' => $md5pass, 'plain_input' => $testPass];

        // ── Check officer table ──────────────────────────────
        $ofCols = []; $ofRow = null;
        try {
            $s = $dpdo->query("SELECT * FROM officer LIMIT 0");
            for ($i=0;$i<$s->columnCount();$i++) $ofCols[]=$s->getColumnMeta($i)['name'];
            $ofLoginCol = null;
            foreach (['officer_login_name','officer_id','loginname','officer_code'] as $c)
                if (in_array($c,$ofCols)) { $ofLoginCol=$c; break; }
            if ($ofLoginCol)
                $ofRow = $dpdo->query("SELECT * FROM officer WHERE ".$qfn($ofLoginCol)." = ".$dpdo->quote($testLogin)." LIMIT 1")->fetch();
            $result['officer'] = ['login_col'=>$ofLoginCol,'found'=>(bool)$ofRow,'pass_cols'=>[]];
            if ($ofRow) {
                foreach ($ofCols as $c) {
                    if (stripos($c,'pass')!==false||stripos($c,'pwd')!==false) {
                        $v=(string)($ofRow[$c]??''); $l=strlen($v);
                        $result['officer']['pass_cols'][$c]=[
                            'format'=> $l===32?'MD5':($l===64?'SHA256':($l===40?'SHA1':"len=$l")),
                            'preview'=>substr($v,0,8).'...',
                            'md5_match'=>($v===$md5pass),
                            'plain_match'=>($v===$testPass),
                        ];
                    }
                }
            }
        } catch(Exception $e) { $result['officer']=['error'=>$e->getMessage()]; }

        // ── Check opduser table ──────────────────────────────
        $ouCols = []; $ouRow = null;
        try {
            $s2 = $dpdo->query("SELECT * FROM opduser LIMIT 0");
            for ($i=0;$i<$s2->columnCount();$i++) $ouCols[]=$s2->getColumnMeta($i)['name'];
            $ouLoginCol = null;
            foreach (['loginname','login_name','username','officer_code'] as $c)
                if (in_array($c,$ouCols)) { $ouLoginCol=$c; break; }
            if ($ouLoginCol)
                $ouRow = $dpdo->query("SELECT * FROM opduser WHERE ".$qfn($ouLoginCol)." = ".$dpdo->quote($testLogin)." LIMIT 1")->fetch();
            $result['opduser'] = ['login_col'=>$ouLoginCol,'found'=>(bool)$ouRow,'pass_cols'=>[]];
            if ($ouRow) {
                foreach ($ouCols as $c) {
                    if (stripos($c,'pass')!==false||stripos($c,'pwd')!==false) {
                        $v=(string)($ouRow[$c]??''); $l=strlen($v);
                        $result['opduser']['pass_cols'][$c]=[
                            'format'=> $l===32?'MD5':($l===64?'SHA256':($l===40?'SHA1':"len=$l")),
                            'preview'=>substr($v,0,8).'...',
                            'md5_match'=>($v===$md5pass),
                            'plain_match'=>($v===$testPass),
                        ];
                    }
                }
            }
        } catch(Exception $e) { $result['opduser']=['error'=>$e->getMessage()]; }

        echo json_encode(['ok'=>true,'result'=>$result]);
    } catch (Exception $e) { echo json_encode(['ok'=>false,'msg'=>$e->getMessage()]); }
    exit;
}

// ── AJAX: officer table columns (diagnostic) ───────────────
if (isset($_GET['officer_cols'])) {
    header('Content-Type: application/json; charset=utf-8');
    if (!$cfg) { echo json_encode(['ok'=>false,'msg'=>'ยังไม่ได้ตั้งค่า DB']); exit; }
    try {
        $dbtype = $cfg['db_type'] ?? 'mysql';
        if ($dbtype === 'pgsql') {
            $dsn  = "pgsql:host={$cfg['host']};port={$cfg['port']};dbname={$cfg['db']}";
            $opts = [PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC];
        } else {
            $dsn  = "mysql:host={$cfg['host']};port={$cfg['port']};dbname={$cfg['db']};charset=utf8";
            $opts = [PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC,
                     PDO::MYSQL_ATTR_INIT_COMMAND=>"SET NAMES utf8"];
        }
        $dpdo = new PDO($dsn, $cfg['user'], $cfg['pass'], $opts);
        if ($dbtype === 'pgsql') $dpdo->exec("SET client_encoding TO 'UTF8'");

        $tblName = preg_replace('/[^a-zA-Z0-9_]/', '', $_GET['tbl'] ?? 'officer');
        $s = $dpdo->query("SELECT * FROM $tblName LIMIT 0");
        $colNames = [];
        for ($i = 0; $i < $s->columnCount(); $i++) {
            $m = $s->getColumnMeta($i);
            if ($m) $colNames[] = $m['name'];
        }
        echo json_encode(['ok'=>true, 'table'=>$tblName, 'columns'=>$colNames]);
    } catch (PDOException $e) {
        echo json_encode(['ok'=>false, 'msg'=>$e->getMessage()]);
    }
    exit;
}

// ── Logout ─────────────────────────────────────────────────
if (isset($_GET['logout'])) {
    unset($_SESSION['hosxp_user']);
    header('Location: ' . $_SERVER['PHP_SELF']); exit;
}

// ── Auto-setup from shared link ────────────────────────────
if (isset($_GET['setup']) && !$cfg) {
    $decoded = json_decode(base64_decode($_GET['setup'] ?? ''), true);
    if ($decoded && isset($decoded['host'], $decoded['db'], $decoded['user'])) {
        $dbtype = in_array($decoded['db_type'] ?? '', ['mysql','pgsql']) ? $decoded['db_type'] : 'mysql';
        $newcfg = [
            'db_type' => $dbtype,
            'host'    => $decoded['host'],
            'port'    => (int)($decoded['port'] ?: ($dbtype === 'pgsql' ? 5432 : 3306)),
            'db'      => $decoded['db'],
            'user'    => $decoded['user'],
            'pass'    => $decoded['pass'] ?? '',
        ];
        file_put_contents(CFG_FILE, json_encode($newcfg, JSON_PRETTY_PRINT));
        header('Location: ' . $_SERVER['PHP_SELF']); exit;
    }
}

// ── POST handlers ──────────────────────────────────────────
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $act = $_POST['action'] ?? '';

    if ($act === 'save_cfg') {
        $dbtype = in_array($_POST['db_type'] ?? '', ['mysql','pgsql']) ? $_POST['db_type'] : 'mysql';
        $cfg = [
            'db_type' => $dbtype,
            'host'    => trim($_POST['host']),
            'port'    => (int)($_POST['port'] ?: ($dbtype === 'pgsql' ? 5432 : 3306)),
            'db'      => trim($_POST['db']),
            'user'    => trim($_POST['user']),
            'pass'    => $_POST['pass'],
        ];
        file_put_contents(CFG_FILE, json_encode($cfg, JSON_PRETTY_PRINT));
        header('Location: ' . $_SERVER['PHP_SELF']); exit;
    }
    if ($act === 'reset_cfg') {
        @unlink(CFG_FILE); $cfg = null;
        unset($_SESSION['hosxp_user']); $me = null;
        header('Location: ' . $_SERVER['PHP_SELF']); exit;
    }
    // บันทึก รพ. ลงรายชื่อ
    if ($act === 'hospital_save') {
        header('Content-Type: application/json; charset=utf-8');
        $hFile = __DIR__ . '/.hospitals.json';
        $list  = file_exists($hFile) ? (json_decode(file_get_contents($hFile), true) ?? []) : [];
        $id    = trim($_POST['hid'] ?? '');
        $entry = [
            'id'      => $id ?: uniqid('h'),
            'name'    => trim($_POST['hname']   ?? ''),
            'db_type' => in_array($_POST['db_type']??'', ['mysql','pgsql']) ? $_POST['db_type'] : 'mysql',
            'host'    => trim($_POST['host']    ?? ''),
            'port'    => (int)($_POST['port']   ?? 3306),
            'db'      => trim($_POST['db']      ?? ''),
            'user'    => trim($_POST['user']    ?? ''),
            'pass'    => $_POST['pass']         ?? '',
        ];
        if ($id) {
            $found = false;
            foreach ($list as &$h) { if ($h['id'] === $id) { $h = $entry; $found = true; break; } }
            if (!$found) $list[] = $entry;
        } else {
            $list[] = $entry;
        }
        file_put_contents($hFile, json_encode(array_values($list), JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
        echo json_encode(['ok' => true, 'entry' => $entry]); exit;
    }
    // ลบ รพ.
    if ($act === 'hospital_delete') {
        header('Content-Type: application/json; charset=utf-8');
        $hFile = __DIR__ . '/.hospitals.json';
        $list  = file_exists($hFile) ? (json_decode(file_get_contents($hFile), true) ?? []) : [];
        $id    = trim($_POST['hid'] ?? '');
        $list  = array_values(array_filter($list, fn($h) => ($h['id'] ?? '') !== $id));
        file_put_contents($hFile, json_encode($list, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
        echo json_encode(['ok' => true]); exit;
    }
}
// AJAX: ดึงรายชื่อ รพ.
if (isset($_GET['hospitals_list'])) {
    header('Content-Type: application/json; charset=utf-8');
    $hFile = __DIR__ . '/.hospitals.json';
    echo file_exists($hFile) ? file_get_contents($hFile) : '[]'; exit;
}

// ── DB Connect ─────────────────────────────────────────────
if ($cfg) {
    try {
        $dbtype = $cfg['db_type'] ?? 'mysql';
        if ($dbtype === 'pgsql') {
            $dsn = "pgsql:host={$cfg['host']};port={$cfg['port']};dbname={$cfg['db']}";
            $opts = [
                PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            ];
        } else {
            $dsn = "mysql:host={$cfg['host']};port={$cfg['port']};dbname={$cfg['db']};charset=utf8";
            $opts = [
                PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::ATTR_TIMEOUT            => 5,
                PDO::MYSQL_ATTR_INIT_COMMAND => "SET NAMES utf8",
            ];
        }
        $pdo = new PDO($dsn, $cfg['user'], $cfg['pass'], $opts);
        if ($dbtype === 'pgsql') {
            $pdo->exec("SET client_encoding TO 'UTF8'");
        }
    } catch (PDOException $e) {
        $conn_err = $e->getMessage();
    }
}

// ── Login POST (needs DB connected) ────────────────────────
if ($_SERVER['REQUEST_METHOD'] === 'POST' && ($_POST['action'] ?? '') === 'login' && $pdo) {
    $loginname = trim($_POST['loginname'] ?? '');
    $password  = $_POST['password'] ?? '';

    if ($loginname && $password) {
        try {
            $md5pass   = md5($password);
            $md5upper  = strtoupper($md5pass);

            // ── Step 1: verify password from opduser table ──────
            $opduserCols = [];
            try {
                $s = $pdo->query("SELECT * FROM opduser LIMIT 0");
                for ($i = 0; $i < $s->columnCount(); $i++) $opduserCols[] = $s->getColumnMeta($i)['name'];
            } catch (Exception $e) {}

            $ouLoginCol = null;
            foreach (['loginname','login_name','username','officer_code'] as $c)
                if (in_array($c, $opduserCols)) { $ouLoginCol = $c; break; }

            $ouPassCol = null;
            foreach (['password','passwd','pass'] as $c)
                if (in_array($c, $opduserCols)) { $ouPassCol = $c; break; }

            // Also check passweb column (HOSxP web password)
            $ouPasswebCol = in_array('passweb', $opduserCols) ? 'passweb' : null;

            $passOk = false;
            $pwTry  = [$md5upper, $md5pass, $password];
            foreach (array_filter([$ouPassCol, $ouPasswebCol]) as $pc) {
                $qpc = qi($pc);
                foreach ($pwTry as $pw) {
                    $stmt = $pdo->prepare(
                        "SELECT 1 FROM opduser WHERE " . qi($ouLoginCol ?? 'loginname') . " = ? AND $qpc = ? LIMIT 1"
                    );
                    $stmt->execute([$loginname, $pw]);
                    if ($stmt->fetchColumn()) { $passOk = true; break 2; }
                }
            }

            if (!$passOk) {
                $login_err = 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง';
            } else {
                // ── Step 2: get user info from officer table ─────
                $officerCols = [];
                try {
                    $s2 = $pdo->query("SELECT * FROM officer LIMIT 0");
                    for ($i = 0; $i < $s2->columnCount(); $i++) $officerCols[] = $s2->getColumnMeta($i)['name'];
                } catch (Exception $e) {}

                $ofLoginCol = null;
                foreach (['officer_login_name','officer_id','loginname','officer_code'] as $c)
                    if (in_array($c, $officerCols)) { $ofLoginCol = $c; break; }

                $officer = null;
                if ($ofLoginCol) {
                    $stmt2 = $pdo->prepare(
                        "SELECT * FROM officer WHERE " . qi($ofLoginCol) . " = ? LIMIT 1"
                    );
                    $stmt2->execute([$loginname]);
                    $officer = $stmt2->fetch();
                }

                // Build fullname from officer or opduser row
                $fn = $officer['officer_fname'] ?? $officer['fname'] ?? '';
                $ln = $officer['officer_lname'] ?? $officer['lname'] ?? '';
                if ($fn || $ln) {
                    $fullname = trim("$fn $ln");
                } elseif (!empty($officer['officer_name'])) {
                    $fullname = $officer['officer_name'];
                } elseif (!empty($officer['name'])) {
                    $fullname = $officer['name'];
                } else {
                    $fullname = $loginname;
                }

                $_SESSION['hosxp_user'] = [
                    'loginname'        => $loginname,
                    'fullname'         => $fullname,
                    'officer_group_id' => $officer['officer_group_id'] ?? '',
                ];
                $me = $_SESSION['hosxp_user'];
            }
        } catch (Exception $e) {
            $login_err = 'เกิดข้อผิดพลาด: ' . $e->getMessage();
        }
    } else {
        $login_err = 'กรุณากรอกชื่อผู้ใช้และรหัสผ่าน';
    }
}

// ── Quote identifier (MySQL=backtick, PostgreSQL=double-quote) ──
function qi(string $name): string {
    global $cfg;
    return ($cfg['db_type'] ?? 'mysql') === 'pgsql'
        ? '"' . str_replace('"', '""', $name) . '"'
        : '`' . str_replace('`', '``', $name) . '`';
}

// ── Column cache (probe once per table per request) ────────
$_colCache = [];

function getTableCols(PDO $pdo, string $tbl): array {
    global $_colCache;
    if (array_key_exists($tbl, $_colCache)) return $_colCache[$tbl] ?: [];
    try {
        $s    = $pdo->query("SELECT * FROM " . qi($tbl) . " LIMIT 0");
        $cols = [];
        for ($i = 0; $i < $s->columnCount(); $i++) {
            $m = $s->getColumnMeta($i);
            if ($m) $cols[] = strtolower($m['name']);
        }
        $_colCache[$tbl] = $cols ?: ['__exists__']; // mark table exists even if no cols
    } catch (Exception $e) {
        $_colCache[$tbl] = false; // false = table not found
    }
    return is_array($_colCache[$tbl]) ? $_colCache[$tbl] : [];
}

// ── Known column aliases: canonical => alternatives ────────
const COL_ALIASES = [
    // doctor / officer name columns
    'fname'              => ['officer_fname','first_name','name'],
    'lname'              => ['officer_lname','last_name'],
    'pname'              => ['officer_pname','prefix'],
    'name'               => ['officer_name','full_name'],
    // login / user
    'loginname'          => ['officer_login_name','login_name','username','officer_code'],
    'officer_group_id'   => ['officer_group_list_text','groupid'],
    'home_ward'          => ['ward_id','home_ward_id'],
    'location_code'      => ['room_id','location_id'],
    // doctor
    'ename'              => ['doctor_name_en','name_en','fullname_en','doctor_ename'],
    'doctor_name_en'     => ['ename','name_en','fullname_en'],
    'birth_date'         => ['birthday','birthdate','dob','date_of_birth'],
    'active'             => ['is_active','status','use_status','enabled','istatus','isuse',
                             'officer_active','ward_active','depcode_active','active_status',
                             'lab_items_use','xray_items_use'],
    'officer_active'     => ['active','is_active','status','enabled','isuse'],
    'ward_active'        => ['active','is_active','status','enabled','isuse'],
    'depcode_active'     => ['active','is_active','status','enabled','isuse'],
    'active_status'      => ['active','is_active','status','enabled','isuse'],
    'isuse'              => ['active','is_active','status','use_status','enabled','active_status'],
    'position_id'        => ['position','pos_id','doctor_position_id'],
    'cid'                => ['citizen_id','national_id','id_card'],
    'licenseno'          => ['license_no','license_number'],
    'provider_type_code' => ['provider_type','prov_type_code'],
    'special'            => ['speciality','specialization'],
    // drug
    'name_th'            => ['drug_name_th','trade_name_th'],
    'print_name'         => ['drug_print_name','short_name'],
    'strength_name'      => ['strength','drug_strength'],
    'dosage_id'          => ['drug_dosage_id','dosage_form_id'],
    'tmtpp_code'         => ['tmt_code','tmt_pp_code'],
    'tptmt_code'         => ['tpt_code'],
    'generic_id'         => ['drug_generic_id','gp_code'],
    'color'              => ['drug_color','pill_color'],
    'sickness_name_th'   => ['indication_th','use_for_th'],
    'sickness_name_en'   => ['indication_en','use_for_en'],
    'important_drug'     => ['is_important','essential_drug'],
    'licenseno_standard' => ['standard_code','drug_license_standard'],
    // non-drug
    'adptype'            => ['adp_type','adptype_code','adp_type_id'],
    'adpcode'            => ['adp_code','adp_item_code'],
    'sss_reimburse'      => ['sss_claim','reimburse_sss','sss_reimbursement','claim_sss'],
    'eclaim_group'       => ['eclaim_code','e_claim_group','eclaim_group_code','e_claim_code'],
    // lab
    'lab_items_name'     => ['lab_name','item_name'],
    'lab_unit'           => ['unit','lab_items_unit'],
    'lab_group_code'     => ['lab_group','group_code'],
    'lab_normal_value'   => ['normal_value','ref_value'],
    'lab_critical_value' => ['critical_value','panic_value'],
    'lis_code'           => ['lis_item_code','external_code'],
    // xray
    'xray_group_code'    => ['xray_group','group_code'],
    'when_bill'          => ['billing_time','bill_when'],
    // ward/clinic
    'ward_name'          => ['name'],
    'clinic_name'        => ['name'],
    'send_report'        => ['send_43','report_flag'],
    'chronic'            => ['is_chronic','chronic_flag'],
    'appoint_day'        => ['appoint_days','appointment_day'],
    // bed
    'bed_code'           => ['code'],
    'bed_name'           => ['name'],
    // pttype
    'pttype_group_id'    => ['pttype_group','group_id'],
    'grouper_version'    => ['grouper_ver','drg_grouper_version'],
    // icd9oper
    'icd9sname'          => ['short_name','icd9_short_name','name'],
    'icd9name'           => ['icd9_name','icd9code','icd9_code'],
    'icd9_type_id'       => ['icd9type_id','oper_type_id'],
    // checkup
    'checkup_group_name' => ['name','group_name'],
    'company_id'         => ['org_id','organization_id'],
    // vaccine
    'vaccine_name'       => ['name','vaccine_item_name'],
    'lot_no'             => ['lot_number','batch_no'],
    // food
    'food_name'          => ['name','food_item_name'],
    'food_type_id'       => ['type_id','food_type'],
    'meal_id'            => ['meal','meal_type_id'],
    // keyword
    'cc_name'            => ['name','chief_complaint'],
    'hpi_name'           => ['name','hpi_text'],
    'pe_name'            => ['name','pe_text'],
    // status / active flags
    'istatus'            => ['use_status','active','is_active','drug_status','status','enabled'],
    'use_status'         => ['istatus','active','is_active','drug_status','status','enabled'],
    'bill_group_code'    => ['bill_group','billing_group_code','billgroup_code'],
    // druguse
    'druguse2_name'      => ['name','druguse_name'],
    'druguse3_id'        => ['druguse_id','mode3_id'],
    'druguse_name'       => ['name','druguse2_name'],
    'drugunit'           => ['unit','drug_unit'],
    'frequency'          => ['freq','drug_frequency'],
    'drugtime'           => ['time','drug_time'],
    'dose'               => ['drug_dose','dosage'],
    // officer group
    'officer_group_name' => ['name','group_name'],
];

// ── Resolve WHERE column: returns quoted col=val or fallback ─
function wCol(PDO $pdo, string $tbl, string $col, string $val): string {
    getTableCols($pdo, $tbl);
    if ($GLOBALS['_colCache'][$tbl] === false) return '1=1';
    $cols = $GLOBALS['_colCache'][$tbl];
    $candidates = array_merge([$col], COL_ALIASES[$col] ?? []);
    foreach ($candidates as $c) {
        if (in_array(strtolower($c), $cols)) {
            return qi($c) . " = " . (is_numeric($val) ? $val : "'$val'");
        }
    }
    return '1=1'; // column not found — skip filter
}

// ── Resolve actual column name (with alias fallback) ───────
function resolveCol(PDO $pdo, string $tbl, string $col): ?string {
    getTableCols($pdo, $tbl); // ensure cache populated
    if ($GLOBALS['_colCache'][$tbl] === false) return null; // table not found
    $cols = $GLOBALS['_colCache'][$tbl];
    if (in_array(strtolower($col), $cols)) return $col;
    foreach (COL_ALIASES[$col] ?? [] as $alias) {
        if (in_array(strtolower($alias), $cols)) return $alias;
    }
    return null;
}

// ── Helper: check one column ───────────────────────────────
function chk(?PDO $pdo, string $tbl, string $col,
             string $lbl, string $wh = '1=1', string $note = '',
             array $extra_nulls = []): array
{
    $r = ['lbl'=>$lbl,'note'=>$note,'tbl'=>$tbl,'col'=>$col,
          'wh'=>$wh,'tot'=>0,'ok'=>0,'err'=>null,'skip'=>false];
    if (!$pdo) { $r['skip'] = true; return $r; }

    $resolved = resolveCol($pdo, $tbl, $col);
    if ($resolved === null) {
        $r['skip'] = true;
        $r['note'] = ($note ? $note . ' · ' : '') . "ไม่พบคอลัมน์ในฐานข้อมูลนี้";
        return $r;
    }
    $r['col'] = $resolved; // update to actual column name used

    try {
        $nulls  = array_merge([''], $extra_nulls);
        $quoted = array_map(fn($v) => $pdo->quote($v), $nulls);
        $qcol   = qi($resolved);
        $qtbl   = qi($tbl);
        $isPgsql = ($GLOBALS['cfg']['db_type'] ?? 'mysql') === 'pgsql';
        $castCol = $isPgsql ? "$qcol::text" : $qcol;
        $empty  = "$qcol IS NULL OR $castCol IN (" . implode(',', $quoted) . ")";
        $sql    = "SELECT COUNT(*) AS tot,
                          SUM(CASE WHEN ($empty) THEN 0 ELSE 1 END) AS ok
                   FROM $qtbl WHERE $wh";
        $row    = $pdo->query($sql)->fetch();
        $r['tot'] = (int)$row['tot'];
        $r['ok']  = (int)$row['ok'];
        // ถ้ามี extra_nulls ให้ detail endpoint ใช้ full WHERE โดยตรง (ผ่าน _raw_ sentinel)
        if (!empty($extra_nulls)) {
            $r['wh']  = "($wh) AND ($empty)";
            $r['col'] = '_raw_';
        }
    } catch (PDOException $e) {
        $r['err'] = $e->getMessage();
    }
    return $r;
}

// ── ตรวจข้อมูลผ่าน JOIN (เช่น nondrugitems ↔ nondrugitems_sks_bc) ──────────
function chkLinked(
    ?PDO $pdo,
    string $mainTbl, string $mainWhere,
    string $joinTbl,  string $joinKey,
    ?string $chkCol,  string $lbl,
    array $emptyVals = ['']
): array {
    $r = ['lbl'=>$lbl,'note'=>'','tbl'=>$mainTbl,'col'=>'_raw_',
          'wh'=>'1=2','tot'=>0,'ok'=>0,'err'=>null,'skip'=>false];
    if (!$pdo) { $r['skip'] = true; return $r; }
    $isPgsql = ($GLOBALS['cfg']['db_type'] ?? 'mysql') === 'pgsql';
    try {
        $qMain = qi($mainTbl);
        $qJoin = qi($joinTbl);
        if ($chkCol === null) {
            $okSubq = "SELECT $joinKey FROM $qJoin";
        } else {
            $emptyVals[] = '';
            $emptyVals = array_unique($emptyVals);
            $quoted  = array_map(fn($v) => "'" . str_replace("'","''",$v) . "'", $emptyVals);
            $qc      = $isPgsql ? "\"$chkCol\"" : "`$chkCol`";
            $castC   = $isPgsql ? "$qc::text" : "CAST($qc AS CHAR)";
            $notEmpty = "$qc IS NOT NULL AND $castC NOT IN (" . implode(',', $quoted) . ")";
            $okSubq  = "SELECT $joinKey FROM $qJoin WHERE $notEmpty";
        }
        $sql = "SELECT (SELECT COUNT(*) FROM $qMain WHERE $mainWhere) AS tot,
                       (SELECT COUNT(*) FROM $qMain WHERE $mainWhere AND $joinKey IN ($okSubq)) AS ok";
        $row  = $pdo->query($sql)->fetch();
        $r['tot'] = (int)($row['tot'] ?? 0);
        $r['ok']  = (int)($row['ok']  ?? 0);
        $r['wh']  = "$mainWhere AND $joinKey NOT IN ($okSubq)";
    } catch (PDOException $e) {
        $r['err'] = $e->getMessage();
    }
    return $r;
}

function cntTbl(?PDO $pdo, string $tbl, string $wh = '1=1'): int {
    if (!$pdo) return -1;
    getTableCols($pdo, $tbl); // populate cache
    if ($GLOBALS['_colCache'][$tbl] === false) return -1; // table not found
    try { return (int)$pdo->query("SELECT COUNT(*) FROM " . qi($tbl) . " WHERE $wh")->fetchColumn(); }
    catch (Exception $e) { return -1; }
}

function incomeIcon(string $name): string {
    $n = $name;
    if (str_contains($n,'ห้อง') || str_contains($n,'อาหาร'))              return '🍽️';
    if (str_contains($n,'อวัยวะเทียม') || str_contains($n,'อุปกรณ์บำบัด')) return '🦾';
    if (str_contains($n,'ยากลับบ้าน'))                                      return '🏠';
    if (str_contains($n,'ยานอกบัญชี') || str_contains($n,'ยานอก'))         return '💉';
    if (str_contains($n,'ยาสมุนไพร') || str_contains($n,'สมุนไพร'))         return '🌿';
    if (str_contains($n,'ยา') || str_contains($n,'บัญชียา'))                return '💊';
    if (str_contains($n,'เวชภัณฑ์'))                                         return '🩹';
    if (str_contains($n,'โลหิต') || str_contains($n,'เลือด'))               return '🩸';
    if (str_contains($n,'รังสี'))                                            return '☢️';
    if (str_contains($n,'เทคนิคการแพทย์') || str_contains($n,'พยาธิ'))     return '🔬';
    if (str_contains($n,'วินิจฉัย') || str_contains($n,'วิธีพิเศษ'))        return '🏷️';
    if (str_contains($n,'อุปกรณ์') || str_contains($n,'เครื่องมือ'))         return '🔧';
    if (str_contains($n,'หัตถการ') || str_contains($n,'วิสัญญี'))           return '⚕️';
    if (str_contains($n,'พยาบาล'))                                           return '👩‍⚕️';
    if (str_contains($n,'ทันต'))                                             return '🦷';
    if (str_contains($n,'กายภาพ') || str_contains($n,'เวชกรรมฟื้นฟู'))     return '🤸';
    if (str_contains($n,'ฝังเข็ม') || str_contains($n,'โรคศิลปะ'))          return '🪡';
    if (str_contains($n,'แพทย์แผนไทย') || str_contains($n,'แผนไทย'))       return '🌿';
    if (str_contains($n,'ธรรมเนียม') || str_contains($n,'ร่วมจ่าย'))        return '💳';
    if (str_contains($n,'ใบรับรองแพทย์') || str_contains($n,'ตรวจร่างกาย'))return '📋';
    if (str_contains($n,'ส่งเสริม') || str_contains($n,'ป้องกัน'))          return '🛡️';
    if (str_contains($n,'สารอาหาร') || str_contains($n,'เส้นเลือด'))        return '🫀';
    return '💰';
}

function billSec(?PDO $pdo, string $code, string $lbl, string $icon): array {
    // รองรับทั้ง income เก็บเป็น '01' (text) และ 1 (integer)
    $isPgsql  = ($pdo && ($GLOBALS['cfg']['db_type'] ?? 'mysql') === 'pgsql');
    $codeInt  = (string)(int)$code; // '01' → '1'
    if ($isPgsql) {
        $wBill = "income::text IN ('$code', '$codeInt')";
    } else {
        $wBill = "income IN ('$code', '$codeInt')";
    }
    $wStatus = $pdo ? wCol($pdo, 'nondrugitems', 'istatus', 'Y') : "istatus = 'Y'";
    $wExclude = $isPgsql ? "name NOT ILIKE '%ส่วนเกิน%'" : "name NOT LIKE '%ส่วนเกิน%'";
    $w = ($wStatus !== '1=1') ? "$wBill AND $wStatus AND $wExclude" : "$wBill AND $wExclude";
    $badge = $code;
    $b = fn($r) => array_merge($r, ['badge' => $badge]);
    return ['id' => "bill$code", 'lbl' => $lbl, 'icon' => $icon, 'rows' => [
        $b(chk($pdo, 'nondrugitems', 'income',            'หมวดค่ารักษาพยาบาล',       $w)),
        $b(chk($pdo, 'nondrugitems', 'name',              'ชื่อภาษาไทย',              $w)),
        $b(chk($pdo, 'nondrugitems', 'ename',             'ชื่อภาษาอังกฤษ',           $w)),
        $b(chk($pdo, 'nondrugitems', 'price',             'ราคาขาย',                  $w, '', ['0','0.00'])),
        ...(in_array($code, ['03','04','17','20']) ? [$b(chk($pdo, 'nondrugitems', 'unitcost', 'ราคาทุน', $w, '', ['0','0.00']))] : []),
        $b(chk($pdo, 'nondrugitems', 'billcode',          'Billcode',                  $w)),
        $b(chk($pdo, 'nondrugitems', 'nhso_adp_type_id',  'ADP Type',                  $w)),
        $b(chk($pdo, 'nondrugitems', 'nhso_adp_code',     'ADP Code',                  $w)),
        $b(chk($pdo, 'nondrugitems', 'enable_sks_opd',    'ส่งเบิก สกส. OPD',         $w)),
        $b(chk($pdo, 'nondrugitems', 'enable_sks_ipd',    'ส่งเบิก สกส. IPD',         $w)),
        $b(chk($pdo, 'nondrugitems', 'istatus',           'เปิดใช้งาน',               $w)),
        $b(chk($pdo, 'nondrugitems', 'unit',              'หน่วย',                    $w)),
        $b(chk($pdo, 'nondrugitems', 'no_remed',          'ไม่ Remed',                $w)),
    ]];
}

// ── AJAX: detail rows ──────────────────────────────────────
if (isset($_GET['detail']) && $pdo) {
    header('Content-Type: application/json; charset=utf-8');
    $tbl = preg_replace('/[^a-zA-Z0-9_]/', '', $_GET['tbl'] ?? '');
    $col = preg_replace('/[^a-zA-Z0-9_]/', '', $_GET['col'] ?? '');
    $wh  = $_GET['wh'] ?? '1=1';
    if (!$tbl || !$col || strlen($wh) > 5000) {
        echo json_encode(['error' => 'invalid params']); exit;
    }
    $allowed_tables = ['doctor','officer','opduser','officer_group','officer_hospital_department','officer_department',
        'pttype','pttype_service_charge','kskdepartment','clinic','spclty','ward','roomno','bedno','bed',
        'drugitems','nondrugitems','nondrugitems_sks_bc','labitems','lab_items','xrayitems','xray_items','xray_form_head',
        'blb_blood_items','er_oper_code','ipt_oper_code',
        'operation_item','operation_anes_oper',
        'druguse','druguse2','drugusage','income',
        'icd9operitem','physic_items','dttm',
        'checkup_group','vaccine_item','vaccine_lot',
        'nutrition_food_type','nutrition_food_sub_type','nutrition_food','nutrition_food_supply',
        'nutrition_food_sub_day','nutrition_food_day','nutrition_food_disease','nutrition_food_special',
        'nutri_consult_item','nutri_consult_screen_title','nutri_consult_report_title','nutri_consult_sub_type',
        'cc_text','hpi_text','pe_text',
        'health_med_operation_item'];
    if (!in_array($tbl, $allowed_tables)) {
        echo json_encode(['error' => 'table not allowed']); exit;
    }
    try {
        $qcol  = qi($col); $qtbl = qi($tbl);
        $isPgsql = ($cfg['db_type'] ?? 'mysql') === 'pgsql';
        if ($col === '_raw_') {
            // wh already encodes the missing-record condition (NOT IN subquery)
            $empty = '1=1';
        } else {
            $castCol = $isPgsql ? "$qcol::text" : $qcol;
            $empty = "$qcol IS NULL OR $castCol = ''";
        }

        // Auto-detect sort columns from table structure
        $tblCols = getTableCols($pdo, $tbl);

        // Known status columns per table (Y = active/enabled)
        $statusCandidates = [
            'officer_active','isuse','istatus','use_status','active',
            'is_active','status','enabled',
        ];
        $sortActiveCol = null;
        foreach ($statusCandidates as $c) {
            if (in_array($c, $tblCols)) { $sortActiveCol = $c; break; }
        }

        // Known code/primary-sort columns per table
        $codePriorityMap = [
            'doctor'                      => ['doctor_code','code'],
            'officer'                     => ['officer_login_name','officer_id'],
            'pttype'                      => ['pttype','pcode'],
            'kskdepartment'               => ['depcode','department_id','id'],
            'clinic'                      => ['clinic','code'],
            'spclty'                      => ['spclty','code'],
            'ward'                        => ['ward','code'],
            'roomno'                      => ['roomno','code'],
            'bedno'                       => ['bedno','bed_id','id'],
            'bed'                         => ['bed_code','code'],
            'drugitems'                   => ['icode','code'],
            'nondrugitems'                => ['icode','code'],
            'labitems'                    => ['lab_items_code','code'],
            'xrayitems'                   => ['xray_items_code','code'],
            'xray_items'                  => ['xray_items_code','code'],
            'xray_form_head'              => ['xray_form_head_id','id'],
            'blb_blood_items'             => ['blb_blood_items_code','code','id'],
            'er_oper_code'                => ['er_oper_code_id','code','id'],
            'ipt_oper_code'               => ['ipt_oper_code_id','code','id'],
            'operation_item'              => ['operation_item_id','code','id'],
            'operation_anes_oper'         => ['operation_anes_oper_id','code','id'],
            'dttm'                        => ['dttm_id','code','id'],
            'physic_items'                => ['physic_items_id','code','id'],
            'nutrition_food_type'         => ['nutrition_food_type_id','id'],
            'nutrition_food_sub_type'     => ['nutrition_food_sub_type_id','id'],
            'nutrition_food'              => ['nutrition_food_id','id'],
            'nutrition_food_supply'       => ['nutrition_food_supply_id','id'],
            'nutrition_food_sub_day'      => ['nutrition_food_sub_day_id','id'],
            'nutrition_food_day'          => ['nutrition_food_day_id','id'],
            'nutrition_food_disease'      => ['nutrition_food_disease_id','id'],
            'nutrition_food_special'      => ['nutrition_food_special_id','id'],
            'nutri_consult_item'          => ['nutri_consult_item_id','id'],
            'nutri_consult_screen_title'  => ['nutri_consult_screen_title_id','id'],
            'nutri_consult_report_title'  => ['nutri_consult_report_title_id','id'],
            'nutri_consult_sub_type'      => ['nutri_consult_sub_type_id','id'],
            'druguse'                     => ['druguse_id','id'],
            'druguse2'                    => ['druguse2_id','id'],
            'drugusage'                   => ['code','drugusage_id','id'],
            'officer_group'               => ['officer_group_id','id'],
            'officer_hospital_department' => ['officer_id','id'],
            'officer_department'          => ['officer_id','id'],
            'pttype_service_charge'       => ['pttype','id'],
            'checkup_group'               => ['checkup_group_id','id'],
            'vaccine_item'                => ['vaccine_id','code'],
            'vaccine_lot'                 => ['lot_no','id'],
            'food_item'                   => ['food_id','code'],
            'health_med_operation_item'   => ['health_med_operation_item_id','id'],
            'lab_items'                   => ['lab_items_code','lab_items_id','id'],
        ];
        $sortCodeCol = null;
        $candidates = $codePriorityMap[$tbl] ?? ['code','id'];
        foreach ($candidates as $c) {
            if (in_array($c, $tblCols)) { $sortCodeCol = $c; break; }
        }
        // Fallback: first column ending with _code or _id
        if (!$sortCodeCol) {
            foreach ($tblCols as $c) {
                if (str_ends_with($c, '_code') || $c === 'code') { $sortCodeCol = $c; break; }
            }
        }

        // Build ORDER BY: status Y first, then code ASC
        $orderParts = [];
        if ($sortActiveCol) {
            $qa = qi($sortActiveCol);
            $orderParts[] = "CASE WHEN $qa = 'Y' THEN 0 ELSE 1 END";
        }
        if ($sortCodeCol) {
            $orderParts[] = qi($sortCodeCol) . " ASC";
        }
        $orderBy = $orderParts ? "ORDER BY " . implode(', ', $orderParts) : "";

        $rows = $pdo->query("SELECT * FROM $qtbl WHERE ($empty) AND ($wh) $orderBy LIMIT 150")->fetchAll();
        echo json_encode(['rows' => $rows, 'count' => count($rows)]);
    } catch (PDOException $e) {
        echo json_encode(['error' => $e->getMessage()]);
    }
    exit;
}

// ── Build sections ─────────────────────────────────────────
$sections = [];

if ($pdo) {
    // 1. บุคลากรทางการแพทย์
    $wd1 = wCol($pdo, 'doctor', 'active', 'Y');
    $wd1_ename = $wd1 . ' AND position_id IN (1,2,11)';
    $sections[] = ['id'=>'doctor','lbl'=>'1. บุคลากรทางการแพทย์','icon'=>'👨‍⚕️','rows'=>[
        chk($pdo,'doctor','name',             'คำนำหน้า-ชื่อ-นามสกุล', $wd1, 'ส่งออก 43 แฟ้ม'),
        chk($pdo,'doctor','pname',            'คำนำหน้า',               $wd1),
        chk($pdo,'doctor','fname',            'ชื่อ',                   $wd1),
        chk($pdo,'doctor','lname',            'นามสกุล',                $wd1),
        chk($pdo,'doctor','ename',            'ชื่อภาษาอังกฤษ',         $wd1_ename, 'แพทย์/ทันตแพทย์/เภสัชกร (position_id 1,2,11)'),
        chk($pdo,'doctor','licenseno',        'เลขใบประกอบวิชาชีพ',     $wd1),
        chk($pdo,'doctor','provider_type_code','Provider',              $wd1),
        chk($pdo,'doctor','position_id',      'ตำแหน่ง',               $wd1),
        chk($pdo,'doctor','cid',              'เลขบัตรประชาชน (CID)',   $wd1),
        chk($pdo,'doctor','active',           'สถานะ',                  $wd1),
        chk($pdo,'doctor','birth_date',       'วันเกิด',                $wd1, '', ['0000-00-00']),
    ]];

    // 2. Login
    $wd2 = wCol($pdo, 'officer', 'officer_active', 'Y');
    $sections[] = ['id'=>'login','lbl'=>'2. Login การใช้งานโปรแกรม','icon'=>'🔑','rows'=>[
        chk($pdo,'officer','officer_login_name',      'User (Login Name)',        $wd2),
        chk($pdo,'officer','officer_name',            'ชื่อ-นามสกุล',            $wd2),
        chk($pdo,'officer','officer_group_list_text', 'กลุ่มสิทธิการใช้งาน',    $wd2),
        chk($pdo,'officer','officer_doctor_code',     'รหัสบุคลากร',             $wd2),
        chk($pdo,'officer','officer_active',          'สถานะ',                   $wd2),
        chk($pdo,'officer','officer_cid',             'เลขที่บัตรประชาชน',       $wd2),
        chk($pdo,'officer_hospital_department','officer_id', 'สาขา'),
        chk($pdo,'officer_department','officer_id',   'ห้องทำงาน'),
    ]];

    // 3. User Group
    $og  = cntTbl($pdo, 'officer_group');
    $ogm = cntTbl($pdo, 'officer_group_module_access');
    $ogt = cntTbl($pdo, 'officer_group_task_access');
    $sections[] = ['id'=>'ugroup','lbl'=>'3. User Group','icon'=>'👥',
        'counts' => [
            ['lbl'=>'officer_group',               'cnt'=>$og,  'note'=>'จำนวน Group'],
            ['lbl'=>'officer_group_module_access',  'cnt'=>$ogm, 'note'=>'Module Access ที่กำหนด'],
            ['lbl'=>'officer_group_task_access',    'cnt'=>$ogt, 'note'=>'Task Access ที่กำหนด'],
        ],
        'rows'=>[
            chk($pdo,'officer_group','officer_group_name','ชื่อกลุ่ม'),
        ]
    ];

    // 4. สิทธิการรักษา
    $wd4       = wCol($pdo, 'pttype', 'isuse', 'Y');
    $wd4_noexp = $wd4 . ' AND ' . qi('noexpire') . "='N'";
    $wd4_sks   = $wd4 . ' AND ' . qi('hipdata_code') . " IN ('OFC','SSS')";
    $_likeOp   = ($cfg['db_type'] ?? 'mysql') === 'pgsql' ? 'NOT ILIKE' : 'NOT LIKE';
    $wd4_sks_nohealth = $wd4_sks . ' AND ' . qi('name') . " $_likeOp '%ตรวจสุขภาพ%'";
    $sections[] = ['id'=>'pttype','lbl'=>'4. สิทธิการรักษาของผู้ป่วย','icon'=>'🏥','rows'=>[
        chk($pdo,'pttype','name',                        'ชื่อสิทธิ',                                $wd4),
        chk($pdo,'pttype','pcode',                       'สิทธิมาตรฐาน',                             $wd4),
        chk($pdo,'pttype','paidst',                      'การชำระเงิน',                              $wd4),
        chk($pdo,'pttype','isuse',                       'สถานะ',                                    $wd4),
        chk($pdo,'pttype','pttype_price_policy_type_id', 'ผังค่าบริการ',                             $wd4),
        chk($pdo,'pttype','pttype_price_group_id',       'กลุ่มค่าบริการ',                           $wd4),
        chk($pdo,'pttype','hipdata_code',                'รหัสมาตรฐาน INSCL',                        $wd4),
        chk($pdo,'pttype','nhso_code',                   'รหัสมาตรฐาน สปสช.',                        $wd4),
        chk($pdo,'pttype','grouper_release',             'ใช้ Grouper Version',                      $wd4),
        chk($pdo,'pttype','sks_benefit_plan_type_id',    'Benefit plan สกส. (เฉพาะ OFC/SSS)',        $wd4_sks, 'เช็คเฉพาะ hipdata_code IN OFC,SSS'),
        chk($pdo,'pttype','noexpire',                    'วันหมดอายุต้องใส่ (เฉพาะ noexpire=N)',     $wd4_noexp, 'เช็คเฉพาะ noexpire=N'),
        chk($pdo,'pttype','print_presc_ned',             'ระบุเหตุผลยานอกบัญชี (เฉพาะ OFC/SSS ยกเว้นตรวจสุขภาพ)', $wd4_sks_nohealth, 'เช็คเฉพาะ OFC/SSS ยกเว้นชื่อมีคำว่าตรวจสุขภาพ', ['N']),
        chk($pdo,'pttype','finance_round_money',         'ปัดเศษ=N (ปกส/ขรก เฉพาะ OFC/SSS)',        $wd4_sks,   'เช็คเฉพาะ hipdata_code IN OFC,SSS', ['Y']),
        chk($pdo,'pttype_service_charge','pttype',       'ค่าธรรมเนียมสิทธิอัตโนมัติ'),
    ]];

    // 5. ห้องตรวจ / คลินิก / แผนก
    $wd5k = wCol($pdo, 'kskdepartment', 'depcode_active', 'Y');
    $wd5c = wCol($pdo, 'clinic',        'active_status',  'Y');
    $wd5s = wCol($pdo, 'spclty',        'active_status',  'Y');
    $sections[] = ['id'=>'clinic','lbl'=>'5. ห้องตรวจ / คลินิก / แผนก','icon'=>'🏨','rows'=>[
        // ── ห้องตรวจ (kskdepartment) ──────────────────────
        chk($pdo,'kskdepartment','department',            '[ห้องตรวจ] ชื่อห้อง',                    $wd5k),
        chk($pdo,'kskdepartment','hospital_department_id','[ห้องตรวจ] สาขา',                        $wd5k),
        chk($pdo,'kskdepartment','spclty',                '[ห้องตรวจ] แผนก',                        $wd5k),
        chk($pdo,'kskdepartment','depcode_active',        '[ห้องตรวจ] เปิดใช้งาน',                  $wd5k),
        // ── คลินิก (clinic) ───────────────────────────────
        chk($pdo,'clinic','name',                '[คลินิก] ชื่อคลินิก',                             $wd5c),
        chk($pdo,'clinic','hosxp_clinic_type_id','[คลินิก] ประเภทโรค',                              $wd5c),
        chk($pdo,'clinic','chronic',             '[คลินิก] เป็นโรคเรื้อรังหรือไม่',                 $wd5c),
        chk($pdo,'clinic','app_limit_qty',       '[คลินิก] จำกัดวันนัดตามวันของคลินิก',             $wd5c),
        chk($pdo,'clinic','no_export',           '[คลินิก] ส่ง 43 แฟ้มหรือไม่',                    $wd5c),
        chk($pdo,'clinic','active_status',       '[คลินิก] เปิดใช้งาน',                            $wd5c),
        // ── แผนก (spclty) ─────────────────────────────────
        chk($pdo,'spclty','name',               '[แผนก] ชื่อแผนก',                                 $wd5s),
        chk($pdo,'spclty','no_export_43',       '[แผนก] ส่ง 43 แฟ้มหรือไม่',                       $wd5s),
        chk($pdo,'spclty','no_service_charge',  '[แผนก] การคิดค่าธรรมเนียมอัตโนมัติ',              $wd5s),
        chk($pdo,'spclty','active_status',      '[แผนก] เปิดใช้งาน',                               $wd5s),
    ]];

    // 6. ตึก/ห้อง/เตียง
    $wd6w = wCol($pdo, 'ward',   'ward_active', 'Y');
    $wd6r = wCol($pdo, 'roomno', 'active',      'Y');
    $sections[] = ['id'=>'ward','lbl'=>'6. ตึก / ห้อง / เตียง ผู้ป่วยใน','icon'=>'🛏️','rows'=>[
        // ── รายการตึก (ward) ──────────────────────────────
        chk($pdo,'ward','name',        '[ตึก] ชื่อตึก',         $wd6w),
        chk($pdo,'ward','spclty',      '[ตึก] แผนก',            $wd6w),
        chk($pdo,'ward','ward_active', '[ตึก] เปิดใช้งาน',      $wd6w),
        // ── รายการห้อง (roomno) ───────────────────────────
        chk($pdo,'roomno','name',     '[ห้อง] ชื่อห้อง',        $wd6r),
        chk($pdo,'roomno','roomtype', '[ห้อง] ประเภทห้อง',      $wd6r),
        chk($pdo,'roomno','ward',     '[ห้อง] ตึก (ยกเว้น roomtype=6)', ($wd6r !== '1=1' ? "$wd6r AND " : '') . "roomtype <> 6"),
        // ── รายการเตียง (bedno) — ไม่มี status column ────
        chk($pdo,'bedno','roomno',            '[เตียง] ห้อง'),
        chk($pdo,'bedno','bed_status_type_id','[เตียง] สถานะเตียง'),
        chk($pdo,'bedno','bedtype',           '[เตียง] ประเภทเตียง (ยกเว้น bed_status_type_id=3)', 'bed_status_type_id <> 3'),
        chk($pdo,'bedno','room_charge_icode', '[เตียง] ค่าบริการอัตโนมัติ (bed_status_type_id=1 ยกเว้น roomtype=5)', 'bed_status_type_id = 1 AND roomno NOT IN (SELECT roomno FROM roomno WHERE roomtype = 5)'),
    ]];


    // ── helper สร้าง WHERE ตรวจยาควบคุมจากชื่อ (ใช้ใน หมวด 03/17) ──────────
    $isPgsqlCtrl = ($GLOBALS['cfg']['db_type'] ?? 'mysql') === 'pgsql';
    $likeOp = $isPgsqlCtrl ? 'ILIKE' : 'LIKE';
    $buildCtrlWhere = function(array $names, string $baseWhere) use ($likeOp): string {
        $parts = [];
        foreach ($names as $n) {
            $n = str_replace("'", "''", $n);
            $parts[] = "generic_name $likeOp '%$n%'";
            $parts[] = "name $likeOp '%$n%'";
            $parts[] = "thai_name $likeOp '%$n%'";
        }
        $nameWhere = '(' . implode(' OR ', $parts) . ')';
        return $baseWhere !== '1=1' ? "$baseWhere AND $nameWhere" : $nameWhere;
    };

    // 8. วิธีใช้ยา Mode2
    $dw8 = wCol($pdo, 'drugusage', 'status', 'Y');
    $sections[] = ['id'=>'mode2','lbl'=>'8. วิธีใช้ยา Mode2','icon'=>'📋','rows'=>[
        chk($pdo,'drugusage','code',          'Code',                    $dw8),
        chk($pdo,'drugusage','status',        'เปิดใช้งาน',              $dw8),
        chk($pdo,'drugusage','doctor_use',    'ติ๊กใช้สำหรับแพทย์',      $dw8),
        chk($pdo,'drugusage','shortlist',     'Short List',              $dw8),
        chk($pdo,'drugusage','common_name',   'Common Name',             $dw8),
        chk($pdo,'drugusage','dosageform',    'Dosage Form',             $dw8),
        chk($pdo,'drugusage','name1',         'วิธีใช้ภาษาไทย (name1)', $dw8),
        chk($pdo,'drugusage','ename1',        'วิธีใช้ภาษาอังกฤษ (ename1)', $dw8),
        chk($pdo,'drugusage','opi_usage_code','Dispense Mode Link',      $dw8),
        chk($pdo,'drugusage','use_opi_mode2', 'ติ๊กบังคับใช้วิธีใช้ mode2', $dw8),
    ]];

    // 9. วิธีใช้ยา Mode3
    $wd9 = wCol($pdo, 'druguse', 'isuse', 'Y');
    $sections[] = ['id'=>'mode3','lbl'=>'9. วิธีใช้ยา Mode3','icon'=>'📋','rows'=>[
        chk($pdo,'druguse','druguse_name','วิธีใช้',  $wd9),
        chk($pdo,'druguse','drugunit',    'หน่วย',    $wd9),
        chk($pdo,'druguse','frequency',   'ความถี่',  $wd9),
        chk($pdo,'druguse','drugtime',    'เวลา',     $wd9),
        chk($pdo,'druguse','dose',        'Dose',     $wd9),
    ]];

    $dw = wCol($pdo, 'drugitems', 'istatus', 'Y');

    // 10+. ค่าบริการ — โหลดจากตาราง income อัตโนมัติ (ต่างรพ.ต่างหมวด)
    $incomeRows = [];
    try {
        // ลองดึงจากตาราง income ก่อน
        $incomeRows = $pdo->query(
            "SELECT income, name FROM income ORDER BY income"
        )->fetchAll(PDO::FETCH_ASSOC);
    } catch (PDOException $e) {
        // ถ้าไม่มีตาราง income ให้ดึง DISTINCT income จาก nondrugitems แทน
        try {
            $isPgsql = ($cfg['db_type'] ?? 'mysql') === 'pgsql';
            $incomeRows = $pdo->query(
                "SELECT DISTINCT income::text AS income, income::text AS name
                 FROM nondrugitems WHERE income IS NOT NULL ORDER BY income"
            )->fetchAll(PDO::FETCH_ASSOC);
        } catch (PDOException $e2) { $incomeRows = []; }
    }
    $billSecNum = 10;
    $isPgsqlDrug = ($GLOBALS['cfg']['db_type'] ?? 'mysql') === 'pgsql';
    // รหัส income ที่ต้องตรวจ drugitems เพิ่มด้วย (code => label)
    $drugIncomeCheck = ['03' => 'ยาในบัญชียาหลักแห่งชาติ', '17' => 'ยานอกบัญชียาหลักแห่งชาติ'];
    foreach ($incomeRows as $ir) {
        $code = trim((string)($ir['income'] ?? ''));
        $name = trim((string)($ir['name']   ?? $code));
        if ($code === '') continue;
        if (in_array($code, ['04','20'])) continue;
        if (mb_strpos($name, 'ส่วนเกิน') !== false) continue;
        if (is_numeric($code) && strlen($code) < 2) $code = str_pad($code, 2, '0', STR_PAD_LEFT);
        $icon = incomeIcon($name);
        $lbl  = "$billSecNum. หมวด $name";
        $sec  = billSec($pdo, $code, $lbl, $icon);

        // หมวด 01/02 — เพิ่มตรวจการตั้งค่าเบิกตามสิทธิ (nondrugitems_sks_bc)
        if (in_array($code, ['01','02'])) {
            $isPgsqlSks = ($GLOBALS['cfg']['db_type'] ?? 'mysql') === 'pgsql';
            $codeIntSks = (string)(int)$code;
            $wSksBill = $isPgsqlSks
                ? "income::text IN ('$code','$codeIntSks')"
                : "income IN ('$code','$codeIntSks')";
            $wStSks   = wCol($pdo, 'nondrugitems', 'istatus', 'Y');
            $wExclSks = $isPgsqlSks ? "name NOT ILIKE '%ส่วนเกิน%'" : "name NOT LIKE '%ส่วนเกิน%'";
            $wSks = ($wStSks !== '1=1') ? "$wSksBill AND $wStSks AND $wExclSks" : "$wSksBill AND $wExclSks";
            $sec['rows'] = array_merge($sec['rows'], [
                chkLinked($pdo,'nondrugitems',$wSks,'nondrugitems_sks_bc','icode', null,
                    '[สกส.] ตั้งค่าการเบิกตามสิทธิ'),
                chkLinked($pdo,'nondrugitems',$wSks,'nondrugitems_sks_bc','icode','income',
                    '[สกส.] หมวดค่ารักษาพยาบาล'),
                chkLinked($pdo,'nondrugitems',$wSks,'nondrugitems_sks_bc','icode','bill_code',
                    '[สกส.] Bill Code'),
                chkLinked($pdo,'nondrugitems',$wSks,'nondrugitems_sks_bc','icode','claim_amount',
                    '[สกส.] ยอดเบิกได้', ['0','0.00']),
                chkLinked($pdo,'nondrugitems',$wSks,'nondrugitems_sks_bc','icode','rev_date',
                    '[สกส.] rev_date', ['0000-00-00']),
            ]);
        }

        // หมวด 18 ค่าธรรมเนียมร่วมจ่าย — ตรวจเฉพาะ 4 ฟิลด์
        if ($code === '18') {
            $isPgsql18 = ($GLOBALS['cfg']['db_type'] ?? 'mysql') === 'pgsql';
            $codeInt18 = (string)(int)$code;
            $w18bill   = $isPgsql18
                ? "income::text IN ('$code','$codeInt18')"
                : "income IN ('$code','$codeInt18')";
            $wSt18 = wCol($pdo, 'nondrugitems', 'istatus', 'Y');
            $wExclude18 = $isPgsql18 ? "name NOT ILIKE '%ส่วนเกิน%'" : "name NOT LIKE '%ส่วนเกิน%'";
            $w18 = ($wSt18 !== '1=1') ? "$w18bill AND $wSt18 AND $wExclude18" : "$w18bill AND $wExclude18";
            $b18 = fn($r) => array_merge($r, ['badge' => $code]);
            $sec['rows'] = [
                $b18(chk($pdo, 'nondrugitems', 'income',  'หมวดค่ารักษาพยาบาล', $w18)),
                $b18(chk($pdo, 'nondrugitems', 'name',    'ชื่อภาษาไทย',         $w18)),
                $b18(chk($pdo, 'nondrugitems', 'ename',   'ชื่อภาษาอังกฤษ',      $w18)),
                $b18(chk($pdo, 'nondrugitems', 'price',   'ราคาขาย',             $w18, '', ['0','0.00'])),
            ];
        }

        // ถ้า income นี้เป็น 03 หรือ 17 ให้ต่อ drugitems rows เข้าใน section เดียวกันเลย
        if (isset($drugIncomeCheck[$code])) {
            $sec['hide_zero'] = true;
            $incInt   = (string)(int)$code;
            $wInc     = $isPgsqlDrug
                ? "income::text IN ('$code','$incInt')"
                : "income IN ('$code','$incInt')";
            $wDrugInc = $dw !== '1=1' ? "$dw AND $wInc" : $wInc;
            // TTMT ตรวจเฉพาะยาแผนไทย (sks_product_category มีชื่อ "แผนไทย")
            $ttmtLike = $isPgsqlDrug ? "ILIKE" : "LIKE";
            $wTTMT = "$wDrugInc AND sks_product_category_id IN (SELECT sks_product_category_id FROM sks_product_category WHERE name $ttmtLike '%แผนไทย%')";
            $sec['rows'] = array_merge($sec['rows'], [
                chk($pdo,'drugitems','name',                      '[ยา] ชื่อการค้า',             $wDrugInc),
                chk($pdo,'drugitems','trade_name',                '[ยา] ชื่อยา (trade_name)',     $wDrugInc),
                chk($pdo,'drugitems','strength',                  '[ยา] ความแรง/Strength',        $wDrugInc),
                chk($pdo,'drugitems','units',                     '[ยา] หน่วยนับ',               $wDrugInc),
                chk($pdo,'drugitems','dosageform',                '[ยา] รูปแบบยา',               $wDrugInc),
                chk($pdo,'drugitems','generic_name',              '[ยา] ชื่อสามัญ',              $wDrugInc),
                chk($pdo,'drugitems','name_print',                '[ยา] ชื่อพิมพ์',              $wDrugInc),
                chk($pdo,'drugitems','drugaccount',               '[ยา] บัญชียา',                $wDrugInc),
                chk($pdo,'drugitems','drug_control_type_id',      '[ยา] ประเภทควบคุม',           $wDrugInc),
                chk($pdo,'drugitems','tmt_gp_code',               '[ยา] รหัส TMT GP',            $wDrugInc),
                chk($pdo,'drugitems','tmt_tp_code',               '[ยา] รหัส TMT TP',            $wDrugInc),
                chk($pdo,'drugitems','ttmt_code',                 '[ยา] รหัส TTMT (เฉพาะยาแผนไทย)', $wTTMT),
                chk($pdo,'drugitems','thai_name',                 '[ยา] ชื่อภาษาไทย',            $wDrugInc),
                chk($pdo,'drugitems','sks_product_category_id',   '[ยา] ประเภทผลิตภัณฑ์ สกส.',  $wDrugInc),
                chk($pdo,'drugitems','sks_clain_control_type_id', '[ยา] ประเภทควบคุม สกส.',     $wDrugInc),
                chk($pdo,'drugitems','sks_drug_code',             '[ยา] รหัสยา สกส.',            $wDrugInc),
                // ── ยาเสพติดให้โทษ / วัตถุออกฤทธิ์ต่อจิตประสาท ──────────────────────
                chk($pdo,'drugitems','drug_control_type_id','[ยาควบคุม] ยาเสพติดให้โทษ ประเภท 1',
                    $buildCtrlWhere([
                        'Heroin','เฮโรอีน','Diacetylmorphine','Cocaine','โคเคน',
                        'MDMA','Ecstasy','LSD','Lysergic','Methamphetamine','เมทแอมเฟตามีน',
                        'Amphetamine','แอมเฟตามีน',
                    ], $wDrugInc)),
                chk($pdo,'drugitems','drug_control_type_id','[ยาควบคุม] ยาเสพติดให้โทษ ประเภท 2',
                    $buildCtrlWhere([
                        'Morphine','มอร์ฟีน','Fentanyl','เฟนทานิล',
                        'Pethidine','เพทิดีน','Meperidine',
                        'Methadone','เมทาโดน',
                        'Oxycodone','ออกซิโคโดน',
                        'Hydromorphone','ไฮโดรมอร์โฟน',
                        'Buprenorphine','บูพรีนอร์ฟีน',
                        'Tramadol','ทราเมดอล',
                        'Codeine','โคดีอีน',
                    ], $wDrugInc)),
                chk($pdo,'drugitems','drug_control_type_id','[ยาควบคุม] ยาเสพติดให้โทษ ประเภท 3',
                    $buildCtrlWhere([
                        'Dihydrocodeine','ไดไฮโดรโคดีอีน',
                        'Ethylmorphine','เอทิลมอร์ฟีน',
                    ], $wDrugInc)),
                chk($pdo,'drugitems','drug_control_type_id','[ยาควบคุม] ยาเสพติดให้โทษ ประเภท 4',
                    $buildCtrlWhere([
                        'Cannabis','กัญชา','Marijuana','THC','Tetrahydrocannabinol',
                    ], $wDrugInc)),
                chk($pdo,'drugitems','drug_control_type_id','[ยาควบคุม] ยาเสพติดให้โทษ ประเภท 5',
                    $buildCtrlWhere([
                        'กระท่อม','Kratom','Mitragyna','Mitragynine',
                    ], $wDrugInc)),
                chk($pdo,'drugitems','drug_control_type_id','[ยาควบคุม] วัตถุออกฤทธิ์ต่อจิตประสาท ประเภท 1',
                    $buildCtrlWhere([
                        'Midazolam','มิดาโซแลม',
                    ], $wDrugInc)),
                chk($pdo,'drugitems','drug_control_type_id','[ยาควบคุม] วัตถุออกฤทธิ์ต่อจิตประสาท ประเภท 2',
                    $buildCtrlWhere([
                        'Diazepam','ไดอาซีแพม','ไดอะซีแพม',
                        'Alprazolam','แอลปราโซแลม',
                        'Clonazepam','โคลนาซีแพม',
                        'Lorazepam','โลราซีแพม',
                        'Zolpidem','โซลพิเดม',
                        'Triazolam','ไตรอาโซแลม',
                        'Nitrazepam','นิทราซีแพม',
                        'Flunitrazepam','ฟลูนิทราซีแพม',
                    ], $wDrugInc)),
                chk($pdo,'drugitems','drug_control_type_id','[ยาควบคุม] วัตถุออกฤทธิ์ต่อจิตประสาท ประเภท 3',
                    $buildCtrlWhere([
                        'Phenobarbital','ฟีโนบาร์บิทอล','Phenobarbitone',
                        'Barbiturate','บาร์บิทูเรต','Amobarbital','Butabarbital',
                        'Secobarbital','Pentobarbital','เพนโทบาร์บิทอล',
                    ], $wDrugInc)),
                chk($pdo,'drugitems','drug_control_type_id','[ยาควบคุม] วัตถุออกฤทธิ์ต่อจิตประสาท ประเภท 4',
                    $buildCtrlWhere([
                        'Ketamine','คีตามีน',
                        'Meprobamate','มีโพรบาเมท',
                        'Chlordiazepoxide','คลอร์ไดอาซีพอกไซด์',
                        'Clorazepate','โคลราซีเพต',
                        'Oxazepam','ออกซาซีแพม',
                        'Temazepam','เทมาซีแพม',
                        'Flurazepam','ฟลูราซีแพม',
                        'Bromazepam','โบรมาซีแพม',
                        'Estazolam','เอสตาโซแลม',
                    ], $wDrugInc)),
            ]);
        }

        $sections[] = $sec;
        $billSecNum++;
    }

    // 27. รายการ LAB (ตาราง lab_items)
    $wd27 = wCol($pdo, 'lab_items', 'isuse', 'Y');
    $sections[] = ['id'=>'lab','lbl'=>'27. รายการ LAB Test','icon'=>'🧪','rows'=>[
        chk($pdo,'lab_items','lab_items_name',             'ชื่อรายการ LAB',              $wd27),
        chk($pdo,'lab_items','lab_items_group',            'กลุ่ม LAB',                   $wd27),
        chk($pdo,'lab_items','lab_items_unit',             'หน่วย',                       $wd27),
        chk($pdo,'lab_items','lab_items_normal_value',     'ค่าปกติ',                     $wd27),
        chk($pdo,'lab_items','lab_items_default_value',    'ค่ามาตรฐาน',                  $wd27),
        chk($pdo,'lab_items','critical_range_min_male',    'ค่าวิกฤตสูง (ชาย min)',       $wd27),
        chk($pdo,'lab_items','critical_range_max_male',    'ค่าวิกฤตสูง (ชาย max)',       $wd27),
        chk($pdo,'lab_items','critical_range_min_female',  'ค่าวิกฤตสูง (หญิง min)',      $wd27),
        chk($pdo,'lab_items','critical_range_max_female',  'ค่าวิกฤตสูง (หญิง max)',      $wd27),
        chk($pdo,'lab_items','critical_range_min_male2',   'ค่าวิกฤตต่ำ (ชาย min)',       $wd27),
        chk($pdo,'lab_items','critical_range_max_male2',   'ค่าวิกฤตต่ำ (ชาย max)',       $wd27),
        chk($pdo,'lab_items','critical_range_min_female2', 'ค่าวิกฤตต่ำ (หญิง min)',      $wd27),
        chk($pdo,'lab_items','critical_range_max_female2', 'ค่าวิกฤตต่ำ (หญิง max)',      $wd27),
        chk($pdo,'lab_items','specimen_code',              'Specimen',                     $wd27),
        chk($pdo,'lab_items','display_order',              'ลำดับการรายงานผล',             $wd27),
        chk($pdo,'lab_items','ecode',                      'รหัสผูกกับ LIS',              $wd27),
        chk($pdo,'lab_items','result_type',                'ประเภทการรายงานผล LAB',        $wd27),
        chk($pdo,'lab_items','protect_result_by_user',     'สิทธิอ่านผล ตามเจ้าหน้าที่',  $wd27),
        chk($pdo,'lab_items','protect_result_by_group',    'สิทธิอ่านผล ตามกลุ่ม',        $wd27),
    ]];

    // 28. X-RAY (ตาราง xray_items)
    $wd28 = wCol($pdo, 'xray_items', 'isuse', 'Y');
    $sections[] = ['id'=>'xray','lbl'=>'28. รายการ X-RAY','icon'=>'🩻','rows'=>[
        chk($pdo,'xray_items','xray_items_name',    'ชื่อรายการ XRAY',        $wd28),
        chk($pdo,'xray_items','xray_items_group',   'กลุ่มรายการ XRAY',       $wd28),
        chk($pdo,'xray_items','service_price',      'ราคา OPD',               $wd28,'',['0','0.00']),
        chk($pdo,'xray_items','service_price_ipd',  'ราคา IPD',               $wd28,'',['0','0.00']),
    ]];

    // 29. วาดฟอร์ม X-RAY (ตาราง xray_form_head)
    $sections[] = ['id'=>'xray_form','lbl'=>'29. วาดฟอร์ม X-RAY','icon'=>'📄','rows'=>[
        chk($pdo,'xray_form_head','name',      'แบบฟอร์ม'),
        chk($pdo,'xray_form_head','xray_group','ประเภท/อวัยวะ'),
    ]];

    // 30. ข้อมูล Blood Bank (ตาราง blb_blood_items)
    $wd30 = wCol($pdo, 'blb_blood_items', 'isuse', 'Y');
    $sections[] = ['id'=>'blb','lbl'=>'30. ข้อมูล Blood Bank','icon'=>'🩸','rows'=>[
        chk($pdo,'blb_blood_items','blb_blood_items_name',        'ชื่อชนิดโลหิต',              $wd30),
        chk($pdo,'blb_blood_items','blb_blood_items_code',        'รหัสสภากาชาด',              $wd30),
        chk($pdo,'blb_blood_items','blb_blood_items_icode',       'เชื่อมค่าบริการขอโลหิต',    $wd30),
        chk($pdo,'blb_blood_items','blb_blood_recieve_icode',     'เชื่อมค่าบริการ Crossmatch', $wd30),
        chk($pdo,'blb_blood_items','blb_blood_crossmatch_icode',  'คิดค่า Crossmatch เมื่อ',   $wd30),
        chk($pdo,'blb_blood_items','blb_blood_items_price',       'ราคา',                       $wd30,'',['0','0.00']),
    ]];

    // 31. รายการหัตถการ OPD / 32. ER (ตาราง er_oper_code)
    foreach ([
        ['er_opd', '31. รายการหัตถการ OPD (er_oper_code)', '🏥'],
        ['er_er',  '32. รายการหัตถการ ER  (er_oper_code)', '🚑'],
    ] as [$pid, $plbl, $picon]) {
        $wdp2 = wCol($pdo, 'er_oper_code', 'isuse', 'Y');
        $sections[] = ['id'=>$pid,'lbl'=>$plbl,'icon'=>$picon,'rows'=>[
            chk($pdo,'er_oper_code','name',                 'ชื่อรายการหัตถการ', $wdp2),
            chk($pdo,'er_oper_code','icd9cm',               'ICD9',              $wdp2),
            chk($pdo,'er_oper_code','icd10tm',              'ICD10TM',           $wdp2),
            chk($pdo,'er_oper_code','price',                'ค่าบริการ',         $wdp2,'',['0','0.00']),
            chk($pdo,'er_oper_code','duration_minute',      'ระยะเวลา',          $wdp2),
            chk($pdo,'er_oper_code','search_keyword',       'คำช่วยค้นหา',       $wdp2),
        ]];
    }

    // 33. หัตถการ IPD / LR (ตาราง ipt_oper_code — รวมเป็น section เดียว)
    $wdp3 = wCol($pdo, 'ipt_oper_code', 'isuse', 'Y');
    $infoIpt = fn($r) => array_merge($r, ['info' => true]);
    $sections[] = ['id'=>'ipt_ipd','lbl'=>'33. รายการหัตถการ IPD / LR','icon'=>'🛏️','rows'=>[
        chk($pdo,'ipt_oper_code','name',            'ชื่อรายการหัตถการ', $wdp3),
        chk($pdo,'ipt_oper_code','icd9cm',          'ICD9',              $wdp3),
        chk($pdo,'ipt_oper_code','price',           'ค่าบริการ',         $wdp3,'',['0','0.00']),
        chk($pdo,'ipt_oper_code','use_opi_price',   'คิดราคาตามฝัง',    $wdp3),
        $infoIpt(chk($pdo,'ipt_oper_code','is_investigation','Investigation', $wdp3)),
        $infoIpt(chk($pdo,'ipt_oper_code','duration_minute', 'ระยะเวลา',     $wdp3)),
        $infoIpt(chk($pdo,'ipt_oper_code','search_keyword',  'คำช่วยค้นหา',  $wdp3)),
    ]];

    // 35. รายการหัตถการ OR (ตาราง operation_item)
    $wd35 = wCol($pdo, 'operation_item', 'isuse', 'Y');
    $sections[] = ['id'=>'proc_or','lbl'=>'35. รายการหัตถการ OR','icon'=>'🔪','rows'=>[
        chk($pdo,'operation_item','operation_group_id','กลุ่มการผ่าตัด',    $wd35),
        chk($pdo,'operation_item','name',             'ชื่อรายการผ่าตัด',   $wd35),
        chk($pdo,'operation_item','icode',            'ชื่อค่าใช้จ่าย',     $wd35),
        chk($pdo,'operation_item','icd9',             'ICD9',               $wd35),
        chk($pdo,'operation_item','keyword',          'คำค้นหา',            $wd35),
        chk($pdo,'operation_item','price',            'ราคา OPD',           $wd35,'',['0','0.00']),
        chk($pdo,'operation_item','price_ipd',        'ราคา IPD',           $wd35,'',['0','0.00']),
    ]];

    // 36. รายการหัตถการวิสัญญี (ตาราง operation_anes_oper)
    $wd36 = wCol($pdo, 'operation_anes_oper', 'isuse', 'Y');
    $sections[] = ['id'=>'proc_anes','lbl'=>'36. รายการหัตถการวิสัญญี','icon'=>'😴','rows'=>[
        chk($pdo,'operation_anes_oper','operation_anes_oper_name','ชื่อหัตถการ',    $wd36),
        chk($pdo,'operation_anes_oper','icode',                   'ชื่อค่าใช้จ่าย', $wd36),
        chk($pdo,'operation_anes_oper','icd9',                    'ICD9',           $wd36),
    ]];

    // 37. หัตถการทันตกรรม (ตาราง dttm)
    $wd37 = wCol($pdo, 'dttm', 'active_status', 'Y');
    $sections[] = ['id'=>'proc_dt','lbl'=>'37. รายการหัตถการทันตกรรม','icon'=>'🦷','rows'=>[
        chk($pdo,'dttm','name',                    'ชื่อรายการหัตถการ',              $wd37),
        chk($pdo,'dttm','unit',                    'หน่วย',                          $wd37),
        chk($pdo,'dttm','dttm_group_id',           'หมวด',                           $wd37),
        chk($pdo,'dttm','icd10',                   'ICD10',                          $wd37),
        chk($pdo,'dttm','icd9cm',                  'ICD9',                           $wd37),
        chk($pdo,'dttm','icode',                   'รหัสค่าใช้จ่าย',                 $wd37),
        chk($pdo,'dttm','opd_price1',              'ราคา OPD',                       $wd37,'',['0','0.00']),
        chk($pdo,'dttm','ipd_price1',              'ราคา IPD',                       $wd37,'',['0','0.00']),
        chk($pdo,'dttm','treatment',               'ประเภทบริการ',                   $wd37),
        chk($pdo,'dttm','dt_treatment_type_id',    'ประเภทการรักษา',                 $wd37),
        chk($pdo,'dttm','dttm_dw_report_group_id', 'ประเภทหมวดรายงานทันตกรรม',      $wd37),
        chk($pdo,'dttm','icd10tm_operation_code',  'ICD10TM',                        $wd37),
        chk($pdo,'dttm','search_keyword',          'คำช่วยค้นหา',                    $wd37),
        chk($pdo,'dttm','active_status',           'เปิดใช้งาน',                     $wd37),
    ]];

    // 38. หัตถการกายภาพ/รายการกายอุปกรณ์ (ตาราง physic_items)
    $wd38 = wCol($pdo, 'physic_items', 'active_status', 'Y');
    $sections[] = ['id'=>'proc_pt','lbl'=>'38. รายการหัตถการกายภาพ/รายการกายอุปกรณ์','icon'=>'🤸','rows'=>[
        chk($pdo,'physic_items','name',                       'ชื่อรายการ',           $wd38),
        chk($pdo,'physic_items','active_status',              'เปิดใช้งาน',           $wd38),
        chk($pdo,'physic_items','icode',                      'ชื่อค่าบริการ',        $wd38),
        chk($pdo,'physic_items','physic_group_id',            'กลุ่มงาน',             $wd38),
        chk($pdo,'physic_items','physic_group_treatment_id',  'กลุ่มการรักษา',        $wd38),
        chk($pdo,'physic_items','physic_items_minute',        'ระยะเวลาทำหัตถการ',    $wd38),
        chk($pdo,'physic_items','price',                      'ราคา',                 $wd38,'',['0','0.00']),
        chk($pdo,'physic_items','icd9',                       'ICD9',                 $wd38),
        chk($pdo,'physic_items','f43_rehab_code',             'Rehab Code',           $wd38),
    ]];

    // 41. หัตถการแพทย์แผนไทย (ตาราง health_med_operation_item)
    $dw41 = wCol($pdo, 'health_med_operation_item', 'active_status', 'Y');
    $sections[] = ['id'=>'proc_tm','lbl'=>'41. รายการหัตถการแพทย์แผนไทย','icon'=>'🌿','rows'=>[
        chk($pdo,'health_med_operation_item','health_med_operation_item_name','ชื่อรายการ',      $dw41),
        chk($pdo,'health_med_operation_item','icode',                         'รหัสค่าใช้จ่าย',  $dw41),
        chk($pdo,'health_med_operation_item','icd10tm',                       'ICD10TM',          $dw41),
        chk($pdo,'health_med_operation_item','health_med_operation_type_id',  'ประเภทหัตถการ',   $dw41),
        chk($pdo,'health_med_operation_item','price',                         'ราคา',             $dw41,'',['0','0.00']),
        chk($pdo,'health_med_operation_item','active_status',                 'สถานะ',            $dw41),
        chk($pdo,'health_med_operation_item','search_keyword',                'คำช่วยค้นหา',      $dw41),
    ]];

    // 42. Check up
    $sections[] = ['id'=>'checkup','lbl'=>'42. ตรวจสุขภาพ (Check up)','icon'=>'✅','rows'=>[
        chk($pdo,'checkup_group','checkup_group_name','รายการ Package ตรวจสุขภาพ'),
        chk($pdo,'checkup_group','company_id',        'รายชื่อองค์กร'),
    ]];

    // 43. Vaccine
    $sections[] = ['id'=>'vaccine','lbl'=>'43. ข้อมูล Vaccine','icon'=>'💉','rows'=>[
        chk($pdo,'vaccine_item','vaccine_name','รายการ Vaccine'),
        chk($pdo,'vaccine_lot', 'lot_no',      'Lot Vaccine'),
    ]];

    // 44. ข้อมูลรายการอาหาร (โภชนาการ) — หลายตาราง
    $sections[] = ['id'=>'food','lbl'=>'44. ข้อมูลรายการอาหาร (โภชนาการ)','icon'=>'🥗','rows'=>[
        // กลุ่มอาหาร
        chk($pdo,'nutrition_food_type','nutrition_food_type_name',        'ชื่อกลุ่มอาหาร'),
        // ประเภทอาหาร
        chk($pdo,'nutrition_food_sub_type','nutrition_food_sub_type_name','ชื่อประเภทอาหาร'),
        chk($pdo,'nutrition_food_sub_type','nutrition_food_type_id',      'กลุ่มอาหาร (ประเภท)'),
        // รายการอาหาร
        chk($pdo,'nutrition_food','nutrition_food_name',       'ชื่อเมนูอาหาร'),
        chk($pdo,'nutrition_food','nutrition_food_sub_type_id','ประเภทอาหาร (เมนู)'),
        chk($pdo,'nutrition_food','active',                    'เปิดใช้งาน'),
        // อาหารเสริม
        chk($pdo,'nutrition_food_supply','nutrition_food_supply_name','ชื่ออาหารเสริม'),
        // มื้ออาหาร
        chk($pdo,'nutrition_food_sub_day','nutrition_food_sub_day_name','ชื่อประเภทมื้ออาหาร'),
        chk($pdo,'nutrition_food_day',    'nutrition_food_day_name',    'ชื่อมื้ออาหาร'),
        chk($pdo,'nutrition_food_day',    'nutrition_food_sub_day_id',  'ประเภทมื้ออาหาร (มื้อ)'),
        // อาหารเฉพาะ
        chk($pdo,'nutrition_food_disease','nutrition_food_disease_name','อาหารเฉพาะโรค'),
        chk($pdo,'nutrition_food_special','nutrition_food_special_name','อาหารเฉพาะกลุ่ม'),
    ]];

    // 45. ข้อมูลรายการ Consult โภชนาการ
    $wdNcs  = wCol($pdo, 'nutri_consult_screen_title', 'nutri_cs_screen_title_active', 'Y');
    $wdNcr  = wCol($pdo, 'nutri_consult_report_title', 'nutri_cs_report_title_active',  'Y');
    $sections[] = ['id'=>'nutri_consult','lbl'=>'45. ข้อมูลรายการ Consult โภชนาการ','icon'=>'🧑‍⚕️','rows'=>[
        chk($pdo,'nutri_consult_screen_title','nutri_cs_screen_title_name', 'ตัวเลือก ชักประวัติ (nutri_consult_screen_title)', $wdNcs),
        chk($pdo,'nutri_consult_report_title','nutri_cs_report_title_name', 'ตัวเลือก ให้คำแนะนำ (nutri_consult_report_title)', $wdNcr),
        chk($pdo,'nutri_consult_sub_type','nutri_consult_sub_type_name', 'ตัวเลือกกิจกรรม Consult — ชื่อ (nutri_consult_sub_type)'),
        chk($pdo,'nutri_consult_sub_type','nutri_consult_type_id',       'ตัวเลือกกิจกรรม Consult — ประเภท (nutri_consult_type_id)'),
    ]];

    // 46. คำค้น CC/HPI/PE
    $sections[] = ['id'=>'keyword','lbl'=>'46. คำค้น CC/HPI/PE','icon'=>'🔍','rows'=>[
        chk($pdo,'cc_text',  'cc_name',  'CC (Chief Complaint)'),
        chk($pdo,'hpi_text', 'hpi_name', 'HPI (History of Present Illness)'),
        chk($pdo,'pe_text',  'pe_name',  'PE (Physical Examination)'),
    ]];
}

// ── Overall stats ──────────────────────────────────────────
// นับแต่ละ column-check เป็น 1 หน่วย (ไม่ให้ตารางที่มีข้อมูลมากครอบงำค่าเฉลี่ย)
$overall_checks = 0;
$overall_sum_pct = 0.0;
foreach ($sections as $s) {
    foreach (($s['rows'] ?? []) as $r) {
        if (!$r['err'] && !$r['skip'] && !($r['info']??false) && $r['tot'] > 0) {
            $overall_checks++;
            $overall_sum_pct += $r['ok'] / $r['tot'];
        }
    }
}
$overall_pct = $overall_checks > 0 ? round($overall_sum_pct / $overall_checks * 100) : 0;

// นับ section ที่ 100% และไม่สมบูรณ์
$sec_complete = 0; $sec_incomplete = 0;
foreach ($sections as $s) {
    $sp = secPct($s);
    if ($sp === 100) $sec_complete++;
    else             $sec_incomplete++;
}

// ── Section summary helper ─────────────────────────────────
// ถัวเฉลี่ย % ต่อ column-check เพื่อไม่ให้จำนวน record ครอบงำค่า
function secPct(array $sec): int {
    $cnt = 0; $sum = 0.0;
    foreach ($sec['rows'] ?? [] as $r) {
        if (!$r['err'] && !$r['skip'] && !($r['info']??false) && $r['tot'] > 0) {
            $cnt++;
            $sum += $r['ok'] / $r['tot'];
        }
    }
    return $cnt > 0 ? round($sum / $cnt * 100) : 0;
}

function pctColor(int $pct): string {
    if ($pct >= 90) return '#27ae60';
    if ($pct >= 60) return '#f39c12';
    return '#e74c3c';
}

function pctBg(int $pct): string {
    if ($pct >= 90) return '#f0fff4';
    if ($pct >= 60) return '#fffbf0';
    return '#fff5f5';
}
?>
<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>HOSxP Data Completeness Checker</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: 'Segoe UI', Tahoma, sans-serif; background: #f0f2f5; color: #333; font-size: 20px; }

/* Header */
.header {
  background: linear-gradient(135deg, #1a5276, #2980b9);
  color: white; padding: 14px 24px;
  display: flex; align-items: center; justify-content: space-between;
  box-shadow: 0 2px 8px rgba(0,0,0,0.2); position: sticky; top:0; z-index:200;
}
.header h1 { font-size: 23px; font-weight: 700; }
.header .sub { font-size: 16px; opacity:.75; margin-top:2px; }
.badge { background: rgba(255,255,255,.2); border-radius: 50px; padding: 6px 16px; text-align:center; }
.badge .big { font-size: 19px; font-weight: 700; }
.badge .sm  { font-size: 11px; opacity:.8; }

/* DB indicator */
.db-bar { background: #15406a; padding: 5px 24px; font-size: 12px; color: rgba(255,255,255,.7);
  display: flex; align-items: center; gap: 10px; }
.db-dot { width:8px; height:8px; border-radius:50%; }
.db-dot.ok { background:#27ae60; }
.db-dot.err { background:#e74c3c; }
.db-dot.nc  { background:#f39c12; }

/* Tab nav */
.tab-nav-wrap { background:#1a5276; overflow-x:auto; white-space:nowrap; }
.tab-nav-wrap::-webkit-scrollbar { height:4px; }
.tab-nav-wrap::-webkit-scrollbar-thumb { background:#2980b9; border-radius:2px; }
.tab-nav { display:inline-flex; padding:0 8px; }
.tab-a {
  display:inline-flex; align-items:center; gap:5px;
  padding:11px 15px; color:rgba(255,255,255,.6); font-size:18px;
  white-space:nowrap; border-bottom:3px solid transparent;
  text-decoration:none; transition:all .2s;
}
.tab-a:hover { color:white; background:rgba(255,255,255,.08); }
.tab-a.active { color:white; border-bottom-color:#f39c12; background:rgba(255,255,255,.12); }
.tab-a .badge2 { background:rgba(255,255,255,.2); border-radius:10px; padding:2px 8px; font-size:14px; }
.tab-a.active .badge2, .tab-a.c100 .badge2 { background:#27ae60; color:white; }

/* Content */
.content { padding: 20px 24px; max-width: 100%; margin: 0 auto; }
.tab-pane { display:none; animation: fi .2s ease; }
.tab-pane.active { display:block; }
@keyframes fi { from{opacity:0;transform:translateY(4px)} to{opacity:1;transform:translateY(0)} }

/* Card */
.card { background:white; border-radius:10px; padding:20px;
  box-shadow:0 1px 4px rgba(0,0,0,.08); margin-bottom:16px; }
.card-hd { display:flex; align-items:center; justify-content:space-between;
  margin-bottom:16px; padding-bottom:12px; border-bottom:2px solid #ecf0f1; }
.card-title { font-size:20px; font-weight:600; color:#1a5276; }
.pbar-wrap { display:flex; align-items:center; gap:8px; }
.pbar { width:150px; height:8px; background:#ecf0f1; border-radius:4px; overflow:hidden; }
.pbar-fill { height:100%; border-radius:4px; transition:width .4s ease; }
.pct-txt { font-size:19px; font-weight:600; min-width:50px; }

/* Table */
.check-table { width:100%; border-collapse:collapse; }
.check-table th { background:#f8f9fa; padding:10px 14px; text-align:left; font-size:18px;
  color:#7f8c8d; border-bottom:1px solid #e9ecef; font-weight:600; }
.check-table td { padding:11px 14px; border-bottom:1px solid #f1f3f5; vertical-align:middle; }
.check-table tr:last-child td { border-bottom:none; }
.check-table tr:hover td { background:#fafafa; }
.field-lbl { font-weight:500; font-size:19px; }
.field-note { font-size:16px; color:#95a5a6; margin-top:3px; }
.pbar-sm { width:140px; height:8px; background:#e9ecef; border-radius:4px; overflow:hidden; display:inline-block; vertical-align:middle; }
.pbar-sm-fill { height:100%; border-radius:3px; }
.cnt-ok   { color:#27ae60; font-weight:600; }
.cnt-miss { color:#e74c3c; font-weight:600; }
.cnt-0    { color:#aaa; }
.err-row td { color:#e74c3c; font-size:18px; font-style:italic; }
.detail-btn { background:none; border:1px solid #ddd; border-radius:6px; padding:5px 12px;
  font-size:16px; cursor:pointer; color:#555; transition:all .15s; }
.detail-btn:hover { background:#e74c3c; color:white; border-color:#e74c3c; }
.income-badge { display:inline-block; background:#e8f4fd; color:#2980b9; border:1px solid #b3d7f0;
  border-radius:4px; padding:2px 7px; font-size:14px; font-weight:600; margin-right:6px; vertical-align:middle; }

/* Count boxes */
.count-grid { display:flex; gap:12px; flex-wrap:wrap; margin-bottom:16px; }
.count-box { background:#f8f9fa; border-radius:8px; padding:12px 18px; text-align:center; border:1px solid #e9ecef; }
.count-box .cv { font-size:27px; font-weight:700; color:#1a5276; }
.count-box .cl { font-size:18px; color:#7f8c8d; margin-top:4px; }
.count-box .cn { font-size:18px; color:#95a5a6; }
.count-box.zero .cv { color:#e74c3c; }

/* Summary grid */
.summary-grid { display:grid; grid-template-columns:repeat(6,1fr); gap:16px; }
.sum-card { border:2px solid #b0bec5; border-radius:12px; padding:20px; cursor:pointer; transition:all .2s; text-decoration:none; color:inherit; display:block; box-shadow:0 2px 6px rgba(0,0,0,.08); }
.sum-card:hover { border-color:#2980b9; transform:translateY(-2px); box-shadow:0 4px 12px rgba(0,0,0,.12); }
.sum-card.c100 { border-color:#27ae60; border-width:2px; background:#f0fff4; }
.sum-card .sc-icon { font-size:27px; }
.sum-card .sc-name { font-size:19px; font-weight:600; color:#1a5276; margin:8px 0 12px; line-height:1.4; }
.sum-card .sc-bar { height:10px; background:#ecf0f1; border-radius:5px; overflow:hidden; }
.sum-card .sc-fill { height:100%; border-radius:5px; }
.sum-card .sc-info { font-size:16px; color:#7f8c8d; margin-top:8px; }

/* Login page */
.login-page {
  min-height: calc(100vh - 90px);
  display: flex; align-items: center; justify-content: center;
  padding: 24px;
  background: linear-gradient(145deg, #eaf2fb 0%, #f0f2f5 60%, #e8f8f5 100%);
}
.login-card {
  background: white; border-radius: 16px;
  box-shadow: 0 8px 40px rgba(26,82,118,.13);
  width: 100%; max-width: 420px; overflow: hidden;
}
.login-card-top {
  background: linear-gradient(135deg, #1a5276, #2980b9);
  padding: 32px 40px 28px; text-align: center; color: white;
}
.login-card-top .logo-circle {
  width: 64px; height: 64px; border-radius: 50%;
  background: rgba(255,255,255,.2); margin: 0 auto 14px;
  display: flex; align-items: center; justify-content: center;
  font-size: 25px; border: 2px solid rgba(255,255,255,.35);
}
.login-card-top h2 { font-size: 14px; font-weight: 700; margin-bottom: 4px; }
.login-card-top p  { font-size: 12px; opacity: .75; }
.login-card-body { padding: 28px 36px 32px; }
.login-err {
  background: #fde8e8; border-left: 3px solid #e74c3c;
  border-radius: 6px; padding: 10px 14px;
  color: #c0392b; font-size: 13px; margin-bottom: 18px;
  display: flex; align-items: center; gap: 8px;
}
.login-field { margin-bottom: 18px; }
.login-field label {
  display: block; font-size: 12px; font-weight: 600;
  color: #4a5568; margin-bottom: 7px; letter-spacing: .3px;
}
.login-input-box {
  display: flex; align-items: center;
  border: 1.5px solid #e2e8f0; border-radius: 8px;
  background: #f8fafc; transition: border .15s, box-shadow .15s;
  overflow: hidden;
}
.login-input-box:focus-within {
  border-color: #2980b9; background: white;
  box-shadow: 0 0 0 3px rgba(41,128,185,.12);
}
.login-input-box .field-icon {
  width: 42px; flex-shrink: 0; display: flex; align-items: center; justify-content: center;
  color: #a0aec0; border-right: 1px solid #e2e8f0; height: 42px;
  background: transparent;
}
.login-input-box .field-icon svg { width: 16px; height: 16px; }
.login-input-box:focus-within .field-icon { color: #2980b9; border-right-color: #bee3f8; }
.login-input-box input {
  flex: 1; padding: 10px 12px; border: none; background: transparent;
  font-size: 13.5px; font-family: inherit; color: #2d3748;
  outline: none; min-width: 0;
}
.login-input-box input::placeholder { color: #c4ccd8; }
.show-pass {
  padding: 0 12px; height: 42px; background: none; border: none;
  cursor: pointer; color: #a0aec0; display: flex; align-items: center;
  transition: color .15s; flex-shrink: 0;
}
.show-pass:hover { color: #2980b9; }
.show-pass svg { width: 16px; height: 16px; }
.login-btn {
  width: 100%; padding: 12px;
  background: linear-gradient(135deg, #1a5276, #2980b9);
  color: white; border: none; border-radius: 8px;
  font-size: 14px; font-family: inherit; font-weight: 700;
  cursor: pointer; transition: all .15s; margin-top: 6px;
  letter-spacing: .4px; box-shadow: 0 2px 8px rgba(41,128,185,.3);
}
.login-btn:hover { opacity: .92; box-shadow: 0 4px 14px rgba(41,128,185,.4); transform: translateY(-1px); }
.login-btn:active { transform: translateY(0); }
.login-hint {
  font-size: 11.5px; color: #a0aec0; text-align: center;
  margin-top: 18px; padding-top: 16px; border-top: 1px solid #f0f0f0; line-height: 1.7;
}
/* DB type badge in status bar */
.db-type-badge { background:rgba(255,255,255,.2); border-radius:4px; padding:1px 7px;
  font-size:10px; font-weight:700; letter-spacing:.5px; color:white; }

/* DB type radio buttons */
.db-type-row { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
.db-type-opt { border:1.5px solid #ddd; border-radius:8px; padding:10px 14px;
  cursor:pointer; display:flex; flex-direction:column; align-items:center; gap:3px;
  transition:all .15s; font-size:13px; font-weight:500; color:#555; }
.db-type-opt input[type=radio] { display:none; }
.db-type-opt:hover { border-color:#2980b9; background:#f0f8ff; }
.db-type-opt.active { border-color:#2980b9; background:#e8f4fd; color:#1a5276; }
.db-type-opt .db-icon { font-size:22px; }
.db-type-opt small { font-size:10px; color:#95a5a6; }
.db-type-opt.active small { color:#2980b9; }

.user-chip { display:flex; align-items:center; gap:6px; background:rgba(255,255,255,.15);
  border-radius:20px; padding:4px 12px 4px 6px; font-size:12.5px; color:white; }
.user-chip .av { width:26px; height:26px; border-radius:50%; background:#f39c12;
  display:flex; align-items:center; justify-content:center; font-weight:700; font-size:13px; color:#333; }

/* Setup form */
.setup-wrap { max-width:480px; margin:40px auto; }
.setup-card { background:white; border-radius:12px; padding:32px; box-shadow:0 2px 12px rgba(0,0,0,.1); }
.setup-card h2 { font-size:18px; color:#1a5276; margin-bottom:6px; }
.setup-card .desc { font-size:13px; color:#7f8c8d; margin-bottom:24px; }
.form-row { margin-bottom:14px; }
.form-row label { display:block; font-size:12px; font-weight:600; color:#555; margin-bottom:5px; }
.form-row input { width:100%; padding:9px 12px; border:1px solid #ddd; border-radius:6px; font-size:13px; font-family:inherit; }
.form-row input:focus { outline:none; border-color:#2980b9; box-shadow:0 0 0 2px rgba(41,128,185,.15); }
.form-row-2 { display:grid; grid-template-columns:2fr 1fr; gap:10px; }
.btn-primary { background:#2980b9; color:white; border:none; padding:10px 22px; border-radius:7px;
  font-size:14px; font-family:inherit; font-weight:600; cursor:pointer; width:100%; transition:background .15s; }
.btn-primary:hover { background:#1a6fa0; }
.alert-err { background:#fde8e8; border:1px solid #f5c6c6; border-radius:7px; padding:12px 16px;
  color:#c0392b; font-size:13px; margin-bottom:16px; }
.alert-info { background:#e8f4fd; border:1px solid #b8daf5; border-radius:7px; padding:12px 16px;
  color:#1a5276; font-size:13px; margin-bottom:16px; }

/* Toolbar */
.toolbar { background:white; border-bottom:1px solid #e9ecef; padding:7px 24px;
  display:flex; gap:10px; align-items:center; }
.btn-t { padding:7px 16px; border-radius:6px; border:none; cursor:pointer;
  font-size:18px; font-family:inherit; font-weight:500; transition:all .15s; }
.btn-t.blue   { background:#2980b9; color:white; }
.btn-t.blue:hover { background:#1a6fa0; }
.btn-t.red    { background:#fde8e8; color:#c0392b; border:1px solid #f5c6c6; }
.btn-t.red:hover  { background:#c0392b; color:white; }
.btn-t.gray   { background:#f3f4f6; color:#555; border:1px solid #ddd; }
.btn-t.gray:hover { background:#555; color:white; }
.t-sep { color:#ddd; }
.db-info-sm { font-size:18px; color:#7f8c8d; }

/* Modal */
.modal-bg { display:none; position:fixed; inset:0; background:rgba(0,0,0,.5); z-index:500; align-items:center; justify-content:center; }
.modal-bg.show { display:flex; }
.modal { background:white; border-radius:10px; width:90%; max-width:900px; max-height:85vh; display:flex; flex-direction:column; }
.modal-hd { padding:16px 20px; border-bottom:1px solid #e9ecef; display:flex; align-items:center; justify-content:space-between; }
.modal-hd h3 { font-size:15px; color:#1a5276; }
.modal-close { background:none; border:none; font-size:19px; cursor:pointer; color:#7f8c8d; line-height:1; }
.modal-body { overflow:auto; padding:0; flex:1; }
.modal-table { width:100%; border-collapse:collapse; font-size:12.5px; }
.modal-table th { position:sticky; top:0; background:#f8f9fa; padding:7px 12px;
  text-align:left; border-bottom:2px solid #e9ecef; font-weight:600; color:#555; }
.modal-table td { padding:6px 12px; border-bottom:1px solid #f1f3f5; }
.modal-table tr:hover td { background:#fafafa; }
.modal-count { padding:8px 20px; font-size:12px; color:#7f8c8d; border-top:1px solid #e9ecef; }
.loading { padding:32px; text-align:center; color:#95a5a6; }

@media print {
  .header,.tab-nav-wrap,.toolbar,button { display:none!important; }
  .tab-pane { display:block!important; page-break-after:always; }
  .card { box-shadow:none; border:1px solid #ddd; }
}
</style>
</head>
<body>

<!-- Header -->
<div class="header">
  <div>
    <div class="header h1" style="font-size:16px;font-weight:700;">🏥 HOSxP Data Completeness Checker</div>
    <div class="sub">ตรวจสอบความสมบูรณ์ข้อมูลพื้นฐาน HOSxP XE</div>
  </div>
  <div style="display:flex;align-items:center;gap:14px;">
    <?php if ($me): ?>
    <div class="user-chip">
      <div class="av"><?= mb_strtoupper(mb_substr($me['loginname'], 0, 1)) ?></div>
      <div>
        <div style="font-weight:600;font-size:12.5px;"><?= htmlspecialchars($me['fullname'] ?: $me['loginname']) ?></div>
        <div style="font-size:10px;opacity:.75;"><?= htmlspecialchars($me['loginname']) ?></div>
      </div>
    </div>
    <?php endif; ?>
    <?php if ($pdo && $me): ?>
    <div class="badge" style="background:#f0fff4;border:1.5px solid #27ae60;min-width:72px;">
      <div class="big" style="color:#27ae60;font-size:13px;"><?= $sec_complete ?> ชุด</div>
      <div class="sm" style="color:#27ae60;">สมบูรณ์ 100%</div>
    </div>
    <div class="badge" style="background:#fff5f5;border:1.5px solid #e74c3c;min-width:72px;">
      <div class="big" style="color:#e74c3c;font-size:13px;"><?= $sec_incomplete ?> ชุด</div>
      <div class="sm" style="color:#e74c3c;">ไม่สมบูรณ์</div>
    </div>
    <div class="badge">
      <div class="big"><?= $overall_pct ?>%</div>
      <div class="sm">ภาพรวมความสมบูรณ์</div>
    </div>
    <?php endif; ?>
  </div>
</div>

<!-- DB Status Bar -->
<div class="db-bar">
  <?php if ($pdo): ?>
    <span class="db-dot ok"></span>
    <span class="db-type-badge"><?= strtoupper($cfg['db_type'] ?? 'MySQL') ?></span>
    <span>เชื่อมต่อ: <strong><?= htmlspecialchars($cfg['db']) ?></strong> @ <?= htmlspecialchars($cfg['host']) ?></span>
  <?php elseif ($cfg && $conn_err): ?>
    <span class="db-dot err"></span>
    <span style="color:#f1948a">เชื่อมต่อไม่ได้: <?= htmlspecialchars($conn_err) ?></span>
    <button class="btn-t red" style="padding:2px 10px;font-size:11px;margin-left:8px;" onclick="openSetupModal()">แก้ไขการเชื่อมต่อ</button>
  <?php else: ?>
    <span class="db-dot nc"></span>
    <span>ยังไม่ได้ตั้งค่าการเชื่อมต่อฐานข้อมูล</span>
  <?php endif; ?>
</div>

<?php if ($pdo && $me): ?>
<!-- Toolbar -->
<div class="toolbar">
  <button class="btn-t blue" onclick="location.reload()">🔄 รีเฟรชข้อมูล</button>
  <button class="btn-t gray" onclick="window.print()">🖨️ พิมพ์</button>
  <button class="btn-t gray" onclick="exportCSV()">📥 Export CSV</button>
  <span style="flex:1"></span>
  <span class="db-info-sm">DB: <strong><?= htmlspecialchars($cfg['db']) ?></strong></span>
  <span class="t-sep">|</span>
  <button class="btn-t gray" onclick="openSetupModal()">⚙️ เปลี่ยน DB</button>
  <button class="btn-t gray" onclick="copySetupLink()" title="สร้างลิงค์แชร์ให้เครื่องอื่น">🔗 Setup Link</button>
  <a href="?logout=1" class="btn-t red" style="text-decoration:none;" onclick="return confirm('ออกจากระบบ?')">🚪 ออกจากระบบ</a>
</div>

<?php elseif ($pdo && !$me): ?>
<!-- Login Page -->
<div class="login-page">
  <div class="login-card">
    <!-- Top banner -->
    <div class="login-card-top">
      <div class="logo-circle">🏥</div>
      <h2>HOSxP Data Completeness</h2>
      <p>ตรวจสอบความสมบูรณ์ข้อมูลพื้นฐาน HOSxP XE</p>
    </div>
    <!-- Body -->
    <div class="login-card-body">
      <?php if ($login_err): ?>
      <div class="login-err">
        <svg viewBox="0 0 20 20" fill="currentColor" style="width:16px;height:16px;flex-shrink:0"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clip-rule="evenodd"/></svg>
        <?= htmlspecialchars($login_err) ?>
      </div>
      <?php endif; ?>

      <form method="POST" autocomplete="on">
        <input type="hidden" name="action" value="login">

        <!-- Username -->
        <div class="login-field">
          <label>ชื่อผู้ใช้งาน (Login Name)</label>
          <div class="login-input-box">
            <span class="field-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
              </svg>
            </span>
            <input type="text" name="loginname"
                   value="<?= htmlspecialchars($_POST['loginname'] ?? '') ?>"
                   placeholder="Login Name ของ HOSxP" required autofocus>
          </div>
        </div>

        <!-- Password -->
        <div class="login-field">
          <label>รหัสผ่าน</label>
          <div class="login-input-box">
            <span class="field-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
              </svg>
            </span>
            <input type="password" name="password" id="pw-input" placeholder="รหัสผ่าน" required>
            <button type="button" class="show-pass" onclick="togglePw()" title="แสดง/ซ่อนรหัสผ่าน">
              <svg id="eye-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
              </svg>
            </button>
          </div>
        </div>

        <button type="submit" class="login-btn">เข้าสู่ระบบ</button>
        <button type="button" onclick="debugLogin()" style="width:100%;margin-top:8px;padding:9px;background:none;border:1px dashed #aaa;border-radius:8px;color:#888;font-size:12px;cursor:pointer;">🔍 ตรวจสอบปัญหา login</button>
      </form>
      <div id="debug-result" style="display:none;margin-top:10px;padding:10px;background:#f8f8f8;border:1px solid #ddd;border-radius:8px;font-size:11px;font-family:monospace;word-break:break-all;"></div>

      <div class="login-hint">
        เชื่อมต่อกับ <strong><?= htmlspecialchars(strtoupper($cfg['db_type'] ?? 'MySQL')) ?></strong>
        · <strong><?= htmlspecialchars($cfg['db'] ?? '') ?></strong> @ <?= htmlspecialchars($cfg['host'] ?? '') ?><br>
        <a href="#" onclick="openSetupModal();return false;"
           style="color:#2980b9;">เปลี่ยนการเชื่อมต่อ DB</a>
      </div>
    </div>
  </div>
</div>
<script>
function togglePw() {
  const i = document.getElementById('pw-input');
  const isHide = i.type === 'password';
  i.type = isHide ? 'text' : 'password';
  document.getElementById('eye-icon').innerHTML = isHide
    ? '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/>'
    : '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>';
}
async function debugLogin() {
  const login = document.querySelector('input[name=loginname]').value.trim();
  const pass  = document.getElementById('pw-input').value;
  const el    = document.getElementById('debug-result');
  if (!login || !pass) { el.style.display='block'; el.textContent='กรุณากรอก username และ password ก่อน'; return; }
  el.style.display='block'; el.textContent='⏳ กำลังตรวจสอบ...';
  const res  = await fetch('?pw_debug=1',{method:'POST',body:new URLSearchParams({loginname:login,password:pass})});
  const data = await res.json();
  if (!data.ok) { el.textContent = '❌ ' + data.msg; return; }
  const r = data.result;
  let txt = `MD5(password): ${r.md5_input}\n\n`;
  for (const tbl of ['officer','opduser']) {
    const t = r[tbl];
    if (!t) continue;
    if (t.error) { txt += `[${tbl}] ❌ ${t.error}\n\n`; continue; }
    txt += `[${tbl}] พบ user: ${t.found?'✅ ใช่':'❌ ไม่พบ'}  login_col: ${t.login_col||'-'}\n`;
    for (const [col,info] of Object.entries(t.pass_cols||{})) {
      const m = info.md5_match?'✅ md5 ตรง': info.plain_match?'✅ plain ตรง':'❌ ไม่ตรง';
      txt += `  ${col} [${info.format}]: ${info.preview}  ${m}\n`;
    }
    txt += '\n';
  }
  el.textContent = txt;
}
</script>
<?php endif; // if ($pdo && $me) / elseif ($pdo && !$me) ?>

<?php if ($pdo && $me): ?>
<!-- Tab Nav -->
<div class="tab-nav-wrap">
  <div class="tab-nav">
    <a class="tab-a active" href="#summary" data-tab="summary" onclick="switchTab('summary');return false;">
      📊 ภาพรวม <span class="badge2"><?= $overall_pct ?>%</span>
    </a>
    <?php foreach ($sections as $sec):
      $sp = secPct($sec);
    ?>
    <a class="tab-a <?= $sp===100?'c100':'' ?>" href="#<?= $sec['id'] ?>" data-tab="<?= $sec['id'] ?>"
       onclick="switchTab('<?= $sec['id'] ?>');return false;">
      <?= $sec['icon'] ?> <?= htmlspecialchars($sec['lbl']) ?>
      <span class="badge2"><?= $sp ?>%</span>
    </a>
    <?php endforeach; ?>
  </div>
</div>

<!-- Content -->
<div class="content">

  <!-- Summary Tab -->
  <div class="tab-pane active" id="summary">
    <div class="card">
      <div class="card-hd">
        <span class="card-title">📊 ภาพรวมความสมบูรณ์ข้อมูลพื้นฐาน HOSxP XE</span>
        <span style="display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;">
          <span style="background:#e8f8ee;color:#27ae60;padding:3px 10px;border-radius:20px;">100% &nbsp;<?= $sec_complete ?> ชุด</span>
          <span style="background:#fef0f0;color:#e74c3c;padding:3px 10px;border-radius:20px;">ไม่สมบูรณ์ &nbsp;<?= $sec_incomplete ?> ชุด</span>
          <span style="background:#eaf3fb;color:#2980b9;padding:3px 10px;border-radius:20px;">รวม <?= $overall_pct ?>%</span>
        </span>
      </div>
      <div class="summary-grid">
        <?php foreach ($sections as $sec):
          $sp = secPct($sec);
          $valid_rows = array_values(array_filter($sec['rows']??[], fn($r)=>!$r['err']&&!$r['skip']&&$r['tot']>0));
          $chk_tot  = count($valid_rows);
          $chk_ok   = count(array_filter($valid_rows, fn($r)=> $r['ok']/$r['tot']>=1.0));
          // แสดง record count ของตารางหลัก = tot ของ row แรก (ทุก row ใน section เดียวกันมี tot เท่ากัน)
          $rec_count = $chk_tot > 0 ? $valid_rows[0]['tot'] : 0;
        ?>
        <a class="sum-card <?= $sp===100?'c100':'' ?>" href="#<?= $sec['id'] ?>"
           onclick="switchTab('<?= $sec['id'] ?>');return false;">
          <div class="sc-icon"><?= $sec['icon'] ?></div>
          <div class="sc-name"><?= htmlspecialchars(preg_replace('/^\d+\.\s*/','', $sec['lbl'])) ?></div>
          <div class="sc-bar">
            <div class="sc-fill" style="width:<?= $sp ?>%;background:<?= pctColor($sp) ?>"></div>
          </div>
          <div class="sc-info" style="display:flex;flex-wrap:wrap;gap:4px;margin-top:6px;align-items:center;">
            <span style="color:#7f8c8d;font-size:10.5px;"><?= number_format($rec_count) ?> records</span>
            <span style="background:#e8f8ee;color:#27ae60;padding:1px 7px;border-radius:20px;font-size:10.5px;font-weight:600;">100% <?= $chk_ok ?> cols</span>
            <?php if ($chk_tot - $chk_ok > 0): ?>
            <span style="background:#fef0f0;color:#e74c3c;padding:1px 7px;border-radius:20px;font-size:10.5px;font-weight:600;">ขาด <?= $chk_tot - $chk_ok ?> cols</span>
            <?php endif; ?>
          </div>
        </a>
        <?php endforeach; ?>
      </div>
    </div>
  </div>

  <!-- Section Tabs -->
  <?php foreach ($sections as $sec):
    $sp = secPct($sec);
    $fc = pctColor($sp);
  ?>
  <div class="tab-pane" id="<?= $sec['id'] ?>">
    <div style="margin-bottom:10px;">
      <button onclick="switchTab('summary');return false;" style="background:none;border:2px solid #2980b9;border-radius:8px;padding:10px 22px;font-size:18px;color:#2980b9;cursor:pointer;display:inline-flex;align-items:center;gap:8px;font-weight:600;">
        ← กลับหน้าหลัก
      </button>
    </div>
    <div class="card">
      <div class="card-hd">
        <span class="card-title"><?= $sec['icon'] ?> <?= htmlspecialchars($sec['lbl']) ?></span>
        <div class="pbar-wrap">
          <div class="pbar"><div class="pbar-fill" style="width:<?= $sp ?>%;background:<?= $fc ?>"></div></div>
          <span class="pct-txt" style="color:<?= $fc ?>"><?= $sp ?>%</span>
        </div>
      </div>

      <?php if (!empty($sec['counts'])): ?>
      <div class="count-grid">
        <?php foreach ($sec['counts'] as $c): ?>
        <div class="count-box <?= $c['cnt']===0?'zero':'' ?>">
          <div class="cv"><?= $c['cnt'] >= 0 ? number_format($c['cnt']) : '?' ?></div>
          <div class="cl"><?= htmlspecialchars($c['lbl']) ?></div>
          <div class="cn"><?= htmlspecialchars($c['note'] ?? '') ?></div>
        </div>
        <?php endforeach; ?>
      </div>
      <?php endif; ?>

      <?php if (!empty($sec['rows'])): ?>
      <table class="check-table">
        <thead>
          <tr>
            <th style="width:35%">รายการที่ต้องจัดทำ</th>
            <th style="width:15%">ทั้งหมด</th>
            <th style="width:15%">สมบูรณ์</th>
            <th style="width:15%">ขาด</th>
            <th style="width:20%">ความสมบูรณ์</th>
          </tr>
        </thead>
        <tbody>
        <?php foreach ($sec['rows'] as $row):
          if ($row['err']): ?>
          <tr class="err-row">
            <td><?= htmlspecialchars($row['lbl']) ?></td>
            <td colspan="4">⚠️ <?= htmlspecialchars(substr($row['err'], 0, 120)) ?></td>
          </tr>
          <?php continue; endif;
          $tot  = $row['tot'];
          if (($sec['hide_zero'] ?? false) && $tot === 0) continue;
          $ok   = $row['ok'];
          $miss = $tot - $ok;
          $pct  = $tot > 0 ? round($ok / $tot * 100) : ($row['skip'] ? 0 : 100);
          $fc2  = pctColor($pct);
          if ($row['info'] ?? false): ?>
          <tr style="background:#f7f9fc;">
            <td>
              <div class="field-lbl" style="color:#7f8c8d;">ℹ️ <?= htmlspecialchars($row['lbl']) ?></div>
              <div class="field-note" style="color:#aaa;">ข้อมูลเสริม — ไม่นับรวมคะแนน</div>
            </td>
            <td class="cnt-0"><?= $tot > 0 ? number_format($tot) : '<span style="color:#bbb">-</span>' ?></td>
            <td style="color:#27ae60;"><?= $tot > 0 ? number_format($ok) : '' ?></td>
            <td style="color:#e74c3c;"><?= $miss > 0 ? number_format($miss) : '' ?></td>
            <td><?php if ($tot > 0): ?><span style="color:#aaa;font-size:18px;"><?= $pct ?>%</span><?php endif; ?></td>
          </tr>
          <?php continue; endif; ?>
          <tr>
            <td>
              <div class="field-lbl"><?= htmlspecialchars($row['lbl']) ?></div>
              <?php if ($row['note']): ?><div class="field-note"><?= htmlspecialchars($row['note']) ?></div><?php endif; ?>
            </td>
            <td class="<?= $tot===0?'cnt-0':'' ?>"><?= $tot > 0 ? number_format($tot) : '<span style="color:#bbb">-</span>' ?></td>
            <td class="<?= $ok>0?'cnt-ok':'cnt-0' ?>"><?= $tot > 0 ? number_format($ok) : '' ?></td>
            <td>
              <?php if ($miss > 0): ?>
                <span class="cnt-miss"><?= number_format($miss) ?></span>
                <?php if (!empty($row['badge'])): ?>
                  <span class="income-badge">income:<?= htmlspecialchars($row['badge']) ?></span>
                <?php endif; ?>
                <button class="detail-btn" onclick="showDetail('<?= htmlspecialchars($row['tbl']??'') ?>','<?= htmlspecialchars($row['col']??'') ?>','<?= htmlspecialchars(addslashes($row['wh']??'1=1')) ?>','<?= htmlspecialchars($row['lbl']) ?>')">
                  ดูรายการ
                </button>
              <?php elseif ($tot > 0): ?>
                <span class="cnt-ok">✓ ครบ</span>
              <?php else: ?>
                <span style="color:#bbb">-</span>
              <?php endif; ?>
            </td>
            <td>
              <?php if ($tot > 0): ?>
              <div style="display:flex;align-items:center;gap:6px;">
                <div class="pbar-sm">
                  <div class="pbar-sm-fill" style="width:<?= $pct ?>%;background:<?= $fc2 ?>"></div>
                </div>
                <span style="font-size:19px;font-weight:600;color:<?= $fc2 ?>"><?= $pct ?>%</span>
              </div>
              <?php else: ?>
                <span style="color:#bbb;font-size:18px;">ไม่มีข้อมูล</span>
              <?php endif; ?>
            </td>
          </tr>
        <?php endforeach; ?>
        </tbody>
      </table>
      <?php endif; ?>
    </div>
  </div>
  <?php endforeach; ?>

</div><!-- /content -->
<?php endif; // if ($pdo && $me) ?>

<?php if (!$pdo): // Not connected - show setup notice ?>
<div class="content" style="max-width:600px;">
  <div class="card" style="margin-top:20px;">
    <?php if ($conn_err): ?>
    <div class="alert-err">❌ เชื่อมต่อฐานข้อมูลไม่ได้: <br><?= htmlspecialchars($conn_err) ?></div>
    <?php else: ?>
    <div class="alert-info">ℹ️ กรุณาตั้งค่าการเชื่อมต่อฐานข้อมูล HOSxP เพื่อเริ่มตรวจสอบ</div>
    <?php endif; ?>
    <button class="btn-primary" onclick="openSetupModal()">
      ⚙️ ตั้งค่าการเชื่อมต่อ HOSxP Database
    </button>
  </div>
</div>
<?php endif; ?>

<!-- Setup Modal -->
<div class="modal-bg" id="setup-modal">
  <div class="modal" style="max-width:480px;">
    <div class="modal-hd">
      <h3>⚙️ ตั้งค่าการเชื่อมต่อฐานข้อมูล</h3>
      <button class="modal-close" onclick="document.getElementById('setup-modal').classList.remove('show')">✕</button>
    </div>
    <div class="modal-body" style="padding:0;">
      <!-- ── รายชื่อ รพ. ── -->
      <div style="padding:16px 24px 0;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;flex-wrap:wrap;gap:6px;">
          <strong style="font-size:13px;">🏥 รายชื่อโรงพยาบาล</strong>
          <div style="display:flex;gap:6px;">
            <button type="button" onclick="downloadHospTemplate()" style="background:#8e44ad;color:#fff;border:none;border-radius:6px;padding:4px 10px;font-size:11px;cursor:pointer;" title="ดาวน์โหลด Template Excel">📥 Template</button>
            <label style="background:#27ae60;color:#fff;border:none;border-radius:6px;padding:4px 10px;font-size:11px;cursor:pointer;" title="นำเข้าจาก Excel">
              📂 Import Excel
              <input type="file" id="excel-import-input" accept=".xlsx,.xls,.csv" style="display:none;" onchange="importHospExcel(this)">
            </label>
            <button type="button" onclick="toggleAddHosp()" style="background:#2980b9;color:#fff;border:none;border-radius:6px;padding:4px 10px;font-size:11px;cursor:pointer;">+ เพิ่ม รพ.</button>
          </div>
        </div>
        <input type="text" id="hosp-search" placeholder="🔍 พิมพ์ชื่อ รพ. เพื่อค้นหา..."
               oninput="filterHospList(this.value)"
               style="width:100%;box-sizing:border-box;padding:7px 12px;border:1px solid #c0d0e0;border-radius:7px;font-size:13px;margin-bottom:6px;">
        <div id="hosp-list" style="max-height:200px;overflow-y:auto;border:1px solid #e0e0e0;border-radius:8px;background:#fafafa;">
          <div style="padding:18px;text-align:center;color:#aaa;font-size:13px;">⏳ กำลังโหลด...</div>
        </div>
      </div>
      <div style="padding:8px 24px 0;display:none;" id="add-hosp-panel">
        <div style="background:#f0f7ff;border:1px solid #c8def5;border-radius:8px;padding:12px 14px;margin-bottom:4px;">
          <div style="font-size:12px;font-weight:600;color:#2980b9;margin-bottom:8px;">📝 บันทึกการตั้งค่าปัจจุบันเป็น รพ. ใหม่</div>
          <div style="display:flex;gap:8px;align-items:center;">
            <input type="text" id="new-hosp-name" placeholder="ชื่อโรงพยาบาล เช่น รพ.สมุทรสาคร"
                   style="flex:1;padding:6px 10px;border:1px solid #c0d8f0;border-radius:6px;font-size:13px;">
            <button type="button" onclick="saveToHospList()"
                    style="background:#27ae60;color:#fff;border:none;border-radius:6px;padding:6px 14px;font-size:12px;cursor:pointer;white-space:nowrap;">💾 บันทึก</button>
          </div>
        </div>
      </div>
      <hr style="margin:12px 0;border:none;border-top:1px solid #eee;">
      <div style="padding:0 24px 24px;">
      <form method="POST" id="cfg-form">
        <input type="hidden" name="action" value="save_cfg">

        <!-- DB Type selector -->
        <div class="form-row">
          <label>ประเภทฐานข้อมูล</label>
          <div class="db-type-row">
            <label class="db-type-opt <?= ($cfg['db_type'] ?? 'mysql') === 'mysql' ? 'active' : '' ?>" id="opt-mysql">
              <input type="radio" name="db_type" value="mysql"
                     <?= ($cfg['db_type'] ?? 'mysql') === 'mysql' ? 'checked' : '' ?>
                     onchange="setDbType('mysql')">
              <span class="db-icon">🐬</span> MySQL / MariaDB
              <small>port 3306</small>
            </label>
            <label class="db-type-opt <?= ($cfg['db_type'] ?? '') === 'pgsql' ? 'active' : '' ?>" id="opt-pgsql">
              <input type="radio" name="db_type" value="pgsql"
                     <?= ($cfg['db_type'] ?? '') === 'pgsql' ? 'checked' : '' ?>
                     onchange="setDbType('pgsql')">
              <span class="db-icon">🐘</span> PostgreSQL
              <small>port 5432</small>
            </label>
          </div>
        </div>

        <div class="form-row-2 form-row">
          <div>
            <label>Database Host</label>
            <input type="text" name="host" id="cfg-host"
                   value="<?= htmlspecialchars($cfg['host'] ?? 'localhost') ?>" placeholder="localhost" required>
          </div>
          <div>
            <label>Port</label>
            <input type="number" name="port" id="cfg-port"
                   value="<?= htmlspecialchars($cfg['port'] ?? '3306') ?>" placeholder="3306">
          </div>
        </div>
        <div class="form-row">
          <label>ชื่อฐานข้อมูล (Database Name)</label>
          <input type="text" name="db" value="<?= htmlspecialchars($cfg['db'] ?? '') ?>" placeholder="hosxp_pcu" required>
        </div>
        <div class="form-row">
          <label>Username</label>
          <input type="text" name="user" value="<?= htmlspecialchars($cfg['user'] ?? 'hosxp') ?>" placeholder="hosxp" required>
        </div>
        <div class="form-row">
          <label>Password</label>
          <input type="password" name="pass" value="<?= htmlspecialchars($cfg['pass'] ?? '') ?>" placeholder="(ถ้ามี)">
        </div>
        <div id="conn-status" style="display:none;margin-bottom:10px;padding:10px 12px;border-radius:8px;font-size:13px;line-height:1.5;"></div>
        <div style="display:grid;grid-template-columns:1fr auto;gap:8px;">
          <button type="submit" class="btn-primary">💾 บันทึกและเชื่อมต่อ</button>
          <button type="button" class="btn-t gray" style="padding:8px 14px;white-space:nowrap;" onclick="testConn()">🔌 ทดสอบ</button>
        </div>
      </form>
      <?php if ($cfg): ?>
      <form method="POST" style="margin-top:10px;">
        <input type="hidden" name="action" value="reset_cfg">
        <button type="submit" class="btn-t red" style="width:100%;padding:8px;" onclick="return confirm('ลบการตั้งค่า?')">🗑️ ลบการตั้งค่าและเริ่มใหม่</button>
      </form>
      <?php endif; ?>
      </div><!-- end inner padding -->
    </div>
  </div>
</div>

<!-- Detail Modal -->
<div class="modal-bg" id="detail-modal">
  <div class="modal">
    <div class="modal-hd">
      <h3 id="detail-title">รายการที่ข้อมูลไม่สมบูรณ์</h3>
      <div style="display:flex;gap:8px;align-items:center;">
        <button id="export-detail-btn" onclick="exportDetailCSV()" style="display:none;padding:6px 14px;background:#27ae60;color:#fff;border:none;border-radius:6px;font-size:14px;cursor:pointer;font-family:inherit;">⬇ ส่งออก Excel</button>
        <button class="modal-close" onclick="document.getElementById('detail-modal').classList.remove('show')">✕</button>
      </div>
    </div>
    <div class="modal-body" id="detail-body">
      <div class="loading">กำลังโหลด...</div>
    </div>
    <div class="modal-count" id="detail-count"></div>
  </div>
</div>

<script>
// ── DB type selector ──────────────────────────────────────
function setDbType(type) {
  document.querySelectorAll('.db-type-opt').forEach(el => el.classList.remove('active'));
  document.getElementById('opt-' + type)?.classList.add('active');
  const port = document.getElementById('cfg-port');
  const defaultPorts = { mysql: '3306', pgsql: '5432' };
  if (port && (port.value === '3306' || port.value === '5432' || port.value === '')) {
    port.value = defaultPorts[type] || '3306';
  }
}

// ── Copy Setup Link ───────────────────────────────────────
function copySetupLink() {
  <?php
  $setupToken = base64_encode(json_encode([
      'db_type' => $cfg['db_type'] ?? 'mysql',
      'host'    => $cfg['host']    ?? '',
      'port'    => $cfg['port']    ?? 3306,
      'db'      => $cfg['db']      ?? '',
      'user'    => $cfg['user']    ?? '',
      'pass'    => $cfg['pass']    ?? '',
  ]));
  ?>
  const token = <?= json_encode($setupToken) ?>;
  const url = location.protocol + '//' + location.host + location.pathname + '?setup=' + token;
  navigator.clipboard.writeText(url).then(() => {
    alert('✅ คัดลอก Setup Link แล้ว!\n\nส่งลิงค์นี้ให้เครื่องอื่น:\n' + url);
  }).catch(() => {
    prompt('คัดลอกลิงค์นี้:', url);
  });
}

// ── Test DB connection ────────────────────────────────────
async function testConn() {
  const form = document.getElementById('cfg-form');
  const data = new FormData(form);
  const statusEl = document.getElementById('conn-status');
  statusEl.style.display = 'block';
  statusEl.style.background = '#f0f3fa';
  statusEl.style.border = '1px solid #c8d0e0';
  statusEl.style.color = '#555';
  statusEl.innerHTML = '⏳ กำลังทดสอบการเชื่อมต่อ...';
  try {
    const res = await fetch('?test_conn=1', { method: 'POST', body: data });
    const json = await res.json();
    if (json.ok) {
      statusEl.style.background = '#eafaf1';
      statusEl.style.border = '1px solid #a9dfbf';
      statusEl.style.color = '#1e8449';
      statusEl.innerHTML = `✅ <strong>เชื่อมต่อสำเร็จ</strong> · ${json.host}/${json.db}<br>
        <small>พบตาราง: ${json.tables_found.length > 0 ? json.tables_found.join(', ') : '(ไม่พบ)'}</small>`;
    } else {
      statusEl.style.background = '#fdf2f2';
      statusEl.style.border = '1px solid #f5b7b1';
      statusEl.style.color = '#c0392b';
      statusEl.innerHTML = `❌ <strong>เชื่อมต่อไม่ได้</strong><br><small>${json.msg}</small>`;
    }
  } catch(e) {
    statusEl.style.background = '#fdf2f2';
    statusEl.style.border = '1px solid #f5b7b1';
    statusEl.style.color = '#c0392b';
    statusEl.innerHTML = `❌ <strong>เกิดข้อผิดพลาด</strong><br><small>${e}</small>`;
  }
}

// ── Tab switching ──────────────────────────────────────────
function switchTab(id) {
  document.querySelectorAll('.tab-a').forEach(a => a.classList.remove('active'));
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
  const a = document.querySelector(`.tab-a[data-tab="${id}"]`);
  const p = document.getElementById(id);
  if (a) { a.classList.add('active'); a.scrollIntoView({inline:'center',behavior:'smooth'}); }
  if (p) p.classList.add('active');
  history.pushState(null, '', '#' + id);
}

window.addEventListener('hashchange', () => {
  const h = location.hash.replace('#','');
  if (h && document.getElementById(h)) switchTab(h);
});
const initH = location.hash.replace('#','');
if (initH && document.getElementById(initH)) switchTab(initH);

// ── Detail modal ───────────────────────────────────────────
let _detailRows = [];
let _detailLbl  = '';

function exportDetailCSV() {
  if (!_detailRows.length) return;
  const cols = Object.keys(_detailRows[0]);
  const esc  = v => '"' + String(v === null ? '' : v).replace(/"/g, '""') + '"';
  let csv = '﻿'; // UTF-8 BOM ให้ Excel อ่านภาษาไทยได้
  csv += cols.map(esc).join(',') + '\r\n';
  _detailRows.forEach(row => { csv += cols.map(c => esc(row[c])).join(',') + '\r\n'; });
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = (_detailLbl || 'export') + '.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function showDetail(tbl, col, wh, lbl) {
  if (!tbl || !col) return;
  const colDisplay = col === '_raw_' ? tbl : `${tbl}.${col}`;
  document.getElementById('detail-title').textContent = `รายการที่ขาด: ${lbl} (${colDisplay})`;
  document.getElementById('detail-body').innerHTML = '<div class="loading">⏳ กำลังโหลด...</div>';
  document.getElementById('detail-count').textContent = '';
  document.getElementById('export-detail-btn').style.display = 'none';
  _detailRows = [];
  _detailLbl  = lbl;
  document.getElementById('detail-modal').classList.add('show');

  fetch(`?detail=1&tbl=${encodeURIComponent(tbl)}&col=${encodeURIComponent(col)}&wh=${encodeURIComponent(wh)}`)
    .then(r => r.json())
    .then(data => {
      if (data.error) {
        document.getElementById('detail-body').innerHTML = `<div class="loading" style="color:#e74c3c">❌ ${data.error}</div>`;
        return;
      }
      if (!data.rows || data.rows.length === 0) {
        document.getElementById('detail-body').innerHTML = '<div class="loading" style="color:#27ae60">✓ ไม่พบรายการที่ขาด</div>';
        return;
      }
      _detailRows = data.rows;
      document.getElementById('export-detail-btn').style.display = 'inline-block';
      const cols = Object.keys(data.rows[0]);
      let html = '<table class="modal-table"><thead><tr>';
      cols.forEach(c => { html += `<th>${c}</th>`; });
      html += '</tr></thead><tbody>';
      data.rows.forEach(row => {
        html += '<tr>';
        cols.forEach(c => {
          const v = row[c];
          const empty = v === null || v === '' || v === '0000-00-00';
          html += `<td style="${empty&&c===col?'background:#fde8e8;color:#e74c3c;font-weight:600':''}">${v === null ? '<em style="color:#bbb">NULL</em>' : String(v).substring(0,80)}</td>`;
        });
        html += '</tr>';
      });
      html += '</tbody></table>';
      document.getElementById('detail-body').innerHTML = html;
      document.getElementById('detail-count').textContent =
        `แสดง ${data.rows.length} รายการที่ขาดข้อมูลใน ${col}${data.rows.length>=150?' (จำกัด 150 แถว)':''}`;
    })
    .catch(e => {
      document.getElementById('detail-body').innerHTML = `<div class="loading" style="color:#e74c3c">❌ ${e}</div>`;
    });
}

// ── Hospital list ────────────────────────────────────────────
let _hospAll = [];
function openSetupModal() {
  document.getElementById('setup-modal').classList.add('show');
  loadHospList();
}
function renderHospList(list) {
  const el = document.getElementById('hosp-list');
  if (!list || !list.length) {
    el.innerHTML = '<div style="padding:18px;text-align:center;color:#aaa;font-size:13px;">ไม่พบรายชื่อ รพ. ครับ</div>';
    return;
  }
  el.innerHTML = list.map(h => `
    <div style="display:flex;align-items:center;gap:6px;padding:7px 12px;border-bottom:1px solid #eee;font-size:13px;">
      <span style="flex:1;font-weight:500;">${h.name || h.host}</span>
      <span style="color:#aaa;font-size:10px;white-space:nowrap;">${(h.db_type||'pgsql').toUpperCase()}${h.host?' · '+h.host:''}</span>
      <button onclick="selectHosp(${JSON.stringify(h).replace(/"/g,'&quot;')})"
              style="background:#2980b9;color:#fff;border:none;border-radius:5px;padding:3px 10px;font-size:11px;cursor:pointer;white-space:nowrap;">เลือก</button>
      <button onclick="deleteHosp('${h.id}')"
              style="background:#e74c3c;color:#fff;border:none;border-radius:5px;padding:3px 8px;font-size:11px;cursor:pointer;">ลบ</button>
    </div>`).join('');
}
function loadHospList() {
  fetch('?hospitals_list=1')
    .then(r => r.text())
    .then(txt => {
      let list;
      try { list = JSON.parse(txt); } catch(e) {
        const el = document.getElementById('hosp-list');
        if (el) el.innerHTML = '<div style="padding:14px;text-align:center;color:#e74c3c;font-size:12px;">⚠️ โหลดรายชื่อไม่ได้<br><small>' + txt.slice(0,100) + '</small></div>';
        return;
      }
      _hospAll = list || [];
      const q = (document.getElementById('hosp-search')?.value || '').trim();
      renderHospList(q ? _hospAll.filter(h=>(h.name||'').includes(q)) : _hospAll);
    })
    .catch(() => {
      const el = document.getElementById('hosp-list');
      if (el) el.innerHTML = '<div style="padding:14px;text-align:center;color:#e74c3c;font-size:12px;">⚠️ เชื่อมต่อไม่ได้ กรุณา refresh ครับ</div>';
    });
}
function filterHospList(q) {
  const filtered = q ? _hospAll.filter(h => (h.name||'').toLowerCase().includes(q.toLowerCase())) : _hospAll;
  renderHospList(filtered);
}
function selectHosp(h) {
  document.querySelector('[name=db_type][value='+h.db_type+']').click();
  document.getElementById('cfg-host').value = h.host;
  document.getElementById('cfg-port').value = h.port;
  document.querySelector('[name=db]').value   = h.db;
  document.querySelector('[name=user]').value = h.user;
  document.querySelector('[name=pass]').value = h.pass;
  document.getElementById('new-hosp-name').value = h.name;
  // scroll to form
  document.getElementById('cfg-form').scrollIntoView({behavior:'smooth'});
}
function deleteHosp(id) {
  if (!confirm('ลบ รพ. นี้ออกจากรายชื่อ?')) return;
  const fd = new FormData();
  fd.append('action','hospital_delete'); fd.append('hid', id);
  fetch('', {method:'POST', body:fd}).then(()=>loadHospList());
}
function saveToHospList() {
  const name = document.getElementById('new-hosp-name').value.trim();
  if (!name) { alert('กรุณาระบุชื่อโรงพยาบาลครับ'); return; }
  const fd = new FormData();
  fd.append('action','hospital_save');
  fd.append('hname', name);
  fd.append('db_type', document.querySelector('[name=db_type]:checked')?.value || 'mysql');
  fd.append('host', document.getElementById('cfg-host').value);
  fd.append('port', document.getElementById('cfg-port').value);
  fd.append('db',   document.querySelector('[name=db]').value);
  fd.append('user', document.querySelector('[name=user]').value);
  fd.append('pass', document.querySelector('[name=pass]').value);
  fetch('', {method:'POST', body:fd}).then(r=>r.json()).then(res => {
    if (res.ok) { loadHospList(); toggleAddHosp(false); alert('บันทึกเรียบร้อยครับ ✓'); }
  });
}
function toggleAddHosp(forceState) {
  const p = document.getElementById('add-hosp-panel');
  const show = forceState !== undefined ? forceState : p.style.display === 'none';
  p.style.display = show ? 'block' : 'none';
}

// ── Excel Import / Template ──────────────────────────────────
function downloadHospTemplate() {
  if (typeof XLSX === 'undefined') { alert('กรุณารอโหลด SheetJS ก่อนครับ'); return; }
  const ws = XLSX.utils.aoa_to_sheet([
    ['ชื่อโรงพยาบาล','db_type','host','port','database','username','password'],
    ['รพ.ตัวอย่าง MySQL','mysql','192.168.1.1','3306','hdy_hosxe','hosxp','password'],
    ['รพ.ตัวอย่าง PostgreSQL','pgsql','192.168.1.2','5432','hdy_hosxe','hosxp','password'],
  ]);
  ws['!cols'] = [22,8,16,6,14,12,12].map(w=>({wch:w}));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Hospitals');
  XLSX.writeFile(wb, 'hospital_list_template.xlsx');
}

function importHospExcel(input) {
  const file = input.files[0]; if (!file) return;
  if (typeof XLSX === 'undefined') { alert('กรุณารอโหลด SheetJS ก่อนครับ'); return; }
  const reader = new FileReader();
  reader.onload = async e => {
    const wb   = XLSX.read(e.target.result, {type:'array'});
    const ws   = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, {defval:''});
    if (!rows.length) { alert('ไม่พบข้อมูลในไฟล์ครับ'); return; }

    const mapCol = (row, keys) => {
      for (const k of keys)
        for (const rk of Object.keys(row))
          if (rk.toLowerCase().replace(/\s/g,'') === k.toLowerCase().replace(/\s/g,''))
            return String(row[rk] ?? '').trim();
      return '';
    };

    const entries = rows.map(r => ({
      name:     mapCol(r, ['name','ชื่อโรงพยาบาล','ชื่อ','hospital']),
      hospcode: mapCol(r, ['hospcode','รหัสรพ.','รหัส']),
      db_type:  mapCol(r, ['db_type','type','ประเภท']) || 'pgsql',
      host:     mapCol(r, ['host','ip','server','เซิร์ฟเวอร์']) || '',
      port:     mapCol(r, ['port','พอร์ต']) || '5432',
      db:       mapCol(r, ['database','db','ฐานข้อมูล']) || '',
      user:     mapCol(r, ['username','user','ผู้ใช้']) || '',
      pass:     mapCol(r, ['password','pass','รหัสผ่าน']) || '',
    })).filter(r => r.name);

    if (!entries.length) { alert('ไม่พบข้อมูลที่ใช้งานได้ครับ'); return; }

    // แสดง preview ก่อน import
    const preview = entries.slice(0,5).map(h=>`• ${h.name} ${h.hospcode ? '('+h.hospcode+')':''}`).join('\n');
    const more = entries.length > 5 ? `\n... และอีก ${entries.length-5} รพ.` : '';
    if (!confirm(`พบข้อมูล ${entries.length} รพ.\n\n${preview}${more}\n\n⚠️ host/db/user/pass จะว่างไว้ก่อน\nกรอกทีหลังได้โดยกด "เลือก" แต่ละ รพ.\n\nนำเข้าทั้งหมดไหมครับ?`)) return;

    let ok = 0;
    for (const h of entries) {
      const fd = new FormData();
      fd.append('action','hospital_save');
      fd.append('hname',   h.hospcode ? `[${h.hospcode}] ${h.name}` : h.name);
      fd.append('db_type', ['mysql','pgsql'].includes(h.db_type) ? h.db_type : 'pgsql');
      fd.append('host', h.host); fd.append('port', h.port);
      fd.append('db',   h.db);  fd.append('user', h.user);
      fd.append('pass', h.pass);
      const res = await fetch('', {method:'POST', body:fd}).then(r=>r.json()).catch(()=>null);
      if (res?.ok) ok++;
    }
    input.value = '';
    loadHospList();
    alert(`นำเข้าสำเร็จ ${ok}/${entries.length} รพ. ครับ ✓\n\nกด "เลือก" แต่ละ รพ. เพื่อกรอก host/db/user/pass ครับ`);
  };
  reader.readAsArrayBuffer(file);
}

// Close modals on background click
['setup-modal','detail-modal'].forEach(id => {
  document.getElementById(id).addEventListener('click', function(e) {
    if (e.target === this) this.classList.remove('show');
  });
});

// ── Export CSV ─────────────────────────────────────────────
function exportCSV() {
  const rows = [['Section','Field','Total','OK','Missing','Pct%']];
  document.querySelectorAll('.check-table').forEach(tbl => {
    const sec = tbl.closest('.tab-pane')?.id || '';
    tbl.querySelectorAll('tbody tr').forEach(tr => {
      const cells = tr.querySelectorAll('td');
      if (cells.length >= 5) {
        rows.push([sec, cells[0].textContent.trim(), cells[1].textContent.trim(),
          cells[2].textContent.trim(), cells[3].textContent.trim().replace(/ดูรายการ/,'').trim(), '']);
      }
    });
  });
  const csv = rows.map(r => r.map(v => `"${v.replace(/"/g,'""')}"`).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,\uFEFF' + encodeURIComponent(csv);
  a.download = 'hosxp_completeness_' + new Date().toISOString().slice(0,10) + '.csv';
  a.click();
}

// ── Auto-show setup if not connected ──────────────────────
<?php if (!$pdo && !$conn_err): ?>
window.onload = () => openSetupModal();
<?php endif; ?>
</script>
<script src="https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js"></script>
</body>
</html>
