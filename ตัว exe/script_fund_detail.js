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

// ==================== Page Load ====================

window.addEventListener('DOMContentLoaded', function() {
    if (!isDatabaseConnected()) {
        showDatabaseWarning();
        return;
    }

    // Show connection status
    const config = getDatabaseConfig();
    console.log('✅ Database connected:', config.type.toUpperCase(), '-', config.host);

    // Set default dates (today) — use local date to avoid UTC offset shifting to yesterday
    const _now = new Date();
    const today = `${_now.getFullYear()}-${String(_now.getMonth() + 1).padStart(2, '0')}-${String(_now.getDate()).padStart(2, '0')}`;
    const dateFromInput = document.getElementById('dateFrom');
    const dateToInput = document.getElementById('dateTo');

    if (dateFromInput) dateFromInput.value = today;
    if (dateToInput) dateToInput.value = today;

    // Reset statistics
    updateStatistics(0, 0, 0);
});

// ==================== Search Data ====================

async function searchData() {
    const dateFrom = document.getElementById('dateFrom').value;
    const dateTo = document.getElementById('dateTo').value;

    if (!dateFrom || !dateTo) {
        alert('กรุณาเลือกวันที่เริ่มต้นและวันที่สิ้นสุด');
        return;
    }

    const fundType = window.fundType || 'unknown';
    const hipdataCode = window.hipdataCode || 'SSS';

    // Get selected pttypes (if any)
    const selectedPttypes = getSelectedPttypes();
    console.log(`🔍 Searching data for ${fundType} from ${dateFrom} to ${dateTo}`);
    console.log(`📋 Selected pttypes:`, selectedPttypes);
    console.log(`🏥 Hipdata code:`, hipdataCode);

    // Show loading
    const contentArea = document.getElementById('content-area');
    contentArea.innerHTML = `
        <div class="welcome-message">
            <h2>กำลังโหลดข้อมูล...</h2>
            <p>กรุณารอสักครู่</p>
        </div>
    `;

    try {
        // Fetch real statistics from API
        const config = getDatabaseConfig();
        if (!config) {
            alert('⚠️ ไม่พบการเชื่อมต่อฐานข้อมูล');
            return;
        }

        const apiBase = (() => { try { const c = JSON.parse(localStorage.getItem('dbConnection')); return (c && c.apiUrl) ? c.apiUrl.replace(/\/$/, '') : 'http://localhost:3002'; } catch(e) { return 'http://localhost:3002'; } })();
        const response = await fetch(`${apiBase}/api/get-statistics`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                host: config.host,
                port: config.port,
                database: config.database,
                user: config.user,
                password: config.password,
                type: config.type,
                fundType: fundType,
                dateFrom: dateFrom,
                dateTo: dateTo,
                selectedPttypes: selectedPttypes,
                hipdata_code: hipdataCode
            })
        });

        const result = await response.json();

        if (result.success && result.stats) {
            updateStatistics(result.stats.total, result.stats.passed, result.stats.needfix);

            // Show summary message instead of table for now
            contentArea.innerHTML = `
                <div class="welcome-message">
                    <h2>✅ โหลดข้อมูลสำเร็จ</h2>
                    <p>พบข้อมูลจำนวน ${result.stats.total.toLocaleString()} รายการ</p>
                    <p style="font-size: 14px; color: #546e7a; margin-top: 10px;">ช่วงวันที่: ${dateFrom} ถึง ${dateTo}</p>
                    ${selectedPttypes.length > 0 ? `<p style="font-size: 14px; color: #546e7a;">สิทธิที่เลือก: ${selectedPttypes.length} รายการ</p>` : '<p style="font-size: 14px; color: #546e7a;">สิทธิ: ทั้งหมด</p>'}
                </div>
            `;
        } else {
            alert('เกิดข้อผิดพลาด: ' + (result.error || 'ไม่สามารถดึงข้อมูลได้'));
            updateStatistics(0, 0, 0);
        }
    } catch (error) {
        console.error('Error fetching statistics:', error);
        alert('เกิดข้อผิดพลาดในการเชื่อมต่อ API: ' + error.message);
        updateStatistics(0, 0, 0);
    }
}

// Helper function to get selected pttypes
function getSelectedPttypes() {
    const checkboxes = document.querySelectorAll('input[name="pttype"]:checked');
    return Array.from(checkboxes).map(cb => cb.value);
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

// ==================== Generate Mock Data ====================

function generateMockData(fundType, dateFrom, dateTo) {
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
