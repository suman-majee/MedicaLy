import os
import json
import requests
from dotenv import load_dotenv

load_dotenv()

API_KEY = os.getenv("OPENROUTER_API_KEY")
MODEL = "deepseek/deepseek-chat"


# Load symptom database using __file__-relative path
SYMPTOM_MAP_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "symptom_map.json")
with open(SYMPTOM_MAP_PATH, "r") as f:
    symptom_db = json.load(f)

EMERGENCY_KEYWORDS = [
    "chest pain", "can't breathe", "cannot breathe", "difficulty breathing",
    "unconscious", "stroke", "severe bleeding", "heart attack", "not breathing"
]

SPECIALITY_KEYWORDS = {
    "Cardiologist":       ["heart", "chest pain", "palpitation", "blood pressure", "cardiac"],
    "Dermatologist":      ["skin", "rash", "acne", "itching", "eczema", "hives"],
    "Neurologist":        ["headache", "migraine", "seizure", "numbness", "dizziness", "nerve"],
    "Gastroenterologist": ["stomach", "nausea", "vomiting", "diarrhea", "abdomen", "digestion", "bowel"],
    "Pulmonologist":      ["breathing", "cough", "asthma", "lungs", "shortness of breath", "wheezing"],
    "Orthopedist":        ["joint", "bone", "fracture", "back pain", "knee", "spine", "arthritis"],
    "ENT":                ["ear", "nose", "throat", "sinus", "hearing", "tonsil"],
    "Psychiatrist":       ["anxiety", "depression", "stress", "mental health", "panic", "insomnia"],
    "Urologist":          ["urination", "kidney", "bladder", "burning urine", "frequent urination"],
    "Ophthalmologist":    ["eye", "vision", "blurry", "glasses", "retina"],
    "Endocrinologist":    ["diabetes", "thyroid", "hormone", "blood sugar", "insulin"],
    "General Physician":  ["fever", "cold", "flu", "fatigue", "weakness", "general checkup"]
}

DIAGNOSTIC_TRIGGERS = [
    "recommend", "suggest", "see a", "consult", "specialist",
    "likely", "possible", "condition", "diagnosis", "symptoms indicate"
]


def match_symptom(user_input: str):
    for key in symptom_db:
        if key.lower() in user_input.lower():
            return symptom_db[key]
    return None


def extract_speciality(user_message: str) -> str | None:
    """Match against user's message ONLY — never against LLM reply."""

    speciality_keywords = {
        "Cardiologist":       ["heart", "chest pain", "palpitation", "blood pressure", "cardiac"],
        "Dermatologist":      ["skin", "rash", "acne", "itching", "eczema", "hives"],
        "Neurologist":        ["headache", "migraine", "seizure", "numbness", "dizziness"],


        "Gastroenterologist": ["stomach", "nausea", "vomiting", "diarrhea", "abdomen", "bloating"],
        "Pulmonologist":      ["breathing", "cough", "asthma", "lungs", "shortness of breath", "wheezing"],
        "Orthopedist":        ["joint pain", "bone", "fracture", "back pain", "knee", "spine", "arthritis"],
        "ENT":                ["ear", "nose", "throat", "sinus", "hearing", "tonsil"],
        "Psychiatrist":       ["anxiety", "depression", "stress", "mental health", "panic", "insomnia"],
        "Urologist":          ["urination", "kidney", "bladder", "burning urine"],
        "Ophthalmologist":    ["eye pain", "vision", "blurry", "eye infection"],
        "Endocrinologist":    ["diabetes", "thyroid", "hormone", "blood sugar", "weight gain"],
        "General Physician":  ["fever", "cold", "flu", "fatigue", "weakness", "tired", "body ache"],
    }

    msg_lower = user_message.lower()
    
    for spec, keywords in speciality_keywords.items():
        if any(kw in msg_lower for kw in keywords):
            return spec
    return None


def get_llm_response(messages, return_thoughts=False, patient_profile=None, doctors=None, available_specialities=None):
    """
    Call the LLM and return (reply, thoughts, suggested_doctors, speciality)
    when return_thoughts=True, else just reply.
    """
    if doctors is None:
        doctors = []
    if available_specialities is None:
        available_specialities = []

    headers = {
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "application/json"
    }

    try:
        # Build speciality instruction based on what's actually in DB
        if available_specialities:
            speciality_instruction = f"""When recommending a specialist, ONLY choose from this list of available doctors in our system:
{", ".join(available_specialities)}
Always pick the most relevant one from this list. Format it exactly as:
"I recommend you see a [speciality from the list above]."
Do not recommend a speciality that is not in the list above."""
        else:
            speciality_instruction = "When recommending a doctor, name the appropriate specialist type."

        # Build system prompt
        system_prompt = f"""You are MedicaLy, an empathetic AI medical assistant.
- Ask one follow-up question at a time to understand symptoms better.
- After 2-3 exchanges, suggest possible conditions with likelihood.
- {speciality_instruction}
- Never suggest a doctor on the very first message.
- If the patient says hi/hello, respond warmly and ask about their symptoms only.
- NEVER ask for information already in the patient's profile (age, gender, blood group, allergies, conditions, medications).
- When symptoms are described, acknowledge them empathetically before proceeding.
- After suggesting possible conditions, prefix the specialist line with "Recommended specialist:" followed by the exact name.
- If the patient mentions severe symptoms (chest pain, difficulty breathing, loss of consciousness), prioritize urgency.
- Speak in plain, simple language. Do not give dosage advice or prescribe medications.
"""

        if patient_profile and patient_profile.get("full_name"):
            first_name = patient_profile.get("full_name").split()[0]
            system_prompt += f"\n\n[Context: The patient's first name is {first_name}.]"

        if patient_profile and patient_profile.get("role") == "patient":
            dob = patient_profile.get("dob") or "Unknown"
            gender = patient_profile.get("gender") or "Unknown"
            blood = patient_profile.get("blood_group") or "Unknown"
            allergies = patient_profile.get("allergies") or "None"
            conditions = patient_profile.get("chronic_conditions") or "None"
            meds = patient_profile.get("medications") or "None"
            system_prompt += (
                f"\n\nPatient profile — Age: {dob}, Gender: {gender}, Blood group: {blood}, "
                f"Allergies: {allergies}, Chronic conditions: {conditions}, "
                f"Current medications: {meds}. Do not ask for this information again."
            )

        # Ensure system message is first
        if not messages or messages[0].get("role") != "system":
            messages = [{"role": "system", "content": system_prompt}] + list(messages)

        # Get latest user message only
        latest_user_msg = next(
            (m["content"] for m in reversed(messages) if m["role"] == "user"), ""
        )

        # Emergency triage — checked ONLY on latest user message


        if any(kw in latest_user_msg.lower() for kw in EMERGENCY_KEYWORDS):
            warning_msg = (
                "⚠️ This sounds like a medical emergency. "
                "Please call 112 or go to the nearest emergency room immediately. Do not wait."
            )

            if return_thoughts:
                return warning_msg, {}, [], None
            return warning_msg

        # Enrich with symptom DB context if available
        matched_conditions = match_symptom(latest_user_msg)
        if matched_conditions:
            context = "\n".join([
                f"- {e['condition']} ({e['likelihood']}): {e['description']}"
                for e in matched_conditions
            ])
            system_context = (
                f"You have access to a trusted medical knowledge base.\n"
                f"User symptoms: {latest_user_msg}\n\nPossible conditions:\n{context}\n"
                f"Use this information to guide your response."
            )
            if len(messages) > 1 and messages[1].get("role") == "system":
                messages[1]["content"] += f"\n\n{system_context}"
            else:
                messages.insert(1, {"role": "system", "content": system_context})

        payload = {
            "model": MODEL,
            "messages": messages,
            "temperature": 0.7
        }

        response = requests.post(
            "https://openrouter.ai/api/v1/chat/completions",
            headers=headers,
            json=payload
        )

        if response.status_code != 200:
            print(f"[LLM ERROR] HTTP {response.status_code}: {response.text}")
            err = "⚠️ Sorry, there was a problem communicating with the LLM."
            if return_thoughts:
                return err, {}, [], None
            return err

        data = response.json()

        if "choices" not in data or len(data["choices"]) == 0:
            print(f"[LLM ERROR] Unexpected response format: {data}")
            err = "⚠️ Sorry, I received an unexpected response from the LLM."
            if return_thoughts:
                return err, {}, [], None
            return err

        reply = data["choices"][0]["message"]["content"]

        # --- Doctor recommendation logic ---
        SPECIALITY_NAMES = [
            "Cardiologist", "Dermatologist", "Neurologist", "Gastroenterologist",
            "Pulmonologist", "Orthopedist", "ENT", "Psychiatrist", "Urologist",
            "Ophthalmologist", "Endocrinologist", "General Physician"
        ]
        DIAGNOSTIC_TRIGGERS = [
            "recommend", "suggest", "see a", "consult", "specialist",
            "likely", "possible", "condition", "diagnosis", "indicates",
            "you should visit", "you may want", "consider seeing"
        ]

        suggested_doctors = []
        speciality = None

        # Step 1 — PRIMARY: Check if LLM explicitly named a speciality in its reply
        for name in SPECIALITY_NAMES:
            if name.lower() in reply.lower():
                speciality = name
                break

        # Step 2 — SECONDARY: If LLM didn't name one, keyword-match user's message
        # Only if user has sent at least 2 messages (not on greeting)
        if not speciality:
            user_message_count = sum(1 for m in messages if m["role"] == "user")
            if user_message_count >= 2:
                speciality = extract_speciality(latest_user_msg)

        # Step 3 — Only surface doctors if we have a confident speciality
        # AND the reply contains diagnostic/recommendation language
        has_diagnostic_language = any(t in reply.lower() for t in DIAGNOSTIC_TRIGGERS)

        if speciality and has_diagnostic_language:
            # Case-insensitive match — "General physician" matches "General Physician"
            matched = [
                d for d in doctors
                if (d.get("speciality") or "").strip().lower() == speciality.strip().lower()
            ]

            # If exact match fails, try partial match
            if not matched:
                matched = [
                    d for d in doctors
                    if speciality.strip().lower() in (d.get("speciality") or "").strip().lower()
                    or (d.get("speciality") or "").strip().lower() in speciality.strip().lower()
                ]

            suggested_doctors = matched[:3]

            # If still no match — do NOT silently fall back to General Physician
            # Instead return the speciality name with empty doctors list
            # Frontend will show "no [speciality] available" message
            if not suggested_doctors:
                pass  # keep suggested_doctors = [] but keep speciality set
        else:
            speciality = None

        if return_thoughts:
            thoughts = data.get("usage", {})
            return reply, thoughts, suggested_doctors, speciality

        return reply

    except Exception as e:
        print(f"[LLM ERROR] {e}")
        err = "⚠️ Sorry, I couldn't process that. Please try again."
        if return_thoughts:
            return err, {}, [], None
        return err