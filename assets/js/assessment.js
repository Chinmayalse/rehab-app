// Assessment Form JavaScript
document.addEventListener('DOMContentLoaded', function() {
    initializeAssessmentForm();
    setupRangeInputs();
    setupPatientSelection();
    loadPatients();
    bindCreatePatient();
});

// Initialize Assessment Form
function initializeAssessmentForm() {
    const form = document.getElementById('rehabilitationForm');
    if (form) {
        form.addEventListener('submit', handleFormSubmit);
    }
    
    // Initialize form validation
    setupFormValidation();
}

// Setup Range Inputs
function setupRangeInputs() {
    const rangeInputs = document.querySelectorAll('.range-input');
    rangeInputs.forEach(input => {
        const valueSpan = input.nextElementSibling;
        
        // Set initial value
        if (valueSpan && valueSpan.classList.contains('range-value')) {
            valueSpan.textContent = input.value;
        }
        
        // Update value on change
        input.addEventListener('input', function() {
            if (valueSpan && valueSpan.classList.contains('range-value')) {
                valueSpan.textContent = this.value;
            }
        });
    });
}

// Setup Patient Selection
function setupPatientSelection() {
    const patientSelect = document.getElementById('patientSelect');
    const assessmentForm = document.getElementById('assessmentForm');
    
    if (patientSelect && assessmentForm) {
        patientSelect.addEventListener('change', function() {
            if (this.value) {
                assessmentForm.style.display = 'block';
                assessmentForm.scrollIntoView({ behavior: 'smooth' });
            } else {
                assessmentForm.style.display = 'none';
            }
        });
    }
}

// Load patients into dropdown
async function loadPatients() {
    try {
        const resp = await fetch('http://localhost:3000/api/patients');
        const patients = await resp.json();
        const sel = document.getElementById('patientSelect');
        if (!sel) return;
        // Keep the first placeholder option
        sel.innerHTML = '<option value="">Choose a patient...</option>';
        patients.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.id;
            opt.textContent = `${p.name}${p.age != null ? ' (Age ' + p.age + ')' : ''}`;
            sel.appendChild(opt);
        });
    } catch (e) { console.error('Failed to load patients', e); }
}

function bindCreatePatient() {
    const btn = document.getElementById('createPatientBtn');
    if (!btn) return;
    btn.addEventListener('click', createNewPatient);
}

async function createNewPatient() {
    const nameEl = document.getElementById('newPatientName');
    const ageEl = document.getElementById('newPatientAge');
    const name = (nameEl?.value || '').trim();
    const age = ageEl?.value ? parseInt(ageEl.value) : undefined;
    if (!name) { alert('Please enter a patient name'); return; }
    try {
        const resp = await fetch('http://localhost:3000/api/patients', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, age })
        });
        const patient = await resp.json();
        if (!resp.ok) { alert('Failed to create patient'); return; }
        // Add to dropdown and select
        const sel = document.getElementById('patientSelect');
        if (sel) {
            const opt = document.createElement('option');
            opt.value = patient.id;
            opt.textContent = `${patient.name}${patient.age != null ? ' (Age ' + patient.age + ')' : ''}`;
            sel.appendChild(opt);
            sel.value = patient.id;
            sel.dispatchEvent(new Event('change'));
        }
        // Clear inputs
        if (nameEl) nameEl.value = '';
        if (ageEl) ageEl.value = '';
    } catch (e) { console.error(e); alert('Failed to create patient.'); }
}

// Updated handleFormSubmit in assessment.js
function handleFormSubmit(event) {
    event.preventDefault();
    
    const formData = new FormData(event.target);
    const assessmentData = {};
    
    for (let [key, value] of formData.entries()) {
        assessmentData[key] = value;
    }
    
    const patientSelect = document.getElementById('patientSelect');
    if (!patientSelect || !patientSelect.value) {
        alert('Please select or create a patient before saving the assessment.');
        return;
    }
    assessmentData.patientId = patientSelect.value;
    assessmentData.timestamp = new Date().toISOString();
    
    fetch('http://localhost:3000/api/assessments', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(assessmentData),
    })
    .then(response => response.json())
    .then(data => {
        alert(data.message);
        resetForm();
    })
    .catch((error) => {
        console.error('Error:', error);
        alert('Failed to save assessment.');
    });
}


// Generate Assessment ID
function generateAssessmentId() {
    return 'ASSESS_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
}

// Validate Assessment Data
function validateAssessmentData(data) {
    const requiredFields = ['patientId'];
    const missingFields = [];
    
    requiredFields.forEach(field => {
        if (!data[field]) {
            missingFields.push(field);
        }
    });
    
    if (missingFields.length > 0) {
        alert(`Please fill in the following required fields: ${missingFields.join(', ')}`);
        return false;
    }
    
    return true;
}

// Save Assessment
function saveAssessment(data) {
    // Simulate API call
    console.log('Saving assessment data:', data);
    
    // Show loading state
    const submitButton = document.querySelector('button[type="submit"]');
    const originalText = submitButton.innerHTML;
    submitButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
    submitButton.disabled = true;
    
    // Simulate API delay
    setTimeout(() => {
        // Reset button
        submitButton.innerHTML = originalText;
        submitButton.disabled = false;
        
        // Show success message
        showSuccessMessage('Assessment saved successfully!');
        
        // Optionally redirect or reset form
        setTimeout(() => {
            if (confirm('Assessment saved! Would you like to create another assessment?')) {
                resetForm();
            } else {
                window.location.href = '../index.html';
            }
        }, 1500);
        
    }, 2000);
}

// Reset Form
function resetForm() {
    const form = document.getElementById('rehabilitationForm');
    const patientSelect = document.getElementById('patientSelect');
    const assessmentForm = document.getElementById('assessmentForm');
    
    if (form) {
        form.reset();
    }
    
    if (patientSelect) {
        patientSelect.value = '';
    }
    
    if (assessmentForm) {
        assessmentForm.style.display = 'none';
    }
    
    // Reset range input displays
    setupRangeInputs();
    
    // Scroll to top
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Setup Form Validation
function setupFormValidation() {
    const inputs = document.querySelectorAll('.form-control');
    
    inputs.forEach(input => {
        input.addEventListener('blur', function() {
            validateField(this);
        });
        
        input.addEventListener('input', function() {
            clearFieldError(this);
        });
    });
}

// Validate Individual Field
function validateField(field) {
    const value = field.value.trim();
    const fieldName = field.getAttribute('name');
    
    // Remove existing error styling
    clearFieldError(field);
    
    // Basic validation rules
    if (field.hasAttribute('required') && !value) {
        showFieldError(field, 'This field is required');
        return false;
    }
    
    if (field.type === 'number') {
        const min = field.getAttribute('min');
        const max = field.getAttribute('max');
        const numValue = parseFloat(value);
        
        if (value && isNaN(numValue)) {
            showFieldError(field, 'Please enter a valid number');
            return false;
        }
        
        if (min && numValue < parseFloat(min)) {
            showFieldError(field, `Value must be at least ${min}`);
            return false;
        }
        
        if (max && numValue > parseFloat(max)) {
            showFieldError(field, `Value must be no more than ${max}`);
            return false;
        }
    }
    
    return true;
}

// Show Field Error
function showFieldError(field, message) {
    field.style.borderColor = '#e74c3c';
    
    // Remove existing error message
    const existingError = field.parentNode.querySelector('.field-error');
    if (existingError) {
        existingError.remove();
    }
    
    // Add error message
    const errorDiv = document.createElement('div');
    errorDiv.className = 'field-error';
    errorDiv.style.cssText = 'color: #e74c3c; font-size: 0.8rem; margin-top: 5px;';
    errorDiv.textContent = message;
    field.parentNode.appendChild(errorDiv);
}

// Clear Field Error
function clearFieldError(field) {
    field.style.borderColor = '#ddd';
    const errorMessage = field.parentNode.querySelector('.field-error');
    if (errorMessage) {
        errorMessage.remove();
    }
}

// Show Success Message
function showSuccessMessage(message) {
    // Create success notification
    const notification = document.createElement('div');
    notification.className = 'success-notification';
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: #27ae60;
        color: white;
        padding: 15px 20px;
        border-radius: 5px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        z-index: 1000;
        animation: slideIn 0.3s ease;
    `;
    notification.innerHTML = `
        <i class="fas fa-check-circle"></i> ${message}
    `;
    
    // Add animation
    const style = document.createElement('style');
    style.textContent = `
        @keyframes slideIn {
            from { transform: translateX(100%); opacity: 0; }
            to { transform: translateX(0); opacity: 1; }
        }
    `;
    document.head.appendChild(style);
    
    document.body.appendChild(notification);
    
    // Remove after 3 seconds
    setTimeout(() => {
        notification.remove();
        style.remove();
    }, 3000);
}

// Calculate Overall Score
function calculateOverallScore(data) {
    const scoringFields = [
        'fineMotor_grip', 'grossMotor_balance', 'cognitive_approach',
        'emotional_quality', 'communication_clarity', 'communication_grammar'
    ];
    
    let totalScore = 0;
    let fieldCount = 0;
    
    scoringFields.forEach(field => {
        if (data[field]) {
            totalScore += parseInt(data[field]);
            fieldCount++;
        }
    });
    
    return fieldCount > 0 ? Math.round((totalScore / (fieldCount * 5)) * 100) : 0;
}

// Auto-save functionality (optional)
function setupAutoSave() {
    const form = document.getElementById('rehabilitationForm');
    if (!form) return;
    
    let autoSaveTimer;
    
    form.addEventListener('input', function() {
        clearTimeout(autoSaveTimer);
        autoSaveTimer = setTimeout(() => {
            const formData = new FormData(form);
            const data = {};
            for (let [key, value] of formData.entries()) {
                data[key] = value;
            }
            
            // Save to localStorage
            localStorage.setItem('assessmentDraft', JSON.stringify(data));
            console.log('Draft saved automatically');
        }, 2000);
    });
}

// Load draft data
function loadDraftData() {
    const draftData = localStorage.getItem('assessmentDraft');
    if (draftData) {
        try {
            const data = JSON.parse(draftData);
            const form = document.getElementById('rehabilitationForm');
            
            if (form && confirm('Found a saved draft. Would you like to restore it?')) {
                Object.keys(data).forEach(key => {
                    const field = form.querySelector(`[name="${key}"]`);
                    if (field) {
                        field.value = data[key];
                        
                        // Trigger change event for range inputs
                        if (field.type === 'range') {
                            field.dispatchEvent(new Event('input'));
                        }
                    }
                });
            }
        } catch (e) {
            console.error('Error loading draft data:', e);
        }
    }
}
