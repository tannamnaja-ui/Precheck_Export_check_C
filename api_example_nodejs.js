// ============================================================
// Backend API Example (Node.js + Express)
// ============================================================
// คุณต้องติดตั้ง dependencies ก่อน:
// npm install express mysql2 pg cors
//
// วิธีรัน:
// node api_example_nodejs.js
// ============================================================

const express = require('express');
const _mysqlBase = require('mysql2/promise');
// Wrap createConnection to always use dateStrings:true — prevents DATE columns from
// being returned as JS Date objects which shift by timezone offset in JSON.stringify
const mysql = {
    ..._mysqlBase,
    createConnection: (cfg) => _mysqlBase.createConnection({ dateStrings: true, ...cfg })
};
const { Client: PgClient } = require('pg');
// pg คืนคอลัมน์ DATE/TIMESTAMP เป็น JS Date ที่เที่ยงคืนตามเวลาเครื่อง
// พอ JSON.stringify จะกลายเป็น ISO แบบ UTC ซึ่งไทยเป็น UTC+7 จึงถอยไป 1 วันเสมอ
// (เช่น 2026-09-16 -> "2026-09-15T17:00:00.000Z")
// ให้คืนเป็นข้อความดิบจากฐานข้อมูลแทน เทียบเท่า dateStrings:true ของฝั่ง mysql2
const _pgTypes = require('pg').types;
_pgTypes.setTypeParser(1082, v => v);   // date
_pgTypes.setTypeParser(1114, v => v);   // timestamp without time zone
_pgTypes.setTypeParser(1184, v => v);   // timestamp with time zone
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const PORT = 3002;

// When running as pkg .exe, serve HTML files from same folder as the .exe
// When running as node, serve from current directory
const staticDir = process.pkg ? path.dirname(process.execPath) : __dirname;

// Middleware
app.use(cors());
// limit เผื่อไว้ — body ที่เข้ารหัสแล้วโตกว่าเดิมราว 35% (base64 + GCM tag)
app.use(express.json({ limit: '25mb' }));

// ============================================================================
// Security layer — API token + payload encryption
// ----------------------------------------------------------------------------
//  - token รูปแบบ <รหัสสถานพยาบาล><สุ่ม 10 หลัก> gen ที่หน้าการเชื่อมต่อ
//    เก็บเป็นไฟล์ preex-token.json ข้าง server.exe (service รันเป็น LocalSystem
//    จึงเขียนไฟล์ใน Program Files ได้)
//  - ทุก endpoint ยกเว้น bootstrap ต้องส่ง header X-PreEX-Token ให้ตรง
//    ไม่งั้นตอบ 401 (คนก๊อป URL ไปยิง Postman เปล่า ๆ จะไม่ได้ข้อมูล)
//  - payload เข้ารหัส AES-256-GCM ด้วย key = SHA-256(token) ทั้งขาไปและขากลับ
//    ฝั่งหน้าเว็บถอดให้อัตโนมัติใน api_guard.js จอจึงแสดงผลปกติ
// ============================================================================

const TOKEN_FILE = path.join(staticDir, 'preex-token.json');
const TOKEN_HEADER = 'x-preex-token';

// endpoint ที่ต้องเรียกได้ก่อนมี token (ใช้ตั้งค่า/ล็อกอิน/gen token)
// ทั้งหมดต้องแนบ user+password ฐานข้อมูลมาใน body อยู่แล้ว จึงไม่ได้เปิดโล่ง
const OPEN_ENDPOINTS = new Set([
    '/test-connection',
    '/get-hospital-name',
    '/login',
    '/bms-session-login',
    '/generate-token',
    '/token-status',
    '/shutdown'
]);

function readToken() {
    try {
        const obj = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
        return (obj && typeof obj.token === 'string' && obj.token) ? obj : null;
    } catch (e) {
        return null;
    }
}

function writeToken(obj) {
    fs.writeFileSync(TOKEN_FILE, JSON.stringify(obj, null, 2), 'utf8');
}

// สุ่ม 10 หลัก ตัดตัวที่สับสนออก (I, O, 0, 1)
function randomSuffix(len) {
    const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const bytes = crypto.randomBytes(len);
    let out = '';
    for (let i = 0; i < len; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
    return out;
}

function keyFromToken(token) {
    return crypto.createHash('sha256').update(token, 'utf8').digest();
}

function encryptPayload(plainObj, token) {
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', keyFromToken(token), iv);
    const data = Buffer.concat([c.update(JSON.stringify(plainObj), 'utf8'), c.final()]);
    return { __enc: 1, iv: iv.toString('hex'), data: data.toString('base64'), tag: c.getAuthTag().toString('hex') };
}

function decryptPayload(env, token) {
    const d = crypto.createDecipheriv('aes-256-gcm', keyFromToken(token), Buffer.from(env.iv, 'hex'));
    d.setAuthTag(Buffer.from(env.tag, 'hex'));
    const out = Buffer.concat([d.update(Buffer.from(env.data, 'base64')), d.final()]);
    return JSON.parse(out.toString('utf8'));
}

// ---------------------------------------------------------------- middleware
app.use('/api', (req, res, next) => {
    const stored = readToken();

    // ยังไม่เคย gen token -> ปล่อยผ่านทั้งหมด เพื่อให้เครื่องที่อัปเกรดมายังใช้ได้
    // จนกว่าจะไปกด "สร้าง Token" ที่หน้าการเชื่อมต่อ
    if (!stored) return next();

    const isOpen = OPEN_ENDPOINTS.has(req.path);
    const sent = req.get(TOKEN_HEADER);
    const authed = !!sent && sent === stored.token;

    if (!isOpen && !authed) {
        return res.status(401).json({
            success: false,
            error: 'unauthorized: ต้องแนบ header X-PreEX-Token ที่ถูกต้อง'
        });
    }

    const encryptedBody = !!(req.body && req.body.__enc === 1);

    // bootstrap endpoint ก็ถูกเข้ารหัสมาด้วยถ้าเครื่องนั้นมี token แล้ว
    // จึงต้องถอดตรงนี้เหมือนกัน ไม่งั้น endpoint จะได้ body เป็น envelope เปล่า ๆ
    if (encryptedBody) {
        if (!authed) {
            return res.status(400).json({
                success: false,
                error: 'body ถูกเข้ารหัสแต่ token ไม่ถูกต้อง จึงถอดรหัสไม่ได้'
            });
        }
        try {
            req.body = decryptPayload(req.body, stored.token);
        } catch (e) {
            return res.status(400).json({ success: false, error: 'decrypt failed' });
        }
        // ขากลับก็เข้ารหัสด้วย key เดียวกัน
        const origJson = res.json.bind(res);
        res.json = (payload) => origJson(encryptPayload(payload, stored.token));
    }
    next();
});

// ------------------------------------------------------------- token endpoints

// มี token อยู่แล้วหรือยัง (ไม่คืนค่า token เต็ม)
app.post('/api/token-status', (req, res) => {
    const stored = readToken();
    if (!stored) return res.json({ success: true, configured: false });
    res.json({
        success: true,
        configured: true,
        hospitalCode: stored.hospitalCode || '',
        masked: stored.token.slice(0, 5) + '*'.repeat(Math.max(0, stored.token.length - 5)),
        createdAt: stored.createdAt || ''
    });
});

// สร้าง token ใหม่ — อ่านรหัสสถานพยาบาลจาก opdconfig แล้วต่อด้วยสุ่ม 10 หลัก
app.post('/api/generate-token', async (req, res) => {
    try {
        const { host, port, database, user, password, type } = req.body;
        let hospitalCode = '', hospitalName = '';

        if (type === 'postgresql') {
            const client = new PgClient({ host, port, user, password, database, connectionTimeoutMillis: 5000 });
            await client.connect();
            const r = await client.query('SELECT hospitalcode, hospitalname FROM opdconfig LIMIT 1');
            await client.end();
            if (r.rows.length) { hospitalCode = r.rows[0].hospitalcode || ''; hospitalName = r.rows[0].hospitalname || ''; }
        } else {
            const conn = await mysql.createConnection({ host, port, user, password, database, connectTimeout: 5000 });
            const [rows] = await conn.execute('SELECT hospitalcode, hospitalname FROM opdconfig LIMIT 1');
            await conn.end();
            if (rows.length) { hospitalCode = rows[0].hospitalcode || ''; hospitalName = rows[0].hospitalname || ''; }
        }

        hospitalCode = String(hospitalCode).trim();
        if (!hospitalCode) {
            return res.json({ success: false, error: 'อ่านรหัสสถานพยาบาลจากตาราง opdconfig ไม่ได้' });
        }

        const token = hospitalCode + randomSuffix(10);
        writeToken({ token, hospitalCode, hospitalName, createdAt: new Date().toISOString() });
        res.json({ success: true, token, hospitalCode, hospitalName });
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

// ------------------------------------------------------------ BMS session login

// ยืนยัน BMS Session ID กับ HOSxP แล้วคืนข้อมูลผู้ใช้
// ทำฝั่ง server เพื่อเลี่ยงปัญหา CORS ของ hosxp.net
app.post('/api/bms-session-login', async (req, res) => {
    try {
        const sessionId = String((req.body && req.body.sessionId) || '').trim();
        if (!sessionId) return res.json({ success: false, error: 'ไม่พบ BMS Session ID' });

        const url = `https://hosxp.net/phapi/PasteJSON?Action=GET&code=${encodeURIComponent(sessionId)}`;
        const ctrl = new AbortController();
        const tid = setTimeout(() => ctrl.abort(), 15000);
        let data;
        try {
            const r = await fetch(url, {
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                signal: ctrl.signal
            });
            data = await r.json();
        } finally {
            clearTimeout(tid);
        }

        if (!data || data.MessageCode !== 200) {
            const code = data ? data.MessageCode : 'n/a';
            const msg = (code === 500)
                ? 'BMS Session หมดอายุแล้ว กรุณา login ใหม่จาก HOSxP'
                : `ยืนยัน BMS Session ไม่สำเร็จ (MessageCode: ${code})`;
            return res.json({ success: false, error: msg, messageCode: code });
        }

        const ui = (data.result && data.result.user_info) || {};
        const kv = (data.result && data.result.key_value) || {};
        res.json({
            success: true,
            name: ui.name || '',
            location: ui.location || '',
            doctorCode: ui.doctor_code || '',
            apiUrl: kv['hosxp.api_url'] || ui['hosxp.api_url'] || ui.bms_url || '',
            hasAuthKey: !!(kv['hosxp.api_auth_key'] || ui['hosxp.api_auth_key'] || ui.bms_session_code)
        });
    } catch (error) {
        res.json({ success: false, error: 'เชื่อมต่อ hosxp.net ไม่ได้: ' + error.message });
    }
});

// Redirect finance_first.html to new finance dashboard
app.get('/finance_first.html', (req, res) => {
    res.redirect('/new_finance_dashboard/');
});

// Redirect basic_data.html to hosxp_checker
app.get('/basic_data.html', (req, res) => {
    res.redirect('/hosxp_checker/index.html');
});

// Serve new finance dashboard (React build) under /new_finance_dashboard/
const dashboardDist = process.pkg
    ? path.join(path.dirname(process.execPath), 'new_finance_dashboard', 'dist')
    : path.join(__dirname, 'new_finance_dashboard', 'dist');
app.use('/new_finance_dashboard', express.static(dashboardDist));
app.use('/new_finance_dashboard', (req, res) => {
    res.sendFile(path.join(dashboardDist, 'index.html'));
});

app.use(express.static(staticDir, {
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-store');
    }
}));

// Helper: build hipdata_code filter (FDH uses UCS+WEL)
function hipdataFilter(code) {
    if (code === 'FDH') return `hipdata_code IN ('UCS','WEL')`;
    if (code === 'ECLAIM') return `hipdata_code IN ('UCS','WEL','LGO','OFC','STP','')`;
    return `hipdata_code='${code}'`;
}

// ==================== API Endpoints ====================

// 1. ทดสอบการเชื่อมต่อฐานข้อมูล
app.post('/api/test-connection', async (req, res) => {
    try {
        const { host, port, database, user, password, type } = req.body;

        if (type === 'postgresql') {
            // PostgreSQL Connection
            const client = new PgClient({
                host: host,
                port: port,
                user: user,
                password: password,
                database: database,
                connectionTimeoutMillis: 5000 // 5 second timeout
            });

            await client.connect();
            await client.query('SELECT 1'); // Simple test query
            await client.end();

            res.json({
                success: true,
                message: 'เชื่อมต่อฐานข้อมูล PostgreSQL สำเร็จ'
            });
        } else {
            // MySQL Connection (default)
            const connection = await mysql.createConnection({
                host: host,
                port: port,
                user: user,
                password: password,
                database: database,
                connectTimeout: 5000 // 5 second timeout
            });

            await connection.ping();
            await connection.end();

            res.json({
                success: true,
                message: 'เชื่อมต่อฐานข้อมูล MySQL สำเร็จ'
            });
        }

    } catch (error) {
        console.error('Connection error:', error);
        res.json({
            success: false,
            error: error.message
        });
    }
});

// 2. ดึงชื่อโรงพยาบาลจาก opdconfig
app.post('/api/get-hospital-name', async (req, res) => {
    try {
        const { host, port, database, user, password, type } = req.body;

        if (type === 'postgresql') {
            // PostgreSQL
            const client = new PgClient({
                host: host,
                port: port,
                user: user,
                password: password,
                database: database,
                connectionTimeoutMillis: 5000
            });

            await client.connect();
            const result = await client.query('SELECT hospitalname FROM opdconfig LIMIT 1');
            await client.end();

            if (result.rows.length > 0) {
                res.json({
                    success: true,
                    hospitalname: result.rows[0].hospitalname
                });
            } else {
                res.json({
                    success: false,
                    error: 'ไม่พบข้อมูลในตาราง opdconfig'
                });
            }
        } else {
            // MySQL
            const connection = await mysql.createConnection({
                host: host,
                port: port,
                user: user,
                password: password,
                database: database,
                connectTimeout: 5000
            });

            const [rows] = await connection.execute(
                'SELECT hospitalname FROM opdconfig LIMIT 1'
            );

            await connection.end();

            if (rows.length > 0) {
                res.json({
                    success: true,
                    hospitalname: rows[0].hospitalname
                });
            } else {
                res.json({
                    success: false,
                    error: 'ไม่พบข้อมูลในตาราง opdconfig'
                });
            }
        }

    } catch (error) {
        console.error('Query error:', error);
        res.json({
            success: false,
            error: error.message
        });
    }
});

// 3. ดึงรายการสิทธิการรักษา (pttype)
app.post('/api/get-pttype-list', async (req, res) => {
    try {
        const { host, port, database, user, password, type, hipdata_code, hipdata_codes } = req.body;

        // Support single hipdata_code or multiple hipdata_codes array
        const codesArray = hipdata_codes && Array.isArray(hipdata_codes) && hipdata_codes.length > 0
            ? hipdata_codes
            : [hipdata_code || 'SSS'];

        if (type === 'postgresql') {
            // PostgreSQL
            const client = new PgClient({
                host: host,
                port: port,
                user: user,
                password: password,
                database: database,
                connectionTimeoutMillis: 5000
            });

            await client.connect();
            const placeholders = codesArray.map((_, i) => `$${i + 1}`).join(',');
            const result = await client.query(
                `SELECT p.pttype, p.name FROM pttype p WHERE p.isuse='Y' AND p.hipdata_code IN (${placeholders}) ORDER BY p.pttype`,
                codesArray
            );
            await client.end();

            res.json({
                success: true,
                data: result.rows
            });
        } else {
            // MySQL
            const connection = await mysql.createConnection({
                host: host,
                port: port,
                user: user,
                password: password,
                database: database,
                connectTimeout: 5000
            });

            const placeholders = codesArray.map(() => '?').join(',');
            const [rows] = await connection.execute(
                `SELECT p.pttype, p.name FROM pttype p WHERE p.isuse='Y' AND p.hipdata_code IN (${placeholders}) ORDER BY p.pttype`,
                codesArray
            );

            await connection.end();

            res.json({
                success: true,
                data: rows
            });
        }

    } catch (error) {
        console.error('Query error:', error);
        res.json({
            success: false,
            error: error.message
        });
    }
});

// 4. ดึงข้อมูลผู้ป่วยตามช่วงวันที่
app.post('/api/get-patient-data', async (req, res) => {
    try {
        const { host, port, database, user, password, fundType, dateFrom, dateTo } = req.body;

        const connection = await mysql.createConnection({
            host: host,
            port: port,
            user: user,
            password: password,
            database: database
        });

        // ตัวอย่าง Query (ปรับให้เหมาะกับโครงสร้างฐานข้อมูลของคุณ)
        const query = `
            SELECT
                hn,
                CONCAT(pname, fname, ' ', lname) as patient_name,
                vstdate as visit_date,
                income as amount,
                status
            FROM ovst
            WHERE vstdate BETWEEN ? AND ?
            LIMIT 100
        `;

        const [rows] = await connection.execute(query, [dateFrom, dateTo]);
        await connection.end();

        res.json({
            success: true,
            data: rows,
            count: rows.length
        });

    } catch (error) {
        console.error('Query error:', error);
        res.json({
            success: false,
            error: error.message
        });
    }
});

// 4. ดึงสถิติข้อมูล (Dashboard)
app.post('/api/get-statistics', async (req, res) => {
    try {
        const { host, port, database, user, password, fundType, dateFrom, dateTo, selectedPttypes, type, hipdata_code } = req.body;

        // Default to 'SSS' if not provided
        const hipdataCode = hipdata_code || 'SSS';

        // Build the WHERE clause for pttype
        let pttypeCondition = '';
        if (selectedPttypes && selectedPttypes.length > 0) {
            // If specific pttypes are selected
            const pttypeList = selectedPttypes.map(pt => `'${pt}'`).join(',');
            pttypeCondition = `AND pttype IN (${pttypeList})`;
        } else {
            // If no specific selection, use all pttypes for this hipdata_code
            pttypeCondition = `AND pttype IN (SELECT p.pttype FROM pttype p WHERE p.isuse='Y' AND ${hipdataFilter(hipdataCode)})`;
        }

        if (type === 'postgresql') {
            // PostgreSQL
            const client = new PgClient({
                host: host,
                port: port,
                user: user,
                password: password,
                database: database,
                connectionTimeoutMillis: 5000
            });

            await client.connect();

            const query = `
                SELECT COUNT(vn) as total
                FROM ovst
                WHERE vstdate BETWEEN $1 AND $2
                ${pttypeCondition}
            `;

            const result = await client.query(query, [dateFrom, dateTo]);
            await client.end();

            res.json({
                success: true,
                stats: {
                    total: parseInt(result.rows[0].total) || 0,
                    passed: 0,  // Placeholder - implement validation logic later
                    needfix: 0  // Placeholder - implement validation logic later
                }
            });
        } else {
            // MySQL
            const connection = await mysql.createConnection({
                host: host,
                port: port,
                user: user,
                password: password,
                database: database,
                connectTimeout: 5000
            });

            const query = `
                SELECT COUNT(vn) as total
                FROM ovst
                WHERE vstdate BETWEEN ? AND ?
                ${pttypeCondition}
            `;

            const [rows] = await connection.execute(query, [dateFrom, dateTo]);
            await connection.end();

            res.json({
                success: true,
                stats: {
                    total: parseInt(rows[0].total) || 0,
                    passed: 0,  // Placeholder - implement validation logic later
                    needfix: 0  // Placeholder - implement validation logic later
                }
            });
        }

    } catch (error) {
        console.error('Query error:', error);
        res.json({
            success: false,
            error: error.message
        });
    }
});

// 5. ดึงข้อมูล Billtran
app.post('/api/get-billtran', async (req, res) => {
    try {
        const { host, port, database, user, password, dateFrom, dateTo, selectedPttypes, type, hipdata_code } = req.body;

        // Default to 'SSS' if not provided
        const hipdataCode = hipdata_code || 'SSS';

        // Build the WHERE clause for pttype
        let pttypeCondition = `AND vp.pttype IN (SELECT pttype FROM pttype WHERE isuse = 'Y' AND hipdata_code = '${hipdataCode}')`;
        if (selectedPttypes && selectedPttypes.length > 0) {
            const pttypeList = selectedPttypes.map(pt => `'${pt}'`).join(',');
            pttypeCondition += ` AND vp.pttype IN (${pttypeList})`;
        }

        if (type === 'postgresql') {
            // PostgreSQL
            const client = new PgClient({
                host: host,
                port: port,
                user: user,
                password: password,
                database: database,
                connectionTimeoutMillis: 10000
            });

            await client.connect();

            const query = `
                SELECT
                    rd.debt_id, ov.vstdate, ov.vn, vp.auth_code AS authcode,
                    rd.debt_date_time AS dttran,
                    op.hospitalcode AS hcode,
                    rd.debt_id AS invno,
                    (CASE WHEN rd.debt_id IS NOT NULL THEN 'Y' ELSE 'N' END) AS check_invno,
                    rc.rcpno AS billno, p.hn,
                    p.cid AS memberno,
                    (SELECT SUM(op2.sum_price) FROM opitemrece op2 WHERE op2.vn = ov.vn AND op2.paidst = '02') AS price,
                    rd.amount, rc.bill_amount AS paid,
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
                LEFT JOIN pttype ptt ON ptt.pttype = vp.pttype AND ptt.hipdata_code = '${hipdataCode}'
                LEFT JOIN pttype_upp_type put ON put.pttype_upp_type_id = ptt.pttype_upp_type_id
                WHERE ov.vstdate BETWEEN $1 AND $2
                ${pttypeCondition}
                AND ov.vn IN (SELECT vn FROM opitemrece WHERE vstdate::date BETWEEN $1 AND $2 AND paidst = '02')
                GROUP BY
                    rd.debt_id, vp.auth_code, vp.hospmain, vp.pttypeno,
                    rc.rcpno, rc.bill_amount, rd.sss_approval_code, rd.debt_date_time,
                    ov.vn, ov.vstdate,
                    rd.amount,
                    p.hn, p.cid,
                    op.hospitalcode, p.pname, p.fname, p.lname, put.pttype_upp_type_code
                ORDER BY ov.vn
            `;

            console.log(`[get-billtran PG] dateFrom=${dateFrom}, dateTo=${dateTo}, hipdataCode=${hipdataCode}, selectedPttypes=${JSON.stringify(selectedPttypes)}`);
            const result = await client.query(query, [dateFrom, dateTo]);
            await client.end();
            console.log(`[get-billtran PG] rows returned: ${result.rows.length}`);

            const normDate = v => {
                if (v instanceof Date) {
                    const y = v.getFullYear();
                    const m = String(v.getMonth() + 1).padStart(2, '0');
                    const d = String(v.getDate()).padStart(2, '0');
                    return `${y}-${m}-${d}`;
                }
                return v;
            };
            const normalized = result.rows.map(r => { const o = {}; Object.keys(r).forEach(k => { o[k] = normDate(r[k]); }); return o; });

            res.json({
                success: true,
                data: normalized,
                count: normalized.length
            });
        } else {
            // MySQL
            const connection = await mysql.createConnection({
                host: host,
                port: port,
                user: user,
                password: password,
                database: database,
                connectTimeout: 10000
            });

            const query = `
                SELECT
                    rd.debt_id, ov.vstdate, ov.vn, vp.auth_code AS authcode,
                    rd.debt_date_time AS dttran,
                    op.hospitalcode AS hcode,
                    rd.debt_id AS invno,
                    (CASE WHEN rd.debt_id IS NOT NULL THEN 'Y' ELSE 'N' END) AS check_invno,
                    rc.rcpno AS billno, p.hn,
                    p.cid AS memberno,
                    (SELECT SUM(op2.sum_price) FROM opitemrece op2 WHERE op2.vn = ov.vn AND op2.paidst = '02') AS price,
                    rd.amount, rc.bill_amount AS paid,
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
                LEFT JOIN pttype ptt ON ptt.pttype = vp.pttype AND ptt.hipdata_code = '${hipdataCode}'
                LEFT JOIN pttype_upp_type put ON put.pttype_upp_type_id = ptt.pttype_upp_type_id
                WHERE ov.vstdate BETWEEN ? AND ?
                ${pttypeCondition}
                AND ov.vn IN (SELECT vn FROM opitemrece WHERE DATE(vstdate) BETWEEN ? AND ? AND paidst = '02')
                GROUP BY
                    rd.debt_id, vp.auth_code, vp.hospmain, vp.pttypeno,
                    rc.rcpno, rc.bill_amount, rd.sss_approval_code, rd.debt_date_time,
                    ov.vn, ov.vstdate,
                    rd.amount,
                    p.hn, p.cid,
                    op.hospitalcode, p.pname, p.fname, p.lname, put.pttype_upp_type_code
                ORDER BY ov.vn
            `;

            console.log(`[get-billtran MySQL] dateFrom=${dateFrom}, dateTo=${dateTo}, hipdataCode=${hipdataCode}, selectedPttypes=${JSON.stringify(selectedPttypes)}`);
            const [rows] = await connection.execute(query, [dateFrom, dateTo, dateFrom, dateTo]);
            await connection.end();
            console.log(`[get-billtran MySQL] rows returned: ${rows.length}`);

            const normDate = v => {
                if (v instanceof Date) {
                    const y = v.getFullYear();
                    const m = String(v.getMonth() + 1).padStart(2, '0');
                    const d = String(v.getDate()).padStart(2, '0');
                    return `${y}-${m}-${d}`;
                }
                return v;
            };
            const normalized = rows.map(r => { const o = {}; Object.keys(r).forEach(k => { o[k] = normDate(r[k]); }); return o; });

            res.json({
                success: true,
                data: normalized,
                count: normalized.length
            });
        }

    } catch (error) {
        console.error('Query error:', error);
        res.json({
            success: false,
            error: error.message
        });
    }
});

// 4y. ดึงข้อมูล Billtran สำหรับ SSOP (VERCODE = p.cid, เพิ่ม check_hmain)
app.post('/api/get-ssop-billtran', async (req, res) => {
    try {
        const { host, port, database, user, password, dateFrom, dateTo, selectedPttypes, type, hipdata_code } = req.body;

        // Default to 'SSS' if not provided
        const hipdataCode = hipdata_code || 'SSS';

        // Build the WHERE clause for pttype
        let pttypeCondition = `AND vp.pttype IN (SELECT pttype FROM pttype WHERE isuse = 'Y' AND hipdata_code = '${hipdataCode}')`;
        if (selectedPttypes && selectedPttypes.length > 0) {
            const pttypeList = selectedPttypes.map(pt => `'${pt}'`).join(',');
            pttypeCondition += ` AND vp.pttype IN (${pttypeList})`;
        }

        if (type === 'postgresql') {
            // PostgreSQL
            const client = new PgClient({
                host: host,
                port: port,
                user: user,
                password: password,
                database: database,
                connectionTimeoutMillis: 10000
            });

            await client.connect();

            const query = `
                SELECT
                    rd.debt_id, ov.vstdate, ov.vn, vp.auth_code AS authcode,
                    rd.debt_date_time AS dttran,
                    op.hospitalcode AS hcode,
                    rd.debt_id AS invno,
                    (CASE WHEN rd.debt_id IS NOT NULL THEN 'Y' ELSE 'N' END) AS check_invno,
                    rc.rcpno AS billno, p.hn,
                    p.cid AS memberno,
                    (SELECT SUM(op2.sum_price) FROM opitemrece op2 WHERE op2.vn = ov.vn AND op2.paidst = '02') AS price,
                    rd.amount, rc.bill_amount AS paid,
                    p.cid AS vercode,
                    (CASE WHEN (p.cid IS NOT NULL AND p.cid <> '') THEN 'Y' ELSE 'N' END) AS check_vercode,
                    'A' AS tflag, p.cid AS pid,
                    CONCAT(p.pname, p.fname, ' ', p.lname) AS name,
                    vp.hospmain AS hmain,
                    (CASE WHEN (vp.hospmain IS NULL OR vp.hospmain = '') THEN 'N' ELSE 'Y' END) AS check_hmain,
                    put.pttype_upp_type_code AS payplan,
                    rd.total_amount AS claimamt, NULL AS otherpayplan, NULL AS otherpay
                FROM ovst ov
                LEFT JOIN vn_stat vn ON vn.vn = ov.vn
                LEFT JOIN visit_pttype vp ON vp.vn = ov.vn
                LEFT JOIN patient p ON p.hn = ov.hn
                LEFT JOIN rcpt_print rc ON rc.vn = ov.vn
                LEFT JOIN rcpt_debt rd ON rd.vn = ov.vn AND rd.total_amount > 0
                LEFT JOIN opdconfig op ON op.hospitalcode = op.hospitalcode
                LEFT JOIN pttype ptt ON ptt.pttype = vp.pttype AND ptt.hipdata_code = '${hipdataCode}'
                LEFT JOIN pttype_upp_type put ON put.pttype_upp_type_id = ptt.pttype_upp_type_id
                WHERE ov.vstdate BETWEEN $1 AND $2
                ${pttypeCondition}
                AND ov.vn IN (SELECT vn FROM opitemrece WHERE vstdate::date BETWEEN $1 AND $2 AND paidst = '02')
                GROUP BY
                    rd.debt_id, vp.auth_code, vp.hospmain, vp.pttypeno,
                    rc.rcpno, rc.bill_amount, rd.sss_approval_code, rd.debt_date_time,
                    ov.vn, ov.vstdate,
                    rd.amount,
                    p.hn, p.cid,
                    op.hospitalcode, p.pname, p.fname, p.lname, put.pttype_upp_type_code
                ORDER BY ov.vn
            `;

            console.log(`[get-ssop-billtran PG] dateFrom=${dateFrom}, dateTo=${dateTo}, hipdataCode=${hipdataCode}, selectedPttypes=${JSON.stringify(selectedPttypes)}`);
            const result = await client.query(query, [dateFrom, dateTo]);
            await client.end();
            console.log(`[get-ssop-billtran PG] rows returned: ${result.rows.length}`);

            const normDate = v => {
                if (v instanceof Date) {
                    const y = v.getFullYear();
                    const m = String(v.getMonth() + 1).padStart(2, '0');
                    const d = String(v.getDate()).padStart(2, '0');
                    return `${y}-${m}-${d}`;
                }
                return v;
            };
            const normalized = result.rows.map(r => { const o = {}; Object.keys(r).forEach(k => { o[k] = normDate(r[k]); }); return o; });

            res.json({
                success: true,
                data: normalized,
                count: normalized.length
            });
        } else {
            // MySQL
            const connection = await mysql.createConnection({
                host: host,
                port: port,
                user: user,
                password: password,
                database: database,
                connectTimeout: 10000
            });

            const query = `
                SELECT
                    rd.debt_id, ov.vstdate, ov.vn, vp.auth_code AS authcode,
                    rd.debt_date_time AS dttran,
                    op.hospitalcode AS hcode,
                    rd.debt_id AS invno,
                    (CASE WHEN rd.debt_id IS NOT NULL THEN 'Y' ELSE 'N' END) AS check_invno,
                    rc.rcpno AS billno, p.hn,
                    p.cid AS memberno,
                    (SELECT SUM(op2.sum_price) FROM opitemrece op2 WHERE op2.vn = ov.vn AND op2.paidst = '02') AS price,
                    rd.amount, rc.bill_amount AS paid,
                    p.cid AS vercode,
                    (CASE WHEN (p.cid IS NOT NULL AND p.cid <> '') THEN 'Y' ELSE 'N' END) AS check_vercode,
                    'A' AS tflag, p.cid AS pid,
                    CONCAT(p.pname, p.fname, ' ', p.lname) AS name,
                    vp.hospmain AS hmain,
                    (CASE WHEN (vp.hospmain IS NULL OR vp.hospmain = '') THEN 'N' ELSE 'Y' END) AS check_hmain,
                    put.pttype_upp_type_code AS payplan,
                    rd.total_amount AS claimamt, NULL AS otherpayplan, NULL AS otherpay
                FROM ovst ov
                LEFT JOIN vn_stat vn ON vn.vn = ov.vn
                LEFT JOIN visit_pttype vp ON vp.vn = ov.vn
                LEFT JOIN patient p ON p.hn = ov.hn
                LEFT JOIN rcpt_print rc ON rc.vn = ov.vn
                LEFT JOIN rcpt_debt rd ON rd.vn = ov.vn AND rd.total_amount > 0
                LEFT JOIN opdconfig op ON op.hospitalcode = op.hospitalcode
                LEFT JOIN pttype ptt ON ptt.pttype = vp.pttype AND ptt.hipdata_code = '${hipdataCode}'
                LEFT JOIN pttype_upp_type put ON put.pttype_upp_type_id = ptt.pttype_upp_type_id
                WHERE ov.vstdate BETWEEN ? AND ?
                ${pttypeCondition}
                AND ov.vn IN (SELECT vn FROM opitemrece WHERE DATE(vstdate) BETWEEN ? AND ? AND paidst = '02')
                GROUP BY
                    rd.debt_id, vp.auth_code, vp.hospmain, vp.pttypeno,
                    rc.rcpno, rc.bill_amount, rd.sss_approval_code, rd.debt_date_time,
                    ov.vn, ov.vstdate,
                    rd.amount,
                    p.hn, p.cid,
                    op.hospitalcode, p.pname, p.fname, p.lname, put.pttype_upp_type_code
                ORDER BY ov.vn
            `;

            console.log(`[get-ssop-billtran MySQL] dateFrom=${dateFrom}, dateTo=${dateTo}, hipdataCode=${hipdataCode}, selectedPttypes=${JSON.stringify(selectedPttypes)}`);
            const [rows] = await connection.execute(query, [dateFrom, dateTo, dateFrom, dateTo]);
            await connection.end();
            console.log(`[get-ssop-billtran MySQL] rows returned: ${rows.length}`);

            const normDate = v => {
                if (v instanceof Date) {
                    const y = v.getFullYear();
                    const m = String(v.getMonth() + 1).padStart(2, '0');
                    const d = String(v.getDate()).padStart(2, '0');
                    return `${y}-${m}-${d}`;
                }
                return v;
            };
            const normalized = rows.map(r => { const o = {}; Object.keys(r).forEach(k => { o[k] = normDate(r[k]); }); return o; });

            res.json({
                success: true,
                data: normalized,
                count: normalized.length
            });
        }

    } catch (error) {
        console.error('SSOP Billtran query error:', error);
        res.json({
            success: false,
            error: error.message
        });
    }
});

// 5b-2. อัพเดท visit_pttype.hospmain สำหรับ SSOP Billtran
app.post('/api/update-ssop-billtran-hmain', async (req, res) => {
    try {
        const { host, port, database, user, password, type, vn, hmain } = req.body;
        if (!vn) return res.json({ success: false, error: 'vn is required' });

        if (type === 'postgresql') {
            const client = new PgClient({ host, port: parseInt(port), user, password, database, connectionTimeoutMillis: 10000 });
            await client.connect();
            await client.query(
                `UPDATE visit_pttype SET hospmain = $1 WHERE vn = $2`,
                [hmain || null, vn]
            );
            await client.end();
        } else {
            const conn = await mysql.createConnection({ host, port: parseInt(port), user, password, database, connectTimeout: 10000 });
            await conn.execute(
                `UPDATE visit_pttype SET hospmain = ? WHERE vn = ?`,
                [hmain || null, vn]
            );
            await conn.end();
        }
        console.log(`[update-ssop-billtran-hmain] vn=${vn} hospmain=${hmain}`);
        res.json({ success: true });
    } catch (error) {
        console.error('update-ssop-billtran-hmain error:', error);
        res.json({ success: false, error: error.message });
    }
});

// 5c. ดึงรายการค่าใช้จ่าย opitemrece สำหรับ VN
app.post('/api/get-vn-expenses', async (req, res) => {
    try {
        const { host, port, database, user, password, type, vn } = req.body;
        const isPg = type === 'postgresql';
        let rows = [];
        const pgQuery = `
            SELECT op.icode, CONCAT(s.name,' ',s.strength) AS items, op.qty,
                (CASE WHEN n.unit IS NULL THEN s.units ELSE n.unit END) AS unit, op.sum_price
            FROM opitemrece op
            LEFT JOIN s_drugitems s ON s.icode = op.icode
            LEFT JOIN nondrugitems n ON n.icode = op.icode AND op.icode LIKE '3%'
            WHERE op.vn = $1
        `;
        const myQuery = `
            SELECT op.icode, CONCAT(s.name,' ',s.strength) AS items, op.qty,
                (CASE WHEN n.unit IS NULL THEN s.units ELSE n.unit END) AS unit, op.sum_price
            FROM opitemrece op
            LEFT JOIN s_drugitems s ON s.icode = op.icode
            LEFT JOIN nondrugitems n ON n.icode = op.icode AND op.icode LIKE '3%'
            WHERE op.vn = ?
        `;
        if (isPg) {
            const client = new PgClient({ host, port: parseInt(port), database, user, password, connectionTimeoutMillis: 15000 });
            await client.connect();
            const r = await client.query(pgQuery, [vn]);
            await client.end();
            rows = r.rows;
        } else {
            const connection = await mysql.createConnection({ host, port, user, password, database, connectTimeout: 15000 });
            const [r] = await connection.execute(myQuery, [vn]);
            await connection.end();
            rows = r;
        }
        res.json({ success: true, data: rows });
    } catch (error) {
        console.error('get-vn-expenses error:', error);
        res.json({ success: false, error: error.message });
    }
});

// 5d. ออกใบแจ้งหนี้ (8 steps in transaction)
app.post('/api/create-rcpt-debt', async (req, res) => {
    try {
        const { host, port, database, user, password, type, vn, vercode } = req.body;
        if (type !== 'postgresql') {
            return res.json({ success: false, error: 'รองรับเฉพาะ PostgreSQL สำหรับการออกใบแจ้งหนี้' });
        }
        const client = new PgClient({ host, port: parseInt(port), database, user, password, connectionTimeoutMillis: 30000 });
        await client.connect();
        await client.query('BEGIN');
        try {
            // Step 1: opd_opi_fn_tr_list
            await client.query(`
                INSERT INTO opd_opi_fn_tr_list(opd_opi_fn_tr_list_id, opd_opi_fn_tr_date, opd_opi_fn_tr_time, vn, transfer_amount, opd_opi_fn_tr_staff)
                SELECT get_serialnumber('opd_opi_fn_tr_list_id'),o.vstdate,o.vsttime,o.vn,v.uc_money,o.staff
                FROM vn_stat v,ovst o
                WHERE v.vn=o.vn AND o.vn=$1
            `, [vn]);
            console.log(`[create-rcpt-debt] Step 1 done`);

            // ดึง opd_opi_fn_tr_list_id ใหม่ เพื่อใช้ใน Step 2-4 โดยตรง (หลีกเลี่ยง record เก่า)
            const newTrListResult = await client.query(
                `SELECT opd_opi_fn_tr_list_id FROM opd_opi_fn_tr_list WHERE vn=$1 ORDER BY opd_opi_fn_tr_list_id DESC LIMIT 1`, [vn]
            );
            const newTrListId = newTrListResult.rows[0]?.opd_opi_fn_tr_list_id;
            if (!newTrListId) throw new Error('ไม่พบ opd_opi_fn_tr_list_id หลัง Step 1');
            console.log(`[create-rcpt-debt] new tr_list_id=${newTrListId}`);

            // Step 2: opd_opi_hos_guid_transfer — one row per opitemrece item using real hos_guid
            // HOSxP cancel: SELECT opi_guid WHERE opd_opi_fn_tr_list_id=X → UPDATE opitemrece SET finance_number=NULL WHERE hos_guid=opi_guid
            // Delete stale entries first so INSERT doesn't conflict (VN may have been invoiced before)
            await client.query(`
                DELETE FROM opd_opi_hos_guid_transfer
                WHERE hos_guid IN (SELECT hos_guid FROM opitemrece WHERE vn = $1)
            `, [vn]);
            await client.query(`
                INSERT INTO opd_opi_hos_guid_transfer(opi_guid, hos_guid, vn, opd_opi_fn_tr_list_id)
                SELECT oi.hos_guid, oi.hos_guid, oi.vn, $2
                FROM opitemrece oi
                WHERE oi.vn = $1
            `, [vn, newTrListId]);
            console.log(`[create-rcpt-debt] Step 2 done`);

            // Step 3: opd_opi_fn_tr_detail
            await client.query(`
                INSERT INTO opd_opi_fn_tr_detail(opd_opi_fn_tr_detail_id, opd_opi_fn_tr_list_id, income, pttype, amount_paidst_01, amount_paidst_02, amount_paidst_03, total_amount, amount_paidst_04, process_order, amount_paidst_04a, amount_paidst_04b)
                SELECT get_serialnumber('opd_opi_fn_tr_detail_id'),$2,op.income,op.pttype,
                    SUM(CASE WHEN op.paidst='01' THEN op.sum_price ELSE 0 END),
                    SUM(CASE WHEN op.paidst='02' THEN op.sum_price ELSE 0 END),
                    SUM(CASE WHEN op.paidst='03' THEN op.sum_price ELSE 0 END),
                    SUM(op.sum_price),'0','1000','0','0'
                FROM opitemrece op
                WHERE op.vn=$1
                GROUP BY op.income,op.pttype
            `, [vn, newTrListId]);
            console.log(`[create-rcpt-debt] Step 3 done`);

            // Step 4: opd_opi_finance_summary
            await client.query(`
                INSERT INTO opd_opi_finance_summary(opd_opi_finance_summary_id, vn, income, total_paidst_01, total_paidst_02, total_paidst_03, total_paidst_04, total_amount, clear_amount, balance_amount, total_balance_01, total_balance_02, total_balance_03, total_balance_04, pttype, status_ok, total_paidst_04a, total_paidst_04b, total_balance_04a, total_amount_a)
                SELECT get_serialnumber('opd_opi_finance_summary_id'),op.vn,op.income,
                    SUM(CASE WHEN op.paidst='01' THEN op.sum_price ELSE 0 END),
                    SUM(CASE WHEN op.paidst='02' THEN op.sum_price ELSE 0 END),
                    SUM(CASE WHEN op.paidst='03' THEN op.sum_price ELSE 0 END),'0',SUM(op.sum_price),'0',SUM(op.sum_price),
                    SUM(CASE WHEN op.paidst='01' THEN op.sum_price ELSE 0 END),
                    SUM(CASE WHEN op.paidst='02' THEN op.sum_price ELSE 0 END),
                    SUM(CASE WHEN op.paidst='03' THEN op.sum_price ELSE 0 END),
                    '0',op.pttype,'N','0','0',
                    SUM(CASE WHEN op.paidst='02' THEN op.sum_price ELSE 0 END),
                    SUM(CASE WHEN op.paidst='02' THEN op.sum_price ELSE 0 END)
                FROM opitemrece op
                WHERE op.vn=$1
                GROUP BY op.pttype,op.vn,op.income
            `, [vn]);
            console.log(`[create-rcpt-debt] Step 4 done`);

            // Step 5: opd_opi_fn_cr_list
            await client.query(`
                INSERT INTO opd_opi_fn_cr_list(opd_opi_fn_cr_list_id, vn, pttype, opd_opi_fn_cr_date, opd_opi_fn_cr_time, opd_opi_fn_cr_staff, clear_amount, finance_number, status_ok)
                SELECT get_serialnumber('opd_opi_fn_cr_list_id'),o.vn,vp.pttype,o.vstdate,o.vsttime,o.staff,v.uc_money,get_serialnumber('finance_number'),'Y'
                FROM vn_stat v,ovst o,visit_pttype vp
                WHERE v.vn=o.vn AND vp.vn=o.vn AND o.vn=$1
            `, [vn]);
            console.log(`[create-rcpt-debt] Step 5 done`);

            // ดึง cr_list_id และ finance_number ใหม่ เพื่อใช้ใน Step 6-7 โดยตรง
            const newCrListResult = await client.query(
                `SELECT opd_opi_fn_cr_list_id, finance_number FROM opd_opi_fn_cr_list WHERE vn=$1 ORDER BY opd_opi_fn_cr_list_id DESC LIMIT 1`, [vn]
            );
            const newCrListId = newCrListResult.rows[0]?.opd_opi_fn_cr_list_id;
            const newFinanceNumber = newCrListResult.rows[0]?.finance_number;
            if (!newCrListId) throw new Error('ไม่พบ opd_opi_fn_cr_list_id หลัง Step 5');
            console.log(`[create-rcpt-debt] new cr_list_id=${newCrListId}, finance_number=${newFinanceNumber}`);

            // Step 5.5: Link opd_opi_fn_tr_detail → opd_opi_fn_cr_list
            // HOSxP cancel chain: rcpt_debt.finance_number → cr_list_id → tr_detail.opd_opi_fn_cr_list_id → tr_list_id → opitemrece.finance_number=NULL
            await client.query(`
                UPDATE opd_opi_fn_tr_detail
                SET opd_opi_fn_cr_list_id = $2
                WHERE opd_opi_fn_tr_list_id = $1
                AND (opd_opi_fn_cr_list_id IS NULL OR opd_opi_fn_cr_list_id = 0)
            `, [newTrListId, newCrListId]);
            console.log(`[create-rcpt-debt] Step 5.5 done — tr_detail.opd_opi_fn_cr_list_id=${newCrListId}`);

            // Step 6: opd_opi_fn_cr_detail
            await client.query(`
                INSERT INTO opd_opi_fn_cr_detail(opd_opi_fn_cr_detail_id, opd_opi_fn_cr_list_id, income, amount_paidst_02, amount_paidst_04, total_amount, original_total_amount)
                SELECT get_serialnumber('opd_opi_fn_cr_detail_id'),$2,op.income,
                    SUM(CASE WHEN op.paidst='02' THEN op.sum_price ELSE 0 END),'0',
                    SUM(CASE WHEN op.paidst='02' THEN op.sum_price ELSE 0 END),
                    SUM(CASE WHEN op.paidst='02' THEN op.sum_price ELSE 0 END)
                FROM opitemrece op
                WHERE op.vn=$1
                GROUP BY op.income
            `, [vn, newCrListId]);
            console.log(`[create-rcpt-debt] Step 6 done`);

            // Step 7: rcpt_debt (+ vercode) — ใบเดียวต่อ vn (ไม่แยกตาม pttype) ใช้วันที่/เวลาปัจจุบัน (NOW()) แทนวันที่เปิด visit
            await client.query(`
                INSERT INTO rcpt_debt(debt_id, vn, hn, debt_date, debt_time, staff, amount, pt_type, computer, finance_number, pttype, discount_amount, total_amount, debt_date_time, debt_doc_id, department, special_discount_amount, ofc_paid_amount, sss_approval_code)
                SELECT get_serialnumber('rcpt_debt_id'),op.vn,MAX(op.hn),CURRENT_DATE,NOW()::time,MAX(op.staff),
                    SUM(CASE WHEN op.paidst='02' THEN op.sum_price ELSE 0 END),'OPD','App precheck export',$2,MAX(op.pttype),SUM(op.discount),
                    SUM(CASE WHEN op.paidst='02' THEN op.sum_price ELSE 0 END),NOW(),
                    MAX(op.pttype) || '/1',
                    'OPD','0','0',$3
                FROM opitemrece op
                WHERE op.vn=$1
                GROUP BY op.vn
            `, [vn, newFinanceNumber, vercode || '']);
            console.log(`[create-rcpt-debt] Step 7 done`);

            // Get the newly inserted debt_id (to avoid joining old cancelled records)
            const newDebtResult = await client.query(
                `SELECT debt_id FROM rcpt_debt WHERE vn=$1 ORDER BY debt_id DESC LIMIT 1`, [vn]
            );
            const newDebtId = newDebtResult.rows[0]?.debt_id;
            if (!newDebtId) throw new Error('ไม่พบ debt_id หลัง Step 7');
            console.log(`[create-rcpt-debt] new debt_id=${newDebtId}`);

            // Step 8: rcpt_debt_detail (ใช้ newDebtId โดยตรง ไม่ join rcpt_debt เพื่อหลีกเลี่ยง debt_id เก่าที่ยกเลิกไปแล้ว)
            await client.query(`
                INSERT INTO rcpt_debt_detail(debt_id, income, amount, discount, total_amount, special_discount)
                SELECT $2::numeric, op.income,
                    SUM(CASE WHEN op.paidst='02' THEN op.sum_price ELSE 0 END),
                    SUM(op.discount),
                    SUM(CASE WHEN op.paidst='02' THEN op.sum_price ELSE 0 END), '0'
                FROM opitemrece op
                WHERE op.vn=$1
                GROUP BY op.income
            `, [vn, newDebtId]);
            console.log(`[create-rcpt-debt] Step 8 done`);

            // Step 9: update opitemrece.finance_number = opd_opi_fn_cr_list.finance_number
            // HOSxP cancel chain clears opitemrece WHERE finance_number = cr_list.finance_number → must match
            // Update ALL rows (not just NULL) so VNs with stale finance_number are also covered
            await client.query(`
                UPDATE opitemrece
                SET finance_number = $2
                WHERE vn = $1
            `, [vn, newFinanceNumber]);
            console.log(`[create-rcpt-debt] Step 9 done — finance_number(cr_list.finance_number)=${newFinanceNumber}`);

            await client.query('COMMIT');

            // Get the new debt_id
            const r = await client.query(`SELECT debt_id FROM rcpt_debt WHERE vn=$1 ORDER BY debt_id DESC LIMIT 1`, [vn]);
            const debtId = r.rows[0]?.debt_id;
            await client.end();
            console.log(`[create-rcpt-debt] SUCCESS vn=${vn}, debt_id=${debtId}, vercode=${vercode}`);
            res.json({ success: true, debt_id: debtId });
        } catch (stepErr) {
            await client.query('ROLLBACK');
            await client.end();
            console.error(`[create-rcpt-debt] ROLLBACK vn=${vn}:`, stepErr.message);
            res.json({ success: false, error: stepErr.message });
        }
    } catch (error) {
        console.error('create-rcpt-debt error:', error);
        res.json({ success: false, error: error.message });
    }
});

// 5b. Debug billtran conditions
app.post('/api/debug-billtran', async (req, res) => {
    try {
        const { host, port, database, user, password, dateFrom, dateTo, selectedPttypes, type, hipdata_code } = req.body;
        const hipdataCode = hipdata_code || 'SSS';
        const isPg = type === 'postgresql';
        const results = {};

        if (isPg) {
            const client = new PgClient({ host, port: parseInt(port), database, user, password, connectionTimeoutMillis: 15000 });
            await client.connect();

            // Check 1: ovst records for date
            const r1 = await client.query(`SELECT COUNT(*) AS cnt FROM ovst WHERE vstdate BETWEEN $1 AND $2`, [dateFrom, dateTo]);
            results.ovst_count = r1.rows[0].cnt;

            // Check 2: opitemrece paidst='02' for date
            const r2 = await client.query(`SELECT COUNT(*) AS cnt FROM opitemrece WHERE vstdate::date BETWEEN $1 AND $2 AND paidst = '02'`, [dateFrom, dateTo]);
            results.opitemrece_paid_count = r2.rows[0].cnt;

            // Check 3: ovst + pttype filter
            let pttypeSql = `SELECT COUNT(*) AS cnt FROM ovst ov LEFT JOIN visit_pttype vp ON vp.vn = ov.vn WHERE ov.vstdate BETWEEN $1 AND $2 AND vp.pttype IN (SELECT pttype FROM pttype WHERE isuse = 'Y' AND hipdata_code = '${hipdataCode}')`;
            if (selectedPttypes && selectedPttypes.length > 0) {
                const lst = selectedPttypes.map(p => `'${p}'`).join(',');
                pttypeSql += ` AND vp.pttype IN (${lst})`;
            }
            const r3 = await client.query(pttypeSql, [dateFrom, dateTo]);
            results.ovst_pttype_count = r3.rows[0].cnt;

            // Check 4: ovst + pttype + paidst subquery
            let combinedSql = `SELECT COUNT(*) AS cnt FROM ovst ov LEFT JOIN visit_pttype vp ON vp.vn = ov.vn WHERE ov.vstdate BETWEEN $1 AND $2 AND vp.pttype IN (SELECT pttype FROM pttype WHERE isuse = 'Y' AND hipdata_code = '${hipdataCode}')`;
            if (selectedPttypes && selectedPttypes.length > 0) {
                const lst = selectedPttypes.map(p => `'${p}'`).join(',');
                combinedSql += ` AND vp.pttype IN (${lst})`;
            }
            combinedSql += ` AND ov.vn IN (SELECT vn FROM opitemrece WHERE vstdate::date BETWEEN $1 AND $2 AND paidst = '02')`;
            const r4 = await client.query(combinedSql, [dateFrom, dateTo]);
            results.after_paidst_filter = r4.rows[0].cnt;

            // Check 5: add rcpt_debt total_amount > 0
            let fullSql = combinedSql.replace('SELECT COUNT(*) AS cnt FROM ovst', 'SELECT COUNT(*) AS cnt FROM ovst ov2');
            fullSql = `SELECT COUNT(*) AS cnt FROM ovst ov LEFT JOIN visit_pttype vp ON vp.vn = ov.vn LEFT JOIN rcpt_debt rd ON rd.vn = ov.vn WHERE ov.vstdate BETWEEN $1 AND $2 AND vp.pttype IN (SELECT pttype FROM pttype WHERE isuse = 'Y' AND hipdata_code = '${hipdataCode}')`;
            if (selectedPttypes && selectedPttypes.length > 0) {
                const lst = selectedPttypes.map(p => `'${p}'`).join(',');
                fullSql += ` AND vp.pttype IN (${lst})`;
            }
            fullSql += ` AND ov.vn IN (SELECT vn FROM opitemrece WHERE vstdate::date BETWEEN $1 AND $2 AND paidst = '02') AND rd.total_amount > 0`;
            const r5 = await client.query(fullSql, [dateFrom, dateTo]);
            results.after_total_amount_filter = r5.rows[0].cnt;

            await client.end();
        } else {
            results.error = 'MySQL debug not implemented';
        }

        console.log(`[debug-billtran] dateFrom=${dateFrom}, dateTo=${dateTo}`, results);
        res.json({ success: true, results });
    } catch (error) {
        console.error('debug-billtran error:', error);
        res.json({ success: false, error: error.message });
    }
});

// 6. ดึงข้อมูล BillItems
app.post('/api/get-billitems', async (req, res) => {
    try {
        const { host, port, database, user, password, dateFrom, dateTo, selectedPttypes, type, hipdata_code } = req.body;
        const hipdataCode = hipdata_code || 'SSS';

        let pttypeCondition = '';
        if (selectedPttypes && selectedPttypes.length > 0) {
            const pttypeList = selectedPttypes.map(pt => `'${pt}'`).join(',');
            pttypeCondition = `AND ov.pttype IN (${pttypeList})`;
        } else {
            pttypeCondition = `AND ov.pttype IN (SELECT p.pttype FROM pttype p WHERE p.isuse='Y' AND ${hipdataFilter(hipdataCode)})`;
        }

        if (type === 'postgresql') {
            const client = new PgClient({ host, port, user, password, database, connectionTimeoutMillis: 10000 });
            await client.connect();

            const query = `
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
                WHERE ov.vstdate BETWEEN $1 AND $2
                ${pttypeCondition}
                AND ov.vn IN (SELECT vn FROM opitemrece WHERE vstdate::date BETWEEN $1 AND $2 AND paidst = '02')
                GROUP BY ov.hn, pt.pname, pt.fname, pt.lname, rd.debt_id, ov.vstdate,
                    op.income, dc.chrgitem_code1, ds.icode, op.icode, dr.sks_drug_code, n.billcode,
                    dr.name, dr.strength, dr.units, n.name,
                    op.qty, op.unitprice, op.sum_price, op.paidst, dr.sks_price, n.sks_coverage_price,
                    rdd.total_amount, ov.vn, n.enable_sks_opd
                LIMIT 1000
            `;

            const result = await client.query(query, [dateFrom, dateTo]);
            await client.end();
            res.json({ success: true, data: result.rows, count: result.rows.length });

        } else {
            const connection = await mysql.createConnection({ host, port, user, password, database, connectTimeout: 10000 });

            const query = `
                SELECT ov.hn, CONCAT(pt.pname, pt.fname,' ',pt.lname) AS ptname, ov.vn,
                    rd.debt_id AS invno, (CASE WHEN rd.debt_id IS NOT NULL THEN 'Y' ELSE 'N' END) AS check_debt_id,
                    ov.vstdate,
                    substring(dc.chrgitem_code1,1,1) AS billmuad,
                    (CASE WHEN dc.chrgitem_code1 IS NOT NULL THEN 'Y' ELSE 'N' END) AS check_billmuad,
                    op.icode,
                    (CASE WHEN op.income = '03' THEN dr.sks_drug_code ELSE n.billcode END) AS stdcode,
                    (CASE WHEN dr.sks_drug_code IS NOT NULL OR n.billcode IS NOT NULL THEN 'Y' ELSE 'N' END) AS check_stdcode,
                    (CASE WHEN op.income = '03' THEN CONCAT(dr.name,' ',dr.strength,' ',dr.units) ELSE n.name END) AS \`desc\`,
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
                WHERE ov.vstdate BETWEEN ? AND ?
                ${pttypeCondition}
                AND ov.vn IN (SELECT vn FROM opitemrece WHERE DATE(vstdate) BETWEEN ? AND ? AND paidst = '02')
                GROUP BY ov.hn, pt.pname, pt.fname, pt.lname, rd.debt_id, ov.vstdate,
                    op.income, dc.chrgitem_code1, ds.icode, op.icode, dr.sks_drug_code, n.billcode,
                    dr.name, dr.strength, dr.units, n.name,
                    op.qty, op.unitprice, op.sum_price, op.paidst, dr.sks_price, n.sks_coverage_price,
                    rdd.total_amount, ov.vn, n.enable_sks_opd
                LIMIT 1000
            `;

            const [rows] = await connection.execute(query, [dateFrom, dateTo, dateFrom, dateTo]);
            await connection.end();
            res.json({ success: true, data: rows, count: rows.length });
        }

    } catch (error) {
        console.error('BillItems query error:', error);
        res.json({ success: false, error: error.message });
    }
});

// 7. ดึงข้อมูล OPService
app.post('/api/get-opservice', async (req, res) => {
    try {
        const { host, port, database, user, password, dateFrom, dateTo, selectedPttypes, type, hipdata_code } = req.body;
        const hipdataCode = hipdata_code || 'SSS';

        let pttypeCondition = '';
        if (selectedPttypes && selectedPttypes.length > 0) {
            const pttypeList = selectedPttypes.map(pt => `'${pt}'`).join(',');
            pttypeCondition = `AND ov.pttype IN (${pttypeList})`;
        } else {
            pttypeCondition = `AND ov.pttype IN (SELECT p.pttype FROM pttype p WHERE p.isuse='Y' AND ${hipdataFilter(hipdataCode)})`;
        }

        const buildQuery = (pg) => {
            const ph1 = pg ? '$1' : '?';
            const ph2 = pg ? '$2' : '?';
            return `
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
                WHERE ov.vstdate BETWEEN ${ph1} AND ${ph2}
                ${pttypeCondition}
                AND ov.vn IN (SELECT vn FROM opitemrece WHERE ${pg ? 'vstdate::date' : 'DATE(vstdate)'} BETWEEN ${ph1} AND ${ph2} AND paidst = '02')
                GROUP BY ov.vn, ov.vstdate, ov.vsttime, oa.nextdate,
                  pa.pname, pa.fname, pa.lname, pa.hn, pa.cid,
                  ov.ovstist, ov.ovstost, s.nhso_code, n.billcode, ot.export_code, st.export_code
                ORDER BY ov.vn
            `;
        };

        if (type === 'postgresql') {
            const client = new PgClient({ host, port, user, password, database, connectionTimeoutMillis: 15000 });
            await client.connect();
            await client.query(`SET statement_timeout = 180000`); // 3 นาที
            const result = await client.query(buildQuery(true), [dateFrom, dateTo]);
            await client.end();
            res.json({ success: true, data: result.rows, count: result.rows.length });
        } else {
            const connection = await mysql.createConnection({ host, port, user, password, database, connectTimeout: 15000 });
            try { await connection.execute(`SET SESSION max_execution_time = 180000`); } catch(e) {} // 3 นาที (MySQL 5.7.8+)
            const [rows] = await connection.execute(buildQuery(false), [dateFrom, dateTo]);
            await connection.end();
            res.json({ success: true, data: rows, count: rows.length });
        }

    } catch (error) {
        console.error('OPService query error:', error);
        res.json({ success: false, error: error.message });
    }
});

// 8. ดึงข้อมูล DispensedItem
app.post('/api/get-dispenseditem', async (req, res) => {
    try {
        const { host, port, database, user, password, dateFrom, dateTo, selectedPttypes, type, hipdata_code } = req.body;
        const hipdataCode = hipdata_code || 'SSS';

        let pttypeCondition = '';
        if (selectedPttypes && selectedPttypes.length > 0) {
            const pttypeList = selectedPttypes.map(pt => `'${pt}'`).join(',');
            pttypeCondition = `AND ov.pttype IN (${pttypeList})`;
        } else {
            pttypeCondition = `AND ov.pttype IN (SELECT p.pttype FROM pttype p WHERE p.isuse='Y' AND ${hipdataFilter(hipdataCode)})`;
        }

        const buildQuery = (pg) => `
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
            WHERE op.vstdate BETWEEN ${pg ? '$1' : '?'} AND ${pg ? '$2' : '?'}
            ${pttypeCondition}
            AND ov.vn IN (SELECT vn FROM opitemrece WHERE ${pg ? 'vstdate::date' : 'DATE(vstdate)'} BETWEEN ${pg ? '$1' : '?'} AND ${pg ? '$2' : '?'} AND paidst = '02')
            GROUP BY op.vn, od.opi_dispense_id, op.icode, op.qty, op.drugusage, op.vstdate,
              op.sum_price, no.sks_product_category_id, di.icode, di.sks_drug_code,
              od.dose, od.unit_name, od.frequency_code, od.usage_unit_code,
              di.units, ds.shortlist, ds.drugusage, op.unitprice, di.sks_reimb_price
            LIMIT 1000
        `;

        if (type === 'postgresql') {
            const client = new PgClient({ host, port: parseInt(port), user, password, database, connectionTimeoutMillis: 60000 });
            await client.connect();
            const result = await client.query(buildQuery(true), [dateFrom, dateTo]);
            await client.end();
            res.json({ success: true, data: result.rows, count: result.rows.length });
        } else {
            const connection = await mysql.createConnection({ host, port, user, password, database, connectTimeout: 60000 });
            const [rows] = await connection.execute(buildQuery(false), [dateFrom, dateTo]);
            await connection.end();
            res.json({ success: true, data: rows, count: rows.length });
        }
    } catch (error) {
        console.error('DispensedItem query error:', error);
        res.json({ success: false, error: error.message });
    }
});

// 8b. ดึงข้อมูล DispensedItem สำหรับ CSOP (เบิกจ่ายตรงข้าราชการ)
app.post('/api/get-csop-dispenseditem', async (req, res) => {
    try {
        const { host, port, database, user, password, dateFrom, dateTo, selectedPttypes, type, hipdata_code } = req.body;
        const hipdataCode = hipdata_code || 'OFC';

        let pttypeCondition = '';
        if (selectedPttypes && selectedPttypes.length > 0) {
            const pttypeList = selectedPttypes.map(pt => `'${pt}'`).join(',');
            pttypeCondition = `AND ov.pttype IN (${pttypeList})`;
        } else {
            pttypeCondition = `AND ov.pttype IN (SELECT p.pttype FROM pttype p WHERE p.isuse='Y' AND ${hipdataFilter(hipdataCode)})`;
        }

        const buildQuery = (pg) => `
            SELECT op.vstdate AS vstdate,
              ov.vn AS dispid,
              (CASE
                WHEN op.icode LIKE '1%' THEN di.sks_product_category_id
                WHEN op.icode LIKE '3%' THEN no.sks_product_category_id
                ELSE NULL END) AS prdcat,
              (CASE
                WHEN di.sks_product_category_id IS NOT NULL THEN 'Y'
                WHEN no.sks_product_category_id IS NOT NULL THEN 'Y'
                ELSE 'N' END) AS check_prdcat,
              op.icode AS hospdrgid,
              (CASE
                WHEN op.icode LIKE '1%' THEN di.sks_drug_code
                WHEN op.icode LIKE '3%' THEN no.billcode
                ELSE NULL END) AS drgid,
              (CASE
                WHEN di.sks_drug_code IS NOT NULL THEN 'Y'
                WHEN no.billcode IS NOT NULL THEN 'Y'
                ELSE 'N' END) AS check_drgid,
              di.sks_dfs_code AS dfscode,
              di.sks_dfs_text AS dfstext,
              di.packqty AS packsize,
              op.drugusage AS sigcode,
              (CASE WHEN op.icode LIKE '1%' AND (op.drugusage IS NULL OR op.drugusage = '') THEN 'N' ELSE 'Y' END) AS check_sigcode,
              ds.shortlist AS sigtext,
              (CASE WHEN ds.shortlist LIKE '1%' AND (op.drugusage IS NULL OR op.drugusage = '') THEN 'N' ELSE 'Y' END) AS check_sigtext,
              op.qty AS quantity,
              (CASE WHEN op.qty IS NOT NULL THEN 'Y' ELSE 'N' END) AS check_quantity,
              op.unitprice AS unitprice,
              (CASE WHEN op.unitprice IS NOT NULL THEN 'Y' ELSE 'N' END) AS check_unitprice,
              op.sum_price AS chargeamt,
              (CASE WHEN op.sum_price IS NOT NULL THEN 'Y' ELSE 'N' END) AS check_chargeamt,
              (CASE
                WHEN op.icode LIKE '1%' THEN di.sks_reimb_price
                WHEN op.icode LIKE '3%' THEN no.sks_coverage_price
                ELSE NULL END) AS reimbprice,
              (CASE
                WHEN op.icode LIKE '1%' AND di.sks_reimb_price IS NOT NULL THEN 'Y'
                WHEN op.icode LIKE '3%' AND no.sks_coverage_price IS NOT NULL THEN 'Y'
                ELSE 'N' END) AS check_reimbprice,
              SUM(op.qty * di.sks_reimb_price) AS reimbamt,
              '0' AS prdsecode,
              'OD' AS claimcont,
              'OP1' AS claimcat,
              NULL AS multidisp,
              NULL AS supplyfor
            FROM opitemrece op
              INNER JOIN ovst ov ON ov.vn = op.vn
              LEFT JOIN opi_dispense od ON od.hos_guid = op.hos_guid
              LEFT JOIN nondrugitems no ON no.icode = op.icode
              LEFT JOIN drugitems di ON di.icode = op.icode
              LEFT JOIN drugusage ds ON ds.drugusage = op.drugusage
            WHERE op.vstdate BETWEEN ${pg ? '$1' : '?'} AND ${pg ? '$2' : '?'}
            ${pttypeCondition}
            AND ov.vn IN (SELECT vn FROM opitemrece WHERE ${pg ? 'vstdate::date' : 'DATE(vstdate)'} BETWEEN ${pg ? '$1' : '?'} AND ${pg ? '$2' : '?'} AND paidst = '02')
            GROUP BY ov.vn, op.icode, op.qty, op.drugusage, op.vstdate,
              op.sum_price, no.sks_product_category_id, di.icode, di.sks_drug_code,
              od.dose, od.unit_name, od.frequency_code, od.usage_unit_code,
              di.units, ds.shortlist, ds.drugusage, op.unitprice, di.sks_reimb_price, no.billcode, no.sks_coverage_price
            ORDER BY ov.vn
            LIMIT 1000
        `;

        if (type === 'postgresql') {
            const client = new PgClient({ host, port: parseInt(port), user, password, database, connectionTimeoutMillis: 60000 });
            await client.connect();
            const result = await client.query(buildQuery(true), [dateFrom, dateTo]);
            await client.end();
            res.json({ success: true, data: result.rows, count: result.rows.length });
        } else {
            const connection = await mysql.createConnection({ host, port, user, password, database, connectTimeout: 60000 });
            const [rows] = await connection.execute(buildQuery(false), [dateFrom, dateTo]);
            await connection.end();
            res.json({ success: true, data: rows, count: rows.length });
        }
    } catch (error) {
        console.error('CSOP DispensedItem query error:', error);
        res.json({ success: false, error: error.message });
    }
});

// 8x. ดึงข้อมูล DispensedItem สำหรับ SSOP
app.post('/api/get-ssop-dispenseditem', async (req, res) => {
    try {
        const { host, port, database, user, password, dateFrom, dateTo, selectedPttypes, type, hipdata_code } = req.body;
        const hipdataCode = hipdata_code || 'SSS';

        let pttypeCondition = '';
        if (selectedPttypes && selectedPttypes.length > 0) {
            const pttypeList = selectedPttypes.map(pt => `'${pt}'`).join(',');
            pttypeCondition = `AND ov.pttype IN (${pttypeList})`;
        } else {
            pttypeCondition = `AND ov.pttype IN (SELECT p.pttype FROM pttype p WHERE p.isuse='Y' AND ${hipdataFilter(hipdataCode)})`;
        }

        const buildQuery = (pg) => `
            SELECT op.vstdate AS vstdate,
              ov.vn AS dispid,
              (CASE
                WHEN op.icode LIKE '1%' THEN di.sks_product_category_id
                WHEN op.icode LIKE '3%' THEN no.sks_product_category_id
                ELSE NULL END) AS prdcat,
              (CASE
                WHEN di.sks_product_category_id IS NOT NULL THEN 'Y'
                WHEN no.sks_product_category_id IS NOT NULL THEN 'Y'
                ELSE 'N' END) AS check_prdcat,
              op.icode AS hospdrgid,
              (CASE
                WHEN op.icode LIKE '1%' THEN di.sks_drug_code
                WHEN op.icode LIKE '3%' THEN no.billcode
                ELSE NULL END) AS drgid,
              (CASE
                WHEN di.sks_drug_code IS NOT NULL THEN 'Y'
                WHEN no.billcode IS NOT NULL THEN 'Y'
                ELSE 'N' END) AS check_drgid,
              di.sks_dfs_code AS dfscode,
              di.sks_dfs_text AS dfstext,
              di.packqty AS packsize,
              op.drugusage AS sigcode,
              (CASE WHEN op.icode LIKE '1%' AND (op.drugusage IS NULL OR op.drugusage = '') THEN 'N' ELSE 'Y' END) AS check_sigcode,
              ds.shortlist AS sigtext,
              (CASE WHEN ds.shortlist LIKE '1%' AND (op.drugusage IS NULL OR op.drugusage = '') THEN 'N' ELSE 'Y' END) AS check_sigtext,
              op.qty AS quantity,
              (CASE WHEN op.qty IS NOT NULL THEN 'Y' ELSE 'N' END) AS check_quantity,
              op.unitprice AS unitprice,
              (CASE WHEN op.unitprice IS NOT NULL THEN 'Y' ELSE 'N' END) AS check_unitprice,
              op.sum_price AS chargeamt,
              (CASE WHEN op.sum_price IS NOT NULL THEN 'Y' ELSE 'N' END) AS check_chargeamt,
              (CASE
                WHEN op.icode LIKE '1%' THEN di.sks_reimb_price
                WHEN op.icode LIKE '3%' THEN no.sks_coverage_price
                ELSE NULL END) AS reimbprice,
              (CASE
                WHEN op.icode LIKE '1%' AND di.sks_reimb_price IS NOT NULL THEN 'Y'
                WHEN op.icode LIKE '3%' AND no.sks_coverage_price IS NOT NULL THEN 'Y'
                ELSE 'N' END) AS check_reimbprice,
              SUM(op.qty * di.sks_reimb_price) AS reimbamt,
              '0' AS prdsecode,
              'OD' AS claimcont,
              'OP1' AS claimcat,
              NULL AS multidisp,
              NULL AS supplyfor
            FROM opitemrece op
              INNER JOIN ovst ov ON ov.vn = op.vn
              LEFT JOIN opi_dispense od ON od.hos_guid = op.hos_guid
              LEFT JOIN nondrugitems no ON no.icode = op.icode
              LEFT JOIN drugitems di ON di.icode = op.icode
              LEFT JOIN drugusage ds ON ds.drugusage = op.drugusage
            WHERE op.vstdate BETWEEN ${pg ? '$1' : '?'} AND ${pg ? '$2' : '?'}
            ${pttypeCondition}
            AND ov.vn IN (SELECT vn FROM opitemrece WHERE ${pg ? 'vstdate::date' : 'DATE(vstdate)'} BETWEEN ${pg ? '$1' : '?'} AND ${pg ? '$2' : '?'} AND paidst = '02')
            GROUP BY ov.vn, op.icode, op.qty, op.drugusage, op.vstdate,
              op.sum_price, no.sks_product_category_id, di.icode, di.sks_drug_code,
              od.dose, od.unit_name, od.frequency_code, od.usage_unit_code,
              di.units, ds.shortlist, ds.drugusage, op.unitprice, di.sks_reimb_price, no.billcode, no.sks_coverage_price
            ORDER BY ov.vn
            LIMIT 1000
        `;

        if (type === 'postgresql') {
            const client = new PgClient({ host, port: parseInt(port), user, password, database, connectionTimeoutMillis: 60000 });
            await client.connect();
            const result = await client.query(buildQuery(true), [dateFrom, dateTo]);
            await client.end();
            res.json({ success: true, data: result.rows, count: result.rows.length });
        } else {
            const connection = await mysql.createConnection({ host, port, user, password, database, connectTimeout: 60000 });
            const [rows] = await connection.execute(buildQuery(false), [dateFrom, dateTo]);
            await connection.end();
            res.json({ success: true, data: rows, count: rows.length });
        }
    } catch (error) {
        console.error('SSOP DispensedItem query error:', error);
        res.json({ success: false, error: error.message });
    }
});

// 9x. ดึงข้อมูล Dispensing
app.post('/api/get-dispensing', async (req, res) => {
    try {
        const { host, port, database, user, password, dateFrom, dateTo, selectedPttypes, type, hipdata_code } = req.body;
        const hipdataCode = hipdata_code || 'SSS';

        let pttypeCondition = '';
        if (selectedPttypes && selectedPttypes.length > 0) {
            const pttypeList = selectedPttypes.map(pt => `'${pt}'`).join(',');
            pttypeCondition = `AND ov.pttype IN (${pttypeList})`;
        } else {
            pttypeCondition = `AND ov.pttype IN (SELECT p.pttype FROM pttype p WHERE p.isuse='Y' AND ${hipdataFilter(hipdataCode)})`;
        }

        const buildQuery = (pg) => {
            const ph1 = pg ? '$1' : '?';
            const ph2 = pg ? '$2' : '?';
            return `
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
                WHERE ov.vstdate BETWEEN ${ph1} AND ${ph2}
                ${pttypeCondition}
                AND ov.vn IN (SELECT vn FROM opitemrece WHERE ${pg ? 'vstdate::date' : 'DATE(vstdate)'} BETWEEN ${ph1} AND ${ph2} AND paidst = '02')
                GROUP BY ov.vn, ov.vstdate,
                  pa.pname, pa.fname, pa.lname, pa.hn, pa.cid,
                  rc.paid
                ORDER BY ov.vn
            `;
        };

        if (type === 'postgresql') {
            const client = new PgClient({ host, port, user, password, database, connectionTimeoutMillis: 15000 });
            await client.connect();
            await client.query(`SET statement_timeout = 180000`);
            const result = await client.query(buildQuery(true), [dateFrom, dateTo]);
            await client.end();
            res.json({ success: true, data: result.rows, count: result.rows.length });
        } else {
            const connection = await mysql.createConnection({ host, port, user, password, database, connectTimeout: 15000 });
            try { await connection.execute(`SET SESSION max_execution_time = 180000`); } catch(e) {}
            const [rows] = await connection.execute(buildQuery(false), [dateFrom, dateTo]);
            await connection.end();
            res.json({ success: true, data: rows, count: rows.length });
        }
    } catch (error) {
        console.error('Dispensing query error:', error);
        res.json({ success: false, error: error.message });
    }
});

// 9y. ดึงข้อมูล Dispensing สำหรับ SSOP (รหัสกำกับสิทธิ SS)
app.post('/api/get-ssop-dispensing', async (req, res) => {
    try {
        const { host, port, database, user, password, dateFrom, dateTo, selectedPttypes, type, hipdata_code } = req.body;
        const hipdataCode = hipdata_code || 'SSS';

        let pttypeCondition = '';
        if (selectedPttypes && selectedPttypes.length > 0) {
            const pttypeList = selectedPttypes.map(pt => `'${pt}'`).join(',');
            pttypeCondition = `AND ov.pttype IN (${pttypeList})`;
        } else {
            pttypeCondition = `AND ov.pttype IN (SELECT p.pttype FROM pttype p WHERE p.isuse='Y' AND ${hipdataFilter(hipdataCode)})`;
        }

        const buildQuery = (pg) => {
            const ph1 = pg ? '$1' : '?';
            const ph2 = pg ? '$2' : '?';
            return `
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
                  'SS' AS benefitplan,
                  '1' AS dispestat,
                  ov.vn AS svid,
                  NULL AS daycover
                FROM ovst ov
                  LEFT JOIN patient pa ON pa.hn = ov.hn
                  LEFT JOIN rcpt_debt rc ON rc.vn = ov.vn
                  LEFT JOIN opitemrece oi ON oi.vn = ov.vn
                  LEFT JOIN ovstdiag di ON di.vn = ov.vn AND di.diagtype = '1'
                  LEFT JOIN doctor d ON d.code = di.doctor
                WHERE ov.vstdate BETWEEN ${ph1} AND ${ph2}
                ${pttypeCondition}
                AND ov.vn IN (SELECT vn FROM opitemrece WHERE ${pg ? 'vstdate::date' : 'DATE(vstdate)'} BETWEEN ${ph1} AND ${ph2} AND paidst = '02')
                GROUP BY ov.vn, ov.vstdate,
                  pa.pname, pa.fname, pa.lname, pa.hn, pa.cid,
                  rc.paid
                ORDER BY ov.vn
            `;
        };

        if (type === 'postgresql') {
            const client = new PgClient({ host, port, user, password, database, connectionTimeoutMillis: 15000 });
            await client.connect();
            await client.query(`SET statement_timeout = 180000`);
            const result = await client.query(buildQuery(true), [dateFrom, dateTo]);
            await client.end();
            res.json({ success: true, data: result.rows, count: result.rows.length });
        } else {
            const connection = await mysql.createConnection({ host, port, user, password, database, connectTimeout: 15000 });
            try { await connection.execute(`SET SESSION max_execution_time = 180000`); } catch(e) {}
            const [rows] = await connection.execute(buildQuery(false), [dateFrom, dateTo]);
            await connection.end();
            res.json({ success: true, data: rows, count: rows.length });
        }
    } catch (error) {
        console.error('SSOP Dispensing query error:', error);
        res.json({ success: false, error: error.message });
    }
});

// 10. ดึงข้อมูล OPDx
app.post('/api/get-opdx', async (req, res) => {
    try {
        const { host, port, database, user, password, dateFrom, dateTo, selectedPttypes, type, hipdata_code } = req.body;
        const hipdataCode = hipdata_code || 'SSS';

        let pttypeCondition = '';
        if (selectedPttypes && selectedPttypes.length > 0) {
            const pttypeList = selectedPttypes.map(pt => `'${pt}'`).join(',');
            pttypeCondition = `AND ov.pttype IN (${pttypeList})`;
        } else {
            pttypeCondition = `AND ov.pttype IN (SELECT p.pttype FROM pttype p WHERE p.isuse='Y' AND ${hipdataFilter(hipdataCode)})`;
        }

        const buildQuery = (pg) => `
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
            WHERE ov.vstdate BETWEEN ${pg ? '$1' : '?'} AND ${pg ? '$2' : '?'}
            ${pttypeCondition}
            AND ov.vn IN (SELECT vn FROM opitemrece WHERE ${pg ? 'vstdate::date' : 'DATE(vstdate)'} BETWEEN ${pg ? '$1' : '?'} AND ${pg ? '$2' : '?'} AND paidst = '02')
            ORDER BY ov.vn, sl
        `;

        if (type === 'postgresql') {
            const client = new PgClient({ host, port, user, password, database, connectionTimeoutMillis: 10000 });
            await client.connect();
            const result = await client.query(buildQuery(true), [dateFrom, dateTo]);
            await client.end();
            res.json({ success: true, data: result.rows, count: result.rows.length });
        } else {
            const connection = await mysql.createConnection({ host, port, user, password, database, connectTimeout: 10000 });
            const [rows] = await connection.execute(buildQuery(false), [dateFrom, dateTo, dateFrom, dateTo]);
            await connection.end();
            res.json({ success: true, data: rows, count: rows.length });
        }
    } catch (error) {
        console.error('OPDx query error:', error);
        res.json({ success: false, error: error.message });
    }
});

// ==================== FDH Endpoints ====================

// FDH - Dropdown สิทธิการรักษา
app.post('/api/get-fdh-pttype-list', async (req, res) => {
    try {
        const { host, port, database, user, password, type } = req.body;
        const query = `SELECT p.pttype, p.name, p.hipdata_code FROM pttype p WHERE p.isuse='Y' ORDER BY p.pttype`;
        if (type === 'postgresql') {
            const client = new PgClient({ host, port, user, password, database, connectionTimeoutMillis: 5000 });
            await client.connect();
            const result = await client.query(query);
            await client.end();
            res.json({ success: true, data: result.rows });
        } else {
            const connection = await mysql.createConnection({ host, port, user, password, database, connectTimeout: 5000 });
            const [rows] = await connection.execute(query);
            await connection.end();
            res.json({ success: true, data: rows });
        }
    } catch (error) {
        console.error('FDH pttype list error:', error);
        res.json({ success: false, error: error.message });
    }
});

// FDH - Dropdown กลุ่มสิทธิ (hipdata_code)
app.post('/api/get-fdh-hipdata-groups', async (req, res) => {
    try {
        const { host, port, database, user, password, type } = req.body;
        const query = `SELECT p.hipdata_code FROM pttype p WHERE p.isuse='Y' GROUP BY p.hipdata_code ORDER BY p.hipdata_code`;
        if (type === 'postgresql') {
            const client = new PgClient({ host, port, user, password, database, connectionTimeoutMillis: 5000 });
            await client.connect();
            const result = await client.query(query);
            await client.end();
            res.json({ success: true, data: result.rows });
        } else {
            const connection = await mysql.createConnection({ host, port, user, password, database, connectTimeout: 5000 });
            const [rows] = await connection.execute(query);
            await connection.end();
            res.json({ success: true, data: rows });
        }
    } catch (error) {
        console.error('FDH hipdata groups error:', error);
        res.json({ success: false, error: error.message });
    }
});

// ECLAIM - Dropdown สิทธิการรักษา
app.post('/api/get-eclaim-pttype-list', async (req, res) => {
    try {
        const { host, port, database, user, password, type } = req.body;
        const query = `SELECT p.pttype, p.name FROM pttype p WHERE p.isuse='Y' AND p.hipdata_code IN ('UCS','WEL','LGO','OFC','STP','') ORDER BY p.pttype`;
        if (type === 'postgresql') {
            const client = new PgClient({ host, port, user, password, database, connectionTimeoutMillis: 5000 });
            await client.connect();
            const result = await client.query(query);
            await client.end();
            res.json({ success: true, data: result.rows });
        } else {
            const connection = await mysql.createConnection({ host, port, user, password, database, connectTimeout: 5000 });
            const [rows] = await connection.execute(query);
            await connection.end();
            res.json({ success: true, data: rows });
        }
    } catch (error) {
        console.error('ECLAIM pttype list error:', error);
        res.json({ success: false, error: error.message });
    }
});

// FDH - INS สิทธิการรักษา
app.post('/api/get-fdh-ins', async (req, res) => {
    try {
        const { host, port, database, user, password, type, dateFrom, dateTo, selectedPttypes, selectedGroups, hipdata_code, includeOpd, includeIpd } = req.body;

        // checkbox OPD/IPD — ไม่ส่งมา/ส่งมาเป็น true = รวมฝั่งนั้นด้วย (ค่าเริ่มต้นเดิมของเมนูนี้คือแสดงทั้งสองฝั่ง)
        const useOpd = includeOpd !== false;
        const useIpd = includeIpd !== false;

        // กลุ่มสิทธิ (hipdata_code) ที่เลือก — ใช้กรอง v.pttype (OPD) และ vp.pttype (IPD)
        let groupCond;
        if (selectedGroups && selectedGroups.length > 0) {
            const list = selectedGroups.map(g => `'${g}'`).join(',');
            groupCond = `hipdata_code IN (${list})`;
        } else {
            groupCond = hipdataFilter(hipdata_code || 'FDH');
        }

        // รหัสสิทธิเฉพาะที่เลือก (vp.pttype) — ถ้าไม่เลือกจะไม่กรองเพิ่ม (แสดงทุกรหัสในกลุ่มที่เลือก)
        const pttypeCond = (selectedPttypes && selectedPttypes.length > 0)
            ? `AND vp.pttype IN (${selectedPttypes.map(p => `'${p}'`).join(',')})`
            : '';

        const isPg = type === 'postgresql';
        const dateOnly = (col) => isPg ? `${col}::date` : `DATE(${col})`;

        // standalone=true เมื่อติ๊กเฉพาะ OPD เพียงฝั่งเดียว (an ว่างไว้ เพราะ AN เป็นของฝั่ง IPD เท่านั้น)
        // standalone=false เมื่อใช้รวมกับ IPD แบบ UNION ALL (คิวรี่เดิม — an = vp.vn ตามเดิม)
        const opdQuery = (ph1, ph2, standalone) => `
            SELECT
              ${dateOnly('v.vstdate')} AS visit_date, CONCAT(pt.pname,pt.fname,' ',pt.lname) AS ptname,
              p.name AS pttype_name,
              pt.hn, p.hipdata_code AS INSCL,
              CASE WHEN p.hipdata_code IS NOT NULL THEN 'Y' ELSE 'N' END AS check_INSCL,
              vp.pttype AS SUBTYPE,
              pt.cid,
              CASE WHEN pt.cid IS NOT NULL THEN 'Y' ELSE 'N' END AS check_cid,
              (SELECT hospitalcode FROM opdconfig) AS HCODE,
              vp.expire_date AS DATEEXP,
              vp.hospmain AS HOSPMAIN,
              CASE WHEN vp.hospmain IS NOT NULL AND vp.hospmain<>'' THEN 'Y' ELSE 'N' END AS check_HOSPMAIN,
              vp.hospsub AS HOSPSUB,
              CASE WHEN vp.hospsub IS NOT NULL AND vp.hospsub<>'' THEN 'Y' ELSE 'N' END AS check_HOSPSUB,
              '' AS GOVCODE,
              '' AS GOVNAME,
              vp.auth_code AS PERMITNO,
              CASE WHEN vp.auth_code IS NOT NULL THEN 'Y' ELSE 'N' END AS check_PERMITNO,
              '' AS DOCNO,
              '' AS OWNRPID,
              '' AS OWNNAME,
              ${standalone ? "''" : 'vp.vn'} AS an,
              vp.vn AS SEQ,
              p.nhso_code AS SUBINSCL,
              '' AS RELINSCL,
              '1' AS HTYPE
            FROM ovst v
              LEFT OUTER JOIN patient pt ON pt.hn = v.hn
              LEFT OUTER JOIN visit_pttype vp ON vp.vn = v.vn
              LEFT OUTER JOIN pttype p ON p.pttype = vp.pttype
            WHERE v.vstdate BETWEEN ${ph1} AND ${ph2}
              AND v.pttype IN (SELECT p.pttype FROM pttype p WHERE p.isuse='Y' AND ${groupCond})
              ${pttypeCond}
        `;

        const ipdQuery = (ph1, ph2) => `
            SELECT
              ${dateOnly('v.dchdate')} AS visit_date, CONCAT(pt.pname,pt.fname,' ',pt.lname) AS ptname,
              p.name AS pttype_name,
              pt.hn, p.hipdata_code AS INSCL,
              CASE WHEN p.hipdata_code IS NOT NULL THEN 'Y' ELSE 'N' END AS check_INSCL,
              vp.pttype AS SUBTYPE,
              pt.cid,
              CASE WHEN pt.cid IS NOT NULL THEN 'Y' ELSE 'N' END AS check_cid,
              (SELECT hospitalcode FROM opdconfig) AS HCODE,
              vp.expire_date AS DATEEXP,
              vp.hospmain AS HOSPMAIN,
              CASE WHEN vp.hospmain IS NOT NULL AND vp.hospmain<>'' THEN 'Y' ELSE 'N' END AS check_HOSPMAIN,
              vp.hospsub AS HOSPSUB,
              CASE WHEN vp.hospsub IS NOT NULL AND vp.hospsub<>'' THEN 'Y' ELSE 'N' END AS check_HOSPSUB,
              '' AS GOVCODE,
              '' AS GOVNAME,
              vp.auth_code AS PERMITNO,
              CASE WHEN vp.auth_code IS NOT NULL THEN 'Y' ELSE 'N' END AS check_PERMITNO,
              '' AS DOCNO,
              '' AS OWNRPID,
              '' AS OWNNAME,
              vp.an AS an,
              v.vn AS SEQ,
              p.nhso_code AS SUBINSCL,
              '' AS RELINSCL,
              '1' AS HTYPE
            FROM ipt v
              LEFT OUTER JOIN patient pt ON pt.hn = v.hn
              LEFT OUTER JOIN ipt_pttype vp ON vp.an = v.an
              LEFT OUTER JOIN pttype p ON p.pttype = vp.pttype
            WHERE v.dchdate BETWEEN ${ph1} AND ${ph2}
              AND vp.pttype IN (SELECT p.pttype FROM pttype p WHERE p.isuse='Y' AND ${groupCond})
              ${pttypeCond}
        `;

        // ถ้าไม่เลือกฝั่งไหนเลย (กรณีผิดปกติ) ให้ถือว่าแสดงทั้งสองฝั่งเหมือนค่าเริ่มต้น
        const includeBothBranches = useOpd === useIpd; // ทั้งคู่ true หรือทั้งคู่ false
        const branchCount = includeBothBranches ? 2 : 1;
        const buildQuery = (ph1, ph2) => {
            if (includeBothBranches) return `${opdQuery(ph1, ph2, false)} UNION ALL ${ipdQuery(ph1, ph2)}`;
            return useOpd ? opdQuery(ph1, ph2, true) : ipdQuery(ph1, ph2);
        };

        // แปลง Date object ของ visit_date ให้เหลือแค่ YYYY-MM-DD (กันไดรเวอร์คืนเวลามาด้วย)
        const normRows = (rows) => rows.map(r => {
            if (r.visit_date instanceof Date) {
                const d = r.visit_date;
                const y = d.getFullYear();
                const m = String(d.getMonth()+1).padStart(2,'0');
                const dd = String(d.getDate()).padStart(2,'0');
                return { ...r, visit_date: `${y}-${m}-${dd}` };
            }
            return r;
        });

        if (isPg) {
            const query = buildQuery('$1', '$2');
            const client = new PgClient({ host, port, user, password, database, connectionTimeoutMillis: 10000 });
            await client.connect();
            const result = await client.query(query, [dateFrom, dateTo]);
            await client.end();
            const data = normRows(result.rows);
            res.json({ success: true, data, count: data.length });
        } else {
            const query = buildQuery('?', '?');
            const connection = await mysql.createConnection({ host, port, user, password, database, connectTimeout: 10000 });
            const mysqlParams = branchCount === 2 ? [dateFrom, dateTo, dateFrom, dateTo] : [dateFrom, dateTo];
            const [rows] = await connection.execute(query, mysqlParams);
            await connection.end();
            const data = normRows(rows);
            res.json({ success: true, data, count: data.length });
        }
    } catch (error) {
        console.error('FDH INS query error:', error);
        res.json({ success: false, error: error.message });
    }
});

// FDH - PAT ข้อมูลผู้ป่วย
app.post('/api/get-fdh-pat', async (req, res) => {
    try {
        const { host, port, database, user, password, type, dateFrom, dateTo, selectedPttypes, hipdata_code, includeOpd, includeIpd } = req.body;

        // checkbox OPD/IPD — ไม่ส่งมา/ส่งมาเป็น true = รวมฝั่งนั้นด้วย (ค่าเริ่มต้นเดิมของเมนูนี้คือแสดงทั้งสองฝั่ง)
        const useOpd = includeOpd !== false;
        const useIpd = includeIpd !== false;

        const pttypeCondFor = (alias) => {
            const groupCond = `AND ${alias}.pttype IN (SELECT p.pttype FROM pttype p WHERE p.isuse='Y' AND ${hipdataFilter(hipdata_code || 'FDH')})`;
            if (selectedPttypes && selectedPttypes.length > 0) {
                const list = selectedPttypes.map(p => `'${p}'`).join(',');
                return `${groupCond} AND ${alias}.pttype IN (${list})`;
            }
            return groupCond;
        };

        const patSelectCols = `
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
        `;

        const opdQuery = (ph1, ph2) => `
                SELECT ${patSelectCols}
                FROM patient p
                  LEFT OUTER JOIN ovst o ON o.hn = p.hn
                WHERE o.vstdate BETWEEN ${ph1} AND ${ph2}
                ${pttypeCondFor('o')}
        `;

        const ipdQuery = (ph1, ph2) => `
                SELECT ${patSelectCols}
                FROM patient p
                  LEFT OUTER JOIN ipt i ON i.hn = p.hn
                WHERE i.dchdate BETWEEN ${ph1} AND ${ph2}
                ${pttypeCondFor('i')}
        `;

        // ถ้าไม่เลือกฝั่งไหนเลย (กรณีผิดปกติ) ให้ถือว่าแสดงทั้งสองฝั่งเหมือนค่าเริ่มต้น
        const includeBothBranches = useOpd === useIpd; // ทั้งคู่ true หรือทั้งคู่ false
        const branchCount = includeBothBranches ? 2 : 1;
        const buildQuery = (ph1, ph2) => {
            if (includeBothBranches) return `${opdQuery(ph1, ph2)} UNION ALL ${ipdQuery(ph1, ph2)}`;
            return useOpd ? opdQuery(ph1, ph2) : ipdQuery(ph1, ph2);
        };

        if (type === 'postgresql') {
            const query = buildQuery('$1', '$2');
            const client = new PgClient({ host, port, user, password, database, connectionTimeoutMillis: 10000 });
            await client.connect();
            const result = await client.query(query, [dateFrom, dateTo]);
            await client.end();
            res.json({ success: true, data: result.rows, count: result.rows.length });
        } else {
            const query = buildQuery('?', '?');
            const connection = await mysql.createConnection({ host, port, user, password, database, connectTimeout: 10000 });
            const mysqlParams = branchCount === 2 ? [dateFrom, dateTo, dateFrom, dateTo] : [dateFrom, dateTo];
            const [rows] = await connection.execute(query, mysqlParams);
            await connection.end();
            res.json({ success: true, data: rows, count: rows.length });
        }
    } catch (error) {
        console.error('FDH PAT query error:', error);
        res.json({ success: false, error: error.message });
    }
});

// ==================== FDH OPD ====================
app.post('/api/get-fdh-opd', async (req, res) => {
    try {
        const { host, port, database, user, password, type, dateFrom, dateTo, selectedPttypes, hipdata_code } = req.body;

        let pttypeCond;
        if (selectedPttypes && selectedPttypes.length > 0) {
            const list = selectedPttypes.map(p => `'${p}'`).join(',');
            pttypeCond = `AND ovst.pttype IN (${list})`;
        } else {
            pttypeCond = `AND ovst.pttype IN (SELECT p.pttype FROM pttype p WHERE p.isuse='Y' AND ${hipdataFilter(hipdata_code || 'FDH')})`;
        }

        if (type === 'postgresql') {
            const { Client } = require('pg');
            const client = new Client({ host, port: parseInt(port), database, user, password, connectionTimeoutMillis: 10000 });
            await client.connect();
            const query = `
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
                WHERE ovst.vstdate BETWEEN $1 AND $2
                ${pttypeCond}
            `;
            const result = await client.query(query, [dateFrom, dateTo]);
            await client.end();
            res.json({ success: true, data: result.rows, count: result.rows.length });
        } else {
            const mysql = require('mysql2/promise');
            const query = `
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
                WHERE ovst.vstdate BETWEEN ? AND ?
                ${pttypeCond}
            `;
            const connection = await mysql.createConnection({ host, port, user, password, database, connectTimeout: 10000 });
            const [rows] = await connection.execute(query, [dateFrom, dateTo]);
            await connection.end();
            res.json({ success: true, data: rows, count: rows.length });
        }
    } catch (error) {
        console.error('FDH OPD query error:', error);
        res.json({ success: false, error: error.message });
    }
});

// ==================== FDH ORF ====================
app.post('/api/get-fdh-orf', async (req, res) => {
    try {
        const { host, port, database, user, password, type, dateFrom, dateTo, selectedPttypes, hipdata_code } = req.body;

        let pttypeCond;
        if (selectedPttypes && selectedPttypes.length > 0) {
            const list = selectedPttypes.map(p => `'${p}'`).join(',');
            pttypeCond = `AND v.pttype IN (${list})`;
        } else {
            pttypeCond = `AND v.pttype IN (SELECT p.pttype FROM pttype p WHERE p.isuse='Y' AND ${hipdataFilter(hipdata_code || 'FDH')})`;
        }

        const queryStr = `
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
            WHERE v.vstdate BETWEEN ${type === 'postgresql' ? '$1' : '?'} AND ${type === 'postgresql' ? '$2' : '?'}
            ${pttypeCond}
            AND (ro.vn = v.vn OR rn.vn = v.vn)
            ORDER BY v.hn, v.vstdate, ro.refer_hospcode, ro.refer_type
        `;

        if (type === 'postgresql') {
            const { Client } = require('pg');
            const client = new Client({ host, port: parseInt(port), database, user, password, connectionTimeoutMillis: 10000 });
            await client.connect();
            const result = await client.query(queryStr, [dateFrom, dateTo]);
            await client.end();
            res.json({ success: true, data: result.rows, count: result.rows.length });
        } else {
            const mysql = require('mysql2/promise');
            const connection = await mysql.createConnection({ host, port, user, password, database, connectTimeout: 10000 });
            const [rows] = await connection.execute(queryStr, [dateFrom, dateTo]);
            await connection.end();
            res.json({ success: true, data: rows, count: rows.length });
        }
    } catch (error) {
        console.error('FDH ORF query error:', error);
        res.json({ success: false, error: error.message });
    }
});

// ==================== FDH ODX ====================
app.post('/api/get-fdh-odx', async (req, res) => {
    try {
        const { host, port, database, user, password, type, dateFrom, dateTo, selectedPttypes, hipdata_code } = req.body;

        let pttypeCond;
        if (selectedPttypes && selectedPttypes.length > 0) {
            const list = selectedPttypes.map(p => `'${p}'`).join(',');
            pttypeCond = `AND v.pttype IN (${list})`;
        } else {
            pttypeCond = `AND v.pttype IN (SELECT p.pttype FROM pttype p WHERE p.isuse='Y' AND ${hipdataFilter(hipdata_code || 'FDH')})`;
        }

        const ph1 = type === 'postgresql' ? '$1' : '?';
        const ph2 = type === 'postgresql' ? '$2' : '?';
        const queryStr = `
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
            WHERE v.vstdate BETWEEN ${ph1} AND ${ph2}
            ${pttypeCond}
            ORDER BY v.hn, o1.diagtype, o1.diag_no, o1.ovst_diag_id
        `;

        if (type === 'postgresql') {
            const { Client } = require('pg');
            const client = new Client({ host, port: parseInt(port), database, user, password, connectionTimeoutMillis: 10000 });
            await client.connect();
            const result = await client.query(queryStr, [dateFrom, dateTo]);
            await client.end();
            res.json({ success: true, data: result.rows, count: result.rows.length });
        } else {
            const mysql = require('mysql2/promise');
            const connection = await mysql.createConnection({ host, port, user, password, database, connectTimeout: 10000 });
            const [rows] = await connection.execute(queryStr, [dateFrom, dateTo]);
            await connection.end();
            res.json({ success: true, data: rows, count: rows.length });
        }
    } catch (error) {
        console.error('FDH ODX query error:', error);
        res.json({ success: false, error: error.message });
    }
});

// ==================== FDH OOP ====================
app.post('/api/get-fdh-oop', async (req, res) => {
    try {
        const { host, port, database, user, password, type, dateFrom, dateTo, selectedPttypes, hipdata_code } = req.body;

        let pttypeCond;
        if (selectedPttypes && selectedPttypes.length > 0) {
            const list = selectedPttypes.map(p => `'${p}'`).join(',');
            pttypeCond = `AND o.pttype IN (${list})`;
        } else {
            pttypeCond = `AND o.pttype IN (SELECT p.pttype FROM pttype p WHERE p.isuse='Y' AND ${hipdataFilter(hipdata_code || 'FDH')})`;
        }

        const ph1 = type === 'postgresql' ? '$1' : '?';
        const ph2 = type === 'postgresql' ? '$2' : '?';
        const queryStr = `
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
            WHERE o.vstdate BETWEEN ${ph1} AND ${ph2}
            ${pttypeCond}
        `;

        if (type === 'postgresql') {
            const { Client } = require('pg');
            const client = new Client({ host, port: parseInt(port), database, user, password, connectionTimeoutMillis: 10000 });
            await client.connect();
            const result = await client.query(queryStr, [dateFrom, dateTo]);
            await client.end();
            res.json({ success: true, data: result.rows, count: result.rows.length });
        } else {
            const mysql = require('mysql2/promise');
            const connection = await mysql.createConnection({ host, port, user, password, database, connectTimeout: 10000 });
            const [rows] = await connection.execute(queryStr, [dateFrom, dateTo]);
            await connection.end();
            res.json({ success: true, data: rows, count: rows.length });
        }
    } catch (error) {
        console.error('FDH OOP query error:', error);
        res.json({ success: false, error: error.message });
    }
});

// ==================== FDH IRF ====================
app.post('/api/get-fdh-irf', async (req, res) => {
    try {
        const { host, port, database, user, password, type, dateFrom, dateTo, selectedPttypes, hipdata_code } = req.body;

        let pttypeCond;
        if (selectedPttypes && selectedPttypes.length > 0) {
            const list = selectedPttypes.map(p => `'${p}'`).join(',');
            pttypeCond = `AND ip.pttype IN (${list})`;
        } else {
            pttypeCond = `AND ip.pttype IN (SELECT p.pttype FROM pttype p WHERE p.isuse='Y' AND ${hipdataFilter(hipdata_code || 'FDH')})`;
        }

        const ph1 = type === 'postgresql' ? '$1' : '?';
        const ph2 = type === 'postgresql' ? '$2' : '?';
        const queryStr = `
            SELECT ip.an,
              r.refer_hospcode AS refer,
              CASE WHEN r.refer_hospcode <> '' THEN 'Y' ELSE 'N' END AS check_refer,
              rn.vn AS referin,
              r.vn AS referout,
              CASE WHEN (rn.vn IS NOT NULL OR r.vn IS NOT NULL) THEN 'Y' ELSE 'N' END AS check_refertype
            FROM ipt ip
              LEFT OUTER JOIN referout r ON r.vn = ip.an
              LEFT OUTER JOIN referin rn ON rn.vn = ip.an
            WHERE ip.dchdate BETWEEN ${ph1} AND ${ph2}
            ${pttypeCond}
            AND LENGTH(r.vn) > 0
        `;

        if (type === 'postgresql') {
            const { Client } = require('pg');
            const client = new Client({ host, port: parseInt(port), database, user, password, connectionTimeoutMillis: 10000 });
            await client.connect();
            const result = await client.query(queryStr, [dateFrom, dateTo]);
            await client.end();
            res.json({ success: true, data: result.rows, count: result.rows.length });
        } else {
            const mysql = require('mysql2/promise');
            const connection = await mysql.createConnection({ host, port, user, password, database, connectTimeout: 10000 });
            const [rows] = await connection.execute(queryStr, [dateFrom, dateTo]);
            await connection.end();
            res.json({ success: true, data: rows, count: rows.length });
        }
    } catch (error) {
        console.error('FDH IRF query error:', error);
        res.json({ success: false, error: error.message });
    }
});

// ==================== FDH IPD ====================
app.post('/api/get-fdh-ipd', async (req, res) => {
    try {
        const { host, port, database, user, password, type, dateFrom, dateTo, selectedPttypes, hipdata_code } = req.body;

        let pttypeCond;
        if (selectedPttypes && selectedPttypes.length > 0) {
            const list = selectedPttypes.map(p => `'${p}'`).join(',');
            pttypeCond = `AND ipt.pttype IN (${list})`;
        } else {
            pttypeCond = `AND ipt.pttype IN (SELECT p.pttype FROM pttype p WHERE p.isuse='Y' AND ${hipdataFilter(hipdata_code || 'FDH')})`;
        }

        const ph1 = type === 'postgresql' ? '$1' : '?';
        const ph2 = type === 'postgresql' ? '$2' : '?';
        const queryStr = `
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
            WHERE ipt.dchdate BETWEEN ${ph1} AND ${ph2}
            ${pttypeCond}
        `;

        if (type === 'postgresql') {
            const { Client } = require('pg');
            const client = new Client({ host, port: parseInt(port), database, user, password, connectionTimeoutMillis: 10000 });
            await client.connect();
            const result = await client.query(queryStr, [dateFrom, dateTo]);
            await client.end();
            res.json({ success: true, data: result.rows, count: result.rows.length });
        } else {
            const mysql = require('mysql2/promise');
            const connection = await mysql.createConnection({ host, port, user, password, database, connectTimeout: 10000 });
            const [rows] = await connection.execute(queryStr, [dateFrom, dateTo]);
            await connection.end();
            res.json({ success: true, data: rows, count: rows.length });
        }
    } catch (error) {
        console.error('FDH IPD query error:', error);
        res.json({ success: false, error: error.message });
    }
});

// ==================== FDH IOP ====================
app.post('/api/get-fdh-iop', async (req, res) => {
    try {
        const { host, port, database, user, password, type, dateFrom, dateTo, selectedPttypes, hipdata_code } = req.body;

        let pttypeCond;
        if (selectedPttypes && selectedPttypes.length > 0) {
            const list = selectedPttypes.map(p => `'${p}'`).join(',');
            pttypeCond = `AND i.pttype IN (${list})`;
        } else {
            pttypeCond = `AND i.pttype IN (SELECT p.pttype FROM pttype p WHERE p.isuse='Y' AND ${hipdataFilter(hipdata_code || 'FDH')})`;
        }

        const ph1 = type === 'postgresql' ? '$1' : '?';
        const ph2 = type === 'postgresql' ? '$2' : '?';
        const queryStr = `
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
            WHERE i.dchdate BETWEEN ${ph1} AND ${ph2}
            ${pttypeCond}
            ORDER BY op.an, op.priority
        `;

        if (type === 'postgresql') {
            const { Client } = require('pg');
            const client = new Client({ host, port: parseInt(port), database, user, password, connectionTimeoutMillis: 10000 });
            await client.connect();
            const result = await client.query(queryStr, [dateFrom, dateTo]);
            await client.end();
            res.json({ success: true, data: result.rows, count: result.rows.length });
        } else {
            const mysql = require('mysql2/promise');
            const connection = await mysql.createConnection({ host, port, user, password, database, connectTimeout: 10000 });
            const [rows] = await connection.execute(queryStr, [dateFrom, dateTo]);
            await connection.end();
            res.json({ success: true, data: rows, count: rows.length });
        }
    } catch (error) {
        console.error('FDH IOP query error:', error);
        res.json({ success: false, error: error.message });
    }
});

// ==================== FDH CHT ====================
app.post('/api/get-fdh-cht', async (req, res) => {
    try {
        const { host, port, database, user, password, type, dateFrom, dateTo, selectedPttypes, hipdata_code } = req.body;

        let opdPttypeCond, ipdPttypeCond;
        if (selectedPttypes && selectedPttypes.length > 0) {
            const list = selectedPttypes.map(p => `'${p}'`).join(',');
            opdPttypeCond = `AND v.pttype IN (${list})`;
            ipdPttypeCond = `AND i.pttype IN (${list})`;
        } else {
            opdPttypeCond = `AND v.pttype IN (SELECT p.pttype FROM pttype p WHERE p.isuse='Y' AND ${hipdataFilter(hipdata_code || 'FDH')})`;
            ipdPttypeCond = `AND i.pttype IN (SELECT p.pttype FROM pttype p WHERE p.isuse='Y' AND ${hipdataFilter(hipdata_code || 'FDH')})`;
        }

        const ph1 = type === 'postgresql' ? '$1' : '?';
        const ph2 = type === 'postgresql' ? '$2' : '?';
        const queryStr = `
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
            WHERE v.vstdate BETWEEN ${ph1} AND ${ph2}
            ${opdPttypeCond}

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
            WHERE i.dchdate BETWEEN ${ph1} AND ${ph2}
            ${ipdPttypeCond}
        `;

        if (type === 'postgresql') {
            const { Client } = require('pg');
            const client = new Client({ host, port: parseInt(port), database, user, password, connectionTimeoutMillis: 10000 });
            await client.connect();
            const result = await client.query(queryStr, [dateFrom, dateTo]);
            await client.end();
            res.json({ success: true, data: result.rows, count: result.rows.length });
        } else {
            const mysql = require('mysql2/promise');
            const connection = await mysql.createConnection({ host, port, user, password, database, connectTimeout: 10000 });
            const [rows] = await connection.execute(queryStr, [dateFrom, dateTo, dateFrom, dateTo]);
            await connection.end();
            res.json({ success: true, data: rows, count: rows.length });
        }
    } catch (error) {
        console.error('FDH CHT query error:', error);
        res.json({ success: false, error: error.message });
    }
});

// ==================== FDH CHA ====================
app.post('/api/get-fdh-cha', async (req, res) => {
    try {
        const { host, port, database, user, password, type, dateFrom, dateTo, selectedPttypes, hipdata_code } = req.body;

        let opdPttypeCond, ipdPttypeCond;
        if (selectedPttypes && selectedPttypes.length > 0) {
            const list = selectedPttypes.map(p => `'${p}'`).join(',');
            opdPttypeCond = `AND ovst.pttype IN (${list})`;
            ipdPttypeCond = `AND ipt.pttype IN (${list})`;
        } else {
            opdPttypeCond = `AND ovst.pttype IN (SELECT p.pttype FROM pttype p WHERE p.isuse='Y' AND ${hipdataFilter(hipdata_code || 'FDH')})`;
            ipdPttypeCond = `AND ipt.pttype IN (SELECT p.pttype FROM pttype p WHERE p.isuse='Y' AND ${hipdataFilter(hipdata_code || 'FDH')})`;
        }

        const ph1 = type === 'postgresql' ? '$1' : '?';
        const ph2 = type === 'postgresql' ? '$2' : '?';
        const queryStr = `
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
            WHERE ovst.vstdate BETWEEN ${ph1} AND ${ph2}
            ${opdPttypeCond}
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
            WHERE ipt.dchdate BETWEEN ${ph1} AND ${ph2}
            ${ipdPttypeCond}
            GROUP BY ipt.an, ipt.hn, pt.pname, pt.fname, pt.lname,
              ipt.dchdate, ipt.ipt_type, pt.cid, t.pcode, d.chrgitem_code1,
              inc.income, ipt.ipt_admit_type_id

            ORDER BY vnan, chrgitem_code1
        `;

        if (type === 'postgresql') {
            const { Client } = require('pg');
            const client = new Client({ host, port: parseInt(port), database, user, password, connectionTimeoutMillis: 10000 });
            await client.connect();
            // PostgreSQL reuses $1/$2 across UNION ALL — only 2 params needed
            const result = await client.query(queryStr, [dateFrom, dateTo]);
            await client.end();
            res.json({ success: true, data: result.rows, count: result.rows.length });
        } else {
            const mysql = require('mysql2/promise');
            const connection = await mysql.createConnection({ host, port, user, password, database, connectTimeout: 10000 });
            // MySQL ? placeholders are positional — need 4 params for 2 WHERE clauses
            const [rows] = await connection.execute(queryStr, [dateFrom, dateTo, dateFrom, dateTo]);
            await connection.end();
            res.json({ success: true, data: rows, count: rows.length });
        }
    } catch (error) {
        console.error('FDH CHA query error:', error);
        res.json({ success: false, error: error.message });
    }
});

// ==================== FDH IDX ====================
app.post('/api/get-fdh-idx', async (req, res) => {
    try {
        const { host, port, database, user, password, type, dateFrom, dateTo, selectedPttypes, hipdata_code } = req.body;

        let pttypeCond;
        if (selectedPttypes && selectedPttypes.length > 0) {
            const list = selectedPttypes.map(p => `'${p}'`).join(',');
            pttypeCond = `AND i2.pttype IN (${list})`;
        } else {
            pttypeCond = `AND i2.pttype IN (SELECT p.pttype FROM pttype p WHERE p.isuse='Y' AND ${hipdataFilter(hipdata_code || 'FDH')})`;
        }

        const ph1 = type === 'postgresql' ? '$1' : '?';
        const ph2 = type === 'postgresql' ? '$2' : '?';
        const queryStr = `
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
            WHERE i2.dchdate BETWEEN ${ph1} AND ${ph2}
            ${pttypeCond}
            ORDER BY i2.an, i1.diagtype, i1.diag_no, i1.ipt_diag_id
        `;

        if (type === 'postgresql') {
            const { Client } = require('pg');
            const client = new Client({ host, port: parseInt(port), database, user, password, connectionTimeoutMillis: 10000 });
            await client.connect();
            const result = await client.query(queryStr, [dateFrom, dateTo]);
            await client.end();
            res.json({ success: true, data: result.rows, count: result.rows.length });
        } else {
            const mysql = require('mysql2/promise');
            const connection = await mysql.createConnection({ host, port, user, password, database, connectTimeout: 10000 });
            const [rows] = await connection.execute(queryStr, [dateFrom, dateTo]);
            await connection.end();
            res.json({ success: true, data: rows, count: rows.length });
        }
    } catch (error) {
        console.error('FDH IDX query error:', error);
        res.json({ success: false, error: error.message });
    }
});

// ==================== FDH ADP ====================
app.post('/api/get-fdh-adp', async (req, res) => {
    try {
        const { host, port, database, user, password, type, dateFrom, dateTo, selectedPttypes, hipdata_code } = req.body;

        let pttypeCond;
        if (selectedPttypes && selectedPttypes.length > 0) {
            const list = selectedPttypes.map(p => `'${p}'`).join(',');
            pttypeCond = `AND vst.pttype IN (${list})`;
        } else {
            pttypeCond = `AND vst.pttype IN (SELECT p.pttype FROM pttype p WHERE p.isuse='Y' AND ${hipdataFilter(hipdata_code || 'FDH')})`;
        }

        const ph1 = type === 'postgresql' ? '$1' : '?';
        const ph2 = type === 'postgresql' ? '$2' : '?';
        const queryStr = `
            SELECT
              (SELECT hospitalcode FROM opdconfig LIMIT 1) AS hcode,
              vst.hn,
              ip.an,
              vst.vn,
              vst.spclty AS clinic,
              v.cid AS person_id,
              vst.vstdate AS date_serv,
              n.nhso_adp_type_id AS adp_type,
              nat.nhso_adp_type_name AS adp_type_name,
              n.nhso_adp_code AS adp_code,
              CASE WHEN n.nhso_adp_code IS NOT NULL AND n.nhso_adp_code <> '' THEN 'Y' ELSE 'N' END AS check_adp_code,
              n.name AS adp_name,
              op.qty AS amount,
              CASE WHEN op.qty IS NOT NULL THEN 'Y' ELSE 'N' END AS check_amount,
              op.unitprice AS adp_price,
              CASE WHEN op.unitprice IS NOT NULL THEN 'Y' ELSE 'N' END AS check_adp_price,
              op.paidst AS use_status,
              SUM(CASE WHEN op.paidst IN ('01','03') THEN op.qty * op.unitprice ELSE 0 END) AS totcopay,
              SUM(CASE WHEN op.paidst IN ('02') THEN op.qty * op.unitprice ELSE 0 END) AS total,
              op.doctor AS provider
            FROM ovst vst
              INNER JOIN opitemrece op ON op.vn = vst.vn AND op.qty > 0 AND op.sum_price > 0 AND op.paidst IN ('01','02','03')
              INNER JOIN nondrugitems n ON n.icode = op.icode AND n.nhso_adp_type_id IS NOT NULL AND n.nhso_adp_type_id <> ''
              LEFT JOIN nhso_adp_type nat ON nat.nhso_adp_type_id = n.nhso_adp_type_id
              LEFT JOIN vn_stat v ON v.vn = vst.vn
              LEFT JOIN ipt ip ON ip.an = vst.an
            WHERE vst.vstdate BETWEEN ${ph1} AND ${ph2}
            ${pttypeCond}
            GROUP BY
              vst.hn, ip.an, vst.vn, vst.spclty, v.cid, vst.vstdate,
              n.nhso_adp_type_id, nat.nhso_adp_type_name, n.nhso_adp_code, n.name,
              op.qty, op.unitprice, op.paidst, op.doctor
            ORDER BY vst.vn
        `;

        if (type === 'postgresql') {
            const { Client } = require('pg');
            const client = new Client({ host, port: parseInt(port), database, user, password, connectionTimeoutMillis: 10000 });
            await client.connect();
            const result = await client.query(queryStr, [dateFrom, dateTo]);
            await client.end();
            res.json({ success: true, data: result.rows, count: result.rows.length });
        } else {
            const mysql = require('mysql2/promise');
            const connection = await mysql.createConnection({ host, port, user, password, database, connectTimeout: 10000 });
            const [rows] = await connection.execute(queryStr, [dateFrom, dateTo]);
            await connection.end();
            res.json({ success: true, data: rows, count: rows.length });
        }
    } catch (error) {
        console.error('FDH ADP query error:', error);
        res.json({ success: false, error: error.message });
    }
});

// ==================== FDH LVD ====================
app.post('/api/get-fdh-lvd', async (req, res) => {
    try {
        const { host, port, database, user, password, type, dateFrom, dateTo, selectedPttypes, hipdata_code } = req.body;

        let pttypeCond;
        if (selectedPttypes && selectedPttypes.length > 0) {
            const list = selectedPttypes.map(p => `'${p}'`).join(',');
            pttypeCond = `AND i.pttype IN (${list})`;
        } else {
            pttypeCond = `AND i.pttype IN (SELECT p.pttype FROM pttype p WHERE p.isuse='Y' AND ${hipdataFilter(hipdata_code || 'FDH')})`;
        }

        if (type === 'postgresql') {
            const { Client } = require('pg');
            const client = new Client({ host, port: parseInt(port), database, user, password, connectionTimeoutMillis: 10000 });
            await client.connect();
            const query = `
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
                WHERE i.dchdate BETWEEN $1 AND $2
                ${pttypeCond}
                AND hl.an = i.an
                ORDER BY hl.an
            `;
            const result = await client.query(query, [dateFrom, dateTo]);
            await client.end();
            res.json({ success: true, data: result.rows, count: result.rows.length });
        } else {
            const mysql = require('mysql2/promise');
            const query = `
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
                WHERE i.dchdate BETWEEN ? AND ?
                ${pttypeCond}
                AND hl.an = i.an
                ORDER BY hl.an
            `;
            const connection = await mysql.createConnection({ host, port, user, password, database, connectTimeout: 10000 });
            const [rows] = await connection.execute(query, [dateFrom, dateTo]);
            await connection.end();
            res.json({ success: true, data: rows, count: rows.length });
        }
    } catch (error) {
        console.error('FDH LVD query error:', error);
        res.json({ success: false, error: error.message });
    }
});

// ==================== FDH DRU ====================
app.post('/api/get-fdh-dru', async (req, res) => {
    try {
        const { host, port, database, user, password, type, dateFrom, dateTo, selectedPttypes, hipdata_code } = req.body;

        let pttypeCond;
        if (selectedPttypes && selectedPttypes.length > 0) {
            const list = selectedPttypes.map(p => `'${p}'`).join(',');
            pttypeCond = `AND vst.pttype IN (${list})`;
        } else {
            pttypeCond = `AND vst.pttype IN (SELECT p.pttype FROM pttype p WHERE p.isuse='Y' AND ${hipdataFilter(hipdata_code || 'FDH')})`;
        }

        const ph1 = type === 'postgresql' ? '$1' : '?';
        const ph2 = type === 'postgresql' ? '$2' : '?';
        const queryStr = `
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
            WHERE vst.vstdate BETWEEN ${ph1} AND ${ph2}
            ${pttypeCond}
            GROUP BY
              vst.hn, ip.an, vst.vn, vst.spclty, v.cid, vst.vstdate,
              di.did, di.name, di.strength, di.units, op.qty, op.unitprice, op.cost,
              di.tmt_tp_code, di.packqty, ned.presc_reason, ned.nhso_authorize_code,
              op.paidst, op.doctor
        `;

        if (type === 'postgresql') {
            const { Client } = require('pg');
            const client = new Client({ host, port: parseInt(port), database, user, password, connectionTimeoutMillis: 10000 });
            await client.connect();
            const result = await client.query(queryStr, [dateFrom, dateTo]);
            await client.end();
            res.json({ success: true, data: result.rows, count: result.rows.length });
        } else {
            const mysql = require('mysql2/promise');
            const connection = await mysql.createConnection({ host, port, user, password, database, connectTimeout: 10000 });
            const [rows] = await connection.execute(queryStr, [dateFrom, dateTo]);
            await connection.end();
            res.json({ success: true, data: rows, count: rows.length });
        }
    } catch (error) {
        console.error('FDH DRU query error:', error);
        res.json({ success: false, error: error.message });
    }
});

// ==================== FDH LABFU ====================
app.post('/api/get-fdh-labfu', async (req, res) => {
    try {
        const { host, port, database, user, password, type, dateFrom, dateTo, selectedPttypes, hipdata_code } = req.body;

        let pttypeCond;
        if (selectedPttypes && selectedPttypes.length > 0) {
            const list = selectedPttypes.map(p => `'${p}'`).join(',');
            pttypeCond = `AND ovst.pttype IN (${list})`;
        } else {
            pttypeCond = `AND ovst.pttype IN (SELECT p.pttype FROM pttype p WHERE p.isuse='Y' AND ${hipdataFilter(hipdata_code || 'FDH')})`;
        }

        const ph1 = type === 'postgresql' ? '$1' : '?';
        const ph2 = type === 'postgresql' ? '$2' : '?';
        const queryStr = `
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
            WHERE ovst.vstdate BETWEEN ${ph1} AND ${ph2}
            ${pttypeCond}
        `;

        if (type === 'postgresql') {
            const { Client } = require('pg');
            const client = new Client({ host, port: parseInt(port), database, user, password, connectionTimeoutMillis: 10000 });
            await client.connect();
            const result = await client.query(queryStr, [dateFrom, dateTo]);
            await client.end();
            res.json({ success: true, data: result.rows, count: result.rows.length });
        } else {
            const mysql = require('mysql2/promise');
            const connection = await mysql.createConnection({ host, port, user, password, database, connectTimeout: 10000 });
            const [rows] = await connection.execute(queryStr, [dateFrom, dateTo]);
            await connection.end();
            res.json({ success: true, data: rows, count: rows.length });
        }
    } catch (error) {
        console.error('FDH LABFU query error:', error);
        res.json({ success: false, error: error.message });
    }
});

// ==================== FDH PHDB ====================
app.post('/api/get-fdh-phdb', async (req, res) => {
    try {
        const { host, port, database, user, password, type, dateFrom, dateTo, selectedPttypes, hipdata_code } = req.body;

        let opdPttypeCond, ipdPttypeCond;
        if (selectedPttypes && selectedPttypes.length > 0) {
            const list = selectedPttypes.map(p => `'${p}'`).join(',');
            opdPttypeCond = `AND vst.pttype IN (${list})`;
            ipdPttypeCond = `AND ipt.pttype IN (${list})`;
        } else {
            opdPttypeCond = `AND vst.pttype IN (SELECT p.pttype FROM pttype p WHERE p.isuse='Y' AND ${hipdataFilter(hipdata_code || 'FDH')})`;
            ipdPttypeCond = `AND ipt.pttype IN (SELECT p.pttype FROM pttype p WHERE p.isuse='Y' AND ${hipdataFilter(hipdata_code || 'FDH')})`;
        }

        const ph1 = type === 'postgresql' ? '$1' : '?';
        const ph2 = type === 'postgresql' ? '$2' : '?';
        const queryStr = `
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
            WHERE vst.vstdate BETWEEN ${ph1} AND ${ph2}
            ${opdPttypeCond}

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
            WHERE ipt.dchdate BETWEEN ${ph1} AND ${ph2}
            ${ipdPttypeCond}
        `;

        if (type === 'postgresql') {
            const { Client } = require('pg');
            const client = new Client({ host, port: parseInt(port), database, user, password, connectionTimeoutMillis: 10000 });
            await client.connect();
            // PostgreSQL: $1/$2 reused across UNION ALL — 2 params only
            const result = await client.query(queryStr, [dateFrom, dateTo]);
            await client.end();
            res.json({ success: true, data: result.rows, count: result.rows.length });
        } else {
            const mysql = require('mysql2/promise');
            const connection = await mysql.createConnection({ host, port, user, password, database, connectTimeout: 10000 });
            // MySQL: positional ? — 4 params for 2 WHERE clauses
            const [rows] = await connection.execute(queryStr, [dateFrom, dateTo, dateFrom, dateTo]);
            await connection.end();
            res.json({ success: true, data: rows, count: rows.length });
        }
    } catch (error) {
        console.error('FDH PHDB query error:', error);
        res.json({ success: false, error: error.message });
    }
});

// ==================== IPN (IPD generic) ====================

// IPN - IPADT (IPD Admit) - reuse get-fdh-ipd logic
app.post('/api/get-ipn-ipadt', async (req, res) => {
    try {
        const { host, port, database, user, password, type, dateFrom, dateTo, selectedPttypes, hipdata_code } = req.body;
        let pttypeCond;
        if (selectedPttypes && selectedPttypes.length > 0) {
            const list = selectedPttypes.map(p => `'${p}'`).join(',');
            pttypeCond = `AND ipt.pttype IN (${list})`;
        } else {
            pttypeCond = `AND ipt.pttype IN (SELECT p.pttype FROM pttype p WHERE p.isuse='Y' AND ${hipdataFilter(hipdata_code || 'OFC')})`;
        }
        const ph1 = type === 'postgresql' ? '$1' : '?';
        const ph2 = type === 'postgresql' ? '$2' : '?';
        const queryStr = `
            SELECT ipt.hn, ipt.an,
              ipt.regdate, CASE WHEN ipt.regdate IS NULL THEN 'N' ELSE 'Y' END AS check_dateadm,
              ipt.regtime, CASE WHEN ipt.regtime IS NULL THEN 'N' ELSE 'Y' END AS check_timeadm,
              ipt.dchdate, CASE WHEN ipt.dchdate IS NULL THEN 'N' ELSE 'Y' END AS check_datedsc,
              ipt.dchtime, CASE WHEN ipt.dchtime IS NULL THEN 'N' ELSE 'Y' END AS check_timedsc,
              dt.name AS dchstts, CASE WHEN ipt.dchstts IS NULL THEN 'N' ELSE 'Y' END AS check_dischs,
              dp.name AS dchtype, CASE WHEN ipt.dchtype IS NULL THEN 'N' ELSE 'Y' END AS check_discht,
              w.name AS first_ward, CASE WHEN ipt.first_ward IS NULL THEN 'N' ELSE 'Y' END AS check_warddsc,
              s.name AS spclty, CASE WHEN ipt.spclty IS NULL THEN 'N' ELSE 'Y' END AS check_dept,
              ipt.bw, CASE WHEN ipt.bw IS NULL THEN 'N' ELSE 'Y' END AS check_adm_w,
              pt.pname, pt.fname, pt.lname, pt.cid
            FROM ipt
              LEFT JOIN dchstts dt ON dt.dchstts = ipt.dchstts
              LEFT JOIN dchtype dp ON dp.dchtype = ipt.dchtype
              LEFT JOIN ward w ON w.ward = ipt.first_ward
              LEFT JOIN spclty s ON s.spclty = ipt.spclty
              LEFT JOIN patient pt ON pt.hn = ipt.hn
            WHERE ipt.dchdate BETWEEN ${ph1} AND ${ph2}
            ${pttypeCond}
        `;
        if (type === 'postgresql') {
            const client = new PgClient({ host, port: parseInt(port), database, user, password, connectionTimeoutMillis: 10000 });
            await client.connect();
            const result = await client.query(queryStr, [dateFrom, dateTo]);
            await client.end();
            res.json({ success: true, data: result.rows, count: result.rows.length });
        } else {
            const connection = await mysql.createConnection({ host, port, user, password, database, connectTimeout: 10000 });
            const [rows] = await connection.execute(queryStr, [dateFrom, dateTo]);
            await connection.end();
            res.json({ success: true, data: rows, count: rows.length });
        }
    } catch (error) {
        console.error('IPN IPADT error:', error);
        res.json({ success: false, error: error.message });
    }
});

// CIPN - IPADT (ข้าราชการผู้ป่วยใน)
app.post('/api/get-cipn-ipadt', async (req, res) => {
    try {
        const { host, port, database, user, password, type, dateFrom, dateTo, selectedPttypes, hipdata_code } = req.body;
        const hcode = hipdata_code || 'OFC';
        let pttypeCond = '';
        if (selectedPttypes && selectedPttypes.length > 0) {
            const list = selectedPttypes.map(p => `'${p}'`).join(',');
            pttypeCond = `AND i.pttype IN (${list})`;
        }
        const ph1 = type === 'postgresql' ? '$1' : '?';
        const ph2 = type === 'postgresql' ? '$2' : '?';
        const queryStr = `
            SELECT
              i.an, i.hn,
              pc.cardtype AS idtype,
              p.cid AS pidpat,
              p.pname AS title,
              CONCAT(p.fname, ' ', p.lname) AS namepat,
              p.birthday AS dob,
              p.sex,
              p.marrystatus AS marriage,
              p.chwpart AS changwat,
              p.amppart AS amphur,
              p.nationality AS nation,
              i.ipt_type AS admtype,
              (CASE
                WHEN i.ipt_type='1' THEN 'O'
                WHEN i.ipt_type='3' THEN 'B'
                WHEN i.ipt_type='2' THEN 'E'
                ELSE 'O' END) AS admsource,
              (i.regdate+i.regtime) AS dtadm,
              (i.dchdate+i.dchtime) AS dtdisch,
              (ih.dch_date - ih.reg_date) AS leaveday,
              i.dchstts AS dischstat,
              i.dchtype AS dischtype,
              CASE
                WHEN a.age_y = 0 AND a.age_m = 0 AND a.age_d < 28 THEN ROUND(i.bw / 1000.0, 3)
                ELSE ROUND(i.bw / 1000.0, 0)
              END AS admwt,
              i.ward AS dischwward,
              s.nhso_code AS dept
            FROM ipt i
              LEFT JOIN an_stat a ON a.an = i.an
              INNER JOIN patient p ON p.hn = i.hn
              LEFT JOIN ptcardno pc ON pc.hn = p.hn
              LEFT JOIN ward w ON w.ward = i.ward
              LEFT JOIN ipt_home_leave ih ON ih.an = i.an
              LEFT JOIN spclty s ON s.spclty = i.spclty
            WHERE i.dchdate BETWEEN ${ph1} AND ${ph2}
            AND i.pttype IN (SELECT pttype FROM pttype WHERE isuse = 'Y' AND ${hipdataFilter(hcode)})
            ${pttypeCond}
            ORDER BY i.dchdate, i.an
        `;
        if (type === 'postgresql') {
            const client = new PgClient({ host, port: parseInt(port), database, user, password, connectionTimeoutMillis: 15000 });
            await client.connect();
            const result = await client.query(queryStr, [dateFrom, dateTo]);
            await client.end();
            res.json({ success: true, data: result.rows, count: result.rows.length });
        } else {
            const connection = await mysql.createConnection({ host, port, user, password, database, connectTimeout: 15000 });
            const [rows] = await connection.execute(queryStr, [dateFrom, dateTo]);
            await connection.end();
            res.json({ success: true, data: rows, count: rows.length });
        }
    } catch (error) {
        console.error('CIPN IPADT error:', error);
        res.json({ success: false, error: error.message });
    }
});

// CIPN - IPDX (ข้าราชการผู้ป่วยใน การวินิจฉัย)
app.post('/api/get-cipn-ipdx', async (req, res) => {
    try {
        const { host, port, database, user, password, type, dateFrom, dateTo, selectedPttypes, hipdata_code } = req.body;
        const hcode = hipdata_code || 'OFC';
        let pttypeCond = '';
        if (selectedPttypes && selectedPttypes.length > 0) {
            const list = selectedPttypes.map(p => `'${p}'`).join(',');
            pttypeCond = `AND i.pttype IN (${list})`;
        }
        const ph1 = type === 'postgresql' ? '$1' : '?';
        const ph2 = type === 'postgresql' ? '$2' : '?';
        const queryStr = `
            SELECT
              i.dchdate,
              CONCAT(p.pname, p.fname, ' ', p.lname) AS ptname,
              i.an,
              i.hn,
              ROW_NUMBER() OVER (PARTITION BY i.an ORDER BY it.ipt_diag_id) AS sequence,
              it.diagtype AS dxtype,
              'ICD10' AS codesys,
              it.icd10 AS code,
              i1.name AS diagterm,
              d.licenseno AS dr,
              DATE(it.entry_datetime) AS datediag
            FROM ipt i
              LEFT JOIN an_stat a ON a.an = i.an
              INNER JOIN patient p ON p.hn = i.hn
              LEFT JOIN iptdiag it ON it.an = i.an
              LEFT JOIN icd101 i1 ON i1.code = it.icd10
              LEFT JOIN doctor d ON d.code = it.doctor
            WHERE i.dchdate BETWEEN ${ph1} AND ${ph2}
            AND i.pttype IN (SELECT pttype FROM pttype WHERE isuse = 'Y' AND ${hipdataFilter(hcode)})
            ${pttypeCond}
            ORDER BY i.dchdate, i.an
        `;
        if (type === 'postgresql') {
            const client = new PgClient({ host, port: parseInt(port), database, user, password, connectionTimeoutMillis: 15000 });
            await client.connect();
            const result = await client.query(queryStr, [dateFrom, dateTo]);
            await client.end();
            res.json({ success: true, data: result.rows, count: result.rows.length });
        } else {
            const connection = await mysql.createConnection({ host, port, user, password, database, connectTimeout: 15000 });
            const [rows] = await connection.execute(queryStr, [dateFrom, dateTo]);
            await connection.end();
            res.json({ success: true, data: rows, count: rows.length });
        }
    } catch (error) {
        console.error('CIPN IPDX error:', error);
        res.json({ success: false, error: error.message });
    }
});

// CIPN - IPOp (ข้าราชการผู้ป่วยใน หัตถการ)
app.post('/api/get-cipn-ipop', async (req, res) => {
    try {
        const { host, port, database, user, password, type, dateFrom, dateTo, selectedPttypes, hipdata_code } = req.body;
        const hcode = hipdata_code || 'OFC';
        let pttypeCond = '';
        if (selectedPttypes && selectedPttypes.length > 0) {
            const list = selectedPttypes.map(p => `'${p}'`).join(',');
            pttypeCond = `AND i.pttype IN (${list})`;
        }
        const ph1 = type === 'postgresql' ? '$1' : '?';
        const ph2 = type === 'postgresql' ? '$2' : '?';
        const queryStr = `
            SELECT
              i.dchdate,
              CONCAT(p.pname, p.fname, ' ', p.lname) AS ptname,
              i.an,
              i.hn,
              ROW_NUMBER() OVER (PARTITION BY io.an ORDER BY io.iptoprt_id) AS sequence,
              'ICD9CM' AS codesys,
              io.icd9 AS code,
              ic.name AS procterm,
              d.licenseno AS dr,
              io.opdate AS datein,
              io.enddate AS dateout,
              CONCAT('xxxx:', w.name) AS location
            FROM iptoprt io
              LEFT JOIN ipt i ON io.an = i.an
              LEFT JOIN patient p ON i.hn = p.hn
              LEFT JOIN doctor d ON io.doctor = d.code
              LEFT JOIN ward w ON i.ward = w.ward
              LEFT JOIN icd9cm1 ic ON ic.code = io.icd9
            WHERE i.dchdate BETWEEN ${ph1} AND ${ph2}
            AND i.pttype IN (SELECT pttype FROM pttype WHERE isuse = 'Y' AND ${hipdataFilter(hcode)})
            ${pttypeCond}
            ORDER BY i.dchdate, i.an, sequence
        `;
        if (type === 'postgresql') {
            const client = new PgClient({ host, port: parseInt(port), database, user, password, connectionTimeoutMillis: 15000 });
            await client.connect();
            const result = await client.query(queryStr, [dateFrom, dateTo]);
            await client.end();
            res.json({ success: true, data: result.rows, count: result.rows.length });
        } else {
            const connection = await mysql.createConnection({ host, port, user, password, database, connectTimeout: 15000 });
            const [rows] = await connection.execute(queryStr, [dateFrom, dateTo]);
            await connection.end();
            res.json({ success: true, data: rows, count: rows.length });
        }
    } catch (error) {
        console.error('CIPN IPOp error:', error);
        res.json({ success: false, error: error.message });
    }
});

// CIPN - Invoices (ข้าราชการผู้ป่วยใน ใบแจ้งหนี้)
app.post('/api/get-cipn-invoices', async (req, res) => {
    try {
        const { host, port, database, user, password, type, dateFrom, dateTo, selectedPttypes, hipdata_code } = req.body;
        const hcode = hipdata_code || 'OFC';
        let pttypeCond = '';
        if (selectedPttypes && selectedPttypes.length > 0) {
            const list = selectedPttypes.map(p => `'${p}'`).join(',');
            pttypeCond = `AND i.pttype IN (${list})`;
        }
        const ph1 = type === 'postgresql' ? '$1' : '?';
        const ph2 = type === 'postgresql' ? '$2' : '?';
        const queryStr = `
            SELECT
              i.dchdate,
              CONCAT(p.fname, ' ', p.lname) AS ptname,
              i.an, i.hn,
              rd.total_amount AS invoice,
              rd.debt_id AS invnumber,
              rd.debt_date AS invdt,
              COUNT(opi.icode) AS bllitem,
              rd.discount_amount AS invadddiscount,
              (SELECT SUM(op.sum_price - op.discount)
               FROM opitemrece op
               LEFT JOIN nondrugitems_sks_bc nb ON nb.icode = op.icode
               WHERE op.an = i.an AND nb.claim_cat = 'D') AS drgcharge,
              (SELECT SUM(op.sum_price - op.discount)
               FROM opitemrece op
               LEFT JOIN nondrugitems_sks_bc nb ON nb.icode = op.icode
               WHERE op.an = i.an AND nb.claim_cat = 'T') AS xdrgclaim
            FROM ipt i
              INNER JOIN patient p ON p.hn = i.hn
              LEFT OUTER JOIN rcpt_debt rd ON rd.vn = i.an
              INNER JOIN pttype ptt ON ptt.pttype = rd.pttype
              LEFT OUTER JOIN opitemrece opi ON opi.an = rd.vn
            WHERE i.dchdate BETWEEN ${ph1} AND ${ph2}
            AND i.pttype IN (SELECT pttype FROM pttype WHERE isuse = 'Y' AND ${hipdataFilter(hcode)})
            ${pttypeCond}
            AND rd.total_amount > 0
            GROUP BY i.dchdate, ptname, i.an, i.hn, rd.vn, rd.total_amount, rd.debt_id, rd.debt_date, rd.discount_amount
            ORDER BY i.dchdate
        `;
        if (type === 'postgresql') {
            const client = new PgClient({ host, port: parseInt(port), database, user, password, connectionTimeoutMillis: 15000 });
            await client.connect();
            const result = await client.query(queryStr, [dateFrom, dateTo]);
            await client.end();
            res.json({ success: true, data: result.rows, count: result.rows.length });
        } else {
            const connection = await mysql.createConnection({ host, port, user, password, database, connectTimeout: 15000 });
            const [rows] = await connection.execute(queryStr, [dateFrom, dateTo]);
            await connection.end();
            res.json({ success: true, data: rows, count: rows.length });
        }
    } catch (error) {
        console.error('CIPN Invoices error:', error);
        res.json({ success: false, error: error.message });
    }
});

// CIPN - BillItems (ข้าราชการผู้ป่วยใน รายการในบิล)
app.post('/api/get-cipn-billitems', async (req, res) => {
    try {
        const { host, port, database, user, password, type, dateFrom, dateTo, selectedPttypes, hipdata_code } = req.body;
        const hcode = hipdata_code || 'OFC';
        let pttypeCond = '';
        if (selectedPttypes && selectedPttypes.length > 0) {
            const list = selectedPttypes.map(p => `'${p}'`).join(',');
            pttypeCond = `AND i.pttype IN (${list})`;
        }
        const ph1 = type === 'postgresql' ? '$1' : '?';
        const ph2 = type === 'postgresql' ? '$2' : '?';
        const queryStr = `
            SELECT
              i.dchdate,
              CONCAT(p.fname, ' ', p.lname) AS ptname,
              i.an, i.hn,
              ROW_NUMBER() OVER (ORDER BY op.an) AS sequence,
              op.rxdate AS servdate,
              op.income AS billgr,
              op.icode AS lccode,
              CONCAT(nd.name, ' (', nd.unit, ')') AS descript,
              op.qty,
              op.unitprice AS unitprice,
              (op.qty * op.unitprice) AS chargeamt,
              (op.sum_price - op.discount) AS discount,
              'Null' AS procedureseq,
              'Null' AS diagnosisseq,
              'CS' AS claimsys,
              ns.income AS billgrcs,
              (CASE WHEN op.icode LIKE '1%' THEN d.sks_drug_code
                    WHEN op.icode LIKE '3%' THEN nd.billcode
                    ELSE '' END) AS cscode,
              'Null' AS codesys,
              'Null' AS stdcode,
              ns.claim_cat AS claimcat,
              ns.rev_date AS daterev,
              'Null' AS claimup,
              'Null' AS claimamt
            FROM ipt i
              INNER JOIN patient p ON p.hn = i.hn
              INNER JOIN opitemrece op ON op.an = i.an
              INNER JOIN s_drugitems s ON s.icode = op.icode
              LEFT JOIN nondrugitems nd ON nd.icode = s.icode
              LEFT JOIN drugitems d ON d.icode = s.icode
              LEFT JOIN nondrugitems_sks_bc ns ON ns.icode = nd.icode
            WHERE i.dchdate BETWEEN ${ph1} AND ${ph2}
            AND i.pttype IN (SELECT pttype FROM pttype WHERE isuse = 'Y' AND ${hipdataFilter(hcode)})
            ${pttypeCond}
        `;
        if (type === 'postgresql') {
            const client = new PgClient({ host, port: parseInt(port), database, user, password, connectionTimeoutMillis: 15000 });
            await client.connect();
            const result = await client.query(queryStr, [dateFrom, dateTo]);
            await client.end();
            res.json({ success: true, data: result.rows, count: result.rows.length });
        } else {
            const connection = await mysql.createConnection({ host, port, user, password, database, connectTimeout: 15000 });
            const [rows] = await connection.execute(queryStr, [dateFrom, dateTo]);
            await connection.end();
            res.json({ success: true, data: rows, count: rows.length });
        }
    } catch (error) {
        console.error('CIPN BillItems error:', error);
        res.json({ success: false, error: error.message });
    }
});

// IPN - IPDX (IPD Diagnosis)
app.post('/api/get-ipn-ipdx', async (req, res) => {
    try {
        const { host, port, database, user, password, type, dateFrom, dateTo, selectedPttypes, hipdata_code } = req.body;
        let pttypeCond;
        if (selectedPttypes && selectedPttypes.length > 0) {
            const list = selectedPttypes.map(p => `'${p}'`).join(',');
            pttypeCond = `AND i2.pttype IN (${list})`;
        } else {
            pttypeCond = `AND i2.pttype IN (SELECT p.pttype FROM pttype p WHERE p.isuse='Y' AND ${hipdataFilter(hipdata_code || 'OFC')})`;
        }
        const ph1 = type === 'postgresql' ? '$1' : '?';
        const ph2 = type === 'postgresql' ? '$2' : '?';
        const queryStr = `
            SELECT i2.hn, i2.an,
              i1.icd10 AS diag, CASE WHEN i1.icd10 IS NOT NULL THEN 'Y' ELSE 'N' END AS check_diag,
              i1.diagtype AS dxtype, CASE WHEN (i1.diagtype IS NOT NULL AND i1.diagtype <> '') THEN 'Y' ELSE 'N' END AS check_diagtype,
              d.licenseno, CASE WHEN (d.licenseno IS NOT NULL AND d.licenseno <> '') THEN 'Y' ELSE 'N' END AS check_licenseno
            FROM ipt i2
              LEFT OUTER JOIN iptdiag i1 ON i1.an = i2.an
              LEFT OUTER JOIN diagtype dx ON dx.diagtype = i1.diagtype
              LEFT OUTER JOIN doctor d ON d.code = i1.doctor
            WHERE i2.dchdate BETWEEN ${ph1} AND ${ph2}
            ${pttypeCond}
            ORDER BY i2.an, i1.diagtype, i1.diag_no
        `;
        if (type === 'postgresql') {
            const client = new PgClient({ host, port: parseInt(port), database, user, password, connectionTimeoutMillis: 10000 });
            await client.connect();
            const result = await client.query(queryStr, [dateFrom, dateTo]);
            await client.end();
            res.json({ success: true, data: result.rows, count: result.rows.length });
        } else {
            const connection = await mysql.createConnection({ host, port, user, password, database, connectTimeout: 10000 });
            const [rows] = await connection.execute(queryStr, [dateFrom, dateTo]);
            await connection.end();
            res.json({ success: true, data: rows, count: rows.length });
        }
    } catch (error) {
        console.error('IPN IPDX error:', error);
        res.json({ success: false, error: error.message });
    }
});

// IPN - IPOp (IPD Operations)
app.post('/api/get-ipn-ipop', async (req, res) => {
    try {
        const { host, port, database, user, password, type, dateFrom, dateTo, selectedPttypes, hipdata_code } = req.body;
        let pttypeCond;
        if (selectedPttypes && selectedPttypes.length > 0) {
            const list = selectedPttypes.map(p => `'${p}'`).join(',');
            pttypeCond = `AND i.pttype IN (${list})`;
        } else {
            pttypeCond = `AND i.pttype IN (SELECT p.pttype FROM pttype p WHERE p.isuse='Y' AND ${hipdataFilter(hipdata_code || 'OFC')})`;
        }
        const ph1 = type === 'postgresql' ? '$1' : '?';
        const ph2 = type === 'postgresql' ? '$2' : '?';
        const queryStr = `
            SELECT i.hn, op.an,
              ot.name AS oper_type,
              op.icd9 AS oper, CASE WHEN (op.icd9 IS NOT NULL AND op.icd9 <> '') THEN 'Y' ELSE 'N' END AS check_icd9,
              op.opdate AS datein, CASE WHEN op.opdate IS NOT NULL THEN 'Y' ELSE 'N' END AS check_datein,
              op.optime AS timein, CASE WHEN (op.optime IS NOT NULL AND op.optime <> '00:00:00') THEN 'Y' ELSE 'N' END AS check_timein,
              op.enddate AS dateout, CASE WHEN op.enddate IS NOT NULL THEN 'Y' ELSE 'N' END AS check_dateout,
              op.endtime AS timeout, CASE WHEN (op.endtime IS NOT NULL AND op.endtime <> '00:00:00') THEN 'Y' ELSE 'N' END AS check_timeout,
              d.licenseno, CASE WHEN (d.licenseno IS NOT NULL AND d.licenseno <> '') THEN 'Y' ELSE 'N' END AS check_licenseno
            FROM iptoprt op
              LEFT OUTER JOIN doctor d ON d.code = op.doctor
              LEFT OUTER JOIN ipt i ON i.an = op.an
              LEFT OUTER JOIN oper_type ot ON ot.oper_type = op.oper_type
            WHERE i.dchdate BETWEEN ${ph1} AND ${ph2}
            ${pttypeCond}
            ORDER BY op.an, op.priority
        `;
        if (type === 'postgresql') {
            const client = new PgClient({ host, port: parseInt(port), database, user, password, connectionTimeoutMillis: 10000 });
            await client.connect();
            const result = await client.query(queryStr, [dateFrom, dateTo]);
            await client.end();
            res.json({ success: true, data: result.rows, count: result.rows.length });
        } else {
            const connection = await mysql.createConnection({ host, port, user, password, database, connectTimeout: 10000 });
            const [rows] = await connection.execute(queryStr, [dateFrom, dateTo]);
            await connection.end();
            res.json({ success: true, data: rows, count: rows.length });
        }
    } catch (error) {
        console.error('IPN IPOp error:', error);
        res.json({ success: false, error: error.message });
    }
});

// IPN - Invoices (IPD billing summary)
app.post('/api/get-ipn-invoices', async (req, res) => {
    try {
        const { host, port, database, user, password, type, dateFrom, dateTo, selectedPttypes, hipdata_code } = req.body;
        let pttypeCond;
        if (selectedPttypes && selectedPttypes.length > 0) {
            const list = selectedPttypes.map(p => `'${p}'`).join(',');
            pttypeCond = `AND i.pttype IN (${list})`;
        } else {
            pttypeCond = `AND i.pttype IN (SELECT p.pttype FROM pttype p WHERE p.isuse='Y' AND ${hipdataFilter(hipdata_code || 'OFC')})`;
        }
        const ph1 = type === 'postgresql' ? '$1' : '?';
        const ph2 = type === 'postgresql' ? '$2' : '?';
        const queryStr = `
            SELECT i.hn, i.an,
              i.regdate, i.dchdate,
              p.cid,
              CONCAT(pt.pname, pt.fname, ' ', pt.lname) AS ptname,
              a.income AS total, CASE WHEN a.income IS NOT NULL THEN 'Y' ELSE 'N' END AS check_total,
              a.paid_money AS paid,
              p1.pcode AS pttype_code,
              i.an AS seq
            FROM ipt i
              INNER JOIN patient pt ON pt.hn = i.hn
              LEFT JOIN an_stat a ON a.an = i.an
              LEFT JOIN ipt_pttype ip ON ip.an = i.an AND ip.pttype_number = '1'
              LEFT JOIN pttype p1 ON p1.pttype = ip.pttype
              LEFT JOIN patient p ON p.hn = i.hn
            WHERE i.dchdate BETWEEN ${ph1} AND ${ph2}
            ${pttypeCond}
            ORDER BY i.an
        `;
        if (type === 'postgresql') {
            const client = new PgClient({ host, port: parseInt(port), database, user, password, connectionTimeoutMillis: 10000 });
            await client.connect();
            const result = await client.query(queryStr, [dateFrom, dateTo]);
            await client.end();
            res.json({ success: true, data: result.rows, count: result.rows.length });
        } else {
            const connection = await mysql.createConnection({ host, port, user, password, database, connectTimeout: 10000 });
            const [rows] = await connection.execute(queryStr, [dateFrom, dateTo]);
            await connection.end();
            res.json({ success: true, data: rows, count: rows.length });
        }
    } catch (error) {
        console.error('IPN Invoices error:', error);
        res.json({ success: false, error: error.message });
    }
});

// IPN - BillItems (IPD billing detail)
app.post('/api/get-ipn-billitems', async (req, res) => {
    try {
        const { host, port, database, user, password, type, dateFrom, dateTo, selectedPttypes, hipdata_code } = req.body;
        let pttypeCond;
        if (selectedPttypes && selectedPttypes.length > 0) {
            const list = selectedPttypes.map(p => `'${p}'`).join(',');
            pttypeCond = `AND ipt.pttype IN (${list})`;
        } else {
            pttypeCond = `AND ipt.pttype IN (SELECT p.pttype FROM pttype p WHERE p.isuse='Y' AND ${hipdataFilter(hipdata_code || 'OFC')})`;
        }
        const ph1 = type === 'postgresql' ? '$1' : '?';
        const ph2 = type === 'postgresql' ? '$2' : '?';
        const queryStr = `
            SELECT ipt.an, ipt.hn,
              CONCAT(pt.pname, pt.fname, ' ', pt.lname) AS ptname,
              ipt.dchdate,
              t.pcode AS pttype_code,
              d.chrgitem_code1,
              inc.income AS chrgitem, CASE WHEN inc.income IS NOT NULL THEN 'Y' ELSE 'N' END AS check_chrgitem,
              SUM(inc.rcptamt) AS amount, CASE WHEN SUM(inc.rcptamt) > 0 THEN 'Y' ELSE 'N' END AS check_amount
            FROM ipt
              LEFT OUTER JOIN incith inc ON inc.an = ipt.an AND inc.paidst = '02'
              LEFT OUTER JOIN income ic ON ic.income = inc.income
              LEFT OUTER JOIN drg_chrgitem d ON d.drg_chrgitem_id = ic.drg_chrgitem_id
              LEFT OUTER JOIN pttype t ON t.pttype = ipt.pttype
              LEFT OUTER JOIN patient pt ON pt.hn = ipt.hn
            WHERE ipt.dchdate BETWEEN ${ph1} AND ${ph2}
            ${pttypeCond}
            GROUP BY ipt.an, ipt.hn, pt.pname, pt.fname, pt.lname,
              ipt.dchdate, t.pcode, d.chrgitem_code1, inc.income
            ORDER BY ipt.an, d.chrgitem_code1
        `;
        if (type === 'postgresql') {
            const client = new PgClient({ host, port: parseInt(port), database, user, password, connectionTimeoutMillis: 10000 });
            await client.connect();
            const result = await client.query(queryStr, [dateFrom, dateTo]);
            await client.end();
            res.json({ success: true, data: result.rows, count: result.rows.length });
        } else {
            const connection = await mysql.createConnection({ host, port, user, password, database, connectTimeout: 10000 });
            const [rows] = await connection.execute(queryStr, [dateFrom, dateTo]);
            await connection.end();
            res.json({ success: true, data: rows, count: rows.length });
        }
    } catch (error) {
        console.error('IPN BillItems error:', error);
        res.json({ success: false, error: error.message });
    }
});

// ==================== Login ====================
// crypto ประกาศไว้บนสุดของไฟล์แล้ว (security layer)

app.post('/api/login', async (req, res) => {
    try {
        const { host, port, database, user, password, type, loginUser, loginPass } = req.body;
        if (!loginUser || !loginPass) return res.json({ success: false, error: 'กรุณากรอกชื่อผู้ใช้และรหัสผ่าน' });

        const md5 = str => crypto.createHash('md5').update(str).digest('hex');
        const hashedPass = md5(loginPass);

        // Step 1: ดึง row ของ username นั้น (ไม่กรอง password ก่อน เพื่อ compare เอง)
        const buildFetchUser = (pg) => pg
            ? `SELECT officer_login_name, officer_login_password_md5, officer_name FROM officer WHERE LOWER(officer_login_name) = LOWER($1) LIMIT 1`
            : `SELECT officer_login_name, officer_login_password_md5, officer_name FROM officer WHERE LOWER(officer_login_name) = LOWER(?) LIMIT 1`;

        let rows;
        if (type === 'postgresql') {
            const client = new PgClient({ host, port: parseInt(port), database, user, password, connectionTimeoutMillis: 8000 });
            await client.connect();
            const result = await client.query(buildFetchUser(true), [loginUser]);
            await client.end();
            rows = result.rows;
        } else {
            const connection = await mysql.createConnection({ host, port, user, password, database, connectTimeout: 8000 });
            const [r] = await connection.execute(buildFetchUser(false), [loginUser]);
            await connection.end();
            rows = r;
        }

        if (rows.length === 0) {
            return res.json({ success: false, error: 'ไม่พบชื่อผู้ใช้นี้ในระบบ' });
        }

        // Step 2: เปรียบเทียบ hash (case-insensitive รองรับทั้ง upper/lower)
        const storedHash = (rows[0].officer_login_password_md5 || '').toLowerCase();
        const inputHash  = hashedPass.toLowerCase();

        if (storedHash !== inputHash) {
            return res.json({ success: false, error: 'รหัสผ่านไม่ถูกต้อง' });
        }

        const displayName = rows[0].officer_name || rows[0].officer_login_name;
        res.json({ success: true, username: rows[0].officer_login_name, name: displayName });

    } catch (error) {
        console.error('Login error:', error);
        res.json({ success: false, error: error.message });
    }
});

// ==================== Basic Data Endpoints (CSOP / ข้อมูลพื้นฐาน) ====================

async function runBasicQuery(req, res, buildQuery, label) {
    try {
        const { host, port, database, user, password, type } = req.body;
        if (type === 'postgresql') {
            const client = new PgClient({ host, port: parseInt(port), database, user, password, connectionTimeoutMillis: 10000 });
            await client.connect();
            const result = await client.query(buildQuery(true));
            await client.end();
            res.json({ success: true, data: result.rows, count: result.rows.length });
        } else {
            const connection = await mysql.createConnection({ host, port, user, password, database, connectTimeout: 10000 });
            const [rows] = await connection.execute(buildQuery(false));
            await connection.end();
            res.json({ success: true, data: rows, count: rows.length });
        }
    } catch (error) {
        console.error(`${label} error:`, error);
        res.json({ success: false, error: error.message });
    }
}

// 1. บุคลากรทางการแพทย์
app.post('/api/get-basic-doctor', async (req, res) => {
    try {
        const { host, port, database, user, password, type } = req.body;

        const ensurePositionCheck = async (client, isPg) => {
            if (isPg) {
                await client.query(`
                    CREATE TABLE IF NOT EXISTS position_check (
                        position_check_id SERIAL      NOT NULL,
                        position_id       INTEGER      NOT NULL,
                        position_name     VARCHAR(200) NOT NULL,
                        CONSTRAINT pk_position_check PRIMARY KEY (position_check_id)
                    )
                `);
                await client.query(`
                    CREATE UNIQUE INDEX IF NOT EXISTS idx_position_check_id
                    ON position_check USING BTREE (position_check_id)
                `);
            } else {
                await client.execute(`
                    CREATE TABLE IF NOT EXISTS \`position_check\` (
                        \`position_check_id\` INT NOT NULL AUTO_INCREMENT,
                        \`position_id\`       INT NOT NULL,
                        \`position_name\`     VARCHAR(200) NOT NULL,
                        PRIMARY KEY (\`position_check_id\`),
                        UNIQUE INDEX \`idx_position_check_id\` (\`position_check_id\`) USING BTREE
                    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
                `);
            }
        };

        const buildQuery = () => `
            SELECT position_id, p_name, licenseno,
            CASE WHEN (licenseno_check1 = 'Y' OR licenseno LIKE '-99999%') AND licenseno_check2 = 'Y' THEN 'Y' ELSE 'N' END AS licenseno_check,
            CASE WHEN licenseno_check2 = 'Y' OR licenseno LIKE '-99999%' THEN 'Y' ELSE 'N' END AS licenseno_check2,
            code, name AS d_name, cid,
            cid_check, pname,
            CASE WHEN (pname = '' OR pname IS NULL OR pname NOT IN (SELECT name FROM pname)) THEN 'N' ELSE 'Y' END AS pname_check,
            fname, lname
            FROM (
                SELECT d.position_id, d.licenseno, p.name AS p_name,
                CASE WHEN d.position_id NOT IN (SELECT position_id FROM position_check) THEN 'Y'
                    WHEN (d.licenseno LIKE 'พ%' OR d.licenseno LIKE 'ว%' OR d.licenseno LIKE 'ภ%' OR d.licenseno LIKE 'ท%' OR d.licenseno LIKE '-%') THEN 'Y'
                    ELSE 'N' END AS licenseno_check1,
                CASE WHEN d.position_id IN (SELECT position_id FROM position_check)
                    AND (d.licenseno LIKE 'พ.%' OR d.licenseno LIKE 'ว.%' OR d.licenseno LIKE 'ภ.%' OR d.licenseno LIKE 'ท.%' OR d.licenseno LIKE 'ก%' OR d.licenseno LIKE 'พป%' OR d.licenseno LIKE 'พทน%') THEN 'N'
                    ELSE 'Y' END AS licenseno_check2,
                d.code, d.name, d.cid,
                CASE WHEN (d.cid = '' OR d.cid IS NULL OR LENGTH(d.cid) <> 13) THEN 'N' ELSE 'Y' END AS cid_check,
                d.pname, d.fname, d.lname
                FROM doctor d
                LEFT OUTER JOIN doctor_position p ON p.id = d.position_id
                WHERE d.active = 'Y'
                AND d.name NOT LIKE '%BMS%' AND d.name NOT LIKE '%bms%'
            ) tt
            ORDER BY position_id, d_name
        `;

        if (type === 'postgresql') {
            const client = new PgClient({ host, port: parseInt(port), database, user, password, connectionTimeoutMillis: 10000 });
            await client.connect();
            await ensurePositionCheck(client, true);
            const result = await client.query(buildQuery());
            await client.end();
            res.json({ success: true, data: result.rows, count: result.rows.length });
        } else {
            const connection = await mysql.createConnection({ host, port, user, password, database, connectTimeout: 10000 });
            await ensurePositionCheck(connection, false);
            const [rows] = await connection.execute(buildQuery());
            await connection.end();
            res.json({ success: true, data: rows, count: rows.length });
        }
    } catch (error) {
        console.error('BasicDoctor error:', error);
        res.json({ success: false, error: error.message });
    }
});

// 1b. ดึงรายการตำแหน่งสำหรับ dropdown
app.post('/api/get-doctor-positions', async (req, res) => {
    try {
        const { host, port, database, user, password, type } = req.body;
        const query = 'SELECT id, name FROM doctor_position ORDER BY name';
        if (type === 'postgresql') {
            const client = new PgClient({ host, port: parseInt(port), database, user, password, connectionTimeoutMillis: 10000 });
            await client.connect();
            const result = await client.query(query);
            await client.end();
            res.json({ success: true, data: result.rows });
        } else {
            const connection = await mysql.createConnection({ host, port, user, password, database, connectTimeout: 10000 });
            const [rows] = await connection.execute(query);
            await connection.end();
            res.json({ success: true, data: rows });
        }
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

// 1c. อัปเดตข้อมูลแพทย์รายฟิลด์
app.post('/api/update-doctor-field', async (req, res) => {
    try {
        const { host, port, database, user, password, type, code, field, value } = req.body;
        const allowed = {
            position_id: 'position_id',
            licenseno: 'licenseno',
            cid: 'cid',
            d_name: 'name',
            pname: 'pname',
            fname: 'fname',
            lname: 'lname'
        };
        const dbField = allowed[field];
        if (!dbField) return res.json({ success: false, error: 'ฟิลด์ไม่ถูกต้อง' });

        if (type === 'postgresql') {
            const client = new PgClient({ host, port: parseInt(port), database, user, password, connectionTimeoutMillis: 10000 });
            await client.connect();
            await client.query(`UPDATE doctor SET ${dbField} = $1 WHERE code = $2`, [value, code]);
            await client.end();
        } else {
            const connection = await mysql.createConnection({ host, port, user, password, database, connectTimeout: 10000 });
            await connection.execute(`UPDATE doctor SET \`${dbField}\` = ? WHERE code = ?`, [value, code]);
            await connection.end();
        }
        res.json({ success: true });
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

// 2. สิทธิการรักษา
app.post('/api/get-basic-pttype', async (req, res) => {
    try {
        const { host, port, database, user, password, type } = req.body;
        const isPg = type === 'postgresql';

        // ใช้ ILIKE สำหรับ PostgreSQL (case-insensitive), LIKE สำหรับ MySQL
        const likeOp = isPg ? 'ILIKE' : 'LIKE';

        const buildQuery = () => `
            SELECT p.pttype,
            p.name AS pttype_name,
            p.pcode,
            p.hipdata_code,
            p.nhso_code AS inscl,
            p.grouper_version AS drg_group,
            (CASE WHEN p.grouper_version='6' THEN 'Y' ELSE 'N' END) AS drg_group_check,
            p.print_presc_ned,
            (CASE WHEN p.print_presc_ned='Y' THEN 'Y' ELSE 'N' END) AS print_presc_ned_check,
            p.sks_benefit_plan_type_id,
            st.sks_benefit_plan_type_name,
            (CASE WHEN CAST(p.sks_benefit_plan_type_id AS VARCHAR)='2' THEN 'Y' ELSE 'N' END) AS sks_benefit_plan_type_id_check,
            st.sks_code,
            p.pttype_upp_type_id,
            pt.pttype_upp_type_name,
            (CASE WHEN CAST(p.pttype_upp_type_id AS VARCHAR)='1' THEN 'Y' ELSE 'N' END) AS pttype_upp_type_id_check,
            p.finance_round_money,
            (CASE WHEN p.finance_round_money='Y' THEN 'N' ELSE 'Y' END) AS finance_round_money_check,
            p.inc_round_money,
            (CASE WHEN p.inc_round_money='Y' THEN 'N' ELSE 'Y' END) AS inc_round_money_check,
            p.round_money,
            (CASE WHEN p.round_money='Y' THEN 'N' ELSE 'Y' END) AS round_money_check
            FROM pttype p
            LEFT OUTER JOIN sks_benefit_plan_type st ON st.sks_benefit_plan_type_id = p.sks_benefit_plan_type_id
            LEFT OUTER JOIN pttype_upp_type pt ON pt.pttype_upp_type_id = p.pttype_upp_type_id
            WHERE p.isuse = 'Y'
            AND p.hipdata_code = 'OFC'
            AND p.paidst = '02'
            AND p.nhso_code ${likeOp} 'O%'
            ORDER BY p.pttype
        `;

        let rows;
        if (isPg) {
            const client = new PgClient({ host, port: parseInt(port), database, user, password, connectionTimeoutMillis: 10000 });
            await client.connect();
            const result = await client.query(buildQuery());
            await client.end();
            rows = result.rows;
        } else {
            const connection = await mysql.createConnection({ host, port, user, password, database, connectTimeout: 10000 });
            const [r] = await connection.execute(buildQuery());
            await connection.end();
            rows = r;
        }

        // Debug: log columns from first row to console
        if (rows.length > 0) {
            console.log('[pttype] columns:', Object.keys(rows[0]));
            console.log('[pttype] first row:', rows[0]);
        } else {
            console.log('[pttype] query returned 0 rows');
        }

        // Normalize: แปลง column names เป็น lowercase เผื่อ database return mixed case
        const normalized = rows.map(r => {
            const obj = {};
            Object.keys(r).forEach(k => { obj[k.toLowerCase()] = r[k]; });
            return obj;
        });

        res.json({ success: true, data: normalized, count: normalized.length });
    } catch (error) {
        console.error('BasicPttype error:', error);
        res.json({ success: false, error: error.message });
    }
});

// 2b. Dropdown: pcode list
app.post('/api/get-pcode-list', async (req, res) => {
    runBasicQuery(req, res, () => `SELECT p.pcode, p.name FROM pcode p ORDER BY p.pcode`, 'PcodeList');
});

// 2c. Dropdown: nhso_inscl_code list
app.post('/api/get-nhso-inscl-list', async (req, res) => {
    runBasicQuery(req, res, () => `SELECT inscl_code, inscl_name FROM nhso_inscl_code ORDER BY inscl_code`, 'NhsoInsclList');
});

// 2d. Dropdown: sks_benefit_plan_type list
app.post('/api/get-sks-benefit-plan-list', async (req, res) => {
    runBasicQuery(req, res, () => `SELECT sks_benefit_plan_type_id, sks_benefit_plan_type_name FROM sks_benefit_plan_type ORDER BY sks_benefit_plan_type_id`, 'SksBenefitList');
});

// 2e. Dropdown: pttype_upp_type list
app.post('/api/get-pttype-upp-type-list', async (req, res) => {
    runBasicQuery(req, res, () => `SELECT pttype_upp_type_id, pttype_upp_type_name FROM pttype_upp_type ORDER BY pttype_upp_type_id`, 'PttypeUppTypeList');
});

// 2g. สิทธิการรักษา SSOP
app.post('/api/get-basic-pttype-ssop', async (req, res) => {
    try {
        const { host, port, database, user, password, type } = req.body;
        const isPg = type === 'postgresql';
        const likeOp = isPg ? 'ILIKE' : 'LIKE';
        const buildQuery = () => `
            SELECT p.pttype, p.name AS pttype_name, p.pcode, p.hipdata_code,
            p.nhso_code AS inscl, p.grouper_version AS drg_group,
            (CASE WHEN p.grouper_version='6' THEN 'Y' ELSE 'N' END) AS drg_group_check,
            p.print_presc_ned,
            (CASE WHEN p.print_presc_ned='Y' THEN 'Y' ELSE 'N' END) AS print_presc_ned_check,
            p.sks_benefit_plan_type_id, st.sks_benefit_plan_type_name,
            (CASE WHEN CAST(p.sks_benefit_plan_type_id AS VARCHAR) IN ('4','8') THEN 'Y' ELSE 'N' END) AS sks_benefit_plan_type_id_check,
            st.sks_code, p.pttype_upp_type_id, pt.pttype_upp_type_name,
            (CASE WHEN CAST(p.pttype_upp_type_id AS VARCHAR) IN ('7','8','9','10') THEN 'Y' ELSE 'N' END) AS pttype_upp_type_id_check,
            p.finance_round_money,
            (CASE WHEN p.finance_round_money='Y' THEN 'N' ELSE 'Y' END) AS finance_round_money_check,
            p.inc_round_money,
            (CASE WHEN p.inc_round_money='Y' THEN 'N' ELSE 'Y' END) AS inc_round_money_check,
            p.round_money,
            (CASE WHEN p.round_money='Y' THEN 'N' ELSE 'Y' END) AS round_money_check
            FROM pttype p
            LEFT OUTER JOIN sks_benefit_plan_type st ON st.sks_benefit_plan_type_id = p.sks_benefit_plan_type_id
            LEFT OUTER JOIN pttype_upp_type pt ON pt.pttype_upp_type_id = p.pttype_upp_type_id
            WHERE p.isuse = 'Y' AND p.hipdata_code = 'SSS' AND p.paidst = '02' AND p.nhso_code ${likeOp} 'S%'
            ORDER BY p.pttype
        `;
        let rows;
        if (isPg) {
            const client = new PgClient({ host, port: parseInt(port), database, user, password, connectionTimeoutMillis: 10000 });
            await client.connect();
            const result = await client.query(buildQuery());
            await client.end();
            rows = result.rows;
        } else {
            const connection = await mysql.createConnection({ host, port, user, password, database, connectTimeout: 10000 });
            const [r] = await connection.execute(buildQuery());
            await connection.end();
            rows = r;
        }
        const normalized = rows.map(r => { const o={}; Object.keys(r).forEach(k=>{ o[k.toLowerCase()]=r[k]; }); return o; });
        res.json({ success: true, data: normalized, count: normalized.length });
    } catch (error) {
        console.error('BasicPttypeSSOP error:', error);
        res.json({ success: false, error: error.message });
    }
});

// 2f. Update pttype field
app.post('/api/update-pttype-field', async (req, res) => {
    try {
        const { host, port, database, user, password, type, pttype, field, value } = req.body;
        const allowed = {
            pttype_name: 'name',
            pcode:       'pcode',
            hipdata_code:'hipdata_code',
            inscl:       'nhso_code',
            drg_group:   'grouper_version',
            print_presc_ned: 'print_presc_ned',
            sks_benefit_plan_type_id: 'sks_benefit_plan_type_id',
            pttype_upp_type_id:       'pttype_upp_type_id',
            finance_round_money: 'finance_round_money',
            inc_round_money:     'inc_round_money',
            round_money:         'round_money'
        };
        // Y/N fields ที่ DB เก็บแค่ 1 ตัวอักษร
        const ynFields = new Set(['print_presc_ned', 'finance_round_money', 'inc_round_money', 'round_money']);

        const dbField = allowed[field];
        if (!dbField) return res.json({ success: false, error: 'ฟิลด์ไม่ถูกต้อง' });

        // trim whitespace/newline เสมอ; Y/N fields ตัดเหลือแค่ 1 char
        let cleanValue = (value ?? '').toString().trim();
        if (ynFields.has(field) && cleanValue.length > 1) {
            cleanValue = cleanValue.charAt(0).toUpperCase();
        }

        if (type === 'postgresql') {
            const client = new PgClient({ host, port: parseInt(port), database, user, password, connectionTimeoutMillis: 10000 });
            await client.connect();
            await client.query(`UPDATE pttype SET ${dbField} = $1 WHERE pttype = $2`, [cleanValue, pttype]);
            await client.end();
        } else {
            const connection = await mysql.createConnection({ host, port, user, password, database, connectTimeout: 10000 });
            await connection.execute(`UPDATE pttype SET \`${dbField}\` = ? WHERE pttype = ?`, [cleanValue, pttype]);
            await connection.end();
        }
        res.json({ success: true });
    } catch (error) {
        const { field, value } = req.body;
        const msg = error.message.includes('too long')
            ? `ฟิลด์ "${field}" (ค่า: "${(value??'').toString().trim()}") ${error.message}`
            : error.message;
        res.json({ success: false, error: msg });
    }
});

// 3. หมวดค่ารักษาพยาบาล
app.post('/api/get-basic-income-category', async (req, res) => {
    try {
        const { host, port, database, user, password, type } = req.body;
        const buildQuery = () => `
            SELECT i.income, i.name AS income_name,
            i.group2,
            i2.group_name AS income_group2,
            (CASE WHEN i.group2 IS NULL THEN 'N' ELSE 'Y' END) AS income_group2_check,
            i.drg_group, dg.drg_group_name,
            i.income_sss_group_code, irs.name AS sss_name,
            i.std_group, isg.name AS sks_opd,
            i.income_csmbs_code, ic.income_csmbs_name AS sks_ipd,
            i.nk2_group AS nk2_group_code, ink.name AS nk2_group,
            i.drg_chrgitem_id, dc.drg_chrgitem_name AS eclaim,
            i.rvsp_group, irg.rvsp_name
            FROM income i
            LEFT OUTER JOIN income_report2 i2 ON i2.group_id = i.group2
            LEFT OUTER JOIN drg_group dg ON dg.drg_group = i.drg_group
            LEFT OUTER JOIN income_report_sss irs ON irs.code = i.income_sss_group_code
            LEFT OUTER JOIN income_std_group isg ON isg.std_group = i.std_group
            LEFT OUTER JOIN income_csmbs ic ON ic.income_csmbs_code = i.income_csmbs_code
            LEFT OUTER JOIN income_nk2 ink ON ink.nk2_group = i.nk2_group
            LEFT OUTER JOIN drg_chrgitem dc ON dc.drg_chrgitem_id = i.drg_chrgitem_id
            LEFT OUTER JOIN income_rvsp_group irg ON irg.rvsp_group = i.rvsp_group
            ORDER BY i.income
        `;
        let rows;
        if (type === 'postgresql') {
            const client = new PgClient({ host, port: parseInt(port), database, user, password, connectionTimeoutMillis: 10000 });
            await client.connect();
            const result = await client.query(buildQuery());
            await client.end();
            rows = result.rows;
        } else {
            const connection = await mysql.createConnection({ host, port, user, password, database, connectTimeout: 10000 });
            const [r] = await connection.execute(buildQuery());
            await connection.end();
            rows = r;
        }
        const normalized = rows.map(r => { const o={}; Object.keys(r).forEach(k=>{ o[k.toLowerCase()]=r[k]; }); return o; });
        res.json({ success: true, data: normalized, count: normalized.length });
    } catch (error) {
        console.error('BasicIncomeCategory error:', error);
        res.json({ success: false, error: error.message });
    }
});

// 3b. Dropdown lists สำหรับ income_cat
app.post('/api/get-income-report2-list',    (req, res) => runBasicQuery(req, res, () => `SELECT group_id, group_name FROM income_report2 ORDER BY group_id`, 'IncomeReport2List'));
app.post('/api/get-drg-group-list',         (req, res) => runBasicQuery(req, res, () => `SELECT drg_group, drg_group_name FROM drg_group ORDER BY drg_group`, 'DrgGroupList'));
app.post('/api/get-income-sss-list',        (req, res) => runBasicQuery(req, res, () => `SELECT code, name FROM income_report_sss ORDER BY code`, 'IncomeSssList'));
app.post('/api/get-income-std-group-list',  (req, res) => runBasicQuery(req, res, () => `SELECT std_group, name FROM income_std_group ORDER BY std_group`, 'IncomeStdGroupList'));
app.post('/api/get-income-csmbs-list',      (req, res) => runBasicQuery(req, res, () => `SELECT income_csmbs_code, income_csmbs_name FROM income_csmbs ORDER BY income_csmbs_code`, 'IncomeCsmbsList'));
app.post('/api/get-income-nk2-list',        (req, res) => runBasicQuery(req, res, () => `SELECT nk2_group, name FROM income_nk2 ORDER BY nk2_group`, 'IncomeNk2List'));
app.post('/api/get-drg-chrgitem-list',      (req, res) => runBasicQuery(req, res, () => `SELECT drg_chrgitem_id, drg_chrgitem_name FROM drg_chrgitem ORDER BY drg_chrgitem_id`, 'DrgChrgitemList'));
app.post('/api/get-income-rvsp-group-list', (req, res) => runBasicQuery(req, res, () => `SELECT rvsp_group, rvsp_name FROM income_rvsp_group ORDER BY rvsp_group`, 'IncomeRvspGroupList'));

// 3c. Update income field
app.post('/api/update-income-field', async (req, res) => {
    try {
        const { host, port, database, user, password, type, income, field, value } = req.body;
        const allowed = {
            income_name: 'name', group2: 'group2', drg_group: 'drg_group',
            income_sss_group_code: 'income_sss_group_code', std_group: 'std_group',
            income_csmbs_code: 'income_csmbs_code', nk2_group: 'nk2_group',
            drg_chrgitem_id: 'drg_chrgitem_id', rvsp_group: 'rvsp_group'
        };
        const dbField = allowed[field];
        if (!dbField) return res.json({ success: false, error: 'ฟิลด์ไม่ถูกต้อง' });
        const saveVal = (value === '' || value === null) ? null : value;
        if (type === 'postgresql') {
            const client = new PgClient({ host, port: parseInt(port), database, user, password, connectionTimeoutMillis: 10000 });
            await client.connect();
            await client.query(`UPDATE income SET ${dbField} = $1 WHERE income = $2`, [saveVal, income]);
            await client.end();
        } else {
            const connection = await mysql.createConnection({ host, port, user, password, database, connectTimeout: 10000 });
            await connection.execute(`UPDATE income SET \`${dbField}\` = ? WHERE income = ?`, [saveVal, income]);
            await connection.end();
        }
        res.json({ success: true });
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

// 4. ค่ารักษาพยาบาล (non-drug items)
app.post('/api/get-basic-nondrug', async (req, res) => {
    try {
        const { host, port, database, user, password, type } = req.body;
        const isPg = type === 'postgresql';
        const nameCheck = isPg
            ? `(CASE WHEN n.name ~ '[\\r\\n<>"''&]' THEN 'N' ELSE 'Y' END)`
            : `(CASE WHEN n.name REGEXP '[\\r\\n<>"''&]' THEN 'N' ELSE 'Y' END)`;
        const catCheck = isPg
            ? `(CASE WHEN n.sks_product_category_id::text IN ('6','7') THEN 'Y' ELSE 'N' END)`
            : `(CASE WHEN CAST(n.sks_product_category_id AS CHAR) IN ('6','7') THEN 'Y' ELSE 'N' END)`;
        // ติ๊กส่งเบิก (enable_sks_opd='Y') แล้ว ราคาเบิก (sks_coverage_price) ต้องมีค่ามากกว่า -1
        const priceCheck = `(CASE WHEN n.enable_sks_opd = 'Y' AND (n.sks_coverage_price IS NULL OR n.sks_coverage_price <= -1) THEN 'N'
                                  WHEN n.enable_sks_opd = 'Y' THEN 'Y'
                                  ELSE '' END)`;
        const buildQuery = () => `
            SELECT n.icode, n.name,
            ${nameCheck} AS name_check,
            n.unit, n.price, n.billcode, n.income, i.name AS income_name,
            n.nhso_adp_type_id, nat.nhso_adp_type_name, nac.nhso_adp_code,
            n.sks_product_category_id, spc.sks_product_category_name,
            ${catCheck} AS sks_product_category_check,
            n.sks_coverage_price, n.enable_sks_opd,
            ${priceCheck} AS sks_coverage_price_check
            FROM nondrugitems n
            LEFT OUTER JOIN income i ON i.income = n.income
            LEFT OUTER JOIN nhso_adp_type nat ON nat.nhso_adp_type_id = n.nhso_adp_type_id
            LEFT OUTER JOIN nhso_adp_code nac ON nac.nhso_adp_code = n.nhso_adp_code
            LEFT OUTER JOIN sks_product_category spc ON spc.sks_product_category_id = n.sks_product_category_id
            WHERE n.istatus = 'Y'
            ORDER BY n.income, n.name
        `;
        let rows;
        if (isPg) {
            const client = new PgClient({ host, port: parseInt(port), database, user, password, connectionTimeoutMillis: 15000 });
            await client.connect();
            const result = await client.query(buildQuery());
            await client.end();
            rows = result.rows;
        } else {
            const connection = await mysql.createConnection({ host, port, user, password, database, connectTimeout: 15000 });
            const [r] = await connection.execute(buildQuery());
            await connection.end();
            rows = r;
        }
        const normalized = rows.map(r => { const o={}; Object.keys(r).forEach(k=>{ o[k.toLowerCase()]=r[k]; }); return o; });
        res.json({ success: true, data: normalized, count: normalized.length });
    } catch (error) {
        console.error('BasicNondrug error:', error);
        res.json({ success: false, error: error.message });
    }
});

// 4b. Dropdown lists สำหรับ nondrug
app.post('/api/get-income-list',            (req, res) => runBasicQuery(req, res, () => `SELECT i.income, i.name FROM income i ORDER BY i.income`, 'IncomeList'));
app.post('/api/get-nhso-adp-type-list',     (req, res) => runBasicQuery(req, res, () => `SELECT nhso_adp_type_id, nhso_adp_type_name FROM nhso_adp_type ORDER BY nhso_adp_type_id`, 'NhsoAdpTypeList'));
app.post('/api/get-nhso-adp-code-list',     (req, res) => runBasicQuery(req, res, () => `SELECT nhso_adp_code, nhso_adp_code_name FROM nhso_adp_code ORDER BY nhso_adp_code`, 'NhsoAdpCodeList'));
app.post('/api/get-sks-product-cat-list',   (req, res) => runBasicQuery(req, res, () => `SELECT sks_product_category_id, sks_product_category_name FROM sks_product_category ORDER BY sks_product_category_id`, 'SksProductCatList'));

// 4c. Update nondrug field
app.post('/api/update-nondrug-field', async (req, res) => {
    try {
        const { host, port, database, user, password, type, icode, field, value } = req.body;
        const allowed = {
            name: 'name', unit: 'unit', price: 'price', billcode: 'billcode',
            sks_coverage_price: 'sks_coverage_price', enable_sks_opd: 'enable_sks_opd',
            income: 'income', nhso_adp_type_id: 'nhso_adp_type_id',
            nhso_adp_code: 'nhso_adp_code', sks_product_category_id: 'sks_product_category_id'
        };
        const dbField = allowed[field];
        if (!dbField) return res.json({ success: false, error: 'ฟิลด์ไม่ถูกต้อง' });
        const saveVal = (value === '' || value === null) ? null : value;
        if (type === 'postgresql') {
            const client = new PgClient({ host, port: parseInt(port), database, user, password, connectionTimeoutMillis: 10000 });
            await client.connect();
            await client.query(`UPDATE nondrugitems SET ${dbField} = $1 WHERE icode = $2`, [saveVal, icode]);
            await client.end();
        } else {
            const connection = await mysql.createConnection({ host, port, user, password, database, connectTimeout: 10000 });
            await connection.execute(`UPDATE nondrugitems SET \`${dbField}\` = ? WHERE icode = ?`, [saveVal, icode]);
            await connection.end();
        }
        res.json({ success: true });
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

// 5. ข้อมูล Lab
app.post('/api/get-basic-lab', async (req, res) => {
    try {
        const { host, port, database, user, password, type } = req.body;

        // เพิ่มฟิล no_lab_catalog อัตโนมัติถ้ายังไม่มี + เพิ่ม index บนคอลัมน์ที่ query นี้ join ด้วย (lab_catalog_import_detail ไม่มี index ทำให้ query ช้ามาก/timeout)
        const addCols = async (client, isPg) => {
            if (isPg) {
                await client.query(`ALTER TABLE lab_items           ADD COLUMN IF NOT EXISTS no_lab_catalog CHAR(1)`).catch(()=>{});
                await client.query(`ALTER TABLE lab_items_sub_group ADD COLUMN IF NOT EXISTS no_lab_catalog CHAR(1)`).catch(()=>{});
                await client.query(`CREATE INDEX IF NOT EXISTS idx_lab_catalog_import_detail_lc_code ON lab_catalog_import_detail(lab_catalog_lc_code)`).catch(()=>{});
                await client.query(`CREATE INDEX IF NOT EXISTS idx_lab_items_sub_group_icode ON lab_items_sub_group(group_icode)`).catch(()=>{});
                await client.query(`CREATE INDEX IF NOT EXISTS idx_lab_items_icode ON lab_items(icode)`).catch(()=>{});
            } else {
                // MySQL: ตรวจสอบก่อนเพิ่ม เพราะ IF NOT EXISTS รองรับแค่ MySQL 8.0.3+
                const checkCol = async (conn, tbl) => {
                    const [rows] = await conn.execute(
                        `SELECT COUNT(*) AS cnt FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME='no_lab_catalog'`,
                        [tbl]
                    );
                    return rows[0].cnt > 0;
                };
                if (!await checkCol(client, 'lab_items'))
                    await client.execute(`ALTER TABLE \`lab_items\` ADD COLUMN \`no_lab_catalog\` CHAR(1) NULL`).catch(()=>{});
                if (!await checkCol(client, 'lab_items_sub_group'))
                    await client.execute(`ALTER TABLE \`lab_items_sub_group\` ADD COLUMN \`no_lab_catalog\` CHAR(1) NULL`).catch(()=>{});

                const checkIndex = async (conn, tbl, idx) => {
                    const [rows] = await conn.execute(
                        `SELECT COUNT(*) AS cnt FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND INDEX_NAME=?`,
                        [tbl, idx]
                    );
                    return rows[0].cnt > 0;
                };
                if (!await checkIndex(client, 'lab_catalog_import_detail', 'idx_lab_catalog_import_detail_lc_code'))
                    await client.execute(`CREATE INDEX \`idx_lab_catalog_import_detail_lc_code\` ON \`lab_catalog_import_detail\`(\`lab_catalog_lc_code\`)`).catch(()=>{});
                if (!await checkIndex(client, 'lab_items_sub_group', 'idx_lab_items_sub_group_icode'))
                    await client.execute(`CREATE INDEX \`idx_lab_items_sub_group_icode\` ON \`lab_items_sub_group\`(\`group_icode\`)`).catch(()=>{});
                if (!await checkIndex(client, 'lab_items', 'idx_lab_items_icode'))
                    await client.execute(`CREATE INDEX \`idx_lab_items_icode\` ON \`lab_items\`(\`icode\`)`).catch(()=>{});
            }
        };

        const buildQuery = () => `
            SELECT lig.lab_items_group_name, g.lab_items_sub_group_code AS lab_code,
            g.group_icode AS lab_icode, lc.lab_catalog_lc_code AS lab_catalog_icode,
            (CASE WHEN g.group_icode IS NOT NULL AND g.group_icode<>'' AND lc.lab_catalog_lc_code IS NOT NULL AND lc.lab_catalog_lc_code<>'' AND g.no_lab_catalog IS NULL THEN 'Y'
                  WHEN g.group_icode IS NULL AND lc.lab_catalog_lc_code IS NULL AND g.no_lab_catalog='Y' THEN 'Y'
                  WHEN g.group_icode IS NOT NULL AND g.group_icode<>'' AND (lc.lab_catalog_lc_code IS NULL OR lc.lab_catalog_lc_code='') AND g.no_lab_catalog IS NULL THEN 'N'
                  ELSE '' END) AS lab_catalog_icode_check,
            g.no_lab_catalog, g.lab_items_sub_group_name AS lab_name, g.group_price AS price, g.tmlt_code AS lab_tmlt,
            lc.lab_catalog_tmlt,
            (CASE WHEN g.tmlt_code IS NOT NULL AND g.tmlt_code<>'' AND lc.lab_catalog_tmlt IS NOT NULL AND lc.lab_catalog_tmlt<>'' AND g.no_lab_catalog IS NULL THEN 'Y'
                  WHEN g.tmlt_code IS NULL AND lc.lab_catalog_tmlt IS NULL AND g.no_lab_catalog='Y' THEN 'Y'
                  WHEN g.tmlt_code IS NOT NULL AND g.tmlt_code<>'' AND (lc.lab_catalog_tmlt IS NULL OR lc.lab_catalog_tmlt='') AND g.no_lab_catalog IS NULL THEN 'N'
                  ELSE '' END) AS lab_catalog_tmlt_check,
            lc.lab_catalog_name, n.name AS nondrug_name, 'Profile' AS lab_type,
            n.sks_coverage_price, p.price AS pttype_price,
            (CASE WHEN n.sks_coverage_price IS NULL OR p.price IS NULL THEN ''
                  WHEN n.sks_coverage_price<>p.price THEN 'N' ELSE 'Y' END) AS sks_price_check
            FROM lab_items_sub_group g
            LEFT OUTER JOIN lab_items_group lig ON lig.lab_items_group_code = g.lab_items_group_code
            LEFT OUTER JOIN lab_catalog_import_detail lc ON lc.lab_catalog_lc_code = g.group_icode
            LEFT OUTER JOIN nondrugitems n ON n.icode = g.group_icode
            LEFT OUTER JOIN pttype_items_price p ON p.items_table_code = n.icode AND p.pttype IN ('*1')
            WHERE (g.active_status='Y' OR g.active_status IS NULL OR g.active_status='')

            UNION ALL

            SELECT lig.lab_items_group_name, li.lab_items_code AS lab_code,
            (CASE WHEN (li.icode='' OR li.icode IS NULL) THEN 'ไม่ผูกค่าใช้จ่าย' ELSE li.icode END) AS lab_icode,
            lc.lab_catalog_lc_code AS lab_catalog_icode,
            (CASE WHEN li.icode IS NOT NULL AND li.icode<>'' AND lc.lab_catalog_lc_code IS NOT NULL AND lc.lab_catalog_lc_code<>'' AND li.no_lab_catalog IS NULL THEN 'Y'
                  WHEN li.icode IS NULL AND lc.lab_catalog_lc_code IS NULL AND li.no_lab_catalog='Y' THEN 'Y'
                  WHEN li.icode IS NOT NULL AND li.icode<>'' AND (lc.lab_catalog_lc_code IS NULL OR lc.lab_catalog_lc_code='') AND li.no_lab_catalog IS NULL THEN 'N'
                  ELSE 'Y' END) AS lab_catalog_icode_check,
            li.no_lab_catalog, li.lab_items_name AS lab_name, li.service_price AS price,
            (CASE WHEN (li.tmlt_code='' OR li.tmlt_code IS NULL) THEN 'ไม่ผูกค่าใช้จ่าย' ELSE li.tmlt_code END) AS lab_tmlt,
            lc.lab_catalog_tmlt,
            (CASE WHEN li.tmlt_code IS NOT NULL AND li.tmlt_code<>'' AND lc.lab_catalog_tmlt IS NOT NULL AND lc.lab_catalog_tmlt<>'' AND li.no_lab_catalog IS NULL THEN 'Y'
                  WHEN li.tmlt_code IS NULL AND lc.lab_catalog_tmlt IS NULL AND li.no_lab_catalog='Y' THEN 'Y'
                  WHEN li.tmlt_code IS NOT NULL AND li.tmlt_code<>'' AND (lc.lab_catalog_tmlt IS NULL OR lc.lab_catalog_tmlt='') AND li.no_lab_catalog IS NULL THEN 'N'
                  ELSE 'Y' END) AS lab_catalog_tmlt_check,
            lc.lab_catalog_name, n.name AS nondrug_name, 'Item' AS lab_type,
            n.sks_coverage_price, p.price AS pttype_price,
            (CASE WHEN n.sks_coverage_price IS NULL OR p.price IS NULL THEN ''
                  WHEN n.sks_coverage_price<>p.price THEN 'N' ELSE 'Y' END) AS sks_price_check
            FROM lab_items li
            LEFT OUTER JOIN lab_items_group lig ON lig.lab_items_group_code = li.lab_items_group
            LEFT OUTER JOIN lab_catalog_import_detail lc ON lc.lab_catalog_lc_code = li.icode
            LEFT OUTER JOIN nondrugitems n ON n.icode = li.icode
            LEFT OUTER JOIN pttype_items_price p ON p.items_table_code = n.icode AND p.pttype IN ('*1')
            WHERE li.active_status = 'Y'

            ORDER BY lab_items_group_name, lab_type DESC
        `;
        let rows;
        if (type === 'postgresql') {
            const client = new PgClient({ host, port: parseInt(port), database, user, password, connectionTimeoutMillis: 20000 });
            await client.connect();
            await addCols(client, true);
            await client.query(`SET statement_timeout = 55000`); // 55 วินาที
            const result = await client.query(buildQuery());
            await client.end();
            rows = result.rows;
        } else {
            const connection = await mysql.createConnection({ host, port, user, password, database, connectTimeout: 20000 });
            await addCols(connection, false);
            await connection.execute(`SET SESSION max_execution_time = 55000`); // 55 วินาที (MySQL 5.7.8+)
            const [r] = await connection.execute(buildQuery());
            await connection.end();
            rows = r;
        }
        const normalized = rows.map(r => { const o={}; Object.keys(r).forEach(k=>{ o[k.toLowerCase()]=r[k]; }); return o; });
        res.json({ success: true, data: normalized, count: normalized.length });
    } catch (error) {
        console.error('BasicLab error:', error);
        res.json({ success: false, error: error.message });
    }
});

// 6. BloodBank
app.post('/api/get-basic-bloodbank', async (req, res) => {
    try {
        const { host, port, database, user, password, type } = req.body;
        const addCols = async (client, isPg) => {
            if (isPg) {
                await client.query(`ALTER TABLE lab_items ADD COLUMN IF NOT EXISTS no_lab_catalog CHAR(1)`).catch(()=>{});
                await client.query(`CREATE INDEX IF NOT EXISTS idx_lab_catalog_import_detail_lc_code ON lab_catalog_import_detail(lab_catalog_lc_code)`).catch(()=>{});
            } else {
                const [rows] = await client.execute(`SELECT COUNT(*) AS cnt FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='lab_items' AND COLUMN_NAME='no_lab_catalog'`);
                if (!rows[0].cnt) await client.execute(`ALTER TABLE \`lab_items\` ADD COLUMN \`no_lab_catalog\` CHAR(1) NULL`).catch(()=>{});
                const [idxRows] = await client.execute(`SELECT COUNT(*) AS cnt FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='lab_catalog_import_detail' AND INDEX_NAME='idx_lab_catalog_import_detail_lc_code'`);
                if (!idxRows[0].cnt) await client.execute(`CREATE INDEX \`idx_lab_catalog_import_detail_lc_code\` ON \`lab_catalog_import_detail\`(\`lab_catalog_lc_code\`)`).catch(()=>{});
            }
        };

        const buildQuery = () => `
            SELECT bb.blb_bloodbank_items_id AS bloodbank_id,
            bb.blb_bloodbank_items_name AS bloodbank_name,
            bb.icode AS bloodbank_icode,
            bb.blb_bloodbank_items_unit AS bloodbank_unit,
            bb.tmlt_code AS bloodbank_tmlt,
            (CASE WHEN (bb.tmlt_code IS NULL OR bb.tmlt_code='') THEN 'N' ELSE 'Y' END) AS bloodbank_tmlt_check,
            lc.lab_catalog_lc_code AS lab_catalog_icode,
            (CASE WHEN (lc.lab_catalog_lc_code IS NULL OR lc.lab_catalog_lc_code='') THEN 'N' ELSE 'Y' END) AS lab_catalog_icode_check,
            lc.lab_catalog_tmlt,
            (CASE WHEN (lc.lab_catalog_tmlt IS NULL OR lc.lab_catalog_tmlt='') THEN 'N' ELSE 'Y' END) AS lab_catalog_tmlt_check,
            lc.lab_catalog_name, n.name AS nondrug_name, li.no_lab_catalog
            FROM blb_bloodbank_items bb
            LEFT OUTER JOIN lab_catalog_import_detail lc ON lc.lab_catalog_lc_code = bb.icode
            LEFT OUTER JOIN nondrugitems n ON n.icode = bb.icode
            LEFT OUTER JOIN lab_items li ON li.icode = bb.icode
            WHERE bb.active = 'Y'
            GROUP BY bb.blb_bloodbank_items_id, bb.blb_bloodbank_items_name, bb.icode,
            bb.blb_bloodbank_items_unit, bb.tmlt_code, lc.lab_catalog_lc_code,
            lc.lab_catalog_tmlt, lc.lab_catalog_name, n.name, li.no_lab_catalog
            ORDER BY bb.blb_bloodbank_items_name
        `;
        let rows;
        if (type === 'postgresql') {
            const client = new PgClient({ host, port: parseInt(port), database, user, password, connectionTimeoutMillis: 15000 });
            await client.connect();
            await addCols(client, true);
            await client.query(`SET statement_timeout = 55000`); // 55 วินาที
            const result = await client.query(buildQuery());
            await client.end();
            rows = result.rows;
        } else {
            const connection = await mysql.createConnection({ host, port, user, password, database, connectTimeout: 15000 });
            await addCols(connection, false);
            await connection.execute(`SET SESSION max_execution_time = 55000`); // 55 วินาที (MySQL 5.7.8+)
            const [r] = await connection.execute(buildQuery());
            await connection.end();
            rows = r;
        }
        const normalized = rows.map(r => { const o={}; Object.keys(r).forEach(k=>{ o[k.toLowerCase()]=r[k]; }); return o; });
        res.json({ success: true, data: normalized, count: normalized.length });
    } catch (error) {
        console.error('BasicBloodBank error:', error);
        res.json({ success: false, error: error.message });
    }
});

// อัปเดต no_lab_catalog
app.post('/api/set-no-lab-catalog', async (req, res) => {
    try {
        const { host, port, database, user, password, type, lab_icode, lab_type, value } = req.body;
        const val = (value === 'Y') ? 'Y' : null;
        const execute = async (conn, isPg) => {
            if (lab_type === 'Profile') {
                if (isPg) await conn.query('UPDATE lab_items_sub_group SET no_lab_catalog=$1 WHERE group_icode=$2', [val, lab_icode]);
                else await conn.execute('UPDATE `lab_items_sub_group` SET `no_lab_catalog`=? WHERE `group_icode`=?', [val, lab_icode]);
            } else {
                if (isPg) await conn.query('UPDATE lab_items SET no_lab_catalog=$1 WHERE icode=$2', [val, lab_icode]);
                else await conn.execute('UPDATE `lab_items` SET `no_lab_catalog`=? WHERE `icode`=?', [val, lab_icode]);
            }
        };
        if (type === 'postgresql') {
            const client = new PgClient({ host, port: parseInt(port), database, user, password, connectionTimeoutMillis: 10000 });
            await client.connect();
            await execute(client, true);
            await client.end();
        } else {
            const connection = await mysql.createConnection({ host, port, user, password, database, connectTimeout: 10000 });
            await execute(connection, false);
            await connection.end();
        }
        res.json({ success: true });
    } catch (error) {
        console.error('SetNoLabCatalog error:', error);
        res.json({ success: false, error: error.message });
    }
});

// 7. ข้อมูล X-Ray
app.post('/api/get-basic-xray', async (req, res) => {
    try {
        const { host, port, database, user, password, type } = req.body;
        const buildQuery = () => `
            SELECT x.xray_items_code AS xray_code, x.xray_items_name AS xray_name,
            x.exposure_qty, x.service_price AS price,
            x.icode AS xray_icode, n.icode AS n_icode,
            (CASE WHEN n.icode IS NULL THEN 'N' ELSE 'Y' END) AS n_icode_check,
            n.name AS n_name, n.billcode
            FROM xray_items x
            LEFT OUTER JOIN nondrugitems n ON n.icode = x.icode
            WHERE x.active_status = 'Y'
            ORDER BY x.xray_items_name
        `;
        let rows;
        if (type === 'postgresql') {
            const client = new PgClient({ host, port: parseInt(port), database, user, password, connectionTimeoutMillis: 15000 });
            await client.connect();
            const result = await client.query(buildQuery());
            await client.end();
            rows = result.rows;
        } else {
            const connection = await mysql.createConnection({ host, port, user, password, database, connectTimeout: 15000 });
            const [r] = await connection.execute(buildQuery());
            await connection.end();
            rows = r;
        }
        const normalized = rows.map(r => { const o={}; Object.keys(r).forEach(k=>{ o[k.toLowerCase()]=r[k]; }); return o; });
        res.json({ success: true, data: normalized, count: normalized.length });
    } catch (error) {
        console.error('BasicXray error:', error);
        res.json({ success: false, error: error.message });
    }
});

// 7b. Update xray field
app.post('/api/update-xray-field', async (req, res) => {
    try {
        const { host, port, database, user, password, type, xray_code, field, value } = req.body;
        const allowed = { xray_name: 'xray_items_name', exposure_qty: 'exposure_qty', price: 'service_price' };
        const dbField = allowed[field];
        if (!dbField) return res.json({ success: false, error: 'ฟิลด์ไม่ถูกต้อง' });
        if (type === 'postgresql') {
            const client = new PgClient({ host, port: parseInt(port), database, user, password, connectionTimeoutMillis: 10000 });
            await client.connect();
            await client.query(`UPDATE xray_items SET ${dbField} = $1 WHERE xray_items_code = $2`, [value, xray_code]);
            await client.end();
        } else {
            const connection = await mysql.createConnection({ host, port, user, password, database, connectTimeout: 10000 });
            await connection.execute(`UPDATE xray_items SET \`${dbField}\` = ? WHERE xray_items_code = ?`, [value, xray_code]);
            await connection.end();
        }
        res.json({ success: true });
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

// 8. รายการยา
app.post('/api/get-basic-drug', async (req, res) => {
    try {
        const { host, port, database, user, password, type } = req.body;
        const buildQuery = () => `
            SELECT d.icode, d.name AS drugname, d.strength, d.units, d.unitprice,
            d.dosageform, d.generic_name, d.trade_name, i1.name AS income_name,
            d.sks_price,
            (CASE WHEN d.sks_price IS NULL THEN 'N' ELSE 'Y' END) AS sks_price_check,
            s1.sks_product_category_name,
            (CASE WHEN (s1.sks_product_category_name IS NULL OR s1.sks_product_category_name='') THEN 'N' ELSE 'Y' END) AS sks_product_category_name_check,
            s2.sks_claim_control_type_name,
            (CASE WHEN (s2.sks_claim_control_type_name IS NULL OR s2.sks_claim_control_type_name='') THEN 'N' ELSE 'Y' END) AS sks_claim_control_type_name_check,
            d.sks_drug_code,
            (CASE WHEN (d.sks_drug_code IS NULL OR d.sks_drug_code='') THEN 'N' ELSE 'Y' END) AS sks_drug_code_check
            FROM drugitems d
            LEFT OUTER JOIN sks_product_category s1 ON s1.sks_product_category_id = d.sks_product_category_id
            LEFT OUTER JOIN sks_claim_control_type s2 ON s2.sks_claim_control_type_id = d.sks_clain_control_type_id
            LEFT OUTER JOIN sks_drug_code s3 ON s3.sks_drug_code = d.sks_drug_code
            LEFT OUTER JOIN income i1 ON i1.income = d.income
            WHERE d.istatus = 'Y'
            ORDER BY d.name, d.strength, d.units
        `;
        let rows;
        if (type === 'postgresql') {
            const client = new PgClient({ host, port: parseInt(port), database, user, password, connectionTimeoutMillis: 20000 });
            await client.connect();
            const result = await client.query(buildQuery());
            await client.end();
            rows = result.rows;
        } else {
            const connection = await mysql.createConnection({ host, port, user, password, database, connectTimeout: 20000 });
            const [r] = await connection.execute(buildQuery());
            await connection.end();
            rows = r;
        }
        const normalized = rows.map(r => { const o={}; Object.keys(r).forEach(k=>{ o[k.toLowerCase()]=r[k]; }); return o; });
        res.json({ success: true, data: normalized, count: normalized.length });
    } catch (error) {
        console.error('BasicDrug error:', error);
        res.json({ success: false, error: error.message });
    }
});

// 8b. รายการยา (CSOP/SSOP/CIPN/AIPN) — ใช้ sks_reimb_price แทน sks_price
app.post('/api/get-basic-drug-reimb', async (req, res) => {
    try {
        const { host, port, database, user, password, type } = req.body;
        const buildQuery = () => `
            SELECT d.icode, d.name AS drugname, d.strength, d.units, d.unitprice,
            d.dosageform, d.generic_name, d.trade_name, i1.name AS income_name,
            d.sks_reimb_price AS sks_price,
            (CASE WHEN d.sks_reimb_price IS NULL THEN 'N' ELSE 'Y' END) AS sks_price_check,
            s1.sks_product_category_name,
            (CASE WHEN (s1.sks_product_category_name IS NULL OR s1.sks_product_category_name='') THEN 'N' ELSE 'Y' END) AS sks_product_category_name_check,
            s2.sks_claim_control_type_name,
            (CASE WHEN (s2.sks_claim_control_type_name IS NULL OR s2.sks_claim_control_type_name='') THEN 'N' ELSE 'Y' END) AS sks_claim_control_type_name_check,
            d.sks_drug_code,
            (CASE WHEN (d.sks_drug_code IS NULL OR d.sks_drug_code='') THEN 'N' ELSE 'Y' END) AS sks_drug_code_check
            FROM drugitems d
            LEFT OUTER JOIN sks_product_category s1 ON s1.sks_product_category_id = d.sks_product_category_id
            LEFT OUTER JOIN sks_claim_control_type s2 ON s2.sks_claim_control_type_id = d.sks_clain_control_type_id
            LEFT OUTER JOIN sks_drug_code s3 ON s3.sks_drug_code = d.sks_drug_code
            LEFT OUTER JOIN income i1 ON i1.income = d.income
            WHERE d.istatus = 'Y'
            ORDER BY d.name, d.strength, d.units
        `;
        let rows;
        if (type === 'postgresql') {
            const client = new PgClient({ host, port: parseInt(port), database, user, password, connectionTimeoutMillis: 20000 });
            await client.connect();
            const result = await client.query(buildQuery());
            await client.end();
            rows = result.rows;
        } else {
            const connection = await mysql.createConnection({ host, port, user, password, database, connectTimeout: 20000 });
            const [r] = await connection.execute(buildQuery());
            await connection.end();
            rows = r;
        }
        const normalized = rows.map(r => { const o={}; Object.keys(r).forEach(k=>{ o[k.toLowerCase()]=r[k]; }); return o; });
        res.json({ success: true, data: normalized, count: normalized.length });
    } catch (error) {
        console.error('BasicDrugReimb error:', error);
        res.json({ success: false, error: error.message });
    }
});

// 9. sks_icd10tm
app.post('/api/get-basic-icd10tm', async (req, res) => {
    try {
        const { host, port, database, user, password, type } = req.body;
        const buildQuery = () => `
            SELECT os.code,
            sc.code AS icd10_sks,
            (CASE WHEN (sc.code IS NULL OR sc.code='') THEN 'N' ELSE 'Y' END) AS cut_check,
            (CASE WHEN (os.code IS NULL OR os.code='') THEN 'N' ELSE 'Y' END) AS import_check
            FROM ovst_sks_icd10tm os
            LEFT OUTER JOIN sks_icd10tm_check sc ON sc.code = os.code
        `;
        let rows;
        if (type === 'postgresql') {
            const client = new PgClient({ host, port: parseInt(port), database, user, password, connectionTimeoutMillis: 15000 });
            await client.connect();
            const result = await client.query(buildQuery());
            await client.end();
            rows = result.rows;
        } else {
            const connection = await mysql.createConnection({ host, port, user, password, database, connectTimeout: 15000 });
            const [r] = await connection.execute(buildQuery());
            await connection.end();
            rows = r;
        }
        const normalized = rows.map(r => { const o={}; Object.keys(r).forEach(k=>{ o[k.toLowerCase()]=r[k]; }); return o; });
        res.json({ success: true, data: normalized, count: normalized.length });
    } catch (error) {
        console.error('BasicIcd10tm error:', error);
        res.json({ success: false, error: error.message });
    }
});

// 10. หัตถการผู้ป่วยนอก
app.post('/api/get-basic-opd-procedure', async (req, res) => {
    runBasicQuery(req, res, () => `
        SELECT
            e.er_oper_code,
            CASE WHEN (e.er_oper_code IS NULL OR e.er_oper_code = '') THEN 'N' ELSE 'Y' END AS check_er_oper_code,
            e.name,
            CASE WHEN (e.name IS NULL OR e.name = '') THEN 'N' ELSE 'Y' END AS check_name
        FROM er_oper e
        ORDER BY e.er_oper_code
    `, 'BasicOpdProcedure');
});

// 11. รายการผ่าตัด
app.post('/api/get-basic-or-operation', async (req, res) => {
    runBasicQuery(req, res, () => `
        SELECT
            o.oper_code,
            CASE WHEN (o.oper_code IS NULL OR o.oper_code = '') THEN 'N' ELSE 'Y' END AS check_oper_code,
            o.name,
            CASE WHEN (o.name IS NULL OR o.name = '') THEN 'N' ELSE 'Y' END AS check_name
        FROM operation_item o
        ORDER BY o.oper_code
    `, 'BasicOrOperation');
});

// ==================== position_check table management ====================

async function dbRun(type, { host, port, database, user, password }, sql, params = []) {
    if (type === 'postgresql') {
        const client = new PgClient({ host, port: parseInt(port), database, user, password, connectionTimeoutMillis: 10000 });
        await client.connect();
        let n = 0;
        const pgSql = sql.replace(/\?/g, () => `$${++n}`);
        const result = await client.query(pgSql, params);
        await client.end();
        return result.rows;
    } else {
        const connection = await mysql.createConnection({ host, port, user, password, database, connectTimeout: 10000 });
        const [rows] = await connection.execute(sql, params);
        await connection.end();
        return rows;
    }
}

// สร้างตาราง position_check
app.post('/api/create-position-check-table', async (req, res) => {
    try {
        const { host, port, database, user, password, type } = req.body;
        const db = { host, port, database, user, password };
        if (type === 'postgresql') {
            await dbRun(type, db, `
                CREATE TABLE IF NOT EXISTS position_check (
                    position_check_id SERIAL       NOT NULL,
                    position_id       INTEGER       NOT NULL,
                    position_name     VARCHAR(200)  NOT NULL,
                    CONSTRAINT pk_position_check PRIMARY KEY (position_check_id)
                )
            `);
            await dbRun(type, db, `
                CREATE UNIQUE INDEX IF NOT EXISTS idx_position_check_id
                ON position_check USING BTREE (position_check_id)
            `);
        } else {
            await dbRun(type, db, `
                CREATE TABLE IF NOT EXISTS \`position_check\` (
                    \`position_check_id\` INT NOT NULL AUTO_INCREMENT COMMENT 'PK',
                    \`position_id\`       INT NOT NULL               COMMENT 'รหัสตำแหน่ง',
                    \`position_name\`     VARCHAR(200) NOT NULL       COMMENT 'ชื่อตำแหน่ง',
                    PRIMARY KEY (\`position_check_id\`),
                    UNIQUE INDEX \`idx_position_check_id\` (\`position_check_id\`) USING BTREE
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
            `);
        }
        res.json({ success: true, message: 'สร้างตาราง position_check สำเร็จ' });
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

// ดึงรายการ position_check ทั้งหมด
app.post('/api/get-position-check', async (req, res) => {
    try {
        const { host, port, database, user, password, type } = req.body;
        const rows = await dbRun(type, { host, port, database, user, password },
            'SELECT position_check_id, position_id, position_name FROM position_check ORDER BY position_check_id'
        );
        res.json({ success: true, data: rows });
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

// เพิ่มรายการ position_check
app.post('/api/insert-position-check', async (req, res) => {
    try {
        const { host, port, database, user, password, type, position_id, position_name } = req.body;
        await dbRun(type, { host, port, database, user, password },
            'INSERT INTO position_check (position_id, position_name) VALUES (?, ?)',
            [position_id, position_name]
        );
        res.json({ success: true });
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

// ลบรายการ position_check
app.post('/api/delete-position-check', async (req, res) => {
    try {
        const { host, port, database, user, password, type, position_check_id } = req.body;
        await dbRun(type, { host, port, database, user, password },
            'DELETE FROM position_check WHERE position_check_id = ?',
            [position_check_id]
        );
        res.json({ success: true });
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

// ==================== FDH Basic Data Endpoints ====================

app.post('/api/get-fdh-pname', async (req, res) => {
    try {
        const { host, port, database, user, password, type } = req.body;
        const buildQuery = () => `
            SELECT p.name, v.provis_pname_long_name, p.sex, p.provis_code,
            (CASE WHEN p.provis_code = v.provis_pname_code THEN 'Y' ELSE 'N' END) AS pname_check
            FROM pname p
            LEFT OUTER JOIN provis_pname v ON p.provis_code = v.provis_pname_code
            ORDER BY p.provis_code
        `;
        let rows;
        if (type === 'postgresql') {
            const client = new PgClient({ host, port: parseInt(port), database, user, password, connectionTimeoutMillis: 10000 });
            await client.connect();
            const result = await client.query(buildQuery());
            await client.end();
            rows = result.rows;
        } else {
            const connection = await mysql.createConnection({ host, port, user, password, database, connectTimeout: 10000 });
            const [r] = await connection.execute(buildQuery());
            await connection.end();
            rows = r;
        }
        const normalized = rows.map(r => { const o={}; Object.keys(r).forEach(k=>{ o[k.toLowerCase()]=r[k]; }); return o; });
        res.json({ success: true, data: normalized, count: normalized.length });
    } catch (error) {
        console.error('FDH pname error:', error);
        res.json({ success: false, error: error.message });
    }
});

app.post('/api/get-fdh-nationality', async (req, res) => {
    try {
        const { host, port, database, user, password, type } = req.body;
        const buildQuery = () => `
            SELECT n.nationality, n.name, n.nhso_code,
            (CASE WHEN n.nhso_code = p.code AND n.name = p.name THEN 'Y' ELSE 'N' END) AS nationality_check
            FROM nationality n
            LEFT OUTER JOIN provis_nation p ON p.code = n.nhso_code
            ORDER BY n.nhso_code
        `;
        let rows;
        if (type === 'postgresql') {
            const client = new PgClient({ host, port: parseInt(port), database, user, password, connectionTimeoutMillis: 10000 });
            await client.connect();
            const result = await client.query(buildQuery());
            await client.end();
            rows = result.rows;
        } else {
            const connection = await mysql.createConnection({ host, port, user, password, database, connectTimeout: 10000 });
            const [r] = await connection.execute(buildQuery());
            await connection.end();
            rows = r;
        }
        const normalized = rows.map(r => { const o={}; Object.keys(r).forEach(k=>{ o[k.toLowerCase()]=r[k]; }); return o; });
        res.json({ success: true, data: normalized, count: normalized.length });
    } catch (error) {
        console.error('FDH nationality error:', error);
        res.json({ success: false, error: error.message });
    }
});

app.post('/api/get-fdh-marrystatus', async (req, res) => {
    try {
        const { host, port, database, user, password, type } = req.body;
        const buildQuery = () => `
            SELECT m.code, m.name, m.nhso_marriage_code,
            (CASE WHEN m.nhso_marriage_code = p.code THEN 'Y' ELSE 'N' END) AS marry_check
            FROM marrystatus m
            LEFT OUTER JOIN provis_mstatus p ON p.code = m.nhso_marriage_code
            ORDER BY m.code
        `;
        let rows;
        if (type === 'postgresql') {
            const client = new PgClient({ host, port: parseInt(port), database, user, password, connectionTimeoutMillis: 10000 });
            await client.connect();
            const result = await client.query(buildQuery());
            await client.end();
            rows = result.rows;
        } else {
            const connection = await mysql.createConnection({ host, port, user, password, database, connectTimeout: 10000 });
            const [r] = await connection.execute(buildQuery());
            await connection.end();
            rows = r;
        }
        const normalized = rows.map(r => { const o={}; Object.keys(r).forEach(k=>{ o[k.toLowerCase()]=r[k]; }); return o; });
        res.json({ success: true, data: normalized, count: normalized.length });
    } catch (error) {
        console.error('FDH marrystatus error:', error);
        res.json({ success: false, error: error.message });
    }
});

app.post('/api/get-fdh-sex', async (req, res) => {
    try {
        const { host, port, database, user, password, type } = req.body;
        const buildQuery = () => `SELECT code, name FROM sex`;
        let rows;
        if (type === 'postgresql') {
            const client = new PgClient({ host, port: parseInt(port), database, user, password, connectionTimeoutMillis: 10000 });
            await client.connect();
            const result = await client.query(buildQuery());
            await client.end();
            rows = result.rows;
        } else {
            const connection = await mysql.createConnection({ host, port, user, password, database, connectTimeout: 10000 });
            const [r] = await connection.execute(buildQuery());
            await connection.end();
            rows = r;
        }
        const normalized = rows.map(r => { const o={}; Object.keys(r).forEach(k=>{ o[k.toLowerCase()]=r[k]; }); return o; });
        res.json({ success: true, data: normalized, count: normalized.length });
    } catch (error) {
        console.error('FDH sex error:', error);
        res.json({ success: false, error: error.message });
    }
});

app.post('/api/get-fdh-occupation', async (req, res) => {
    try {
        const { host, port, database, user, password, type } = req.body;
        const buildQuery = () => `
            SELECT c.name, c.occupation, c.nhso_code,
            (CASE WHEN c.nhso_code = p.code THEN 'Y' ELSE 'N' END) AS occupa_check
            FROM occupation c
            LEFT OUTER JOIN provis_occupa p ON p.code = c.nhso_code
            ORDER BY c.nhso_code
        `;
        let rows;
        if (type === 'postgresql') {
            const client = new PgClient({ host, port: parseInt(port), database, user, password, connectionTimeoutMillis: 10000 });
            await client.connect();
            const result = await client.query(buildQuery());
            await client.end();
            rows = result.rows;
        } else {
            const connection = await mysql.createConnection({ host, port, user, password, database, connectTimeout: 10000 });
            const [r] = await connection.execute(buildQuery());
            await connection.end();
            rows = r;
        }
        const normalized = rows.map(r => { const o={}; Object.keys(r).forEach(k=>{ o[k.toLowerCase()]=r[k]; }); return o; });
        res.json({ success: true, data: normalized, count: normalized.length });
    } catch (error) {
        console.error('FDH occupation error:', error);
        res.json({ success: false, error: error.message });
    }
});

app.post('/api/get-fdh-religion', async (req, res) => {
    try {
        const { host, port, database, user, password, type } = req.body;
        const buildQuery = () => `
            SELECT r.religion, r.name,
            (CASE WHEN r.nhso_code = p.code THEN 'Y' ELSE 'N' END) AS religion_check,
            p.code AS provis_code, p.name AS provis_name, r.nhso_code
            FROM religion r
            LEFT OUTER JOIN provis_religion p ON p.code = r.nhso_code
            ORDER BY r.nhso_code
        `;
        let rows;
        if (type === 'postgresql') {
            const client = new PgClient({ host, port: parseInt(port), database, user, password, connectionTimeoutMillis: 10000 });
            await client.connect();
            const result = await client.query(buildQuery());
            await client.end();
            rows = result.rows;
        } else {
            const connection = await mysql.createConnection({ host, port, user, password, database, connectTimeout: 10000 });
            const [r] = await connection.execute(buildQuery());
            await connection.end();
            rows = r;
        }
        const normalized = rows.map(r => { const o={}; Object.keys(r).forEach(k=>{ o[k.toLowerCase()]=r[k]; }); return o; });
        res.json({ success: true, data: normalized, count: normalized.length });
    } catch (error) {
        console.error('FDH religion error:', error);
        res.json({ success: false, error: error.message });
    }
});

app.post('/api/get-fdh-spclty', async (req, res) => {
    try {
        const { host, port, database, user, password, type } = req.body;
        const isPg = type === 'postgresql';
        const lenFn = isPg ? 'CHAR_LENGTH' : 'LENGTH';
        const buildQuery = () => `
            SELECT spclty, name, provis_code, nhso_code,
            (CASE WHEN provis_code <> '' OR ${lenFn}(provis_code) = 5 THEN 'Y' ELSE 'N' END) AS provis_check,
            (CASE WHEN nhso_code <> '' THEN 'Y' ELSE 'N' END) AS nhso_check
            FROM spclty
            ORDER BY nhso_code
        `;
        let rows;
        if (isPg) {
            const client = new PgClient({ host, port: parseInt(port), database, user, password, connectionTimeoutMillis: 10000 });
            await client.connect();
            const result = await client.query(buildQuery());
            await client.end();
            rows = result.rows;
        } else {
            const connection = await mysql.createConnection({ host, port, user, password, database, connectTimeout: 10000 });
            const [r] = await connection.execute(buildQuery());
            await connection.end();
            rows = r;
        }
        const normalized = rows.map(r => { const o={}; Object.keys(r).forEach(k=>{ o[k.toLowerCase()]=r[k]; }); return o; });
        res.json({ success: true, data: normalized, count: normalized.length });
    } catch (error) {
        console.error('FDH spclty error:', error);
        res.json({ success: false, error: error.message });
    }
});

app.post('/api/get-fdh-dchtype', async (req, res) => {
    runBasicQuery(req, res, () => `
        SELECT dchtype, name, nhso_dchtype,
        (CASE WHEN nhso_dchtype <> '' THEN 'Y' ELSE 'N' END) AS dchtype_check
        FROM dchtype ORDER BY dchtype
    `, 'FDH dchtype');
});

app.post('/api/get-fdh-dchstts', async (req, res) => {
    runBasicQuery(req, res, () => `
        SELECT dchstts, name, nhso_dchstts,
        (CASE WHEN nhso_dchstts <> '' THEN 'Y' ELSE 'N' END) AS dchstts_check
        FROM dchstts ORDER BY dchstts
    `, 'FDH dchstts');
});

app.post('/api/get-fdh-diagtype', async (req, res) => {
    try {
        const { host, port, database, user, password, type } = req.body;
        const buildQuery = () => `
            SELECT d.diagtype, d.nhso_code, d.name,
            (CASE WHEN d.nhso_code = p.code THEN 'Y' ELSE 'N' END) AS diagtype_check
            FROM diagtype d
            LEFT OUTER JOIN provis_diagtype p ON p.code = d.nhso_code
            ORDER BY d.nhso_code
        `;
        let rows;
        if (type === 'postgresql') {
            const client = new PgClient({ host, port: parseInt(port), database, user, password, connectionTimeoutMillis: 10000 });
            await client.connect();
            const result = await client.query(buildQuery());
            await client.end();
            rows = result.rows;
        } else {
            const connection = await mysql.createConnection({ host, port, user, password, database, connectTimeout: 10000 });
            const [r] = await connection.execute(buildQuery());
            await connection.end();
            rows = r;
        }
        const normalized = rows.map(r => { const o={}; Object.keys(r).forEach(k=>{ o[k.toLowerCase()]=r[k]; }); return o; });
        res.json({ success: true, data: normalized, count: normalized.length });
    } catch (error) {
        console.error('FDH diagtype error:', error);
        res.json({ success: false, error: error.message });
    }
});

app.post('/api/get-fdh-er-oper-code', async (req, res) => {
    try {
        const { host, port, database, user, password, type } = req.body;
        const buildQuery = () => `
            SELECT e.er_oper_code, e.name, n.price, n.name AS nonname,
            (CASE WHEN e.icode <> '' AND e.icode = n.icode THEN 'Y' ELSE 'N' END) AS price_check,
            e.icd9cm,
            (CASE WHEN e.icd9cm = m.code THEN 'Y' ELSE 'N' END) AS icd9cm_check,
            e.export_proced,
            (CASE WHEN e.export_proced = 'Y' THEN 'Y' ELSE 'N' END) AS export_proced_check
            FROM er_oper_code e
            LEFT OUTER JOIN nondrugitems n ON n.icode = e.icode
            LEFT OUTER JOIN icd9cm1 m ON m.code = e.icd9cm
            WHERE e.active_status = 'Y' AND n.income = '11'
            ORDER BY e.name
        `;
        let rows;
        if (type === 'postgresql') {
            const client = new PgClient({ host, port: parseInt(port), database, user, password, connectionTimeoutMillis: 10000 });
            await client.connect();
            const result = await client.query(buildQuery());
            await client.end();
            rows = result.rows;
        } else {
            const connection = await mysql.createConnection({ host, port, user, password, database, connectTimeout: 10000 });
            const [r] = await connection.execute(buildQuery());
            await connection.end();
            rows = r;
        }
        const normalized = rows.map(r => { const o={}; Object.keys(r).forEach(k=>{ o[k.toLowerCase()]=r[k]; }); return o; });
        res.json({ success: true, data: normalized, count: normalized.length });
    } catch (error) {
        console.error('FDH er_oper_code error:', error);
        res.json({ success: false, error: error.message });
    }
});

app.post('/api/get-fdh-nondrugite', async (req, res) => {
    try {
        const { host, port, database, user, password, type } = req.body;
        const isPg = type === 'postgresql';
        const nameCheck = isPg
            ? `(CASE WHEN n.name ~ '[\\r\\n<>"''&]' THEN 'N' ELSE 'Y' END)`
            : `(CASE WHEN n.name REGEXP '[\\r\\n<>"''&]' THEN 'N' ELSE 'Y' END)`;
        const buildQuery = () => `
            SELECT n.icode, n.name,
            ${nameCheck} AS name_check,
            n.unit, n.price, n.billcode, n.income, i.name AS income_name,
            nat.nhso_adp_type_name,
            (CASE
              WHEN i.drg_chrgitem_id='1'  AND n.nhso_adp_type_id='10' THEN 'Y'
              WHEN i.drg_chrgitem_id='2'  AND n.nhso_adp_type_id='2'  THEN 'Y'
              WHEN i.drg_chrgitem_id='5'  AND n.nhso_adp_type_id='11' THEN 'Y'
              WHEN i.drg_chrgitem_id='6'  AND n.nhso_adp_type_id='14' THEN 'Y'
              WHEN i.drg_chrgitem_id='7'  AND n.nhso_adp_type_id='15' THEN 'Y'
              WHEN i.drg_chrgitem_id='8'  AND n.nhso_adp_type_id='16' THEN 'Y'
              WHEN i.drg_chrgitem_id='9'  AND n.nhso_adp_type_id='9'  THEN 'Y'
              WHEN i.drg_chrgitem_id='10' AND n.nhso_adp_type_id='18' THEN 'Y'
              WHEN i.drg_chrgitem_id='11' AND n.nhso_adp_type_id='19' THEN 'Y'
              WHEN i.drg_chrgitem_id='12' AND n.nhso_adp_type_id='17' THEN 'Y'
              WHEN i.drg_chrgitem_id='13' AND n.nhso_adp_type_id='12' THEN 'Y'
              WHEN i.drg_chrgitem_id='14' AND n.nhso_adp_type_id='20' THEN 'Y'
              WHEN i.drg_chrgitem_id='15' AND n.nhso_adp_type_id='13' THEN 'Y'
              WHEN i.drg_chrgitem_id='16' AND n.nhso_adp_type_id='19' THEN 'Y'
              WHEN i.drg_chrgitem_id='17' AND n.nhso_adp_type_id='3'  THEN 'Y'
              WHEN i.drg_chrgitem_id='18' AND n.nhso_adp_type_id='4'  THEN 'Y'
              WHEN i.drg_chrgitem_id='19' AND n.nhso_adp_type_id='3'  THEN 'Y'
              ELSE 'N' END) AS check_adp_type,
            n.nhso_adp_type_id, n.nhso_adp_code,
            n.sks_coverage_price, n.enable_sks_opd, n.income_phdb_code,
            (CASE WHEN n.income_phdb_code <> '' THEN 'Y' ELSE 'N' END) AS check_phdb
            FROM nondrugitems n
            LEFT OUTER JOIN income i ON i.income = n.income
            LEFT OUTER JOIN drg_chrgitem d ON d.drg_chrgitem_id = i.drg_chrgitem_id
            LEFT OUTER JOIN nhso_adp_type nat ON nat.nhso_adp_type_id = n.nhso_adp_type_id
            LEFT OUTER JOIN nhso_adp_code nac ON nac.nhso_adp_code = n.nhso_adp_code
            LEFT OUTER JOIN sks_product_category spc ON spc.sks_product_category_id = n.sks_product_category_id
            WHERE n.istatus = 'Y'
            ORDER BY n.income, n.name
        `;
        let rows;
        if (isPg) {
            const client = new PgClient({ host, port: parseInt(port), database, user, password, connectionTimeoutMillis: 20000 });
            await client.connect();
            const result = await client.query(buildQuery());
            await client.end();
            rows = result.rows;
        } else {
            const connection = await mysql.createConnection({ host, port, user, password, database, connectTimeout: 20000 });
            const [r] = await connection.execute(buildQuery());
            await connection.end();
            rows = r;
        }
        const normalized = rows.map(r => { const o={}; Object.keys(r).forEach(k=>{ o[k.toLowerCase()]=r[k]; }); return o; });
        res.json({ success: true, data: normalized, count: normalized.length });
    } catch (error) {
        console.error('FDH nondrugite error:', error);
        res.json({ success: false, error: error.message });
    }
});

app.post('/api/get-fdh-physic-items', async (req, res) => {
    try {
        const { host, port, database, user, password, type } = req.body;
        const buildQuery = () => `
            SELECT p.physic_items_id, p.name, p.price, n.name AS nonname,
            (CASE WHEN p.icode <> '' AND p.icode = n.icode THEN 'Y' ELSE 'N' END) AS price_check,
            p.icd9, p.f43_rehab_code,
            (CASE WHEN p.f43_rehab_code <> '' THEN 'Y' ELSE 'N' END) AS export43_check,
            (CASE WHEN p.icd9 = m.code THEN 'Y' ELSE 'N' END) AS icd9_check,
            p.icd9_ipd_active_status,
            (CASE WHEN p.icd9_ipd_active_status = 'Y' THEN 'Y' ELSE 'N' END) AS ipd_active_check
            FROM physic_items p
            LEFT OUTER JOIN nondrugitems n ON n.icode = p.icode
            LEFT OUTER JOIN icd9cm1 m ON m.code = p.icd9
            WHERE p.active_status = 'Y'
            ORDER BY p.name
        `;
        let rows;
        if (type === 'postgresql') {
            const client = new PgClient({ host, port: parseInt(port), database, user, password, connectionTimeoutMillis: 15000 });
            await client.connect();
            const result = await client.query(buildQuery());
            await client.end();
            rows = result.rows;
        } else {
            const connection = await mysql.createConnection({ host, port, user, password, database, connectTimeout: 15000 });
            const [r] = await connection.execute(buildQuery());
            await connection.end();
            rows = r;
        }
        const normalized = rows.map(r => { const o={}; Object.keys(r).forEach(k=>{ o[k.toLowerCase()]=r[k]; }); return o; });
        res.json({ success: true, data: normalized, count: normalized.length });
    } catch (error) {
        console.error('FDH physic_items error:', error);
        res.json({ success: false, error: error.message });
    }
});

app.post('/api/get-fdh-ipt-oper-code', async (req, res) => {
    try {
        const { host, port, database, user, password, type } = req.body;
        const buildQuery = () => `
            SELECT e.ipt_oper_code, e.name, n.price, n.name AS nonname,
            (CASE WHEN e.icode <> '' AND e.icode = n.icode THEN 'Y' ELSE 'N' END) AS price_check,
            e.icd9cm,
            (CASE WHEN e.icd9cm = m.code THEN 'Y' ELSE 'N' END) AS icd9cm_check
            FROM ipt_oper_code e
            LEFT OUTER JOIN nondrugitems n ON n.icode = e.icode
            LEFT OUTER JOIN icd9cm1 m ON m.code = e.icd9cm
            WHERE e.active_status = 'Y' AND n.income = '11'
            ORDER BY e.name
        `;
        let rows;
        if (type === 'postgresql') {
            const client = new PgClient({ host, port: parseInt(port), database, user, password, connectionTimeoutMillis: 15000 });
            await client.connect();
            const result = await client.query(buildQuery());
            await client.end();
            rows = result.rows;
        } else {
            const connection = await mysql.createConnection({ host, port, user, password, database, connectTimeout: 15000 });
            const [r] = await connection.execute(buildQuery());
            await connection.end();
            rows = r;
        }
        const normalized = rows.map(r => { const o={}; Object.keys(r).forEach(k=>{ o[k.toLowerCase()]=r[k]; }); return o; });
        res.json({ success: true, data: normalized, count: normalized.length });
    } catch (error) {
        console.error('FDH ipt_oper_code error:', error);
        res.json({ success: false, error: error.message });
    }
});

app.post('/api/get-fdh-operation-item', async (req, res) => {
    try {
        const { host, port, database, user, password, type } = req.body;
        const buildQuery = () => `
            SELECT e.operation_item_id, e.name, n.price, n.name AS nonname,
            (CASE WHEN e.icode <> '' AND e.icode = n.icode THEN 'Y' ELSE 'N' END) AS price_check,
            e.icd9,
            (CASE WHEN e.icd9 = m.code THEN 'Y' ELSE 'N' END) AS icd9cm_check
            FROM operation_item e
            LEFT OUTER JOIN nondrugitems n ON n.icode = e.icode
            LEFT OUTER JOIN icd9cm1 m ON m.code = e.icd9
            WHERE e.active_status = 'Y' AND n.income = '11'
            ORDER BY e.name
        `;
        let rows;
        if (type === 'postgresql') {
            const client = new PgClient({ host, port: parseInt(port), database, user, password, connectionTimeoutMillis: 15000 });
            await client.connect();
            const result = await client.query(buildQuery());
            await client.end();
            rows = result.rows;
        } else {
            const connection = await mysql.createConnection({ host, port, user, password, database, connectTimeout: 15000 });
            const [r] = await connection.execute(buildQuery());
            await connection.end();
            rows = r;
        }
        const normalized = rows.map(r => { const o={}; Object.keys(r).forEach(k=>{ o[k.toLowerCase()]=r[k]; }); return o; });
        res.json({ success: true, data: normalized, count: normalized.length });
    } catch (error) {
        console.error('FDH operation_item error:', error);
        res.json({ success: false, error: error.message });
    }
});

app.post('/api/get-fdh-health-med-o', async (req, res) => {
    try {
        const { host, port, database, user, password, type } = req.body;
        const isPg = type === 'postgresql';
        const substrFn = isPg
            ? `SUBSTRING(m.code, 8, 9)`
            : `SUBSTRING(m.code, 8, 9)`;
        const buildQuery = () => `
            SELECT e.health_med_operation_item_id, e.health_med_operation_item_name,
            e.price,
            (CASE WHEN e.icode <> '' AND e.icode = n.icode THEN 'Y' ELSE 'N' END) AS price_check,
            n.name AS nonname,
            e.icd10tm,
            (CASE WHEN e.icd10tm IS NOT NULL THEN 'Y' ELSE 'N' END) AS icd10tm_check,
            r.health_med_operation_item_id AS organ_id,
            (CASE WHEN r.health_med_operation_item_id IS NULL THEN 'N' ELSE 'Y' END) AS organ_check
            FROM health_med_operation_item e
            LEFT OUTER JOIN nondrugitems n ON n.icode = e.icode
            LEFT OUTER JOIN health_med_operation_code m ON m.icd10tm = e.icd10tm
            LEFT OUTER JOIN (
                SELECT health_med_operation_item_id FROM health_med_operation_item_organ
                GROUP BY health_med_operation_item_id
            ) r ON r.health_med_operation_item_id = e.health_med_operation_item_id
            WHERE e.health_med_operation_type_id IS NOT NULL
            ORDER BY e.health_med_operation_item_name
        `;
        let rows;
        if (isPg) {
            const client = new PgClient({ host, port: parseInt(port), database, user, password, connectionTimeoutMillis: 15000 });
            await client.connect();
            const result = await client.query(buildQuery());
            await client.end();
            rows = result.rows;
        } else {
            const connection = await mysql.createConnection({ host, port, user, password, database, connectTimeout: 15000 });
            const [r] = await connection.execute(buildQuery());
            await connection.end();
            rows = r;
        }
        const normalized = rows.map(r => { const o={}; Object.keys(r).forEach(k=>{ o[k.toLowerCase()]=r[k]; }); return o; });
        res.json({ success: true, data: normalized, count: normalized.length });
    } catch (error) {
        console.error('FDH health_med_o error:', error);
        res.json({ success: false, error: error.message });
    }
});

app.post('/api/get-fdh-dttm', async (req, res) => {
    try {
        const { host, port, database, user, password, type } = req.body;
        const buildQuery = () => `
            SELECT d.code, d.name, d.opd_price1, n.name AS nonname,
            (CASE WHEN d.icode <> '' AND d.icode = n.icode THEN 'Y' ELSE 'N' END) AS price_check,
            d.icd9cm,
            (CASE WHEN d.icd9cm = m.code THEN 'Y' ELSE 'N' END) AS icd9cm_check,
            d.export_eclaim_icd10tm,
            (CASE WHEN d.export_eclaim_icd10tm = 'Y' THEN 'Y' ELSE 'N' END) AS export_proced_check
            FROM dttm d
            LEFT OUTER JOIN nondrugitems n ON n.icode = d.icode
            LEFT OUTER JOIN icd9cm1 m ON m.code = d.icd9cm
            WHERE d.active_status = 'Y'
            ORDER BY d.name
        `;
        let rows;
        if (type === 'postgresql') {
            const client = new PgClient({ host, port: parseInt(port), database, user, password, connectionTimeoutMillis: 15000 });
            await client.connect();
            const result = await client.query(buildQuery());
            await client.end();
            rows = result.rows;
        } else {
            const connection = await mysql.createConnection({ host, port, user, password, database, connectTimeout: 15000 });
            const [r] = await connection.execute(buildQuery());
            await connection.end();
            rows = r;
        }
        const normalized = rows.map(r => { const o={}; Object.keys(r).forEach(k=>{ o[k.toLowerCase()]=r[k]; }); return o; });
        res.json({ success: true, data: normalized, count: normalized.length });
    } catch (error) {
        console.error('FDH dttm error:', error);
        res.json({ success: false, error: error.message });
    }
});

app.post('/api/get-fdh-doctor-tha', async (req, res) => {
    try {
        const { host, port, database, user, password, type } = req.body;
        const buildQuery = () => `
            SELECT h.health_med_doctor_id, h.health_med_doctor_name, h.license_number,
            (CASE WHEN d.licenseno <> '' THEN 'Y' ELSE 'N' END) AS licenseno_check,
            hh.health_med_curriculum_name,
            l.health_med_license_type_name,
            (CASE WHEN h.doctor_code <> '' THEN 'Y' ELSE 'N' END) AS doctor_check
            FROM health_med_doctor h
            LEFT OUTER JOIN doctor d ON d.code = h.doctor_code
            LEFT OUTER JOIN health_med_curriculum hh ON h.health_med_curriculum_id = hh.health_med_curriculum_id
            LEFT OUTER JOIN health_med_license_type l ON l.health_med_license_type_id = h.health_med_license_type_id
            WHERE d.provider_type_code IN ('081','082','084','085')
            AND h.active_status = 'Y'
        `;
        let rows;
        if (type === 'postgresql') {
            const client = new PgClient({ host, port: parseInt(port), database, user, password, connectionTimeoutMillis: 15000 });
            await client.connect();
            const result = await client.query(buildQuery());
            await client.end();
            rows = result.rows;
        } else {
            const connection = await mysql.createConnection({ host, port, user, password, database, connectTimeout: 15000 });
            const [r] = await connection.execute(buildQuery());
            await connection.end();
            rows = r;
        }
        const normalized = rows.map(r => { const o={}; Object.keys(r).forEach(k=>{ o[k.toLowerCase()]=r[k]; }); return o; });
        res.json({ success: true, data: normalized, count: normalized.length });
    } catch (error) {
        console.error('FDH doctor_tha error:', error);
        res.json({ success: false, error: error.message });
    }
});

app.post('/api/get-fdh-pttype', async (req, res) => {
    try {
        const { host, port, database, user, password, type } = req.body;
        const buildQuery = () => `
            SELECT p.pttype, p.name, p.pcode, p.hipdata_code,
            p.nhso_code, p.grouper_version,
            (CASE WHEN p.grouper_version = '6' THEN 'Y' ELSE 'N' END) AS drg_group_check,
            p.print_presc_ned,
            (CASE WHEN p.print_presc_ned = 'Y' THEN 'Y' ELSE 'N' END) AS print_presc_ned_check,
            p.export_eclaim,
            (CASE WHEN p.export_eclaim = 'Y' THEN 'Y' ELSE 'N' END) AS export_eclaim_check,
            p.default_request_funds,
            (CASE WHEN p.default_request_funds = 'Y' THEN 'Y' ELSE 'N' END) AS default_request_funds_check,
            p.finance_round_money,
            (CASE WHEN p.finance_round_money = 'Y' THEN 'N' ELSE 'Y' END) AS finance_round_money_check,
            p.inc_round_money,
            (CASE WHEN p.inc_round_money = 'Y' THEN 'N' ELSE 'Y' END) AS inc_round_money_check,
            p.round_money,
            (CASE WHEN p.round_money = 'Y' THEN 'N' ELSE 'Y' END) AS round_money_check
            FROM pttype p
            WHERE p.isuse = 'Y' AND p.hipdata_code IN ('UCS','WEL') AND p.paidst = '02'
            ORDER BY p.pttype
        `;
        let rows;
        if (type === 'postgresql') {
            const client = new PgClient({ host, port: parseInt(port), database, user, password, connectionTimeoutMillis: 10000 });
            await client.connect();
            const result = await client.query(buildQuery());
            await client.end();
            rows = result.rows;
        } else {
            const connection = await mysql.createConnection({ host, port, user, password, database, connectTimeout: 10000 });
            const [r] = await connection.execute(buildQuery());
            await connection.end();
            rows = r;
        }
        const normalized = rows.map(r => { const o={}; Object.keys(r).forEach(k=>{ o[k.toLowerCase()]=r[k]; }); return o; });
        res.json({ success: true, data: normalized, count: normalized.length });
    } catch (error) {
        console.error('FDH pttype error:', error);
        res.json({ success: false, error: error.message });
    }
});

app.post('/api/get-fdh-provis-instype', async (req, res) => {
    try {
        const { host, port, database, user, password, type } = req.body;
        const buildQuery = (pg) => `
            SELECT nhso_code, name,
            'เพิ่มข้อมูลสิทธิในตาราง provis_instype' AS note
            FROM pttype
            WHERE nhso_code NOT IN (SELECT code FROM provis_instype)
            ORDER BY nhso_code
        `;
        let rows;
        if (type === 'postgresql') {
            const client = new PgClient({ host, port: parseInt(port), database, user, password, connectionTimeoutMillis: 10000 });
            await client.connect();
            const result = await client.query(buildQuery(true));
            await client.end();
            rows = result.rows;
        } else {
            const connection = await mysql.createConnection({ host, port, user, password, database, connectTimeout: 10000 });
            const [r] = await connection.execute(buildQuery(false));
            await connection.end();
            rows = r;
        }
        const normalized = rows.map(r => { const o={}; Object.keys(r).forEach(k=>{ o[k.toLowerCase()]=r[k]; }); return o; });
        res.json({ success: true, data: normalized, count: normalized.length });
    } catch (error) {
        console.error('FDH provis_instype error:', error);
        res.json({ success: false, error: error.message });
    }
});

app.post('/api/get-fdh-drug', async (req, res) => {
    try {
        const { host, port, database, user, password, type } = req.body;
        const buildQuery = () => `
            SELECT d.icode, d.name AS drugname, d.strength, d.units, d.unitprice,
            d.dosageform, d.generic_name, d.trade_name, i1.name AS income_name,
            d.sks_price,
            (CASE WHEN d.sks_price IS NULL THEN 'N' ELSE 'Y' END) AS sks_price_check,
            s1.sks_product_category_name,
            (CASE WHEN (s1.sks_product_category_name IS NULL OR s1.sks_product_category_name = '') THEN 'N' ELSE 'Y' END) AS sks_product_category_name_check,
            s2.sks_claim_control_type_name,
            (CASE WHEN (s2.sks_claim_control_type_name IS NULL OR s2.sks_claim_control_type_name = '') THEN 'N' ELSE 'Y' END) AS sks_claim_control_type_name_check,
            d.sks_drug_code,
            (CASE WHEN (d.sks_drug_code IS NULL OR d.sks_drug_code = '') THEN 'N' ELSE 'Y' END) AS sks_drug_code_check,
            d.csmbs_claim_cat,
            a.nhso_adp_type_name,
            d.nhso_adp_code,
            d.ttmt_code
            FROM drugitems d
            LEFT OUTER JOIN sks_product_category s1 ON s1.sks_product_category_id = d.sks_product_category_id
            LEFT OUTER JOIN sks_claim_control_type s2 ON s2.sks_claim_control_type_id = d.sks_clain_control_type_id
            LEFT OUTER JOIN sks_drug_code s3 ON s3.sks_drug_code = d.sks_drug_code
            LEFT JOIN nhso_adp_type a ON a.nhso_adp_type_id = d.nhso_adp_type_id
            LEFT OUTER JOIN income i1 ON i1.income = d.income
            WHERE d.istatus = 'Y'
            ORDER BY d.name, d.strength, d.units
        `;
        let rows;
        if (type === 'postgresql') {
            const client = new PgClient({ host, port: parseInt(port), database, user, password, connectionTimeoutMillis: 20000 });
            await client.connect();
            const result = await client.query(buildQuery());
            await client.end();
            rows = result.rows;
        } else {
            const connection = await mysql.createConnection({ host, port, user, password, database, connectTimeout: 20000 });
            const [r] = await connection.execute(buildQuery());
            await connection.end();
            rows = r;
        }
        const normalized = rows.map(r => { const o={}; Object.keys(r).forEach(k=>{ o[k.toLowerCase()]=r[k]; }); return o; });
        res.json({ success: true, data: normalized, count: normalized.length });
    } catch (error) {
        console.error('FDH drug error:', error);
        res.json({ success: false, error: error.message });
    }
});

// drugcat — ข้อมูลหมวดหมู่ยา
app.post('/api/get-fdh-drugcat', async (req, res) => {
    try {
        const { host, port, database, user, password, type } = req.body;
        const buildQuery = () => `SELECT * FROM drugcat ORDER BY drugcat_id`;
        let rows;
        if (type === 'postgresql') {
            const client = new PgClient({ host, port: parseInt(port), database, user, password, connectionTimeoutMillis: 10000 });
            await client.connect();
            const result = await client.query(buildQuery());
            await client.end();
            rows = result.rows;
        } else {
            const connection = await mysql.createConnection({ host, port, user, password, database, connectTimeout: 10000 });
            const [r] = await connection.execute(buildQuery());
            await connection.end();
            rows = r;
        }
        const normalized = rows.map(r => { const o={}; Object.keys(r).forEach(k=>{ o[k.toLowerCase()]=r[k]; }); return o; });
        res.json({ success: true, data: normalized, count: normalized.length });
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

// labcat — ข้อมูลหมวดหมู่ Lab
app.post('/api/get-fdh-labcat', async (req, res) => {
    try {
        const { host, port, database, user, password, type } = req.body;
        const buildQuery = () => `SELECT * FROM lab_catalog ORDER BY lab_catalog_lc_code`;
        let rows;
        if (type === 'postgresql') {
            const client = new PgClient({ host, port: parseInt(port), database, user, password, connectionTimeoutMillis: 10000 });
            await client.connect();
            const result = await client.query(buildQuery());
            await client.end();
            rows = result.rows;
        } else {
            const connection = await mysql.createConnection({ host, port, user, password, database, connectTimeout: 10000 });
            const [r] = await connection.execute(buildQuery());
            await connection.end();
            rows = r;
        }
        const normalized = rows.map(r => { const o={}; Object.keys(r).forEach(k=>{ o[k.toLowerCase()]=r[k]; }); return o; });
        res.json({ success: true, data: normalized, count: normalized.length });
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});


app.post('/api/get-fdh-accident-type', async (req, res) => {
    runBasicQuery(req, res, () => `SELECT * FROM ipt_accident_type`, 'FDH accident_type');
});

app.post('/api/get-fdh-accident-case', async (req, res) => {
    runBasicQuery(req, res, () => `SELECT * FROM ipt_accident_ae_type`, 'FDH accident_case');
});

app.post('/api/get-fdh-emergency-ind', async (req, res) => {
    runBasicQuery(req, res, () => `SELECT * FROM ipt_accident_emtype`, 'FDH emergency_ind');
});

// ==================== FDH Generic Update Field ====================
app.post('/api/fdh-update-field', async (req, res) => {
    try {
        const { host, port, database, user, password, type, table, pkField, pkValue, field, value } = req.body;

        // Whitelist: table → { pkField, editableFields[] }
        const WHITELIST = {
            pname:       { pkField: 'name',                        editableFields: ['sex', 'provis_code'] },
            nationality: { pkField: 'nationality',                  editableFields: ['name', 'nhso_code'] },
            marrystatus: { pkField: 'code',                        editableFields: ['name', 'nhso_marriage_code'] },
            sex:         { pkField: 'code',                        editableFields: ['name'] },
            occupation:  { pkField: 'occupation',                  editableFields: ['name', 'nhso_code'] },
            spclty:      { pkField: 'spclty',                      editableFields: ['name', 'provis_code', 'nhso_code'] },
            dchtype:     { pkField: 'dchtype',                     editableFields: ['name', 'nhso_dchtype'] },
            dchstts:     { pkField: 'dchstts',                     editableFields: ['name', 'nhso_dchstts'] },
            diagtype:    { pkField: 'diagtype',                    editableFields: ['name', 'nhso_code'] },
            er_oper_code:{ pkField: 'er_oper_code',                editableFields: ['name', 'icd9cm', 'export_proced'] },
            nondrugitems:{ pkField: 'icode',                       editableFields: ['name', 'unit', 'price', 'billcode', 'income', 'income_phdb_code', 'nhso_adp_type_id', 'nhso_adp_code', 'sks_coverage_price', 'enable_sks_opd'] },
            physic_items:{ pkField: 'physic_items_id',             editableFields: ['name', 'price', 'icd9', 'f43_rehab_code', 'icd9_ipd_active_status'] },
            operation_item:{ pkField: 'operation_item_id',         editableFields: ['name', 'icd9'] },
            health_med_operation_item:{ pkField: 'health_med_operation_item_id', editableFields: ['health_med_operation_item_name', 'price', 'icd10tm'] },
            dttm:        { pkField: 'code',                        editableFields: ['name', 'opd_price1', 'icd9cm', 'export_eclaim_icd10tm'] },
            pttype:      { pkField: 'pttype',                      editableFields: ['name', 'pcode', 'hipdata_code', 'nhso_code', 'grouper_version', 'print_presc_ned', 'export_eclaim', 'default_request_funds', 'finance_round_money', 'inc_round_money', 'round_money'] },
            ipt_accident_type:   { pkField: 'accident_type_id',    editableFields: ['accident_type_name'] },
            ipt_accident_ae_type:{ pkField: 'accident_ae_type_id', editableFields: ['accident_ae_type_name'] },
            ipt_accident_emtype: { pkField: 'accident_emtype_id',  editableFields: ['accident_emtype_name'] },
            ipt_oper_code:       { pkField: 'ipt_oper_code',        editableFields: ['name', 'icd9cm'] },
            health_med_doctor:   { pkField: 'health_med_doctor_id', editableFields: ['health_med_doctor_name', 'license_number', 'doctor_code'] },
            drugitems:           { pkField: 'icode',                editableFields: ['sks_price', 'sks_drug_code', 'sks_product_category_id', 'sks_clain_control_type_id'] },
            drugcat:             { pkField: 'drugcat_id',           editableFields: ['drugcat_name', 'drug_usage_type_id'] },
            lab_catalog:         { pkField: 'lab_catalog_lc_code',  editableFields: ['lab_catalog_lc_name', 'lab_catalog_group_code'] },
            religion:            { pkField: 'religion',              editableFields: ['name', 'nhso_code'] },
        };

        if (!table || !pkField || pkValue === undefined || !field) {
            return res.json({ success: false, error: 'ข้อมูลไม่ครบถ้วน' });
        }

        const allowed = WHITELIST[table];
        if (!allowed) return res.json({ success: false, error: `ไม่อนุญาตตาราง: ${table}` });
        if (allowed.pkField !== pkField) return res.json({ success: false, error: `pkField ไม่ถูกต้อง` });
        if (!allowed.editableFields.includes(field)) return res.json({ success: false, error: `ฟิลด์ไม่ได้รับอนุญาต: ${field}` });

        const trimmedValue = (value === null || value === undefined) ? null : String(value).trim();

        if (type === 'postgresql') {
            const client = new PgClient({ host, port: parseInt(port), database, user, password, connectionTimeoutMillis: 10000 });
            await client.connect();
            await client.query(`UPDATE "${table}" SET "${field}" = $1 WHERE "${pkField}" = $2`, [trimmedValue, pkValue]);
            await client.end();
        } else {
            const connection = await mysql.createConnection({ host, port, user, password, database, connectTimeout: 10000 });
            await connection.execute(`UPDATE \`${table}\` SET \`${field}\` = ? WHERE \`${pkField}\` = ?`, [trimmedValue, pkValue]);
            await connection.end();
        }
        res.json({ success: true });
    } catch (error) {
        console.error('fdh-update-field error:', error);
        res.json({ success: false, error: error.message });
    }
});

// นำเข้า code จาก ovst_sks_icd10tm → sks_icd10tm_check
app.post('/api/import-icd10tm-tt', async (req, res) => {
    try {
        const { host, port, database, user, password, type } = req.body;
        const isPg = type === 'postgresql';
        const buildInsert = () => isPg
            ? `INSERT INTO sks_icd10tm_check (code)
               SELECT os.code FROM ovst_sks_icd10tm os
               WHERE NOT EXISTS (SELECT 1 FROM sks_icd10tm_check sc WHERE sc.code = os.code)
               ON CONFLICT (code) DO NOTHING`
            : `INSERT IGNORE INTO \`sks_icd10tm_check\` (code)
               SELECT os.code FROM ovst_sks_icd10tm os
               WHERE os.code NOT IN (SELECT code FROM sks_icd10tm_check)`;

        let inserted = 0;
        if (isPg) {
            const client = new PgClient({ host, port: parseInt(port), database, user, password, connectionTimeoutMillis: 15000 });
            await client.connect();
            // ensure table exists
            await client.query(`CREATE TABLE IF NOT EXISTS sks_icd10tm_check (code VARCHAR(10) NOT NULL, CONSTRAINT pk_sks_icd10tm_check PRIMARY KEY (code))`);
            const result = await client.query(buildInsert());
            inserted = result.rowCount || 0;
            await client.end();
        } else {
            const connection = await mysql.createConnection({ host, port, user, password, database, connectTimeout: 15000 });
            await connection.execute(`CREATE TABLE IF NOT EXISTS \`sks_icd10tm_check\` (\`code\` VARCHAR(10) NOT NULL, PRIMARY KEY (\`code\`)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
            const [result] = await connection.execute(buildInsert());
            inserted = result.affectedRows || 0;
            await connection.end();
        }
        res.json({ success: true, inserted });
    } catch (error) {
        console.error('import-icd10tm-tt error:', error);
        res.json({ success: false, error: error.message });
    }
});

// นำเข้า codes array → sks_icd10tm_check
app.post('/api/import-icd10tm-codes', async (req, res) => {
    try {
        const { host, port, database, user, password, type, codes } = req.body;
        if (!codes || !codes.length) return res.json({ success: false, error: 'ไม่มีข้อมูล code' });

        const isPg = type === 'postgresql';
        let inserted = 0, skipped = 0;

        if (isPg) {
            const client = new PgClient({ host, port: parseInt(port), database, user, password, connectionTimeoutMillis: 15000 });
            await client.connect();
            await client.query(`CREATE TABLE IF NOT EXISTS sks_icd10tm_check (code VARCHAR(10) NOT NULL, CONSTRAINT pk_sks_icd10tm_check PRIMARY KEY (code))`);
            for (const code of codes) {
                try {
                    await client.query(`INSERT INTO sks_icd10tm_check (code) VALUES ($1) ON CONFLICT (code) DO NOTHING`, [code]);
                    inserted++;
                } catch(e) { skipped++; }
            }
            await client.end();
        } else {
            const connection = await mysql.createConnection({ host, port, user, password, database, connectTimeout: 15000 });
            await connection.execute(`CREATE TABLE IF NOT EXISTS \`sks_icd10tm_check\` (\`code\` VARCHAR(10) NOT NULL, PRIMARY KEY (\`code\`)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
            for (const code of codes) {
                try {
                    const [r] = await connection.execute(`INSERT IGNORE INTO \`sks_icd10tm_check\` (code) VALUES (?)`, [code]);
                    if (r.affectedRows > 0) inserted++; else skipped++;
                } catch(e) { skipped++; }
            }
            await connection.end();
        }
        res.json({ success: true, inserted, skipped });
    } catch (error) {
        console.error('import-icd10tm-codes error:', error);
        res.json({ success: false, error: error.message });
    }
});

// ==================== ตรวจสอบและสร้างตารางที่จำเป็น ====================

// ตรวจสอบสถานะตารางที่จำเป็นทั้งหมด
app.post('/api/check-required-tables', async (req, res) => {
    try {
        const { host, port, database, user, password, type } = req.body;
        const isPg = type === 'postgresql';

        const checkTable = async (conn, tbl) => {
            if (isPg) {
                const r = await conn.query(`SELECT COUNT(*) AS cnt FROM information_schema.tables WHERE table_schema='public' AND table_name=$1`, [tbl]);
                return parseInt(r.rows[0].cnt) > 0;
            } else {
                const [rows] = await conn.execute(`SELECT COUNT(*) AS cnt FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?`, [tbl]);
                return rows[0].cnt > 0;
            }
        };
        const checkCol = async (conn, tbl, col) => {
            if (isPg) {
                const r = await conn.query(`SELECT COUNT(*) AS cnt FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 AND column_name=$2`, [tbl, col]);
                return parseInt(r.rows[0].cnt) > 0;
            } else {
                const [rows] = await conn.execute(`SELECT COUNT(*) AS cnt FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?`, [tbl, col]);
                return rows[0].cnt > 0;
            }
        };

        let conn;
        if (isPg) {
            conn = new PgClient({ host, port: parseInt(port), database, user, password, connectionTimeoutMillis: 10000 });
            await conn.connect();
        } else {
            conn = await mysql.createConnection({ host, port, user, password, database, connectTimeout: 10000 });
        }

        const results = [
            { key: 'position_check',                    label: 'ตาราง position_check',                   exists: await checkTable(conn, 'position_check') },
            { key: 'lab_items_no_lab_catalog',           label: 'ฟิล lab_items.no_lab_catalog',           exists: await checkCol(conn, 'lab_items', 'no_lab_catalog') },
            { key: 'lab_items_sub_group_no_lab_catalog', label: 'ฟิล lab_items_sub_group.no_lab_catalog', exists: await checkCol(conn, 'lab_items_sub_group', 'no_lab_catalog') },
            { key: 'sks_icd10tm_check',                  label: 'ตาราง sks_icd10tm_check',                exists: await checkTable(conn, 'sks_icd10tm_check') },
            { key: 'drugitems_cancer',                   label: 'ตาราง drugitems_cancer',                 exists: await checkTable(conn, 'drugitems_cancer') },
            { key: 'drug_morphine',                      label: 'ตาราง drug_morphine',                    exists: await checkTable(conn, 'drug_morphine') }
        ];

        if (isPg) await conn.end(); else await conn.end();
        res.json({ success: true, data: results });
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

// สร้างตาราง/เพิ่มฟิลตาม key
app.post('/api/create-required-table', async (req, res) => {
    try {
        const { host, port, database, user, password, type, key } = req.body;
        const isPg = type === 'postgresql';
        let conn;
        if (isPg) {
            conn = new PgClient({ host, port: parseInt(port), database, user, password, connectionTimeoutMillis: 10000 });
            await conn.connect();
        } else {
            conn = await mysql.createConnection({ host, port, user, password, database, connectTimeout: 10000 });
        }

        if (key === 'position_check') {
            if (isPg) {
                await conn.query(`CREATE TABLE IF NOT EXISTS position_check (position_check_id SERIAL NOT NULL, position_id INTEGER NOT NULL, position_name VARCHAR(200) NOT NULL, CONSTRAINT pk_position_check PRIMARY KEY (position_check_id))`);
                await conn.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_position_check_id ON position_check USING BTREE (position_check_id)`);
            } else {
                await conn.execute(`CREATE TABLE IF NOT EXISTS \`position_check\` (\`position_check_id\` INT NOT NULL AUTO_INCREMENT, \`position_id\` INT NOT NULL, \`position_name\` VARCHAR(200) NOT NULL, PRIMARY KEY (\`position_check_id\`), UNIQUE INDEX \`idx_position_check_id\` (\`position_check_id\`) USING BTREE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
            }
        } else if (key === 'lab_items_no_lab_catalog') {
            if (isPg) await conn.query(`ALTER TABLE lab_items ADD COLUMN IF NOT EXISTS no_lab_catalog CHAR(1)`);
            else await conn.execute(`ALTER TABLE \`lab_items\` ADD COLUMN \`no_lab_catalog\` CHAR(1) NULL`).catch(()=>{});
        } else if (key === 'lab_items_sub_group_no_lab_catalog') {
            if (isPg) await conn.query(`ALTER TABLE lab_items_sub_group ADD COLUMN IF NOT EXISTS no_lab_catalog CHAR(1)`);
            else await conn.execute(`ALTER TABLE \`lab_items_sub_group\` ADD COLUMN \`no_lab_catalog\` CHAR(1) NULL`).catch(()=>{});
        } else if (key === 'sks_icd10tm_check') {
            if (isPg) {
                await conn.query(`CREATE TABLE IF NOT EXISTS sks_icd10tm_check (code VARCHAR(10) NOT NULL, CONSTRAINT pk_sks_icd10tm_check PRIMARY KEY (code))`);
                await conn.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_sks_icd10tm_check_code ON sks_icd10tm_check USING BTREE (code)`);
            } else {
                await conn.execute(`CREATE TABLE IF NOT EXISTS \`sks_icd10tm_check\` (\`code\` VARCHAR(10) NOT NULL, PRIMARY KEY (\`code\`), UNIQUE INDEX \`idx_sks_icd10tm_check_code\` (\`code\`) USING BTREE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
            }
        } else if (key === 'drugitems_cancer') {
            if (isPg) {
                await conn.query(`CREATE TABLE IF NOT EXISTS drugitems_cancer (icode VARCHAR(7) NOT NULL, name VARCHAR(250), strength VARCHAR(50), units VARCHAR(50), CONSTRAINT pk_drugitems_cancer PRIMARY KEY (icode))`);
                await conn.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_drugitems_cancer_icode ON drugitems_cancer USING BTREE (icode)`);
            } else {
                await conn.execute(`CREATE TABLE IF NOT EXISTS \`drugitems_cancer\` (\`icode\` VARCHAR(7) NOT NULL, \`name\` VARCHAR(250), \`strength\` VARCHAR(50), \`units\` VARCHAR(50), PRIMARY KEY (\`icode\`), UNIQUE INDEX \`idx_drugitems_cancer_icode\` (\`icode\`) USING BTREE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
            }
        } else if (key === 'drug_morphine') {
            if (isPg) {
                await conn.query(`CREATE TABLE IF NOT EXISTS drug_morphine (drug_morphine_id SERIAL NOT NULL, icode VARCHAR(7), name VARCHAR(100), strength VARCHAR(50), units VARCHAR(50), CONSTRAINT pk_drug_morphine PRIMARY KEY (drug_morphine_id))`);
                await conn.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_drug_morphine_id ON drug_morphine USING BTREE (drug_morphine_id)`);
            } else {
                await conn.execute(`CREATE TABLE IF NOT EXISTS \`drug_morphine\` (\`drug_morphine_id\` INT NOT NULL AUTO_INCREMENT, \`icode\` VARCHAR(7), \`name\` VARCHAR(100), \`strength\` VARCHAR(50), \`units\` VARCHAR(50), PRIMARY KEY (\`drug_morphine_id\`), UNIQUE INDEX \`idx_drug_morphine_id\` (\`drug_morphine_id\`) USING BTREE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
            }
        } else {
            if (isPg) await conn.end(); else await conn.end();
            return res.json({ success: false, error: 'key ไม่ถูกต้อง' });
        }

        if (isPg) await conn.end(); else await conn.end();
        res.json({ success: true });
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

// ==================== sks_icd10tm_check table ====================
app.post('/api/create-sks-icd10tm-check-table', async (req, res) => {
    try {
        const { host, port, database, user, password, type } = req.body;
        if (type === 'postgresql') {
            const client = new PgClient({ host, port: parseInt(port), database, user, password, connectionTimeoutMillis: 10000 });
            await client.connect();
            await client.query(`CREATE TABLE IF NOT EXISTS sks_icd10tm_check (code VARCHAR(10) NOT NULL, CONSTRAINT pk_sks_icd10tm_check PRIMARY KEY (code))`);
            await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_sks_icd10tm_check_code ON sks_icd10tm_check USING BTREE (code)`);
            await client.end();
        } else {
            const connection = await mysql.createConnection({ host, port, user, password, database, connectTimeout: 10000 });
            await connection.execute(`CREATE TABLE IF NOT EXISTS \`sks_icd10tm_check\` (\`code\` VARCHAR(10) NOT NULL, PRIMARY KEY (\`code\`), UNIQUE INDEX \`idx_sks_icd10tm_check_code\` (\`code\`) USING BTREE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
            await connection.end();
        }
        res.json({ success: true, message: 'สร้างตาราง sks_icd10tm_check สำเร็จ' });
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

// ==================== นำเข้ายามะเร็ง → drugitems_cancer ====================
app.post('/api/import-drugitems-cancer', async (req, res) => {
    try {
        const { host, port, database, user, password, type, rows } = req.body;
        if (!rows || !rows.length) return res.json({ success: false, error: 'ไม่มีข้อมูล' });
        const isPg = type === 'postgresql';
        let inserted = 0, updated = 0;
        if (isPg) {
            const client = new PgClient({ host, port: parseInt(port), database, user, password, connectionTimeoutMillis: 15000 });
            await client.connect();
            await client.query(`CREATE TABLE IF NOT EXISTS drugitems_cancer (icode VARCHAR(7) NOT NULL, name VARCHAR(250), strength VARCHAR(50), units VARCHAR(50), CONSTRAINT pk_drugitems_cancer PRIMARY KEY (icode))`);
            for (const row of rows) {
                const r = await client.query(
                    `INSERT INTO drugitems_cancer (icode, name, strength, units) VALUES ($1,$2,$3,$4) ON CONFLICT (icode) DO UPDATE SET name=EXCLUDED.name, strength=EXCLUDED.strength, units=EXCLUDED.units RETURNING (xmax=0) AS is_insert`,
                    [row.icode, row.name || null, row.strength || null, row.units || null]
                );
                if (r.rows[0]?.is_insert) inserted++; else updated++;
            }
            await client.end();
        } else {
            const connection = await mysql.createConnection({ host, port, user, password, database, connectTimeout: 15000 });
            await connection.execute(`CREATE TABLE IF NOT EXISTS \`drugitems_cancer\` (\`icode\` VARCHAR(7) NOT NULL, \`name\` VARCHAR(250), \`strength\` VARCHAR(50), \`units\` VARCHAR(50), PRIMARY KEY (\`icode\`)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
            for (const row of rows) {
                const [r] = await connection.execute(
                    `INSERT INTO \`drugitems_cancer\` (icode, name, strength, units) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE name=VALUES(name), strength=VALUES(strength), units=VALUES(units)`,
                    [row.icode, row.name || null, row.strength || null, row.units || null]
                );
                if (r.affectedRows === 1) inserted++;
                else if (r.affectedRows === 2) updated++;
            }
            await connection.end();
        }
        res.json({ success: true, inserted, updated });
    } catch (error) {
        console.error('import-drugitems-cancer error:', error);
        res.json({ success: false, error: error.message });
    }
});

// ==================== C566 Preview: ข้อมูลที่จะ insert Z510/Z511 ====================
app.post('/api/get-c566-z-preview', async (req, res) => {
    try {
        const { host, port, database, user, password, type, dateFrom, dateTo } = req.body;
        const isPg = type === 'postgresql';
        // PostgreSQL: $1/$2 ใช้ซ้ำได้ ส่งแค่ 2 params
        // MySQL: ? ต้องส่ง 4 params
        const buildQueryPg = () => `
            SELECT o.vn,
                (CASE WHEN dot.icd9='9224' OR od2.icd10='9224' THEN 'Z510'
                      WHEN dot.icd9='9925' OR od2.icd10='9925' THEN 'Z511' ELSE '' END) AS icd10_add,
                dot.icd9, od2.icd10 AS icd9_from_ovstdiag, e.name AS er_oper_name, o.hn, o.vsttime, o.vstdate,
                '4' AS diagtype, od1.doctor AS doctor_code, d.name AS doctor
            FROM ovst o
            LEFT OUTER JOIN ovstdiag od1 ON o.vn = od1.vn AND od1.diagtype = '1'
            LEFT OUTER JOIN icd101 icd ON od1.icd10 = icd.code
            LEFT OUTER JOIN doctor_operation dot ON dot.vn = o.vn AND dot.icd9 IN ('9925','9224')
            LEFT OUTER JOIN ovstdiag od2 ON od2.vn = o.vn AND od2.icd10 IN ('9925','9224')
            LEFT OUTER JOIN er_oper_code e ON e.er_oper_code = dot.er_oper_code
            LEFT OUTER JOIN doctor d ON d.code = od1.doctor
            LEFT OUTER JOIN pttype p ON p.pttype = o.pttype
            WHERE o.vstdate BETWEEN $1 AND $2
                AND UPPER(od1.icd10) LIKE 'C%'
                AND p.hipdata_code = 'UCS'
                AND od1.vn NOT IN (
                    SELECT vn FROM ovstdiag
                    WHERE icd10 IN ('Z510','Z511')
                    AND vstdate BETWEEN $1 AND $2
                )
                AND (dot.icd9 IS NOT NULL OR od2.icd10 IS NOT NULL)
            ORDER BY o.vstdate, o.vn
        `;
        const buildQueryMy = () => `
            SELECT o.vn,
                (CASE WHEN dot.icd9='9224' OR od2.icd10='9224' THEN 'Z510'
                      WHEN dot.icd9='9925' OR od2.icd10='9925' THEN 'Z511' ELSE '' END) AS icd10_add,
                dot.icd9, od2.icd10 AS icd9_from_ovstdiag, e.name AS er_oper_name, o.hn, o.vsttime, o.vstdate,
                '4' AS diagtype, od1.doctor AS doctor_code, d.name AS doctor
            FROM ovst o
            LEFT OUTER JOIN ovstdiag od1 ON o.vn = od1.vn AND od1.diagtype = '1'
            LEFT OUTER JOIN icd101 icd ON od1.icd10 = icd.code
            LEFT OUTER JOIN doctor_operation dot ON dot.vn = o.vn AND dot.icd9 IN ('9925','9224')
            LEFT OUTER JOIN ovstdiag od2 ON od2.vn = o.vn AND od2.icd10 IN ('9925','9224')
            LEFT OUTER JOIN er_oper_code e ON e.er_oper_code = dot.er_oper_code
            LEFT OUTER JOIN doctor d ON d.code = od1.doctor
            LEFT OUTER JOIN pttype p ON p.pttype = o.pttype
            WHERE o.vstdate BETWEEN ? AND ?
                AND UPPER(od1.icd10) LIKE 'C%'
                AND p.hipdata_code = 'UCS'
                AND od1.vn NOT IN (
                    SELECT vn FROM ovstdiag
                    WHERE icd10 IN ('Z510','Z511')
                    AND vstdate BETWEEN ? AND ?
                )
                AND (dot.icd9 IS NOT NULL OR od2.icd10 IS NOT NULL)
            ORDER BY o.vstdate, o.vn
        `;
        let rows;
        if (isPg) {
            const client = new PgClient({ host, port: parseInt(port), database, user, password, connectionTimeoutMillis: 30000 });
            await client.connect();
            const result = await client.query(buildQueryPg(), [dateFrom, dateTo]);  // $1/$2 reused → 2 params
            await client.end();
            rows = result.rows;
        } else {
            const connection = await mysql.createConnection({ host, port, user, password, database, connectTimeout: 30000 });
            const [r] = await connection.execute(buildQueryMy(), [dateFrom, dateTo, dateFrom, dateTo]);  // 4 ? → 4 params
            await connection.end();
            rows = r;
        }
        // แปลง Date object เป็น local date string YYYY-MM-DD
        const normVal = v => {
            if (v instanceof Date) {
                const y = v.getFullYear();
                const m = String(v.getMonth()+1).padStart(2,'0');
                const d = String(v.getDate()).padStart(2,'0');
                return `${y}-${m}-${d}`;
            }
            return v;
        };
        const normalized = rows.map(r => { const o={}; Object.keys(r).forEach(k=>{ o[k]=normVal(r[k]); }); return o; });
        res.json({ success: true, data: normalized, count: normalized.length });
    } catch (error) {
        console.error('C566 preview error:', error);
        res.json({ success: false, error: error.message });
    }
});

// ==================== C566 Insert: นำเข้า Z510/Z511 (ฟิลครบ) ====================
app.post('/api/insert-c566-z-diag', async (req, res) => {
    try {
        const { host, port, database, user, password, type, records, loginName } = req.body;
        if (!records || !records.length) return res.json({ success: false, error: 'ไม่มีข้อมูลที่เลือก' });

        let staffName = loginName || '';

        // normalize vstdate → YYYY-MM-DD เท่านั้น
        const fmtDate = v => {
            if (!v) return null;
            const s = String(v);
            if (s.includes('T')) return s.split('T')[0];
            if (s.includes(' ')) return s.split(' ')[0];
            return s.slice(0, 10);
        };

        // ฟังก์ชันอัปเดต vn_stat — หาช่อง dx0-dx5 แรกที่ว่าง แล้วใส่ icd10
        const updateVnStat = async (conn, isPg, vn, icd10) => {
            try {
                const DX_FIELDS = ['dx0','dx1','dx2','dx3','dx4','dx5'];
                let row;
                if (isPg) {
                    const r = await conn.query(`SELECT dx0,dx1,dx2,dx3,dx4,dx5 FROM vn_stat WHERE vn=$1 LIMIT 1`, [vn]);
                    row = r.rows[0];
                } else {
                    const [rows] = await conn.execute(`SELECT dx0,dx1,dx2,dx3,dx4,dx5 FROM vn_stat WHERE vn=? LIMIT 1`, [vn]);
                    row = rows[0];
                }
                if (!row) return; // ไม่มี row ใน vn_stat ข้ามไป
                const target = DX_FIELDS.find(f => !row[f] || String(row[f]).trim() === '');
                if (!target) return; // ทุกช่องเต็มแล้ว
                if (isPg) {
                    await conn.query(`UPDATE vn_stat SET ${target}=$1 WHERE vn=$2`, [icd10, vn]);
                } else {
                    await conn.execute(`UPDATE vn_stat SET \`${target}\`=? WHERE vn=?`, [icd10, vn]);
                }
            } catch(e) { /* ไม่ต้อง fail หลัก */ }
        };

        let inserted = 0, failed = 0, errors = [];
        if (type === 'postgresql') {
            const client = new PgClient({ host, port: parseInt(port), database, user, password, connectionTimeoutMillis: 30000 });
            await client.connect();
            for (const rec of records) {
                try {
                    const serialResult = await client.query(`SELECT get_serialnumber('ovst_diag_id') AS sid`);
                    const sid = serialResult.rows[0]?.sid;
                    await client.query(
                        `INSERT INTO ovstdiag (ovst_diag_id, vn, icd10, hn, vsttime, vstdate, diagtype, doctor, hos_guid, staff, update_datetime)
                         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'app',$9,NOW())`,
                        [sid, rec.vn, rec.icd10_add, rec.hn, rec.vsttime, fmtDate(rec.vstdate), rec.diagtype || '4', rec.doctor_code, staffName]
                    );
                    // อัปเดต vn_stat
                    await updateVnStat(client, true, rec.vn, rec.icd10_add);
                    inserted++;
                } catch(e) { failed++; errors.push(`${rec.vn}: ${e.message}`); }
            }
            await client.end();
        } else {
            const connection = await mysql.createConnection({ host, port, user, password, database, connectTimeout: 30000 });
            for (const rec of records) {
                try {
                    await connection.execute(
                        `INSERT INTO ovstdiag (ovst_diag_id, vn, icd10, hn, vsttime, vstdate, diagtype, doctor, hos_guid, staff, update_datetime)
                         VALUES (get_serialnumber('ovst_diag_id'),?,?,?,?,?,?,?,'app',?,NOW())`,
                        [rec.vn, rec.icd10_add, rec.hn, rec.vsttime, fmtDate(rec.vstdate), rec.diagtype || '4', rec.doctor_code, staffName]
                    );
                    // อัปเดต vn_stat
                    await updateVnStat(connection, false, rec.vn, rec.icd10_add);
                    inserted++;
                } catch(e) { failed++; errors.push(`${rec.vn}: ${e.message}`); }
            }
            await connection.end();
        }
        res.json({ success: true, inserted, failed, errors });
    } catch (error) {
        console.error('C566 insert error:', error);
        res.json({ success: false, error: error.message });
    }
});

// ==================== C566: ผู้ป่วยมะเร็งที่ยังไม่มี Z510/Z511 ====================
app.post('/api/get-c566', async (req, res) => {
    try {
        const { host, port, database, user, password, type, dateFrom, dateTo } = req.body;
        const isPg = type === 'postgresql';
        const [ph1, ph2] = isPg ? ['$1', '$2'] : ['?', '?'];

        const aggFn = isPg
            ? `STRING_AGG(DISTINCT odd.diag_text, ', ')`
            : `GROUP_CONCAT(DISTINCT odd.diag_text SEPARATOR ', ')`;

        const buildQuery = () => `
            SELECT
                o.vstdate AS "วันที่รับบริการ",
                o.hn AS "HN",
                o.vn AS "VN",
                o.oqueue AS "คิวรับบริการ",
                p.cid,
                CONCAT(p.pname, p.fname, ' ', p.lname) AS "ชื่อ-นามสกุล",
                ptt.name AS "สิทธิการรักษา",
                vp.auth_code AS "authen_code",
                od1.icd10 AS "icd10 มะเร็ง",
                icd.name AS "ชื่อicd10 มะเร็ง",
                dot.icd9 AS "icd9",
                e.name AS "หัตถการ",
                (CASE WHEN dot.icd9='9224' THEN 'Z510' WHEN dot.icd9='9925' THEN 'Z511' ELSE '' END) AS "icd10 ที่ต้องลงเพิ่ม",
                d.name AS "แพทย์วินิจฉัย",
                ${aggFn} AS "diag_text"
            FROM ovst o
            LEFT OUTER JOIN patient p ON o.hn = p.hn
            LEFT OUTER JOIN pttype ptt ON o.pttype = ptt.pttype
            LEFT OUTER JOIN visit_pttype vp ON o.vn = vp.vn AND o.pttype = vp.pttype
            LEFT OUTER JOIN ovstdiag od1 ON o.vn = od1.vn AND od1.diagtype = '1'
            LEFT OUTER JOIN icd101 icd ON od1.icd10 = icd.code
            LEFT OUTER JOIN doctor_operation dot ON dot.vn = o.vn AND dot.icd9 IN ('9925','9224')
            LEFT OUTER JOIN er_oper_code e ON e.er_oper_code = dot.er_oper_code
            LEFT OUTER JOIN doctor d ON d.code = od1.doctor
            LEFT OUTER JOIN ovst_doctor_diag odd ON odd.vn = o.vn
            WHERE o.vstdate BETWEEN ${ph1} AND ${ph2}
                AND UPPER(od1.icd10) LIKE 'C%'
                AND ptt.hipdata_code = 'UCS'
                AND od1.vn NOT IN (
                    SELECT vn FROM ovstdiag
                    WHERE icd10 IN ('Z510','Z511')
                    AND vstdate BETWEEN ${ph1} AND ${ph2}
                )
            GROUP BY o.vn, o.vstdate, o.oqueue, o.hn, p.cid,
                CONCAT(p.pname, p.fname, ' ', p.lname),
                ptt.name, vp.auth_code, od1.icd10, icd.name,
                dot.icd9, e.name, d.name
            ORDER BY o.vstdate, o.oqueue
        `;

        let rows;
        if (isPg) {
            const client = new PgClient({ host, port: parseInt(port), database, user, password, connectionTimeoutMillis: 30000 });
            await client.connect();
            const result = await client.query(buildQuery(), [dateFrom, dateTo]);
            await client.end();
            rows = result.rows;
        } else {
            const connection = await mysql.createConnection({ host, port, user, password, database, connectTimeout: 30000 });
            const [r] = await connection.execute(buildQuery().replace(/\$1/g,'?').replace(/\$2/g,'?'), [dateFrom, dateTo, dateFrom, dateTo]);
            await connection.end();
            rows = r;
        }
        // แปลง Date object เป็น local date string YYYY-MM-DD
        const normVal = v => {
            if (v instanceof Date) {
                const y = v.getFullYear();
                const m = String(v.getMonth()+1).padStart(2,'0');
                const d = String(v.getDate()).padStart(2,'0');
                return `${y}-${m}-${d}`;
            }
            return v;
        };
        const normalized = rows.map(r => { const o={}; Object.keys(r).forEach(k=>{ o[k]=normVal(r[k]); }); return o; });
        res.json({ success: true, data: normalized, count: normalized.length });
    } catch (error) {
        console.error('C566 error:', error);
        res.json({ success: false, error: error.message });
    }
});

// FDH - ตัด walkin คู่ CANCER (visit เดียวกันมีทั้ง nhso_adp_code='WALKIN' และ 'CANCER')
app.post('/api/get-fdh-walkin-ca', async (req, res) => {
    try {
        const { host, port, database, user, password, type, dateFrom, dateTo } = req.body;
        const isPg = type === 'postgresql';
        const [ph1, ph2] = isPg ? ['$1', '$2'] : ['?', '?'];

        const buildQuery = () => `
            SELECT DISTINCT
                op.vstdate AS "วันที่รับบริการ",
                op.hn AS "HN",
                CONCAT(p.pname, p.fname, ' ', p.lname) AS "ชื่อ-นามสกุล",
                op.vn AS "VN"
            FROM opitemrece op
            INNER JOIN patient p ON p.hn = op.hn
            WHERE op.vstdate BETWEEN ${ph1} AND ${ph2}
                AND EXISTS (
                    SELECT 1
                    FROM opitemrece o2
                    JOIN nondrugitems n2 ON n2.icode = o2.icode
                    WHERE o2.vn = op.vn
                        AND o2.vstdate BETWEEN ${ph1} AND ${ph2}
                        AND n2.nhso_adp_code = 'WALKIN'
                )
                AND EXISTS (
                    SELECT 1
                    FROM opitemrece o3
                    JOIN nondrugitems n3 ON n3.icode = o3.icode
                    WHERE o3.vn = op.vn
                        AND o3.vstdate BETWEEN ${ph1} AND ${ph2}
                        AND n3.nhso_adp_code = 'CANCER'
                )
            ORDER BY op.vstdate, op.vn
        `;

        let rows;
        if (isPg) {
            const client = new PgClient({ host, port: parseInt(port), database, user, password, connectionTimeoutMillis: 30000 });
            await client.connect();
            const result = await client.query(buildQuery(), [dateFrom, dateTo]);
            await client.end();
            rows = result.rows;
        } else {
            const connection = await mysql.createConnection({ host, port, user, password, database, connectTimeout: 30000 });
            const [r] = await connection.execute(buildQuery().replace(/\$1/g,'?').replace(/\$2/g,'?'), [dateFrom, dateTo, dateFrom, dateTo, dateFrom, dateTo]);
            await connection.end();
            rows = r;
        }
        const normVal = v => {
            if (v instanceof Date) {
                const y = v.getFullYear();
                const m = String(v.getMonth()+1).padStart(2,'0');
                const d = String(v.getDate()).padStart(2,'0');
                return `${y}-${m}-${d}`;
            }
            return v;
        };
        const normalized = rows.map(r => { const o={}; Object.keys(r).forEach(k=>{ o[k]=normVal(r[k]); }); return o; });
        res.json({ success: true, data: normalized, count: normalized.length });
    } catch (error) {
        console.error('FDH walkin-ca error:', error);
        res.json({ success: false, error: error.message });
    }
});

// FDH - ลบรายการ WALKIN ออกจาก opitemrece สำหรับ VN ที่เลือก (ใช้กับเมนู ตัด walkin คู่ CA)
app.post('/api/delete-fdh-walkin-items', async (req, res) => {
    try {
        const { host, port, database, user, password, type, vns } = req.body;
        if (!vns || !vns.length) return res.json({ success: false, error: 'ไม่มีรายการที่เลือก' });

        let deleted = 0, failed = 0, errors = [];
        if (type === 'postgresql') {
            const client = new PgClient({ host, port: parseInt(port), database, user, password, connectionTimeoutMillis: 30000 });
            await client.connect();
            for (const vn of vns) {
                try {
                    await client.query(
                        `DELETE FROM opitemrece WHERE vn = $1 AND icode IN (SELECT icode FROM nondrugitems WHERE nhso_adp_code = 'WALKIN')`,
                        [vn]
                    );
                    deleted++;
                } catch(e) { failed++; errors.push(`${vn}: ${e.message}`); }
            }
            await client.end();
        } else {
            const connection = await mysql.createConnection({ host, port, user, password, database, connectTimeout: 30000 });
            for (const vn of vns) {
                try {
                    await connection.execute(
                        `DELETE FROM opitemrece WHERE vn = ? AND icode IN (SELECT icode FROM nondrugitems WHERE nhso_adp_code = 'WALKIN')`,
                        [vn]
                    );
                    deleted++;
                } catch(e) { failed++; errors.push(`${vn}: ${e.message}`); }
            }
            await connection.end();
        }
        res.json({ success: true, deleted, failed, errors });
    } catch (error) {
        console.error('FDH delete walkin items error:', error);
        res.json({ success: false, error: error.message });
    }
});

// FDH - ตัด Refer ที่มี WALKIN หรือ CANCER (visit มี nhso_adp_code='WALKIN' หรือ 'CANCER' และมีรายการใน referout หรือ referin)
app.post('/api/get-fdh-refer-walkin-ca', async (req, res) => {
    try {
        const { host, port, database, user, password, type, dateFrom, dateTo } = req.body;
        const isPg = type === 'postgresql';
        const [ph1, ph2] = isPg ? ['$1', '$2'] : ['?', '?'];

        const aggFn = isPg
            ? `(SELECT STRING_AGG(DISTINCT n.nhso_adp_code, ', ') FROM opitemrece o JOIN nondrugitems n ON n.icode = o.icode WHERE o.vn = op.vn AND n.nhso_adp_code IN ('WALKIN','CANCER'))`
            : `(SELECT GROUP_CONCAT(DISTINCT n.nhso_adp_code ORDER BY n.nhso_adp_code SEPARATOR ', ') FROM opitemrece o JOIN nondrugitems n ON n.icode = o.icode WHERE o.vn = op.vn AND n.nhso_adp_code IN ('WALKIN','CANCER'))`;

        const buildQuery = () => `
            SELECT DISTINCT
                op.vstdate AS "วันที่รับบริการ",
                op.hn AS "HN",
                CONCAT(p.pname, p.fname, ' ', p.lname) AS "ชื่อ-นามสกุล",
                op.vn AS "VN",
                ${aggFn} AS "nhso_adp_code",
                CASE WHEN EXISTS (SELECT 1 FROM referout ro WHERE ro.vn = op.vn) THEN 'มี' ELSE '-' END AS "referout",
                CASE WHEN EXISTS (SELECT 1 FROM referin ri WHERE ri.vn = op.vn)  THEN 'มี' ELSE '-' END AS "referin"
            FROM opitemrece op
            INNER JOIN patient p ON p.hn = op.hn
            WHERE op.vstdate BETWEEN ${ph1} AND ${ph2}
                AND (
                    EXISTS (
                        SELECT 1
                        FROM opitemrece o2
                        JOIN nondrugitems n2 ON n2.icode = o2.icode
                        WHERE o2.vn = op.vn
                            AND o2.vstdate BETWEEN ${ph1} AND ${ph2}
                            AND n2.nhso_adp_code = 'WALKIN'
                    )
                    OR EXISTS (
                        SELECT 1
                        FROM opitemrece o3
                        JOIN nondrugitems n3 ON n3.icode = o3.icode
                        WHERE o3.vn = op.vn
                            AND o3.vstdate BETWEEN ${ph1} AND ${ph2}
                            AND n3.nhso_adp_code = 'CANCER'
                    )
                )
                AND (
                    EXISTS (SELECT 1 FROM referout ro WHERE ro.vn = op.vn)
                    OR EXISTS  (SELECT 1 FROM referin  ri WHERE ri.vn = op.vn)
                )
            ORDER BY op.vstdate, op.vn
        `;

        let rows;
        if (isPg) {
            const client = new PgClient({ host, port: parseInt(port), database, user, password, connectionTimeoutMillis: 30000 });
            await client.connect();
            const result = await client.query(buildQuery(), [dateFrom, dateTo]);
            await client.end();
            rows = result.rows;
        } else {
            const connection = await mysql.createConnection({ host, port, user, password, database, connectTimeout: 30000 });
            const [r] = await connection.execute(buildQuery().replace(/\$1/g,'?').replace(/\$2/g,'?'), [dateFrom, dateTo, dateFrom, dateTo, dateFrom, dateTo]);
            await connection.end();
            rows = r;
        }
        const normVal = v => {
            if (v instanceof Date) {
                const y = v.getFullYear();
                const m = String(v.getMonth()+1).padStart(2,'0');
                const d = String(v.getDate()).padStart(2,'0');
                return `${y}-${m}-${d}`;
            }
            return v;
        };
        const normalized = rows.map(r => { const o={}; Object.keys(r).forEach(k=>{ o[k]=normVal(r[k]); }); return o; });
        res.json({ success: true, data: normalized, count: normalized.length });
    } catch (error) {
        console.error('FDH refer-walkin-ca error:', error);
        res.json({ success: false, error: error.message });
    }
});

// FDH - ลบรายการ referout สำหรับ VN ที่เลือก (ใช้กับเมนู ตัด Refer ที่มี WALKIN หรือ CANCER)
app.post('/api/delete-fdh-refer-items', async (req, res) => {
    try {
        const { host, port, database, user, password, type, vns } = req.body;
        if (!vns || !vns.length) return res.json({ success: false, error: 'ไม่มีรายการที่เลือก' });

        let deleted = 0, failed = 0, errors = [];
        if (type === 'postgresql') {
            const client = new PgClient({ host, port: parseInt(port), database, user, password, connectionTimeoutMillis: 30000 });
            await client.connect();
            for (const vn of vns) {
                try {
                    await client.query(`DELETE FROM referout WHERE vn = $1`, [vn]);
                    deleted++;
                } catch(e) { failed++; errors.push(`${vn}: ${e.message}`); }
            }
            await client.end();
        } else {
            const connection = await mysql.createConnection({ host, port, user, password, database, connectTimeout: 30000 });
            for (const vn of vns) {
                try {
                    await connection.execute(`DELETE FROM referout WHERE vn = ?`, [vn]);
                    deleted++;
                } catch(e) { failed++; errors.push(`${vn}: ${e.message}`); }
            }
            await connection.end();
        }
        res.json({ success: true, deleted, failed, errors });
    } catch (error) {
        console.error('FDH delete refer items error:', error);
        res.json({ success: false, error: error.message });
    }
});

// FDH - หา VN ที่มีทั้ง project code ADP30001 และมีรายการยาที่ icode อยู่ในตาราง drug_morphine (ใช้กับเมนู ตัด ADP30001 ที่รับยา Morphine)
app.post('/api/get-fdh-adp-morphine', async (req, res) => {
    try {
        const { host, port, database, user, password, type, dateFrom, dateTo } = req.body;
        const isPg = type === 'postgresql';
        const [ph1, ph2] = isPg ? ['$1', '$2'] : ['?', '?'];

        const buildQuery = () => `
            SELECT DISTINCT
                op.vstdate AS "วันที่รับบริการ",
                op.hn AS "HN",
                CONCAT(p.pname, p.fname, ' ', p.lname) AS "ชื่อ-นามสกุล",
                op.vn AS "VN"
            FROM opitemrece op
            INNER JOIN patient p ON p.hn = op.hn
            WHERE op.vstdate BETWEEN ${ph1} AND ${ph2}
                AND EXISTS (
                    SELECT 1
                    FROM opitemrece o2
                    JOIN nondrugitems n2 ON n2.icode = o2.icode
                    WHERE o2.vn = op.vn
                        AND o2.vstdate BETWEEN ${ph1} AND ${ph2}
                        AND n2.nhso_adp_code = 'ADP30001'
                )
                AND EXISTS (
                    SELECT 1
                    FROM opitemrece o3
                    JOIN drug_morphine dm ON dm.icode = o3.icode
                    WHERE o3.vn = op.vn
                        AND o3.vstdate BETWEEN ${ph1} AND ${ph2}
                )
            ORDER BY op.vstdate, op.vn
        `;

        let rows;
        if (isPg) {
            const client = new PgClient({ host, port: parseInt(port), database, user, password, connectionTimeoutMillis: 30000 });
            await client.connect();
            const result = await client.query(buildQuery(), [dateFrom, dateTo]);
            await client.end();
            rows = result.rows;
        } else {
            const connection = await mysql.createConnection({ host, port, user, password, database, connectTimeout: 30000 });
            const [r] = await connection.execute(buildQuery().replace(/\$1/g,'?').replace(/\$2/g,'?'), [dateFrom, dateTo, dateFrom, dateTo, dateFrom, dateTo]);
            await connection.end();
            rows = r;
        }
        const normVal = v => {
            if (v instanceof Date) {
                const y = v.getFullYear();
                const m = String(v.getMonth()+1).padStart(2,'0');
                const d = String(v.getDate()).padStart(2,'0');
                return `${y}-${m}-${d}`;
            }
            return v;
        };
        const normalized = rows.map(r => { const o={}; Object.keys(r).forEach(k=>{ o[k]=normVal(r[k]); }); return o; });
        res.json({ success: true, data: normalized, count: normalized.length });
    } catch (error) {
        console.error('FDH adp-morphine error:', error);
        res.json({ success: false, error: error.message });
    }
});

// FDH - ลบรายการ ADP30001 ออกจาก opitemrece สำหรับ VN ที่เลือก (ใช้กับเมนู ตัด ADP30001 ที่รับยา Morphine)
app.post('/api/delete-fdh-adp-morphine-items', async (req, res) => {
    try {
        const { host, port, database, user, password, type, vns } = req.body;
        if (!vns || !vns.length) return res.json({ success: false, error: 'ไม่มีรายการที่เลือก' });

        let deleted = 0, failed = 0, errors = [];
        if (type === 'postgresql') {
            const client = new PgClient({ host, port: parseInt(port), database, user, password, connectionTimeoutMillis: 30000 });
            await client.connect();
            for (const vn of vns) {
                try {
                    await client.query(
                        `DELETE FROM opitemrece WHERE vn = $1 AND icode IN (SELECT icode FROM nondrugitems WHERE nhso_adp_code = 'ADP30001')`,
                        [vn]
                    );
                    deleted++;
                } catch(e) { failed++; errors.push(`${vn}: ${e.message}`); }
            }
            await client.end();
        } else {
            const connection = await mysql.createConnection({ host, port, user, password, database, connectTimeout: 30000 });
            for (const vn of vns) {
                try {
                    await connection.execute(
                        `DELETE FROM opitemrece WHERE vn = ? AND icode IN (SELECT icode FROM nondrugitems WHERE nhso_adp_code = 'ADP30001')`,
                        [vn]
                    );
                    deleted++;
                } catch(e) { failed++; errors.push(`${vn}: ${e.message}`); }
            }
            await connection.end();
        }
        res.json({ success: true, deleted, failed, errors });
    } catch (error) {
        console.error('FDH delete adp-morphine items error:', error);
        res.json({ success: false, error: error.message });
    }
});

// แก้ไข HOSPMAIN/HOSPSUB ของเมนู INS — บันทึกที่ visit_pttype ของ vn+pttype (สิทธิ) ที่ตรงกัน
app.post('/api/update-fdh-ins-hospital', async (req, res) => {
    try {
        const { host, port, database, user, password, type, vn, pttype, hospmain, hospsub } = req.body;
        if (!vn || !pttype) return res.json({ success: false, error: 'ไม่พบ VN หรือสิทธิของรายการนี้' });

        if (type === 'postgresql') {
            const client = new PgClient({ host, port: parseInt(port), database, user, password, connectionTimeoutMillis: 30000 });
            await client.connect();
            const result = await client.query(
                `UPDATE visit_pttype SET hospmain = $1, hospsub = $2 WHERE vn = $3 AND pttype = $4`,
                [hospmain || null, hospsub || null, vn, pttype]
            );
            await client.end();
            res.json({ success: true, updated: result.rowCount });
        } else {
            const connection = await mysql.createConnection({ host, port, user, password, database, connectTimeout: 30000 });
            const [result] = await connection.execute(
                `UPDATE visit_pttype SET hospmain = ?, hospsub = ? WHERE vn = ? AND pttype = ?`,
                [hospmain || null, hospsub || null, vn, pttype]
            );
            await connection.end();
            res.json({ success: true, updated: result.affectedRows });
        }
    } catch (error) {
        console.error('FDH update INS hospital error:', error);
        res.json({ success: false, error: error.message });
    }
});

// ==================== Basic Checker Endpoints ====================

// Helper: run a completeness check for one column in a table
// Returns: { lbl, note, tbl, col, wh, tot, ok, skip, err }
async function chkBasic(conn, dbType, tbl, col, lbl, wh = '1=1', note = '', extraNulls = []) {
    const q = dbType === 'postgresql' ? '"' : '`';
    const castCol = dbType === 'postgresql' ? `"${col}"::text` : `\`${col}\``;
    const emptyParts = [`${q}${col}${q} IS NULL`, `${castCol} = ''`];
    for (const v of extraNulls) emptyParts.push(`${castCol} = '${v}'`);
    const emptyExpr = `(${emptyParts.join(' OR ')})`;
    const sql = `SELECT COUNT(*) AS tot, SUM(CASE WHEN ${emptyExpr} THEN 0 ELSE 1 END) AS ok FROM ${q}${tbl}${q} WHERE ${wh}`;
    try {
        if (dbType === 'postgresql') {
            const result = await conn.query(sql);
            const row = result.rows[0];
            return { lbl, note, tbl, col, wh, tot: parseInt(row.tot) || 0, ok: parseInt(row.ok) || 0, skip: false };
        } else {
            const [rows] = await conn.execute(sql);
            const row = rows[0];
            return { lbl, note, tbl, col, wh, tot: parseInt(row.tot) || 0, ok: parseInt(row.ok) || 0, skip: false };
        }
    } catch (err) {
        // table or column not found — mark as skip
        return { lbl, note, tbl, col, wh, tot: 0, ok: 0, skip: true, err: err.message };
    }
}

// POST /api/basic-checker/run
app.post('/api/basic-checker/run', async (req, res) => {
    const { host, port, database, user, password, type } = req.body;
    let conn = null;
    try {
        if (type === 'postgresql') {
            conn = new PgClient({ host, port, user, password, database, connectionTimeoutMillis: 10000 });
            await conn.connect();
        } else {
            conn = await mysql.createConnection({ host, port, user, password, database, connectTimeout: 10000 });
        }

        const C = (tbl, col, lbl, wh, note, extraNulls) => chkBasic(conn, type, tbl, col, lbl, wh, note, extraNulls);

        // Section 1: บุคลากรทางการแพทย์
        const wd1 = "active='Y'";
        const s1rows = await Promise.all([
            C('doctor', 'name',       'คำนำหน้า-ชื่อ-นามสกุล', wd1, 'ส่งออก 43 แฟ้ม'),
            C('doctor', 'pname',      'คำนำหน้า',               wd1),
            C('doctor', 'fname',      'ชื่อ',                    wd1),
            C('doctor', 'lname',      'นามสกุล',                 wd1),
            C('doctor', 'licenseno',  'เลขใบประกอบวิชาชีพ',      wd1),
            C('doctor', 'cid',        'เลขบัตรประชาชน',           wd1),
            C('doctor', 'position_id','ตำแหน่ง',                 wd1),
        ]);

        // Section 2: Login
        const wd2 = "officer_active='Y'";
        const s2rows = await Promise.all([
            C('officer', 'officer_login_name',      'User Login Name',   wd2),
            C('officer', 'officer_name',            'ชื่อ-นามสกุล',      wd2),
            C('officer', 'officer_group_list_text', 'กลุ่มสิทธิ์',       wd2),
            C('officer', 'officer_cid',             'เลขบัตรประชาชน',    wd2),
        ]);

        // Section 3: สิทธิการรักษา
        const wd3 = "isuse='Y'";
        const s3rows = await Promise.all([
            C('pttype', 'name',             'ชื่อสิทธิ',        wd3),
            C('pttype', 'pcode',            'สิทธิมาตรฐาน',     wd3),
            C('pttype', 'paidst',           'การชำระเงิน',      wd3),
            C('pttype', 'hipdata_code',     'รหัส INSCL',       wd3),
            C('pttype', 'nhso_code',        'รหัส สปสช.',       wd3),
            C('pttype', 'grouper_release',  'Grouper Version',  wd3),
        ]);

        // Section 4: ห้องตรวจ / คลินิก
        const wd4 = "active_status='Y'";
        const s4rows = await Promise.all([
            C('clinic', 'name',                 'ชื่อคลินิก',      wd4),
            C('clinic', 'hosxp_clinic_type_id', 'ประเภทโรค',       wd4),
            C('clinic', 'chronic',              'โรคเรื้อรัง',     wd4),
            C('clinic', 'no_export',            'ส่ง 43 แฟ้ม',    wd4),
        ]);

        // Section 5: ตึก/ห้อง/เตียง
        const wd5w = "ward_active='Y'";
        const wd5r = "active='Y'";
        const s5rows = await Promise.all([
            C('ward',   'name',     '[ตึก] ชื่อตึก',         wd5w),
            C('ward',   'spclty',   '[ตึก] แผนก',            wd5w),
            C('roomno', 'name',     '[ห้อง] ชื่อห้อง',       wd5r),
            C('roomno', 'roomtype', '[ห้อง] ประเภทห้อง',     wd5r),
            C('roomno', 'ward',     '[ห้อง] ตึก',            wd5r),
        ]);

        // Section 6: รายการยา
        const wd6 = "istatus='Y'";
        const s6rows = await Promise.all([
            C('drugitems', 'name',          'ชื่อยา',         wd6),
            C('drugitems', 'strength_name', 'ความแรง',        wd6),
            C('drugitems', 'dosage_id',     'รูปแบบยา',       wd6),
            C('drugitems', 'units',         'หน่วยนับ',       wd6),
            C('drugitems', 'price1',        'ราคาขาย',        wd6, '', ['0', '0.00']),
        ]);

        // Section 7: รายการ LAB
        const wd7 = "isuse='Y'";
        const s7rows = await Promise.all([
            C('lab_items', 'lab_items_name',  'ชื่อรายการ LAB', wd7),
            C('lab_items', 'lab_items_group', 'กลุ่ม',          wd7),
            C('lab_items', 'lab_items_unit',  'หน่วย',          wd7),
            C('lab_items', 'specimen_code',   'Specimen',       wd7),
        ]);

        // Section 8: รายการ X-RAY
        const wd8 = "isuse='Y'";
        const s8rows = await Promise.all([
            C('xray_items', 'xray_items_name',  'ชื่อ XRAY',    wd8),
            C('xray_items', 'xray_items_group', 'กลุ่ม',        wd8),
            C('xray_items', 'service_price',    'ราคา OPD',     wd8, '', ['0', '0.00']),
        ]);

        // Section 9: หัตถการ OPD
        const wd9 = "isuse='Y'";
        const s9rows = await Promise.all([
            C('er_oper_code', 'name',   'ชื่อหัตถการ',   wd9),
            C('er_oper_code', 'icd9cm', 'ICD9',          wd9),
            C('er_oper_code', 'price',  'ค่าบริการ',     wd9, '', ['0', '0.00']),
        ]);

        // Section 10: หัตถการ IPD
        const wd10 = "isuse='Y'";
        const s10rows = await Promise.all([
            C('ipt_oper_code', 'name',   'ชื่อหัตถการ',  wd10),
            C('ipt_oper_code', 'icd9cm', 'ICD9',         wd10),
            C('ipt_oper_code', 'price',  'ค่าบริการ',    wd10, '', ['0', '0.00']),
        ]);

        // Section 11: Blood Bank
        const wd11 = "isuse='Y'";
        const s11rows = await Promise.all([
            C('blb_blood_items', 'blb_blood_items_name',  'ชื่อ',  wd11),
            C('blb_blood_items', 'blb_blood_items_code',  'รหัส',  wd11),
            C('blb_blood_items', 'blb_blood_items_price', 'ราคา',  wd11, '', ['0']),
        ]);

        const sections = [
            { id: 'doctor',    lbl: 'บุคลากรทางการแพทย์',        icon: '👨‍⚕️', rows: s1rows  },
            { id: 'officer',   lbl: 'Login การใช้งานโปรแกรม',     icon: '🔑',   rows: s2rows  },
            { id: 'pttype',    lbl: 'สิทธิการรักษาของผู้ป่วย',    icon: '🏥',   rows: s3rows  },
            { id: 'clinic',    lbl: 'ห้องตรวจ / คลินิก',          icon: '🏨',   rows: s4rows  },
            { id: 'ward',      lbl: 'ตึก/ห้อง/เตียง',             icon: '🛏️',  rows: s5rows  },
            { id: 'drug',      lbl: 'รายการยา',                   icon: '💊',   rows: s6rows  },
            { id: 'lab',       lbl: 'รายการ LAB',                  icon: '🔬',   rows: s7rows  },
            { id: 'xray',      lbl: 'รายการ X-RAY',               icon: '🩻',   rows: s8rows  },
            { id: 'er_oper',   lbl: 'หัตถการ OPD',                icon: '⚕️',   rows: s9rows  },
            { id: 'ipt_oper',  lbl: 'หัตถการ IPD',                icon: '🏥',   rows: s10rows },
            { id: 'blood',     lbl: 'ข้อมูล Blood Bank',           icon: '🩸',   rows: s11rows },
        ];

        res.json({ success: true, sections });
    } catch (error) {
        console.error('basic-checker/run error:', error);
        res.json({ success: false, error: error.message });
    } finally {
        try {
            if (conn) {
                if (type === 'postgresql') await conn.end();
                else await conn.end();
            }
        } catch (e) {}
    }
});

// POST /api/basic-checker/detail
app.post('/api/basic-checker/detail', async (req, res) => {
    const { host, port, database, user, password, type, table, column, where } = req.body;

    const ALLOWED_TABLES = new Set([
        'doctor', 'officer', 'opduser', 'officer_group',
        'pttype', 'kskdepartment', 'clinic', 'spclty',
        'ward', 'roomno', 'bedno',
        'drugitems', 'nondrugitems',
        'lab_items', 'xray_items', 'blb_blood_items',
        'er_oper_code', 'ipt_oper_code', 'operation_item',
    ]);

    if (!ALLOWED_TABLES.has(table)) {
        return res.json({ success: false, error: 'table not allowed' });
    }
    if (!column || !where) {
        return res.json({ success: false, error: 'missing params' });
    }

    let conn = null;
    try {
        const q = type === 'postgresql' ? '"' : '`';
        const castCol = type === 'postgresql' ? `"${column}"::text` : `\`${column}\``;
        const emptyExpr = `(${q}${column}${q} IS NULL OR ${castCol} = '')`;
        const whereClause = `(${emptyExpr}) AND (${where})`;
        const sql = `SELECT * FROM ${q}${table}${q} WHERE ${whereClause} LIMIT 150`;

        let rows = [];
        if (type === 'postgresql') {
            conn = new PgClient({ host, port, user, password, database, connectionTimeoutMillis: 10000 });
            await conn.connect();
            const result = await conn.query(sql);
            rows = result.rows;
        } else {
            conn = await mysql.createConnection({ host, port, user, password, database, connectTimeout: 10000 });
            const [r] = await conn.execute(sql);
            rows = r;
        }

        res.json({ success: true, rows, count: rows.length });
    } catch (error) {
        console.error('basic-checker/detail error:', error);
        res.json({ success: false, error: error.message });
    } finally {
        try { if (conn) await conn.end(); } catch (e) {}
    }
});

// CIPN pttype list
app.post('/api/get-cipn-pttype-list', async (req, res) => {
    try {
        const { host, port, database, user, password, type } = req.body;
        const sql = `SELECT pttype, name FROM pttype WHERE hipdata_code='OFC' AND isuse='Y' ORDER BY name`;
        let rows;
        if (type === 'postgresql') {
            const client = new PgClient({ host, port: parseInt(port), database, user, password, connectionTimeoutMillis: 10000 });
            await client.connect();
            const result = await client.query(sql);
            await client.end();
            rows = result.rows;
        } else {
            const connection = await mysql.createConnection({ host, port, user, password, database, connectTimeout: 10000 });
            const [r] = await connection.execute(sql);
            await connection.end();
            rows = r;
        }
        res.json({ success: true, data: rows });
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

// CIPN กลุ่ม 46 กรณีใช้เลขอนุมัติ
app.post('/api/get-cipn-group46', async (req, res) => {
    try {
        const { host, port, database, user, password, type, dateFrom, dateTo, selectedPttypes } = req.body;
        const isPg = type === 'postgresql';
        const [ph1, ph2] = isPg ? ['$1', '$2'] : ['?', '?'];

        const pttypeFilter = (selectedPttypes && selectedPttypes.length > 0)
            ? `AND ip.pttype IN (${selectedPttypes.map(p => `'${p.replace(/'/g,"''")}'`).join(',')})`
            : `AND ip.pttype IN (SELECT pttype FROM pttype WHERE hipdata_code='OFC')`;

        const buildQuery = () => `
            SELECT p.hn, i.an, i.regdate AS date_admit, i.regtime AS time_admit,
                ip.auth_code,
                (CASE WHEN ip.auth_code IS NOT NULL AND ip.auth_code <> ''
                           AND ip.auth_code NOT LIKE 'PP%'
                      THEN 'Y' ELSE 'N' END) AS auth_code_check,
                CONCAT(p.pname, p.fname, '  ', p.lname) AS ptname,
                i.dchdate, i.dchtime
            FROM ipt i
            LEFT JOIN ipt_pttype ip ON ip.an = i.an
            LEFT JOIN patient p ON p.hn = i.hn
            WHERE i.dchdate BETWEEN ${ph1} AND ${ph2}
              ${pttypeFilter}
            ORDER BY i.dchdate, i.an
        `;

        let rows;
        if (isPg) {
            const client = new PgClient({ host, port: parseInt(port), database, user, password, connectionTimeoutMillis: 30000 });
            await client.connect();
            const result = await client.query(buildQuery(), [dateFrom, dateTo]);
            await client.end();
            rows = result.rows;
        } else {
            const connection = await mysql.createConnection({ host, port, user, password, database, connectTimeout: 30000 });
            const [r] = await connection.execute(buildQuery().replace(/\$1/g,'?').replace(/\$2/g,'?'), [dateFrom, dateTo]);
            await connection.end();
            rows = r;
        }
        const normalized = rows.map(r => { const o={}; Object.keys(r).forEach(k=>{ o[k]=r[k]; }); return o; });
        res.json({ success: true, data: normalized, count: normalized.length });
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

// บันทึก auth_code → ipt_pttype
app.post('/api/update-cipn-auth-code', async (req, res) => {
    try {
        const { host, port, database, user, password, type, an, auth_code } = req.body;
        const val = (auth_code || '').trim();
        if (type === 'postgresql') {
            const client = new PgClient({ host, port: parseInt(port), database, user, password, connectionTimeoutMillis: 10000 });
            await client.connect();
            await client.query(`UPDATE ipt_pttype SET auth_code = $1 WHERE an = $2`, [val, an]);
            await client.end();
        } else {
            const connection = await mysql.createConnection({ host, port, user, password, database, connectTimeout: 10000 });
            await connection.execute(`UPDATE ipt_pttype SET auth_code = ? WHERE an = ?`, [val, an]);
            await connection.end();
        }
        res.json({ success: true });
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

// ==================== C566: ตรวจสอบหัตถการใน er_oper_code ====================
app.post('/api/get-c566-er-oper', async (req, res) => {
    try {
        const { host, port, database, user, password, type } = req.body;
        const isPg = type === 'postgresql';
        const sql = `SELECT icode, name, icd9cm, price FROM ${isPg ? '' : '`'}er_oper_code${isPg ? '' : '`'} WHERE icd9cm IN ('9925','9224') ORDER BY icd9cm, icode`;
        let rows = [];
        if (isPg) {
            const client = new PgClient({ host, port: parseInt(port), database, user, password, connectionTimeoutMillis: 15000 });
            await client.connect();
            const r = await client.query(sql);
            rows = r.rows;
            await client.end();
        } else {
            const connection = await mysql.createConnection({ host, port, user, password, database, connectTimeout: 15000 });
            const [r] = await connection.execute(sql);
            rows = r;
            await connection.end();
        }
        res.json({ success: true, data: rows });
    } catch (error) {
        console.error('get-c566-er-oper error:', error);
        res.json({ success: false, error: error.message });
    }
});

// ==================== ดูข้อมูล / แก้ไข / เพิ่ม drugitems_cancer ====================
app.post('/api/get-drugitems-cancer', async (req, res) => {
    try {
        const { host, port, database, user, password, type } = req.body;
        const isPg = type === 'postgresql';
        let rows = [];
        if (isPg) {
            const client = new PgClient({ host, port: parseInt(port), database, user, password, connectionTimeoutMillis: 15000 });
            await client.connect();
            const r = await client.query(`SELECT icode, name, strength, units FROM drugitems_cancer ORDER BY icode`);
            rows = r.rows;
            await client.end();
        } else {
            const connection = await mysql.createConnection({ host, port, user, password, database, connectTimeout: 15000 });
            const [r] = await connection.execute(`SELECT icode, name, strength, units FROM \`drugitems_cancer\` ORDER BY icode`);
            rows = r;
            await connection.end();
        }
        res.json({ success: true, data: rows });
    } catch (error) {
        console.error('get-drugitems-cancer error:', error);
        res.json({ success: false, error: error.message });
    }
});

app.post('/api/upsert-drugitems-cancer-row', async (req, res) => {
    try {
        const { host, port, database, user, password, type, icode, name, strength, units } = req.body;
        if (!icode || !icode.trim()) return res.json({ success: false, error: 'icode ห้ามว่าง' });
        const isPg = type === 'postgresql';
        if (isPg) {
            const client = new PgClient({ host, port: parseInt(port), database, user, password, connectionTimeoutMillis: 15000 });
            await client.connect();
            await client.query(
                `INSERT INTO drugitems_cancer (icode, name, strength, units) VALUES ($1,$2,$3,$4)
                 ON CONFLICT (icode) DO UPDATE SET name=EXCLUDED.name, strength=EXCLUDED.strength, units=EXCLUDED.units`,
                [icode.trim(), name || null, strength || null, units || null]
            );
            await client.end();
        } else {
            const connection = await mysql.createConnection({ host, port, user, password, database, connectTimeout: 15000 });
            await connection.execute(
                `INSERT INTO \`drugitems_cancer\` (icode, name, strength, units) VALUES (?,?,?,?)
                 ON DUPLICATE KEY UPDATE name=VALUES(name), strength=VALUES(strength), units=VALUES(units)`,
                [icode.trim(), name || null, strength || null, units || null]
            );
            await connection.end();
        }
        res.json({ success: true });
    } catch (error) {
        console.error('upsert-drugitems-cancer-row error:', error);
        res.json({ success: false, error: error.message });
    }
});

app.post('/api/delete-drugitems-cancer-row', async (req, res) => {
    try {
        const { host, port, database, user, password, type, icode } = req.body;
        if (!icode) return res.json({ success: false, error: 'icode ห้ามว่าง' });
        const isPg = type === 'postgresql';
        if (isPg) {
            const client = new PgClient({ host, port: parseInt(port), database, user, password, connectionTimeoutMillis: 15000 });
            await client.connect();
            await client.query(`DELETE FROM drugitems_cancer WHERE icode=$1`, [icode]);
            await client.end();
        } else {
            const connection = await mysql.createConnection({ host, port, user, password, database, connectTimeout: 15000 });
            await connection.execute(`DELETE FROM \`drugitems_cancer\` WHERE icode=?`, [icode]);
            await connection.end();
        }
        res.json({ success: true });
    } catch (error) {
        console.error('delete-drugitems-cancer-row error:', error);
        res.json({ success: false, error: error.message });
    }
});

// ==================== drug_morphine: เลือก icode จาก drugitems มาเพิ่ม + ดู/แก้ไข/ลบ ====================

// รายการยาที่ใช้งานอยู่ (istatus='Y') สำหรับเลือกเพิ่มเข้า drug_morphine — ไม่แสดง icode ที่มีอยู่แล้ว
app.post('/api/get-drugitems-for-morphine', async (req, res) => {
    try {
        const { host, port, database, user, password, type } = req.body;
        const isPg = type === 'postgresql';
        let rows = [];
        if (isPg) {
            const client = new PgClient({ host, port: parseInt(port), database, user, password, connectionTimeoutMillis: 15000 });
            await client.connect();
            const r = await client.query(`SELECT icode, name, strength, units, CONCAT(name,' ',strength,' ',units) AS drugname FROM drugitems WHERE istatus='Y' AND icode NOT IN (SELECT icode FROM drug_morphine) ORDER BY name`);
            rows = r.rows;
            await client.end();
        } else {
            const connection = await mysql.createConnection({ host, port, user, password, database, connectTimeout: 15000 });
            const [r] = await connection.execute(`SELECT icode, name, strength, units, CONCAT(name,' ',strength,' ',units) AS drugname FROM \`drugitems\` WHERE istatus='Y' AND icode NOT IN (SELECT icode FROM drug_morphine) ORDER BY name`);
            rows = r;
            await connection.end();
        }
        res.json({ success: true, data: rows });
    } catch (error) {
        console.error('get-drugitems-for-morphine error:', error);
        res.json({ success: false, error: error.message });
    }
});

// เพิ่มรายการที่เลือกเข้า drug_morphine — drug_morphine_id เริ่มที่ 1 แล้วรันต่อจากเลขมากสุด+1
app.post('/api/add-drug-morphine-items', async (req, res) => {
    try {
        const { host, port, database, user, password, type, items } = req.body;
        if (!items || !items.length) return res.json({ success: false, error: 'ไม่มีรายการที่เลือก' });
        const isPg = type === 'postgresql';

        if (isPg) {
            const client = new PgClient({ host, port: parseInt(port), database, user, password, connectionTimeoutMillis: 30000 });
            await client.connect();
            const maxR = await client.query(`SELECT COALESCE(MAX(drug_morphine_id),0) AS maxid FROM drug_morphine`);
            let nextId = parseInt(maxR.rows[0].maxid) + 1;
            for (const item of items) {
                await client.query(
                    `INSERT INTO drug_morphine (drug_morphine_id, icode, name, strength, units) VALUES ($1,$2,$3,$4,$5)`,
                    [nextId, item.icode, item.name || null, item.strength || null, item.units || null]
                );
                nextId++;
            }
            await client.end();
        } else {
            const connection = await mysql.createConnection({ host, port, user, password, database, connectTimeout: 30000 });
            const [maxR] = await connection.execute(`SELECT COALESCE(MAX(drug_morphine_id),0) AS maxid FROM drug_morphine`);
            let nextId = parseInt(maxR[0].maxid) + 1;
            for (const item of items) {
                await connection.execute(
                    `INSERT INTO \`drug_morphine\` (drug_morphine_id, icode, name, strength, units) VALUES (?,?,?,?,?)`,
                    [nextId, item.icode, item.name || null, item.strength || null, item.units || null]
                );
                nextId++;
            }
            await connection.end();
        }
        res.json({ success: true, added: items.length });
    } catch (error) {
        console.error('add-drug-morphine-items error:', error);
        res.json({ success: false, error: error.message });
    }
});

// ดึงรายการ drug_morphine ที่บันทึกไว้ทั้งหมด
app.post('/api/get-drug-morphine-list', async (req, res) => {
    try {
        const { host, port, database, user, password, type } = req.body;
        const isPg = type === 'postgresql';
        let rows = [];
        if (isPg) {
            const client = new PgClient({ host, port: parseInt(port), database, user, password, connectionTimeoutMillis: 15000 });
            await client.connect();
            const r = await client.query(`SELECT dm.drug_morphine_id, dm.icode, dm.name, dm.strength, dm.units, di.ttmt_code FROM drug_morphine dm LEFT JOIN drugitems di ON di.icode = dm.icode ORDER BY dm.drug_morphine_id`);
            rows = r.rows;
            await client.end();
        } else {
            const connection = await mysql.createConnection({ host, port, user, password, database, connectTimeout: 15000 });
            const [r] = await connection.execute(`SELECT dm.drug_morphine_id, dm.icode, dm.name, dm.strength, dm.units, di.ttmt_code FROM \`drug_morphine\` dm LEFT JOIN \`drugitems\` di ON di.icode = dm.icode ORDER BY dm.drug_morphine_id`);
            rows = r;
            await connection.end();
        }
        res.json({ success: true, data: rows });
    } catch (error) {
        console.error('get-drug-morphine-list error:', error);
        res.json({ success: false, error: error.message });
    }
});

// แก้ไขแถว drug_morphine ตาม drug_morphine_id
app.post('/api/update-drug-morphine-row', async (req, res) => {
    try {
        const { host, port, database, user, password, type, drug_morphine_id, icode, name, strength, units } = req.body;
        if (!drug_morphine_id) return res.json({ success: false, error: 'ไม่พบ drug_morphine_id' });
        const isPg = type === 'postgresql';
        if (isPg) {
            const client = new PgClient({ host, port: parseInt(port), database, user, password, connectionTimeoutMillis: 15000 });
            await client.connect();
            await client.query(
                `UPDATE drug_morphine SET icode=$1, name=$2, strength=$3, units=$4 WHERE drug_morphine_id=$5`,
                [icode, name || null, strength || null, units || null, drug_morphine_id]
            );
            await client.end();
        } else {
            const connection = await mysql.createConnection({ host, port, user, password, database, connectTimeout: 15000 });
            await connection.execute(
                `UPDATE \`drug_morphine\` SET icode=?, name=?, strength=?, units=? WHERE drug_morphine_id=?`,
                [icode, name || null, strength || null, units || null, drug_morphine_id]
            );
            await connection.end();
        }
        res.json({ success: true });
    } catch (error) {
        console.error('update-drug-morphine-row error:', error);
        res.json({ success: false, error: error.message });
    }
});

// ลบแถว drug_morphine ตาม drug_morphine_id
app.post('/api/delete-drug-morphine-row', async (req, res) => {
    try {
        const { host, port, database, user, password, type, drug_morphine_id } = req.body;
        if (!drug_morphine_id) return res.json({ success: false, error: 'ไม่พบ drug_morphine_id' });
        const isPg = type === 'postgresql';
        if (isPg) {
            const client = new PgClient({ host, port: parseInt(port), database, user, password, connectionTimeoutMillis: 15000 });
            await client.connect();
            await client.query(`DELETE FROM drug_morphine WHERE drug_morphine_id=$1`, [drug_morphine_id]);
            await client.end();
        } else {
            const connection = await mysql.createConnection({ host, port, user, password, database, connectTimeout: 15000 });
            await connection.execute(`DELETE FROM \`drug_morphine\` WHERE drug_morphine_id=?`, [drug_morphine_id]);
            await connection.end();
        }
        res.json({ success: true });
    } catch (error) {
        console.error('delete-drug-morphine-row error:', error);
        res.json({ success: false, error: error.message });
    }
});

app.post('/api/update-billtran-vercode', async (req, res) => {
    try {
        const { host, port, database, user, password, type, debt_id, vercode } = req.body;
        console.log(`[update-billtran-vercode] debt_id=${JSON.stringify(debt_id)} (${typeof debt_id}), vercode=${JSON.stringify(vercode)}, type=${type}`);
        if (debt_id === undefined || debt_id === null || debt_id === '') {
            return res.json({ success: false, error: 'debt_id ห้ามว่าง' });
        }
        const isPg = type === 'postgresql';
        if (isPg) {
            const client = new PgClient({ host, port: parseInt(port), database, user, password, connectionTimeoutMillis: 15000 });
            await client.connect();
            const r = await client.query(
                `UPDATE rcpt_debt SET sss_approval_code=$1 WHERE debt_id=$2`,
                [vercode || '', debt_id]
            );
            await client.end();
            console.log(`[update-billtran-vercode] PG rowCount=${r.rowCount}`);
            if (r.rowCount === 0) return res.json({ success: false, error: `ไม่พบ debt_id=${debt_id} ใน rcpt_debt` });
        } else {
            const connection = await mysql.createConnection({ host, port, user, password, database, connectTimeout: 15000 });
            const [result] = await connection.execute(
                `UPDATE \`rcpt_debt\` SET sss_approval_code=? WHERE debt_id=?`,
                [vercode || '', debt_id]
            );
            await connection.end();
            console.log(`[update-billtran-vercode] MySQL affectedRows=${result.affectedRows}`);
            if (result.affectedRows === 0) return res.json({ success: false, error: `ไม่พบ debt_id=${debt_id} ใน rcpt_debt` });
        }
        res.json({ success: true });
    } catch (error) {
        console.error('update-billtran-vercode error:', error);
        res.json({ success: false, error: error.message });
    }
});


// ============================================================================
// Fee Schedule — กองทุนบริการตรวจคัดกรองมะเร็งเต้านมด้วยแมมโมแกรม/อัลตราซาวด์
// ----------------------------------------------------------------------------
// ตรวจสอบตามลำดับ
//   ลำดับที่ 1  ต้องมีค่าใช้จ่าย ADP Code = 42333 (nondrugitems.nhso_adp_code)
//   ลำดับที่ 2  ต้องเป็นคนไทย patient.nationality = '99'
//   ลำดับที่ 3  ต้องเป็นคนไข้อายุ 40 ปีขึ้นไป (คิด ณ วันรับบริการ)
//   ลำดับที่ 4  ต้องเป็นสิทธิ UC / ข้าราชการ / ประกันสังคม
//               pttype.hipdata_code IN ('UCS','WEL','OFC','SSS')
//   ลำดับที่ 5  ต้องมีวินิจฉัย Z123 — ถ้าไม่มี Tools เติมลง ovstdiag ให้ได้
//   ลำดับที่ 6  ต้องไม่มี ADP Code = WALKIN / ER-EXT — ถ้ามี Tools ลบออกให้ได้
//
// ลำดับ 1-4 เป็นเงื่อนไขคัดกรอง ไม่เข้าเงื่อนไขจะไม่ถูกดึงมา
// ลำดับ 5-6 แก้ไขได้ จึงดึงมาแสดงแล้วติดธง 'ต้องเพิ่ม' / 'ต้องตัด' ไว้ให้เลือกจัดการ
// ============================================================================
const MAMMO_DX      = 'Z123';
const MAMMO_ADP     = '42333';
const MAMMO_BAD_ADP = ['WALKIN', 'ER-EXT'];

app.post('/api/get-feeschedule-mammogram', async (req, res) => {
    try {
        const cfg = req.body;
        const { dateFrom, dateTo, type } = cfg;
        const isPg = type === 'postgresql';
        const ph = (n) => isPg ? `$${n}` : '?';
        const badList = MAMMO_BAD_ADP.map(c => `'${c}'`).join(',');

        // อายุ ณ วันรับบริการ
        const ageExpr = isPg
            ? `DATE_PART('year', AGE(ov.vstdate, pt.birthday))::int`
            : `TIMESTAMPDIFF(YEAR, pt.birthday, ov.vstdate)`;

        const agg = (expr, inner) => isPg
            ? `(SELECT STRING_AGG(DISTINCT CAST(${expr} AS TEXT), ', ') ${inner})`
            : `(SELECT GROUP_CONCAT(DISTINCT CAST(${expr} AS CHAR) SEPARATOR ', ') ${inner})`;

        const yn = (inner) => `CASE WHEN EXISTS (${inner}) THEN 'Y' ELSE 'N' END`;

        // ลำดับที่ 5 — มี Z123 หรือยัง
        const hasDx  = `SELECT 1 FROM ovstdiag d WHERE d.vn = ov.vn AND d.icd10 = '${MAMMO_DX}'`;
        // ลำดับที่ 6 — มี ADP ที่ห้ามมีติดอยู่หรือไม่
        const hasBad = `SELECT 1 FROM opitemrece ob JOIN nondrugitems nb ON nb.icode = ob.icode
                        WHERE ob.vn = ov.vn AND nb.nhso_adp_code IN (${badList})`;

        // รายการวินิจฉัยทั้งหมดของ visit (ดูได้ว่า Z123 มาคู่กับอะไร)
        const dxAgg      = agg('d2.icd10', `FROM ovstdiag d2 WHERE d2.vn = ov.vn`);
        // ชื่อรายการที่เป็น ADP 42333
        const adpItemAgg = agg('n3.name', `FROM opitemrece o3 JOIN nondrugitems n3 ON n3.icode = o3.icode WHERE o3.vn = ov.vn AND n3.nhso_adp_code = '${MAMMO_ADP}'`);
        // ADP ที่ต้องตัด และ ADP code ทุกตัวใน visit
        const badAdpAgg  = agg('nx.nhso_adp_code', `FROM opitemrece ox JOIN nondrugitems nx ON nx.icode = ox.icode WHERE ox.vn = ov.vn AND nx.nhso_adp_code IN (${badList})`);
        const adpAllAgg  = agg('n4.nhso_adp_code', `FROM opitemrece o4 JOIN nondrugitems n4 ON n4.icode = o4.icode WHERE o4.vn = ov.vn AND n4.nhso_adp_code IS NOT NULL AND n4.nhso_adp_code <> ''`);

        const sql = `
            SELECT DISTINCT
                ov.vstdate                                   AS "วันที่รับบริการ",
                ov.vsttime                                   AS "เวลารับบริการ",
                ov.hn                                        AS "HN",
                ov.vn                                        AS "VN",
                CONCAT(pt.pname, pt.fname, ' ', pt.lname)    AS "ชื่อ-นามสกุล",
                pt.cid                                       AS "เลขบัตรประชาชน",
                pt.sex                                       AS "เพศ",
                pt.birthday                                  AS "วันเกิด",
                ${ageExpr}                                   AS "อายุ (ปี)",
                pt.nationality                               AS "สัญชาติ",
                ov.pttype                                    AS "รหัสสิทธิ",
                ptt.name                                     AS "ชื่อสิทธิ",
                ptt.hipdata_code                             AS "hipdata_code",
                ${yn(hasDx)}                                 AS "f_dx",
                ${yn(hasBad)}                                AS "f_bad",
                ${dxAgg}                                     AS "ICD10 ในวิสิต",
                ${adpItemAgg}                                AS "รายการ ADP ${MAMMO_ADP}",
                ${badAdpAgg}                                 AS "ADP ที่ต้องตัด",
                ${adpAllAgg}                                 AS "ADP code ทั้งหมดในวิสิต"
            FROM ovst ov
            INNER JOIN patient pt ON pt.hn = ov.hn
            LEFT  JOIN pttype ptt ON ptt.pttype = ov.pttype
            WHERE ov.vstdate BETWEEN ${ph(1)} AND ${ph(2)}
                -- ลำดับที่ 1 ต้องมีค่าใช้จ่าย ADP 42333
                AND EXISTS (
                    SELECT 1 FROM opitemrece o
                    JOIN nondrugitems n ON n.icode = o.icode
                    WHERE o.vn = ov.vn AND n.nhso_adp_code = '${MAMMO_ADP}'
                )
                -- ลำดับที่ 2 คนไทยเท่านั้น
                AND pt.nationality = '99'
                -- ลำดับที่ 3 อายุ 40 ปีขึ้นไป
                AND ${ageExpr} >= 40
                -- ลำดับที่ 4 สิทธิ UC / ข้าราชการ / ประกันสังคม
                AND ov.pttype IN (
                    SELECT p2.pttype FROM pttype p2
                    WHERE p2.hipdata_code IN ('UCS','WEL','OFC','SSS')
                )
            ORDER BY ov.vstdate, ov.vn
        `;

        const raw = fsNormRows(await fsRun(cfg, sql, [dateFrom, dateTo]));
        const Y = (v) => String(v === undefined || v === null ? 'N' : v).toUpperCase() === 'Y';

        const rows = raw.map(r => {
            const noDx = !Y(r.f_dx);            // ลำดับที่ 5 ไม่ผ่าน
            const bad  = Y(r.f_bad);            // ลำดับที่ 6 ไม่ผ่าน

            const problems = [];
            if (noDx) problems.push('ต้องเพิ่มวินิจฉัย ' + MAMMO_DX);
            if (bad)  problems.push('ต้องตัด ADP ' + MAMMO_BAD_ADP.join('/'));

            const o = {
                'วันที่รับบริการ': r['วันที่รับบริการ'],
                'เวลารับบริการ': r['เวลารับบริการ'],
                'HN': r['HN'], 'VN': r['VN'],
                'สถานะ': problems.length ? 'ไม่สมบูรณ์' : 'สมบูรณ์',
                'สิ่งที่ต้องแก้': problems.join(' · ') || '-',
                'ต้องเพิ่ม': noDx ? 'Y' : 'N',
                'ต้องตัด': bad ? 'Y' : 'N',
                'ชื่อ-นามสกุล': r['ชื่อ-นามสกุล'],
                'เลขบัตรประชาชน': r['เลขบัตรประชาชน'],
                'เพศ': r['เพศ'],
                'วันเกิด': r['วันเกิด'],
                'อายุ (ปี)': r['อายุ (ปี)'],
                'สัญชาติ': r['สัญชาติ'],
                'รหัสสิทธิ': r['รหัสสิทธิ'],
                'ชื่อสิทธิ': r['ชื่อสิทธิ'],
                'hipdata_code': r['hipdata_code']
            };
            o['วินิจฉัย ' + MAMMO_DX] = noDx ? 'ไม่มี' : 'มี';
            o['_bad'] = [].concat(noDx ? ['วินิจฉัย ' + MAMMO_DX] : [], bad ? ['ADP ที่ต้องตัด'] : []);
            o['ICD10 ในวิสิต'] = r['ICD10 ในวิสิต'];
            o['รายการ ADP ' + MAMMO_ADP] = r['รายการ ADP ' + MAMMO_ADP];
            o['ADP ที่ต้องตัด'] = r['ADP ที่ต้องตัด'];
            o['ADP code ทั้งหมดในวิสิต'] = r['ADP code ทั้งหมดในวิสิต'];
            return o;
        });

        const needFix    = rows.filter(r => r['ต้องเพิ่ม'] === 'Y').length;
        const needCut    = rows.filter(r => r['ต้องตัด'] === 'Y').length;
        const incomplete = rows.filter(r => r['สถานะ'] === 'ไม่สมบูรณ์').length;

        res.json({
            success: true, data: rows, count: rows.length,
            needFix, needCut, incomplete, cuttable: !!needCut,
            addCodes: { icd10: [MAMMO_DX] }, excludeCodes: MAMMO_BAD_ADP
        });
    } catch (error) {
        console.error('feeschedule-mammogram error:', error);
        res.json({ success: false, error: error.message });
    }
});


// ============================================================================
// แมมโมแกรม — Tools เติมวินิจฉัย Z123 ให้วิสิตที่เลือก (ลำดับที่ 5)
// เช็คซ้ำก่อนเขียนทุกครั้ง ถ้ามี Z123 อยู่แล้วจะข้าม ไม่เขียนซ้ำ
// ============================================================================
app.post('/api/add-feeschedule-mammogram-dx', async (req, res) => {
    const unlock = await fsLockWrites();   // ต่อคิว กันสองคำขอเขียนพร้อมกัน
    try {
        const { host, port, database, user, password, type, vns } = req.body;
        if (!vns || !vns.length) return res.json({ success: false, error: 'ไม่มีรายการที่เลือก' });

        const isPg = type === 'postgresql';
        const P = (n) => isPg ? `$${n}` : '?';

        const conn = isPg
            ? new PgClient({ host, port: parseInt(port), database, user, password, connectionTimeoutMillis: 60000 })
            : await mysql.createConnection({ host, port, user, password, database, connectTimeout: 60000 });
        if (isPg) await conn.connect();

        const q = async (sql, params) => {
            if (isPg) return (await conn.query(sql, params || [])).rows;
            const [r] = await conn.execute(sql, params || []);
            return r;
        };

        let added = 0, skipped = 0, failed = 0;
        const errors = [], results = [];

        try {
            for (const vn of vns) {
                const detail = { vn: vn, added: [], skip: [], error: null };
                try {
                    const ov = await q(`SELECT vn, hn, vstdate, vsttime, doctor FROM ovst WHERE vn = ${P(1)}`, [vn]);
                    if (!ov.length) { detail.error = 'ไม่พบวิสิตนี้'; failed++; results.push(detail); continue; }
                    const v = ov[0];

                    const dup = await q(
                        `SELECT 1 AS x FROM ovstdiag WHERE vn = ${P(1)} AND icd10 = ${P(2)}`, [vn, MAMMO_DX]);
                    if (dup.length) { detail.skip.push(MAMMO_DX + ' มีอยู่แล้ว'); skipped++; results.push(detail); continue; }

                    if (isPg) {
                        const sid = (await q(`SELECT get_serialnumber('ovst_diag_id') AS sid`))[0].sid;
                        await q(
                            `INSERT INTO ovstdiag (ovst_diag_id, vn, icd10, hn, vstdate, vsttime, diagtype, doctor, staff, update_datetime)
                             VALUES ($1,$2,$3,$4,$5,$6,'4',$7,$8,NOW())`,
                            [sid, v.vn, MAMMO_DX, v.hn, v.vstdate, v.vsttime, v.doctor, v.doctor]);
                    } else {
                        await q(
                            `INSERT INTO ovstdiag (ovst_diag_id, vn, icd10, hn, vstdate, vsttime, diagtype, doctor, staff, update_datetime)
                             VALUES (get_serialnumber('ovst_diag_id'),?,?,?,?,?,'4',?,?,NOW())`,
                            [v.vn, MAMMO_DX, v.hn, v.vstdate, v.vsttime, v.doctor, v.doctor]);
                    }
                    detail.added.push(MAMMO_DX);
                    added++;
                } catch (e) {
                    detail.error = e.message; failed++; errors.push(`${vn}: ${e.message}`);
                }
                results.push(detail);
            }
        } finally {
            await conn.end();
        }

        res.json({ success: true, added, skipped, failed, errors, results, codes: [MAMMO_DX] });
    } catch (error) {
        console.error('add-feeschedule-mammogram-dx error:', error);
        res.json({ success: false, error: error.message });
    } finally {
        unlock();
    }
});


// ============================================================================
// Fee Schedule — helper ร่วมของกองทุนย่อย
// ============================================================================

// ---- จัดรูปวันที่/เวลาให้คงที่ก่อนส่งออกหน้าเว็บ ----
// วันที่: ตัดส่วนเวลาทิ้ง เหลือ YYYY-MM-DD  (ถ้าเป็น Date object ใช้ค่าตามเวลาเครื่อง ไม่ใช่ UTC
//        ไม่งั้นจะเลื่อนไป 1 วันเหมือนปัญหาเดิมของ pg)
// เวลา  : เหลือ HH:MM:SS
function fsDateOnly(v) {
    if (v === null || v === undefined || v === '') return v;
    if (v instanceof Date) {
        const y = v.getFullYear();
        const m = String(v.getMonth() + 1).padStart(2, '0');
        const d = String(v.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }
    const str = String(v);
    const m = str.match(/^(\d{4}-\d{2}-\d{2})/);
    return m ? m[1] : str;
}

function fsTimeOnly(v) {
    if (v === null || v === undefined || v === '') return v;
    if (v instanceof Date) {
        const hh = String(v.getHours()).padStart(2, '0');
        const mm = String(v.getMinutes()).padStart(2, '0');
        const ss = String(v.getSeconds()).padStart(2, '0');
        return `${hh}:${mm}:${ss}`;
    }
    const str = String(v);
    const m = str.match(/(\d{2}:\d{2}:\d{2})/) || str.match(/(\d{2}:\d{2})/);
    return m ? m[1] : str;
}

// เดินทุกแถวแล้วจัดรูปคอลัมน์ที่เป็นวันที่/เวลาตามชื่อคอลัมน์
function fsNormRows(rows) {
    return rows.map(r => {
        const o = {};
        Object.keys(r).forEach(k => {
            if (k.indexOf('วันที่') === 0 || k === 'วันเกิด') o[k] = fsDateOnly(r[k]);
            else if (k.indexOf('เวลา') === 0) o[k] = fsTimeOnly(r[k]);
            else o[k] = r[k];
        });
        return o;
    });
}

// ---- แปลงผลจาก "กรองทิ้ง" เป็น "ตรวจแล้วให้ Tools ลบ" ----
// rows ต้องมีคอลัมน์ f_bad ('Y'/'N') บอกว่ามี ADP ที่ห้ามอยู่ไหม
// คืนแถวใหม่ที่แทรก สถานะ / สิ่งที่ต้องแก้ / ต้องตัด ไว้ถัดจากคอลัมน์ VN
function fsMarkCut(rows, exList) {
    const label = exList.join(' หรือ ');
    return rows.map(r => {
        const bad = String(r.f_bad === undefined ? 'N' : r.f_bad).toUpperCase() === 'Y';
        const o = {};
        Object.keys(r).forEach(k => {
            if (k === 'f_bad') return;
            o[k] = r[k];
            if (k === 'VN') {
                o['สถานะ'] = bad ? 'ไม่สมบูรณ์' : 'สมบูรณ์';
                o['สิ่งที่ต้องแก้'] = bad ? ('ต้องตัด ADP ' + label) : '-';
                o['ต้องตัด'] = bad ? 'Y' : 'N';
            }
        });
        return o;
    });
}

// รัน query เดียวกันได้ทั้ง MySQL และ PostgreSQL
async function fsRun(cfg, sql, params) {
    const { host, port, database, user, password, type } = cfg;
    if (type === 'postgresql') {
        const client = new PgClient({ host, port: parseInt(port), database, user, password, connectionTimeoutMillis: 60000 });
        await client.connect();
        try { return (await client.query(sql, params || [])).rows; }
        finally { await client.end(); }
    }
    const connection = await mysql.createConnection({ host, port, user, password, database, connectTimeout: 60000 });
    try { const [r] = await connection.execute(sql, params || []); return r; }
    finally { await connection.end(); }
}

// ---- คิวสำหรับ endpoint ที่เขียนข้อมูล ทำทีละคำขอ ----
// ทุก endpoint ที่เพิ่มข้อมูลใช้รูปแบบ "เช็คก่อนว่ามีหรือยัง แล้วค่อยเขียน"
// ถ้าสองคำขอเข้ามาพร้อมกันกับวิสิตเดียวกัน (กดปุ่มรัว หรือเปิดหลายเครื่อง)
// ทั้งคู่จะเช็คแล้วไม่เจอ แล้วเขียนทั้งคู่ -> ได้ข้อมูลซ้ำ
// ทดสอบแล้วเกิดขึ้นจริงเมื่อยิงพร้อมกัน จึงต้องบังคับให้ทำทีละคำขอ
// งานพวกนี้เป็นงาน batch ที่เจ้าหน้าที่กดเป็นครั้งคราว การต่อคิวไม่กระทบการใช้งาน
let fsWriteQueue = Promise.resolve();

function fsLockWrites() {
    let release;
    const gate = new Promise(res => { release = res; });
    const wait = fsWriteQueue;
    fsWriteQueue = wait.then(() => gate, () => gate);
    return wait.then(() => release, () => release);
}

// อายุ ณ วันรับบริการ
const fsAgeExpr = (isPg) => isPg
    ? `DATE_PART('year', AGE(ov.vstdate, pt.birthday))::int`
    : `TIMESTAMPDIFF(YEAR, pt.birthday, ov.vstdate)`;

const fsAgg = (isPg, expr, inner) => isPg
    ? `(SELECT STRING_AGG(DISTINCT CAST(${expr} AS TEXT), ', ') ${inner})`
    : `(SELECT GROUP_CONCAT(DISTINCT CAST(${expr} AS CHAR) SEPARATOR ', ') ${inner})`;

// ============================================================================
// Fee Schedule — กองทุนทันตกรรมในหญิงตั้งครรภ์
// ----------------------------------------------------------------------------
// ตรวจสอบตามลำดับ
//   ลำดับที่ 1  ต้องมีค่าใช้จ่าย ADP 30008 หรือ 30009 อย่างน้อยหนึ่งตัว จึงจะถูกดึงมา
//               แล้วเช็คต่อว่ามีครบทั้งคู่ไหม ขาดตัวไหน Tools เพิ่มลง opitemrece ให้ได้
//   ลำดับที่ 2  ต้องเป็นผู้หญิง patient.sex = '2'
//   ลำดับที่ 3  คนไทยเท่านั้น patient.nationality = '99'
//   ลำดับที่ 4  สิทธิ UC / ข้าราชการ (UCS, WEL, OFC)
//               ติ๊ก checkbox 'รวมสิทธิประกันสังคม' เพื่อเพิ่ม SSS เข้าไปด้วย
//   ลำดับที่ 5  ต้องมีวินิจฉัย Z0519 — ถ้าไม่มี Tools เติมลง ovstdiag ให้ได้
//   ลำดับที่ 6  ต้องมี ICD10TM ครบทั้ง 2330011 และ 2277310
//               อ่านจากหัตถการทันตกรรมที่ผูก ICD10TM ไว้ (opitemrece -> dttm)
//               ข้อนี้ติดธงบอกอย่างเดียว Tools ไม่เพิ่มให้ ต้องไปลงหัตถการในโปรแกรมหลัก
//   ลำดับที่ 7  ต้องไม่มี ADP WALKIN / ER-EXT — ถ้ามี Tools ลบออกให้ได้
//
// ลำดับ 1-4 เป็นเงื่อนไขคัดกรอง ไม่เข้าเงื่อนไขจะไม่ถูกดึงมา
// ลำดับ 1 (ส่วนที่ขาดไปตัวเดียว), 5, 6, 7 เป็นเงื่อนไขที่ติดธงไว้ให้ตรวจสอบ
// ============================================================================
const DENTAL_DX      = 'Z0519';
const DENTAL_ADP     = ['30008', '30009'];
const DENTAL_TM      = ['2330011', '2277310'];
const DENTAL_BAD_ADP = ['WALKIN', 'ER-EXT'];
const DENTAL_PTTYPE  = ['UCS', 'WEL', 'OFC'];
const DENTAL_PTTYPE_SSS = 'SSS';

// ชื่อคอลัมน์ ICD10TM ใน dttm เขียนไม่เหมือนกันในแต่ละรุ่น
// (icd10tm_operation_code / icd10tm0operation_code / ...) จึงอ่านชื่อจริงจาก schema
async function fsFindDttmIcd10tmColumn(cfg) {
    const isPg = cfg.type === 'postgresql';
    const sql = isPg
        ? `SELECT column_name FROM information_schema.columns
           WHERE table_name = 'dttm' AND column_name ILIKE '%icd10tm%'`
        : `SELECT column_name FROM information_schema.columns
           WHERE table_schema = ? AND table_name = 'dttm' AND column_name LIKE '%icd10tm%'`;
    const rows = await fsRun(cfg, sql, isPg ? [] : [cfg.database]);
    const cols = rows.map(r => String(r.column_name || r.COLUMN_NAME));

    const preferred = ['icd10tm_operation_code', 'icd10tm_operation_cod', 'icd10tm0operation_code'];
    const lower = cols.map(c => c.toLowerCase());
    for (const want of preferred) {
        const i = lower.indexOf(want);
        if (i !== -1) return { col: cols[i], all: cols };
    }
    // ไม่ตรงตัวไหนเลย -> เอาคอลัมน์แรกที่มีคำว่า operation ถ้ามี ไม่งั้นเอาตัวแรก
    const op = cols.find(c => /operation/i.test(c));
    return { col: op || cols[0] || null, all: cols };
}

// สิทธิที่ใช้ในลำดับที่ 4 — ติ๊ก includeSss แล้วจึงนับประกันสังคมด้วย
function fsDentalPttypes(includeSss) {
    return includeSss ? DENTAL_PTTYPE.concat(DENTAL_PTTYPE_SSS) : DENTAL_PTTYPE.slice();
}

app.post('/api/get-feeschedule-dental-anc', async (req, res) => {
    try {
        const cfg = req.body;
        const { dateFrom, dateTo, includeSss } = cfg;
        const isPg = cfg.type === 'postgresql';
        const ph = (n) => isPg ? `$${n}` : '?';
        const quoted = (list) => list.map(c => `'${c}'`).join(',');

        // ICD10TM อ่านจาก dttm.icd10tm0operation_code
        // เชื่อมกับ visit ผ่านรายการค่าใช้จ่าย: ovst.vn -> opitemrece.icode -> dttm.icode
        const tmInfo = await fsFindDttmIcd10tmColumn(cfg);
        if (!tmInfo.col) {
            return res.json({
                success: false,
                error: 'ไม่พบคอลัมน์ ICD10TM ในตาราง dttm — คอลัมน์ที่มีคือ: '
                     + (tmInfo.all.length ? tmInfo.all.join(', ') : '(ไม่มีคอลัมน์ที่มีคำว่า icd10tm เลย)')
            });
        }
        const TM_COL = tmInfo.col;
        const TM_SRC = 'dttm.' + TM_COL;

        const hasTm = (code) =>
            `EXISTS (
                    SELECT 1 FROM opitemrece ot
                    JOIN dttm dt ON dt.icode = ot.icode
                    WHERE ot.vn = ov.vn AND dt.${TM_COL} = '${code}'
                )`;
        const hasAdp = (code) =>
            `EXISTS (SELECT 1 FROM opitemrece o JOIN nondrugitems n ON n.icode = o.icode WHERE o.vn = ov.vn AND n.nhso_adp_code = '${code}')`;
        const yn = (expr) => `CASE WHEN ${expr} THEN 'Y' ELSE 'N' END`;

        const hasDx  = `EXISTS (SELECT 1 FROM ovstdiag d WHERE d.vn = ov.vn AND d.icd10 = '${DENTAL_DX}')`;
        const hasBad = `EXISTS (
                    SELECT 1 FROM opitemrece ob JOIN nondrugitems nb ON nb.icode = ob.icode
                    WHERE ob.vn = ov.vn AND nb.nhso_adp_code IN (${quoted(DENTAL_BAD_ADP)})
                )`;

        const dxAgg = fsAgg(isPg, 'd2.icd10', `FROM ovstdiag d2 WHERE d2.vn = ov.vn`);
        const tmAgg = fsAgg(isPg, `dt2.${TM_COL}`,
            `FROM opitemrece ot2 JOIN dttm dt2 ON dt2.icode = ot2.icode
             WHERE ot2.vn = ov.vn AND dt2.${TM_COL} IS NOT NULL AND dt2.${TM_COL} <> ''`);
        const badAdpAgg = fsAgg(isPg, 'nx.nhso_adp_code', `FROM opitemrece ox JOIN nondrugitems nx ON nx.icode = ox.icode WHERE ox.vn = ov.vn AND nx.nhso_adp_code IN (${quoted(DENTAL_BAD_ADP)})`);
        const adpAllAgg = fsAgg(isPg, 'n4.nhso_adp_code', `FROM opitemrece o4 JOIN nondrugitems n4 ON n4.icode = o4.icode WHERE o4.vn = ov.vn AND n4.nhso_adp_code IS NOT NULL AND n4.nhso_adp_code <> ''`);
        const adpItemAgg = fsAgg(isPg, 'n3.name', `FROM opitemrece o3 JOIN nondrugitems n3 ON n3.icode = o3.icode WHERE o3.vn = ov.vn AND n3.nhso_adp_code IN (${quoted(DENTAL_ADP)})`);

        const sql = `
            SELECT DISTINCT
                ov.vstdate                                AS "วันที่รับบริการ",
                ov.vsttime                                AS "เวลารับบริการ",
                ov.hn                                     AS "HN",
                ov.vn                                     AS "VN",
                CONCAT(pt.pname, pt.fname, ' ', pt.lname) AS "ชื่อ-นามสกุล",
                pt.cid                                    AS "เลขบัตรประชาชน",
                pt.sex                                    AS "เพศ",
                pt.birthday                               AS "วันเกิด",
                ${fsAgeExpr(isPg)}                        AS "อายุ (ปี)",
                pt.nationality                            AS "สัญชาติ",
                ov.pttype                                 AS "รหัสสิทธิ",
                ptt.name                                  AS "ชื่อสิทธิ",
                ptt.hipdata_code                          AS "hipdata_code",
                ${yn(hasAdp(DENTAL_ADP[0]))}              AS "f_adp0",
                ${yn(hasAdp(DENTAL_ADP[1]))}              AS "f_adp1",
                ${yn(hasDx)}                              AS "f_dx",
                ${yn(hasTm(DENTAL_TM[0]))}                AS "f_tm0",
                ${yn(hasTm(DENTAL_TM[1]))}                AS "f_tm1",
                ${yn(hasBad)}                             AS "f_bad",
                ${dxAgg}                                  AS "ICD10 ในวิสิต",
                ${tmAgg}                                  AS "ICD10TM ในวิสิต",
                ${adpItemAgg}                             AS "รายการ ADP ${DENTAL_ADP.join('/')}",
                ${badAdpAgg}                              AS "ADP ที่ต้องตัด",
                ${adpAllAgg}                              AS "ADP code ทั้งหมดในวิสิต"
            FROM ovst ov
            INNER JOIN patient pt ON pt.hn = ov.hn
            LEFT  JOIN pttype ptt ON ptt.pttype = ov.pttype
            WHERE ov.vstdate BETWEEN ${ph(1)} AND ${ph(2)}
                -- ลำดับที่ 1 ต้องมี ADP 30008 หรือ 30009 อย่างน้อยหนึ่งตัว
                AND EXISTS (
                    SELECT 1 FROM opitemrece o1
                    JOIN nondrugitems n1 ON n1.icode = o1.icode
                    WHERE o1.vn = ov.vn AND n1.nhso_adp_code IN (${quoted(DENTAL_ADP)})
                )
                -- ลำดับที่ 2 ผู้หญิงเท่านั้น
                AND pt.sex = '2'
                -- ลำดับที่ 3 คนไทยเท่านั้น
                AND pt.nationality = '99'
                -- ลำดับที่ 4 สิทธิ UC / ข้าราชการ (+ ประกันสังคมเมื่อติ๊ก checkbox)
                AND ov.pttype IN (
                    SELECT p2.pttype FROM pttype p2
                    WHERE p2.hipdata_code IN (${quoted(fsDentalPttypes(includeSss))})
                )
            ORDER BY ov.vstdate, ov.vn
        `;

        const raw = fsNormRows(await fsRun(cfg, sql, [dateFrom, dateTo]));
        const Y = (v) => String(v === undefined || v === null ? 'N' : v).toUpperCase() === 'Y';

        const rows = raw.map(r => {
            // ลำดับที่ 1 — ADP ที่ยังขาด (เพิ่มได้)
            const missAdp = DENTAL_ADP.filter((c, i) => !Y(r['f_adp' + i]));
            // ลำดับที่ 5 — วินิจฉัยที่ยังขาด (เพิ่มได้)
            const noDx = !Y(r.f_dx);
            // ลำดับที่ 6 — ICD10TM ที่ยังขาด (เพิ่มให้ไม่ได้ แจ้งอย่างเดียว)
            const missTm = DENTAL_TM.filter((c, i) => !Y(r['f_tm' + i]));
            // ลำดับที่ 7 — ADP ที่ต้องตัด
            const bad = Y(r.f_bad);

            const problems = [];
            if (missAdp.length) problems.push('ต้องเพิ่ม ADP ' + missAdp.join('/'));
            if (noDx)           problems.push('ต้องเพิ่มวินิจฉัย ' + DENTAL_DX);
            if (missTm.length)  problems.push('ขาด ICD10TM ' + missTm.join('/') + ' (ลงหัตถการเอง)');
            if (bad)            problems.push('ต้องตัด ADP ' + DENTAL_BAD_ADP.join('/'));

            // 'ต้องเพิ่ม' ติดเฉพาะสิ่งที่ Tools เขียนให้ได้จริง (ADP + วินิจฉัย)
            // ICD10TM ที่ขาดทำให้ 'ไม่สมบูรณ์' แต่ไม่ทำให้ติ๊กเพิ่มได้
            const canAdd = missAdp.length > 0 || noDx;

            const o = {
                'วันที่รับบริการ': r['วันที่รับบริการ'],
                'เวลารับบริการ': r['เวลารับบริการ'],
                'HN': r['HN'], 'VN': r['VN'],
                'สถานะ': problems.length ? 'ไม่สมบูรณ์' : 'สมบูรณ์',
                'สิ่งที่ต้องแก้': problems.join(' · ') || '-',
                'ต้องเพิ่ม': canAdd ? 'Y' : 'N',
                'ต้องตัด': bad ? 'Y' : 'N',
                'ชื่อ-นามสกุล': r['ชื่อ-นามสกุล'],
                'เลขบัตรประชาชน': r['เลขบัตรประชาชน'],
                'เพศ': r['เพศ'],
                'วันเกิด': r['วันเกิด'],
                'อายุ (ปี)': r['อายุ (ปี)'],
                'สัญชาติ': r['สัญชาติ'],
                'รหัสสิทธิ': r['รหัสสิทธิ'],
                'ชื่อสิทธิ': r['ชื่อสิทธิ'],
                'hipdata_code': r['hipdata_code']
            };
            DENTAL_ADP.forEach((c, i) => { o['ADP ' + c] = Y(r['f_adp' + i]) ? 'มี' : 'ไม่มี'; });
            o['_bad'] = [].concat(
                missAdp.map(c => 'ADP ' + c),
                noDx ? ['วินิจฉัย ' + DENTAL_DX] : [],
                missTm.map(c => 'ICD10TM ' + c),
                bad ? ['ADP ที่ต้องตัด'] : []);
            o['วินิจฉัย ' + DENTAL_DX] = noDx ? 'ไม่มี' : 'มี';
            DENTAL_TM.forEach((c, i) => { o['ICD10TM ' + c] = Y(r['f_tm' + i]) ? 'มี' : 'ไม่มี'; });
            o['ICD10 ในวิสิต'] = r['ICD10 ในวิสิต'];
            o['ICD10TM ในวิสิต'] = r['ICD10TM ในวิสิต'];
            o['รายการ ADP ' + DENTAL_ADP.join('/')] = r['รายการ ADP ' + DENTAL_ADP.join('/')];
            o['ADP ที่ต้องตัด'] = r['ADP ที่ต้องตัด'];
            o['ADP code ทั้งหมดในวิสิต'] = r['ADP code ทั้งหมดในวิสิต'];
            return o;
        });

        const needFix    = rows.filter(r => r['ต้องเพิ่ม'] === 'Y').length;
        const needCut    = rows.filter(r => r['ต้องตัด'] === 'Y').length;
        const incomplete = rows.filter(r => r['สถานะ'] === 'ไม่สมบูรณ์').length;

        res.json({
            success: true, data: rows, count: rows.length,
            needFix, needCut, incomplete, cuttable: !!needCut,
            icd10tmSource: TM_SRC,
            pttypeUsed: fsDentalPttypes(includeSss).join('/')
        });
    } catch (error) {
        console.error('feeschedule-dental-anc error:', error);
        res.json({ success: false, error: error.message });
    }
});


// ============================================================================
// ทันตกรรมหญิงตั้งครรภ์ — Tools เติมสิ่งที่ขาดให้วิสิตที่เลือก
//   - ลำดับที่ 5  วินิจฉัย Z0519 -> ovstdiag
//   - ลำดับที่ 1  ADP 30008 / 30009 ที่ยังขาด -> opitemrece
// ICD10TM (ลำดับที่ 6) ไม่เติมให้ เพราะต้องลงหัตถการทันตกรรมในโปรแกรมหลัก
// เช็คซ้ำก่อนเขียนทุกรายการ ถ้ามีอยู่แล้วจะข้าม
// ============================================================================
app.post('/api/add-feeschedule-dental-anc-missing', async (req, res) => {
    const unlock = await fsLockWrites();   // ต่อคิว กันสองคำขอเขียนพร้อมกัน
    try {
        const cfg = req.body;
        const { host, port, database, user, password, type, vns } = cfg;
        if (!vns || !vns.length) return res.json({ success: false, error: 'ไม่มีรายการที่เลือก' });

        const isPg = type === 'postgresql';
        const P = (n) => isPg ? `$${n}` : '?';

        // คอลัมน์ที่มีจริงใน opitemrece (แต่ละรุ่นไม่เท่ากัน) จะได้ใส่เฉพาะที่มี
        const colSql = isPg
            ? `SELECT column_name FROM information_schema.columns WHERE table_name = 'opitemrece'`
            : `SELECT column_name FROM information_schema.columns WHERE table_schema = ? AND table_name = 'opitemrece'`;
        const colRows = await fsRun(cfg, colSql, isPg ? [] : [database]);
        const oprCols = new Set(colRows.map(r => String(r.column_name || r.COLUMN_NAME).toLowerCase()));

        const conn = isPg
            ? new PgClient({ host, port: parseInt(port), database, user, password, connectionTimeoutMillis: 60000 })
            : await mysql.createConnection({ host, port, user, password, database, connectTimeout: 60000 });
        if (isPg) await conn.connect();

        const q = async (sql, params) => {
            if (isPg) return (await conn.query(sql, params || [])).rows;
            const [r] = await conn.execute(sql, params || []);
            return r;
        };

        let addedDiag = 0, addedItem = 0, skipped = 0, failed = 0;
        const errors = [], results = [];

        try {
            for (const vn of vns) {
                const detail = { vn: vn, diag: [], item: [], skip: [], error: null };
                try {
                    const ov = await q(`SELECT vn, hn, vstdate, vsttime, doctor, pttype FROM ovst WHERE vn = ${P(1)}`, [vn]);
                    if (!ov.length) { detail.error = 'ไม่พบวิสิตนี้'; failed++; results.push(detail); continue; }
                    const v = ov[0];

                    // ---- ลำดับที่ 5: วินิจฉัย Z0519 -> ovstdiag ----
                    const dup = await q(
                        `SELECT 1 AS x FROM ovstdiag WHERE vn = ${P(1)} AND icd10 = ${P(2)}`, [vn, DENTAL_DX]);
                    if (dup.length) {
                        detail.skip.push(`วินิจฉัย ${DENTAL_DX} มีอยู่แล้ว`);
                        skipped++;
                    } else {
                        if (isPg) {
                            const sid = (await q(`SELECT get_serialnumber('ovst_diag_id') AS sid`))[0].sid;
                            await q(
                                `INSERT INTO ovstdiag (ovst_diag_id, vn, icd10, hn, vstdate, vsttime, diagtype, doctor, staff, update_datetime)
                                 VALUES ($1,$2,$3,$4,$5,$6,'4',$7,$8,NOW())`,
                                [sid, v.vn, DENTAL_DX, v.hn, v.vstdate, v.vsttime, v.doctor, v.doctor]);
                        } else {
                            await q(
                                `INSERT INTO ovstdiag (ovst_diag_id, vn, icd10, hn, vstdate, vsttime, diagtype, doctor, staff, update_datetime)
                                 VALUES (get_serialnumber('ovst_diag_id'),?,?,?,?,?,'4',?,?,NOW())`,
                                [v.vn, DENTAL_DX, v.hn, v.vstdate, v.vsttime, v.doctor, v.doctor]);
                        }
                        detail.diag.push(DENTAL_DX);
                        addedDiag++;
                    }

                    // ---- ลำดับที่ 1: ADP ที่ยังขาด -> opitemrece ----
                    for (const code of DENTAL_ADP) {
                        const dupI = await q(
                            `SELECT 1 AS x FROM opitemrece o JOIN nondrugitems n ON n.icode = o.icode
                             WHERE o.vn = ${P(1)} AND n.nhso_adp_code = ${P(2)}`, [vn, code]);
                        if (dupI.length) { detail.skip.push(`ADP ${code} มีอยู่แล้ว`); skipped++; continue; }

                        const items = await q(
                            `SELECT icode, name, price, income FROM nondrugitems
                             WHERE nhso_adp_code = ${P(1)} AND istatus = '1' ORDER BY icode`, [code]);
                        if (!items.length) {
                            detail.skip.push(`ไม่พบรายการ ADP ${code} ที่เปิดใช้งาน (istatus='1')`);
                            skipped++;
                            continue;
                        }
                        const it = items[0];
                        const price = Number(it.price || 0);

                        const want = {
                            vn: v.vn, hn: v.hn, vstdate: v.vstdate, vsttime: v.vsttime,
                            icode: it.icode, qty: 1, unitprice: price, sum_price: price,
                            paidst: '02', income: it.income, doctor: v.doctor, staff: v.doctor,
                            pttype: v.pttype
                        };
                        const cols = Object.keys(want).filter(c => oprCols.has(c));
                        const vals = cols.map(c => want[c]);
                        const marks = cols.map((_, i) => isPg ? `$${i + 1}` : '?').join(',');
                        await q(`INSERT INTO opitemrece (${cols.join(',')}) VALUES (${marks})`, vals);

                        detail.item.push(`ADP ${code} icode ${it.icode} ราคา ${price}`);
                        addedItem++;
                    }
                } catch (e) {
                    detail.error = e.message; failed++; errors.push(`${vn}: ${e.message}`);
                }
                results.push(detail);
            }
        } finally {
            await conn.end();
        }

        res.json({
            success: true,
            addedDiag, addedItem, skipped, failed, errors, results,
            diagNoun: 'วินิจฉัย ' + DENTAL_DX,
            itemNoun: 'ADP ' + DENTAL_ADP.join('/')
        });
    } catch (error) {
        console.error('add-feeschedule-dental-anc-missing error:', error);
        res.json({ success: false, error: error.message });
    } finally {
        unlock();
    }
});

// ============================================================================
// Fee Schedule — กองทุนบริการยาเม็ดเสริมธาตุเหล็ก
// ----------------------------------------------------------------------------
// ตรวจสอบตามลำดับ
//   ลำดับที่ 1  ต้องมีค่าใช้จ่าย ADP Code = 14001 (nondrugitems.nhso_adp_code)
//   ลำดับที่ 2  ต้องเป็นคนไทย patient.nationality = '99'
//   ลำดับที่ 3  ต้องเป็นคนไข้อายุ 13 - 45 ปี (คิด ณ วันรับบริการ)
//   ลำดับที่ 4  สิทธิ UC / ข้าราชการ / ประกันสังคม
//               pttype.hipdata_code IN ('UCS','WEL','OFC','SSS')
//   ลำดับที่ 5  ต้องมีวินิจฉัย D500 หรือ D508 หรือ D509 อย่างน้อยหนึ่งตัว
//               ถ้าไม่มีเลย Tools เติมให้ได้ — รหัสที่ลงเลือกจาก dropdown หน้าจอ
//   ลำดับที่ 6  ต้องมีวินิจฉัย Z130 — ถ้าไม่มี Tools เติมลง ovstdiag ให้ได้
//   ลำดับที่ 7  ต้องไม่มี ADP WALKIN / ER-EXT — ถ้ามี Tools ลบออกให้ได้
//
// ลำดับ 1-4 เป็นเงื่อนไขคัดกรอง ไม่เข้าเงื่อนไขจะไม่ถูกดึงมา
// ลำดับ 5-7 แก้ไขได้ จึงดึงมาแสดงแล้วติดธงไว้ให้เลือกจัดการ
// ============================================================================
const IRON_ADP      = '14001';
const IRON_ANEMIA   = ['D500', 'D508', 'D509'];   // ลำดับที่ 5 — มีตัวใดตัวหนึ่งก็ผ่าน
const IRON_SCREEN   = 'Z130';                     // ลำดับที่ 6
const IRON_BAD_ADP  = ['WALKIN', 'ER-EXT'];
const IRON_AGE_MIN  = 13;
const IRON_AGE_MAX  = 45;

app.post('/api/get-feeschedule-iron', async (req, res) => {
    try {
        const cfg = req.body;
        const { dateFrom, dateTo } = cfg;
        const isPg = cfg.type === 'postgresql';
        const ph = (n) => isPg ? `$${n}` : '?';
        const age = fsAgeExpr(isPg);
        const quoted = (list) => list.map(c => `'${c}'`).join(',');
        const yn = (expr) => `CASE WHEN ${expr} THEN 'Y' ELSE 'N' END`;

        const hasAnemia = `EXISTS (SELECT 1 FROM ovstdiag d WHERE d.vn = ov.vn AND d.icd10 IN (${quoted(IRON_ANEMIA)}))`;
        const hasScreen = `EXISTS (SELECT 1 FROM ovstdiag dz WHERE dz.vn = ov.vn AND dz.icd10 = '${IRON_SCREEN}')`;
        const hasBad    = `EXISTS (
                    SELECT 1 FROM opitemrece ob JOIN nondrugitems nb ON nb.icode = ob.icode
                    WHERE ob.vn = ov.vn AND nb.nhso_adp_code IN (${quoted(IRON_BAD_ADP)})
                )`;

        const dxAgg = fsAgg(isPg, 'd2.icd10', `FROM ovstdiag d2 WHERE d2.vn = ov.vn`);
        const dxAnemiaAgg = fsAgg(isPg, 'd3.icd10', `FROM ovstdiag d3 WHERE d3.vn = ov.vn AND d3.icd10 IN (${quoted(IRON_ANEMIA)})`);
        const adpItemAgg = fsAgg(isPg, 'n3.name', `FROM opitemrece o3 JOIN nondrugitems n3 ON n3.icode = o3.icode WHERE o3.vn = ov.vn AND n3.nhso_adp_code = '${IRON_ADP}'`);
        const badAdpAgg = fsAgg(isPg, 'nx.nhso_adp_code', `FROM opitemrece ox JOIN nondrugitems nx ON nx.icode = ox.icode WHERE ox.vn = ov.vn AND nx.nhso_adp_code IN (${quoted(IRON_BAD_ADP)})`);
        const adpAllAgg = fsAgg(isPg, 'n4.nhso_adp_code', `FROM opitemrece o4 JOIN nondrugitems n4 ON n4.icode = o4.icode WHERE o4.vn = ov.vn AND n4.nhso_adp_code IS NOT NULL AND n4.nhso_adp_code <> ''`);

        const sql = `
            SELECT DISTINCT
                ov.vstdate                                AS "วันที่รับบริการ",
                ov.vsttime                                AS "เวลารับบริการ",
                ov.hn                                     AS "HN",
                ov.vn                                     AS "VN",
                CONCAT(pt.pname, pt.fname, ' ', pt.lname) AS "ชื่อ-นามสกุล",
                pt.cid                                    AS "เลขบัตรประชาชน",
                pt.sex                                    AS "เพศ",
                pt.birthday                               AS "วันเกิด",
                ${age}                                    AS "อายุ (ปี)",
                pt.nationality                            AS "สัญชาติ",
                ov.pttype                                 AS "รหัสสิทธิ",
                ptt.name                                  AS "ชื่อสิทธิ",
                ptt.hipdata_code                          AS "hipdata_code",
                ${yn(hasAnemia)}                          AS "f_anemia",
                ${yn(hasScreen)}                          AS "f_screen",
                ${yn(hasBad)}                             AS "f_bad",
                ${dxAnemiaAgg}                            AS "ICD10 D50x ที่พบ",
                ${dxAgg}                                  AS "ICD10 ในวิสิต",
                ${adpItemAgg}                             AS "รายการ ADP ${IRON_ADP}",
                ${badAdpAgg}                              AS "ADP ที่ต้องตัด",
                ${adpAllAgg}                              AS "ADP code ทั้งหมดในวิสิต"
            FROM ovst ov
            INNER JOIN patient pt ON pt.hn = ov.hn
            LEFT  JOIN pttype ptt ON ptt.pttype = ov.pttype
            WHERE ov.vstdate BETWEEN ${ph(1)} AND ${ph(2)}
                -- ลำดับที่ 1 ต้องมีค่าใช้จ่าย ADP 14001
                AND EXISTS (
                    SELECT 1 FROM opitemrece o
                    JOIN nondrugitems n ON n.icode = o.icode
                    WHERE o.vn = ov.vn AND n.nhso_adp_code = '${IRON_ADP}'
                )
                -- ลำดับที่ 2 คนไทยเท่านั้น
                AND pt.nationality = '99'
                -- ลำดับที่ 3 อายุ 13 - 45 ปี
                AND ${age} BETWEEN ${IRON_AGE_MIN} AND ${IRON_AGE_MAX}
                -- ลำดับที่ 4 สิทธิ UC / ข้าราชการ / ประกันสังคม
                AND ov.pttype IN (
                    SELECT p2.pttype FROM pttype p2
                    WHERE p2.hipdata_code IN ('UCS','WEL','OFC','SSS')
                )
            ORDER BY ov.vstdate, ov.vn
        `;

        const raw = fsNormRows(await fsRun(cfg, sql, [dateFrom, dateTo]));
        const Y = (v) => String(v === undefined || v === null ? 'N' : v).toUpperCase() === 'Y';

        const rows = raw.map(r => {
            const noAnemia = !Y(r.f_anemia);   // ลำดับที่ 5 ไม่ผ่าน
            const noScreen = !Y(r.f_screen);   // ลำดับที่ 6 ไม่ผ่าน
            const bad      = Y(r.f_bad);       // ลำดับที่ 7 ไม่ผ่าน

            const problems = [];
            if (noAnemia) problems.push('ต้องเพิ่มวินิจฉัย ' + IRON_ANEMIA.join('/'));
            if (noScreen) problems.push('ต้องเพิ่มวินิจฉัย ' + IRON_SCREEN);
            if (bad)      problems.push('ต้องตัด ADP ' + IRON_BAD_ADP.join('/'));

            const o = {
                'วันที่รับบริการ': r['วันที่รับบริการ'],
                'เวลารับบริการ': r['เวลารับบริการ'],
                'HN': r['HN'], 'VN': r['VN'],
                'สถานะ': problems.length ? 'ไม่สมบูรณ์' : 'สมบูรณ์',
                'สิ่งที่ต้องแก้': problems.join(' · ') || '-',
                'ต้องเพิ่ม': (noAnemia || noScreen) ? 'Y' : 'N',
                'ต้องตัด': bad ? 'Y' : 'N',
                'ชื่อ-นามสกุล': r['ชื่อ-นามสกุล'],
                'เลขบัตรประชาชน': r['เลขบัตรประชาชน'],
                'เพศ': r['เพศ'],
                'วันเกิด': r['วันเกิด'],
                'อายุ (ปี)': r['อายุ (ปี)'],
                'สัญชาติ': r['สัญชาติ'],
                'รหัสสิทธิ': r['รหัสสิทธิ'],
                'ชื่อสิทธิ': r['ชื่อสิทธิ'],
                'hipdata_code': r['hipdata_code']
            };
            o['วินิจฉัย ' + IRON_ANEMIA.join('/')] = noAnemia ? 'ไม่มี' : 'มี';
            o['_bad'] = [].concat(
                noAnemia ? ['วินิจฉัย ' + IRON_ANEMIA.join('/')] : [],
                noScreen ? ['วินิจฉัย ' + IRON_SCREEN] : [],
                bad ? ['ADP ที่ต้องตัด'] : []);
            o['วินิจฉัย ' + IRON_SCREEN] = noScreen ? 'ไม่มี' : 'มี';
            o['ICD10 D50x ที่พบ'] = r['ICD10 D50x ที่พบ'];
            o['ICD10 ในวิสิต'] = r['ICD10 ในวิสิต'];
            o['รายการ ADP ' + IRON_ADP] = r['รายการ ADP ' + IRON_ADP];
            o['ADP ที่ต้องตัด'] = r['ADP ที่ต้องตัด'];
            o['ADP code ทั้งหมดในวิสิต'] = r['ADP code ทั้งหมดในวิสิต'];
            return o;
        });

        const needFix    = rows.filter(r => r['ต้องเพิ่ม'] === 'Y').length;
        const needCut    = rows.filter(r => r['ต้องตัด'] === 'Y').length;
        const incomplete = rows.filter(r => r['สถานะ'] === 'ไม่สมบูรณ์').length;

        res.json({
            success: true, data: rows, count: rows.length,
            needFix, needCut, incomplete, cuttable: !!needCut,
            addCodes: { icd10: IRON_ANEMIA.concat(IRON_SCREEN) }, excludeCodes: IRON_BAD_ADP
        });
    } catch (error) {
        console.error('feeschedule-iron error:', error);
        res.json({ success: false, error: error.message });
    }
});


// ============================================================================
// ยาเม็ดเสริมธาตุเหล็ก — Tools เติมวินิจฉัยที่ขาดให้วิสิตที่เลือก
//   - ลำดับที่ 5  ถ้าไม่มี D500/D508/D509 เลย ลงรหัสที่เลือกจาก dropdown (anemiaCode)
//   - ลำดับที่ 6  ถ้าไม่มี Z130 ลงให้
// รหัส anemiaCode ต้องอยู่ใน IRON_ANEMIA เท่านั้น ไม่รับค่าอื่นจากหน้าเว็บ
// เช็คซ้ำก่อนเขียนทุกรายการ ถ้ามีอยู่แล้วจะข้าม
// ============================================================================
app.post('/api/add-feeschedule-iron-missing', async (req, res) => {
    const unlock = await fsLockWrites();   // ต่อคิว กันสองคำขอเขียนพร้อมกัน
    try {
        const { host, port, database, user, password, type, vns, anemiaCode } = req.body;
        if (!vns || !vns.length) return res.json({ success: false, error: 'ไม่มีรายการที่เลือก' });

        const pick = IRON_ANEMIA.indexOf(anemiaCode) !== -1 ? anemiaCode : IRON_ANEMIA[IRON_ANEMIA.length - 1];

        const isPg = type === 'postgresql';
        const P = (n) => isPg ? `$${n}` : '?';
        const inList = IRON_ANEMIA.map((_, i) => P(i + 2)).join(',');

        const conn = isPg
            ? new PgClient({ host, port: parseInt(port), database, user, password, connectionTimeoutMillis: 60000 })
            : await mysql.createConnection({ host, port, user, password, database, connectTimeout: 60000 });
        if (isPg) await conn.connect();

        const q = async (sql, params) => {
            if (isPg) return (await conn.query(sql, params || [])).rows;
            const [r] = await conn.execute(sql, params || []);
            return r;
        };

        let added = 0, skipped = 0, failed = 0;
        const errors = [], results = [];

        try {
            for (const vn of vns) {
                const detail = { vn: vn, added: [], skip: [], error: null };
                try {
                    const ov = await q(`SELECT vn, hn, vstdate, vsttime, doctor FROM ovst WHERE vn = ${P(1)}`, [vn]);
                    if (!ov.length) { detail.error = 'ไม่พบวิสิตนี้'; failed++; results.push(detail); continue; }
                    const v = ov[0];

                    const addDx = async (code) => {
                        if (isPg) {
                            const sid = (await q(`SELECT get_serialnumber('ovst_diag_id') AS sid`))[0].sid;
                            await q(
                                `INSERT INTO ovstdiag (ovst_diag_id, vn, icd10, hn, vstdate, vsttime, diagtype, doctor, staff, update_datetime)
                                 VALUES ($1,$2,$3,$4,$5,$6,'4',$7,$8,NOW())`,
                                [sid, v.vn, code, v.hn, v.vstdate, v.vsttime, v.doctor, v.doctor]);
                        } else {
                            await q(
                                `INSERT INTO ovstdiag (ovst_diag_id, vn, icd10, hn, vstdate, vsttime, diagtype, doctor, staff, update_datetime)
                                 VALUES (get_serialnumber('ovst_diag_id'),?,?,?,?,?,'4',?,?,NOW())`,
                                [v.vn, code, v.hn, v.vstdate, v.vsttime, v.doctor, v.doctor]);
                        }
                        detail.added.push(code);
                        added++;
                    };

                    // ---- ลำดับที่ 5: มีตัวใดตัวหนึ่งอยู่แล้วก็ข้าม ไม่ลงซ้ำ ----
                    const anemia = await q(
                        `SELECT 1 AS x FROM ovstdiag WHERE vn = ${P(1)} AND icd10 IN (${inList})`,
                        [vn].concat(IRON_ANEMIA));
                    if (anemia.length) { detail.skip.push('มีวินิจฉัย ' + IRON_ANEMIA.join('/') + ' อยู่แล้ว'); skipped++; }
                    else await addDx(pick);

                    // ---- ลำดับที่ 6: Z130 ----
                    const screen = await q(
                        `SELECT 1 AS x FROM ovstdiag WHERE vn = ${P(1)} AND icd10 = ${P(2)}`, [vn, IRON_SCREEN]);
                    if (screen.length) { detail.skip.push(IRON_SCREEN + ' มีอยู่แล้ว'); skipped++; }
                    else await addDx(IRON_SCREEN);
                } catch (e) {
                    detail.error = e.message; failed++; errors.push(`${vn}: ${e.message}`);
                }
                results.push(detail);
            }
        } finally {
            await conn.end();
        }

        res.json({ success: true, added, skipped, failed, errors, results, codes: [pick, IRON_SCREEN] });
    } catch (error) {
        console.error('add-feeschedule-iron-missing error:', error);
        res.json({ success: false, error: error.message });
    } finally {
        unlock();
    }
});


// ============================================================================
// Fee Schedule — กองทุนวางแผนครอบครัวและป้องกันการตั้งครรภ์ไม่พึงประสงค์
// ----------------------------------------------------------------------------
// ยึด "ค่าใช้จ่าย ADP Code" เป็นหลัก แล้วไล่ตรวจตามลำดับ
//   ลำดับ 1 : ต้องมี ADP ของเมนูนั้น            -> ใช้เป็นตัวกรองแถว (ไม่เข้าเกณฑ์ = ไม่แสดง)
//   ลำดับ 2 : ต้องมีวินิจฉัย (และ ICD9 ในส่วนที่ 2) -> เป็นผลตรวจ ถ้าขาด Tools เพิ่มให้ได้
//   ลำดับ 3 : ต้องไม่มี ADP ที่ห้าม              -> เป็นผลตรวจ ถ้ามี Tools ลบให้ได้
//
// เงื่อนไขร่วมของกองทุน (สิทธิ / สัญชาติ / เพศ / อายุ 15-49) ยังใช้เป็นตัวกรองฐาน
// เพดานจำนวนครั้ง-QTY แสดงเป็นคอลัมน์ ไม่นับเป็น "ไม่สมบูรณ์" เพราะ Tools แก้ให้ไม่ได้
//   "/ปี"   = ปีปฏิทินเดียวกับวันรับบริการ
//   "/3 ปี" = ย้อนหลัง 36 เดือนนับจากวันรับบริการ
// ============================================================================
const FP_SUBS = {
    // 'all' = หัวข้อกองทุน แสดงทุกคนที่เข้าเงื่อนไขร่วม ไม่กรองด้วย ADP และไม่ตรวจอะไรต่อ
    'all':               { name: 'ทั้งหมด (เงื่อนไขร่วม)',        adp: null,      icd10: null,     icd9: null,   limit: null,                                exclude: [] },
    'fp-combined':       { name: 'ยาเม็ดคุมกำเนิดชนิดฮอร์โมนรวม', adp: 'FP003_1', icd10: ['Z304'], icd9: null,   limit: { kind: 'qty',   max: 13, years: 1 }, exclude: ['WALKIN','ER-EXT'] },
    'fp-single':         { name: 'ยาเม็ดคุมกำเนิดชนิดฮอร์โมนเดี่ยว', adp: 'FP003_2', icd10: ['Z304'], icd9: null,   limit: null,                                exclude: ['WALKIN','ER-EXT'] },
    'fp-emergency':      { name: 'ยาเม็ดคุมกำเนิดฉุกเฉิน',        adp: 'FP003_3', icd10: ['Z304'], icd9: null,   limit: { kind: 'visit', max: 2,  years: 1 }, exclude: ['WALKIN','ER-EXT'] },
    'fp-injection':      { name: 'ยาฉีดคุมกำเนิด',                adp: 'FP003_4', icd10: ['Z304'], icd9: null,   limit: { kind: 'visit', max: 5,  years: 1 }, exclude: ['WALKIN','ER-EXT'] },
    'fp-iud':            { name: 'ใส่ห่วงอนามัย',                 adp: 'FP001',   icd10: ['Z301'], icd9: '697',  limit: { kind: 'visit', max: 1,  years: 1 }, exclude: ['WALKIN'] },
    'fp-implant-insert': { name: 'ฝังยาคุมกำเนิด',                adp: 'FP002_1', icd10: ['Z308'], icd9: '9923', limit: { kind: 'visit', max: 1,  years: 3 }, exclude: ['WALKIN','ER-EXT'] },
    'fp-implant-remove': { name: 'ถอดยาฝังคุมกำเนิด',             adp: 'FP002_2', icd10: ['Z308'], icd9: '9923', limit: { kind: 'visit', max: 1,  years: 3 }, exclude: ['WALKIN','ER-EXT'] }
};

app.post('/api/get-feeschedule-family-planning', async (req, res) => {
    try {
        const cfg = req.body;
        const { dateFrom, dateTo, sub } = cfg;
        const isPg = cfg.type === 'postgresql';
        const ph = (n) => isPg ? `$${n}` : '?';
        const age = fsAgeExpr(isPg);

        const S = FP_SUBS[sub];
        if (!S) return res.json({ success: false, error: 'ไม่รู้จักเมนูย่อย: ' + sub });

        const yn = (cond) => `CASE WHEN ${cond} THEN 'Y' ELSE 'N' END`;

        // ---- ลำดับ 1 : ADP ของเมนู (ตัวกรองฐาน) ----
        const adpCond = S.adp
            ? `AND EXISTS (SELECT 1 FROM opitemrece o JOIN nondrugitems n ON n.icode = o.icode
                           WHERE o.vn = ov.vn AND n.nhso_adp_code = '${S.adp}')`
            : '';

        // ---- ลำดับ 2 : วินิจฉัย / ICD9 (ผลตรวจ) ----
        // ICD9 นับได้ทั้ง doctor_operation.icd9 และ ovstdiag.icd10 เพื่อไม่ให้ขึ้น "ขาด" ผิด
        // ส่วน Tools เพิ่มข้อมูลจะเขียนลง ovstdiag เหมือนกองทุน HD
        const hasDx = S.icd10
            ? `EXISTS (SELECT 1 FROM ovstdiag dd WHERE dd.vn = ov.vn AND dd.icd10 IN (${S.icd10.map(c => `'${c}'`).join(',')}))`
            : `1=1`;
        const hasIcd9 = S.icd9
            ? `(EXISTS (SELECT 1 FROM doctor_operation dq WHERE dq.vn = ov.vn AND dq.icd9 = '${S.icd9}')
                OR EXISTS (SELECT 1 FROM ovstdiag dv WHERE dv.vn = ov.vn AND dv.icd10 = '${S.icd9}'))`
            : `1=1`;

        // ---- ลำดับ 3 : ADP ที่ห้ามมี (ผลตรวจ) ----
        const exList = (S.exclude || []).map(c => `'${c}'`).join(',');
        const hasBadAdp = exList
            ? `EXISTS (SELECT 1 FROM opitemrece ob JOIN nondrugitems nb ON nb.icode = ob.icode
                       WHERE ob.vn = ov.vn AND nb.nhso_adp_code IN (${exList}))`
            : `1=0`;

        // ---- เพดานจำนวน ----
        let periodCond = '', periodLabel = '';
        if (S.limit) {
            if (S.limit.years === 1) {
                periodCond = isPg
                    ? `EXTRACT(YEAR FROM oc.vstdate) = EXTRACT(YEAR FROM ov.vstdate)`
                    : `YEAR(oc.vstdate) = YEAR(ov.vstdate)`;
                periodLabel = 'ในปีปฏิทินเดียวกัน';
            } else {
                periodCond = isPg
                    ? `oc.vstdate BETWEEN (ov.vstdate - INTERVAL '${S.limit.years} years') AND ov.vstdate`
                    : `oc.vstdate BETWEEN DATE_SUB(ov.vstdate, INTERVAL ${S.limit.years} YEAR) AND ov.vstdate`;
                periodLabel = `ย้อนหลัง ${S.limit.years} ปี`;
            }
        }
        let usedExpr = `0`, usedLabel = 'สะสม', limitText = 'ไม่กำหนด', overExpr = `1=0`;
        if (S.limit) {
            const inner = `FROM opitemrece oc
                           JOIN nondrugitems nc ON nc.icode = oc.icode
                           WHERE oc.hn = ov.hn AND nc.nhso_adp_code = '${S.adp}' AND ${periodCond}`;
            if (S.limit.kind === 'qty') {
                usedExpr = `(SELECT COALESCE(SUM(oc.qty), 0) ${inner})`;
                usedLabel = `QTY สะสม ${periodLabel}`;
                limitText = `ไม่เกิน ${S.limit.max} ${periodLabel}`;
            } else {
                usedExpr = `(SELECT COUNT(DISTINCT oc.vn) ${inner})`;
                usedLabel = `จำนวนครั้งสะสม ${periodLabel}`;
                limitText = `ไม่เกิน ${S.limit.max} ครั้ง ${periodLabel}`;
            }
            overExpr = `${usedExpr} > ${S.limit.max}`;
        }

        const dxAgg = fsAgg(isPg, 'd2.icd10', `FROM ovstdiag d2 WHERE d2.vn = ov.vn`);
        const icd9Agg = fsAgg(isPg, 'dop.icd9', `FROM doctor_operation dop WHERE dop.vn = ov.vn AND dop.icd9 IS NOT NULL AND dop.icd9 <> ''`);
        const badAdpAgg = exList
            ? fsAgg(isPg, 'nx.nhso_adp_code', `FROM opitemrece ox JOIN nondrugitems nx ON nx.icode = ox.icode WHERE ox.vn = ov.vn AND nx.nhso_adp_code IN (${exList})`)
            : `''`;
        const adpItemAgg = S.adp
            ? fsAgg(isPg, 'n3.name', `FROM opitemrece o3 JOIN nondrugitems n3 ON n3.icode = o3.icode WHERE o3.vn = ov.vn AND n3.nhso_adp_code = '${S.adp}'`)
            : `''`;
        const adpQtyExpr = S.adp
            ? `(SELECT COALESCE(SUM(o6.qty), 0) FROM opitemrece o6 JOIN nondrugitems n6 ON n6.icode = o6.icode WHERE o6.vn = ov.vn AND n6.nhso_adp_code = '${S.adp}')`
            : `0`;
        const adpAllAgg = fsAgg(isPg, 'n4.nhso_adp_code', `FROM opitemrece o4 JOIN nondrugitems n4 ON n4.icode = o4.icode WHERE o4.vn = ov.vn AND n4.nhso_adp_code IS NOT NULL AND n4.nhso_adp_code <> ''`);

        const sql = `
            SELECT DISTINCT
                ov.vstdate                                AS "วันที่รับบริการ",
                ov.vsttime                                AS "เวลารับบริการ",
                ov.hn                                     AS "HN",
                ov.vn                                     AS "VN",
                CONCAT(pt.pname, pt.fname, ' ', pt.lname) AS "ชื่อ-นามสกุล",
                pt.cid                                    AS "เลขบัตรประชาชน",
                pt.sex                                    AS "เพศ",
                pt.birthday                               AS "วันเกิด",
                ${age}                                    AS "อายุ (ปี)",
                pt.nationality                            AS "สัญชาติ",
                ov.pttype                                 AS "รหัสสิทธิ",
                ptt.name                                  AS "ชื่อสิทธิ",
                ptt.hipdata_code                          AS "hipdata_code",
                ${adpItemAgg}                             AS "รายการ ADP ${S.adp || '-'}",
                ${adpQtyExpr}                             AS "QTY ในวิสิตนี้",
                ${usedExpr}                               AS "${usedLabel}",
                ${yn(overExpr)}                           AS "f_over",
                ${yn(hasDx)}                              AS "f_dx",
                ${yn(hasIcd9)}                            AS "f_icd9",
                ${yn(hasBadAdp)}                          AS "f_bad",
                ${dxAgg}                                  AS "ICD10 ในวิสิต",
                ${icd9Agg}                                AS "ICD9 ในวิสิต",
                ${badAdpAgg}                              AS "ADP ที่ต้องตัด",
                ${adpAllAgg}                              AS "ADP code ทั้งหมดในวิสิต"
            FROM ovst ov
            INNER JOIN patient pt ON pt.hn = ov.hn
            LEFT  JOIN pttype ptt ON ptt.pttype = ov.pttype
            WHERE ov.vstdate BETWEEN ${ph(1)} AND ${ph(2)}
                AND ov.pttype IN (SELECT p2.pttype FROM pttype p2 WHERE p2.hipdata_code IN ('UCS','WEL','OFC','SSS'))
                AND pt.nationality = '99'
                AND pt.sex = '2'
                AND ${age} BETWEEN 15 AND 49
                ${adpCond}
            ORDER BY ov.vstdate, ov.vn
        `;

        const raw = fsNormRows(await fsRun(cfg, sql, [dateFrom, dateTo]));

        const Y = (v) => String(v === undefined || v === null ? 'N' : v).toUpperCase() === 'Y';
        const rows = raw.map(r => {
            const missing = [];
            if (S.icd10 && !Y(r.f_dx))  missing.push('วินิจฉัย ' + S.icd10.join('/'));
            if (S.icd9  && !Y(r.f_icd9)) missing.push('ICD9 ' + S.icd9);
            const bad = Y(r.f_bad);

            const problems = missing.slice();
            if (bad) problems.push('ต้องตัด ' + (S.exclude || []).join('/'));

            const o = {
                'วันที่รับบริการ': r['วันที่รับบริการ'],
                'เวลารับบริการ': r['เวลารับบริการ'],
                'HN': r['HN'], 'VN': r['VN'],
                'ชื่อ-นามสกุล': r['ชื่อ-นามสกุล'],
                'เลขบัตรประชาชน': r['เลขบัตรประชาชน'],
                'เพศ': r['เพศ'], 'อายุ (ปี)': r['อายุ (ปี)'], 'สัญชาติ': r['สัญชาติ'],
                'รหัสสิทธิ': r['รหัสสิทธิ'], 'ชื่อสิทธิ': r['ชื่อสิทธิ'],
                'สถานะ': problems.length ? 'ไม่สมบูรณ์' : 'สมบูรณ์',
                'สิ่งที่ต้องแก้': problems.join(' · ') || '-',
                'ต้องเพิ่ม': missing.length ? 'Y' : 'N',
                'ต้องตัด': bad ? 'Y' : 'N'
            };
            o['รายการ ADP ' + (S.adp || '-')] = r['รายการ ADP ' + (S.adp || '-')];
            o['QTY ในวิสิตนี้'] = r['QTY ในวิสิตนี้'];
            o[usedLabel] = r[usedLabel];
            o['สถานะเพดาน'] = S.limit ? (Y(r.f_over) ? 'เกินเพดาน' : 'ปกติ') : '-';
            o['ICD10 ในวิสิต'] = r['ICD10 ในวิสิต'];
            o['ICD9 ในวิสิต'] = r['ICD9 ในวิสิต'];
            o['ADP ที่ต้องตัด'] = r['ADP ที่ต้องตัด'];
            o['ADP code ทั้งหมดในวิสิต'] = r['ADP code ทั้งหมดในวิสิต'];
            o['_bad'] = [].concat(
                missing.length ? ['ICD10 ในวิสิต', 'ICD9 ในวิสิต'] : [],
                bad ? ['ADP ที่ต้องตัด'] : []);
            return o;
        });

        const needFix = rows.filter(r => r['ต้องเพิ่ม'] === 'Y').length;
        const needCut = rows.filter(r => r['ต้องตัด'] === 'Y').length;
        const incomplete = rows.filter(r => r['สถานะ'] === 'ไม่สมบูรณ์').length;
        const over = rows.filter(r => r['สถานะเพดาน'] === 'เกินเพดาน').length;

        res.json({
            success: true, data: rows, count: rows.length,
            needFix, needCut, incomplete, overLimit: over, limitText,
            cuttable: !!needCut, addCodes: { icd10: S.icd10, icd9: S.icd9 }, excludeCodes: S.exclude || []
        });
    } catch (error) {
        console.error('feeschedule-family-planning error:', error);
        res.json({ success: false, error: error.message });
    }
});


// ============================================================================
// Fee Schedule — กองทุนส่งยาทางไปรษณีย์
// ----------------------------------------------------------------------------
//   1. คนไทยเท่านั้น patient.nationality = '99'
//   2. สิทธิ pttype.hipdata_code IN ('UCS','WEL')
//   3. ต้องมีวินิจฉัย (รหัสอะไรก็ได้ แต่ต้องไม่ว่าง)
//   4. ต้องมีค่าใช้จ่าย ADP = 'DRUGP'
//   5. ต้องไม่มี ADP 'WALKIN' / 'ER-EXT' — "ถ้ามีให้ตัดออก"
//
// ข้อ 5 ไม่ได้ใช้กรองแถวทิ้ง เพราะถ้ากรองออกก็จะไม่เห็นและตัดไม่ได้
// จึงดึงมาทั้งหมดแล้วติดธงไว้ ให้เลือกตัดผ่าน /api/delete-feeschedule-walkin-items
// ============================================================================
app.post('/api/get-feeschedule-postal', async (req, res) => {
    try {
        const cfg = req.body;
        const { dateFrom, dateTo, excludeCancerClinic } = cfg;
        const isPg = cfg.type === 'postgresql';
        const ph = (n) => isPg ? `$${n}` : '?';

        const dxAgg = fsAgg(isPg, 'd2.icd10', `FROM ovstdiag d2 WHERE d2.vn = ov.vn AND d2.icd10 IS NOT NULL AND d2.icd10 <> ''`);
        const adpItemAgg = fsAgg(isPg, 'n3.name', `FROM opitemrece o3 JOIN nondrugitems n3 ON n3.icode = o3.icode WHERE o3.vn = ov.vn AND n3.nhso_adp_code = 'DRUGP'`);
        const walkinAgg = fsAgg(isPg, 'n5.nhso_adp_code', `FROM opitemrece o5 JOIN nondrugitems n5 ON n5.icode = o5.icode WHERE o5.vn = ov.vn AND n5.nhso_adp_code IN ('WALKIN','ER-EXT')`);
        const adpAllAgg = fsAgg(isPg, 'n4.nhso_adp_code', `FROM opitemrece o4 JOIN nondrugitems n4 ON n4.icode = o4.icode WHERE o4.vn = ov.vn AND n4.nhso_adp_code IS NOT NULL AND n4.nhso_adp_code <> ''`);

        const hasWalkin = `EXISTS (
                    SELECT 1 FROM opitemrece o2
                    JOIN nondrugitems n2 ON n2.icode = o2.icode
                    WHERE o2.vn = ov.vn AND n2.nhso_adp_code IN ('WALKIN','ER-EXT')
                )`;

        // ตัดคนไข้มะเร็ง: HN ที่เป็นสมาชิกคลินิกซึ่ง clinic.hosxp_clinic_type_id = 7
        const cancerClinicCond = excludeCancerClinic
            ? `AND NOT EXISTS (
                    SELECT 1 FROM clinicmember cm
                    JOIN clinic cl ON cl.clinic = cm.clinic
                    WHERE cm.hn = ov.hn AND cl.hosxp_clinic_type_id = '7'
                )`
            : '';

        const sql = `
            SELECT DISTINCT
                ov.vstdate                                AS "วันที่รับบริการ",
                ov.vsttime                                AS "เวลารับบริการ",
                ov.hn                                     AS "HN",
                ov.vn                                     AS "VN",
                CONCAT(pt.pname, pt.fname, ' ', pt.lname) AS "ชื่อ-นามสกุล",
                pt.cid                                    AS "เลขบัตรประชาชน",
                pt.nationality                            AS "สัญชาติ",
                ov.pttype                                 AS "รหัสสิทธิ",
                ptt.name                                  AS "ชื่อสิทธิ",
                ptt.hipdata_code                          AS "hipdata_code",
                ${dxAgg}                                  AS "ICD10 ในวิสิต",
                ${adpItemAgg}                             AS "รายการ ADP DRUGP",
                ${walkinAgg}                              AS "WALKIN/ER-EXT ที่พบ",
                CASE WHEN ${hasWalkin} THEN 'ต้องตัดออก' ELSE 'ผ่าน' END AS "สถานะ",
                ${adpAllAgg}                              AS "ADP code ทั้งหมดในวิสิต"
            FROM ovst ov
            INNER JOIN patient pt ON pt.hn = ov.hn
            LEFT  JOIN pttype ptt ON ptt.pttype = ov.pttype
            WHERE ov.vstdate BETWEEN ${ph(1)} AND ${ph(2)}
                AND ov.pttype IN (SELECT p2.pttype FROM pttype p2 WHERE p2.hipdata_code IN ('UCS','WEL'))
                AND pt.nationality = '99'
                AND EXISTS (
                    SELECT 1 FROM ovstdiag d
                    WHERE d.vn = ov.vn AND d.icd10 IS NOT NULL AND d.icd10 <> ''
                )
                AND EXISTS (
                    SELECT 1 FROM opitemrece o
                    JOIN nondrugitems n ON n.icode = o.icode
                    WHERE o.vn = ov.vn AND n.nhso_adp_code = 'DRUGP'
                )
                ${cancerClinicCond}
            ORDER BY ov.vstdate, ov.vn
        `;

        const rows = fsNormRows(await fsRun(cfg, sql, [dateFrom, dateTo]));
        const needCut = rows.filter(r => r['สถานะ'] === 'ต้องตัดออก').length;
        res.json({ success: true, data: rows, count: rows.length, needCut, cuttable: true });
    } catch (error) {
        console.error('feeschedule-postal error:', error);
        res.json({ success: false, error: error.message });
    }
});

// ลบรายการ ADP WALKIN / ER-EXT ออกจาก opitemrece ตาม VN ที่เลือก
// (ใช้กับเมนูกองทุนส่งยาทางไปรษณีย์ — ข้อ "ถ้ามีให้ตัดออก")
app.post('/api/delete-feeschedule-walkin-items', async (req, res) => {
    try {
        const { host, port, database, user, password, type, vns } = req.body;
        if (!vns || !vns.length) return res.json({ success: false, error: 'ไม่มีรายการที่เลือก' });

        const SUB = `SELECT icode FROM nondrugitems WHERE nhso_adp_code IN ('WALKIN','ER-EXT')`;
        let deleted = 0, removedRows = 0, failed = 0;
        const errors = [];

        if (type === 'postgresql') {
            const client = new PgClient({ host, port: parseInt(port), database, user, password, connectionTimeoutMillis: 30000 });
            await client.connect();
            for (const vn of vns) {
                try {
                    const r = await client.query(`DELETE FROM opitemrece WHERE vn = $1 AND icode IN (${SUB})`, [vn]);
                    deleted++; removedRows += (r.rowCount || 0);
                } catch (e) { failed++; errors.push(`${vn}: ${e.message}`); }
            }
            await client.end();
        } else {
            const connection = await mysql.createConnection({ host, port, user, password, database, connectTimeout: 30000 });
            for (const vn of vns) {
                try {
                    const [r] = await connection.execute(`DELETE FROM opitemrece WHERE vn = ? AND icode IN (${SUB})`, [vn]);
                    deleted++; removedRows += (r.affectedRows || 0);
                } catch (e) { failed++; errors.push(`${vn}: ${e.message}`); }
            }
            await connection.end();
        }

        res.json({ success: true, deleted, removedRows, failed, errors });
    } catch (error) {
        console.error('delete-feeschedule-walkin-items error:', error);
        res.json({ success: false, error: error.message });
    }
});


// ============================================================================
// Fee Schedule — กองทุน ER คุณภาพ (สำหรับ รพ. ที่ไม่ได้ใช้หน้าจอ ER)
// ============================================================================

// ---- ตั้งค่าเฉพาะกองทุนนี้ เก็บเป็นไฟล์ข้าง server.exe เหมือน preex-token.json ----
const ER_SETTINGS_FILE = path.join(staticDir, 'preex-er-settings.json');

function readErSettings() {
    try {
        const o = JSON.parse(fs.readFileSync(ER_SETTINGS_FILE, 'utf8'));
        return { mouHospcodes: Array.isArray(o.mouHospcodes) ? o.mouHospcodes : [] };
    } catch (e) {
        return { mouHospcodes: [] };
    }
}

app.post('/api/er-settings-get', (req, res) => {
    res.json({ success: true, ...readErSettings() });
});

// รายชื่อสถานพยาบาลนอกสังกัด สธ. ที่ทำ MOU กับ รพ.
app.post('/api/er-settings-save', (req, res) => {
    try {
        const list = (req.body && req.body.mouHospcodes) || [];
        const clean = list
            .map(x => String(x).trim())
            .filter(x => x.length > 0 && /^[A-Za-z0-9_-]+$/.test(x));
        fs.writeFileSync(ER_SETTINGS_FILE, JSON.stringify({ mouHospcodes: clean }, null, 2), 'utf8');
        res.json({ success: true, mouHospcodes: clean });
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

// ---- dropdown ห้องตรวจ ----
app.post('/api/get-kskdepartment-list', async (req, res) => {
    try {
        const rows = await fsRun(req.body, `
            SELECT depcode, department
            FROM kskdepartment
            WHERE depcode_active = 'Y'
            ORDER BY department
        `, []);
        res.json({ success: true, data: rows, count: rows.length });
    } catch (error) {
        console.error('kskdepartment-list error:', error);
        res.json({ success: false, error: error.message });
    }
});

// ---- หาว่า emtype เก็บอยู่ตารางไหน (แต่ละรุ่นไม่เหมือนกัน) ----
// คืน { table } ที่มีทั้งคอลัมน์ emtype และ vn หรือ null ถ้าไม่เจอ
async function fsFindEmtypeSource(cfg) {
    const isPg = cfg.type === 'postgresql';
    const sql = isPg
        ? `SELECT table_name, column_name FROM information_schema.columns
           WHERE table_schema NOT IN ('pg_catalog','information_schema')
             AND column_name IN ('emtype','vn')`
        : `SELECT table_name, column_name FROM information_schema.columns
           WHERE table_schema = ? AND column_name IN ('emtype','vn')`;
    const rows = await fsRun(cfg, sql, isPg ? [] : [cfg.database]);

    const tables = {};
    rows.forEach(r => {
        const t = String(r.table_name || r.TABLE_NAME).toLowerCase();
        const c = String(r.column_name || r.COLUMN_NAME).toLowerCase();
        (tables[t] = tables[t] || []).push(c);
    });
    const hits = Object.keys(tables).filter(t => tables[t].includes('emtype') && tables[t].includes('vn'));
    // เดาลำดับความน่าจะเป็น: ตารางอุบัติเหตุ/ER มาก่อน
    const preferred = ['ovst_accident', 'er_regist', 'er_pt_type', 'ovstaccident'];
    const pick = preferred.find(t => hits.includes(t)) || hits[0] || null;
    return { table: pick, candidates: hits };
}

// ----------------------------------------------------------------------------
// กองทุน ER คุณภาพ — กรองก่อน แล้วไล่ตรวจตามลำดับ
//   กรอง   : ห้องตรวจที่เลือก + ช่วงเวลา (วันทำการ / วันหยุด) + สิทธิ UCS,WEL
//   ลำดับ 1 : ความเร่งด่วน pt_priority.hos_guid = 4 หรือ 5          -> ตัวกรอง
//   ลำดับ 2 : visit_pttype.hospmain = opdconfig.hospitalcode
//             หรืออยู่ใน hospcode จังหวัดเดียวกันที่ hospital_type_id 5/6/7
//             หรืออยู่ในรายชื่อ รพ. MOU ที่ตั้งค่าไว้               -> ตัวกรอง
//   ลำดับ 3 : ต้องมี ADP ER-EXT   ถ้าไม่มี Tools เติมให้ได้          -> ผลตรวจ
//   ลำดับ 4 : ต้องไม่มี ADP WALKIN ถ้ามี Tools ลบให้ได้              -> ผลตรวจ
// emtype / UCAE เป็นฟิลด์ที่จะออกแฟ้ม AER จึงแสดงเป็นคอลัมน์ ไม่ใช่เงื่อนไขกรอง
// ----------------------------------------------------------------------------
app.post('/api/get-feeschedule-er-quality', async (req, res) => {
    try {
        const cfg = req.body;
        const { dateFrom, dateTo, departments } = cfg;
        const isPg = cfg.type === 'postgresql';
        const ph = (n) => isPg ? `$${n}` : '?';

        if (!departments || !departments.length) {
            return res.json({ success: false, error: 'กรุณาเลือกห้องตรวจอย่างน้อย 1 ห้อง' });
        }

        const t = (v, dflt) => {
            const s = String(v || dflt).trim();
            return /^\d{2}:\d{2}$/.test(s) ? s + ':00' : (/^\d{2}:\d{2}:\d{2}$/.test(s) ? s : dflt + ':00');
        };
        const wdFrom = t(cfg.weekdayFrom, '00:00'), wdTo = t(cfg.weekdayTo, '23:59');
        const hdFrom = t(cfg.holidayFrom, '00:00'), hdTo = t(cfg.holidayTo, '23:59');

        // ช่วงเวลานอกเวลาราชการมักคร่อมเที่ยงคืน BETWEEN จะได้ผลว่าง ต้องแตกเป็น >= OR <=
        const timeCond = (col, from, to) => (from <= to)
            ? `${col} BETWEEN '${from}' AND '${to}'`
            : `(${col} >= '${from}' OR ${col} <= '${to}')`;

        const depList = departments.map(d => `'${String(d).replace(/'/g, "''")}'`).join(',');
        const mou = readErSettings().mouHospcodes;
        const mouCond = mou.length ? ` OR vp2.hospmain IN (${mou.map(h => `'${h}'`).join(',')})` : '';

        const isHoliday = `EXISTS (SELECT 1 FROM holiday h WHERE h.holiday_date = ov.vstdate)`;
        const isWeekday = isPg
            ? `EXTRACT(DOW FROM ov.vstdate) BETWEEN 1 AND 5`
            : `DAYOFWEEK(ov.vstdate) BETWEEN 2 AND 6`;
        const dayTypeExpr = `CASE WHEN ${isWeekday} AND NOT ${isHoliday} THEN 'วันทำการ (จ.-ศ.)' ELSE 'วันหยุด/นักขัตฤกษ์' END`;

        const yn = (cond) => `CASE WHEN ${cond} THEN 'Y' ELSE 'N' END`;
        const hasErExt = `EXISTS (SELECT 1 FROM opitemrece oe JOIN nondrugitems ne ON ne.icode = oe.icode
                                  WHERE oe.vn = ov.vn AND ne.nhso_adp_code = 'ER-EXT')`;
        const hasWalkin = `EXISTS (SELECT 1 FROM opitemrece ow JOIN nondrugitems nw ON nw.icode = ow.icode
                                   WHERE ow.vn = ov.vn AND nw.nhso_adp_code = 'WALKIN')`;
        // มะเร็ง C00-C97 / D00-D09 / D37-D48 — แสดงเป็นข้อมูลประกอบ ไม่ได้ใช้กรอง
        const hasCancer = `EXISTS (
                SELECT 1 FROM ovstdiag dc
                WHERE dc.vn = ov.vn AND (
                    (LEFT(dc.icd10,1) = 'C' AND SUBSTRING(dc.icd10,2,2) BETWEEN '00' AND '97')
                    OR (LEFT(dc.icd10,1) = 'D' AND SUBSTRING(dc.icd10,2,2) BETWEEN '00' AND '09')
                    OR (LEFT(dc.icd10,1) = 'D' AND SUBSTRING(dc.icd10,2,2) BETWEEN '37' AND '48')
                ))`;

        const em = await fsFindEmtypeSource(cfg);
        const emtypeExpr = em.table
            ? `COALESCE(NULLIF((SELECT em.emtype FROM ${em.table} em WHERE em.vn = ov.vn LIMIT 1), ''), '3')`
            : `'3'`;

        const dxAgg = fsAgg(isPg, 'd2.icd10', `FROM ovstdiag d2 WHERE d2.vn = ov.vn`);
        const adpAllAgg = fsAgg(isPg, 'n4.nhso_adp_code', `FROM opitemrece o4 JOIN nondrugitems n4 ON n4.icode = o4.icode WHERE o4.vn = ov.vn AND n4.nhso_adp_code IS NOT NULL AND n4.nhso_adp_code <> ''`);

        const sql = `
            SELECT DISTINCT
                ov.vstdate                                AS "วันที่รับบริการ",
                ov.vsttime                                AS "เวลารับบริการ",
                ${dayTypeExpr}                            AS "ประเภทวัน",
                ov.hn                                     AS "HN",
                ov.vn                                     AS "VN",
                CONCAT(pt.pname, pt.fname, ' ', pt.lname) AS "ชื่อ-นามสกุล",
                pt.cid                                    AS "เลขบัตรประชาชน",
                ov.main_dep                               AS "รหัสห้องตรวจ",
                ksk.department                            AS "ห้องตรวจ",
                ov.pttype                                 AS "รหัสสิทธิ",
                ptt.name                                  AS "ชื่อสิทธิ",
                ptt.hipdata_code                          AS "hipdata_code",
                vp.hospmain                               AS "hospmain",
                pp.hos_guid                               AS "ความเร่งด่วน",
                ${emtypeExpr}                             AS "emtype (AER)",
                'N'                                       AS "UCAE (AER)",
                ${yn(hasErExt)}                           AS "f_erext",
                ${yn(hasWalkin)}                          AS "f_walkin",
                ${yn(hasCancer)}                          AS "f_cancer",
                ${dxAgg}                                  AS "ICD10 ในวิสิต",
                ${adpAllAgg}                              AS "ADP code ทั้งหมดในวิสิต"
            FROM ovst ov
            INNER JOIN patient pt ON pt.hn = ov.hn
            LEFT  JOIN pttype ptt ON ptt.pttype = ov.pttype
            LEFT  JOIN kskdepartment ksk ON ksk.depcode = ov.main_dep
            LEFT  JOIN visit_pttype vp ON vp.vn = ov.vn
            LEFT  JOIN pt_priority pp ON pp.id = ov.pt_priority
            WHERE ov.vstdate BETWEEN ${ph(1)} AND ${ph(2)}
                AND ov.main_dep IN (${depList})
                AND ov.pttype IN (SELECT p2.pttype FROM pttype p2 WHERE p2.hipdata_code IN ('UCS','WEL'))
                AND (
                    ( ${isWeekday} AND NOT ${isHoliday} AND ${timeCond('ov.vsttime', wdFrom, wdTo)} )
                    OR
                    ( ( NOT (${isWeekday}) OR ${isHoliday} ) AND ${timeCond('ov.vsttime', hdFrom, hdTo)} )
                )
                -- ลำดับ 1
                AND EXISTS (
                    SELECT 1 FROM pt_priority pp2
                    WHERE pp2.id = ov.pt_priority AND pp2.hos_guid IN ('4','5')
                )
                -- ลำดับ 2
                AND EXISTS (
                    SELECT 1 FROM visit_pttype vp2
                    WHERE vp2.vn = ov.vn AND (
                        vp2.hospmain = (SELECT oc.hospitalcode FROM opdconfig oc LIMIT 1)
                        OR vp2.hospmain IN (
                            SELECT hc.hospcode FROM hospcode hc
                            WHERE hc.chwpart = (
                                SELECT hc2.chwpart FROM hospcode hc2
                                WHERE hc2.hospcode = (SELECT oc2.hospitalcode FROM opdconfig oc2 LIMIT 1)
                                LIMIT 1
                            )
                            AND hc.hospital_type_id IN ('5','6','7')
                        )
                        ${mouCond}
                    )
                )
                -- ตัดผู้ป่วยมะเร็งออก (C00-C97, D00-D09, D37-D48)
                AND NOT ${hasCancer}
            ORDER BY ov.vstdate, ov.vsttime, ov.vn
        `;

        const raw = fsNormRows(await fsRun(cfg, sql, [dateFrom, dateTo]));

        const Y = (v) => String(v === undefined || v === null ? 'N' : v).toUpperCase() === 'Y';
        const rows = raw.map(r => {
            const noErExt = !Y(r.f_erext);
            const hasWk = Y(r.f_walkin);
            const problems = [];
            if (noErExt) problems.push('ไม่มี ADP ER-EXT');
            if (hasWk) problems.push('ต้องตัด ADP WALKIN');

            const o = {
                'วันที่รับบริการ': r['วันที่รับบริการ'],
                'เวลารับบริการ': r['เวลารับบริการ'],
                'ประเภทวัน': r['ประเภทวัน'],
                'HN': r['HN'], 'VN': r['VN'],
                'ชื่อ-นามสกุล': r['ชื่อ-นามสกุล'],
                'เลขบัตรประชาชน': r['เลขบัตรประชาชน'],
                'รหัสห้องตรวจ': r['รหัสห้องตรวจ'],
                'ห้องตรวจ': r['ห้องตรวจ'],
                'รหัสสิทธิ': r['รหัสสิทธิ'],
                'ชื่อสิทธิ': r['ชื่อสิทธิ'],
                'hipdata_code': r['hipdata_code'],
                'hospmain': r['hospmain'],
                'ความเร่งด่วน': r['ความเร่งด่วน'],
                'สถานะ': problems.length ? 'ไม่สมบูรณ์' : 'สมบูรณ์',
                'สิ่งที่ต้องแก้': problems.join(' · ') || '-',
                'ต้องเพิ่ม': noErExt ? 'Y' : 'N',
                'ต้องตัด': hasWk ? 'Y' : 'N',
                'emtype (AER)': r['emtype (AER)'],
                'UCAE (AER)': r['UCAE (AER)'],
                'มีวินิจฉัยมะเร็ง': Y(r.f_cancer) ? 'มี' : '-',
                'ICD10 ในวิสิต': r['ICD10 ในวิสิต'],
                'ADP code ทั้งหมดในวิสิต': r['ADP code ทั้งหมดในวิสิต']
            };
            return o;
        });

        const needFix = rows.filter(r => r['ต้องเพิ่ม'] === 'Y').length;
        const needCut = rows.filter(r => r['ต้องตัด'] === 'Y').length;
        const incomplete = rows.filter(r => r['สถานะ'] === 'ไม่สมบูรณ์').length;

        res.json({
            success: true, data: rows, count: rows.length,
            needFix, needCut, incomplete, cuttable: !!needCut,
            emtypeSource: em.table ? (em.table + '.emtype') : 'ไม่พบในฐานข้อมูล — ออกเป็น 3 ทุกแถว',
            mouCount: mou.length
        });
    } catch (error) {
        console.error('feeschedule-er-quality error:', error);
        res.json({ success: false, error: error.message });
    }
});


// ============================================================================
// Fee Schedule — กองทุน OP Anywhere ในจังหวัด (นอก CUPs)
// ----------------------------------------------------------------------------
//   1. คนไทยเท่านั้น patient.nationality = '99'
//   2. สิทธิ pttype.hipdata_code IN ('UCS','WEL')
//   3. hospmain หรือ hospsub ของสิทธิ อยู่จังหวัดเดียวกับ รพ. ที่รับบริการ
//      (เทียบ hospcode.chwpart กับ chwpart ของ opdconfig.hospitalcode)
//   4. ความเร่งด่วน: pt_priority.hos_guid IN ('1','2','3','4')
//   5. ต้องมี ADP 'WALKIN' ที่ nhso_adp_type_id = '5'
//   6. ต้องไม่มี Project code อื่นที่ ADP type = 5 — "ถ้ามีให้ Tools ลบออก"
//      จึงไม่กรองทิ้ง แต่ติดธงไว้ให้เลือกลบ เหมือนกองทุนส่งยาทางไปรษณีย์
// ============================================================================
app.post('/api/get-feeschedule-opa-in-province', async (req, res) => {
    try {
        const cfg = req.body;
        const { dateFrom, dateTo, pttypes } = cfg;
        const isPg = cfg.type === 'postgresql';
        const ph = (n) => isPg ? `$${n}` : '?';

        // จังหวัดของ รพ. ตัวเอง
        const ourChw = `(SELECT hc2.chwpart FROM hospcode hc2
                         WHERE hc2.hospcode = (SELECT oc2.hospitalcode FROM opdconfig oc2 LIMIT 1) LIMIT 1)`;
        const inProvince = `(SELECT hc.hospcode FROM hospcode hc WHERE hc.chwpart = ${ourChw})`;

        // Project code ที่ ADP type = 5 แต่ไม่ใช่ WALKIN
        const otherType5 = `
                    SELECT 1 FROM opitemrece ox
                    JOIN nondrugitems nx ON nx.icode = ox.icode
                    WHERE ox.vn = ov.vn
                      AND nx.nhso_adp_type_id = '5'
                      AND (nx.nhso_adp_code IS NULL OR nx.nhso_adp_code <> 'WALKIN')`;

        const dxAgg = fsAgg(isPg, 'd2.icd10', `FROM ovstdiag d2 WHERE d2.vn = ov.vn`);
        const walkinItemAgg = fsAgg(isPg, 'n3.name', `FROM opitemrece o3 JOIN nondrugitems n3 ON n3.icode = o3.icode WHERE o3.vn = ov.vn AND n3.nhso_adp_code = 'WALKIN' AND n3.nhso_adp_type_id = '5'`);
        const otherType5Agg = fsAgg(isPg, 'n5.nhso_adp_code', `FROM opitemrece o5 JOIN nondrugitems n5 ON n5.icode = o5.icode WHERE o5.vn = ov.vn AND n5.nhso_adp_type_id = '5' AND (n5.nhso_adp_code IS NULL OR n5.nhso_adp_code <> 'WALKIN')`);
        const adpAllAgg = fsAgg(isPg, 'n4.nhso_adp_code', `FROM opitemrece o4 JOIN nondrugitems n4 ON n4.icode = o4.icode WHERE o4.vn = ov.vn AND n4.nhso_adp_code IS NOT NULL AND n4.nhso_adp_code <> ''`);

        // กรองตามสิทธิที่เลือกจากแผงตั้งค่า ถ้าไม่ได้เลือกใช้ค่าเริ่มต้น UCS/WEL
        const pttypeCond = (pttypes && pttypes.length)
            ? `AND ov.pttype IN (${pttypes.map(x => `'${String(x).replace(/'/g, "''")}'`).join(',')})`
            : `AND ov.pttype IN (SELECT p2.pttype FROM pttype p2 WHERE p2.hipdata_code IN ('UCS','WEL'))`;

        const sql = `
            SELECT DISTINCT
                ov.vstdate                                AS "วันที่รับบริการ",
                ov.vsttime                                AS "เวลารับบริการ",
                ov.hn                                     AS "HN",
                ov.vn                                     AS "VN",
                CONCAT(pt.pname, pt.fname, ' ', pt.lname) AS "ชื่อ-นามสกุล",
                pt.cid                                    AS "เลขบัตรประชาชน",
                pt.nationality                            AS "สัญชาติ",
                ov.pttype                                 AS "รหัสสิทธิ",
                ptt.name                                  AS "ชื่อสิทธิ",
                ptt.hipdata_code                          AS "hipdata_code",
                vp.hospmain                               AS "hospmain",
                vp.hospsub                                AS "hospsub",
                pp.hos_guid                               AS "ความเร่งด่วน",
                ${dxAgg}                                  AS "ICD10 ในวิสิต",
                ${walkinItemAgg}                          AS "รายการ WALKIN (type 5)",
                ${otherType5Agg}                          AS "Project code type 5 อื่น",
                CASE WHEN EXISTS (${otherType5}) THEN 'ต้องตัดออก' ELSE 'ผ่าน' END AS "สถานะ",
                ${adpAllAgg}                              AS "ADP code ทั้งหมดในวิสิต"
            FROM ovst ov
            INNER JOIN patient pt ON pt.hn = ov.hn
            LEFT  JOIN pttype ptt ON ptt.pttype = ov.pttype
            LEFT  JOIN visit_pttype vp ON vp.vn = ov.vn
            LEFT  JOIN pt_priority pp ON pp.id = ov.pt_priority
            WHERE ov.vstdate BETWEEN ${ph(1)} AND ${ph(2)}
                AND pt.nationality = '99'
                ${pttypeCond}
                -- hospmain หรือ hospsub อยู่ในจังหวัดเดียวกับ รพ. ที่รับบริการ
                AND EXISTS (
                    SELECT 1 FROM visit_pttype vp2
                    WHERE vp2.vn = ov.vn
                      AND ( vp2.hospmain IN ${inProvince} OR vp2.hospsub IN ${inProvince} )
                )
                -- ความเร่งด่วน
                AND EXISTS (
                    SELECT 1 FROM pt_priority pp2
                    WHERE pp2.id = ov.pt_priority AND pp2.hos_guid IN ('1','2','3','4')
                )
                -- ต้องมี WALKIN ที่ ADP type = 5
                AND EXISTS (
                    SELECT 1 FROM opitemrece o
                    JOIN nondrugitems n ON n.icode = o.icode
                    WHERE o.vn = ov.vn AND n.nhso_adp_code = 'WALKIN' AND n.nhso_adp_type_id = '5'
                )
            ORDER BY ov.vstdate, ov.vn
        `;

        const rows = fsNormRows(await fsRun(cfg, sql, [dateFrom, dateTo]));
        const needCut = rows.filter(r => r['สถานะ'] === 'ต้องตัดออก').length;
        res.json({ success: true, data: rows, count: rows.length, needCut, cuttable: true });
    } catch (error) {
        console.error('feeschedule-opa-in-province error:', error);
        res.json({ success: false, error: error.message });
    }
});

// ลบรายการ Project code ที่ ADP type = 5 ซึ่งไม่ใช่ WALKIN ออกจาก opitemrece
app.post('/api/delete-feeschedule-adp-type5-items', async (req, res) => {
    try {
        const { host, port, database, user, password, type, vns } = req.body;
        if (!vns || !vns.length) return res.json({ success: false, error: 'ไม่มีรายการที่เลือก' });

        const SUB = `SELECT icode FROM nondrugitems
                     WHERE nhso_adp_type_id = '5'
                       AND (nhso_adp_code IS NULL OR nhso_adp_code <> 'WALKIN')`;
        let deleted = 0, removedRows = 0, failed = 0;
        const errors = [];

        if (type === 'postgresql') {
            const client = new PgClient({ host, port: parseInt(port), database, user, password, connectionTimeoutMillis: 30000 });
            await client.connect();
            for (const vn of vns) {
                try {
                    const r = await client.query(`DELETE FROM opitemrece WHERE vn = $1 AND icode IN (${SUB})`, [vn]);
                    deleted++; removedRows += (r.rowCount || 0);
                } catch (e) { failed++; errors.push(`${vn}: ${e.message}`); }
            }
            await client.end();
        } else {
            const connection = await mysql.createConnection({ host, port, user, password, database, connectTimeout: 30000 });
            for (const vn of vns) {
                try {
                    const [r] = await connection.execute(`DELETE FROM opitemrece WHERE vn = ? AND icode IN (${SUB})`, [vn]);
                    deleted++; removedRows += (r.affectedRows || 0);
                } catch (e) { failed++; errors.push(`${vn}: ${e.message}`); }
            }
            await connection.end();
        }

        res.json({ success: true, deleted, removedRows, failed, errors });
    } catch (error) {
        console.error('delete-feeschedule-adp-type5-items error:', error);
        res.json({ success: false, error: error.message });
    }
});


// ============================================================================
// Fee Schedule — กองทุน OP Anywhere ต่างจังหวัด
// ----------------------------------------------------------------------------
//   1. คนไทยเท่านั้น patient.nationality = '99'
//   2. สิทธิ pttype.hipdata_code IN ('UCS','WEL')
//   3. hospmain/hospsub ของสิทธิ ไม่ได้อยู่จังหวัดเดียวกับ รพ. ที่รับบริการ
//      เขียนเป็น NOT EXISTS ของเงื่อนไขเมนู "ในจังหวัด" ตรง ๆ สองเมนูจึงไม่ทับกัน
//      (ถ้าใช้ hospmain นอกจังหวัด OR hospsub นอกจังหวัด วิสิตเดียวอาจโผล่ทั้งสองเมนู)
//   4. ต้องมี ADP 'WALKIN' ที่ nhso_adp_type_id = '5'
//   5. ต้องไม่มี Project code อื่นที่ ADP type = 5 — "ถ้ามีให้ Tools ลบออก"
// ============================================================================
app.post('/api/get-feeschedule-opa-out-province', async (req, res) => {
    try {
        const cfg = req.body;
        const { dateFrom, dateTo } = cfg;
        const isPg = cfg.type === 'postgresql';
        const ph = (n) => isPg ? `$${n}` : '?';

        const ourChw = `(SELECT hc2.chwpart FROM hospcode hc2
                         WHERE hc2.hospcode = (SELECT oc2.hospitalcode FROM opdconfig oc2 LIMIT 1) LIMIT 1)`;
        const inProvince = `(SELECT hc.hospcode FROM hospcode hc WHERE hc.chwpart = ${ourChw})`;

        const otherType5 = `
                    SELECT 1 FROM opitemrece ox
                    JOIN nondrugitems nx ON nx.icode = ox.icode
                    WHERE ox.vn = ov.vn
                      AND nx.nhso_adp_type_id = '5'
                      AND (nx.nhso_adp_code IS NULL OR nx.nhso_adp_code <> 'WALKIN')`;

        const dxAgg = fsAgg(isPg, 'd2.icd10', `FROM ovstdiag d2 WHERE d2.vn = ov.vn`);
        const walkinItemAgg = fsAgg(isPg, 'n3.name', `FROM opitemrece o3 JOIN nondrugitems n3 ON n3.icode = o3.icode WHERE o3.vn = ov.vn AND n3.nhso_adp_code = 'WALKIN' AND n3.nhso_adp_type_id = '5'`);
        const otherType5Agg = fsAgg(isPg, 'n5.nhso_adp_code', `FROM opitemrece o5 JOIN nondrugitems n5 ON n5.icode = o5.icode WHERE o5.vn = ov.vn AND n5.nhso_adp_type_id = '5' AND (n5.nhso_adp_code IS NULL OR n5.nhso_adp_code <> 'WALKIN')`);
        const adpAllAgg = fsAgg(isPg, 'n4.nhso_adp_code', `FROM opitemrece o4 JOIN nondrugitems n4 ON n4.icode = o4.icode WHERE o4.vn = ov.vn AND n4.nhso_adp_code IS NOT NULL AND n4.nhso_adp_code <> ''`);

        const sql = `
            SELECT DISTINCT
                ov.vstdate                                AS "วันที่รับบริการ",
                ov.vsttime                                AS "เวลารับบริการ",
                ov.hn                                     AS "HN",
                ov.vn                                     AS "VN",
                CONCAT(pt.pname, pt.fname, ' ', pt.lname) AS "ชื่อ-นามสกุล",
                pt.cid                                    AS "เลขบัตรประชาชน",
                pt.nationality                            AS "สัญชาติ",
                ov.pttype                                 AS "รหัสสิทธิ",
                ptt.name                                  AS "ชื่อสิทธิ",
                ptt.hipdata_code                          AS "hipdata_code",
                vp.hospmain                               AS "hospmain",
                (SELECT hcm.chwpart FROM hospcode hcm WHERE hcm.hospcode = vp.hospmain LIMIT 1) AS "จังหวัด hospmain",
                vp.hospsub                                AS "hospsub",
                (SELECT hcs.chwpart FROM hospcode hcs WHERE hcs.hospcode = vp.hospsub LIMIT 1)  AS "จังหวัด hospsub",
                ${ourChw}                                 AS "จังหวัด รพ. เรา",
                ${dxAgg}                                  AS "ICD10 ในวิสิต",
                ${walkinItemAgg}                          AS "รายการ WALKIN (type 5)",
                ${otherType5Agg}                          AS "Project code type 5 อื่น",
                CASE WHEN EXISTS (${otherType5}) THEN 'ต้องตัดออก' ELSE 'ผ่าน' END AS "สถานะ",
                ${adpAllAgg}                              AS "ADP code ทั้งหมดในวิสิต"
            FROM ovst ov
            INNER JOIN patient pt ON pt.hn = ov.hn
            LEFT  JOIN pttype ptt ON ptt.pttype = ov.pttype
            LEFT  JOIN visit_pttype vp ON vp.vn = ov.vn
            WHERE ov.vstdate BETWEEN ${ph(1)} AND ${ph(2)}
                AND pt.nationality = '99'
                AND ov.pttype IN (SELECT p2.pttype FROM pttype p2 WHERE p2.hipdata_code IN ('UCS','WEL'))
                -- ต้องมีข้อมูลสิทธิของ visit ก่อน
                AND EXISTS (SELECT 1 FROM visit_pttype vpx WHERE vpx.vn = ov.vn)
                -- และต้องไม่มี hospmain/hospsub ที่อยู่ในจังหวัดเดียวกับ รพ. เรา
                AND NOT EXISTS (
                    SELECT 1 FROM visit_pttype vp3
                    WHERE vp3.vn = ov.vn
                      AND ( vp3.hospmain IN ${inProvince} OR vp3.hospsub IN ${inProvince} )
                )
                -- ต้องมี WALKIN ที่ ADP type = 5
                AND EXISTS (
                    SELECT 1 FROM opitemrece o
                    JOIN nondrugitems n ON n.icode = o.icode
                    WHERE o.vn = ov.vn AND n.nhso_adp_code = 'WALKIN' AND n.nhso_adp_type_id = '5'
                )
            ORDER BY ov.vstdate, ov.vn
        `;

        const rows = fsNormRows(await fsRun(cfg, sql, [dateFrom, dateTo]));
        const needCut = rows.filter(r => r['สถานะ'] === 'ต้องตัดออก').length;
        res.json({ success: true, data: rows, count: rows.length, needCut, cuttable: true });
    } catch (error) {
        console.error('feeschedule-opa-out-province error:', error);
        res.json({ success: false, error: error.message });
    }
});


// ============================================================================
// Fee Schedule — กองทุน DM REMISSION
// ----------------------------------------------------------------------------
// ตรวจสอบตามลำดับ
//   ลำดับที่ 1  ต้องมีค่าใช้จ่าย ADP Code = 32401
//   ลำดับที่ 2  ต้องมีวินิจฉัย ICD10 ในช่วง E110 - E119 (อันใดอันหนึ่ง)
//   ลำดับที่ 3  สิทธิ pttype.hipdata_code IN ('UCS','WEL')
//   ลำดับที่ 4  ต้องมีผล LAB ของ Item Lab ที่ผูกกับ ADP 32401 ออกในแฟ้ม LABFU
//               - LABRESULT = lab_order.lab_order_result ต้องมีค่า
//               - LABTEST   = sys_lab_link.sys_lab_code_id ต้องเท่ากับ '05'
//               เส้นทาง: lab_head -> lab_order -> lab_items -> nondrugitems (icode)
//                        และ lab_items -> sys_lab_link (lab_items_code)
//
// ลำดับ 1-3 เป็นเงื่อนไขคัดกรอง ไม่เข้าเงื่อนไขจะไม่ถูกดึงมา
// ลำดับ 4 เป็นผลตรวจ ดึงมาแสดงทั้งหมดแล้วติดธงว่าไม่ผ่านเพราะอะไร
//   (ไม่มี Item Lab / LABRESULT ว่าง / LABTEST ไม่ใช่ 05)
// Tools ไม่แก้ให้ เพราะผล LAB ต้องมาจากห้องแล็บจริง
// ============================================================================
const DM_ADP     = '32401';
const DM_LABTEST = '05';

app.post('/api/get-feeschedule-dm-remission', async (req, res) => {
    try {
        const cfg = req.body;
        const { dateFrom, dateTo } = cfg;
        const isPg = cfg.type === 'postgresql';
        const ph = (n) => isPg ? `$${n}` : '?';
        const yn = (expr) => `CASE WHEN ${expr} THEN 'Y' ELSE 'N' END`;
        const asText = isPg ? 'TEXT' : 'CHAR';

        // E110 - E119 : รองรับกรณีรหัสยาวกว่า 4 ตัวด้วย
        const dmIcd = `(LEFT(dm.icd10,3) = 'E11' AND SUBSTRING(dm.icd10,4,1) BETWEEN '0' AND '9')`;

        // ลำดับที่ 4 แยกเป็น 3 ขั้น จะได้บอกได้ว่าติดตรงไหน
        //   labItem   : วิสิตนี้มี lab order ของ Item ที่ผูกกับ ADP 32401 ไหม
        //   labResult : lab order นั้นมี LABRESULT หรือยัง
        //   labTest   : Item นั้นผูก sys_lab_link ที่ LABTEST = 05 ไหม
        const labBase = `
                    FROM lab_head lh
                    JOIN lab_order lo2  ON lo2.lab_order_number = lh.lab_order_number
                    JOIN lab_items li2  ON li2.lab_items_code = lo2.lab_items_code
                    JOIN nondrugitems nl ON nl.icode = li2.icode AND nl.nhso_adp_code = '${DM_ADP}'
                    WHERE lh.vn = ov.vn`;
        const hasResult = `lo2.lab_order_result IS NOT NULL AND lo2.lab_order_result <> ''`;
        const testMatch = `EXISTS (
                        SELECT 1 FROM sys_lab_link sl2
                        WHERE sl2.lab_items_code = li2.lab_items_code
                          AND CAST(sl2.sys_lab_code_id AS ${asText}) IN ('${DM_LABTEST}','5')
                    )`;

        const labItem   = `EXISTS (SELECT 1 ${labBase})`;
        const labResult = `EXISTS (SELECT 1 ${labBase} AND ${hasResult})`;
        const labFull   = `EXISTS (SELECT 1 ${labBase} AND ${hasResult} AND ${testMatch})`;

        const dxAgg = fsAgg(isPg, 'd2.icd10', `FROM ovstdiag d2 WHERE d2.vn = ov.vn AND LEFT(d2.icd10,3) = 'E11'`);
        const adpItemAgg = fsAgg(isPg, 'n3.name', `FROM opitemrece o3 JOIN nondrugitems n3 ON n3.icode = o3.icode WHERE o3.vn = ov.vn AND n3.nhso_adp_code = '${DM_ADP}'`);
        const labResultAgg = fsAgg(isPg, 'lo3.lab_order_result', `
                    FROM lab_head lh3
                    JOIN lab_order lo3  ON lo3.lab_order_number = lh3.lab_order_number
                    JOIN lab_items li3  ON li3.lab_items_code = lo3.lab_items_code
                    JOIN nondrugitems nl3 ON nl3.icode = li3.icode AND nl3.nhso_adp_code = '${DM_ADP}'
                    WHERE lh3.vn = ov.vn AND lo3.lab_order_result IS NOT NULL AND lo3.lab_order_result <> ''`);
        const labNameAgg = fsAgg(isPg, 'li4.lab_items_name', `
                    FROM lab_head lh4
                    JOIN lab_order lo4  ON lo4.lab_order_number = lh4.lab_order_number
                    JOIN lab_items li4  ON li4.lab_items_code = lo4.lab_items_code
                    JOIN nondrugitems nl4 ON nl4.icode = li4.icode AND nl4.nhso_adp_code = '${DM_ADP}'
                    WHERE lh4.vn = ov.vn`);
        const labTestAgg = fsAgg(isPg, 'sl5.sys_lab_code_id', `
                    FROM lab_head lh5
                    JOIN lab_order lo5  ON lo5.lab_order_number = lh5.lab_order_number
                    JOIN lab_items li5  ON li5.lab_items_code = lo5.lab_items_code
                    JOIN nondrugitems nl5 ON nl5.icode = li5.icode AND nl5.nhso_adp_code = '${DM_ADP}'
                    JOIN sys_lab_link sl5 ON sl5.lab_items_code = li5.lab_items_code
                    WHERE lh5.vn = ov.vn`);
        const adpAllAgg = fsAgg(isPg, 'n4.nhso_adp_code', `FROM opitemrece o4 JOIN nondrugitems n4 ON n4.icode = o4.icode WHERE o4.vn = ov.vn AND n4.nhso_adp_code IS NOT NULL AND n4.nhso_adp_code <> ''`);

        const sql = `
            SELECT DISTINCT
                ov.vstdate                                AS "วันที่รับบริการ",
                ov.vsttime                                AS "เวลารับบริการ",
                ov.hn                                     AS "HN",
                ov.vn                                     AS "VN",
                CONCAT(pt.pname, pt.fname, ' ', pt.lname) AS "ชื่อ-นามสกุล",
                pt.cid                                    AS "เลขบัตรประชาชน",
                ov.pttype                                 AS "รหัสสิทธิ",
                ptt.name                                  AS "ชื่อสิทธิ",
                ptt.hipdata_code                          AS "hipdata_code",
                ${yn(labItem)}                            AS "f_lab_item",
                ${yn(labResult)}                          AS "f_lab_result",
                ${yn(labFull)}                            AS "f_lab_full",
                ${dxAgg}                                  AS "ICD10 E11x ที่พบ",
                ${adpItemAgg}                             AS "รายการ ADP ${DM_ADP}",
                ${labNameAgg}                             AS "Item Lab ที่ผูกกับ ADP ${DM_ADP}",
                ${labTestAgg}                             AS "LABTEST (sys_lab_code_id)",
                ${labResultAgg}                           AS "LABRESULT",
                ${adpAllAgg}                              AS "ADP code ทั้งหมดในวิสิต"
            FROM ovst ov
            INNER JOIN patient pt ON pt.hn = ov.hn
            LEFT  JOIN pttype ptt ON ptt.pttype = ov.pttype
            WHERE ov.vstdate BETWEEN ${ph(1)} AND ${ph(2)}
                -- ลำดับที่ 1 ต้องมีค่าใช้จ่าย ADP 32401
                AND EXISTS (
                    SELECT 1 FROM opitemrece o
                    JOIN nondrugitems n ON n.icode = o.icode
                    WHERE o.vn = ov.vn AND n.nhso_adp_code = '${DM_ADP}'
                )
                -- ลำดับที่ 2 ต้องมี ICD10 E110 - E119
                AND EXISTS (
                    SELECT 1 FROM ovstdiag dm WHERE dm.vn = ov.vn AND ${dmIcd}
                )
                -- ลำดับที่ 3 สิทธิ UCS / WEL
                AND ov.pttype IN (SELECT p2.pttype FROM pttype p2 WHERE p2.hipdata_code IN ('UCS','WEL'))
            ORDER BY ov.vstdate, ov.vn
        `;

        const raw = fsNormRows(await fsRun(cfg, sql, [dateFrom, dateTo]));
        const Y = (v) => String(v === undefined || v === null ? 'N' : v).toUpperCase() === 'Y';

        const rows = raw.map(r => {
            // ลำดับที่ 4 — ไล่จากหยาบไปละเอียด บอกสาเหตุแรกที่ทำให้ไม่ผ่าน
            const ok = Y(r.f_lab_full);
            let problem = '-';
            if (!ok) {
                if (!Y(r.f_lab_item))        problem = 'ไม่พบ Item Lab ที่ผูกกับ ADP ' + DM_ADP + ' ในวิสิตนี้';
                else if (!Y(r.f_lab_result)) problem = 'มี Item Lab แต่ LABRESULT ยังว่าง (ผลยังไม่ออก)';
                else                         problem = 'มีผล LAB แล้ว แต่ LABTEST ไม่ใช่ ' + DM_LABTEST;
            }

            const o = {
                'วันที่รับบริการ': r['วันที่รับบริการ'],
                'เวลารับบริการ': r['เวลารับบริการ'],
                'HN': r['HN'], 'VN': r['VN'],
                'สถานะ': ok ? 'สมบูรณ์' : 'ไม่สมบูรณ์',
                'สิ่งที่ต้องแก้': problem,
                'ชื่อ-นามสกุล': r['ชื่อ-นามสกุล'],
                'เลขบัตรประชาชน': r['เลขบัตรประชาชน'],
                'รหัสสิทธิ': r['รหัสสิทธิ'],
                'ชื่อสิทธิ': r['ชื่อสิทธิ'],
                'hipdata_code': r['hipdata_code']
            };
            o['ผล LAB ตามเงื่อนไข'] = ok ? 'ผ่าน' : 'ไม่ผ่าน';
            o['_bad'] = ok ? [] : ['ผล LAB ตามเงื่อนไข', 'LABTEST (sys_lab_code_id)', 'LABRESULT'];
            o['ICD10 E11x ที่พบ'] = r['ICD10 E11x ที่พบ'];
            o['รายการ ADP ' + DM_ADP] = r['รายการ ADP ' + DM_ADP];
            o['Item Lab ที่ผูกกับ ADP ' + DM_ADP] = r['Item Lab ที่ผูกกับ ADP ' + DM_ADP];
            o['LABTEST (sys_lab_code_id)'] = r['LABTEST (sys_lab_code_id)'];
            o['LABRESULT'] = r['LABRESULT'];
            o['ADP code ทั้งหมดในวิสิต'] = r['ADP code ทั้งหมดในวิสิต'];
            return o;
        });

        const incomplete = rows.filter(r => r['สถานะ'] === 'ไม่สมบูรณ์').length;

        res.json({ success: true, data: rows, count: rows.length, incomplete });
    } catch (error) {
        console.error('feeschedule-dm-remission error:', error);
        res.json({ success: false, error: error.message });
    }
});


// ============================================================================
// Fee Schedule — กองทุนคัดกรองที่ใช้โครงเงื่อนไขเดียวกัน
// ----------------------------------------------------------------------------
// กองทุนกลุ่มนี้มีรูปแบบเหมือนกันหมด จึงใช้เครื่องยนต์ตัวเดียว แล้วแยกด้วย sub
//   ลำดับ 1  ต้องมีค่าใช้จ่าย ADP ของกองทุนนั้น (มีตัวใดตัวหนึ่งก็ผ่าน)
//   ลำดับ 2  ต้องเป็นคนไทย patient.nationality = '99'
//   ลำดับ 3  ต้องอยู่ในช่วงอายุที่กำหนด (คิด ณ วันรับบริการ)
//   ลำดับ 4  สิทธิ UC / ข้าราชการ / ประกันสังคม (UCS, WEL, OFC, SSS)
//   ลำดับ 5 เป็นต้นไป  ตรวจวินิจฉัย / ICD9 / ICD10TM ตามที่กองทุนนั้นกำหนด
//   ลำดับสุดท้าย  ต้องไม่มี ADP WALKIN / ER-EXT
//
// ลำดับ 1-4 เป็นเงื่อนไขคัดกรอง ไม่เข้าเงื่อนไขจะไม่ถูกดึงมา
// ลำดับ 5 เป็นต้นไปเป็นผลตรวจ ติดธงไว้ให้ Tools จัดการ
//
// หมายเหตุเรื่อง ICD9: ตามที่โค้ดเดิมของโปรแกรมนี้ใช้อยู่
//   - ตอนอ่าน  ดูทั้ง doctor_operation.icd9 และ ovstdiag.icd10
//   - ตอนเขียน ลง ovstdiag.icd10 (ที่เดียวกับวินิจฉัย)
// ============================================================================
const SIMPLE_PTTYPE  = ['UCS', 'WEL', 'OFC', 'SSS'];
const SIMPLE_BAD_ADP = ['WALKIN', 'ER-EXT'];

// ขยายช่วงรหัสท้ายตัวเลข เช่น fsCodeRange('C50',0,9) -> C500..C509
function fsCodeRange(prefix, from, to) {
    const out = [];
    for (let i = from; i <= to; i++) out.push(prefix + i);
    return out;
}

// ขยายช่วงรหัสที่เป็นตัวเลขล้วน เช่น fsNumRange(80008,80014) -> '80008'..'80014'
function fsNumRange(from, to) {
    const out = [];
    for (let i = from; i <= to; i++) out.push(String(i));
    return out;
}

const SIMPLE_FUNDS = {
    'ca-oral': {
        name: 'คัดกรองรอยโรคเสี่ยงมะเร็งช่องปาก',
        adp: ['90004'], ageMin: 40, ageMax: null,
        checks: [
            { kind: 'icd10', codes: ['Z128'], label: 'วินิจฉัย Z128' },
            { kind: 'icd9', codes: ['2721', '2722', '2723', '2724'], pick: true,
              label: 'ICD9 2721/2722/2723/2724 (อย่างใดอย่างหนึ่ง)' },
            { kind: 'icd9', codes: ['2729'], label: 'ICD9 2729' }
        ]
    },
    'fluoride-risk': {
        name: 'เคลือบฟลูออไรด์ (กลุ่มเสี่ยง)',
        adp: ['15001'], ageMin: 25, ageMax: 59,
        checks: [
            { kind: 'icd10', codes: ['K020', 'K0600', 'K0601', 'K0609', 'K117', 'Z298'], pick: true,
              label: 'วินิจฉัย K020/K0600/K0601/K0609/K117/Z298 (อย่างใดอย่างหนึ่ง)' },
            { kind: 'icd9', codes: ['2729'], label: 'ICD9 2729' },
            // ICD10TM มาจากการลงหัตถการทันตกรรม Tools เพิ่มให้ไม่ได้ แจ้งอย่างเดียว
            { kind: 'icd10tm', codes: ['2387021'], fixable: false, label: 'ICD10TM 2387021' }
        ]
    },
    'cbc-anemia': {
        name: 'คัดกรองโลหิตจางจากการขาดธาตุเหล็ก (CBC)',
        adp: ['13001'], ageMin: 13, ageMax: 45,
        checks: [{ kind: 'icd10', codes: ['Z138'], label: 'วินิจฉัย Z138' }]
    },
    'dm-screen-12003': {
        name: 'คัดกรองเบาหวาน (ADP 12003)',
        adp: ['12003'], ageMin: 35, ageMax: 59,
        checks: [{ kind: 'icd10', codes: ['Z131'], label: 'วินิจฉัย Z131' }]
    },
    'dm-screen-12004': {
        name: 'คัดกรองเบาหวาน (ADP 12004)',
        adp: ['12004'], ageMin: 45, ageMax: 70,
        checks: [{ kind: 'icd10', codes: ['Z136'], label: 'วินิจฉัย Z136' }]
    },
    'brca': {
        name: 'ตรวจยีน BRCA1 BRCA2',
        adp: ['90001', '37550', '90002'], ageMin: 18, ageMax: null,
        checks: [
            { kind: 'icd10', codes: fsCodeRange('C50', 0, 9).concat(['D050', 'D051', 'D057', 'D059']), pick: true,
              label: 'วินิจฉัย C500-C509 / D050 / D051 / D057 / D059 (อันใดอันหนึ่ง)' },
            { kind: 'icd10', codes: ['Z123'], label: 'วินิจฉัย Z123' }
        ]
    },
    'child-glasses': {
        name: 'แว่นตาเด็กที่มีสายตาผิดปกติ',
        adp: ['2206', '2207'], ageMin: 6, ageMax: 12,
        checks: [
            { kind: 'icd10', codes: fsCodeRange('H52', 0, 7), pick: true,
              label: 'วินิจฉัย H520-H527 (อันใดอันหนึ่ง)' },
            { kind: 'icd9', codes: ['9531'], label: 'ICD9 9531' }
        ]
    },

    // ---- กลุ่มสิทธิ UCS/WEL เท่านั้น และไม่จำกัดอายุ ----
    'lithotripsy': {
        name: 'สลายนิ่วในระบบทางเดินปัสสาวะ',
        adp: ['9851'], pttype: ['UCS', 'WEL'], ageMin: null, ageMax: null,
        checks: [
            { kind: 'icd10', codes: ['N200', 'N201', 'N202'], pick: true,
              label: 'วินิจฉัย N200/N201/N202 (อันใดอันหนึ่ง)' },
            { kind: 'icd9', codes: ['9851'], label: 'ICD9 9851' }
        ]
    },
    'gdm': {
        name: 'เบาหวานขณะตั้งครรภ์ (GDM)',
        adp: fsNumRange(80008, 80014), pttype: ['UCS', 'WEL'], ageMin: null, ageMax: null,
        checks: [
            { kind: 'icd10', codes: ['O244', 'O249'], pick: true,
              label: 'วินิจฉัย O244/O249 (อันใดอันหนึ่ง)' }
        ]
    },
    'pdm': {
        name: 'เบาหวานก่อนการตั้งครรภ์ (PDM)',
        adp: ['80015'].concat(fsNumRange(80032, 80040)), pttype: ['UCS', 'WEL'], ageMin: null, ageMax: null,
        checks: [
            { kind: 'icd10', codes: ['O240', 'O241', 'O242', 'O243'], pick: true,
              label: 'วินิจฉัย O240/O241/O242/O243 (อันใดอันหนึ่ง)' }
        ]
    },
    't1dm': {
        name: 'เบาหวานอายุรกรรม เด็ก/ผู้ใหญ่ (T1DM)',
        adp: fsNumRange(80001, 80007).concat(fsNumRange(80024, 80028)),
        pttype: ['UCS', 'WEL'], ageMin: null, ageMax: null,
        checks: [
            { kind: 'icd10', codes: fsCodeRange('E10', 1, 9), pick: true,
              label: 'วินิจฉัย E101-E109 (อันใดอันหนึ่ง)' }
        ]
    },
    'cgm': {
        name: 'ตรวจวัดระดับน้ำตาลต่อเนื่อง (CGM)',
        adp: fsNumRange(80029, 80031), pttype: ['UCS', 'WEL'], ageMin: null, ageMax: null,
        checks: [
            { kind: 'icd10', codes: fsCodeRange('E10', 1, 9), pick: true,
              label: 'วินิจฉัย E101-E109 (อันใดอันหนึ่ง)' }
        ]
    }
};

app.post('/api/get-feeschedule-simple', async (req, res) => {
    try {
        const cfg = req.body;
        const { dateFrom, dateTo, sub } = cfg;
        const S = SIMPLE_FUNDS[sub];
        if (!S) return res.json({ success: false, error: 'ไม่รู้จักเมนู: ' + sub });

        const isPg = cfg.type === 'postgresql';
        const ph = (n) => isPg ? `$${n}` : '?';
        const age = fsAgeExpr(isPg);
        const q = (list) => list.map(c => `'${c}'`).join(',');
        const yn = (expr) => `CASE WHEN ${expr} THEN 'Y' ELSE 'N' END`;

        // ICD10TM ต้องรู้ชื่อคอลัมน์จริงใน dttm ก่อน (แต่ละรุ่นเขียนไม่เหมือนกัน)
        let TM_COL = null, TM_SRC = null;
        if (S.checks.some(c => c.kind === 'icd10tm')) {
            const info = await fsFindDttmIcd10tmColumn(cfg);
            if (!info.col) {
                return res.json({
                    success: false,
                    error: 'ไม่พบคอลัมน์ ICD10TM ในตาราง dttm — คอลัมน์ที่มีคือ: '
                         + (info.all.length ? info.all.join(', ') : '(ไม่มีคอลัมน์ที่มีคำว่า icd10tm เลย)')
                });
            }
            TM_COL = info.col;
            TM_SRC = 'dttm.' + TM_COL;
        }

        // เงื่อนไข "มีรหัสนี้ไหม" แยกตามชนิด
        const checkExpr = (c) => {
            if (c.kind === 'icd10')
                return `EXISTS (SELECT 1 FROM ovstdiag dd WHERE dd.vn = ov.vn AND dd.icd10 IN (${q(c.codes)}))`;
            if (c.kind === 'icd9')
                return `(EXISTS (SELECT 1 FROM doctor_operation dq WHERE dq.vn = ov.vn AND dq.icd9 IN (${q(c.codes)}))
                         OR EXISTS (SELECT 1 FROM ovstdiag dv WHERE dv.vn = ov.vn AND dv.icd10 IN (${q(c.codes)})))`;
            // icd10tm : ผูกผ่านรายการค่าใช้จ่าย opitemrece -> dttm
            return `EXISTS (SELECT 1 FROM opitemrece ot JOIN dttm dt ON dt.icode = ot.icode
                            WHERE ot.vn = ov.vn AND dt.${TM_COL} IN (${q(c.codes)}))`;
        };

        const hasBad = `EXISTS (
                    SELECT 1 FROM opitemrece ob JOIN nondrugitems nb ON nb.icode = ob.icode
                    WHERE ob.vn = ov.vn AND nb.nhso_adp_code IN (${q(SIMPLE_BAD_ADP)}))`;

        const flagCols = S.checks.map((c, i) => `                ${yn(checkExpr(c))} AS "f_c${i}",`).join('\n');

        const dxAgg   = fsAgg(isPg, 'd2.icd10', `FROM ovstdiag d2 WHERE d2.vn = ov.vn`);
        const icd9Agg = fsAgg(isPg, 'dop.icd9', `FROM doctor_operation dop WHERE dop.vn = ov.vn AND dop.icd9 IS NOT NULL AND dop.icd9 <> ''`);
        const adpItemAgg = fsAgg(isPg, 'n3.name', `FROM opitemrece o3 JOIN nondrugitems n3 ON n3.icode = o3.icode WHERE o3.vn = ov.vn AND n3.nhso_adp_code IN (${q(S.adp)})`);
        const badAdpAgg  = fsAgg(isPg, 'nx.nhso_adp_code', `FROM opitemrece ox JOIN nondrugitems nx ON nx.icode = ox.icode WHERE ox.vn = ov.vn AND nx.nhso_adp_code IN (${q(SIMPLE_BAD_ADP)})`);
        const adpAllAgg  = fsAgg(isPg, 'n4.nhso_adp_code', `FROM opitemrece o4 JOIN nondrugitems n4 ON n4.icode = o4.icode WHERE o4.vn = ov.vn AND n4.nhso_adp_code IS NOT NULL AND n4.nhso_adp_code <> ''`);
        const tmAgg = TM_COL ? fsAgg(isPg, `dt2.${TM_COL}`,
            `FROM opitemrece ot2 JOIN dttm dt2 ON dt2.icode = ot2.icode
             WHERE ot2.vn = ov.vn AND dt2.${TM_COL} IS NOT NULL AND dt2.${TM_COL} <> ''`) : null;

        // ช่วงอายุ — ไม่ระบุขอบบนก็เช็คแค่ขั้นต่ำ ไม่ระบุทั้งคู่คือกองทุนที่ไม่จำกัดอายุ
        const noMin = (S.ageMin === null || S.ageMin === undefined);
        const noMax = (S.ageMax === null || S.ageMax === undefined);
        const ageCond = (noMin && noMax) ? '1=1'
            : noMax ? `${age} >= ${S.ageMin}`
            : noMin ? `${age} <= ${S.ageMax}`
            : `${age} BETWEEN ${S.ageMin} AND ${S.ageMax}`;

        // สิทธิที่รับ — กองทุนไหนไม่ระบุใช้ค่ากลาง (UCS, WEL, OFC, SSS)
        const ptList = S.pttype || SIMPLE_PTTYPE;

        // ป้ายชื่อคอลัมน์ ADP — รหัสที่เป็นช่วงยาว ๆ ย่อเป็น ตัวแรก-ตัวสุดท้าย ไม่งั้นหัวตารางยาวเกิน
        const adpLabel = S.adp.length > 3 ? (S.adp[0] + '-' + S.adp[S.adp.length - 1]) : S.adp.join('/');

        const sql = `
            SELECT DISTINCT
                ov.vstdate                                AS "วันที่รับบริการ",
                ov.vsttime                                AS "เวลารับบริการ",
                ov.hn                                     AS "HN",
                ov.vn                                     AS "VN",
                CONCAT(pt.pname, pt.fname, ' ', pt.lname) AS "ชื่อ-นามสกุล",
                pt.cid                                    AS "เลขบัตรประชาชน",
                pt.sex                                    AS "เพศ",
                pt.birthday                               AS "วันเกิด",
                ${age}                                    AS "อายุ (ปี)",
                pt.nationality                            AS "สัญชาติ",
                ov.pttype                                 AS "รหัสสิทธิ",
                ptt.name                                  AS "ชื่อสิทธิ",
                ptt.hipdata_code                          AS "hipdata_code",
${flagCols}
                ${yn(hasBad)}                             AS "f_bad",
                ${dxAgg}                                  AS "ICD10 ในวิสิต",
                ${icd9Agg}                                AS "ICD9 ในวิสิต",
                ${tmAgg ? tmAgg + '                       AS "ICD10TM ในวิสิต",' : ''}
                ${adpItemAgg}                             AS "รายการ ADP ${adpLabel}",
                ${badAdpAgg}                              AS "ADP ที่ต้องตัด",
                ${adpAllAgg}                              AS "ADP code ทั้งหมดในวิสิต"
            FROM ovst ov
            INNER JOIN patient pt ON pt.hn = ov.hn
            LEFT  JOIN pttype ptt ON ptt.pttype = ov.pttype
            WHERE ov.vstdate BETWEEN ${ph(1)} AND ${ph(2)}
                -- ลำดับที่ 1 ต้องมีค่าใช้จ่าย ADP ${S.adp.join(' หรือ ')}
                AND EXISTS (
                    SELECT 1 FROM opitemrece o
                    JOIN nondrugitems n ON n.icode = o.icode
                    WHERE o.vn = ov.vn AND n.nhso_adp_code IN (${q(S.adp)})
                )
                -- ลำดับที่ 2 คนไทยเท่านั้น
                AND pt.nationality = '99'
                -- ช่วงอายุ (1=1 คือกองทุนที่ไม่จำกัดอายุ)
                AND ${ageCond}
                -- สิทธิที่รับ
                AND ov.pttype IN (
                    SELECT p2.pttype FROM pttype p2
                    WHERE p2.hipdata_code IN (${q(ptList)})
                )
            ORDER BY ov.vstdate, ov.vn
        `;

        const raw = fsNormRows(await fsRun(cfg, sql, [dateFrom, dateTo]));
        const Y = (v) => String(v === undefined || v === null ? 'N' : v).toUpperCase() === 'Y';

        const rows = raw.map(r => {
            const problems = [];
            let canAdd = false;

            S.checks.forEach((c, i) => {
                if (Y(r['f_c' + i])) return;
                if (c.fixable === false) {
                    problems.push('ขาด ' + c.label + ' (ลงหัตถการเอง)');
                } else {
                    problems.push('ต้องเพิ่ม ' + c.label);
                    canAdd = true;
                }
            });

            const bad = Y(r.f_bad);
            if (bad) problems.push('ต้องตัด ADP ' + SIMPLE_BAD_ADP.join('/'));

            const o = {
                'วันที่รับบริการ': r['วันที่รับบริการ'],
                'เวลารับบริการ': r['เวลารับบริการ'],
                'HN': r['HN'], 'VN': r['VN'],
                'สถานะ': problems.length ? 'ไม่สมบูรณ์' : 'สมบูรณ์',
                'สิ่งที่ต้องแก้': problems.join(' · ') || '-',
                'ต้องเพิ่ม': canAdd ? 'Y' : 'N',
                'ต้องตัด': bad ? 'Y' : 'N',
                'ชื่อ-นามสกุล': r['ชื่อ-นามสกุล'],
                'เลขบัตรประชาชน': r['เลขบัตรประชาชน'],
                'เพศ': r['เพศ'],
                'วันเกิด': r['วันเกิด'],
                'อายุ (ปี)': r['อายุ (ปี)'],
                'สัญชาติ': r['สัญชาติ'],
                'รหัสสิทธิ': r['รหัสสิทธิ'],
                'ชื่อสิทธิ': r['ชื่อสิทธิ'],
                'hipdata_code': r['hipdata_code']
            };
            S.checks.forEach((c, i) => { o[c.label] = Y(r['f_c' + i]) ? 'มี' : 'ไม่มี'; });
            o['_bad'] = [].concat(
                S.checks.filter((c, i) => !Y(r['f_c' + i])).map(c => c.label),
                bad ? ['ADP ที่ต้องตัด'] : []);
            o['ICD10 ในวิสิต'] = r['ICD10 ในวิสิต'];
            o['ICD9 ในวิสิต'] = r['ICD9 ในวิสิต'];
            if (tmAgg) o['ICD10TM ในวิสิต'] = r['ICD10TM ในวิสิต'];
            o['รายการ ADP ' + adpLabel] = r['รายการ ADP ' + adpLabel];
            o['ADP ที่ต้องตัด'] = r['ADP ที่ต้องตัด'];
            o['ADP code ทั้งหมดในวิสิต'] = r['ADP code ทั้งหมดในวิสิต'];
            return o;
        });

        const needFix    = rows.filter(r => r['ต้องเพิ่ม'] === 'Y').length;
        const needCut    = rows.filter(r => r['ต้องตัด'] === 'Y').length;
        const incomplete = rows.filter(r => r['สถานะ'] === 'ไม่สมบูรณ์').length;

        const out = {
            success: true, data: rows, count: rows.length,
            needFix, needCut, incomplete, cuttable: !!needCut,
            pttypeUsed: ptList.join('/')
        };
        if (TM_SRC) out.icd10tmSource = TM_SRC;
        res.json(out);
    } catch (error) {
        console.error('feeschedule-simple error:', error);
        res.json({ success: false, error: error.message });
    }
});


// ============================================================================
// กองทุนคัดกรอง — Tools เติมวินิจฉัย/ICD9 ที่ขาดให้วิสิตที่เลือก
// ----------------------------------------------------------------------------
// รหัสมาจาก SIMPLE_FUNDS ฝั่ง server ตาม sub ที่ส่งมา ไม่รับรหัสอิสระจากหน้าเว็บ
// เงื่อนไขที่ยอมรับหลายรหัส (pick) จะลงรหัสที่ผู้ใช้เลือกจาก dropdown (pickCode)
// ถ้าส่งค่าที่ไม่อยู่ในรายการมา จะถอยไปใช้ตัวแรกของกลุ่มนั้น
// ICD10TM ไม่เติมให้ เพราะต้องลงหัตถการในโปรแกรมหลัก
// เช็คซ้ำก่อนเขียนทุกรายการ ถ้ามีอยู่แล้วจะข้าม
// ============================================================================
app.post('/api/add-feeschedule-simple-missing', async (req, res) => {
    const unlock = await fsLockWrites();   // ต่อคิว กันสองคำขอเขียนพร้อมกัน
    try {
        const { host, port, database, user, password, type, vns, sub, pickCode } = req.body;
        if (!vns || !vns.length) return res.json({ success: false, error: 'ไม่มีรายการที่เลือก' });

        const S = SIMPLE_FUNDS[sub];
        if (!S) return res.json({ success: false, error: 'ไม่รู้จักเมนู: ' + sub });

        const fixable = (S.checks || []).filter(c => c.fixable !== false);
        if (!fixable.length) return res.json({ success: false, error: 'เมนูนี้ไม่มีรหัสที่เพิ่มได้' });

        const isPg = type === 'postgresql';
        const P = (n) => isPg ? `$${n}` : '?';

        const conn = isPg
            ? new PgClient({ host, port: parseInt(port), database, user, password, connectionTimeoutMillis: 60000 })
            : await mysql.createConnection({ host, port, user, password, database, connectTimeout: 60000 });
        if (isPg) await conn.connect();

        const q = async (sql, params) => {
            if (isPg) return (await conn.query(sql, params || [])).rows;
            const [r] = await conn.execute(sql, params || []);
            return r;
        };

        let added = 0, skipped = 0, failed = 0;
        const errors = [], results = [];
        const usedCodes = [];

        try {
            for (const vn of vns) {
                const detail = { vn: vn, added: [], skip: [], error: null };
                try {
                    const ov = await q(`SELECT vn, hn, vstdate, vsttime, doctor FROM ovst WHERE vn = ${P(1)}`, [vn]);
                    if (!ov.length) { detail.error = 'ไม่พบวิสิตนี้'; failed++; results.push(detail); continue; }
                    const v = ov[0];

                    for (const c of fixable) {
                        // กลุ่มนี้มีรหัสใดรหัสหนึ่งอยู่แล้วก็ถือว่าผ่าน ไม่ลงซ้ำ
                        const marks = c.codes.map((_, i) => P(i + 2)).join(',');
                        let hit = await q(
                            `SELECT 1 AS x FROM ovstdiag WHERE vn = ${P(1)} AND icd10 IN (${marks})`,
                            [vn].concat(c.codes));
                        if (!hit.length && c.kind === 'icd9') {
                            hit = await q(
                                `SELECT 1 AS x FROM doctor_operation WHERE vn = ${P(1)} AND icd9 IN (${marks})`,
                                [vn].concat(c.codes));
                        }
                        if (hit.length) { detail.skip.push('มี ' + c.label + ' อยู่แล้ว'); skipped++; continue; }

                        // เลือกรหัสที่จะลง: ตามที่ผู้ใช้เลือก ถ้าไม่ถูกต้องใช้ตัวแรก
                        const code = (c.pick && c.codes.indexOf(pickCode) !== -1) ? pickCode : c.codes[0];

                        if (isPg) {
                            const sid = (await q(`SELECT get_serialnumber('ovst_diag_id') AS sid`))[0].sid;
                            await q(
                                `INSERT INTO ovstdiag (ovst_diag_id, vn, icd10, hn, vstdate, vsttime, diagtype, doctor, staff, update_datetime)
                                 VALUES ($1,$2,$3,$4,$5,$6,'4',$7,$8,NOW())`,
                                [sid, v.vn, code, v.hn, v.vstdate, v.vsttime, v.doctor, v.doctor]);
                        } else {
                            await q(
                                `INSERT INTO ovstdiag (ovst_diag_id, vn, icd10, hn, vstdate, vsttime, diagtype, doctor, staff, update_datetime)
                                 VALUES (get_serialnumber('ovst_diag_id'),?,?,?,?,?,'4',?,?,NOW())`,
                                [v.vn, code, v.hn, v.vstdate, v.vsttime, v.doctor, v.doctor]);
                        }
                        detail.added.push(code);
                        if (usedCodes.indexOf(code) === -1) usedCodes.push(code);
                        added++;
                    }
                } catch (e) {
                    detail.error = e.message; failed++; errors.push(`${vn}: ${e.message}`);
                }
                results.push(detail);
            }
        } finally {
            await conn.end();
        }

        res.json({ success: true, added, skipped, failed, errors, results, codes: usedCodes });
    } catch (error) {
        console.error('add-feeschedule-simple-missing error:', error);
        res.json({ success: false, error: error.message });
    } finally {
        unlock();
    }
});

// ============================================================================
// Fee Schedule — กองทุน CA CANCER
// ----------------------------------------------------------------------------
// ตรวจสอบตามลำดับ
//   ลำดับที่ 1  Principal Diagnosis (ovstdiag.diagtype = '1') ต้องเป็นรหัสมะเร็ง
//               C00-C97 และ D00-D48 (ICD-10 บทเนื้องอกทั้งบท)
//   ลำดับที่ 2  ต้องเป็นคนไทย patient.nationality = '99'
//   ลำดับที่ 3  สิทธิ UCS, WEL
//   ลำดับที่ 4  แยกเป็น 4 กรณีตามบริการที่ได้รับในวิสิตนั้น
//               กรณี 1  ฉายแสงอย่างเดียว (ADP ขึ้นต้น RTX) -> ต้องมี Z510 + ICD9 9925
//               กรณี 2  เคมีบำบัดอย่างเดียว (ยาใน drugitems ที่ nhso_adp_type_id = 6)
//                       -> ต้องมี Z511 + ICD9 9224
//               กรณี 3  มีทั้งคู่ -> ต้องมี Z510, Z511, ICD9 9925, 9224
//               กรณี 4  มาพบแพทย์เฉย ๆ -> ไม่ต้องมีรหัสพวกนี้ ถ้ามีถือว่าเกิน ลบออกได้
//   ลำดับที่ 5  ตรวจการลงทะเบียนคลินิกมะเร็ง (clinicmember + clinic ที่
//               hosxp_clinic_type_id = 7) และดึง Protocol จาก
//               clinic_subtype.nhso_cancer_type_code
//   ลำดับที่ 6  ต้องมีค่าใช้จ่าย ADP Code = CANCER — ไม่มีให้ Tools คีย์เพิ่มได้
//   ลำดับที่ 7  ต้องไม่มี ADP WALKIN / ER-EXT — ถ้ามี Tools ลบออกให้ได้
//
// ลำดับ 1-3 เป็นเงื่อนไขคัดกรอง ลำดับ 4-7 เป็นผลตรวจที่ติดธงไว้ให้จัดการ
// ============================================================================
const CANCER_RTX_PREFIX = 'RTX';
const CANCER_CHEMO_TYPE = '6';          // drugitems.nhso_adp_type_id
const CANCER_ADP        = 'CANCER';
const CANCER_CLINIC_TYPE = '7';         // clinic.hosxp_clinic_type_id
const CANCER_BAD_ADP    = ['WALKIN', 'ER-EXT'];

// รหัสที่ต้องมีคู่กับบริการแต่ละแบบ
const CANCER_RTX_CODES   = { dx: 'Z510', icd9: '9925' };
const CANCER_CHEMO_CODES = { dx: 'Z511', icd9: '9224' };
const CANCER_ALL_EXTRA   = ['Z510', 'Z511', '9925', '9224'];

// C00-C97 + D00-D48 -> รายการ prefix 3 ตัว ใช้เทียบตรง ๆ ไม่ต้อง cast เป็นตัวเลข
// (รหัสจริงบางตัวยาวกว่า 3 เช่น C509 จึงตัด 3 ตัวแรกมาเทียบ)
function fsCancerPrefixes() {
    const out = [];
    for (let i = 0; i <= 97; i++) out.push('C' + String(i).padStart(2, '0'));
    for (let i = 0; i <= 48; i++) out.push('D' + String(i).padStart(2, '0'));
    return out;
}

// ตาราง/คอลัมน์บางตัวไม่มีใน HOSxP ทุกรุ่น จึงต้องถามจาก schema ก่อนใช้
async function fsHasColumn(cfg, table, column) {
    const isPg = cfg.type === 'postgresql';
    const sql = isPg
        ? `SELECT 1 AS x FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`
        : `SELECT 1 AS x FROM information_schema.columns WHERE table_schema = ? AND table_name = ? AND column_name = ?`;
    try {
        const rows = await fsRun(cfg, sql, isPg ? [table, column] : [cfg.database, table, column]);
        return rows.length > 0;
    } catch (e) { return false; }
}

app.post('/api/get-feeschedule-cancer', async (req, res) => {
    try {
        const cfg = req.body;
        const { dateFrom, dateTo } = cfg;
        const isPg = cfg.type === 'postgresql';
        const ph = (n) => isPg ? `$${n}` : '?';
        const q = (list) => list.map(c => `'${c}'`).join(',');
        const yn = (expr) => `CASE WHEN ${expr} THEN 'Y' ELSE 'N' END`;

        // Protocol อ่านได้เฉพาะรุ่นที่มี clinicmember.clinic_subtype_id และตาราง clinic_subtype
        const hasSubtypeCol = await fsHasColumn(cfg, 'clinicmember', 'clinic_subtype_id');
        const hasSubtypeTbl = await fsHasColumn(cfg, 'clinic_subtype', 'nhso_cancer_type_code');
        const canProtocol = hasSubtypeCol && hasSubtypeTbl;

        const cancerPrefix = `SUBSTRING(dm.icd10, 1, 3) IN (${q(fsCancerPrefixes())})`;

        // ---- ลำดับที่ 4 : บริการที่ได้รับ ----
        const hasRtx = `EXISTS (
                    SELECT 1 FROM opitemrece orx JOIN nondrugitems nrx ON nrx.icode = orx.icode
                    WHERE orx.vn = ov.vn AND nrx.nhso_adp_code LIKE '${CANCER_RTX_PREFIX}%')`;
        const hasChemo = `EXISTS (
                    SELECT 1 FROM opitemrece oc JOIN drugitems dg ON dg.icode = oc.icode
                    WHERE oc.vn = ov.vn AND CAST(dg.nhso_adp_type_id AS ${isPg ? 'TEXT' : 'CHAR'}) = '${CANCER_CHEMO_TYPE}')`;

        // มีรหัสนี้ไหม — ICD10 ดูที่ ovstdiag, ICD9 ดูทั้ง doctor_operation และ ovstdiag
        const hasDx = (code) => `EXISTS (SELECT 1 FROM ovstdiag dd WHERE dd.vn = ov.vn AND dd.icd10 = '${code}')`;
        // ICD9 อยู่ได้สองที่ ต้องแยกให้รู้ว่าอยู่ที่ไหน เพราะ Tools ลบได้เฉพาะใน ovstdiag
        const opInDiag = (code) => `EXISTS (SELECT 1 FROM ovstdiag dv WHERE dv.vn = ov.vn AND dv.icd10 = '${code}')`;
        const opInProc = (code) => `EXISTS (SELECT 1 FROM doctor_operation dq WHERE dq.vn = ov.vn AND dq.icd9 = '${code}')`;

        const hasAdpCancer = `EXISTS (
                    SELECT 1 FROM opitemrece oa JOIN nondrugitems na ON na.icode = oa.icode
                    WHERE oa.vn = ov.vn AND na.nhso_adp_code = '${CANCER_ADP}')`;
        const hasBad = `EXISTS (
                    SELECT 1 FROM opitemrece ob JOIN nondrugitems nb ON nb.icode = ob.icode
                    WHERE ob.vn = ov.vn AND nb.nhso_adp_code IN (${q(CANCER_BAD_ADP)}))`;

        // ---- ลำดับที่ 5 : คลินิกมะเร็ง ----
        const inCancerClinic = `EXISTS (
                    SELECT 1 FROM clinicmember cm JOIN clinic cl ON cl.clinic = cm.clinic
                    WHERE cm.hn = ov.hn AND cl.hosxp_clinic_type_id = '${CANCER_CLINIC_TYPE}')`;
        const protocolAgg = canProtocol
            ? fsAgg(isPg, 'cs.nhso_cancer_type_code', `
                    FROM clinicmember cm2
                    JOIN clinic cl2 ON cl2.clinic = cm2.clinic
                    JOIN clinic_subtype cs ON cs.clinic_subtype_id = cm2.clinic_subtype_id
                    WHERE cm2.hn = ov.hn AND cl2.hosxp_clinic_type_id = '${CANCER_CLINIC_TYPE}'
                      AND cs.nhso_cancer_type_code IS NOT NULL AND cs.nhso_cancer_type_code <> ''`)
            : `NULL`;

        const dxPrincipalAgg = fsAgg(isPg, 'dp.icd10',
            `FROM ovstdiag dp WHERE dp.vn = ov.vn AND dp.diagtype = '1'`);
        const dxAgg = fsAgg(isPg, 'd2.icd10', `FROM ovstdiag d2 WHERE d2.vn = ov.vn`);
        const icd9Agg = fsAgg(isPg, 'dop.icd9', `FROM doctor_operation dop WHERE dop.vn = ov.vn AND dop.icd9 IS NOT NULL AND dop.icd9 <> ''`);
        const rtxAgg = fsAgg(isPg, 'nr2.nhso_adp_code', `FROM opitemrece or2 JOIN nondrugitems nr2 ON nr2.icode = or2.icode WHERE or2.vn = ov.vn AND nr2.nhso_adp_code LIKE '${CANCER_RTX_PREFIX}%'`);
        const chemoAgg = fsAgg(isPg, 'dg2.name', `FROM opitemrece oc2 JOIN drugitems dg2 ON dg2.icode = oc2.icode WHERE oc2.vn = ov.vn AND CAST(dg2.nhso_adp_type_id AS ${isPg ? 'TEXT' : 'CHAR'}) = '${CANCER_CHEMO_TYPE}'`);
        const badAdpAgg = fsAgg(isPg, 'nx.nhso_adp_code', `FROM opitemrece ox JOIN nondrugitems nx ON nx.icode = ox.icode WHERE ox.vn = ov.vn AND nx.nhso_adp_code IN (${q(CANCER_BAD_ADP)})`);
        const adpAllAgg = fsAgg(isPg, 'n4.nhso_adp_code', `FROM opitemrece o4 JOIN nondrugitems n4 ON n4.icode = o4.icode WHERE o4.vn = ov.vn AND n4.nhso_adp_code IS NOT NULL AND n4.nhso_adp_code <> ''`);

        const sql = `
            SELECT DISTINCT
                ov.vstdate                                AS "วันที่รับบริการ",
                ov.vsttime                                AS "เวลารับบริการ",
                ov.hn                                     AS "HN",
                ov.vn                                     AS "VN",
                CONCAT(pt.pname, pt.fname, ' ', pt.lname) AS "ชื่อ-นามสกุล",
                pt.cid                                    AS "เลขบัตรประชาชน",
                pt.sex                                    AS "เพศ",
                ${fsAgeExpr(isPg)}                        AS "อายุ (ปี)",
                pt.nationality                            AS "สัญชาติ",
                ov.pttype                                 AS "รหัสสิทธิ",
                ptt.name                                  AS "ชื่อสิทธิ",
                ptt.hipdata_code                          AS "hipdata_code",
                ${yn(hasRtx)}                             AS "f_rtx",
                ${yn(hasChemo)}                           AS "f_chemo",
                ${yn(hasDx(CANCER_RTX_CODES.dx))}         AS "f_z510",
                ${yn(hasDx(CANCER_CHEMO_CODES.dx))}       AS "f_z511",
                ${yn(opInDiag(CANCER_RTX_CODES.icd9))}    AS "f_9925d",
                ${yn(opInProc(CANCER_RTX_CODES.icd9))}    AS "f_9925p",
                ${yn(opInDiag(CANCER_CHEMO_CODES.icd9))}  AS "f_9224d",
                ${yn(opInProc(CANCER_CHEMO_CODES.icd9))}  AS "f_9224p",
                ${yn(hasAdpCancer)}                       AS "f_adp",
                ${yn(hasBad)}                             AS "f_bad",
                ${yn(inCancerClinic)}                     AS "f_clinic",
                ${protocolAgg}                            AS "f_protocol",
                ${dxPrincipalAgg}                         AS "Principal Dx (type 1)",
                ${rtxAgg}                                 AS "ADP ฉายแสง (RTX)",
                ${chemoAgg}                               AS "ยาเคมีบำบัด",
                ${dxAgg}                                  AS "ICD10 ในวิสิต",
                ${icd9Agg}                                AS "ICD9 ในวิสิต",
                ${badAdpAgg}                              AS "ADP ที่ต้องตัด",
                ${adpAllAgg}                              AS "ADP code ทั้งหมดในวิสิต"
            FROM ovst ov
            INNER JOIN patient pt ON pt.hn = ov.hn
            LEFT  JOIN pttype ptt ON ptt.pttype = ov.pttype
            WHERE ov.vstdate BETWEEN ${ph(1)} AND ${ph(2)}
                -- ลำดับที่ 1 Principal Dx เป็นรหัสมะเร็ง C00-C97 / D00-D48
                AND EXISTS (
                    SELECT 1 FROM ovstdiag dm
                    WHERE dm.vn = ov.vn AND dm.diagtype = '1' AND ${cancerPrefix}
                )
                -- ลำดับที่ 2 คนไทยเท่านั้น
                AND pt.nationality = '99'
                -- ลำดับที่ 3 สิทธิ UCS / WEL
                AND ov.pttype IN (
                    SELECT p2.pttype FROM pttype p2 WHERE p2.hipdata_code IN ('UCS','WEL')
                )
            ORDER BY ov.vstdate, ov.vn
        `;

        const raw = fsNormRows(await fsRun(cfg, sql, [dateFrom, dateTo]));
        const Y = (v) => String(v === undefined || v === null ? 'N' : v).toUpperCase() === 'Y';

        const rows = raw.map(r => {
            const rtx = Y(r.f_rtx), chemo = Y(r.f_chemo);

            // ลำดับที่ 4 — กรณีไหน และรหัสอะไรที่ต้องมี
            let caseNo, caseName, need = [];
            if (rtx && chemo)      { caseNo = 3; caseName = 'กรณี 3 ฉายแสง + เคมีบำบัด'; need = ['Z510', 'Z511', '9925', '9224']; }
            else if (rtx)          { caseNo = 1; caseName = 'กรณี 1 ฉายแสง';            need = ['Z510', '9925']; }
            else if (chemo)        { caseNo = 2; caseName = 'กรณี 2 เคมีบำบัด';          need = ['Z511', '9224']; }
            else                   { caseNo = 4; caseName = 'กรณี 4 พบแพทย์อย่างเดียว';  need = []; }

            // อยู่ใน ovstdiag = Tools ลบได้  ·  อยู่ใน doctor_operation = ต้องไปลบในโปรแกรมหลัก
            const inDiag = { 'Z510': Y(r.f_z510), 'Z511': Y(r.f_z511), '9925': Y(r.f_9925d), '9224': Y(r.f_9224d) };
            const inProc = { 'Z510': false,       'Z511': false,       '9925': Y(r.f_9925p), '9224': Y(r.f_9224p) };
            const present = {};
            CANCER_ALL_EXTRA.forEach(c => { present[c] = inDiag[c] || inProc[c]; });

            const missing = need.filter(c => !present[c]);
            // รหัสที่ไม่ควรมีในกรณีนี้ แต่ดันมีอยู่ — แยกตามที่อยู่ เพราะจัดการได้ไม่เหมือนกัน
            const extra     = CANCER_ALL_EXTRA.filter(c => inDiag[c] && need.indexOf(c) === -1);
            const extraProc = CANCER_ALL_EXTRA.filter(c => !inDiag[c] && inProc[c] && need.indexOf(c) === -1);

            const noAdp = !Y(r.f_adp);
            const bad   = Y(r.f_bad);

            // ลำดับที่ 5 — สถานะคลินิกมะเร็ง
            const proto = r.f_protocol;
            let clinicText;
            if (!Y(r.f_clinic))                                  clinicText = 'ยังไม่ลงทะเบียนคลินิกมะเร็ง';
            else if (!canProtocol)                               clinicText = 'ลงทะเบียนแล้ว (ฐานข้อมูลนี้ไม่มีข้อมูล Protocol)';
            else if (proto === null || proto === undefined || String(proto) === '') clinicText = 'ยังไม่ได้ระบุ Protocol';
            else                                                 clinicText = String(proto);

            const problems = [];
            if (missing.length)   problems.push('ต้องเพิ่ม ' + missing.join('/'));
            if (extra.length)     problems.push('มีเกินต้องลบ ' + extra.join('/'));
            if (extraProc.length) problems.push('มีเกิน ' + extraProc.join('/') + ' ใน doctor_operation (ลบเองในโปรแกรมหลัก)');
            if (noAdp)          problems.push('ต้องเพิ่ม ADP ' + CANCER_ADP);
            if (!Y(r.f_clinic)) problems.push('ยังไม่ลงทะเบียนคลินิกมะเร็ง');
            else if (canProtocol && (proto === null || proto === undefined || String(proto) === ''))
                                problems.push('ยังไม่ได้ระบุ Protocol');
            if (bad)            problems.push('ต้องตัด ADP ' + CANCER_BAD_ADP.join('/'));

            const o = {
                'วันที่รับบริการ': r['วันที่รับบริการ'],
                'เวลารับบริการ': r['เวลารับบริการ'],
                'HN': r['HN'], 'VN': r['VN'],
                'สถานะ': problems.length ? 'ไม่สมบูรณ์' : 'สมบูรณ์',
                'สิ่งที่ต้องแก้': problems.join(' · ') || '-',
                // ติดธงให้เลือกได้เมื่อมีอะไรให้ Tools ทำ (เพิ่มที่ขาด หรือ ลบที่เกิน)
                'ต้องเพิ่ม': (missing.length || extra.length || noAdp) ? 'Y' : 'N',
                'ต้องตัด': bad ? 'Y' : 'N',
                'ชื่อ-นามสกุล': r['ชื่อ-นามสกุล'],
                'เลขบัตรประชาชน': r['เลขบัตรประชาชน'],
                'เพศ': r['เพศ'],
                'อายุ (ปี)': r['อายุ (ปี)'],
                'สัญชาติ': r['สัญชาติ'],
                'รหัสสิทธิ': r['รหัสสิทธิ'],
                'ชื่อสิทธิ': r['ชื่อสิทธิ'],
                'กรณี': caseName,
                'คลินิกมะเร็ง / Protocol': clinicText,
                'ฉายแสง (RTX)': rtx ? 'มี' : 'ไม่มี',
                'เคมีบำบัด': chemo ? 'มี' : 'ไม่มี',
                'Z510': present['Z510'] ? 'มี' : 'ไม่มี',
                'Z511': present['Z511'] ? 'มี' : 'ไม่มี',
                // บอกแหล่งด้วย เพราะที่อยู่ใน doctor_operation ปุ่มลบของ Tools แตะไม่ได้
                'ICD9 9925': !present['9925'] ? 'ไม่มี' : (inDiag['9925'] ? 'มี (ovstdiag)' : 'มี (doctor_operation)'),
                'ICD9 9224': !present['9224'] ? 'ไม่มี' : (inDiag['9224'] ? 'มี (ovstdiag)' : 'มี (doctor_operation)'),
                'ADP CANCER': noAdp ? 'ไม่มี' : 'มี',
                'Principal Dx (type 1)': r['Principal Dx (type 1)'],
                'ADP ฉายแสง (RTX)': r['ADP ฉายแสง (RTX)'],
                'ยาเคมีบำบัด': r['ยาเคมีบำบัด'],
                'ICD10 ในวิสิต': r['ICD10 ในวิสิต'],
                'ICD9 ในวิสิต': r['ICD9 ในวิสิต'],
                'ADP ที่ต้องตัด': r['ADP ที่ต้องตัด'],
                'ADP code ทั้งหมดในวิสิต': r['ADP code ทั้งหมดในวิสิต']
            };
            // ช่องที่ผิดจริงของแถวนี้ — ขาดก็แดง เกินก็แดง ตามกรณีที่วิสิตนั้นเข้า
            o['_bad'] = [].concat(
                missing.map(c => (c === '9925' || c === '9224') ? 'ICD9 ' + c : c),
                extra.map(c => (c === '9925' || c === '9224') ? 'ICD9 ' + c : c),
                extraProc.map(c => (c === '9925' || c === '9224') ? 'ICD9 ' + c : c),
                noAdp ? ['ADP CANCER'] : [],
                clinicText.indexOf('ยังไม่') === 0 ? ['คลินิกมะเร็ง / Protocol'] : [],
                bad ? ['ADP ที่ต้องตัด'] : []);
            return o;
        });

        const needFix    = rows.filter(r => r['ต้องเพิ่ม'] === 'Y').length;
        const needCut    = rows.filter(r => r['ต้องตัด'] === 'Y').length;
        const incomplete = rows.filter(r => r['สถานะ'] === 'ไม่สมบูรณ์').length;
        const byCase = {};
        rows.forEach(r => { byCase[r['กรณี']] = (byCase[r['กรณี']] || 0) + 1; });

        res.json({
            success: true, data: rows, count: rows.length,
            needFix, needCut, incomplete, cuttable: !!needCut,
            caseSummary: Object.keys(byCase).sort().map(k => k + ' ' + byCase[k]).join(' · '),
            protocolSource: canProtocol ? 'clinic_subtype.nhso_cancer_type_code' : 'ฐานข้อมูลนี้ไม่มี clinic_subtype'
        });
    } catch (error) {
        console.error('feeschedule-cancer error:', error);
        res.json({ success: false, error: error.message });
    }
});


// ============================================================================
// CA CANCER — Tools ปรับข้อมูลให้ตรงกับกรณีของแต่ละวิสิต
// ----------------------------------------------------------------------------
// dxMode เลือกได้ 3 แบบจาก dropdown หน้าจอ
//   add     เพิ่มเฉพาะรหัสที่ขาด (ค่าเริ่มต้น)
//   remove  ลบเฉพาะรหัสที่ไม่ควรมีในกรณีนั้น
//   both    ทำทั้งสองอย่าง
// ADP CANCER ที่ขาดจะถูกเพิ่มในโหมด add และ both
//
// การลบทำเฉพาะใน ovstdiag (ที่เดียวกับที่ Tools เขียนลงไป)
// ไม่แตะ doctor_operation เพราะเป็นบันทึกหัตถการที่ห้องตรวจลงไว้
// ============================================================================
app.post('/api/add-feeschedule-cancer-fix', async (req, res) => {
    const unlock = await fsLockWrites();   // ต่อคิว กันสองคำขอเขียนพร้อมกัน
    try {
        const cfg = req.body;
        const { host, port, database, user, password, type, vns } = cfg;
        const dxMode = ['add', 'remove', 'both'].indexOf(cfg.dxMode) !== -1 ? cfg.dxMode : 'add';
        if (!vns || !vns.length) return res.json({ success: false, error: 'ไม่มีรายการที่เลือก' });

        const isPg = type === 'postgresql';
        const P = (n) => isPg ? `$${n}` : '?';

        // คอลัมน์ที่มีจริงใน opitemrece (แต่ละรุ่นไม่เท่ากัน)
        const colSql = isPg
            ? `SELECT column_name FROM information_schema.columns WHERE table_name = 'opitemrece'`
            : `SELECT column_name FROM information_schema.columns WHERE table_schema = ? AND table_name = 'opitemrece'`;
        const colRows = await fsRun(cfg, colSql, isPg ? [] : [database]);
        const oprCols = new Set(colRows.map(r => String(r.column_name || r.COLUMN_NAME).toLowerCase()));

        const conn = isPg
            ? new PgClient({ host, port: parseInt(port), database, user, password, connectionTimeoutMillis: 60000 })
            : await mysql.createConnection({ host, port, user, password, database, connectTimeout: 60000 });
        if (isPg) await conn.connect();

        const q = async (sql, params) => {
            if (isPg) return (await conn.query(sql, params || [])).rows;
            const [r] = await conn.execute(sql, params || []);
            return r;
        };
        // DELETE ต้องรู้จำนวนแถวที่ถูกลบ ซึ่งอยู่คนละที่กันในสองไดรเวอร์
        const qDel = async (sql, params) => {
            if (isPg) return (await conn.query(sql, params || [])).rowCount || 0;
            const [r] = await conn.execute(sql, params || []);
            return r.affectedRows || 0;
        };

        let addedDiag = 0, addedItem = 0, removedDiag = 0, skipped = 0, failed = 0;
        const errors = [], results = [];

        try {
            for (const vn of vns) {
                const detail = { vn: vn, added: [], removed: [], skip: [], error: null };
                try {
                    const ov = await q(`SELECT vn, hn, vstdate, vsttime, doctor, pttype FROM ovst WHERE vn = ${P(1)}`, [vn]);
                    if (!ov.length) { detail.error = 'ไม่พบวิสิตนี้'; failed++; results.push(detail); continue; }
                    const v = ov[0];

                    // ดูว่าวิสิตนี้เข้ากรณีไหน คำนวณใหม่ฝั่ง server ไม่เชื่อค่าจากหน้าเว็บ
                    const rtxRows = await q(
                        `SELECT 1 AS x FROM opitemrece o JOIN nondrugitems n ON n.icode = o.icode
                         WHERE o.vn = ${P(1)} AND n.nhso_adp_code LIKE '${CANCER_RTX_PREFIX}%'`, [vn]);
                    const chemoRows = await q(
                        `SELECT 1 AS x FROM opitemrece o JOIN drugitems d ON d.icode = o.icode
                         WHERE o.vn = ${P(1)} AND CAST(d.nhso_adp_type_id AS ${isPg ? 'TEXT' : 'CHAR'}) = '${CANCER_CHEMO_TYPE}'`, [vn]);
                    const rtx = rtxRows.length > 0, chemo = chemoRows.length > 0;

                    let need = [];
                    if (rtx && chemo) need = ['Z510', 'Z511', '9925', '9224'];
                    else if (rtx)     need = ['Z510', '9925'];
                    else if (chemo)   need = ['Z511', '9224'];

                    // ---- เพิ่มรหัสที่ขาด ----
                    if (dxMode === 'add' || dxMode === 'both') {
                        for (const code of need) {
                            const dup = await q(
                                `SELECT 1 AS x FROM ovstdiag WHERE vn = ${P(1)} AND icd10 = ${P(2)}`, [vn, code]);
                            let alsoOp = [];
                            if (!dup.length && (code === '9925' || code === '9224')) {
                                alsoOp = await q(
                                    `SELECT 1 AS x FROM doctor_operation WHERE vn = ${P(1)} AND icd9 = ${P(2)}`, [vn, code]);
                            }
                            if (dup.length || alsoOp.length) { detail.skip.push(code + ' มีอยู่แล้ว'); skipped++; continue; }

                            if (isPg) {
                                const sid = (await q(`SELECT get_serialnumber('ovst_diag_id') AS sid`))[0].sid;
                                await q(
                                    `INSERT INTO ovstdiag (ovst_diag_id, vn, icd10, hn, vstdate, vsttime, diagtype, doctor, staff, update_datetime)
                                     VALUES ($1,$2,$3,$4,$5,$6,'4',$7,$8,NOW())`,
                                    [sid, v.vn, code, v.hn, v.vstdate, v.vsttime, v.doctor, v.doctor]);
                            } else {
                                await q(
                                    `INSERT INTO ovstdiag (ovst_diag_id, vn, icd10, hn, vstdate, vsttime, diagtype, doctor, staff, update_datetime)
                                     VALUES (get_serialnumber('ovst_diag_id'),?,?,?,?,?,'4',?,?,NOW())`,
                                    [v.vn, code, v.hn, v.vstdate, v.vsttime, v.doctor, v.doctor]);
                            }
                            detail.added.push(code);
                            addedDiag++;
                        }

                        // ---- ลำดับที่ 6 : ADP CANCER ----
                        const dupAdp = await q(
                            `SELECT 1 AS x FROM opitemrece o JOIN nondrugitems n ON n.icode = o.icode
                             WHERE o.vn = ${P(1)} AND n.nhso_adp_code = ${P(2)}`, [vn, CANCER_ADP]);
                        if (dupAdp.length) { detail.skip.push('ADP ' + CANCER_ADP + ' มีอยู่แล้ว'); skipped++; }
                        else {
                            const items = await q(
                                `SELECT icode, name, price, income FROM nondrugitems
                                 WHERE nhso_adp_code = ${P(1)} AND istatus = '1' ORDER BY icode`, [CANCER_ADP]);
                            if (!items.length) {
                                detail.skip.push('ไม่พบรายการ ADP ' + CANCER_ADP + " ที่เปิดใช้งาน (istatus='1')");
                                skipped++;
                            } else {
                                const it = items[0];
                                const price = Number(it.price || 0);
                                const want = {
                                    vn: v.vn, hn: v.hn, vstdate: v.vstdate, vsttime: v.vsttime,
                                    icode: it.icode, qty: 1, unitprice: price, sum_price: price,
                                    paidst: '02', income: it.income, doctor: v.doctor, staff: v.doctor,
                                    pttype: v.pttype
                                };
                                const cols = Object.keys(want).filter(c => oprCols.has(c));
                                const vals = cols.map(c => want[c]);
                                const marks = cols.map((_, i) => isPg ? `$${i + 1}` : '?').join(',');
                                await q(`INSERT INTO opitemrece (${cols.join(',')}) VALUES (${marks})`, vals);
                                detail.added.push('ADP ' + CANCER_ADP);
                                addedItem++;
                            }
                        }
                    }

                    // ---- ลบรหัสที่ไม่ควรมีในกรณีนี้ ----
                    if (dxMode === 'remove' || dxMode === 'both') {
                        const extra = CANCER_ALL_EXTRA.filter(c => need.indexOf(c) === -1);
                        for (const code of extra) {
                            const n = await qDel(
                                `DELETE FROM ovstdiag WHERE vn = ${P(1)} AND icd10 = ${P(2)}`, [vn, code]);
                            if (n > 0) { detail.removed.push(code); removedDiag += n; }
                        }
                    }
                } catch (e) {
                    detail.error = e.message; failed++; errors.push(`${vn}: ${e.message}`);
                }
                results.push(detail);
            }
        } finally {
            await conn.end();
        }

        res.json({
            success: true,
            addedDiag, addedItem, removedDiag, skipped, failed, errors, results,
            diagNoun: 'วินิจฉัย/ICD9 ของกองทุนมะเร็ง',
            itemNoun: 'ADP ' + CANCER_ADP,
            mode: dxMode
        });
    } catch (error) {
        console.error('add-feeschedule-cancer-fix error:', error);
        res.json({ success: false, error: error.message });
    } finally {
        unlock();
    }
});

// ============================================================================
// Fee Schedule — กองทุนฟอกเลือดด้วยเครื่องไตเทียม (HD)
// ----------------------------------------------------------------------------
// ฐาน: visit ที่มีวินิจฉัย ICD10 = 'N185'
// แล้วตรวจต่อทีละเงื่อนไข (ใช้เฉพาะเมื่อมี ADP code ตัวนั้นในวิสิต)
//   HD0001 -> ต้องมี ADP 4905 และ ICD9 3895
//   HD0002 -> ต้องมี ICD9 3927
//   HD0003 -> ต้องมี ICD9 3993
//   HD0004 -> ต้องมี ICD9 3895
//   HD0005 -> ต้องมี ICD9 3950
// SQL คืนมาเป็นธง Y/N แล้วค่อยประกอบข้อความ "สิ่งที่ขาด" ฝั่ง JS
// จะได้ไม่ต้องเขียน CASE ซ้อนยาว ๆ ที่เขียนต่างกันระหว่าง MySQL กับ PostgreSQL
// ============================================================================
const HD_RULES = [
    { hd: 'HD0001', adp: '4905', icd9: '3895' },
    { hd: 'HD0002', adp: null,   icd9: '3927' },
    { hd: 'HD0003', adp: null,   icd9: '3993' },
    { hd: 'HD0004', adp: null,   icd9: '3895' },
    { hd: 'HD0005', adp: null,   icd9: '3950' }
];

app.post('/api/get-feeschedule-hd', async (req, res) => {
    try {
        const cfg = req.body;
        const { dateFrom, dateTo } = cfg;
        const isPg = cfg.type === 'postgresql';
        const ph = (n) => isPg ? `$${n}` : '?';

        const yn = (cond) => `CASE WHEN ${cond} THEN 'Y' ELSE 'N' END`;
        const hasAdp = (code) => `EXISTS (SELECT 1 FROM opitemrece oa JOIN nondrugitems na ON na.icode = oa.icode
                                          WHERE oa.vn = ov.vn AND na.nhso_adp_code = '${code}')`;
        // ICD9 ของเมนูนี้อ่านจาก ovstdiag.icd10 ที่เดียว — ที่เดียวกับที่ตัวเพิ่มข้อมูลเขียนลงไป
        const hasIcd9 = (code) => `EXISTS (SELECT 1 FROM ovstdiag dv WHERE dv.vn = ov.vn AND dv.icd10 = '${code}')`;

        // ธงของทุก ADP/ICD9 ที่เกี่ยวข้อง (ไม่ซ้ำ)
        const adpCodes = ['HD0001','HD0002','HD0003','HD0004','HD0005','4905'];
        const icd9Codes = ['3895','3927','3993','3950'];

        const flagCols = adpCodes.map(c => `${yn(hasAdp(c))} AS "adp_${c}"`)
            .concat(icd9Codes.map(c => `${yn(hasIcd9(c))} AS "icd9_${c}"`))
            .join(',\n                ');

        const dxAgg = fsAgg(isPg, 'd2.icd10', `FROM ovstdiag d2 WHERE d2.vn = ov.vn`);
        // แสดงเฉพาะรหัส ICD9 ที่เกี่ยวกับ 5 เงื่อนไข อ่านจาก ovstdiag.icd10 ที่เดียวกับตัวตรวจ
        const icd9Agg = fsAgg(isPg, 'dv2.icd10',
            `FROM ovstdiag dv2 WHERE dv2.vn = ov.vn AND dv2.icd10 IN ('3895','3927','3993','3950')`);
        const adpAllAgg = fsAgg(isPg, 'n4.nhso_adp_code', `FROM opitemrece o4 JOIN nondrugitems n4 ON n4.icode = o4.icode WHERE o4.vn = ov.vn AND n4.nhso_adp_code IS NOT NULL AND n4.nhso_adp_code <> ''`);

        const sql = `
            SELECT DISTINCT
                ov.vstdate                                AS "วันที่รับบริการ",
                ov.vsttime                                AS "เวลารับบริการ",
                ov.hn                                     AS "HN",
                ov.vn                                     AS "VN",
                CONCAT(pt.pname, pt.fname, ' ', pt.lname) AS "ชื่อ-นามสกุล",
                pt.cid                                    AS "เลขบัตรประชาชน",
                ov.pttype                                 AS "รหัสสิทธิ",
                ptt.name                                  AS "ชื่อสิทธิ",
                ${dxAgg}                                  AS "ICD10 ในวิสิต",
                ${icd9Agg}                                AS "ICD9 ในวิสิต",
                ${adpAllAgg}                              AS "ADP code ทั้งหมดในวิสิต",
                ${flagCols}
            FROM ovst ov
            INNER JOIN patient pt ON pt.hn = ov.hn
            LEFT  JOIN pttype ptt ON ptt.pttype = ov.pttype
            WHERE ov.vstdate BETWEEN ${ph(1)} AND ${ph(2)}
                AND EXISTS (SELECT 1 FROM ovstdiag dn WHERE dn.vn = ov.vn AND dn.icd10 = 'N185')
            ORDER BY ov.vstdate, ov.vn
        `;

        const raw = fsNormRows(await fsRun(cfg, sql, [dateFrom, dateTo]));

        // ประกอบผลตรวจทีละแถว
        const rows = raw.map(r => {
            const has = (k) => String(r[k] || r[k.toLowerCase()] || 'N').toUpperCase() === 'Y';
            const hdFound = [], missing = [];

            HD_RULES.forEach(rule => {
                if (!has('adp_' + rule.hd)) return;      // ไม่มี HD ตัวนี้ -> ข้ามเงื่อนไขนี้
                hdFound.push(rule.hd);
                if (rule.adp && !has('adp_' + rule.adp)) missing.push(`ADP ${rule.adp} (จาก ${rule.hd})`);
                if (rule.icd9 && !has('icd9_' + rule.icd9)) missing.push(`ICD9 ${rule.icd9} (จาก ${rule.hd})`);
            });

            const out = {
                'วันที่รับบริการ': r['วันที่รับบริการ'],
                'เวลารับบริการ': r['เวลารับบริการ'],
                'HN': r['HN'],
                'VN': r['VN'],
                'ชื่อ-นามสกุล': r['ชื่อ-นามสกุล'],
                'เลขบัตรประชาชน': r['เลขบัตรประชาชน'],
                'รหัสสิทธิ': r['รหัสสิทธิ'],
                'ชื่อสิทธิ': r['ชื่อสิทธิ'],
                'ADP HD ที่พบ': hdFound.join(', ') || '-',
                'สิ่งที่ขาด': missing.join(' · ') || '-',
                'สถานะ': hdFound.length === 0 ? 'ไม่มีรายการ HD'
                        : (missing.length ? 'ต้องเพิ่ม' : 'ครบ'),
                'ICD10 ในวิสิต': r['ICD10 ในวิสิต'],
                'ICD9 ในวิสิต': r['ICD9 ในวิสิต'],
                'ADP code ทั้งหมดในวิสิต': r['ADP code ทั้งหมดในวิสิต']
            };
            // เก็บรายการที่ขาดแบบมีโครงสร้างไว้ให้ Tools เพิ่มข้อมูลใช้ต่อในอนาคต
            out.__missing = missing;
            return out;
        });

        const needFix = rows.filter(r => r['สถานะ'] === 'ต้องเพิ่ม').length;
        const noHd = rows.filter(r => r['สถานะ'] === 'ไม่มีรายการ HD').length;

        // ไม่ส่ง __missing ออกไปเป็นคอลัมน์ในตาราง
        const data = rows.map(r => { const o = Object.assign({}, r); delete o.__missing; return o; });

        res.json({ success: true, data, count: data.length, needFix, noHd });
    } catch (error) {
        console.error('feeschedule-hd error:', error);
        res.json({ success: false, error: error.message });
    }
});

// ============================================================================
// HD — เพิ่มข้อมูลที่ขาด (ICD9 ลง ovstdiag / ADP ลง opitemrece)
// ----------------------------------------------------------------------------
// เพิ่มเฉพาะ VN ที่ผู้ใช้ติ๊กเลือกมา และประเมินสิ่งที่ขาดใหม่ฝั่ง server ทุกครั้ง
// ไม่เชื่อค่าที่ส่งมาจากหน้าเว็บ กันกรณีข้อมูลเปลี่ยนไปหลังจากกดค้นหา
// ก่อนเพิ่มทุกรายการจะเช็คซ้ำอีกครั้ง ถ้ามีอยู่แล้วจะข้าม
// ============================================================================
app.post('/api/add-feeschedule-hd-missing', async (req, res) => {
    const unlock = await fsLockWrites();   // ต่อคิว กันสองคำขอเขียนพร้อมกัน
    try {
        const cfg = req.body;
        const { host, port, database, user, password, type, vns } = cfg;
        if (!vns || !vns.length) return res.json({ success: false, error: 'ไม่มีรายการที่เลือก' });

        const isPg = type === 'postgresql';
        const P = (n) => isPg ? `$${n}` : '?';

        // คอลัมน์ที่มีจริงใน opitemrece (แต่ละรุ่นไม่เท่ากัน) จะได้ใส่เฉพาะที่มี
        const colSql = isPg
            ? `SELECT column_name FROM information_schema.columns WHERE table_name = 'opitemrece'`
            : `SELECT column_name FROM information_schema.columns WHERE table_schema = ? AND table_name = 'opitemrece'`;
        const colRows = await fsRun(cfg, colSql, isPg ? [] : [database]);
        const oprCols = new Set(colRows.map(r => String(r.column_name || r.COLUMN_NAME).toLowerCase()));

        const results = [];
        let addedDiag = 0, addedItem = 0, skipped = 0, failed = 0;
        const errors = [];

        const conn = isPg
            ? new PgClient({ host, port: parseInt(port), database, user, password, connectionTimeoutMillis: 60000 })
            : await mysql.createConnection({ host, port, user, password, database, connectTimeout: 60000 });
        if (isPg) await conn.connect();

        const q = async (sql, params) => {
            if (isPg) return (await conn.query(sql, params || [])).rows;
            const [r] = await conn.execute(sql, params || []);
            return r;
        };

        try {
            for (const vn of vns) {
                const detail = { vn: vn, diag: [], item: [], skip: [], error: null };
                try {
                    const ov = await q(`SELECT vn, hn, vstdate, vsttime, doctor, pttype FROM ovst WHERE vn = ${P(1)}`, [vn]);
                    if (!ov.length) { detail.error = 'ไม่พบวิสิตนี้'; failed++; results.push(detail); continue; }
                    const v = ov[0];

                    const hdRows = await q(
                        `SELECT DISTINCT n.nhso_adp_code AS code
                         FROM opitemrece o JOIN nondrugitems n ON n.icode = o.icode
                         WHERE o.vn = ${P(1)} AND n.nhso_adp_code IN ('HD0001','HD0002','HD0003','HD0004','HD0005')`, [vn]);
                    const hdSet = new Set(hdRows.map(r => String(r.code || r.CODE)));

                    for (const rule of HD_RULES) {
                        if (!hdSet.has(rule.hd)) continue;

                        // ---- ICD9 -> ovstdiag.icd10 ----
                        if (rule.icd9) {
                            const dup = await q(
                                `SELECT 1 AS x FROM ovstdiag WHERE vn = ${P(1)} AND icd10 = ${P(2)}`, [vn, rule.icd9]);
                            if (dup.length) {
                                detail.skip.push(`ICD9 ${rule.icd9} มีอยู่แล้ว`);
                                skipped++;
                            } else {
                                if (isPg) {
                                    const sid = (await q(`SELECT get_serialnumber('ovst_diag_id') AS sid`))[0].sid;
                                    await q(
                                        `INSERT INTO ovstdiag (ovst_diag_id, vn, icd10, hn, vstdate, vsttime, diagtype, doctor, staff, update_datetime)
                                         VALUES ($1,$2,$3,$4,$5,$6,'4',$7,$8,NOW())`,
                                        [sid, v.vn, rule.icd9, v.hn, v.vstdate, v.vsttime, v.doctor, v.doctor]);
                                } else {
                                    await q(
                                        `INSERT INTO ovstdiag (ovst_diag_id, vn, icd10, hn, vstdate, vsttime, diagtype, doctor, staff, update_datetime)
                                         VALUES (get_serialnumber('ovst_diag_id'),?,?,?,?,?,'4',?,?,NOW())`,
                                        [v.vn, rule.icd9, v.hn, v.vstdate, v.vsttime, v.doctor, v.doctor]);
                                }
                                detail.diag.push(rule.icd9);
                                addedDiag++;
                            }
                        }

                        // ---- ADP -> opitemrece ----
                        if (rule.adp) {
                            const dupI = await q(
                                `SELECT 1 AS x FROM opitemrece o JOIN nondrugitems n ON n.icode = o.icode
                                 WHERE o.vn = ${P(1)} AND n.nhso_adp_code = ${P(2)}`, [vn, rule.adp]);
                            if (dupI.length) {
                                detail.skip.push(`ADP ${rule.adp} มีอยู่แล้ว`);
                                skipped++;
                                continue;
                            }
                            const items = await q(
                                `SELECT icode, name, price, income FROM nondrugitems
                                 WHERE nhso_adp_code = ${P(1)} AND istatus = '1' ORDER BY icode`, [rule.adp]);
                            if (!items.length) {
                                detail.skip.push(`ไม่พบรายการ ADP ${rule.adp} ที่เปิดใช้งาน (istatus='1')`);
                                skipped++;
                                continue;
                            }
                            const it = items[0];
                            const price = Number(it.price || 0);

                            const want = {
                                vn: v.vn, hn: v.hn, vstdate: v.vstdate, vsttime: v.vsttime,
                                icode: it.icode, qty: 1, unitprice: price, sum_price: price,
                                paidst: '02', income: it.income, doctor: v.doctor, staff: v.doctor,
                                pttype: v.pttype
                            };
                            const cols = Object.keys(want).filter(c => oprCols.has(c));
                            const vals = cols.map(c => want[c]);
                            const marks = cols.map((_, i) => isPg ? `$${i + 1}` : '?').join(',');
                            await q(`INSERT INTO opitemrece (${cols.join(',')}) VALUES (${marks})`, vals);

                            detail.item.push(`ADP ${rule.adp} icode ${it.icode} ราคา ${price}`);
                            addedItem++;
                        }
                    }
                } catch (e) {
                    detail.error = e.message;
                    failed++;
                    errors.push(`${vn}: ${e.message}`);
                }
                results.push(detail);
            }
        } finally {
            await conn.end();
        }

        res.json({ success: true, addedDiag: addedDiag, addedItem: addedItem, skipped: skipped, failed: failed, errors: errors, results: results });
    } catch (error) {
        console.error('add-feeschedule-hd-missing error:', error);
        res.json({ success: false, error: error.message });
    } finally {
        unlock();
    }
});

// ============================================================================
// วางแผนครอบครัว — Tools เพิ่มวินิจฉัย/ICD9 ที่ขาด (เขียนลง ovstdiag)
// ----------------------------------------------------------------------------
// รหัสที่จะเพิ่มมาจากตาราง FP_SUBS ฝั่ง server ตาม sub ที่ส่งมา
// ไม่รับรหัสจากหน้าเว็บโดยตรง กันการยิงเพิ่มรหัสอะไรก็ได้
// ============================================================================
app.post('/api/add-feeschedule-fp-missing', async (req, res) => {
    const unlock = await fsLockWrites();   // ต่อคิว กันสองคำขอเขียนพร้อมกัน
    try {
        const cfg = req.body;
        const { host, port, database, user, password, type, vns, sub } = cfg;
        if (!vns || !vns.length) return res.json({ success: false, error: 'ไม่มีรายการที่เลือก' });

        const S = FP_SUBS[sub];
        if (!S) return res.json({ success: false, error: 'ไม่รู้จักเมนูย่อย: ' + sub });

        const codes = [];
        if (S.icd10) S.icd10.forEach(c => codes.push(c));
        if (S.icd9) codes.push(S.icd9);
        if (!codes.length) return res.json({ success: false, error: 'เมนูนี้ไม่มีรหัสที่ต้องเพิ่ม' });

        const isPg = type === 'postgresql';
        const P = (n) => isPg ? `$${n}` : '?';

        const conn = isPg
            ? new PgClient({ host, port: parseInt(port), database, user, password, connectionTimeoutMillis: 60000 })
            : await mysql.createConnection({ host, port, user, password, database, connectTimeout: 60000 });
        if (isPg) await conn.connect();

        const q = async (sql, params) => {
            if (isPg) return (await conn.query(sql, params || [])).rows;
            const [r] = await conn.execute(sql, params || []);
            return r;
        };

        let added = 0, skipped = 0, failed = 0;
        const errors = [], results = [];

        try {
            for (const vn of vns) {
                const detail = { vn: vn, added: [], skip: [], error: null };
                try {
                    const ov = await q(`SELECT vn, hn, vstdate, vsttime, doctor FROM ovst WHERE vn = ${P(1)}`, [vn]);
                    if (!ov.length) { detail.error = 'ไม่พบวิสิตนี้'; failed++; results.push(detail); continue; }
                    const v = ov[0];

                    for (const code of codes) {
                        const dup = await q(
                            `SELECT 1 AS x FROM ovstdiag WHERE vn = ${P(1)} AND icd10 = ${P(2)}`, [vn, code]);
                        if (dup.length) { detail.skip.push(code + ' มีอยู่แล้ว'); skipped++; continue; }

                        if (isPg) {
                            const sid = (await q(`SELECT get_serialnumber('ovst_diag_id') AS sid`))[0].sid;
                            await q(
                                `INSERT INTO ovstdiag (ovst_diag_id, vn, icd10, hn, vstdate, vsttime, diagtype, doctor, staff, update_datetime)
                                 VALUES ($1,$2,$3,$4,$5,$6,'4',$7,$8,NOW())`,
                                [sid, v.vn, code, v.hn, v.vstdate, v.vsttime, v.doctor, v.doctor]);
                        } else {
                            await q(
                                `INSERT INTO ovstdiag (ovst_diag_id, vn, icd10, hn, vstdate, vsttime, diagtype, doctor, staff, update_datetime)
                                 VALUES (get_serialnumber('ovst_diag_id'),?,?,?,?,?,'4',?,?,NOW())`,
                                [v.vn, code, v.hn, v.vstdate, v.vsttime, v.doctor, v.doctor]);
                        }
                        detail.added.push(code);
                        added++;
                    }
                } catch (e) {
                    detail.error = e.message; failed++; errors.push(`${vn}: ${e.message}`);
                }
                results.push(detail);
            }
        } finally {
            await conn.end();
        }

        res.json({ success: true, added: added, skipped: skipped, failed: failed, errors: errors, results: results, codes: codes });
    } catch (error) {
        console.error('add-feeschedule-fp-missing error:', error);
        res.json({ success: false, error: error.message });
    } finally {
        unlock();
    }
});

// ============================================================================
// วางแผนครอบครัว — Tools ตัด ADP ที่ห้ามมี (WALKIN / ER-EXT)
// รหัสที่ตัดมาจาก FP_SUBS ตาม sub ไม่รับจากหน้าเว็บ
// หมายเหตุ: ใส่ห่วงอนามัย (FP001) ตัดเฉพาะ WALKIN ตามโจทย์
// ============================================================================
app.post('/api/delete-feeschedule-fp-adp', async (req, res) => {
    try {
        const { host, port, database, user, password, type, vns, sub } = req.body;
        if (!vns || !vns.length) return res.json({ success: false, error: 'ไม่มีรายการที่เลือก' });

        const S = FP_SUBS[sub];
        if (!S) return res.json({ success: false, error: 'ไม่รู้จักเมนูย่อย: ' + sub });
        const ex = S.exclude || [];
        if (!ex.length) return res.json({ success: false, error: 'เมนูนี้ไม่มีรหัสที่ต้องตัด' });

        const list = ex.map(c => `'${c}'`).join(',');
        const SUB = `SELECT icode FROM nondrugitems WHERE nhso_adp_code IN (${list})`;
        let deleted = 0, removedRows = 0, failed = 0;
        const errors = [];

        if (type === 'postgresql') {
            const client = new PgClient({ host, port: parseInt(port), database, user, password, connectionTimeoutMillis: 30000 });
            await client.connect();
            for (const vn of vns) {
                try {
                    const r = await client.query(`DELETE FROM opitemrece WHERE vn = $1 AND icode IN (${SUB})`, [vn]);
                    deleted++; removedRows += (r.rowCount || 0);
                } catch (e) { failed++; errors.push(`${vn}: ${e.message}`); }
            }
            await client.end();
        } else {
            const connection = await mysql.createConnection({ host, port, user, password, database, connectTimeout: 30000 });
            for (const vn of vns) {
                try {
                    const [r] = await connection.execute(`DELETE FROM opitemrece WHERE vn = ? AND icode IN (${SUB})`, [vn]);
                    deleted++; removedRows += (r.affectedRows || 0);
                } catch (e) { failed++; errors.push(`${vn}: ${e.message}`); }
            }
            await connection.end();
        }

        res.json({ success: true, deleted: deleted, removedRows: removedRows, failed: failed, errors: errors, codes: ex });
    } catch (error) {
        console.error('delete-feeschedule-fp-adp error:', error);
        res.json({ success: false, error: error.message });
    }
});

// ============================================================================
// ER คุณภาพ — Tools เติมค่าใช้จ่าย ADP ER-EXT ให้วิสิตที่เลือก
// เลือกรายการที่เปิดใช้งาน (istatus='1') qty=1 unitprice จากราคาของรายการ paidst='02'
// เช็คซ้ำก่อนทุกครั้ง ถ้ามีอยู่แล้วจะข้าม
// ============================================================================
app.post('/api/add-feeschedule-er-erext', async (req, res) => {
    const unlock = await fsLockWrites();   // ต่อคิว กันสองคำขอเขียนพร้อมกัน
    try {
        const cfg = req.body;
        const { host, port, database, user, password, type, vns } = cfg;
        if (!vns || !vns.length) return res.json({ success: false, error: 'ไม่มีรายการที่เลือก' });

        const isPg = type === 'postgresql';
        const P = (n) => isPg ? `$${n}` : '?';

        const colSql = isPg
            ? `SELECT column_name FROM information_schema.columns WHERE table_name = 'opitemrece'`
            : `SELECT column_name FROM information_schema.columns WHERE table_schema = ? AND table_name = 'opitemrece'`;
        const colRows = await fsRun(cfg, colSql, isPg ? [] : [database]);
        const oprCols = new Set(colRows.map(r => String(r.column_name || r.COLUMN_NAME).toLowerCase()));

        const conn = isPg
            ? new PgClient({ host, port: parseInt(port), database, user, password, connectionTimeoutMillis: 60000 })
            : await mysql.createConnection({ host, port, user, password, database, connectTimeout: 60000 });
        if (isPg) await conn.connect();

        const q = async (sql, params) => {
            if (isPg) return (await conn.query(sql, params || [])).rows;
            const [r] = await conn.execute(sql, params || []);
            return r;
        };

        let added = 0, skipped = 0, failed = 0;
        const errors = [], results = [];

        try {
            for (const vn of vns) {
                const detail = { vn: vn, added: null, skip: null, error: null };
                try {
                    const ov = await q(`SELECT vn, hn, vstdate, vsttime, doctor, pttype FROM ovst WHERE vn = ${P(1)}`, [vn]);
                    if (!ov.length) { detail.error = 'ไม่พบวิสิตนี้'; failed++; results.push(detail); continue; }
                    const v = ov[0];

                    const dup = await q(
                        `SELECT 1 AS x FROM opitemrece o JOIN nondrugitems n ON n.icode = o.icode
                         WHERE o.vn = ${P(1)} AND n.nhso_adp_code = 'ER-EXT'`, [vn]);
                    if (dup.length) { detail.skip = 'มี ER-EXT อยู่แล้ว'; skipped++; results.push(detail); continue; }

                    const items = await q(
                        `SELECT icode, name, price, income FROM nondrugitems
                         WHERE nhso_adp_code = 'ER-EXT' AND istatus = '1' ORDER BY icode`, []);
                    if (!items.length) {
                        detail.skip = "ไม่พบรายการ ADP ER-EXT ที่เปิดใช้งาน (istatus='1')";
                        skipped++; results.push(detail); continue;
                    }
                    const it = items[0];
                    const price = Number(it.price || 0);

                    const want = {
                        vn: v.vn, hn: v.hn, vstdate: v.vstdate, vsttime: v.vsttime,
                        icode: it.icode, qty: 1, unitprice: price, sum_price: price,
                        paidst: '02', income: it.income, doctor: v.doctor, staff: v.doctor,
                        pttype: v.pttype
                    };
                    const cols = Object.keys(want).filter(c => oprCols.has(c));
                    const vals = cols.map(c => want[c]);
                    const marks = cols.map((_, i) => isPg ? `$${i + 1}` : '?').join(',');
                    await q(`INSERT INTO opitemrece (${cols.join(',')}) VALUES (${marks})`, vals);

                    detail.added = `icode ${it.icode} ราคา ${price}`;
                    added++;
                } catch (e) {
                    detail.error = e.message; failed++; errors.push(`${vn}: ${e.message}`);
                }
                results.push(detail);
            }
        } finally {
            await conn.end();
        }

        res.json({ success: true, added: added, skipped: skipped, failed: failed, errors: errors, results: results, codes: ['ER-EXT'] });
    } catch (error) {
        console.error('add-feeschedule-er-erext error:', error);
        res.json({ success: false, error: error.message });
    } finally {
        unlock();
    }
});

// ============================================================================
// ER คุณภาพ — Tools ลบค่าใช้จ่าย ADP WALKIN ออกจากวิสิตที่เลือก
// ============================================================================
app.post('/api/delete-feeschedule-er-walkin', async (req, res) => {
    try {
        const { host, port, database, user, password, type, vns } = req.body;
        if (!vns || !vns.length) return res.json({ success: false, error: 'ไม่มีรายการที่เลือก' });

        const SUB = `SELECT icode FROM nondrugitems WHERE nhso_adp_code = 'WALKIN'`;
        let deleted = 0, removedRows = 0, failed = 0;
        const errors = [];

        if (type === 'postgresql') {
            const client = new PgClient({ host, port: parseInt(port), database, user, password, connectionTimeoutMillis: 30000 });
            await client.connect();
            for (const vn of vns) {
                try {
                    const r = await client.query(`DELETE FROM opitemrece WHERE vn = $1 AND icode IN (${SUB})`, [vn]);
                    deleted++; removedRows += (r.rowCount || 0);
                } catch (e) { failed++; errors.push(`${vn}: ${e.message}`); }
            }
            await client.end();
        } else {
            const connection = await mysql.createConnection({ host, port, user, password, database, connectTimeout: 30000 });
            for (const vn of vns) {
                try {
                    const [r] = await connection.execute(`DELETE FROM opitemrece WHERE vn = ? AND icode IN (${SUB})`, [vn]);
                    deleted++; removedRows += (r.affectedRows || 0);
                } catch (e) { failed++; errors.push(`${vn}: ${e.message}`); }
            }
            await connection.end();
        }

        res.json({ success: true, deleted: deleted, removedRows: removedRows, failed: failed, errors: errors });
    } catch (error) {
        console.error('delete-feeschedule-er-walkin error:', error);
        res.json({ success: false, error: error.message });
    }
});

// ---- รายชื่อสิทธิที่เปิดใช้งาน สำหรับแผงตั้งค่ากรองตามสิทธิ ----
app.post('/api/get-pttype-active-list', async (req, res) => {
    try {
        const rows = await fsRun(req.body, `
            SELECT pttype, name, hipdata_code
            FROM pttype
            WHERE isuse = 'Y'
            ORDER BY pttype
        `, []);
        res.json({ success: true, data: rows, count: rows.length });
    } catch (error) {
        console.error('pttype-active-list error:', error);
        res.json({ success: false, error: error.message });
    }
});

// Shutdown endpoint — used by ปิดระบบ.vbs
app.post('/api/shutdown', (req, res) => {
    res.json({ success: true });
    setTimeout(() => process.exit(0), 300);
});

// Start server
app.listen(PORT, () => {
    console.log(`✅ Pre Check Export - พร้อมใช้งาน`);
    console.log(`🌐 เปิดเบราว์เซอร์ที่: http://localhost:${PORT}`);
    console.log(`   *** อย่าปิดหน้าต่างนี้ขณะใช้งาน ***`);
});
