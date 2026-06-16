// Database Connection Variables (must be declared first)
let isConnectionSuccessful = false;
let connectionConfig = null;

// Get API base URL from localStorage (set by user in connection form)
function getApiBase() {
    const saved = localStorage.getItem('dbConnection');
    if (saved) {
        const config = JSON.parse(saved);
        if (config.apiUrl) return config.apiUrl.replace(/\/$/, '');
    }
    return window.location.origin;
}

// For backwards compatibility
const API_BASE = getApiBase();

// ข้อมูลตัวอย่างสำหรับแต่ละเมนู
const menuData = {
    csop: {
        title: 'ข้าราชการผู้ป่วยนอก (CSOP)',
        description: 'ตรวจสอบข้อมูลการส่งออกข้าราชการผู้ป่วยนอก',
        data: [
            { id: 1, hn: 'HN001', name: 'สมชาย ใจดี', date: '2026-03-23', status: 'รอตรวจสอบ', amount: '1,500' },
            { id: 2, hn: 'HN002', name: 'สมหญิง รักสุข', date: '2026-03-23', status: 'ผ่าน', amount: '2,300' },
            { id: 3, hn: 'HN003', name: 'สมศักดิ์ มั่นคง', date: '2026-03-22', status: 'รอตรวจสอบ', amount: '1,800' }
        ]
    },
    cipn: {
        title: 'ข้าราชการผู้ป่วยใน (CIPN)',
        description: 'ตรวจสอบข้อมูลการส่งออกข้าราชการผู้ป่วยใน',
        data: [
            { id: 1, hn: 'HN101', name: 'วิชัย สุขสันต์', date: '2026-03-20', status: 'รอตรวจสอบ', amount: '15,000', days: '3' },
            { id: 2, hn: 'HN102', name: 'สุภา ดีงาม', date: '2026-03-21', status: 'ผ่าน', amount: '22,500', days: '5' }
        ]
    },
    ssop: {
        title: 'ประกันสังคมผู้ป่วยนอก (SSOP)',
        description: 'ตรวจสอบข้อมูลการส่งออกประกันสังคมผู้ป่วยนอก',
        data: [
            { id: 1, hn: 'HN201', name: 'ประยุทธ์ มั่งมี', date: '2026-03-23', status: 'รอตรวจสอบ', amount: '800' },
            { id: 2, hn: 'HN202', name: 'สุดา เจริญ', date: '2026-03-23', status: 'ผ่าน', amount: '950' },
            { id: 3, hn: 'HN203', name: 'อนุชา ดีมาก', date: '2026-03-22', status: 'รอตรวจสอบ', amount: '1,200' }
        ]
    },
    aipn: {
        title: 'ประกันสังคมผู้ป่วยใน (AIPN)',
        description: 'ตรวจสอบข้อมูลการส่งออกประกันสังคมผู้ป่วยใน',
        data: [
            { id: 1, hn: 'HN301', name: 'ชัยวัฒน์ รุ่งเรือง', date: '2026-03-19', status: 'รอตรวจสอบ', amount: '18,000', days: '4' },
            { id: 2, hn: 'HN302', name: 'พิมพ์ใจ สวยงาม', date: '2026-03-20', status: 'ผ่าน', amount: '25,000', days: '6' }
        ]
    },
    fdh: {
        title: 'FDH',
        description: 'ตรวจสอบข้อมูลการส่งออก FDH',
        data: [
            { id: 1, hn: 'HN401', name: 'สุรชัย บุญมี', date: '2026-03-23', status: 'รอตรวจสอบ', amount: '3,500' },
            { id: 2, hn: 'HN402', name: 'กมลชนก สุขใจ', date: '2026-03-23', status: 'ผ่าน', amount: '4,200' }
        ]
    },
    eclaim: {
        title: 'E-Claim',
        description: 'ตรวจสอบข้อมูลการส่งออก E-Claim',
        data: [
            { id: 1, hn: 'HN501', name: 'วิไล ใจดี', date: '2026-03-23', status: 'รอตรวจสอบ', amount: '2,800' },
            { id: 2, hn: 'HN502', name: 'ประเสริฐ สุขสม', date: '2026-03-22', status: 'ผ่าน', amount: '3,100' },
            { id: 3, hn: 'HN503', name: 'สมพร ดีใจ', date: '2026-03-23', status: 'รอตรวจสอบ', amount: '1,900' }
        ]
    },
    feeschedule: {
        title: 'Fee Schedule',
        description: 'ตรวจสอบข้อมูล Fee Schedule',
        data: [
            { id: 1, code: 'FS001', name: 'ค่าตรวจรักษาทั่วไป', price: '500', status: 'ใช้งาน' },
            { id: 2, code: 'FS002', name: 'ค่าห้องตรวจ', price: '300', status: 'ใช้งาน' },
            { id: 3, code: 'FS003', name: 'ค่ายา', price: '800', status: 'ใช้งาน' }
        ]
    }
};

// Initialize on page load
window.addEventListener('DOMContentLoaded', function() {
    // ตั้งค่าวันที่ปัจจุบัน (สำหรับหน้าที่มี date inputs เท่านั้น)
    const dateFromElement = document.getElementById('dateFrom');
    const dateToElement = document.getElementById('dateTo');

    if (dateFromElement && dateToElement) {
        const today = new Date().toISOString().split('T')[0];
        dateFromElement.value = today;
        dateToElement.value = today;
    }

    // โหลดสถานะการเชื่อมต่อฐานข้อมูล
    const saved = localStorage.getItem('dbConnection');
    if (saved) {
        const config = JSON.parse(saved);
        const statusElement = document.getElementById('connection-status');
        if (statusElement) {
            statusElement.textContent = `บันทึกแล้ว (${config.type.toUpperCase()})`;
            statusElement.style.color = '#4caf50';

            // Load hospital name from database
            loadHospitalName();
        }
    }

    // Auto-fill port based on database type
    const dbTypeElement = document.getElementById('db-type');
    if (dbTypeElement) {
        dbTypeElement.addEventListener('change', function() {
            const portInput = document.getElementById('db-port');
            if (this.value === 'mysql') {
                portInput.value = '3306';
            } else if (this.value === 'postgresql') {
                portInput.value = '5432';
            }
        });
    }
});

// จัดการคลิกเมนู
document.querySelectorAll('.menu-card').forEach(card => {
    card.addEventListener('click', function() {
        // ลบ active class จากทุกการ์ด
        document.querySelectorAll('.menu-card').forEach(c => c.classList.remove('active'));

        // เพิ่ม active class ให้การ์ดที่เลือก
        this.classList.add('active');

        // ดึงข้อมูลเมนูที่เลือก
        const menuType = this.getAttribute('data-menu');
        displayMenuContent(menuType);
    });
});

// ฟังก์ชันแสดงเนื้อหาตามเมนูที่เลือก
function displayMenuContent(menuType) {
    const contentArea = document.getElementById('content-area');
    const menuInfo = menuData[menuType];

    if (!menuInfo) {
        contentArea.innerHTML = '<div class="welcome-message"><h2>ไม่พบข้อมูล</h2></div>';
        return;
    }

    let tableHTML = '';

    // สร้างตารางตามประเภทข้อมูล
    if (menuType === 'feeschedule') {
        // ตาราง Fee Schedule
        tableHTML = `
            <div class="data-section">
                <h2>${menuInfo.title}</h2>
                <p>${menuInfo.description}</p>

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

// ฟังก์ชันค้นหาตามวันที่
const searchBtn = document.querySelector('.btn-search');
if (searchBtn) {
    searchBtn.addEventListener('click', function() {
        const dateFrom = document.getElementById('dateFrom').value;
        const dateTo = document.getElementById('dateTo').value;

        if (!dateFrom || !dateTo) {
            alert('กรุณาเลือกวันที่เริ่มต้นและวันที่สิ้นสุด');
            return;
        }

        alert(`กำลังค้นหาข้อมูลตั้งแต่ ${dateFrom} ถึง ${dateTo}`);
        // ที่นี่สามารถเพิ่มโค้ดสำหรับการค้นหาข้อมูลตามวันที่จริง
    });
}

// Database Connection Functions
// Variables declared at the top of the file

// Open database modal
function openDatabaseModal() {
    const modal = document.getElementById('database-modal');
    if (!modal) return; // ถ้าไม่มี modal ให้หยุดทำงาน

    modal.classList.add('show');
    modal.style.display = 'flex';

    // Load saved config if exists
    loadSavedConfig();
}

// Close database modal
function closeDatabaseModal() {
    const modal = document.getElementById('database-modal');
    if (!modal) return; // ถ้าไม่มี modal ให้หยุดทำงาน

    modal.classList.remove('show');
    setTimeout(() => {
        modal.style.display = 'none';
    }, 300);
}

// Close modal when clicking outside
window.onclick = function(event) {
    const modal = document.getElementById('database-modal');
    if (modal && event.target === modal) {
        closeDatabaseModal();
    }
}

// Test database connection
function testConnection() {
    console.log('testConnection() called');

    const dbTypeEl = document.getElementById('db-type');
    const dbHostEl = document.getElementById('db-host');
    const dbPortEl = document.getElementById('db-port');
    const dbNameEl = document.getElementById('db-name');
    const dbUserEl = document.getElementById('db-user');
    const dbPasswordEl = document.getElementById('db-password');

    // ตรวจสอบว่ามี elements หรือไม่ (ถ้าไม่อยู่ในหน้า index.html ให้หยุด)
    if (!dbTypeEl || !dbHostEl || !dbPortEl || !dbNameEl || !dbUserEl || !dbPasswordEl) {
        console.log('Database form elements not found - skipping testConnection');
        return;
    }

    const apiUrlEl = document.getElementById('api-url');
    const apiUrl = (apiUrlEl && apiUrlEl.value.trim()) ? apiUrlEl.value.trim().replace(/\/$/, '') : window.location.origin;

    const dbType = dbTypeEl.value;
    const dbHost = dbHostEl.value;
    const dbPort = dbPortEl.value;
    const dbName = dbNameEl.value;
    const dbUser = dbUserEl.value;
    const dbPassword = dbPasswordEl.value;

    console.log('Form values:', { apiUrl, dbType, dbHost, dbPort, dbName, dbUser });

    // Validate inputs (password can be empty)
    if (!dbType || !dbHost || !dbPort || !dbName || !dbUser) {
        console.log('Validation failed - missing fields');
        showConnectionStatus('error', 'กรุณากรอกข้อมูลให้ครบถ้วน (รหัสผ่านสามารถเว้นว่างได้)');
        return;
    }

    // Add loading state and disable button
    const testBtn = document.querySelector('.btn-test');
    const statusBox = document.getElementById('connection-result');

    if (testBtn) {
        testBtn.classList.add('loading');
        testBtn.textContent = 'กำลังทดสอบ...';
        testBtn.disabled = true;
    }

    // Hide previous status
    if (statusBox) {
        statusBox.style.display = 'none';
    }

    // Call Backend API to test connection
    fetch(`${apiUrl}/api/test-connection`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            type: dbType,
            host: dbHost,
            port: parseInt(dbPort),
            database: dbName,
            user: dbUser,
            password: dbPassword
        })
    })
    .then(response => response.json())
    .then(data => {
        console.log('API Response:', data);

        // Remove loading state and enable button
        if (testBtn) {
            testBtn.classList.remove('loading');
            testBtn.textContent = 'ทดสอบการเชื่อมต่อ';
            testBtn.disabled = false;
        }

        if (data.success) {
            console.log('Connection successful!');
            isConnectionSuccessful = true;
            connectionConfig = {
                apiUrl: apiUrl,
                type: dbType,
                host: dbHost,
                port: dbPort,
                database: dbName,
                user: dbUser,
                password: dbPassword
            };

            // Save connection to localStorage automatically after successful test
            localStorage.setItem('dbConnection', JSON.stringify(connectionConfig));
            console.log('✅ Connection saved to localStorage');

            // Update connection status in sidebar
            const statusElement = document.getElementById('connection-status');
            if (statusElement) {
                statusElement.textContent = `เชื่อมต่อแล้ว (${dbType.toUpperCase()})`;
                statusElement.style.color = '#4caf50';
            }

            showConnectionStatus('success', `<strong>✅ เชื่อมต่อสำเร็จ!</strong><br><br>ฐานข้อมูล: <strong>${dbType.toUpperCase()}</strong><br>Server: <strong>${dbHost}:${dbPort}</strong><br>Database: <strong>${dbName}</strong>`);

            // Load hospital name after successful connection
            setTimeout(() => {
                loadHospitalName();
            }, 300);
        } else {
            console.log('Connection failed:', data.error);
            isConnectionSuccessful = false;
            showConnectionStatus('error', `<strong>❌ เชื่อมต่อไม่สำเร็จ</strong><br><br><strong>สาเหตุ:</strong> ${data.error}`);
        }
    })
    .catch(error => {
        console.error('API Error:', error);

        // Remove loading state and enable button
        if (testBtn) {
            testBtn.classList.remove('loading');
            testBtn.textContent = 'ทดสอบการเชื่อมต่อ';
            testBtn.disabled = false;
        }

        isConnectionSuccessful = false;
        showConnectionStatus('error', `<strong>❌ ไม่สามารถเชื่อมต่อ Backend API ได้</strong><br><br><strong>สาเหตุ:</strong> Backend server ยังไม่ทำงาน<br><br>💡 กรุณาเปิด Backend server ก่อน:<br><code>node api_example_nodejs.js</code>`);
    });
}

// Validate connection (simulation)
function validateConnection(host, port, database, user, password) {
    // This is a simulation. In real implementation, this should call backend API

    // Simulate various error conditions
    if (host.trim() === '') {
        return { success: false, error: 'IP Server ไม่ถูกต้อง' };
    }

    if (port < 1 || port > 65535) {
        return { success: false, error: 'Port ไม่อยู่ในช่วงที่ถูกต้อง (1-65535)' };
    }

    if (database.trim() === '') {
        return { success: false, error: 'ชื่อฐานข้อมูลไม่ถูกต้อง' };
    }

    if (user.trim() === '') {
        return { success: false, error: 'ชื่อผู้ใช้ไม่ถูกต้อง' };
    }

    // Simulate authentication error
    if (password.length < 3) {
        return { success: false, error: 'รหัสผ่านไม่ถูกต้องหรือสั้นเกินไป' };
    }

    // Simulate network error for specific hosts
    if (host.includes('invalid') || host.includes('error')) {
        return { success: false, error: 'ไม่สามารถเชื่อมต่อกับ Server ได้ กรุณาตรวจสอบ IP Address และ Network' };
    }

    // Success case
    return { success: true };
}

// Show connection status
function showConnectionStatus(type, message) {
    console.log('showConnectionStatus called:', type, message);
    const statusBox = document.getElementById('connection-result');
    const statusMessage = document.getElementById('connection-message');

    if (!statusBox) {
        console.error('connection-result element not found!');
        return;
    }
    if (!statusMessage) {
        console.error('connection-message element not found!');
        return;
    }

    statusBox.className = 'connection-status-box ' + type;
    statusMessage.innerHTML = message;
    statusBox.style.display = 'block';
    console.log('Status box updated and shown');
}

// Save connection configuration
function saveConnection() {
    const dbTypeEl = document.getElementById('db-type');
    const dbHostEl = document.getElementById('db-host');
    const dbPortEl = document.getElementById('db-port');
    const dbNameEl = document.getElementById('db-name');
    const dbUserEl = document.getElementById('db-user');
    const dbPasswordEl = document.getElementById('db-password');

    // ตรวจสอบว่ามี elements หรือไม่
    if (!dbTypeEl || !dbHostEl || !dbPortEl || !dbNameEl || !dbUserEl || !dbPasswordEl) {
        console.log('Database form elements not found - skipping saveConnection');
        return;
    }

    const apiUrlEl2 = document.getElementById('api-url');
    const apiUrl2 = (apiUrlEl2 && apiUrlEl2.value.trim()) ? apiUrlEl2.value.trim().replace(/\/$/, '') : window.location.origin;

    const dbType = dbTypeEl.value;
    const dbHost = dbHostEl.value;
    const dbPort = dbPortEl.value;
    const dbName = dbNameEl.value;
    const dbUser = dbUserEl.value;
    const dbPassword = dbPasswordEl.value;

    // Validate inputs (password can be empty)
    if (!dbType || !dbHost || !dbPort || !dbName || !dbUser) {
        showConnectionStatus('error', '❌ กรุณากรอกข้อมูลให้ครบถ้วน (รหัสผ่านสามารถเว้นว่างได้)');
        return;
    }

    // Create config object
    const config = {
        apiUrl: apiUrl2,
        type: dbType,
        host: dbHost,
        port: dbPort,
        database: dbName,
        user: dbUser,
        password: dbPassword
    };

    // Save to localStorage
    localStorage.setItem('dbConnection', JSON.stringify(config));

    // Update sidebar status
    const statusElement = document.getElementById('connection-status');
    if (statusElement) {
        statusElement.textContent = `บันทึกแล้ว (${config.type.toUpperCase()})`;
        statusElement.style.color = '#4caf50';
    }

    // Show success message
    showConnectionStatus('success', '✅ บันทึกการตั้งค่าเรียบร้อยแล้ว');

    // Load hospital name after saving
    setTimeout(() => {
        loadHospitalName();
    }, 300);

    // Close modal after delay
    setTimeout(() => {
        closeDatabaseModal();
    }, 1000);
}

// Load saved configuration
function loadSavedConfig() {
    const saved = localStorage.getItem('dbConnection');
    if (saved) {
        const config = JSON.parse(saved);

        // ตรวจสอบว่ามี form elements หรือไม่ก่อนใช้งาน
        const dbTypeEl = document.getElementById('db-type');
        const dbHostEl = document.getElementById('db-host');
        const dbPortEl = document.getElementById('db-port');
        const dbNameEl = document.getElementById('db-name');
        const dbUserEl = document.getElementById('db-user');
        const dbPasswordEl = document.getElementById('db-password');

        const apiUrlEl3 = document.getElementById('api-url');
        if (apiUrlEl3 && config.apiUrl) apiUrlEl3.value = config.apiUrl;
        if (dbTypeEl) dbTypeEl.value = config.type;
        if (dbHostEl) dbHostEl.value = config.host;
        if (dbPortEl) dbPortEl.value = config.port;
        if (dbNameEl) dbNameEl.value = config.database;
        if (dbUserEl) dbUserEl.value = config.user;
        if (dbPasswordEl) dbPasswordEl.value = config.password;

        // Update sidebar status
        const statusElement = document.getElementById('connection-status');
        if (statusElement) {
            statusElement.textContent = `บันทึกแล้ว (${config.type.toUpperCase()})`;
            statusElement.style.color = '#4caf50';
        }
    }
}

// Check saved connection on page load - moved to the main DOMContentLoaded listener above

// Load hospital name from opdconfig table
async function loadHospitalName() {
    const saved = localStorage.getItem('dbConnection');
    if (!saved) return;

    try {
        // Simulate fetching hospital name from opdconfig.hospitalname
        // In real implementation, this would call backend API to query the database
        const hospitalName = await fetchHospitalName();

        if (hospitalName) {
            updatePageTitle(hospitalName);
            // Save hospital name to localStorage for quick access
            localStorage.setItem('hospitalName', hospitalName);
        }
    } catch (error) {
        console.error('Error loading hospital name:', error);
    }
}

// Fetch hospital name from database via Backend API
async function fetchHospitalName() {
    const config = getDatabaseConfig();
    if (!config) {
        console.warn('No database configuration found');
        return 'โรงพยาบาลตัวอย่าง';
    }

    try {
        // Call Backend API to get hospital name from opdconfig.hospitalname
        const response = await fetch(`${API_BASE}/api/get-hospital-name`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                type: config.type,
                host: config.host,
                port: config.port,
                database: config.database,
                user: config.user,
                password: config.password
            })
        });

        const data = await response.json();

        if (data.success && data.hospitalname) {
            console.log('✅ Hospital name loaded:', data.hospitalname);
            return data.hospitalname;
        } else {
            console.error('❌ Failed to load hospital name:', data.error);
            return 'โรงพยาบาลตัวอย่าง';
        }

    } catch (error) {
        console.error('❌ API Error:', error);
        console.warn('⚠️ Backend API is not running. Please start the backend server first.');
        console.log('💡 Run: node api_example_nodejs.js');

        // Fallback to mock data if API is not available
        return 'โรงพยาบาลตัวอย่าง';
    }
}

// Update page title with hospital name
function updatePageTitle(hospitalName) {
    const headerElement = document.querySelector('.header h1');
    if (headerElement) {
        headerElement.innerHTML = `ระบบตรวจสอบข้อมูลก่อนส่งออก<br><span style="font-size: 0.7em; color: #42a5f5; font-weight: 500;">${hospitalName}</span>`;
    }
}

// ==================== Database Query Functions ====================

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
    const confirmed = confirm('ยังไม่ได้เชื่อมต่อฐานข้อมูล\n\nกรุณาเชื่อมต่อฐานข้อมูลก่อนใช้งาน\n\nต้องการไปที่หน้าตั้งค่าการเชื่อมต่อหรือไม่?');
    if (confirmed) {
        window.location.href = 'index.html';
    }
    return false;
}

// Fetch data from database (Backend API call)
async function fetchDataFromDatabase(query, params = {}) {
    const config = getDatabaseConfig();
    if (!config) {
        throw new Error('ไม่พบการตั้งค่าการเชื่อมต่อฐานข้อมูล');
    }

    // In production, this should call your backend API
    // Example:
    // const response = await fetch('/api/query', {
    //     method: 'POST',
    //     headers: { 'Content-Type': 'application/json' },
    //     body: JSON.stringify({ config, query, params })
    // });
    // return await response.json();

    // For now, return simulated data
    console.log('Query to execute:', query);
    console.log('With params:', params);
    console.log('Using database:', config);

    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, 500));

    // Return empty result for now (replace with actual API call)
    return { success: true, data: [], message: 'Mock data - replace with actual database query' };
}
