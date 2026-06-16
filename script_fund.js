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

// ==================== Global Variables ====================

let selectedMenu = null;

// ==================== Page Load ====================

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

        // ไปหน้าของกองทุนที่เลือก
        window.location.href = `fund_${menuType}.html`;
    });
});

// ==================== Search Data ====================

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

    console.log(`🔍 Searching data for ${selectedMenu} from ${dateFrom} to ${dateTo}`);

    // Show loading
    const contentArea = document.getElementById('content-area');
    contentArea.innerHTML = `
        <div class="welcome-message">
            <h2>กำลังโหลดข้อมูล...</h2>
            <p>กรุณารอสักครู่</p>
        </div>
    `;

    // Simulate data fetching (replace with real API call later)
    setTimeout(() => {
        const mockData = generateMockData(selectedMenu, dateFrom, dateTo);
        updateStatistics(mockData.total, mockData.passed, mockData.needfix);
        displayDataTable(mockData.records);
    }, 800);
}

// ==================== Update Statistics ====================

function updateStatistics(total, passed, needfix) {
    const statTotal = document.getElementById('stat-total');
    const statPassed = document.getElementById('stat-passed');
    const statNeedfix = document.getElementById('stat-needfix');

    if (statTotal) statTotal.textContent = total.toLocaleString();
    if (statPassed) statPassed.textContent = passed.toLocaleString();
    if (statNeedfix) statNeedfix.textContent = needfix.toLocaleString();
}

// ==================== Display Data Table ====================

function displayDataTable(records) {
    const contentArea = document.getElementById('content-area');

    if (records.length === 0) {
        contentArea.innerHTML = `
            <div class="welcome-message">
                <h2>ไม่พบข้อมูล</h2>
                <p>ไม่มีข้อมูลในช่วงวันที่ที่เลือก</p>
            </div>
        `;
        return;
    }

    let tableHTML = `
        <h3 style="color: #1565c0; margin-bottom: 20px;">📊 รายการข้อมูล</h3>
        <div style="overflow-x: auto;">
            <table style="width: 100%; border-collapse: collapse;">
                <thead>
                    <tr style="background: linear-gradient(135deg, #42a5f5 0%, #2196f3 100%); color: white;">
                        <th style="padding: 12px; text-align: left; border: 1px solid #e3f2fd;">ลำดับ</th>
                        <th style="padding: 12px; text-align: left; border: 1px solid #e3f2fd;">HN</th>
                        <th style="padding: 12px; text-align: left; border: 1px solid #e3f2fd;">ชื่อ-สกุล</th>
                        <th style="padding: 12px; text-align: left; border: 1px solid #e3f2fd;">วันที่</th>
                        <th style="padding: 12px; text-align: right; border: 1px solid #e3f2fd;">จำนวนเงิน</th>
                        <th style="padding: 12px; text-align: center; border: 1px solid #e3f2fd;">สถานะ</th>
                    </tr>
                </thead>
                <tbody>
    `;

    records.forEach((record, index) => {
        const statusColor = record.status === 'passed' ? '#4caf50' : '#ff9800';
        const statusText = record.status === 'passed' ? '✅ ผ่าน' : '⚠️ ต้องแก้ไข';

        tableHTML += `
            <tr style="background: ${index % 2 === 0 ? '#f5f9ff' : 'white'};">
                <td style="padding: 10px; border: 1px solid #e3f2fd;">${index + 1}</td>
                <td style="padding: 10px; border: 1px solid #e3f2fd;">${record.hn}</td>
                <td style="padding: 10px; border: 1px solid #e3f2fd;">${record.name}</td>
                <td style="padding: 10px; border: 1px solid #e3f2fd;">${record.date}</td>
                <td style="padding: 10px; border: 1px solid #e3f2fd; text-align: right;">${record.amount}</td>
                <td style="padding: 10px; border: 1px solid #e3f2fd; text-align: center;">
                    <span style="color: ${statusColor}; font-weight: 600;">${statusText}</span>
                </td>
            </tr>
        `;
    });

    tableHTML += `
                </tbody>
            </table>
        </div>
    `;

    contentArea.innerHTML = tableHTML;
}

// ==================== Clear Selection ====================

// ฟังก์ชันยกเลิกการเลือก
function clearSelection() {
    selectedMenu = null;
    document.querySelectorAll('.menu-card').forEach(c => c.classList.remove('active'));
    document.getElementById('filter-panel').classList.remove('show');
    document.getElementById('menu-grid').style.display = 'grid';
    document.getElementById('selected-system').textContent = 'กรุณาเลือกระบบที่ต้องการตรวจสอบ';

    // Reset statistics
    updateStatistics(0, 0, 0);

    const contentArea = document.getElementById('content-area');
    contentArea.innerHTML = `
        <div class="welcome-message">
            <h2>ยินดีต้อนรับ</h2>
            <p>กรุณาเลือกระบบที่ต้องการตรวจสอบข้อมูล</p>
        </div>
    `;
}

// ==================== Generate Mock Data ====================

function generateMockData(menuType, dateFrom, dateTo) {
    // Simulate random data
    const total = Math.floor(Math.random() * 100) + 50;
    const passed = Math.floor(total * 0.7);
    const needfix = total - passed;

    const records = [];
    for (let i = 0; i < Math.min(total, 20); i++) {
        records.push({
            hn: `HN${String(1000 + i).padStart(6, '0')}`,
            name: `ผู้ป่วย ${i + 1}`,
            date: dateFrom,
            amount: (Math.random() * 10000 + 1000).toFixed(2),
            status: Math.random() > 0.3 ? 'passed' : 'needfix'
        });
    }

    return {
        total: total,
        passed: passed,
        needfix: needfix,
        records: records
    };
}
