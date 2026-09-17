// ============================================================================
// API Guard — แนบ token + เข้ารหัส payload ให้ทุก request ที่ยิงไป /api/
// ----------------------------------------------------------------------------
//  ไฟล์นี้ครอบ window.fetch ไว้ตัวเดียว หน้าเว็บทุกหน้าจึงไม่ต้องแก้จุดเรียก API
//  เลยสักจุด (ทั้งระบบมีราว 600 จุด) โค้ดเดิมยังเรียก fetch / res.json() ตามปกติ
//
//  ขาไป : POST /api/xxx  ->  body ถูกเข้ารหัส AES-256-GCM แล้วแนบ X-PreEX-Token
//  ขากลับ: server ส่ง envelope เข้ารหัสกลับมา -> ถอดแล้วคืนเป็น Response ปกติ
//          โค้ดหน้าเว็บจึงได้ JSON เหมือนเดิม จอแสดงผลปกติทุกอย่าง
//
//  key ที่ใช้เข้ารหัส = SHA-256(token) ดังนั้นคนที่ไม่มี token จะถอดไม่ออก
//  ต้องโหลดไฟล์นี้เป็น script ตัวแรกของหน้า (อยู่ใน <head>) ก่อนโค้ดอื่นเรียก fetch
// ============================================================================
(function () {
    'use strict';

    var TOKEN_KEY = 'preexApiToken';
    var HEADER = 'X-PreEX-Token';
    var origFetch = window.fetch.bind(window);

    // crypto.subtle มีเฉพาะ secure context (https หรือ http://localhost)
    // ถ้าเปิดผ่าน IP ในวง LAN จะไม่มี -> ถอยไปโหมดแนบ token อย่างเดียว
    // ฝั่ง server รับได้ทั้ง body ธรรมดาและ body เข้ารหัส จึงยังใช้งานได้ปกติ
    var subtle = (window.crypto && window.crypto.subtle) ? window.crypto.subtle : null;

    function getToken() {
        try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; }
    }
    function setToken(t) {
        try { localStorage.setItem(TOKEN_KEY, t || ''); } catch (e) {}
        cachedKey = null; cachedKeyToken = null;
    }
    function clearToken() {
        try { localStorage.removeItem(TOKEN_KEY); } catch (e) {}
        cachedKey = null; cachedKeyToken = null;
    }

    // ---------------------------------------------------------------- helpers
    var cachedKey = null, cachedKeyToken = null;

    async function importKey(token) {
        if (cachedKey && cachedKeyToken === token) return cachedKey;
        var enc = new TextEncoder().encode(token);
        var hash = await subtle.digest('SHA-256', enc);
        cachedKey = await subtle.importKey('raw', hash, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
        cachedKeyToken = token;
        return cachedKey;
    }

    function bytesToHex(buf) {
        var b = new Uint8Array(buf), out = '';
        for (var i = 0; i < b.length; i++) out += b[i].toString(16).padStart(2, '0');
        return out;
    }
    function hexToBytes(hex) {
        var out = new Uint8Array(hex.length / 2);
        for (var i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
        return out;
    }
    function bytesToB64(buf) {
        var b = new Uint8Array(buf), s = '';
        for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
        return btoa(s);
    }
    function b64ToBytes(b64) {
        var s = atob(b64), out = new Uint8Array(s.length);
        for (var i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
        return out;
    }

    // WebCrypto ต่อ tag (16 ไบต์ท้าย) ไว้กับ ciphertext ส่วน Node แยกกัน
    // จึงต้องตัด/ต่อ tag ตรงนี้ให้ตรงกันสองฝั่ง
    async function encryptBody(plainText, token) {
        var key = await importKey(token);
        var iv = window.crypto.getRandomValues(new Uint8Array(12));
        var ct = new Uint8Array(await subtle.encrypt(
            { name: 'AES-GCM', iv: iv }, key, new TextEncoder().encode(plainText)));
        return JSON.stringify({
            __enc: 1,
            iv: bytesToHex(iv),
            data: bytesToB64(ct.slice(0, ct.length - 16)),
            tag: bytesToHex(ct.slice(ct.length - 16))
        });
    }

    async function decryptBody(env, token) {
        var key = await importKey(token);
        var data = b64ToBytes(env.data), tag = hexToBytes(env.tag);
        var joined = new Uint8Array(data.length + tag.length);
        joined.set(data, 0); joined.set(tag, data.length);
        var plain = await subtle.decrypt({ name: 'AES-GCM', iv: hexToBytes(env.iv) }, key, joined);
        return new TextDecoder().decode(plain);
    }

    function isApiCall(url) {
        try {
            var u = new URL(url, window.location.href);
            return u.origin === window.location.origin && u.pathname.indexOf('/api/') === 0;
        } catch (e) {
            return typeof url === 'string' && url.indexOf('/api/') !== -1;
        }
    }

    // ------------------------------------------------------------ fetch wrapper
    window.fetch = async function (input, init) {
        var url = (typeof input === 'string') ? input : (input && input.url);
        if (!isApiCall(url)) return origFetch(input, init);

        init = init || {};
        var token = getToken();
        var headers = new Headers(init.headers || (typeof input !== 'string' && input.headers) || {});
        if (token) headers.set(HEADER, token);

        var body = init.body;
        var encrypted = false;

        // เข้ารหัสเฉพาะ body ที่เป็น JSON string และมี token กับ subtle พร้อมใช้
        if (token && subtle && typeof body === 'string' && body.length) {
            try {
                body = await encryptBody(body, token);
                headers.set('Content-Type', 'application/json');
                encrypted = true;
            } catch (e) {
                body = init.body; // เข้ารหัสไม่ได้ -> ส่งแบบเดิม
            }
        }

        var res = await origFetch(url, Object.assign({}, init, { headers: headers, body: body }));

        // ขากลับ: ถ้าเป็น envelope เข้ารหัส ให้ถอดแล้วห่อเป็น Response ใหม่
        if (!encrypted || !token || !subtle) return res;

        var text = await res.clone().text();
        if (text.indexOf('"__enc"') === -1) return new Response(text, {
            status: res.status, statusText: res.statusText, headers: res.headers
        });
        try {
            var env = JSON.parse(text);
            if (env && env.__enc === 1) text = await decryptBody(env, token);
        } catch (e) { /* ถอดไม่ได้ -> คืนตามที่ได้มา */ }

        return new Response(text, {
            status: res.status, statusText: res.statusText, headers: res.headers
        });
    };

    // เปิดให้หน้าตั้งค่าเรียกใช้ได้
    window.PreEXToken = { get: getToken, set: setToken, clear: clearToken, header: HEADER };
})();
