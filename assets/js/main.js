// Main Dashboard JavaScript
document.addEventListener('DOMContentLoaded', async function() {
    initializeDashboard();
    // Load patients first so we can resolve names/ages in UI
    try {
        await loadPatients();
    } catch {}
    await refreshDashboardForSelection();
    setupDashboardPatientListener();
});

// Initialize Dashboard
function initializeDashboard() {
    // Set current date
    const today = new Date().toISOString().split('T')[0];
    const dateInput = document.getElementById('currentDate');
    if (dateInput) {
        dateInput.value = today;
    }
    
    // Add mobile menu toggle
    addMobileMenuToggle();
    
    // Initialize tooltips and other UI elements
    initializeUIElements();
    
    // Load dynamic dashboard stats
    updateDashboardStats();
}

// Helper to fetch JSON
async function fetchJSON(url) {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Failed to fetch ${url}: ${resp.status}`);
    return resp.json();
}

// Patients cache
let patientsMap = {};
async function loadPatients() {
    try {
        const list = await fetchJSON('http://localhost:3000/api/patients');
        patientsMap = Object.fromEntries(list.map(p => [String(p.id), p]));
        // Populate dashboard patient select
        const sel = document.getElementById('dashboardPatientSelect');
        if (sel) {
            const current = sel.value;
            sel.innerHTML = '<option value="">All patients</option>';
            list.forEach(p => {
                const opt = document.createElement('option');
                opt.value = p.id;
                opt.textContent = `${p.name}${p.age != null ? ' (Age ' + p.age + ')' : ''}`;
                sel.appendChild(opt);
            });
            if (current && list.find(p => String(p.id) === String(current))) sel.value = current;
        }
    } catch (e) {
        console.error('Failed to load patients', e);
        patientsMap = {};
    }
}

function getSelectedDashboardPatientId() {
    const sel = document.getElementById('dashboardPatientSelect');
    return sel && sel.value ? sel.value : '';
}

function setupDashboardPatientListener() {
    const sel = document.getElementById('dashboardPatientSelect');
    if (!sel) return;
    sel.addEventListener('change', async () => {
        await refreshDashboardForSelection();
    });
}

async function refreshDashboardForSelection() {
    await updateDashboardStats();
    await loadRecentAssessments();
    await initializeCharts();
}

// Update top-level dashboard stats
async function updateDashboardStats() {
    try {
        const pid = getSelectedDashboardPatientId();
        const url = pid ? `http://localhost:3000/api/stats/dashboard?patientId=${encodeURIComponent(pid)}` : 'http://localhost:3000/api/stats/dashboard';
        const stats = await fetchJSON(url);
        const values = [
            String(stats.activePatients || 0),
            String(stats.todaysAssessments || 0),
            `${stats.averageProgress || 0}%`,
            String(stats.homeWorkouts || 0)
        ];
        const cards = document.querySelectorAll('.stats-grid .stat-card h3');
        cards.forEach((el, idx) => { if (values[idx] !== undefined) el.textContent = values[idx]; });
    } catch (e) {
        console.error('Failed to load dashboard stats', e);
    }
}

// Load Recent Assessments
async function loadRecentAssessments() {
    const tableBody = document.querySelector('#recentAssessments tbody');
    if (!tableBody) return;
    tableBody.innerHTML = '';
    try {
        const pid = getSelectedDashboardPatientId();
        const base = 'http://localhost:3000/api/assessments?limit=10';
        const url = pid ? `${base}&patientId=${encodeURIComponent(pid)}` : base;
        const items = await fetchJSON(url);
        items.forEach((a, idx) => {
            const score = getAssessmentScore(a);
            const p = patientsMap[String(a.patientId)] || {};
            const name = p.name || (a.patientId || 'Unknown');
            const age = p.age != null ? p.age : '-';
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${name}</td>
                <td>${age}</td>
                <td>Assessment</td>
                <td><span class="score-badge ${getScoreClass(score)}">${score}%</span></td>
                <td>${formatDate(a.timestamp)}</td>
                <td>
                    <button class="action-btn view" onclick="viewAssessment('${a.id || idx}')">
                        <i class="fas fa-eye"></i>
                    </button>
                </td>
            `;
            tableBody.appendChild(row);
        });
    } catch (e) {
        console.error(e);
    }
}

function getAssessmentScore(a) {
    const d = a.data || {};
    const fields = ['fineMotor_grip','grossMotor_balance','cognitive_approach','emotional_quality','communication_clarity','communication_grammar'];
    let vals = fields.map(k => parseInt(d[k])).filter(v => !isNaN(v));
    if (!vals.length) return 0;
    return Math.round(vals.reduce((s,v)=>s+v,0) / (vals.length*5) * 100);
}

// Get score class for styling
function getScoreClass(score) {
    if (score >= 90) return 'score-excellent';
    if (score >= 80) return 'score-good';
    if (score >= 70) return 'score-fair';
    return 'score-needs-improvement';
}

// Format date
function formatDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    });
}

// Initialize Charts from backend data using ECharts
let progressChartInstance = null;
let skillChartInstance = null;

async function initializeCharts() {
    const pid = getSelectedDashboardPatientId();
    // Progress Chart
    const progressEl = document.getElementById('progressChart');
    if (progressEl) {
        try {
            const url = pid ? `http://localhost:3000/api/charts/dashboard/progress?patientId=${encodeURIComponent(pid)}` : 'http://localhost:3000/api/charts/dashboard/progress';
            const res = await fetchJSON(url);
            const existing = echarts.getInstanceByDom(progressEl);
            if (existing) existing.dispose();
            progressChartInstance = echarts.init(progressEl);
            const option = {
                grid: { left: 40, right: 20, top: 30, bottom: 30 },
                tooltip: { trigger: 'axis' },
                xAxis: { type: 'category', data: res.labels },
                yAxis: { type: 'value', max: 100 },
                series: [{
                    name: 'Average Progress',
                    type: 'line', smooth: true,
                    areaStyle: { color: 'rgba(102,126,234,0.15)' },
                    lineStyle: { color: '#667eea' },
                    itemStyle: { color: '#667eea' },
                    data: res.data
                }]
            };
            progressChartInstance.setOption(option);
        } catch (e) { console.error(e); }
    }

    // Skill Distribution Chart
    const skillEl = document.getElementById('skillChart');
    if (skillEl) {
        try {
            const url = pid ? `http://localhost:3000/api/charts/dashboard/skills?patientId=${encodeURIComponent(pid)}` : 'http://localhost:3000/api/charts/dashboard/skills';
            const res = await fetchJSON(url);
            const existing = echarts.getInstanceByDom(skillEl);
            if (existing) existing.dispose();
            skillChartInstance = echarts.init(skillEl);
            const option = {
                tooltip: { trigger: 'item' },
                series: [{
                    type: 'pie', radius: ['60%','80%'],
                    label: { show: false },
                    data: res.labels.map((label, i) => ({ name: label, value: res.data[i] }))
                }],
                color: ['#667eea','#764ba2','#f093fb','#f5576c','#4facfe','#43e97b','#f6d365','#a1c4fd']
            };
            skillChartInstance.setOption(option);
        } catch (e) { console.error(e); }
    }
}


// Assessment Actions
function viewAssessment(id) {
    alert(`Viewing assessment ${id}`);
    // Implement view functionality
}

function editAssessment(id) {
    alert(`Editing assessment ${id}`);
    // Implement edit functionality
}

function deleteAssessment(id) {
    if (confirm('Are you sure you want to delete this assessment?')) {
        alert(`Deleting assessment ${id}`);
        // Implement delete functionality
    }
}

// Mobile Menu Toggle
function addMobileMenuToggle() {
    // Add mobile menu button if screen is small
    if (window.innerWidth <= 768) {
        const header = document.querySelector('.header');
        if (header) {
            const menuButton = document.createElement('button');
            menuButton.innerHTML = '<i class="fas fa-bars"></i>';
            menuButton.className = 'mobile-menu-toggle';
            menuButton.style.cssText = `
                display: block;
                position: fixed;
                top: 20px;
                left: 20px;
                z-index: 1001;
                background: #667eea;
                color: white;
                border: none;
                padding: 10px;
                border-radius: 5px;
                cursor: pointer;
            `;
            
            menuButton.addEventListener('click', function() {
                const sidebar = document.querySelector('.sidebar');
                sidebar.classList.toggle('active');
            });
            
            document.body.appendChild(menuButton);
        }
    }
}

// Initialize UI Elements
function initializeUIElements() {
    // Add hover effects and other interactive elements
    const statCards = document.querySelectorAll('.stat-card');
    statCards.forEach(card => {
        card.addEventListener('click', function() {
            // Add click functionality for stat cards
            console.log('Stat card clicked');
        });
    });
}

// Handle window resize
window.addEventListener('resize', function() {
    // Reinitialize mobile menu if needed
    const existingToggle = document.querySelector('.mobile-menu-toggle');
    if (window.innerWidth > 768 && existingToggle) {
        existingToggle.remove();
        document.querySelector('.sidebar').classList.remove('active');
    } else if (window.innerWidth <= 768 && !existingToggle) {
        addMobileMenuToggle();
    }
});
