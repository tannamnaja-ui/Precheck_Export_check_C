// ข้อมูลตัวอย่างสำหรับแต่ละเมนู
const menuData = {
    csop: {
        title: 'ข้าราชการผู้ป่วยนอก (CSOP)',
        description: 'ตรวจสอบข้อมูลการส่งออกข้าราชการผู้ป่วยนอก',
        stats: {
            total: 150,
            correct: 120,
            needFix: 30,
            pending: 0
        },
        data: [
            { id: 1, hn: 'HN001', name: 'สมชาย ใจดี', date: '2026-03-23', status: 'รอตรวจสอบ', amount: '1,500' },
            { id: 2, hn: 'HN002', name: 'สมหญิง รักสุข', date: '2026-03-23', status: 'ผ่าน', amount: '2,300' },
            { id: 3, hn: 'HN003', name: 'สมศักดิ์ มั่นคง', date: '2026-03-22', status: 'รอตรวจสอบ', amount: '1,800' }
        ]
    },
    cipn: {
        title: 'ข้าราชการผู้ป่วยใน (CIPN)',
        description: 'ตรวจสอบข้อมูลการส่งออกข้าราชการผู้ป่วยใน',
        stats: {
            total: 85,
            correct: 70,
            needFix: 12,
            pending: 3
        },
        data: [
            { id: 1, hn: 'HN101', name: 'วิชัย สุขสันต์', date: '2026-03-20', status: 'รอตรวจสอบ', amount: '15,000', days: '3' },
            { id: 2, hn: 'HN102', name: 'สุภา ดีงาม', date: '2026-03-21', status: 'ผ่าน', amount: '22,500', days: '5' }
        ]
    },
    ssop: {
        title: 'ประกันสังคมผู้ป่วยนอก (SSOP)',
        description: 'ตรวจสอบข้อมูลการส่งออกประกันสังคมผู้ป่วยนอก',
        stats: {
            total: 220,
            correct: 195,
            needFix: 25,
            pending: 0
        },
        data: [
            { id: 1, hn: 'HN201', name: 'ประยุทธ์ มั่งมี', date: '2026-03-23', status: 'รอตรวจสอบ', amount: '800' },
            { id: 2, hn: 'HN202', name: 'สุดา เจริญ', date: '2026-03-23', status: 'ผ่าน', amount: '950' },
            { id: 3, hn: 'HN203', name: 'อนุชา ดีมาก', date: '2026-03-22', status: 'รอตรวจสอบ', amount: '1,200' }
        ]
    },
    aipn: {
        title: 'ประกันสังคมผู้ป่วยใน (AIPN)',
        description: 'ตรวจสอบข้อมูลการส่งออกประกันสังคมผู้ป่วยใน',
        stats: {
            total: 65,
            correct: 50,
            needFix: 10,
            pending: 5
        },
        data: [
            { id: 1, hn: 'HN301', name: 'ชัยวัฒน์ รุ่งเรือง', date: '2026-03-19', status: 'รอตรวจสอบ', amount: '18,000', days: '4' },
            { id: 2, hn: 'HN302', name: 'พิมพ์ใจ สวยงาม', date: '2026-03-20', status: 'ผ่าน', amount: '25,000', days: '6' }
        ]
    },
    fdh: {
        title: 'FDH',
        description: 'ตรวจสอบข้อมูลการส่งออก FDH',
        stats: {
            total: 45,
            correct: 40,
            needFix: 5,
            pending: 0
        },
        data: [
            { id: 1, hn: 'HN401', name: 'สุรชัย บุญมี', date: '2026-03-23', status: 'รอตรวจสอบ', amount: '3,500' },
            { id: 2, hn: 'HN402', name: 'กมลชนก สุขใจ', date: '2026-03-23', status: 'ผ่าน', amount: '4,200' }
        ]
    },
    eclaim: {
        title: 'E-Claim',
        description: 'ตรวจสอบข้อมูลการส่งออก E-Claim',
        stats: {
            total: 180,
            correct: 155,
            needFix: 20,
            pending: 5
        },
        data: [
            { id: 1, hn: 'HN501', name: 'วิไล ใจดี', date: '2026-03-23', status: 'รอตรวจสอบ', amount: '2,800' },
            { id: 2, hn: 'HN502', name: 'ประเสริฐ สุขสม', date: '2026-03-22', status: 'ผ่าน', amount: '3,100' },
            { id: 3, hn: 'HN503', name: 'สมพร ดีใจ', date: '2026-03-23', status: 'รอตรวจสอบ', amount: '1,900' }
        ]
    },
    feeschedule: {
        title: 'Fee Schedule',
        description: 'ตรวจสอบข้อมูล Fee Schedule',
        stats: {
            total: 320,
            correct: 300,
            needFix: 15,
            pending: 5
        },
        data: [
            { id: 1, code: 'FS001', name: 'ค่าตรวจรักษาทั่วไป', price: '500', status: 'ใช้งาน' },
            { id: 2, code: 'FS002', name: 'ค่าห้องตรวจ', price: '300', status: 'ใช้งาน' },
            { id: 3, code: 'FS003', name: 'ค่ายา', price: '800', status: 'ใช้งาน' }
        ]
    }
};

let selectedMenu = null;

// จัดการคลิกเมนู
document.querySelectorAll('.menu-card').forEach(card => {
    card.addEventListener('click', function() {
        // ลบ active class จากทุกการ์ด
        document.querySelectorAll('.menu-card').forEach(c => c.classList.remove('active'));

        // เพิ่ม active class ให้การ์ดที่เลือก
        this.classList.add('active');

        // ดึงข้อมูลเมนูที่เลือก
        const menuType = this.getAttribute('data-menu');
        selectedMenu = menuType;

        // แสดงชื่อระบบที่เลือก
        const menuTitle = this.querySelector('h3').textContent;
        const menuCode = this.querySelector('.menu-code').textContent;
        document.getElementById('selected-system').innerHTML = `
            <strong>ระบบที่เลือก:</strong><br>
            ${menuTitle} (${menuCode})
        `;

        // แสดงส่วนกรองวันที่
        document.getElementById('filter-panel').classList.add('show');

        // ตั้งค่าวันที่เริ่มต้น
        const today = new Date().toISOString().split('T')[0];
        document.getElementById('dateFrom').value = today;
        document.getElementById('dateTo').value = today;

        // ซ่อนเมนู
        document.getElementById('menu-grid').style.display = 'none';

        // แสดงข้อความให้เลือกวันที่
        const contentArea = document.getElementById('content-area');
        contentArea.innerHTML = `
            <div class="welcome-message">
                <h2>เลือกระบบเรียบร้อย</h2>
                <p>กรุณาเลือกวันที่ที่ต้องการตรวจสอบแล้วคลิกปุ่ม "ค้นหา"</p>
            </div>
        `;
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
            <p>กรุณาเลือกระบบที่ต้องการตรวจสอบข้อมูล</p>
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

                <table class="data-table">
                    <thead>
                        <tr>
                            <th>รหัส</th>
                            <th>รายการ</th>
                            <th>ราคา (บาท)</th>
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
                                <td><span class="status-badge">${item.status}</span></td>
                                <td>
                                    <button class="btn-check" onclick="checkItem('${menuType}', ${item.id})">ตรวจสอบ</button>
                                    <button class="btn-export" onclick="exportItem('${menuType}', ${item.id})">ส่งออก</button>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>

                <div style="margin-top: 20px; text-align: right;">
                    <button class="btn-export" onclick="exportAll('${menuType}')">ส่งออกทั้งหมด</button>
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

                <table class="data-table">
                    <thead>
                        <tr>
                            <th>HN</th>
                            <th>ชื่อ-นามสกุล</th>
                            <th>วันที่รับบริการ</th>
                            <th>จำนวนวัน</th>
                            <th>ยอดเงิน (บาท)</th>
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
                                <td><span class="status-badge">${item.status}</span></td>
                                <td>
                                    <button class="btn-check" onclick="checkItem('${menuType}', ${item.id})">ตรวจสอบ</button>
                                    <button class="btn-export" onclick="exportItem('${menuType}', ${item.id})">ส่งออก</button>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>

                <div style="margin-top: 20px; text-align: right;">
                    <button class="btn-export" onclick="exportAll('${menuType}')">ส่งออกทั้งหมด</button>
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

                <table class="data-table">
                    <thead>
                        <tr>
                            <th>HN</th>
                            <th>ชื่อ-นามสกุล</th>
                            <th>วันที่รับบริการ</th>
                            <th>ยอดเงิน (บาท)</th>
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
                                <td><span class="status-badge">${item.status}</span></td>
                                <td>
                                    <button class="btn-check" onclick="checkItem('${menuType}', ${item.id})">ตรวจสอบ</button>
                                    <button class="btn-export" onclick="exportItem('${menuType}', ${item.id})">ส่งออก</button>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>

                <div style="margin-top: 20px; text-align: right;">
                    <button class="btn-export" onclick="exportAll('${menuType}')">ส่งออกทั้งหมด</button>
                </div>
            </div>
        `;
    }

    contentArea.innerHTML = tableHTML;
}

// ฟังก์ชันตรวจสอบรายการ
function checkItem(menuType, itemId) {
    alert(`กำลังตรวจสอบข้อมูล ${menuType.toUpperCase()} รหัส ${itemId}`);
    // ที่นี่สามารถเพิ่มโค้ดสำหรับการตรวจสอบข้อมูลจริง
}

// ฟังก์ชันส่งออกรายการ
function exportItem(menuType, itemId) {
    alert(`กำลังส่งออกข้อมูล ${menuType.toUpperCase()} รหัส ${itemId}`);
    // ที่นี่สามารถเพิ่มโค้ดสำหรับการส่งออกข้อมูลจริง
}

// ฟังก์ชันส่งออกทั้งหมด
function exportAll(menuType) {
    const confirmed = confirm(`ต้องการส่งออกข้อมูล ${menuType.toUpperCase()} ทั้งหมดใช่หรือไม่?`);
    if (confirmed) {
        alert(`กำลังส่งออกข้อมูล ${menuType.toUpperCase()} ทั้งหมด`);
        // ที่นี่สามารถเพิ่มโค้ดสำหรับการส่งออกข้อมูลทั้งหมดจริง
    }
}
