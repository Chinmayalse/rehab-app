// Reports JavaScript
document.addEventListener('DOMContentLoaded', async function() {
    await loadPatientsForReports();
    initializeReports();
    loadSkillPerformanceTable();
    loadSessionHistoryTable();
    await initializeReportCharts();
    // Clear any placeholder AI insights on first load
    const insights = document.querySelector('.insights-content');
    if (insights) insights.innerHTML = '';
});

// Helper
async function fetchJSON(url, options) {
    const resp = await fetch(url, options);
    if (!resp.ok) throw new Error(`Failed ${url}: ${resp.status}`);
    return resp.json();
}

// Update the KPI cards based on selected patient
async function refreshOverviewCards() {
    try {
        const patientId = document.getElementById('patientFilter')?.value || '';
        const skillsUrl = patientId ? `http://localhost:3000/api/reports/skill-performance?patientId=${encodeURIComponent(patientId)}` : 'http://localhost:3000/api/reports/skill-performance';
        const sessionsUrl = patientId ? `http://localhost:3000/api/reports/session-history?patientId=${encodeURIComponent(patientId)}` : 'http://localhost:3000/api/reports/session-history';
        const [skills, sessions] = await Promise.all([
            fetchJSON(skillsUrl),
            fetchJSON(sessionsUrl)
        ]);

        // Overall progress: average of current skill scores
        const currents = skills.map(s => Number(s.current) || 0).filter(v => v >= 0);
        const overall = currents.length ? Math.round(currents.reduce((a,b)=>a+b,0) / currents.length) : 0;
        const overallEl = document.getElementById('overallScore');
        if (overallEl) overallEl.textContent = String(overall);

        // Trend badge for overall progress based on average of "previous"
        const prevs = skills.map(s => Number(s.previous) || 0).filter(v => v >= 0);
        const prevAvg = prevs.length ? Math.round(prevs.reduce((a,b)=>a+b,0) / prevs.length) : 0;
        const delta = overall - prevAvg;
        const trendBadge = document.querySelector('.progress-overview .overview-card .trend-indicator');
        if (trendBadge) {
            trendBadge.textContent = `${delta >= 0 ? '+' : ''}${delta}%`;
            trendBadge.classList.remove('positive','negative','neutral');
            trendBadge.classList.add(delta > 0 ? 'positive' : delta < 0 ? 'negative' : 'neutral');
        }

        // Goal achievement: count skills meeting or exceeding goal
        const met = skills.filter(s => (Number(s.current)||0) >= (Number(s.goal)||0)).length;
        const inProgress = skills.filter(s => (Number(s.current)||0) < (Number(s.goal)||0) && (Number(s.current)||0) > 0).length;
        const behind = skills.length - met - inProgress;
        // Map to static placeholders if elements exist
        const goalCard = document.querySelector('.goal-stats');
        if (goalCard) {
            const nums = goalCard.querySelectorAll('.goal-number');
            if (nums[0]) nums[0].textContent = String(met);
            if (nums[1]) nums[1].textContent = String(inProgress);
            if (nums[2]) nums[2].textContent = String(Math.max(0, behind));
        }

        // Session analytics
        const totalSessions = sessions.length;
        const avgDuration = totalSessions ? Math.round(sessions.reduce((a,s)=>a + (Number(s.duration)||0), 0)/totalSessions) : 0;
        // A simple attendance heuristic: sessions in last 30 days over 30
        const now = new Date();
        const cutoff = new Date(now.getTime() - 29*24*60*60*1000);
        const recent = sessions.filter(s => new Date(s.date) >= cutoff).length;
        const attendance = Math.min(100, Math.round((recent/30)*100));
        const sessNums = document.querySelectorAll('.session-stats .session-number');
        if (sessNums[0]) sessNums[0].textContent = String(totalSessions);
        if (sessNums[1]) sessNums[1].textContent = `${attendance}%`;
        if (sessNums[2]) sessNums[2].textContent = String(avgDuration);
    } catch (e) {
        console.error('Failed to refresh overview cards', e);
    }
}

// Initialize Reports
function initializeReports() {
    setupEventListeners();
    applyFilters(); // Load initial data
}

// Setup Event Listeners
function setupEventListeners() {
    // Filter change events
    document.getElementById('patientFilter')?.addEventListener('change', applyFilters);
    document.getElementById('reportType')?.addEventListener('change', applyFilters);
    document.getElementById('skillCategory')?.addEventListener('change', applyFilters);
    document.getElementById('trendPeriod')?.addEventListener('change', async () => {
        await renderProgressTrendEChart();
    });
}

// Populate Patient Filter from backend
async function loadPatientsForReports() {
    try {
        const list = await fetchJSON('http://localhost:3000/api/patients');
        const sel = document.getElementById('patientFilter');
        if (!sel) return;
        const current = sel.value;
        sel.innerHTML = '<option value="">All Patients</option>';
        list.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.id;
            opt.textContent = `${p.name}${p.age != null ? ' (Age ' + p.age + ')' : ''}`;
            sel.appendChild(opt);
        });
        if (current && list.find(p => String(p.id) === String(current))) {
            sel.value = current;
        }
    } catch (e) { console.error('Failed to load patients for reports', e); }
}

// Apply Filters
async function applyFilters() {
    const patientFilter = document.getElementById('patientFilter')?.value;
    const reportType = document.getElementById('reportType')?.value;
    const skillCategory = document.getElementById('skillCategory')?.value;
    
    console.log('Filters applied:', { patientFilter, reportType, skillCategory });
    
    // Update tables and charts with filtered data
    loadSkillPerformanceTable();
    loadSessionHistoryTable();
    // Re-render charts using latest filter
    await initializeReportCharts();
    // Update KPI cards (overall progress, goals, sessions)
    refreshOverviewCards();
    
    // Show loading indicator
    showLoadingIndicator();
    
    // Simulate data loading
    setTimeout(() => {
        hideLoadingIndicator();
    }, 1000);
}

// Clear Filters
function clearFilters() {
    document.getElementById('patientFilter').value = '';
    document.getElementById('reportType').value = 'daily';
    document.getElementById('skillCategory').value = '';
    document.getElementById('startDate').value = '2025-08-01';
    document.getElementById('endDate').value = '2025-09-04';
    
    applyFilters();
}

// Load Skill Performance Table
async function loadSkillPerformanceTable() {
    const tbody = document.querySelector('#skillTable tbody');
    if (!tbody) return;
    
    tbody.innerHTML = '';
    try {
        const patientId = document.getElementById('patientFilter')?.value || '';
        const url = patientId ? `http://localhost:3000/api/reports/skill-performance?patientId=${encodeURIComponent(patientId)}` : 'http://localhost:3000/api/reports/skill-performance';
        const skills = await fetchJSON(url);
        skills.forEach(skill => {
            const change = skill.current - skill.previous;
            const progressToGoal = Math.min(100, Math.round((skill.current / skill.goal) * 100));
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${skill.skill}</td>
                <td><span class="score-badge ${getScoreClass(skill.current)}">${skill.current}%</span></td>
                <td>${skill.previous}%</td>
                <td>
                    <span class="change-indicator ${change >= 0 ? 'positive' : 'negative'}">
                        ${change >= 0 ? '+' : ''}${change}%
                    </span>
                </td>
                <td>${skill.goal}%</td>
                <td>
                    <div class="progress-bar">
                        <div class="progress-fill" style="width: ${progressToGoal}%"></div>
                    </div>
                    <span class="progress-text">${progressToGoal}%</span>
                </td>
                <td><span class="status-badge ${getStatusClass(skill.status)}">${skill.status}</span></td>
            `;
            tbody.appendChild(row);
        });
    } catch (e) {
        console.error(e);
    }
}

// Load Session History Table
async function loadSessionHistoryTable() {
    const tbody = document.querySelector('#sessionTable tbody');
    if (!tbody) return;
    
    tbody.innerHTML = '';
    try {
        const patientId = document.getElementById('patientFilter')?.value || '';
        const url = patientId ? `http://localhost:3000/api/reports/session-history?patientId=${encodeURIComponent(patientId)}` : 'http://localhost:3000/api/reports/session-history';
        const sessions = await fetchJSON(url);
        sessions.forEach(session => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${formatDate(session.date)}</td>
                <td>${session.patient}</td>
                <td>${session.duration} min</td>
                <td>${session.activities}</td>
                <td><span class="score-badge ${getScoreClass(session.score)}">${session.score}%</span></td>
                <td class="notes-cell">${session.notes || ''}</td>
                <td>
                    <button class="action-btn view" onclick="viewSession('${session.date}', '${session.patient}')">
                        <i class="fas fa-eye"></i>
                    </button>
                </td>
            `;
            tbody.appendChild(row);
        });
    } catch (e) {
        console.error(e);
    }
}

// Initialize Report Charts (ECharts)
let eProgressTrend = null;
let eSkillBar = null;
let eSessionVolume = null;
let eWorkoutPie = null;

async function initializeReportCharts() {
    await renderProgressTrendEChart();
    await renderSkillBarEChart();
    await renderSessionVolumeEChart();
    await renderWorkoutPieEChart();
}

async function renderProgressTrendEChart() {
    const el = document.getElementById('echartProgressTrend');
    if (!el) return;
    const pid = document.getElementById('patientFilter')?.value || '';
    const days = document.getElementById('trendPeriod')?.value || 30;
    const url = pid ? `http://localhost:3000/api/charts/dashboard/progress?patientId=${encodeURIComponent(pid)}&days=${days}` : `http://localhost:3000/api/charts/dashboard/progress?days=${days}`;
    try {
        const res = await fetchJSON(url);
        const existing = echarts.getInstanceByDom(el);
        if (existing) existing.dispose();
        eProgressTrend = echarts.init(el);
        const option = {
            grid: { left: 40, right: 20, top: 30, bottom: 30 },
            tooltip: { trigger: 'axis' },
            xAxis: { type: 'category', data: res.labels },
            yAxis: { type: 'value', max: 100 },
            series: [{
                name: 'Average Score', type: 'line', smooth: true,
                areaStyle: { color: 'rgba(102,126,234,0.15)' },
                lineStyle: { color: '#667eea' },
                itemStyle: { color: '#667eea' },
                data: res.data
            }]
        };
        eProgressTrend.setOption(option);
    } catch (e) { console.error(e); }
}

async function renderSkillBarEChart() {
    const el = document.getElementById('echartSkillBar');
    if (!el) return;
    const pid = document.getElementById('patientFilter')?.value || '';
    const url = pid ? `http://localhost:3000/api/reports/skill-performance?patientId=${encodeURIComponent(pid)}` : 'http://localhost:3000/api/reports/skill-performance';
    try {
        const skills = await fetchJSON(url);
        const labels = skills.map(s => s.skill);
        const scores = skills.map(s => s.current);
        const existing = echarts.getInstanceByDom(el);
        if (existing) existing.dispose();
        eSkillBar = echarts.init(el);
        const option = {
            grid: { left: 60, right: 20, top: 20, bottom: 60 },
            tooltip: { trigger: 'axis' },
            xAxis: { type: 'category', data: labels, axisLabel: { rotate: 30 } },
            yAxis: { type: 'value', max: 100 },
            series: [{
                name: 'Current %', type: 'bar', data: scores,
                itemStyle: { color: '#667eea' }
            }]
        };
        eSkillBar.setOption(option);
    } catch (e) { console.error(e); }
}

async function renderSessionVolumeEChart() {
    const el = document.getElementById('echartSessionVolume');
    if (!el) return;
    const pid = document.getElementById('patientFilter')?.value || '';
    const url = pid ? `http://localhost:3000/api/reports/session-history?patientId=${encodeURIComponent(pid)}` : 'http://localhost:3000/api/reports/session-history';
    try {
        const sessions = await fetchJSON(url);
        // aggregate counts per date (sorted)
        const counts = {};
        sessions.forEach(s => { counts[s.date] = (counts[s.date] || 0) + 1; });
        const labels = Object.keys(counts).sort();
        const data = labels.map(d => counts[d]);
        const existing = echarts.getInstanceByDom(el);
        if (existing) existing.dispose();
        eSessionVolume = echarts.init(el);
        const option = {
            grid: { left: 40, right: 20, top: 20, bottom: 30 },
            tooltip: { trigger: 'axis' },
            xAxis: { type: 'category', data: labels },
            yAxis: { type: 'value' },
            series: [{ name: 'Sessions', type: 'bar', data, itemStyle: { color: '#43e97b' } }]
        };
        eSessionVolume.setOption(option);
    } catch (e) { console.error(e); }
}

async function renderWorkoutPieEChart() {
    const el = document.getElementById('echartWorkoutPie');
    if (!el) return;
    const pid = document.getElementById('patientFilter')?.value || '';
    const url = pid ? `http://localhost:3000/api/charts/homeworkout/distribution?patientId=${encodeURIComponent(pid)}` : 'http://localhost:3000/api/charts/homeworkout/distribution';
    try {
        const res = await fetchJSON(url);
        const existing = echarts.getInstanceByDom(el);
        if (existing) existing.dispose();
        eWorkoutPie = echarts.init(el);
        const option = {
            tooltip: { trigger: 'item' },
            series: [{
                type: 'pie', radius: ['55%','75%'],
                label: { show: false },
                data: res.labels.map((label, i) => ({ name: label, value: res.data[i] }))
            }],
            color: ['#667eea','#f093fb','#4facfe','#43e97b','#f5576c','#00f2fe','#764ba2','#a1c4fd']
        };
        eWorkoutPie.setOption(option);
    } catch (e) { console.error(e); }
}

// Utility Functions
function getScoreClass(score) {
    if (score >= 90) return 'score-excellent';
    if (score >= 80) return 'score-good';
    if (score >= 70) return 'score-fair';
    return 'score-needs-improvement';
}

function getStatusClass(status) {
    switch (status) {
        case 'Achieved': return 'status-achieved';
        case 'On Track': return 'status-on-track';
        case 'Improving': return 'status-improving';
        case 'Needs Attention': return 'status-attention';
        case 'Declining': return 'status-declining';
        default: return 'status-default';
    }
}

function formatDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    });
}

// Export Functions
function exportTable(tableId) {
    const table = document.getElementById(tableId);
    if (!table) return;
    
    let csv = '';
    const rows = table.querySelectorAll('tr');
    
    rows.forEach(row => {
        const cells = row.querySelectorAll('th, td');
        const rowData = [];
        cells.forEach(cell => {
            // Clean up cell content (remove HTML tags)
            const cleanText = cell.textContent.trim().replace(/\s+/g, ' ');
            rowData.push(`"${cleanText}"`);
        });
        csv += rowData.join(',') + '\n';
    });
    
    // Create and download file
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${tableId}_export_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    window.URL.revokeObjectURL(url);
}

// Report Generation Functions
async function generateReport() {
    try {
        showLoadingIndicator();
        const patientId = document.getElementById('patientFilter')?.value || '';
        const reportType = document.getElementById('reportType')?.value || 'daily';
        const body = JSON.stringify({ patientId, reportType, format: 'pdf' });
        const resp = await fetch('http://localhost:3000/api/reports/generate', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/pdf'
            },
            body
        });

        // If server returned PDF
        const contentType = resp.headers.get('content-type') || '';
        if (resp.ok && contentType.includes('application/pdf')) {
            const blob = await resp.blob();
            const url = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            const fileNameSafe = (reportType || 'report').replace(/[^a-z0-9-_]+/gi,'_');
            const patientPart = patientId ? `patient_${patientId}_` : '';
            link.href = url;
            link.download = `${patientPart}${fileNameSafe}_${new Date().toISOString().split('T')[0]}.pdf`;
            link.click();
            window.URL.revokeObjectURL(url);
            hideLoadingIndicator();
            return;
        }

        // Otherwise treat as JSON fallback (text content)
        const data = await resp.json();
        hideLoadingIndicator();
        if (!resp.ok || data.error) {
            alert(`Failed to generate report${data?.error ? ': ' + data.error : ''}`);
            return;
        }
        const textBlob = new Blob([data.content || ''], { type: 'text/plain;charset=utf-8' });
        const url = window.URL.createObjectURL(textBlob);
        const link = document.createElement('a');
        const fileNameSafe = (reportType || 'report').replace(/[^a-z0-9-_]+/gi,'_');
        const patientPart = patientId ? `patient_${patientId}_` : '';
        link.href = url;
        link.download = `${patientPart}${fileNameSafe}_${new Date().toISOString().split('T')[0]}.txt`;
        link.click();
        window.URL.revokeObjectURL(url);
    } catch (e) {
        hideLoadingIndicator();
        console.error(e);
        alert('Failed to generate report.');
    }
}

function downloadReport(type) {
    showLoadingIndicator();
    
    setTimeout(() => {
        hideLoadingIndicator();
        
        const reportName = {
            'daily': 'Daily_Analysis_Report',
            'monthly': 'Monthly_Progress_Report',
            'quarterly': 'Quarterly_Assessment_Report',
            'csv': 'Raw_Data_Export'
        }[type] || 'Report';
        
        const extension = type === 'csv' ? 'csv' : 'pdf';
        alert(`${reportName}.${extension} has been downloaded!`);
    }, 2000);
}

// View Session Details
function viewSession(date, patient) {
    alert(`Viewing detailed session for ${patient} on ${date}`);
    // Implementation would show a modal with detailed session information
}

// Refresh AI Insights
function refreshInsights() {
    generateAIReport();
}

// Loading Indicators
function showLoadingIndicator() {
    // Create or show loading overlay
    let loader = document.querySelector('.loading-overlay');
    if (!loader) {
        loader = document.createElement('div');
        loader.className = 'loading-overlay';
        loader.innerHTML = `
            <div class="loading-content">
                <i class="fas fa-spinner fa-spin fa-2x"></i>
                <p>Loading report data...</p>
            </div>
        `;
        loader.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0,0,0,0.5);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 9999;
            color: white;
        `;
        document.body.appendChild(loader);
    }
    loader.style.display = 'flex';
}

function generateAIReport() {
    const patientId = document.getElementById('patientFilter').value;
    const reportType = document.getElementById('reportType').value;
    
    fetch('http://localhost:3000/api/reports/generate', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ patientId, reportType }),
    })
    .then(response => response.json())
    .then(data => {
        if (data.error) {
            alert(`Error: ${data.error}`);
            return;
        }
        
        // Display the report in the AI Insights section
        const insightsContent = document.querySelector('.insights-content');
        insightsContent.innerHTML = `
            <div class="insight-item">
                <div class="insight-icon info">
                    <i class="fas fa-lightbulb"></i>
                </div>
                <div class="insight-text">
                    <h4>${reportType.charAt(0).toUpperCase() + reportType.slice(1)} Report</h4>
                    <p style="white-space: pre-wrap;">${data.content}</p>
                </div>
            </div>
        `;
    })
    .catch((error) => {
        console.error('Error:', error);
        alert('Failed to generate report.');
    });
}

// Update the refreshInsights function to call this new function
// refreshInsights is implemented above


function hideLoadingIndicator() {
    const loader = document.querySelector('.loading-overlay');
    if (loader) {
        loader.style.display = 'none';
    }
}
