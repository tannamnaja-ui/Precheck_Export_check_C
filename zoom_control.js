// ==================== Global Zoom Control ====================
(function () {
    const STORAGE_KEY = 'appZoomLevel';
    const MIN = 70, MAX = 150, STEP = 5, DEFAULT = 100;

    let zoom = parseInt(localStorage.getItem(STORAGE_KEY) || DEFAULT);
    zoom = Math.max(MIN, Math.min(MAX, zoom));

    // ห่อ content ทั้งหมดใน wrapper → zoom เฉพาะ wrapper ไม่กระทบ widget
    function ensureWrapper() {
        if (document.getElementById('_zoom_wrapper')) return document.getElementById('_zoom_wrapper');
        const wrapper = document.createElement('div');
        wrapper.id = '_zoom_wrapper';
        wrapper.style.transformOrigin = 'top left';
        // ย้ายทุก children ของ body เข้า wrapper (ยกเว้น widget ที่จะสร้างทีหลัง)
        while (document.body.firstChild) {
            wrapper.appendChild(document.body.firstChild);
        }
        document.body.appendChild(wrapper);
        return wrapper;
    }

    function applyZoom(z) {
        zoom = z;
        localStorage.setItem(STORAGE_KEY, z);

        const wrapper = document.getElementById('_zoom_wrapper');
        if (wrapper) {
            wrapper.style.zoom = z + '%';
        }

        const val = document.getElementById('_zc_val');
        const slider = document.getElementById('_zc_slider');
        if (val) val.textContent = z + '%';
        if (slider) slider.value = z;

        const plus  = document.getElementById('_zc_btn_plus');
        const minus = document.getElementById('_zc_btn_minus');
        if (plus)  plus.disabled  = z >= MAX;
        if (minus) minus.disabled = z <= MIN;
    }

    function buildWidget() {
        const w = document.createElement('div');
        w.id = '_zoom_widget';
        // widget ต้องอยู่นอก _zoom_wrapper จึงไม่ถูก zoom
        w.innerHTML = `
            <div id="_zc_inner" style="
                position:fixed; bottom:18px; left:18px; z-index:99999;
                background:linear-gradient(135deg,#1565c0,#1976d2);
                border-radius:28px; padding:7px 14px;
                display:flex; align-items:center; gap:8px;
                box-shadow:0 4px 20px rgba(21,101,192,0.45);
                user-select:none;
                font-family:'Segoe UI',Tahoma,sans-serif;
                font-size:14px;
            ">
                <span style="color:rgba(255,255,255,0.75);font-size:11px;font-weight:600;white-space:nowrap;">ขนาดตัวอักษร</span>
                <button id="_zc_btn_minus" onclick="_zcChange(-${STEP})"
                    style="width:26px;height:26px;border-radius:50%;border:none;background:rgba(255,255,255,0.2);
                    color:white;font-size:16px;font-weight:700;cursor:pointer;line-height:1;
                    display:flex;align-items:center;justify-content:center;"
                    onmouseover="this.style.background='rgba(255,255,255,0.35)'"
                    onmouseout="this.style.background='rgba(255,255,255,0.2)'">−</button>
                <input id="_zc_slider" type="range" min="${MIN}" max="${MAX}" step="${STEP}" value="${zoom}"
                    oninput="_zcChange(0, parseInt(this.value))"
                    style="width:80px; accent-color:white; cursor:pointer;">
                <span id="_zc_val" style="color:white;font-size:13px;font-weight:700;min-width:36px;text-align:center;">
                    ${zoom}%
                </span>
                <button id="_zc_btn_plus" onclick="_zcChange(${STEP})"
                    style="width:26px;height:26px;border-radius:50%;border:none;background:rgba(255,255,255,0.2);
                    color:white;font-size:16px;font-weight:700;cursor:pointer;line-height:1;
                    display:flex;align-items:center;justify-content:center;"
                    onmouseover="this.style.background='rgba(255,255,255,0.35)'"
                    onmouseout="this.style.background='rgba(255,255,255,0.2)'">＋</button>
                <button onclick="_zcReset()"
                    title="รีเซ็ต ${DEFAULT}%"
                    style="width:26px;height:26px;border-radius:50%;border:none;background:rgba(255,255,255,0.15);
                    color:white;font-size:11px;cursor:pointer;"
                    onmouseover="this.style.background='rgba(255,255,255,0.3)'"
                    onmouseout="this.style.background='rgba(255,255,255,0.15)'">↺</button>
            </div>`;
        document.body.appendChild(w); // widget อยู่นอก wrapper เสมอ
    }

    window._zcChange = function (delta, absolute) {
        let z = (absolute !== undefined) ? absolute : zoom + delta;
        z = Math.max(MIN, Math.min(MAX, z));
        applyZoom(z);
    };
    window._zcReset = function () { applyZoom(DEFAULT); };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    function init() {
        ensureWrapper(); // ห่อ content ก่อน
        buildWidget();   // สร้าง widget ทีหลัง (อยู่นอก wrapper)
        applyZoom(zoom); // apply zoom ที่ wrapper
    }
})();
