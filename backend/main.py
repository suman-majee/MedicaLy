import os
from fastapi import FastAPI, HTTPException, Depends, Header, Request
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, validator
from typing import List, Dict, Optional, Any
import jwt
from datetime import datetime, timedelta

from llm.chat_handler import get_llm_response
from database import init_db, create_user, authenticate_user, update_user_profile, get_user_by_email, get_nearby_doctors, get_db_connection

app = FastAPI()

SECRET_KEY = "your-secret-key-for-jwt"
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 1440

# ==========================================
# DAY NORMALIZATION HELPERS
# ==========================================

_DAY_NORMALIZE_MAP = {
    "monday": "Mon", "mon": "Mon",
    "tuesday": "Tue", "tue": "Tue", "tues": "Tue",
    "wednesday": "Wed", "wed": "Wed",
    "thursday": "Thu", "thu": "Thu", "thur": "Thu", "thurs": "Thu",
    "friday": "Fri", "fri": "Fri",
    "saturday": "Sat", "sat": "Sat",
    "sunday": "Sun", "sun": "Sun",
}

WEEKDAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

def normalize_day(day: str) -> str:
    """Normalize any day name variant to 3-letter standard form."""
    return _DAY_NORMALIZE_MAP.get(day.strip().lower(), day.strip().capitalize()[:3])


@app.on_event("startup")
def on_startup():
    init_db()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    return JSONResponse(
        status_code=exc.status_code,
        content={"success": False, "message": exc.detail, "data": None}
    )

@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    return JSONResponse(
        status_code=422,
        content={"success": False, "message": "Invalid input data provided", "data": exc.errors()}
    )

def create_access_token(data: dict):
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)

def get_current_user(authorization: str = Header(None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Invalid authorization header")
    token = authorization.split(" ")[1]
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        email: str = payload.get("sub")
        if email is None:
            raise HTTPException(status_code=401, detail="Invalid token payload")
        user = get_user_by_email(email)
        if user is None:
            raise HTTPException(status_code=401, detail="User not found")
        return user
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Could not validate credentials")


# ==========================================
# AUTH ENDPOINTS
# ==========================================

class SignupRequest(BaseModel):
    role: str
    email: str
    password: str
    full_name: str
    phone: Optional[str] = None
    dob: Optional[str] = None
    gender: Optional[str] = None
    blood_group: Optional[str] = None
    city: Optional[str] = None
    allergies: Optional[str] = None
    chronic_conditions: Optional[str] = None
    medications: Optional[str] = None
    emergency_contact_name: Optional[str] = None
    emergency_contact_phone: Optional[str] = None
    speciality: Optional[str] = None
    licence_number: Optional[str] = None
    experience_years: Optional[int] = None
    qualification: Optional[str] = None
    clinic_name: Optional[str] = None
    clinic_address: Optional[str] = None
    consultation_fee: Optional[float] = None
    available_days: Optional[str] = None
    short_bio: Optional[str] = None
    clinic_latitude: Optional[float] = None
    clinic_longitude: Optional[float] = None

@app.post("/auth/register")
@app.post("/api/signup")
async def signup_endpoint(req: SignupRequest):
    if not req.phone:
        raise HTTPException(status_code=400, detail="Phone number is required")
    if req.role == "patient":
        if not req.dob or not req.gender:
            raise HTTPException(status_code=400, detail="Missing required patient fields (dob, gender)")
    elif req.role == "doctor":
        required_doctor_fields = [req.speciality, req.licence_number, req.experience_years, req.qualification]
        if not all(field is not None for field in required_doctor_fields):
            raise HTTPException(status_code=400, detail="Missing required doctor fields")
    else:
        raise HTTPException(status_code=400, detail="Invalid role")

    user_dict = req.dict(exclude_none=True)
    user = create_user(user_dict)
    if not user:
        raise HTTPException(status_code=400, detail="User already exists")
    
    access_token = create_access_token(data={"sub": user["email"]})
    return {"success": True, "message": "Signup successful", "data": {"access_token": access_token, "token_type": "bearer", "user": user}}

class LoginRequest(BaseModel):
    email: str
    password: str
    role: Optional[str] = None

@app.post("/auth/login")
@app.post("/api/login")
async def login_endpoint(req: LoginRequest):
    user = authenticate_user(req.email, req.password)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    if req.role and user.get("role") != req.role:
        raise HTTPException(status_code=401, detail="Role mismatch")

    access_token = create_access_token(data={"sub": user["email"]})
    return {"success": True, "message": "Login successful", "data": {"access_token": access_token, "token_type": "bearer", "user": user}}

@app.get("/auth/me")
async def get_me(user: dict = Depends(get_current_user)):
    return {"success": True, "message": "User fetched successfully", "data": user}

@app.patch("/auth/profile")
async def update_profile(updates: Dict[str, Any], user: dict = Depends(get_current_user)):
    updated_user = update_user_profile(user["email"], updates)
    return {"success": True, "message": "Profile updated successfully", "data": {"user": updated_user}}

# ==========================================
# AI CHAT ENDPOINTS
# ==========================================

class ChatRequest(BaseModel):
    messages: List[Dict[str, str]]
    session_id: Optional[int] = None

    class Config:
        extra = "ignore"  # silently ignore unexpected fields from frontend

    @validator("messages")
    def validate_messages(cls, messages):
        # Filter out any malformed messages silently instead of rejecting entire request
        valid = [
            m for m in messages
            if isinstance(m, dict)
            and "role" in m and "content" in m
            and m["role"] in ("user", "assistant", "system")
            and isinstance(m["content"], str)
        ]
        if not valid:
            raise ValueError("No valid messages found")
        return valid

def extract_speciality(llm_response: str) -> str | None:
    """Kept for backward compat — main logic now lives in chat_handler.py"""
    return None

@app.post("/api/chat")
async def chat_endpoint(request: ChatRequest, authorization: str = Header(None)):
    user_context = None
    if authorization:
        try:
            user_context = get_current_user(authorization)
        except HTTPException:
            pass

    conn = get_db_connection()
    cursor = conn.cursor()

    # Load all doctors once to pass into the LLM handler
    all_doctors = cursor.execute(
        "SELECT id, full_name, speciality, clinic_address, consultation_fee, "
        "clinic_latitude, clinic_longitude FROM users WHERE role='doctor'"
    ).fetchall()
    doctors_list = [dict(d) for d in all_doctors]

    # Extract unique specialities that actually exist in DB
    available_specialities = list(set(
        d["speciality"] for d in doctors_list
        if d.get("speciality")
    ))

    reply, thoughts, suggested_doctors, speciality = get_llm_response(
        request.messages,
        return_thoughts=True,
        patient_profile=user_context,
        doctors=doctors_list,
        available_specialities=available_specialities
    )

    session_id = request.session_id
    if user_context and user_context.get("role") == "patient":
        if not session_id:
            cursor.execute("INSERT INTO chat_sessions (patient_id) VALUES (?)", (user_context["id"],))
            session_id = cursor.lastrowid

        last_user_msg = next((m["content"] for m in reversed(request.messages) if m["role"] == "user"), "")
        if last_user_msg:
            cursor.execute("INSERT INTO chat_messages (session_id, role, content) VALUES (?, ?, ?)",
                           (session_id, "user", last_user_msg))

        if reply:
            cursor.execute("INSERT INTO chat_messages (session_id, role, content) VALUES (?, ?, ?)",
                           (session_id, "assistant", reply))

        conn.commit()
    conn.close()

    return {
        "success": True,
        "message": "Chat response generated",
        "data": {
            "response": reply,
            "thoughts": thoughts,
            "session_id": session_id,
            "recommended_speciality": speciality,
            "suggested_doctors": suggested_doctors
        }
    }

@app.get("/api/chat/history")
async def get_chat_history(user: dict = Depends(get_current_user)):
    if user.get("role") != "patient":
        raise HTTPException(status_code=403, detail="Only patients have chat history")
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT s.id, s.created_at, 
            (SELECT content FROM chat_messages WHERE session_id = s.id AND role = 'user' ORDER BY timestamp ASC LIMIT 1) as preview
        FROM chat_sessions s
        WHERE s.patient_id = ?
        ORDER BY s.created_at DESC
    """, (user["id"],))
    sessions = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return {"success": True, "message": "History fetched", "data": {"sessions": sessions}}

@app.get("/api/chat/history/{session_id}")
async def get_chat_session(session_id: int, user: dict = Depends(get_current_user)):
    if user.get("role") != "patient":
        raise HTTPException(status_code=403, detail="Only patients have chat history")
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM chat_sessions WHERE id = ? AND patient_id = ?", (session_id, user["id"]))
    session = cursor.fetchone()
    if not session:
        conn.close()
        raise HTTPException(status_code=404, detail="Session not found")
        
    cursor.execute("SELECT role, content, timestamp FROM chat_messages WHERE session_id = ? ORDER BY timestamp ASC", (session_id,))
    messages = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return {"success": True, "message": "Messages fetched", "data": {"messages": messages}}

# ==========================================
# APPOINTMENTS ENDPOINTS
# ==========================================

@app.get("/appointments/doctors")
async def get_all_doctors(authorization: str = Header(None)):
    current_user_id = -1
    if authorization:
        try:
            user_context = get_current_user(authorization)
            current_user_id = user_context["id"]
        except Exception:
            pass
            
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id, full_name, email, speciality, qualification, experience_years, clinic_name, clinic_address, consultation_fee, available_days, short_bio, clinic_latitude, clinic_longitude FROM users WHERE role = 'doctor' AND id != ?", (current_user_id,))
    doctors = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return {"success": True, "message": "Doctors fetched", "data": {"doctors": doctors}}

@app.get("/appointments/doctors/nearby")
async def get_nearby_doctors_endpoint(lat: float, lon: float, max_distance: float = 50.0, authorization: str = Header(None)):
    current_user_id = -1
    if authorization:
        try:
            user_context = get_current_user(authorization)
            current_user_id = user_context["id"]
        except Exception:
            pass
            
    doctors = get_nearby_doctors(lat, lon, max_distance)
    doctors = [d for d in doctors if d["id"] != current_user_id]
    return {"success": True, "message": "Doctors fetched successfully", "data": {"doctors": doctors}}


class BookAppointmentRequest(BaseModel):
    doctor_id: int
    date: str
    time: str
    reason: str

    class Config:
        extra = "ignore"  # Silently ignore unexpected fields (e.g. patient_id from old frontend)


@app.post("/appointments/book")
async def book_appointment(req: BookAppointmentRequest, user: dict = Depends(get_current_user)):
    try:
        if user.get("role") != "patient":
            raise HTTPException(status_code=403, detail="Only patients can book appointments")

        conn = get_db_connection()
        cursor = conn.cursor()

        # Validate that the submitted day matches the doctor's available days
        cursor.execute("SELECT available_days FROM users WHERE id = ? AND role = 'doctor'", (req.doctor_id,))
        doc_row = cursor.fetchone()
        if doc_row and doc_row["available_days"]:
            raw_days = doc_row["available_days"]
            allowed_normalized = [normalize_day(d.strip()) for d in raw_days.split(",") if d.strip()]
            try:
                submitted_weekday = WEEKDAY_NAMES[datetime.strptime(req.date, "%Y-%m-%d").weekday()]
            except ValueError:
                conn.close()
                raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD")

            if submitted_weekday not in allowed_normalized:
                conn.close()
                raise HTTPException(
                    status_code=400,
                    detail=f"Doctor not available on {submitted_weekday}. Available days: {', '.join(allowed_normalized)}"
                )

        # patient_id is always taken from the JWT token — never from request body
        cursor.execute(
            "INSERT INTO appointments (patient_id, doctor_id, date, time, reason) VALUES (?, ?, ?, ?, ?)",
            (user["id"], req.doctor_id, req.date, req.time, req.reason)
        )
        conn.commit()
        conn.close()
        return {"success": True, "message": "Appointment booked successfully", "data": None}

    except HTTPException:
        raise
    except Exception as e:
        print(f"[BOOKING ERROR] {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/appointments/slots")
async def get_booked_slots(doctor_id: int, date: str):
    """Return list of already-booked time strings for a doctor on a given date. No auth required."""
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT time FROM appointments WHERE doctor_id = ? AND date = ? AND status != 'cancelled'",
            (doctor_id, date)
        )
        booked = [row["time"] for row in cursor.fetchall()]
        conn.close()
        return {"success": True, "message": "Slots fetched", "data": {"booked_slots": booked}}
    except Exception as e:
        print(f"[SLOTS ERROR] {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/appointments/my")
async def get_my_appointments(user: dict = Depends(get_current_user)):
    conn = get_db_connection()
    cursor = conn.cursor()
    if user.get("role") == "patient":
        cursor.execute("""
            SELECT a.id, a.patient_id, a.doctor_id, a.date, a.time, a.reason, a.status, a.created_at,
                   u.full_name as doctor_name, u.speciality, u.clinic_name, u.clinic_address,
                   u.phone as doctor_phone
            FROM appointments a
            JOIN users u ON a.doctor_id = u.id
            WHERE a.patient_id = ? ORDER BY a.date DESC, a.time DESC
        """, (user["id"],))
    else:
        cursor.execute("""
            SELECT a.id, a.patient_id, a.doctor_id, a.date, a.time, a.reason, a.status, a.created_at,
                   u.full_name as patient_name, u.phone as patient_phone,
                   u.blood_group, u.allergies, u.dob, u.gender
            FROM appointments a
            JOIN users u ON a.patient_id = u.id
            WHERE a.doctor_id = ? ORDER BY a.date DESC, a.time DESC
        """, (user["id"],))
    appointments = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return {"success": True, "message": "Appointments fetched", "data": {"appointments": appointments}}


@app.get("/appointments/doctor-stats")
async def get_doctor_stats(user: dict = Depends(get_current_user)):
    """Return summary stats for a doctor: total unique patients, pending count, avg rating."""
    if user.get("role") != "doctor":
        raise HTTPException(status_code=403, detail="Only doctors can access stats")
    conn = get_db_connection()
    cursor = conn.cursor()

    cursor.execute(
        "SELECT COUNT(DISTINCT patient_id) as total_patients FROM appointments WHERE doctor_id = ?",
        (user["id"],)
    )
    total_patients = cursor.fetchone()["total_patients"] or 0

    cursor.execute(
        "SELECT COUNT(*) as pending_count FROM appointments WHERE doctor_id = ? AND status = 'pending'",
        (user["id"],)
    )
    pending_count = cursor.fetchone()["pending_count"] or 0

    cursor.execute(
        "SELECT AVG(rating) as avg_rating FROM reviews WHERE doctor_id = ?",
        (user["id"],)
    )
    avg_row = cursor.fetchone()
    avg_rating = round(avg_row["avg_rating"], 1) if avg_row["avg_rating"] else 0.0

    conn.close()
    return {
        "success": True,
        "message": "Stats fetched",
        "data": {
            "total_patients": total_patients,
            "pending_count": pending_count,
            "avg_rating": avg_rating
        }
    }


class UpdateAppointmentStatusRequest(BaseModel):
    status: str

@app.patch("/appointments/{id}/status")
async def update_appointment_status(id: int, req: UpdateAppointmentStatusRequest, user: dict = Depends(get_current_user)):
    conn = get_db_connection()
    cursor = conn.cursor()

    if user.get("role") == "doctor":
        if req.status not in ("confirmed", "cancelled"):
            conn.close()
            raise HTTPException(status_code=400, detail="Doctors can only set status to confirmed or cancelled")

        # Fetch appointment details for system message
        cursor.execute(
            "SELECT a.date, a.time, a.patient_id, u.full_name as doctor_name "
            "FROM appointments a JOIN users u ON u.id = a.doctor_id "
            "WHERE a.id = ? AND a.doctor_id = ?",
            (id, user["id"])
        )
        appt = cursor.fetchone()
        if not appt:
            conn.close()
            raise HTTPException(status_code=404, detail="Appointment not found")

        cursor.execute(
            "UPDATE appointments SET status = ? WHERE id = ? AND doctor_id = ?",
            (req.status, id, user["id"])
        )

        # Suggestion 4: Insert system notification into doctor_messages
        if appt:
            if req.status == "confirmed":
                msg_text = f"Dr. {appt['doctor_name']} has confirmed your appointment on {appt['date']} at {appt['time']}."
            else:
                msg_text = f"Dr. {appt['doctor_name']} has cancelled your appointment on {appt['date']} at {appt['time']}. Please rebook."
            try:
                cursor.execute(
                    "INSERT INTO doctor_messages (patient_id, doctor_id, sender_id, message, timestamp, is_read) "
                    "VALUES (?, ?, ?, ?, ?, 0)",
                    (appt["patient_id"], user["id"], user["id"], msg_text, datetime.now().isoformat())
                )
            except Exception as msg_err:
                print(f"[SYSTEM MSG ERROR] {str(msg_err)}")

    elif user.get("role") == "patient":
        # Patients can only cancel their own pending appointments
        if req.status != "cancelled":
            conn.close()
            raise HTTPException(status_code=403, detail="Patients can only cancel appointments")
        cursor.execute(
            "UPDATE appointments SET status = 'cancelled' WHERE id = ? AND patient_id = ? AND status = 'pending'",
            (id, user["id"])
        )
    else:
        conn.close()
        raise HTTPException(status_code=403, detail="Unauthorized")

    conn.commit()
    conn.close()
    return {"success": True, "message": "Appointment status updated", "data": None}


@app.get("/appointments/patients")
async def get_doctor_patients(user: dict = Depends(get_current_user)):
    if user.get("role") != "doctor":
        raise HTTPException(status_code=403, detail="Only doctors can view their patients")
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT DISTINCT u.id, u.full_name, u.email, u.phone, u.dob, u.gender, u.blood_group, u.allergies, u.chronic_conditions, u.medications 
        FROM appointments a 
        JOIN users u ON a.patient_id = u.id 
        WHERE a.doctor_id = ?
    """, (user["id"],))
    patients = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return {"success": True, "message": "Patients fetched", "data": {"patients": patients}}

@app.get("/appointments/patients/{patient_id}/history")
async def get_patient_chat_history_for_doctor(patient_id: int, user: dict = Depends(get_current_user)):
    if user.get("role") != "doctor":
        raise HTTPException(status_code=403, detail="Only doctors can access this")
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id FROM appointments WHERE doctor_id = ? AND patient_id = ?", (user["id"], patient_id))
    if not cursor.fetchone():
        conn.close()
        raise HTTPException(status_code=403, detail="No appointment history with this patient")
    
    cursor.execute("""
        SELECT s.id as session_id, s.created_at, m.role, m.content, m.timestamp
        FROM chat_sessions s
        JOIN chat_messages m ON s.id = m.session_id
        WHERE s.patient_id = ?
        ORDER BY s.created_at DESC, m.timestamp ASC
    """, (patient_id,))
    
    rows = cursor.fetchall()
    conn.close()
    
    # Group by session
    history = {}
    for row in rows:
        sid = row["session_id"]
        if sid not in history:
            history[sid] = {"session_id": sid, "created_at": row["created_at"], "messages": []}
        history[sid]["messages"].append({"role": row["role"], "content": row["content"], "timestamp": row["timestamp"]})
        
    return {"success": True, "message": "History fetched", "data": {"sessions": list(history.values())}}

# ==========================================
# DOCTOR-PATIENT PRIVATE CHAT ENDPOINTS
# ==========================================

from datetime import datetime

class SendMessageRequest(BaseModel):
    recipient_id: int
    message: str
    sent_at: Optional[str] = None  # ISO string from client

@app.post("/doctor-chat/send")
async def send_private_message(req: SendMessageRequest, user: dict = Depends(get_current_user)):
    if req.recipient_id == user["id"]:
        raise HTTPException(status_code=400, detail="You cannot send a message to yourself")
        
    print(f"DEBUG /doctor-chat/send -> sender_id: {user['id']} ({user['role']}), recipient_id: {req.recipient_id}")
    conn = get_db_connection()
    cursor = conn.cursor()
    
    if user["role"] == "patient":
        patient_id = user["id"]
        doctor_id = req.recipient_id
    else:
        doctor_id = user["id"]
        patient_id = req.recipient_id
        
    print(f"DEBUG -> Resolved to patient_id: {patient_id}, doctor_id: {doctor_id}")
    
    timestamp = req.sent_at if req.sent_at else datetime.now().isoformat()
    cursor.execute("""
        INSERT INTO doctor_messages (patient_id, doctor_id, sender_id, message, timestamp, is_read)
        VALUES (?, ?, ?, ?, ?, 0)
    """, (patient_id, doctor_id, user["id"], req.message, timestamp))
    
    conn.commit()
    conn.close()
    return {"success": True, "message": "Message sent", "data": None}

@app.get("/doctor-chat/history/{other_user_id}")
async def get_private_messages(other_user_id: int, user: dict = Depends(get_current_user)):
    print(f"DEBUG /doctor-chat/history -> fetching for me: {user['id']} and other: {other_user_id}")
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # User's explicit bidirectional logic
    me = user["id"]
    other = other_user_id
    
    # Mark incoming messages as read
    cursor.execute("""
        UPDATE doctor_messages 
        SET is_read = 1 
        WHERE sender_id = ? AND 
        ((patient_id = ? AND doctor_id = ?) OR (patient_id = ? AND doctor_id = ?))
    """, (other, me, other, other, me))
    conn.commit()
    
    cursor.execute("""
        SELECT id, sender_id, message, timestamp, is_read
        FROM doctor_messages
        WHERE (patient_id = ? AND doctor_id = ?) OR (patient_id = ? AND doctor_id = ?)
        ORDER BY timestamp ASC
    """, (me, other, other, me))
    
    messages = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return {"success": True, "message": "Messages fetched", "data": {"messages": messages}}

@app.get("/doctor-chat/contacts")
async def get_chat_contacts(user: dict = Depends(get_current_user)):
    print(f"DEBUG /doctor-chat/contacts -> fetching for: {user['id']}")
    conn = get_db_connection()
    cursor = conn.cursor()
    
    me = user["id"]
    
    # User's explicit bidirectional logic grouped by the other person
    query = """
        SELECT u.id as contact_id, u.full_name as contact_name, u.role as role, u.speciality,
               m.message as last_message, m.timestamp as last_message_time,
               (SELECT COUNT(*) FROM doctor_messages WHERE sender_id = u.id AND is_read = 0 AND 
                ((patient_id = u.id AND doctor_id = ?) OR (patient_id = ? AND doctor_id = u.id))) as unread_count
        FROM users u
        JOIN doctor_messages m ON 
             (u.id = m.doctor_id AND m.patient_id = ?) OR 
             (u.id = m.patient_id AND m.doctor_id = ?)
        WHERE m.id IN (
            SELECT MAX(id) FROM doctor_messages 
            WHERE (patient_id = ? OR doctor_id = ?) AND patient_id != doctor_id
            GROUP BY CASE WHEN patient_id = ? THEN doctor_id ELSE patient_id END
        )
        ORDER BY m.timestamp DESC
    """
    cursor.execute(query, (me, me, me, me, me, me, me))
        
    contacts = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return {"success": True, "message": "Contacts fetched", "data": {"contacts": contacts}}

@app.get("/doctor-chat/unread-count")
async def get_unread_count(user: dict = Depends(get_current_user)):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT COUNT(*) as count 
        FROM doctor_messages 
        WHERE sender_id != ? AND is_read = 0 AND 
        ((patient_id = ? AND doctor_id IN (SELECT id FROM users)) OR (doctor_id = ? AND patient_id IN (SELECT id FROM users)))
    """, (user["id"], user["id"], user["id"]))
    count = cursor.fetchone()["count"]
    conn.close()
    return {"success": True, "message": "Unread count fetched", "data": {"count": count}}

# ==========================================
# PRESCRIPTIONS ENDPOINTS
# ==========================================

class PrescriptionRequest(BaseModel):
    appointment_id: int
    patient_id: int
    medicines: str
    instructions: str

@app.post("/prescriptions")
async def create_prescription(req: PrescriptionRequest, user: dict = Depends(get_current_user)):
    if user.get("role") != "doctor":
        raise HTTPException(status_code=403, detail="Only doctors can create prescriptions")
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        INSERT INTO prescriptions (appointment_id, doctor_id, patient_id, medicines, instructions)
        VALUES (?, ?, ?, ?, ?)
    """, (req.appointment_id, user["id"], req.patient_id, req.medicines, req.instructions))
    conn.commit()
    conn.close()
    return {"success": True, "message": "Prescription saved", "data": None}

@app.get("/prescriptions/my")
async def get_my_prescriptions(user: dict = Depends(get_current_user)):
    if user.get("role") != "patient":
        raise HTTPException(status_code=403, detail="Only patients can fetch their prescriptions this way")
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT p.*, u.full_name as doctor_name 
        FROM prescriptions p
        JOIN users u ON p.doctor_id = u.id
        WHERE p.patient_id = ?
        ORDER BY p.issued_at DESC
    """, (user["id"],))
    prescriptions = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return {"success": True, "message": "Prescriptions fetched", "data": {"prescriptions": prescriptions}}

@app.get("/prescriptions/patient/{patient_id}")
async def get_patient_prescriptions(patient_id: int, user: dict = Depends(get_current_user)):
    if user.get("role") != "doctor":
        raise HTTPException(status_code=403, detail="Only doctors can use this endpoint")
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT * FROM prescriptions
        WHERE patient_id = ? AND doctor_id = ?
        ORDER BY issued_at DESC
    """, (patient_id, user["id"]))
    prescriptions = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return {"success": True, "message": "Prescriptions fetched", "data": {"prescriptions": prescriptions}}

# ==========================================
# REVIEWS ENDPOINTS
# ==========================================

class ReviewRequest(BaseModel):
    doctor_id: int
    rating: int
    comment: Optional[str] = None

@app.post("/reviews")
async def submit_review(req: ReviewRequest, user: dict = Depends(get_current_user)):
    if user.get("role") != "patient":
        raise HTTPException(status_code=403, detail="Only patients can submit reviews")
    if req.rating < 1 or req.rating > 5:
        raise HTTPException(status_code=400, detail="Rating must be between 1 and 5")
        
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # Check for existing review
    cursor.execute("SELECT id FROM reviews WHERE patient_id = ? AND doctor_id = ?", (user["id"], req.doctor_id))
    existing = cursor.fetchone()
    
    if existing:
        cursor.execute("UPDATE reviews SET rating = ?, comment = ? WHERE id = ?", (req.rating, req.comment, existing["id"]))
    else:
        cursor.execute("INSERT INTO reviews (patient_id, doctor_id, rating, comment) VALUES (?, ?, ?, ?)",
                       (user["id"], req.doctor_id, req.rating, req.comment))
                       
    conn.commit()
    conn.close()
    return {"success": True, "message": "Review submitted successfully", "data": None}

@app.get("/reviews/doctor/{doctor_id}")
async def get_doctor_reviews(doctor_id: int):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT r.*, u.full_name as patient_name 
        FROM reviews r
        JOIN users u ON r.patient_id = u.id
        WHERE r.doctor_id = ?
        ORDER BY r.created_at DESC
    """, (doctor_id,))
    reviews = [dict(row) for row in cursor.fetchall()]
    
    cursor.execute("SELECT AVG(rating) as avg_rating FROM reviews WHERE doctor_id = ?", (doctor_id,))
    avg_row = cursor.fetchone()
    avg_rating = round(avg_row["avg_rating"], 1) if avg_row["avg_rating"] else 0
    
    conn.close()
    return {"success": True, "message": "Reviews fetched", "data": {"reviews": reviews, "avg_rating": avg_rating}}


# ==========================================
# MOUNT STATIC FRONTEND
# ==========================================
# Mount the frontend directory directly so FastAPI serves HTML, CSS, JS
frontend_path = os.path.join(os.path.dirname(__file__), "..", "frontend")
app.mount("/", StaticFiles(directory=frontend_path, html=True), name="static")
