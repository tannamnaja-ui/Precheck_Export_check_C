// ==================== Database Connection Check ====================

// Check if database is connected
function isDatabaseConnected() {
    const saved = localStorage.getItem('dbConnection');
    return saved !== null;
}

// Get database connection config
function getDatabaseConfig() {
    const saved = localStorage.getItem('dbConnection');
    if (!saved) return null;
    return JSON.parse(saved);
}

// Show database connection warning
function showDatabaseWarning() {
    alert('⚠️ ยังไม่ได้เชื่อมต่อฐานข้อมูล\n\nกรุณากลับไปหน้าหลักเพื่อเชื่อมต่อฐานข้อมูลก่อนใช้งาน');
    window.location.href = 'index.html';
    return false;
}

// Fetch data from database (Backend API call)
async function fetchDataFromDatabase(query, params = {}) {
    const config = getDatabaseConfig();
    if (!config) {
        throw new Error('ไม่พบการตั้งค่าการเชื่อมต่อฐานข้อมูล');
    }

    // In production, this should call your backend API
    console.log('📊 Database Query:', query);
    console.log('📋 Parameters:', params);
    console.log('🔗 Using config:', config);

    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, 300));

    // Return simulated data for now
    return { success: true, data: [], message: 'Database connection ready - implement backend API' };
}

// Check database connection on page load
window.addEventListener('DOMContentLoaded', function() {
    if (!isDatabaseConnected()) {
        showDatabaseWarning();
        return;
    }

    // Show connection status
    const config = getDatabaseConfig();
    console.log('✅ Database connected:', config.type.toUpperCase(), '-', config.host);
});

// ==================== Sample Data (for reference) ====================
// ข้อมูลตัวอย่างสำหรับตรวจสอบป้องกันการติด C
const menuData = {
    csop: {
        title: 'ข้าราชการผู้ป่วยนอก (CSOP)',
        description: 'ตรวจสอบป้องกันการติด C สำหรับข้าราชการผู้ป่วยนอก',
        stats: {
            total: 150,
            correct: 120,
            needFix: 25,
            pending: 5
        },
        data: [
            { id: 1, hn: 'HN001', name: 'สมชาย ใจดี', date: '2026-03-23', status: 'ปลอดภัย', risk: 'ต่ำ', amount: '1,500' },
            { id: 2, hn: 'HN002', name: 'สมหญิง รักสุข', date: '2026-03-23', status: 'เสี่ยง', risk: 'สูง', amount: '2,300' },
            { id: 3, hn: 'HN003', name: 'สมศักดิ์ มั่นคง', date: '2026-03-22', status: 'ปลอดภัย', risk: 'ต่ำ', amount: '1,800' }
        ]
    },
    cipn: {
        title: 'ข้าราชการผู้ป่วยใน (CIPN)',
        description: 'ตรวจสอบป้องกันการติด C สำหรับข้าราชการผู้ป่วยใน',
        stats: {
            total: 85,
            correct: 68,
            needFix: 12,
            pending: 5
        },
        data: [
            { id: 1, hn: 'HN101', name: 'วิชัย สุขสันต์', date: '2026-03-20', status: 'ปลอดภัย', risk: 'ต่ำ', amount: '15,000', days: '3' },
            { id: 2, hn: 'HN102', name: 'สุภา ดีงาม', date: '2026-03-21', status: 'เสี่ยง', risk: 'กลาง', amount: '22,500', days: '5' }
        ]
    },
    ssop: {
        title: 'ประกันสังคมผู้ป่วยนอก (SSOP)',
        description: 'ตรวจสอบป้องกันการติด C สำหรับประกันสังคมผู้ป่วยนอก',
        stats: {
            total: 220,
            correct: 190,
            needFix: 28,
            pending: 2
        },
        data: [
            { id: 1, hn: 'HN201', name: 'ประยุทธ์ มั่งมี', date: '2026-03-23', status: 'เสี่ยง', risk: 'สูง', amount: '800' },
            { id: 2, hn: 'HN202', name: 'สุดา เจริญ', date: '2026-03-23', status: 'ปลอดภัย', risk: 'ต่ำ', amount: '950' },
            { id: 3, hn: 'HN203', name: 'อนุชา ดีมาก', date: '2026-03-22', status: 'ปลอดภัย', risk: 'ต่ำ', amount: '1,200' }
        ]
    },
    aipn: {
        title: 'ประกันสังคมผู้ป่วยใน (AIPN)',
        description: 'ตรวจสอบป้องกันการติด C สำหรับประกันสังคมผู้ป่วยใน',
        stats: {
            total: 65,
            correct: 50,
            needFix: 10,
            pending: 5
        },
        data: [
            { id: 1, hn: 'HN301', name: 'ชัยวัฒน์ รุ่งเรือง', date: '2026-03-19', status: 'ปลอดภัย', risk: 'ต่ำ', amount: '18,000', days: '4' },
            { id: 2, hn: 'HN302', name: 'พิมพ์ใจ สวยงาม', date: '2026-03-20', status: 'เสี่ยง', risk: 'กลาง', amount: '25,000', days: '6' }
        ]
    },
    fdh: {
        title: 'FDH',
        description: 'ตรวจสอบป้องกันการติด C สำหรับ FDH',
        stats: {
            total: 45,
            correct: 38,
            needFix: 5,
            pending: 2
        },
        data: [
            { id: 1, hn: 'HN401', name: 'สุรชัย บุญมี', date: '2026-03-23', status: 'ปลอดภัย', risk: 'ต่ำ', amount: '3,500' },
            { id: 2, hn: 'HN402', name: 'กมลชนก สุขใจ', date: '2026-03-23', status: 'ปลอดภัย', risk: 'ต่ำ', amount: '4,200' }
        ]
    },
    eclaim: {
        title: 'E-Claim',
        description: 'ตรวจสอบป้องกันการติด C สำหรับ E-Claim',
        stats: {
            total: 180,
            correct: 150,
            needFix: 24,
            pending: 6
        },
        data: [
            { id: 1, hn: 'HN501', name: 'วิไล ใจดี', date: '2026-03-23', status: 'เสี่ยง', risk: 'สูง', amount: '2,800' },
            { id: 2, hn: 'HN502', name: 'ประเสริฐ สุขสม', date: '2026-03-22', status: 'ปลอดภัย', risk: 'ต่ำ', amount: '3,100' },
            { id: 3, hn: 'HN503', name: 'สมพร ดีใจ', date: '2026-03-23', status: 'ปลอดภัย', risk: 'ต่ำ', amount: '1,900' }
        ]
    },
    feeschedule: {
        title: 'Fee Schedule',
        description: 'ตรวจสอบป้องกันการติด C สำหรับ Fee Schedule',
        stats: {
            total: 320,
            correct: 295,
            needFix: 20,
            pending: 5
        },
        data: [
            { id: 1, code: 'FS001', name: 'ค่าตรวจรักษาทั่วไป', price: '500', status: 'ปลอดภัย', risk: 'ต่ำ' },
            { id: 2, code: 'FS002', name: 'ค่าห้องตรวจ', price: '300', status: 'ปลอดภัย', risk: 'ต่ำ' },
            { id: 3, code: 'FS003', name: 'ค่ายา', price: '800', status: 'เสี่ยง', risk: 'กลาง' }
        ]
    }
};

let selectedMenu = null;

// จัดการคลิกเมนู - ไปหน้าใหม่แทน
document.querySelectorAll('.menu-card').forEach(card => {
    card.addEventListener('click', function() {
        // Check database connection first
        if (!isDatabaseConnected()) {
            showDatabaseWarning();
            return;
        }

        // ดึงข้อมูลเมนูที่เลือก
        const menuType = this.getAttribute('data-menu');

        // ไปหน้าของกองทุนที่เลือก (fdh ใช้หน้าแยกของ check_edit)
        window.location.href = menuType === 'fdh' ? 'check_edit_fdh.html' : `check_c_${menuType}.html`;
    });
});

// ฟังก์ชันค้นหาข้อมูล
function searchData() {
    const dateFrom = document.getElementById('dateFrom').value;
    const dateTo = document.getElementById('dateTo').value;

    if (!dateFrom || !dateTo) {
        alert('กรุณาเลือกวันที่เริ่มต้นและวันที่สิ้นสุด');
        return;
    }

    if (!selectedMenu) {
        alert('กรุณาเลือกระบบที่ต้องการตรวจสอบ');
        return;
    }

    // แสดงข้อมูล
    displayMenuContent(selectedMenu);
}

// ฟังก์ชันยกเลิกการเลือก
function clearSelection() {
    selectedMenu = null;
    document.querySelectorAll('.menu-card').forEach(c => c.classList.remove('active'));
    document.getElementById('filter-panel').classList.remove('show');
    document.getElementById('menu-grid').style.display = 'grid';
    document.getElementById('selected-system').textContent = 'กรุณาเลือกระบบที่ต้องการตรวจสอบ';

    const contentArea = document.getElementById('content-area');
    contentArea.innerHTML = `
        <div class="welcome-message">
            <h2>ยินดีต้อนรับ</h2>
            <p>กรุณาเลือกระบบที่ต้องการตรวจสอบป้องกันการติด C</p>
        </div>
    `;
}

// ฟังก์ชันแสดงเนื้อหาตามเมนูที่เลือก
function displayMenuContent(menuType) {
    const contentArea = document.getElementById('content-area');
    const menuInfo = menuData[menuType];
    const dateFrom = document.getElementById('dateFrom').value;
    const dateTo = document.getElementById('dateTo').value;

    if (!menuInfo) {
        contentArea.innerHTML = '<div class="welcome-message"><h2>ไม่พบข้อมูล</h2></div>';
        return;
    }

    // สร้าง Dashboard
    const dashboardHTML = `
        <div class="dashboard">
            <div class="stat-card stat-total">
                <div class="stat-icon">👥</div>
                <div class="stat-info">
                    <h3>ผู้รับบริการทั้งหมด</h3>
                    <p class="stat-number">${menuInfo.stats.total.toLocaleString()}</p>
                </div>
            </div>
            <div class="stat-card stat-correct">
                <div class="stat-icon">✅</div>
                <div class="stat-info">
                    <h3>ข้อมูลถูกต้อง</h3>
                    <p class="stat-number">${menuInfo.stats.correct.toLocaleString()}</p>
                </div>
            </div>
            <div class="stat-card stat-needfix">
                <div class="stat-icon">⚠️</div>
                <div class="stat-info">
                    <h3>ต้องแก้ไข</h3>
                    <p class="stat-number">${menuInfo.stats.needFix.toLocaleString()}</p>
                </div>
            </div>
            <div class="stat-card stat-pending">
                <div class="stat-icon">⏳</div>
                <div class="stat-info">
                    <h3>รอดำเนินการ</h3>
                    <p class="stat-number">${menuInfo.stats.pending.toLocaleString()}</p>
                </div>
            </div>
        </div>
    `;

    let tableHTML = '';

    // สร้างตารางตามประเภทข้อมูล
    if (menuType === 'feeschedule') {
        // ตาราง Fee Schedule
        tableHTML = `
            <div class="data-section">
                <h2>${menuInfo.title}</h2>
                <p>${menuInfo.description}</p>
                <p><strong>ช่วงวันที่:</strong> ${dateFrom} ถึง ${dateTo}</p>

                ${dashboardHTML}

                <div class="alert-info" style="background: linear-gradient(135deg, #e3f2fd 0%, #bbdefb 100%); padding: 16px 20px; border-radius: 10px; margin: 15px 0; box-shadow: 0 2px 8px rgba(66, 165, 245, 0.15);">
                    <strong>คำเตือน:</strong> ตรวจสอบรายการที่มีความเสี่ยงก่อนการส่งออก
                </div>

                <table class="data-table">
                    <thead>
                        <tr>
                            <th>รหัส</th>
                            <th>รายการ</th>
                            <th>ราคา (บาท)</th>
                            <th>ระดับความเสี่ยง</th>
                            <th>สถานะ</th>
                            <th>จัดการ</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${menuInfo.data.map(item => `
                            <tr>
                                <td>${item.code}</td>
                                <td>${item.name}</td>
                                <td>${item.price}</td>
                                <td><span class="risk-badge risk-${item.risk.toLowerCase()}">${item.risk}</span></td>
                                <td><span class="status-badge ${item.status === 'เสี่ยง' ? 'status-risk' : ''}">${item.status}</span></td>
                                <td>
                                    <button class="btn-check" onclick="checkItem('${menuType}', ${item.id})">ตรวจสอบ</button>
                                    <button class="btn-export" onclick="viewDetail('${menuType}', ${item.id})">รายละเอียด</button>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>

                <div style="margin-top: 20px; text-align: right;">
                    <button class="btn-export" onclick="generateReport('${menuType}')">สร้างรายงาน</button>
                </div>
            </div>
        `;
    } else if (menuType === 'cipn' || menuType === 'aipn') {
        // ตารางผู้ป่วยใน (มีจำนวนวันนอน)
        tableHTML = `
            <div class="data-section">
                <h2>${menuInfo.title}</h2>
                <p>${menuInfo.description}</p>
                <p><strong>ช่วงวันที่:</strong> ${dateFrom} ถึง ${dateTo}</p>

                ${dashboardHTML}

                <div class="alert-info" style="background: linear-gradient(135deg, #e3f2fd 0%, #bbdefb 100%); padding: 16px 20px; border-radius: 10px; margin: 15px 0; box-shadow: 0 2px 8px rgba(66, 165, 245, 0.15);">
                    <strong>คำเตือน:</strong> ตรวจสอบรายการที่มีความเสี่ยงก่อนการส่งออก
                </div>

                <table class="data-table">
                    <thead>
                        <tr>
                            <th>HN</th>
                            <th>ชื่อ-นามสกุล</th>
                            <th>วันที่รับบริการ</th>
                            <th>จำนวนวัน</th>
                            <th>ยอดเงิน (บาท)</th>
                            <th>ระดับความเสี่ยง</th>
                            <th>สถานะ</th>
                            <th>จัดการ</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${menuInfo.data.map(item => `
                            <tr>
                                <td>${item.hn}</td>
                                <td>${item.name}</td>
                                <td>${item.date}</td>
                                <td>${item.days}</td>
                                <td>${item.amount}</td>
                                <td><span class="risk-badge risk-${item.risk.toLowerCase()}">${item.risk}</span></td>
                                <td><span class="status-badge ${item.status === 'เสี่ยง' ? 'status-risk' : ''}">${item.status}</span></td>
                                <td>
                                    <button class="btn-check" onclick="checkItem('${menuType}', ${item.id})">ตรวจสอบ</button>
                                    <button class="btn-export" onclick="viewDetail('${menuType}', ${item.id})">รายละเอียด</button>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>

                <div style="margin-top: 20px; text-align: right;">
                    <button class="btn-export" onclick="generateReport('${menuType}')">สร้างรายงาน</button>
                </div>
            </div>
        `;
    } else {
        // ตารางผู้ป่วยนอก
        tableHTML = `
            <div class="data-section">
                <h2>${menuInfo.title}</h2>
                <p>${menuInfo.description}</p>
                <p><strong>ช่วงวันที่:</strong> ${dateFrom} ถึง ${dateTo}</p>

                ${dashboardHTML}

                <div class="alert-info" style="background: linear-gradient(135deg, #e3f2fd 0%, #bbdefb 100%); padding: 16px 20px; border-radius: 10px; margin: 15px 0; box-shadow: 0 2px 8px rgba(66, 165, 245, 0.15);">
                    <strong>คำเตือน:</strong> ตรวจสอบรายการที่มีความเสี่ยงก่อนการส่งออก
                </div>

                <table class="data-table">
                    <thead>
                        <tr>
                            <th>HN</th>
                            <th>ชื่อ-นามสกุล</th>
                            <th>วันที่รับบริการ</th>
                            <th>ยอดเงิน (บาท)</th>
                            <th>ระดับความเสี่ยง</th>
                            <th>สถานะ</th>
                            <th>จัดการ</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${menuInfo.data.map(item => `
                            <tr>
                                <td>${item.hn}</td>
                                <td>${item.name}</td>
                                <td>${item.date}</td>
                                <td>${item.amount}</td>
                                <td><span class="risk-badge risk-${item.risk.toLowerCase()}">${item.risk}</span></td>
                                <td><span class="status-badge ${item.status === 'เสี่ยง' ? 'status-risk' : ''}">${item.status}</span></td>
                                <td>
                                    <button class="btn-check" onclick="checkItem('${menuType}', ${item.id})">ตรวจสอบ</button>
                                    <button class="btn-export" onclick="viewDetail('${menuType}', ${item.id})">รายละเอียด</button>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>

                <div style="margin-top: 20px; text-align: right;">
                    <button class="btn-export" onclick="generateReport('${menuType}')">สร้างรายงาน</button>
                </div>
            </div>
        `;
    }

    contentArea.innerHTML = tableHTML;
}

// ฟังก์ชันตรวจสอบรายการ
function checkItem(menuType, itemId) {
    alert(`กำลังตรวจสอบรายละเอียดการป้องกันการติด C สำหรับ ${menuType.toUpperCase()} รหัส ${itemId}`);
}

// ฟังก์ชันดูรายละเอียด
function viewDetail(menuType, itemId) {
    alert(`แสดงรายละเอียดการป้องกันการติด C สำหรับ ${menuType.toUpperCase()} รหัส ${itemId}`);
}

// ฟังก์ชันสร้างรายงาน
function generateReport(menuType) {
    const confirmed = confirm(`ต้องการสร้างรายงานการตรวจสอบป้องกันการติด C สำหรับ ${menuType.toUpperCase()} ใช่หรือไม่?`);
    if (confirmed) {
        alert(`กำลังสร้างรายงาน ${menuType.toUpperCase()}`);
    }
}
