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

    // Set default dates (today)
    const today = new Date().toISOString().split('T')[0];
    const dateFromInput = document.getElementById('dateFrom');
    const dateToInput = document.getElementById('dateTo');

    if (dateFromInput) dateFromInput.value = today;
    if (dateToInput) dateToInput.value = today;

    // Reset statistics
    updateStatistics(0, 0, 0, 0);
});

// ==================== Search Data ====================

function searchData() {
    const dateFrom = document.getElementById('dateFrom').value;
    const dateTo = document.getElementById('dateTo').value;

    if (!dateFrom || !dateTo) {
        alert('กรุณาเลือกวันที่เริ่มต้นและวันที่สิ้นสุด');
        return;
    }

    const checkType = window.checkType || 'unknown';
    console.log(`🔍 Searching check C data for ${checkType} from ${dateFrom} to ${dateTo}`);

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
        const mockData = generateMockCheckCData(checkType, dateFrom, dateTo);
        updateStatistics(mockData.total, mockData.correct, mockData.needfix, mockData.pending);
        displayDataTable(mockData.records);
    }, 800);
}

// ==================== Update Statistics ====================

function updateStatistics(total, correct, needfix, pending) {
    const statTotal = document.getElementById('stat-total');
    const statCorrect = document.getElementById('stat-correct');
    const statNeedfix = document.getElementById('stat-needfix');
    const statPending = document.getElementById('stat-pending');

    if (statTotal) statTotal.textContent = total.toLocaleString();
    if (statCorrect) statCorrect.textContent = correct.toLocaleString();
    if (statNeedfix) statNeedfix.textContent = needfix.toLocaleString();
    if (statPending) statPending.textContent = pending.toLocaleString();
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
        <h3 style="color: #1565c0; margin-bottom: 20px;">📊 รายการตรวจสอบป้องกันการติด C</h3>

        <div style="background: linear-gradient(135deg, #fff3e0 0%, #ffe0b2 100%); padding: 16px 20px; border-radius: 10px; margin-bottom: 20px; border-left: 4px solid #ff9800; box-shadow: 0 2px 8px rgba(255, 152, 0, 0.15);">
            <strong>⚠️ คำเตือน:</strong> กรุณาตรวจสอบรายการที่มีความเสี่ยงก่อนการส่งออกข้อมูล
        </div>

        <div style="overflow-x: auto;">
            <table style="width: 100%; border-collapse: collapse;">
                <thead>
                    <tr style="background: linear-gradient(135deg, #42a5f5 0%, #2196f3 100%); color: white;">
                        <th style="padding: 12px; text-align: left; border: 1px solid #e3f2fd;">ลำดับ</th>
                        <th style="padding: 12px; text-align: left; border: 1px solid #e3f2fd;">HN</th>
                        <th style="padding: 12px; text-align: left; border: 1px solid #e3f2fd;">ชื่อ-สกุล</th>
                        <th style="padding: 12px; text-align: left; border: 1px solid #e3f2fd;">วันที่</th>
                        <th style="padding: 12px; text-align: right; border: 1px solid #e3f2fd;">จำนวนเงิน</th>
                        <th style="padding: 12px; text-align: center; border: 1px solid #e3f2fd;">ระดับความเสี่ยง</th>
                        <th style="padding: 12px; text-align: center; border: 1px solid #e3f2fd;">สถานะ</th>
                    </tr>
                </thead>
                <tbody>
    `;

    records.forEach((record, index) => {
        const statusColor = record.status === 'ปลอดภัย' ? '#4caf50' : '#ff9800';
        const statusIcon = record.status === 'ปลอดภัย' ? '✅' : '⚠️';
        const riskColor = record.risk === 'ต่ำ' ? '#4caf50' : (record.risk === 'กลาง' ? '#ff9800' : '#f44336');

        tableHTML += `
            <tr style="background: ${index % 2 === 0 ? '#f5f9ff' : 'white'};">
                <td style="padding: 10px; border: 1px solid #e3f2fd;">${index + 1}</td>
                <td style="padding: 10px; border: 1px solid #e3f2fd;">${record.hn}</td>
                <td style="padding: 10px; border: 1px solid #e3f2fd;">${record.name}</td>
                <td style="padding: 10px; border: 1px solid #e3f2fd;">${record.date}</td>
                <td style="padding: 10px; border: 1px solid #e3f2fd; text-align: right;">${record.amount}</td>
                <td style="padding: 10px; border: 1px solid #e3f2fd; text-align: center;">
                    <span style="display: inline-block; padding: 4px 12px; background: ${riskColor}; color: white; border-radius: 12px; font-size: 12px; font-weight: 600;">${record.risk}</span>
                </td>
                <td style="padding: 10px; border: 1px solid #e3f2fd; text-align: center;">
                    <span style="color: ${statusColor}; font-weight: 600;">${statusIcon} ${record.status}</span>
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

// ==================== Generate Mock Check C Data ====================

function generateMockCheckCData(checkType, dateFrom, dateTo) {
    // Simulate random data
    const total = Math.floor(Math.random() * 150) + 50;
    const correct = Math.floor(total * 0.7);
    const needfix = Math.floor(total * 0.2);
    const pending = total - correct - needfix;

    const records = [];
    const statusOptions = ['ปลอดภัย', 'เสี่ยง'];
    const riskOptions = ['ต่ำ', 'กลาง', 'สูง'];

    for (let i = 0; i < Math.min(total, 20); i++) {
        const status = Math.random() > 0.3 ? 'ปลอดภัย' : 'เสี่ยง';
        const risk = status === 'ปลอดภัย' ? 'ต่ำ' : (Math.random() > 0.5 ? 'กลาง' : 'สูง');

        records.push({
            hn: `HN${String(1000 + i).padStart(6, '0')}`,
            name: `ผู้ป่วย ${i + 1}`,
            date: dateFrom,
            amount: (Math.random() * 10000 + 1000).toFixed(2),
            status: status,
            risk: risk
        });
    }

    return {
        total: total,
        correct: correct,
        needfix: needfix,
        pending: pending,
        records: records
    };
}
