import sqlite3
import os
import math
import bcrypt

DB_PATH = os.path.join(os.path.dirname(__file__), "medicaly.db")

def get_db_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # 1. Users table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            role TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            full_name TEXT NOT NULL,
            phone TEXT,
            
            -- Patient specifics
            dob TEXT,
            gender TEXT,
            blood_group TEXT,
            city TEXT,
            allergies TEXT,
            chronic_conditions TEXT,
            medications TEXT,
            emergency_contact_name TEXT,
            emergency_contact_phone TEXT,
            
            -- Doctor specifics
            speciality TEXT,
            licence_number TEXT,
            experience_years INTEGER,
            qualification TEXT,
            clinic_name TEXT,
            clinic_address TEXT,
            consultation_fee REAL,
            available_days TEXT,
            short_bio TEXT,
            clinic_latitude REAL,
            clinic_longitude REAL,
            
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')

    # 2. Chat Sessions
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS chat_sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            patient_id INTEGER NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(patient_id) REFERENCES users(id)
        )
    ''')

    # 3. Chat Messages
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS chat_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id INTEGER NOT NULL,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(session_id) REFERENCES chat_sessions(id)
        )
    ''')

    # 4. Doctor-Patient Private Chat
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS doctor_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            patient_id INTEGER NOT NULL,
            doctor_id INTEGER NOT NULL,
            sender_id INTEGER NOT NULL,
            message TEXT NOT NULL,
            timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            is_read BOOLEAN DEFAULT 0,
            FOREIGN KEY(patient_id) REFERENCES users(id),
            FOREIGN KEY(doctor_id) REFERENCES users(id),
            FOREIGN KEY(sender_id) REFERENCES users(id)
        )
    ''')

    # 5. Appointments
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS appointments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            patient_id INTEGER NOT NULL,
            doctor_id INTEGER NOT NULL,
            date TEXT NOT NULL,
            time TEXT NOT NULL,
            reason TEXT NOT NULL,
            status TEXT DEFAULT 'pending',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(patient_id) REFERENCES users(id),
            FOREIGN KEY(doctor_id) REFERENCES users(id)
        )
    ''')
    # Migration: ensure all required columns exist (safe for older DB files)
    existing_cols = {row[1] for row in cursor.execute("PRAGMA table_info(appointments)").fetchall()}
    if "status" not in existing_cols:
        cursor.execute("ALTER TABLE appointments ADD COLUMN status TEXT DEFAULT 'pending'")
    if "created_at" not in existing_cols:
        cursor.execute("ALTER TABLE appointments ADD COLUMN created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP")

    # 6. Prescriptions
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS prescriptions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            appointment_id INTEGER NOT NULL,
            doctor_id INTEGER NOT NULL,
            patient_id INTEGER NOT NULL,
            medicines TEXT NOT NULL,
            instructions TEXT NOT NULL,
            issued_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(appointment_id) REFERENCES appointments(id),
            FOREIGN KEY(doctor_id) REFERENCES users(id),
            FOREIGN KEY(patient_id) REFERENCES users(id)
        )
    ''')

    # 7. Reviews
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS reviews (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            patient_id INTEGER NOT NULL,
            doctor_id INTEGER NOT NULL,
            rating INTEGER NOT NULL,
            comment TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(patient_id) REFERENCES users(id),
            FOREIGN KEY(doctor_id) REFERENCES users(id)
        )
    ''')
    # 8. Cleanup self-chat rows
    cursor.execute("DELETE FROM doctor_messages WHERE patient_id = doctor_id")

    conn.commit()
    conn.close()
def hash_password(password: str) -> str:
    salt = bcrypt.gensalt()
    return bcrypt.hashpw(password.encode('utf-8'), salt).decode('utf-8')

def verify_password(plain_password: str, hashed_password: str) -> bool:
    return bcrypt.checkpw(plain_password.encode('utf-8'), hashed_password.encode('utf-8'))

def create_user(user_data: dict) -> dict:
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        hashed_pw = hash_password(user_data['password'])
        
        # Prepare fields dynamically
        fields = ["password"]
        values = [hashed_pw]
        
        for k, v in user_data.items():
            if k != "password" and v is not None:
                fields.append(k)
                values.append(v)
                
        placeholders = ", ".join(["?"] * len(fields))
        columns = ", ".join(fields)
        
        query = f"INSERT INTO users ({columns}) VALUES ({placeholders})"
        cursor.execute(query, tuple(values))
        conn.commit()
        
        user_id = cursor.lastrowid
        cursor.execute("SELECT id, role, email, full_name FROM users WHERE id = ?", (user_id,))
        return dict(cursor.fetchone())
    except sqlite3.IntegrityError:
        return None # Email exists
    finally:
        conn.close()

def authenticate_user(email, password):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM users WHERE email = ?", (email,))
    row = cursor.fetchone()
    conn.close()
    
    if row is None:
        return None
        
    if verify_password(password, row["password"]):
        user_dict = dict(row)
        del user_dict["password"]
        return user_dict
    return None

def get_user_by_email(email: str):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM users WHERE email = ?", (email,))
    row = cursor.fetchone()
    conn.close()
    if row:
        user_dict = dict(row)
        del user_dict["password"]
        return user_dict
    return None

def update_user_profile(email: str, update_data: dict):
    # Prevent changing email and licence_number
    update_data.pop("email", None)
    update_data.pop("licence_number", None)
    update_data.pop("password", None) # strictly handle password updates separately
    
    if not update_data:
        return get_user_by_email(email)
        
    conn = get_db_connection()
    cursor = conn.cursor()
    
    set_clauses = []
    values = []
    for k, v in update_data.items():
        set_clauses.append(f"{k} = ?")
        values.append(v)
        
    values.append(email)
    query = f"UPDATE users SET {', '.join(set_clauses)} WHERE email = ?"
    cursor.execute(query, tuple(values))
    conn.commit()
    conn.close()
    
    return get_user_by_email(email)

def haversine(lat1, lon1, lat2, lon2):
    R = 6371.0 # Earth radius in kilometers
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat / 2)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2)**2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return R * c

def get_nearby_doctors(lat: float, lon: float, max_distance_km: float = 50.0):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM users WHERE role = 'doctor' AND clinic_latitude IS NOT NULL AND clinic_longitude IS NOT NULL")
    doctors = cursor.fetchall()
    conn.close()
    
    nearby_docs = []
    for doc in doctors:
        d = dict(doc)
        distance = haversine(lat, lon, d['clinic_latitude'], d['clinic_longitude'])
        if distance <= max_distance_km:
            del d['password']
            d['distance_km'] = round(distance, 2)
            nearby_docs.append(d)
            
    # Sort by nearest
    nearby_docs.sort(key=lambda x: x['distance_km'])
    return nearby_docs
