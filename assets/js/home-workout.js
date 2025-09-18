// Save new workout
function saveNewWorkout(workoutData) {
    fetch('http://localhost:3000/api/workouts', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(workoutData),
    })
    .then(response => response.json())
    .then(data => {
        alert(data.message);
        // Refresh workout list and stats
        loadWorkouts();
        updateWorkoutStats();
        initializeWorkoutCharts();
    })
    .catch(error => console.error('Error:', error));
}

// Helper
async function fetchJSON(url) {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Failed ${url}: ${resp.status}`);
    return resp.json();
}

// Load workouts
let cachedWorkouts = [];
async function loadWorkouts() {
    try {
        const patientId = getSelectedPatientId();
        const url = patientId ? `http://localhost:3000/api/workouts?patientId=${encodeURIComponent(patientId)}` : 'http://localhost:3000/api/workouts';
        const data = await fetchJSON(url);
        cachedWorkouts = data;
        buildActivityLogFromWorkouts();
    } catch (e) {
        console.error('Error:', e);
    }
}

// Home Workout JavaScript
document.addEventListener('DOMContentLoaded', async function() {
    await loadPatientsForWorkouts();
    await loadWorkouts();
    initializeHomeWorkouts();
    loadActivityLog();
    await initializeWorkoutCharts();
    setupEventListeners();
});

// Build activity log from workouts
function buildActivityLogFromWorkouts() {
    const tbody = document.getElementById('activityLogBody');
    if (!tbody) return;
    tbody.innerHTML = '';
    const logs = [...cachedWorkouts]
        .sort((a,b)=> new Date(b.timestamp) - new Date(a.timestamp))
        .slice(0, 20)
        .map(w => ({
            date: new Date(w.timestamp).toISOString().split('T')[0],
            time: new Date(w.timestamp).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}),
            activity: w.activityName,
            duration: `${w.duration || 0} min`,
            performance: 'Good',
            notes: w.instructions || ''
        }));
    logs.forEach((log, index) => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${log.date} ${log.time}</td>
            <td>${log.activity}</td>
            <td>${log.duration}</td>
            <td><span class="performance-badge ${log.performance.toLowerCase()}">${log.performance}</span></td>
            <td>${log.notes}</td>
            <td>
                <button class="action-btn view" onclick="viewActivityDetails(${index})">
                    <i class="fas fa-eye"></i>
                </button>
                <button class="action-btn edit" onclick="editActivity(${index})">
                    <i class="fas fa-edit"></i>
                </button>
            </td>
        `;
        tbody.appendChild(row);
    });
}

// Initialize Home Workouts
function initializeHomeWorkouts() {
    updateWorkoutStats();
    setupPatientSelection();
}

// Setup Event Listeners
function setupEventListeners() {
    // Patient selection change
    const patientSelect = document.getElementById('workoutPatientSelect');
    if (patientSelect) {
        patientSelect.addEventListener('change', async function() {
            await loadWorkouts();
            updateWorkoutStats();
            await initializeWorkoutCharts();
        });
    }
}

// Load patients into home-workout dropdown
async function loadPatientsForWorkouts() {
    try {
        const resp = await fetch('http://localhost:3000/api/patients');
        const patients = await resp.json();
        const sel = document.getElementById('workoutPatientSelect');
        if (!sel) return;
        const current = sel.value;
        sel.innerHTML = '<option value="">Choose a patient...</option>';
        patients.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.id;
            opt.textContent = `${p.name}${p.age != null ? ' (Age ' + p.age + ')' : ''}`;
            sel.appendChild(opt);
        });
        // maintain selection if still exists
        if (current && patients.find(p => String(p.id) === String(current))) {
            sel.value = current;
        }
    } catch (e) { console.error('Failed to load patients for workouts', e); }
}

// Helpers
function getSelectedPatientId() {
    const el = document.getElementById('workoutPatientSelect');
    return el && el.value ? el.value : '';
}

// Update workout stats
function updateWorkoutStats() {
    const today = new Date().toISOString().split('T')[0];
    const last7 = Date.now() - 6 * 24 * 60 * 60 * 1000;
    const recent = cachedWorkouts.filter(w => new Date(w.timestamp).getTime() >= last7);
    const todayCount = cachedWorkouts.filter(w => new Date(w.timestamp).toISOString().split('T')[0] === today).length;
    const totalMinutes = recent.reduce((s,w)=> s + (parseInt(w.duration)||0), 0);
    const daysWithActivity = new Set(recent.map(w => new Date(w.timestamp).toISOString().split('T')[0])).size;
    const completionRate = Math.round((daysWithActivity / 7) * 100);
    document.getElementById('todayWorkouts').textContent = String(todayCount);
    document.getElementById('weeklyStreak').textContent = String(daysWithActivity);
    document.getElementById('totalMinutes').textContent = String(totalMinutes);
    document.getElementById('completionRate').textContent = `${completionRate}%`;
}

// Categories UI removed; filterCategory no longer needed

// Timer variables
let timerInterval;
let timerSeconds = 0;
let timerRunning = false;
let currentActivityId = null;

// Activity functions
function startActivity(activityId) {
    currentActivityId = activityId;
    // Find recommended duration for this activity
    const durationText = document.querySelector(`.activity-card:has(:contains('${activityId}')) .detail-item:first-child .detail-value`)?.textContent || '15 minutes';
    const recommendedMinutes = parseInt(durationText) || 15;
    
    showModal(`Starting ${activityId}`, `
        <div class="activity-instructions">
            <h4>Instructions for ${activityId}:</h4>
            <ol>
                <li>Prepare all necessary materials</li>
                <li>Set up a comfortable workspace</li>
                <li>Follow the activity guidelines</li>
                <li>Record observations during the activity</li>
            </ol>
            <div class="timer-section">
                <p><strong>Recommended Duration:</strong> ${recommendedMinutes} minutes</p>
                <div class="timer-display" id="timerDisplay">00:00</div>
                <div class="timer-controls">
                    <button class="btn btn-success" id="timerToggleBtn" onclick="toggleTimer(${recommendedMinutes * 60})">
                        <i class="fas fa-play"></i> Start Timer
                    </button>
                    <button class="btn btn-secondary" onclick="resetTimer()">
                        <i class="fas fa-redo"></i> Reset
                    </button>
                </div>
            </div>
        </div>
    `, 'Complete Activity');
    
    // Update modal action button to log activity when completed
    const actionBtn = document.getElementById('modalActionBtn');
    if (actionBtn) {
        actionBtn.onclick = function() {
            closeModal();
            logActivity(activityId);
        };
    }

}

function viewInstructions(activityId) {
    showModal(`${activityId} Instructions`, `
        <div class="instruction-content">
            <h4>Activity Setup:</h4>
            <p>Detailed instructions for ${activityId} would be displayed here...</p>
            
            <h4>Materials Needed:</h4>
            <ul>
                <li>Material 1</li>
                <li>Material 2</li>
                <li>Material 3</li>
            </ul>
            
            <h4>Safety Guidelines:</h4>
            <ul>
                <li>Ensure adult supervision at all times</li>
                <li>Check for any allergies before starting</li>
                <li>Keep first aid kit nearby</li>
            </ul>
        </div>
    `, 'Got It');
}

function logActivity(activityId) {
    // Pre-fill duration if timer was used
    const timerDuration = timerRunning || timerSeconds > 0 ? Math.ceil(timerSeconds / 60) : '';
    
    showModal('Log Activity Results', `
        <form id="activityResultForm">
            <div class="form-group">
                <label>Duration (minutes):</label>
                <input type="number" name="duration" class="form-control" min="1" max="60" value="${timerDuration}" required>
            </div>
            <div class="form-group">
                <label>Performance Level:</label>
                <select name="performance" class="form-control" required>
                    <option value="">Select performance...</option>
                    <option value="excellent">Excellent</option>
                    <option value="good">Good</option>
                    <option value="fair">Fair</option>
                    <option value="needs-improvement">Needs Improvement</option>
                </select>
            </div>
            <div class="form-group">
                <label>Notes:</label>
                <textarea name="notes" class="form-control" rows="3" placeholder="Add any observations or notes..."></textarea>
            </div>
        </form>
    `, 'Save Results');
    
    // Bind action to save activity results
    const actionBtn = document.getElementById('modalActionBtn');
    if (actionBtn) {
        actionBtn.onclick = async function() {
            const form = document.getElementById('activityResultForm');
            if (!form || !form.reportValidity()) return;
            
            const formData = new FormData(form);
            const patientId = getSelectedPatientId();
            
            // Get activity details from the card
            const activityCard = document.querySelector(`.activity-card:has(:contains('${activityId}'))`);
            const activityName = activityCard?.querySelector('.activity-title h3')?.textContent || activityId;
            const category = activityCard?.classList.contains('fine-motor') ? 'fine-motor' : 
                            activityCard?.classList.contains('gross-motor') ? 'gross-motor' : 
                            activityCard?.classList.contains('cognitive') ? 'cognitive' : 'sensory';
            
            const payload = {
                patientId: patientId || 'unknown',
                activityName: activityName,
                category: category,
                duration: parseInt(formData.get('duration')) || 0,
                frequency: activityCard?.querySelector('.detail-item:nth-child(2) .detail-value')?.textContent || 'daily',
                instructions: formData.get('notes') || ''
            };
            
            try {
                await saveNewWorkout(payload);
                
                // Update activity status to completed
                if (activityCard) {
                    const statusBadge = activityCard.querySelector('.status-badge');
                    if (statusBadge) {
                        statusBadge.textContent = 'Completed';
                        statusBadge.className = 'status-badge completed';
                    }
                }
                
                // Reset timer
                resetTimer();
                closeModal();
            } catch (e) {
                console.error(e);
            }
        };
    }

}

function addNewWorkout() {
    showModal('Add New Workout', `
        <form id="newWorkoutForm">
            <div class="form-group">
                <label>Activity Category:</label>
                <select name="category" class="form-control" required>
                    <option value="">Select category...</option>
                    <option value="fine-motor">Fine Motor Skills</option>
                    <option value="gross-motor">Gross Motor Skills</option>
                    <option value="cognitive">Cognitive Skills</option>
                    <option value="sensory">Sensory Processing</option>
                </select>
            </div>
            <div class="form-group">
                <label>Activity Name:</label>
                <input type="text" name="activityName" class="form-control" required>
            </div>
            <div class="form-group">
                <label>Duration (minutes):</label>
                <input type="number" name="duration" class="form-control" min="5" max="60" required>
            </div>
            <div class="form-group">
                <label>Frequency:</label>
                <select name="frequency" class="form-control" required>
                    <option value="daily">Daily</option>
                    <option value="twice-daily">Twice Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="three-weekly">3x Weekly</option>
                </select>
            </div>
            <div class="form-group">
                <label>Instructions:</label>
                <textarea name="instructions" class="form-control" rows="3" required></textarea>
            </div>
        </form>
    `, 'Add Workout');

    // Bind action to save workout
    const actionBtn = document.getElementById('modalActionBtn');
    if (actionBtn) {
        actionBtn.onclick = async function() {
            const form = document.getElementById('newWorkoutForm');
            if (!form) return;
            if (!form.reportValidity()) return;
            const formData = new FormData(form);
            const patientId = getSelectedPatientId();
            const payload = {
                patientId: patientId || 'unknown',
                category: formData.get('category'),
                activityName: formData.get('activityName'),
                duration: parseInt(formData.get('duration')) || 0,
                frequency: formData.get('frequency'),
                instructions: formData.get('instructions')
            };
            try {
                await saveNewWorkout(payload);
                closeModal();
            } catch (e) {
                console.error(e);
            }
        }
    }
}

// Load activity log (kept for existing calls)
function loadActivityLog() {
    buildActivityLogFromWorkouts();
}

// Initialize workout charts
let weeklyProgressChartInstance = null;
let activityDistributionChartInstance = null;

async function initializeWorkoutCharts() {
    await initializeWeeklyProgressChart();
    await initializeActivityDistributionChart();
}

async function initializeWeeklyProgressChart() {
    const ctx = document.getElementById('weeklyProgressChart');
    if (!ctx) return;
    try {
        const patientId = getSelectedPatientId();
        const url = patientId ? `http://localhost:3000/api/charts/homeworkout/weekly?patientId=${encodeURIComponent(patientId)}` : 'http://localhost:3000/api/charts/homeworkout/weekly';
        const res = await fetchJSON(url);
        // Dispose previous instance if any
        const existing = echarts.getInstanceByDom(ctx);
        if (existing) existing.dispose();
        weeklyProgressChartInstance = echarts.init(ctx);
        const option = {
            grid: { left: 40, right: 20, top: 30, bottom: 30 },
            tooltip: { trigger: 'axis' },
            xAxis: { type: 'category', data: res.labels },
            yAxis: { type: 'value' },
            series: [{
                name: 'Activities Completed',
                type: 'line',
                smooth: true,
                areaStyle: { color: 'rgba(102,126,234,0.15)' },
                lineStyle: { color: '#667eea' },
                itemStyle: { color: '#667eea' },
                data: res.data
            }]
        };
        weeklyProgressChartInstance.setOption(option);
    } catch (e) { console.error(e); }
}

async function initializeActivityDistributionChart() {
    const ctx = document.getElementById('activityDistributionChart');
    if (!ctx) return;
    try {
        const patientId = getSelectedPatientId();
        const url = patientId ? `http://localhost:3000/api/charts/homeworkout/distribution?patientId=${encodeURIComponent(patientId)}` : 'http://localhost:3000/api/charts/homeworkout/distribution';
        const res = await fetchJSON(url);
        const existing = echarts.getInstanceByDom(ctx);
        if (existing) existing.dispose();
        activityDistributionChartInstance = echarts.init(ctx);
        const option = {
            tooltip: { trigger: 'item' },
            legend: { show: false },
            series: [{
                type: 'pie',
                radius: ['50%','75%'],
                avoidLabelOverlap: true,
                label: { show: false },
                data: res.labels.map((label, i) => ({
                    name: label,
                    value: res.data[i]
                }))
            }],
            color: ['#667eea', '#f093fb', '#4facfe', '#43e97b', '#f5576c', '#00f2fe', '#764ba2', '#a1c4fd']
        };
        activityDistributionChartInstance.setOption(option);
    } catch (e) { console.error(e); }
}

// Modal functions
function showModal(title, body, actionText = 'OK') {
    document.getElementById('modalTitle').textContent = title;
    document.getElementById('modalBody').innerHTML = body;
    document.getElementById('modalActionBtn').textContent = actionText;
    document.getElementById('activityModal').style.display = 'block';
    
    // Reset modal action button default behavior
    const actionBtn = document.getElementById('modalActionBtn');
    if (actionBtn) {
        actionBtn.onclick = closeModal;
    }
}

function closeModal() {
    document.getElementById('activityModal').style.display = 'none';
}

// Export activity log
function exportActivityLog() {
    // Create CSV content
    let csv = 'Date,Time,Activity,Duration,Performance,Notes\n';
    const logs = [...cachedWorkouts]
        .sort((a,b)=> new Date(b.timestamp) - new Date(a.timestamp))
        .map(w => ({
            date: new Date(w.timestamp).toISOString().split('T')[0],
            time: new Date(w.timestamp).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}),
            activity: w.activityName,
            duration: `${w.duration || 0} min`,
            performance: 'Good',
            notes: w.instructions || ''
        }));
    logs.forEach(log => {
        csv += `"${log.date}","${log.time}","${log.activity}","${log.duration}","${log.performance}","${log.notes}"\n`;
    });
    
    // Download CSV
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `activity_log_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    window.URL.revokeObjectURL(url);
}

// Timer functions
function toggleTimer(duration) {
    const timerDisplay = document.getElementById('timerDisplay');
    const timerBtn = document.getElementById('timerToggleBtn');
    
    if (!timerRunning) {
        // Start timer
        timerRunning = true;
        timerBtn.innerHTML = '<i class="fas fa-pause"></i> Pause';
        
        timerInterval = setInterval(() => {
            timerSeconds++;
            
            // Format time as MM:SS
            const minutes = Math.floor(timerSeconds / 60);
            const seconds = timerSeconds % 60;
            timerDisplay.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
            
            // Alert when reaching recommended duration
            if (timerSeconds === duration) {
                timerDisplay.classList.add('timer-complete');
                new Audio('../assets/sounds/timer-complete.mp3').play().catch(e => console.log('Audio play failed: browser requires user interaction first'));
            }
        }, 1000);
    } else {
        // Pause timer
        clearInterval(timerInterval);
        timerRunning = false;
        timerBtn.innerHTML = '<i class="fas fa-play"></i> Resume';
    }
}

function resetTimer() {
    clearInterval(timerInterval);
    timerRunning = false;
    timerSeconds = 0;
    
    const timerDisplay = document.getElementById('timerDisplay');
    const timerBtn = document.getElementById('timerToggleBtn');
    
    if (timerDisplay) timerDisplay.textContent = '00:00';
    if (timerDisplay) timerDisplay.classList.remove('timer-complete');
    if (timerBtn) timerBtn.innerHTML = '<i class="fas fa-play"></i> Start Timer';
}

// New functions for activity buttons
function continueActivity(activityId) {
    currentActivityId = activityId;
    
    // Find activity details
    const activityCard = document.querySelector(`.activity-card:has(:contains('${activityId}'))`);
    const activityName = activityCard?.querySelector('.activity-title h3')?.textContent || activityId;
    const durationText = activityCard?.querySelector('.detail-item:first-child .detail-value')?.textContent || '15 minutes';
    const recommendedMinutes = parseInt(durationText) || 15;
    
    showModal(`Continue ${activityName}`, `
        <div class="activity-instructions">
            <h4>Resume Activity</h4>
            <p>You are continuing a session that was in progress. Pick up where you left off.</p>
            
            <div class="progress-tracker">
                <div class="progress-bar">
                    <div class="progress-fill" style="width: 45%;"></div>
                </div>
                <p>Approximately 45% complete</p>
            </div>
            
            <div class="timer-section">
                <p><strong>Recommended Duration:</strong> ${recommendedMinutes} minutes</p>
                <div class="timer-display" id="timerDisplay">00:00</div>
                <div class="timer-controls">
                    <button class="btn btn-success" id="timerToggleBtn" onclick="toggleTimer(${recommendedMinutes * 60})">
                        <i class="fas fa-play"></i> Start Timer
                    </button>
                    <button class="btn btn-secondary" onclick="resetTimer()">
                        <i class="fas fa-redo"></i> Reset
                    </button>
                </div>
            </div>
        </div>
    `, 'Complete Activity');
    
    // Update modal action button to log activity when completed
    const actionBtn = document.getElementById('modalActionBtn');
    if (actionBtn) {
        actionBtn.onclick = function() {
            closeModal();
            logActivity(activityId);
        };
    }

}

function resetActivity(activityId) {
    const activityCard = document.querySelector(`.activity-card:has(:contains('${activityId}'))`);
    const activityName = activityCard?.querySelector('.activity-title h3')?.textContent || activityId;
    
    showModal(`Reset ${activityName}`, `
        <div class="reset-confirmation">
            <p>Are you sure you want to reset this activity? This will:</p>
            <ul>
                <li>Clear any saved progress</li>
                <li>Reset the activity status to "Pending"</li>
                <li>Allow you to start fresh</li>
            </ul>
            <p>This action cannot be undone.</p>
        </div>
    `, 'Confirm Reset');
    
    // Update modal action button to perform reset
    const actionBtn = document.getElementById('modalActionBtn');
    if (actionBtn) {
        actionBtn.onclick = function() {
            // Update activity status to pending
            if (activityCard) {
                const statusBadge = activityCard.querySelector('.status-badge');
                if (statusBadge) {
                    statusBadge.textContent = 'Pending';
                    statusBadge.className = 'status-badge pending';
                }
            }
            closeModal();
        };
    }

}

function viewProgress(activityId) {
    const activityCard = document.querySelector(`.activity-card:has(:contains('${activityId}'))`);
    const activityName = activityCard?.querySelector('.activity-title h3')?.textContent || activityId;
    
    // Get related workouts for this activity
    const relatedWorkouts = cachedWorkouts.filter(w => 
        w.activityName.toLowerCase().includes(activityId.toLowerCase()) ||
        activityId.toLowerCase().includes(w.activityName.toLowerCase())
    );
    
    // Calculate stats
    const totalSessions = relatedWorkouts.length;
    const totalMinutes = relatedWorkouts.reduce((sum, w) => sum + (parseInt(w.duration) || 0), 0);
    const avgDuration = totalSessions > 0 ? Math.round(totalMinutes / totalSessions) : 0;
    
    // Generate progress chart HTML
    const chartData = generateProgressChartData(relatedWorkouts);
    
    showModal(`${activityName} Progress`, `
        <div class="activity-progress">
            <div class="progress-stats">
                <div class="stat-item">
                    <div class="stat-value">${totalSessions}</div>
                    <div class="stat-label">Total Sessions</div>
                </div>
                <div class="stat-item">
                    <div class="stat-value">${totalMinutes}</div>
                    <div class="stat-label">Total Minutes</div>
                </div>
                <div class="stat-item">
                    <div class="stat-value">${avgDuration}</div>
                    <div class="stat-label">Avg. Duration</div>
                </div>
            </div>
            
            <h4>Recent Activity</h4>
            <div class="progress-chart-container" style="height: 200px;">
                <canvas id="activityProgressChart"></canvas>
            </div>
            
            <h4>Notes from Recent Sessions</h4>
            <div class="recent-notes">
                ${relatedWorkouts.length > 0 ? 
                    relatedWorkouts.slice(0, 3).map(w => 
                        `<div class="note-item">
                            <div class="note-date">${new Date(w.timestamp).toLocaleDateString()}</div>
                            <div class="note-text">${w.instructions || 'No notes recorded'}</div>
                        </div>`
                    ).join('') : 
                    '<p>No session notes available yet.</p>'
                }
            </div>
        </div>
    `, 'Close');
    
    // Render progress chart if there's data
    setTimeout(() => {
        const ctx = document.getElementById('activityProgressChart');
        if (ctx && chartData.labels.length > 0) {
            new Chart(ctx, {
                type: 'line',
                data: {
                    labels: chartData.labels,
                    datasets: [{
                        label: 'Duration (minutes)',
                        data: chartData.durations,
                        borderColor: '#667eea',
                        backgroundColor: 'rgba(102, 126, 234, 0.1)',
                        tension: 0.4,
                        fill: true
                    }]
                },
                options: { 
                    responsive: true, 
                    maintainAspectRatio: false,
                    scales: {
                        y: {
                            beginAtZero: true,
                            title: {
                                display: true,
                                text: 'Minutes'
                            }
                        }
                    }
                }
            });
        }
    }, 100);
}

// Helper function to generate chart data for activity progress
function generateProgressChartData(workouts) {
    // Sort by date
    const sortedWorkouts = [...workouts].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    
    // Get last 7 entries or fewer
    const recentWorkouts = sortedWorkouts.slice(-7);
    
    return {
        labels: recentWorkouts.map(w => new Date(w.timestamp).toLocaleDateString()),
        durations: recentWorkouts.map(w => parseInt(w.duration) || 0)
    };
}

// Close modal when clicking outside
window.onclick = function(event) {
    const modal = document.getElementById('activityModal');
    if (event.target === modal) {
        closeModal();
    }
};
