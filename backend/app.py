import os
import json
from pathlib import Path
from typing import List, Optional, Dict, Any
from datetime import datetime, date, timezone

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

# Load environment variables from project .env if present
try:
    from dotenv import load_dotenv
    # Load .env from project root
    project_root = Path(__file__).resolve().parents[1]
    load_dotenv(dotenv_path=project_root / '.env')
except Exception:
    pass

# Gemini setup
GEMINI_API_KEY = os.getenv('GEMINI_API_KEY')

try:
    import google.generativeai as genai
    if GEMINI_API_KEY:
        genai.configure(api_key=GEMINI_API_KEY)
    GEMINI_MODEL_NAME = "gemini-2.0-flash"
except Exception:
    genai = None
    GEMINI_MODEL_NAME = None

app = FastAPI(title="Children Rehab Backend", version="0.1.0")

# CORS for local files and localhost origins
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "*",  # using file:// in browser; relax for local dev
        "http://localhost",
        "http://127.0.0.1",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:8000",
        "http://127.0.0.1:8000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Data storage directory
DATA_DIR = Path(__file__).resolve().parent / 'data'
DATA_DIR.mkdir(parents=True, exist_ok=True)
ASSESSMENTS_FILE = DATA_DIR / 'assessments.json'
WORKOUTS_FILE = DATA_DIR / 'workouts.json'
PATIENTS_FILE = DATA_DIR / 'patients.json'

# Ensure files exist
for f in [ASSESSMENTS_FILE, WORKOUTS_FILE, PATIENTS_FILE]:
    if not f.exists():
        f.write_text(json.dumps([], indent=2))


def _read_json(path: Path) -> List[Dict[str, Any]]:
    try:
        return json.loads(path.read_text() or "[]")
    except Exception:
        return []


def _write_json(path: Path, data: List[Dict[str, Any]]):
    path.write_text(json.dumps(data, indent=2))


def _read_patients_as_map() -> Dict[str, Dict[str, Any]]:
    items: List[Dict[str, Any]] = _read_json(PATIENTS_FILE)
    result: Dict[str, Dict[str, Any]] = {}
    for p in items:
        if not p.get('id'):
            p['id'] = str(len(result) + 1)
        result[str(p['id'])] = p
    return result


@app.get("/api/patients")
async def get_patients():
    return list(_read_patients_as_map().values())


class NewPatient(BaseModel):
    name: str
    age: Optional[int] = None


@app.post("/api/patients")
async def create_patient(p: NewPatient):
    items: List[Dict[str, Any]] = _read_json(PATIENTS_FILE)
    new_id = str(int(datetime.now().timestamp()*1000))
    rec = {"id": new_id, "name": p.name.strip(), "age": p.age}
    items.append(rec)
    _write_json(PATIENTS_FILE, items)
    return rec


# Admin clear endpoints to delete dummy/old data
@app.post("/api/admin/clear")
async def admin_clear(type: Optional[str] = "all"):
    if type in ("assessments", "all"):
        _write_json(ASSESSMENTS_FILE, [])
    if type in ("workouts", "all"):
        _write_json(WORKOUTS_FILE, [])
    if type in ("patients", "all"):
        _write_json(PATIENTS_FILE, [])
    return {"status": "cleared", "type": type}


class Assessment(BaseModel):
    id: str = Field(default_factory=lambda: f"ASSESS_{int(datetime.now(timezone.utc).timestamp()*1000)}")
    patientId: str
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    data: Dict[str, Any] = Field(default_factory=dict)


class Workout(BaseModel):
    id: str = Field(default_factory=lambda: f"WORK_{int(datetime.now(timezone.utc).timestamp()*1000)}")
    patientId: str
    activityName: str
    category: str
    duration: int
    frequency: str
    instructions: Optional[str] = None
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class ReportRequest(BaseModel):
    patientId: Optional[str] = None
    reportType: str = "daily"
    startDate: Optional[date] = None
    endDate: Optional[date] = None
    format: Optional[str] = "text"  # "text" | "pdf"


# Utility computations

def compute_assessment_score(assessment: Assessment) -> int:
    # Basic scoring from range inputs if present (1-5 scaled to percentage)
    keys = [
        'fineMotor_grip', 'grossMotor_balance', 'cognitive_approach',
        'emotional_quality', 'communication_clarity', 'communication_grammar'
    ]
    values = []
    for k in keys:
        v = assessment.data.get(k)
        try:
            if v is not None:
                values.append(int(v))
        except Exception:
            continue
    if not values:
        return 0
    return round(sum(values) / (len(values) * 5) * 100)


def parse_iso_ts(value: Optional[str]) -> datetime:
    """Parse ISO 8601 timestamps, including 'Z' suffix. Fallback to UTC now."""
    if not value:
        return datetime.now(timezone.utc)
    try:
        v = value.replace('Z', '+00:00')
        return datetime.fromisoformat(v)
    except Exception:
        return datetime.now(timezone.utc)


def compute_dashboard_stats(assessments: List[Assessment], workouts: List[Workout]) -> Dict[str, Any]:
    patients = {a.patientId for a in assessments} | {w.patientId for w in workouts}
    today_str = datetime.now(timezone.utc).date().isoformat()
    todays_assessments = [a for a in assessments if a.timestamp.date().isoformat() == today_str]
    avg_progress_list = [compute_assessment_score(a) for a in assessments if compute_assessment_score(a) > 0]
    avg_progress = round(sum(avg_progress_list) / len(avg_progress_list)) if avg_progress_list else 0
    return {
        'activePatients': len(patients),
        'todaysAssessments': len(todays_assessments),
        'averageProgress': avg_progress,
        'homeWorkouts': len(workouts)
    }


def compute_weekly_activity(workouts: List[Workout]) -> Dict[str, Any]:
    # Return counts for last 7 days (Mon..Sun as labels)
    labels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
    counts = {i: 0 for i in range(7)}
    for w in workouts:
        counts[w.timestamp.weekday()] = counts.get(w.timestamp.weekday(), 0) + 1
    data = [counts[i] for i in range(7)]
    return {'labels': labels, 'data': data}


def compute_activity_distribution(workouts: List[Workout]) -> Dict[str, Any]:
    categories = ['fine-motor', 'gross-motor', 'cognitive', 'sensory', 'communication', 'social', 'adl', 'attention']
    counts = {c: 0 for c in categories}
    for w in workouts:
        c = (w.category or '').lower()
        if c in counts:
            counts[c] += 1
    labels = ['Fine Motor', 'Gross Motor', 'Cognitive', 'Sensory', 'Communication', 'Social', 'ADL', 'Attention']
    data = [counts['fine-motor'], counts['gross-motor'], counts['cognitive'], counts['sensory'], counts['communication'], counts['social'], counts['adl'], counts['attention']]
    return {'labels': labels, 'data': data}


# Routes
@app.get("/api/health")
async def health():
    return {"status": "ok", "time": datetime.now(timezone.utc).isoformat()}


# Assessments
@app.post("/api/assessments")
async def create_assessment(payload: Dict[str, Any]):
    if not payload.get('patientId'):
        # Accept both flat and nested shapes; assessment.js sends flat fields + patientId
        pid = payload.get('patientId') or payload.get('patient_id')
        if not pid:
            raise HTTPException(status_code=400, detail="patientId is required")
        payload['patientId'] = pid

    # Separate known fields
    assessment = Assessment(
        patientId=str(payload.get('patientId')),
        timestamp=parse_iso_ts(payload.get('timestamp')),
        data={k: v for k, v in payload.items() if k not in ['patientId', 'timestamp']}
    )
    # Read raw JSON list, append serialized assessment, and write back
    items_raw = _read_json(ASSESSMENTS_FILE)
    items_raw.append(json.loads(assessment.model_dump_json()))
    _write_json(ASSESSMENTS_FILE, items_raw)
    return {"message": "Assessment saved successfully", "id": assessment.id, "score": compute_assessment_score(assessment)}


@app.get("/api/assessments")
async def list_assessments(patientId: Optional[str] = None, limit: Optional[int] = None):
    items = _read_json(ASSESSMENTS_FILE)
    if patientId:
        items = [a for a in items if str(a.get('patientId')) == str(patientId)]
    # Normalize timestamp to ISO
    patients_map = _read_patients_as_map()
    for a in items:
        if isinstance(a.get('timestamp'), str):
            try:
                # ensure ISO
                datetime.fromisoformat(a['timestamp'].replace('Z', '+00:00'))
            except Exception:
                a['timestamp'] = datetime.now(timezone.utc).isoformat()
        # enrich with patient info
        pid = str(a.get('patientId')) if a.get('patientId') is not None else ''
        p = patients_map.get(pid)
        if p:
            a['patientName'] = p['name']
            a['patientAge'] = p['age']
    if limit:
        items = sorted(items, key=lambda x: x.get('timestamp', ''), reverse=True)[:limit]
    return items


# Workouts
@app.post("/api/workouts")
async def create_workout(workout: Workout):
    items = _read_json(WORKOUTS_FILE)
    items.append(json.loads(workout.model_dump_json()))
    _write_json(WORKOUTS_FILE, items)
    return {"message": "Workout saved successfully", "id": workout.id}


@app.get("/api/workouts")
async def list_workouts(patientId: Optional[str] = None):
    items = _read_json(WORKOUTS_FILE)
    if patientId:
        items = [w for w in items if str(w.get('patientId')) == str(patientId)]
    return items


# Dashboard stats and charts
@app.get("/api/stats/dashboard")
async def dashboard_stats(patientId: Optional[str] = None):
    assessments = [Assessment(**a) if 'data' in a else Assessment(patientId=a.get('patientId'), timestamp=datetime.fromisoformat(a.get('timestamp')) if a.get('timestamp') else datetime.utcnow(), data=a.get('data', {}), id=a.get('id', f"ASSESS_{int(datetime.now().timestamp()*1000)}")) for a in _read_json(ASSESSMENTS_FILE)]
    workouts = [Workout(**w) for w in _read_json(WORKOUTS_FILE)]
    if patientId:
        assessments = [a for a in assessments if str(a.patientId) == str(patientId)]
        workouts = [w for w in workouts if str(w.patientId) == str(patientId)]
    return compute_dashboard_stats(assessments, workouts)


@app.get("/api/charts/homeworkout/weekly")
async def chart_homeworkout_weekly(patientId: Optional[str] = None):
    workouts = [Workout(**w) for w in _read_json(WORKOUTS_FILE)]
    if patientId:
        workouts = [w for w in workouts if str(w.patientId) == str(patientId)]
    return compute_weekly_activity(workouts)


@app.get("/api/charts/homeworkout/distribution")
async def chart_homeworkout_distribution(patientId: Optional[str] = None):
    workouts = [Workout(**w) for w in _read_json(WORKOUTS_FILE)]
    if patientId:
        workouts = [w for w in workouts if str(w.patientId) == str(patientId)]
    return compute_activity_distribution(workouts)


@app.get("/api/charts/dashboard/progress")
async def chart_dashboard_progress(patientId: Optional[str] = None, days: Optional[int] = 7):
    """Return average assessment score for each of the last N days (default 7)."""
    raw = _read_json(ASSESSMENTS_FILE)
    if patientId:
        raw = [a for a in raw if str(a.get('patientId')) == str(patientId)]
    assessments = [
        Assessment(
            patientId=a.get('patientId'),
            timestamp=parse_iso_ts(a.get('timestamp')),
            data=a.get('data', {}),
            id=a.get('id', f"ASSESS_{int(datetime.now(timezone.utc).timestamp()*1000)}")
        ) for a in raw
    ]
    # Build date buckets for last N days
    try:
        n = max(1, min(int(days or 7), 90))
    except Exception:
        n = 7
    today = datetime.now(timezone.utc).date()
    dates = [(today, today.isoformat())]
    for i in range(1, n):
        d = today.fromordinal(today.toordinal() - i)
        dates.append((d, d.isoformat()))
    dates.reverse()
    buckets: Dict[str, list[int]] = {iso: [] for _, iso in dates}
    for a in assessments:
        iso = a.timestamp.date().isoformat()
        if iso in buckets:
            buckets[iso].append(compute_assessment_score(a))
    labels = [d.strftime('%b %d') for d, _ in dates]
    data = [round(sum(vals)/len(vals)) if vals else 0 for _, iso in dates for vals in [buckets[iso]]]
    return {'labels': labels, 'data': data}


@app.get("/api/charts/dashboard/skills")
async def chart_dashboard_skills(patientId: Optional[str] = None):
    # Aggregate assessment fields into categories and average to percentages
    raw = _read_json(ASSESSMENTS_FILE)
    if patientId:
        raw = [a for a in raw if str(a.get('patientId')) == str(patientId)]
    assessments = [
        Assessment(
            patientId=a.get('patientId'),
            timestamp=parse_iso_ts(a.get('timestamp')),
            data=a.get('data', {}),
            id=a.get('id', f"ASSESS_{int(datetime.now(timezone.utc).timestamp()*1000)}")
        ) for a in raw
    ]

    categories: Dict[str, list] = {
        'Fine Motor': ['fineMotor_grip', 'fineMotor_beads'],
        'Gross Motor': ['grossMotor_balance', 'grossMotor_time', 'grossMotor_falls'],
        'Cognitive': ['cognitive_approach', 'cognitive_memory'],
        'Sensory': ['sensory_behavior'],
        'Communication': ['communication_clarity', 'communication_grammar'],
        'Social': ['social_interaction'],
        'ADL': ['adl_independence'],
        'Attention': ['attention_span']
    }

    labels = list(categories.keys())
    data: list[int] = []
    for label in labels:
        keys = categories[label]
        vals: list[int] = []
        for a in assessments:
            for k in keys:
                v = a.data.get(k)
                try:
                    if v is not None:
                        vals.append(int(v))
                except Exception:
                    continue
        if vals:
            pct = round(sum(vals) / (len(vals) * 5) * 100)
        else:
            pct = 0
        data.append(pct)

    return { 'labels': labels, 'data': data }


# Reports data
@app.get("/api/reports/skill-performance")
async def reports_skill_performance(patientId: Optional[str] = None):
    assessments = [Assessment(**a) if 'data' in a else Assessment(patientId=a.get('patientId'), timestamp=datetime.fromisoformat(a.get('timestamp')) if a.get('timestamp') else datetime.utcnow(), data=a.get('data', {}), id=a.get('id', f"ASSESS_{int(datetime.now().timestamp()*1000)}")) for a in _read_json(ASSESSMENTS_FILE)]
    if patientId:
        assessments = [a for a in assessments if str(a.patientId) == str(patientId)]
    # Aggregate by category using available range fields
    categories = {
        'Fine Motor Skills': ['fineMotor_grip'],
        'Gross Motor Skills': ['grossMotor_balance'],
        'Cognitive Abilities': ['cognitive_approach'],
        'Communication Skills': ['communication_clarity', 'communication_grammar'],
        'Social Skills': [],
        'ADL Skills': ['adl_independence'],
        'Sensory Processing': ['sensory_behavior'],
        'Attention & Concentration': []
    }
    results = []
    for label, keys in categories.items():
        scores = []
        prev_scores = []
        for a in assessments:
            vals = [int(a.data.get(k)) for k in keys if a.data.get(k) is not None]
            if vals:
                scores.append(round(sum(vals)/ (len(vals)*5) * 100))
        # naive previous score as average of all but last
        if len(scores) > 1:
            prev_scores = scores[:-1]
        current = round(sum(scores)/len(scores)) if scores else 0
        previous = round(sum(prev_scores)/len(prev_scores)) if prev_scores else max(0, current-5)
        status = 'On Track' if current >= previous else 'Improving' if current > 0 else 'Needs Attention'
        goal = min(100, max(80, current + 5)) if current else 80
        results.append({
            'skill': label,
            'current': current,
            'previous': previous,
            'goal': goal,
            'status': status
        })
    return results


@app.get("/api/reports/session-history")
async def reports_session_history(patientId: Optional[str] = None):
    assessments = _read_json(ASSESSMENTS_FILE)
    items = []
    patients_map = _read_patients_as_map()
    for a in assessments:
        if patientId and str(a.get('patientId')) != str(patientId):
            continue
        ts = a.get('timestamp')
        try:
            d = parse_iso_ts(ts).date().isoformat()
        except Exception:
            d = datetime.now(timezone.utc).date().isoformat()
        pid = str(a.get('patientId')) if a.get('patientId') is not None else ''
        p = patients_map.get(pid, {})
        items.append({
            'date': d,
            'patient': p.get('name') or a.get('patientId', 'Unknown'),
            'patientId': pid,
            'age': p.get('age'),
            'duration': 45,  # placeholder duration
            'activities': 'Assessment Session',
            'score': compute_assessment_score(Assessment(patientId=a.get('patientId'), timestamp=datetime.now(timezone.utc), data=a.get('data', {}))),
            'notes': a.get('data', {}).get('fineMotor_notes', '')[:60]
        })
    # Sort by date desc
    items.sort(key=lambda x: x['date'], reverse=True)
    return items


# AI Report Generation
def _build_pdf_bytes(title: str, content: str) -> bytes:
    """Generate a simple PDF from plain text using reportlab."""
    try:
        from reportlab.lib.pagesizes import A4
        from reportlab.lib.styles import getSampleStyleSheet
        from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
        from reportlab.lib.units import inch
        from reportlab.lib import colors
    except Exception as e:
        # If reportlab missing, return bytes of text for graceful fallback
        return (title + "\n\n" + content).encode("utf-8")

    from io import BytesIO
    buffer = BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=A4, title=title, 
                          leftMargin=0.75*inch, rightMargin=0.75*inch,
                          topMargin=0.75*inch, bottomMargin=0.75*inch)
    styles = getSampleStyleSheet()
    
    # Enhanced styles
    title_style = styles['Title']
    heading1_style = styles['Heading1']
    heading2_style = styles['Heading2']
    normal_style = styles['Normal']
    
    # Custom bullet style
    bullet_style = styles['Normal'].clone('BulletPoint')
    bullet_style.leftIndent = 20
    
    story = []
    
    # Add title and date
    story.append(Paragraph(title, title_style))
    story.append(Spacer(1, 0.2*inch))
    
    # Process content with proper heading detection and formatting
    current_section = []
    in_bullet_list = False
    
    for line in content.split('\n'):
        line = line.strip()
        if not line:
            story.append(Spacer(1, 0.15*inch))
            in_bullet_list = False
            continue
            
        # Detect headings
        if line.startswith('# '):
            # Add any accumulated content before starting new section
            if current_section:
                story.extend(current_section)
                current_section = []
                
            # Add main heading (H1)
            story.append(Paragraph(line[2:], heading1_style))
            story.append(Spacer(1, 0.15*inch))
            in_bullet_list = False
            
        elif line.startswith('## '):
            # Add any accumulated content before starting new section
            if current_section:
                story.extend(current_section)
                current_section = []
                
            # Add subheading (H2)
            story.append(Paragraph(line[3:], heading2_style))
            story.append(Spacer(1, 0.1*inch))
            in_bullet_list = False
            
        elif line.startswith('* ') or line.startswith('- '):
            # Bullet point
            bullet_text = line[2:].replace('  ', '&nbsp;&nbsp;')
            current_section.append(Paragraph(f"• {bullet_text}", bullet_style))
            in_bullet_list = True
            
        elif line.startswith('  * ') or line.startswith('  - '):
            # Nested bullet point
            bullet_text = line[4:].replace('  ', '&nbsp;&nbsp;')
            nested_style = bullet_style.clone('NestedBullet')
            nested_style.leftIndent = 40
            current_section.append(Paragraph(f"  ○ {bullet_text}", nested_style))
            
        elif in_bullet_list and (line.startswith('  ') or line.startswith('   ')):
            # Continuation of bullet point
            last_item = current_section[-1]
            text = last_item.text + ' ' + line.strip().replace('  ', '&nbsp;&nbsp;')
            current_section[-1] = Paragraph(text, bullet_style)
            
        else:
            # Regular paragraph
            current_section.append(Paragraph(line.replace('  ', '&nbsp;&nbsp;'), normal_style))
            in_bullet_list = False
    
    # Add any remaining content
    if current_section:
        story.extend(current_section)
        
    doc.build(story)
    pdf = buffer.getvalue()
    buffer.close()
    return pdf


@app.post("/api/reports/generate")
async def generate_report(req: ReportRequest, request: Request):
    assessments = [
        Assessment(
            patientId=a.get('patientId'),
            timestamp=parse_iso_ts(a.get('timestamp')),
            data=a.get('data', {}),
            id=a.get('id', f"ASSESS_{int(datetime.now(timezone.utc).timestamp()*1000)}")
        ) for a in _read_json(ASSESSMENTS_FILE)
    ]
    workouts = [Workout(**w) for w in _read_json(WORKOUTS_FILE)]

    if req.patientId:
        assessments = [a for a in assessments if str(a.patientId) == str(req.patientId)]
        workouts = [w for w in workouts if str(w.patientId) == str(req.patientId)]

    stats = compute_dashboard_stats(assessments, workouts)
    patients_map = _read_patients_as_map()
    patient_info = patients_map.get(str(req.patientId)) if req.patientId else None

    # Prepare content (Gemini or fallback)
    content = None
    # If no meaningful data, return a neutral guidance report
    has_scores = any(compute_assessment_score(a) > 0 for a in assessments)
    if (not has_scores) and (len(workouts) == 0):
        pname = (patient_info or {}).get('name', 'the patient')
        page = (patient_info or {}).get('age')
        age_str = f" (Age {page})" if page is not None else ""
        content = (
            f"Insufficient data to generate a detailed report for {pname}{age_str} at this time.\n\n"
            "What this means:"
            "- No scored assessment fields were provided yet, and no home workouts are recorded.\n\n"
            "Recommended next steps:"
            "- Complete at least one assessment with key skill ratings (e.g., Fine Motor, Gross Motor, Communication).\n"
            "- Optionally log a few home workout activities to enrich the analysis.\n"
            "Once new data is available, generate the report again to see personalized insights and recommendations."
        )
    
    if genai is None or not GEMINI_API_KEY or not GEMINI_MODEL_NAME:
        if content is None:
            content = (
                f"AI is not configured. Summary placeholder:\n"
                f"Active Patients: {stats['activePatients']}\n"
                f"Average Progress: {stats['averageProgress']}%\n"
                f"Total Workouts: {stats['homeWorkouts']}\n"
            )
    else:
        # Compose prompt with aggregated data
        def truncate(s: str, n: int = 2000) -> str:
            return s if len(s) <= n else s[:n] + '...'

        assessments_preview = [
            {
                'patientId': a.patientId,
                'timestamp': a.timestamp.isoformat(),
                'score': compute_assessment_score(a),
                'highlights': {k: a.data.get(k) for k in list(a.data.keys())[:8]}
            }
            for a in assessments[-50:]  # limit
        ]
        workouts_preview = [
            {
                'patientId': w.patientId,
                'activityName': w.activityName,
                'category': w.category,
                'duration': w.duration,
                'timestamp': w.timestamp.isoformat()
            }
            for w in workouts[-100:]
        ]

        system_instructions = (
            """
            You are an expert pediatric rehabilitation data analyst generating a professional report.
            
            FORMAT REQUIREMENTS:
            1. DO NOT use markdown syntax or code blocks
            2. Use plain text formatting with these conventions:
               - Main headings: Start with "# " (e.g., "# Patient Summary")
               - Subheadings: Start with "## " (e.g., "## Strengths")
               - Bullet points: Start with "* " (e.g., "* Fine motor skills improving")
               - Nested bullets: Start with "  * " (with two spaces)
            3. Include clear section breaks between major sections. dont use extra spaces after section break
            4. Start with a clear title and patient information section
            
            CONTENT REQUIREMENTS:
            - Summarize overall performance and key trends
            - Highlight strengths and positive progress
            - Identify areas needing attention or improvement
            - Provide clear, actionable recommendations and next steps
            - Maintain a professional, supportive tone suitable for parents and caregivers
            
            The output will be formatted as a PDF, so ensure proper spacing and organization.
            """
        )

        user_prompt = {
            'reportType': req.reportType,
            'dateRange': {
                'start': req.startDate.isoformat() if req.startDate else None,
                'end': req.endDate.isoformat() if req.endDate else None,
            },
            'patient': patient_info,
            'stats': stats,
            'assessmentsSample': assessments_preview,
            'workoutsSample': workouts_preview,
        }

        try:
            if content is None:
                model = genai.GenerativeModel(GEMINI_MODEL_NAME, system_instruction=system_instructions)
                # Send only a user message payload to avoid 'system role' errors
                result = model.generate_content(json.dumps(user_prompt, indent=2))
                content = getattr(result, 'text', None) or "No content generated."
        except Exception as e:
            # Graceful fallback instead of 500 so the UI can still download a text
            content = (
                "AI generation failed. Fallback summary based on available data.\n"
                f"Reason: {e}\n"
                f"Active Patients: {stats['activePatients']}\n"
                f"Average Progress: {stats['averageProgress']}%\n"
                f"Total Workouts: {stats['homeWorkouts']}\n"
            )

    # Return as PDF or text JSON depending on request
    wants_pdf = (req.format or "").lower() == "pdf" or "application/pdf" in (request.headers.get("accept", "").lower())
    if wants_pdf:
        # Clean up any markdown artifacts that might have slipped through
        clean_content = content or ""
        # Remove markdown code block markers
        clean_content = clean_content.replace('```markdown', '').replace('```', '')
        # Remove any extra blank lines (more than 2 consecutive)
        while '\n\n\n' in clean_content:
            clean_content = clean_content.replace('\n\n\n', '\n\n')
        
        title = f"{(patient_info or {}).get('name', 'Patient Report')} - {req.reportType.title()}"
        pdf_bytes = _build_pdf_bytes(title, clean_content)
        return StreamingResponse(iter([pdf_bytes]), media_type="application/pdf", headers={
            "Content-Disposition": f"attachment; filename=report_{req.reportType}_{(patient_info or {}).get('id','all')}.pdf"
        })

    return {"content": content or ""}


if __name__ == "__main__":
    import uvicorn
    # Run on port 3000 to match existing frontend fetch URLs
    uvicorn.run(app, host="0.0.0.0", port=3000)
