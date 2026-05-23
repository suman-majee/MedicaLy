// profile.js — MedicaLy Profile Page Logic
// Handles: avatar, sidebar, stats, reminder, appointments, form save, map, day toggles

const token = sessionStorage.getItem("access_token");
let profileMap, profileMarker;
let currentUserRole = null;
let currentUserId = null;

if (!token) {
    window.location.href = "login.html";
}

// =============================================
// MAP LOGIC
// =============================================
function initMap(lat, lng) {
    if (profileMap) return;
    profileMap = L.map('profile-map').setView([lat || 20.5937, lng || 78.9629], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors'
    }).addTo(profileMap);
    profileMarker = L.marker([lat || 20.5937, lng || 78.9629], { draggable: true }).addTo(profileMap);
    profileMarker.on('dragend', function() {
        const pos = profileMarker.getLatLng();
        document.getElementById('lat').value = pos.lat.toFixed(6);
        document.getElementById('lng').value = pos.lng.toFixed(6);
    });
}

function updateMarker(lat, lng) {
    const pos = [lat, lng];
    profileMarker.setLatLng(pos);
    profileMap.setView(pos, 15);
    document.getElementById('lat').value = lat.toFixed(6);
    document.getElementById('lng').value = lng.toFixed(6);
}

async function detectMyLocation() {
    if (!navigator.geolocation) return alert("Geolocation not supported.");
    navigator.geolocation.getCurrentPosition((pos) => {
        updateMarker(pos.coords.latitude, pos.coords.longitude);
    });
}
window.detectMyLocation = detectMyLocation;

async function geocodeAddress() {
    const address = document.getElementById('p-clinic-address').value;
    if (!address) return alert("Enter an address first.");
    try {
        const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}`);
        const data = await res.json();
        if (data.length > 0) updateMarker(parseFloat(data[0].lat), parseFloat(data[0].lon));
        else alert("Address not found. Try a more specific address.");
    } catch (e) { console.error("Geocode error:", e); }
}
window.geocodeAddress = geocodeAddress;

let geocodeTimeout;
document.getElementById('p-clinic-address')?.addEventListener("input", () => {
    clearTimeout(geocodeTimeout);
    geocodeTimeout = setTimeout(geocodeAddress, 1200);
});

// =============================================
// AVAILABLE DAYS TOGGLE BUTTONS
// =============================================
const DAY_NORMALIZE_MAP = {
    "monday": "Mon", "mon": "Mon",
    "tuesday": "Tue", "tue": "Tue", "tues": "Tue",
    "wednesday": "Wed", "wed": "Wed",
    "thursday": "Thu", "thu": "Thu", "thur": "Thu", "thurs": "Thu",
    "friday": "Fri", "fri": "Fri",
    "saturday": "Sat", "sat": "Sat",
    "sunday": "Sun", "sun": "Sun",
};

function normalizeDay(d) {
    return DAY_NORMALIZE_MAP[d.trim().toLowerCase()] || d.trim();
}

function initDayToggles(savedDays) {
    const toggles = document.querySelectorAll(".day-toggle");
    const normalized = (savedDays || "").split(",").map(d => normalizeDay(d.trim())).filter(Boolean);

    toggles.forEach(btn => {
        const day = btn.dataset.day;
        if (normalized.includes(day)) btn.classList.add("active");
        btn.addEventListener("click", () => {
            btn.classList.toggle("active");
            saveDayToggleState();
        });
    });
    saveDayToggleState();
}

function saveDayToggleState() {
    const active = [...document.querySelectorAll(".day-toggle.active")].map(b => b.dataset.day);
    document.getElementById("p-days").value = active.join(",");
}

// =============================================
// SIDEBAR — Avatar + Pills
// =============================================
function generateInitials(name) {
    if (!name) return "?";
    return name.trim().split(/\s+/).map(n => n[0] || "").join("").toUpperCase().slice(0, 2);
}

function updateSidebar(user) {
    // Avatar
    const avatar = document.getElementById("sidebar-avatar");
    avatar.textContent = generateInitials(user.full_name);
    avatar.className = "avatar-circle " + (user.role === "doctor" ? "doctor" : "patient");

    // Name, email, role badge
    document.getElementById("sidebar-name").textContent = user.full_name || "";
    document.getElementById("sidebar-email").textContent = user.email || "";
    const badge = document.getElementById("sidebar-role-badge");
    badge.textContent = user.role === "doctor" ? "Doctor" : "Patient";
    badge.className = "role-badge " + (user.role === "doctor" ? "doctor" : "patient");

    // Pills
    const pillsEl = document.getElementById("sidebar-pills");
    pillsEl.innerHTML = "";
    if (user.role === "patient") {
        if (user.blood_group) pillsEl.innerHTML += `<span class="pill">🩸 ${user.blood_group}</span>`;
        if (user.city) pillsEl.innerHTML += `<span class="pill">📍 ${user.city}</span>`;
        if (user.gender) pillsEl.innerHTML += `<span class="pill">${user.gender}</span>`;
    } else {
        if (user.speciality) pillsEl.innerHTML += `<span class="pill">🩺 ${user.speciality}</span>`;
        if (user.experience_years) pillsEl.innerHTML += `<span class="pill">${user.experience_years} yrs exp</span>`;
        if (user.qualification) pillsEl.innerHTML += `<span class="pill">${user.qualification}</span>`;
    }
}

// =============================================
// DOCTOR STATS (Suggestion 2)
// =============================================
async function loadDoctorStats() {
    try {
        const res = await fetch("/appointments/doctor-stats", {
            headers: { "Authorization": `Bearer ${token}` }
        });
        const data = await res.json();
        if (data.success) {
            document.getElementById("stat-patients").textContent = data.data.total_patients;
            document.getElementById("stat-pending").textContent = data.data.pending_count;
            document.getElementById("stat-rating").textContent = data.data.avg_rating > 0
                ? `${data.data.avg_rating}⭐`
                : "N/A";
            document.getElementById("doctor-stats-card").style.display = "block";
        }
    } catch(e) {
        console.error("Stats error:", e);
    }
}

// =============================================
// REMINDER BANNER (Suggestion 3)
// =============================================
function checkUpcomingReminder(appointments) {
    if (!appointments || appointments.length === 0) return;
    const now = new Date();
    const cutoff = new Date(now.getTime() + 48 * 60 * 60 * 1000);

    for (const appt of appointments) {
        if (appt.status !== "confirmed") continue;
        try {
            const [y, m, d] = appt.date.split("-").map(Number);
            const [h, min] = (appt.time || "00:00").split(":").map(Number);
            const apptDate = new Date(y, m - 1, d, h, min);
            if (apptDate > now && apptDate <= cutoff) {
                const isToday = apptDate.toDateString() === now.toDateString();
                const dayWord = isToday ? "today" : "tomorrow";
                const bannerEl = document.getElementById("reminder-banner");
                bannerEl.style.display = "block";
                bannerEl.innerHTML = `
                    <div class="reminder-banner">
                        <span class="icon">⏰</span>
                        <span>
                            <strong>Reminder:</strong> You have a confirmed appointment with
                            <strong>Dr. ${appt.doctor_name}</strong>
                            ${dayWord} at <strong>${appt.time}</strong>.
                        </span>
                    </div>`;
                break;
            }
        } catch(e) { /* skip malformed */ }
    }
}

// =============================================
// LOAD PROFILE
// =============================================
async function loadProfile() {
    try {
        const res = await fetch("/auth/me", {
            headers: { "Authorization": `Bearer ${token}` }
        });
        const jsonResp = await res.json();
        if (!res.ok || !jsonResp.success) throw new Error(jsonResp.message || "Session expired");

        const user = jsonResp.data;
        currentUserRole = user.role;
        currentUserId = user.id;

        // Populate form fields
        document.getElementById("p-name").value = user.full_name || "";
        document.getElementById("p-email").value = user.email || "";
        document.getElementById("p-phone").value = user.phone || "";
        document.getElementById("p-role").value = user.role === "doctor" ? "Doctor" : "Patient";

        // Update sidebar
        updateSidebar(user);

        if (user.role === "patient") {
            document.getElementById("p-patient-section").style.display = "block";
            document.getElementById("patient-prescriptions-section").style.display = "block";
            document.getElementById("p-dob").value = user.dob || "";
            document.getElementById("p-gender").value = user.gender || "";
            document.getElementById("p-blood").value = user.blood_group || "";
            document.getElementById("p-city").value = user.city || "";
            document.getElementById("p-allergies").value = user.allergies || "";
            document.getElementById("p-chronic").value = user.chronic_conditions || "";
            document.getElementById("p-medications").value = user.medications || "";
            document.getElementById("p-emergency-name").value = user.emergency_contact_name || "";
            document.getElementById("p-emergency-phone").value = user.emergency_contact_phone || "";

            fetchAppointments();
            fetchPrescriptions();

        } else {
            document.getElementById("p-doctor-section").style.display = "block";
            document.getElementById("p-speciality").value = user.speciality || "";
            document.getElementById("p-licence").value = user.licence_number || "";
            document.getElementById("p-qualification").value = user.qualification || "";
            document.getElementById("p-experience").value = user.experience_years || "";
            document.getElementById("p-clinic-name").value = user.clinic_name || "";
            document.getElementById("p-clinic-address").value = user.clinic_address || "";
            document.getElementById("p-fee").value = user.consultation_fee || 0;
            document.getElementById("p-bio").value = user.short_bio || "";

            const lat = user.clinic_latitude || 20.5937;
            const lng = user.clinic_longitude || 78.9629;
            document.getElementById("lat").value = lat;
            document.getElementById("lng").value = lng;

            // Day toggles
            initDayToggles(user.available_days || "");

            // Map (defer to let DOM paint)
            setTimeout(() => initMap(lat, lng), 120);

            fetchAppointments();
            loadDoctorStats();
        }

    } catch (err) {
        console.error("Profile load error:", err);
        sessionStorage.removeItem("access_token");
        window.location.href = "login.html";
    }
}

// =============================================
// FORM SUBMIT
// =============================================
document.getElementById("profile-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = document.getElementById("save-btn");
    const msg = document.getElementById("status-msg");

    btn.disabled = true;
    btn.textContent = "Saving...";
    msg.style.display = "none";
    msg.className = "status-msg";

    const updates = {
        full_name: document.getElementById("p-name").value.trim(),
        phone: document.getElementById("p-phone").value.trim()
    };

    if (currentUserRole === "patient") {
        updates.dob = document.getElementById("p-dob").value;
        updates.gender = document.getElementById("p-gender").value;
        updates.blood_group = document.getElementById("p-blood").value.trim();
        updates.city = document.getElementById("p-city").value.trim();
        updates.allergies = document.getElementById("p-allergies").value.trim();
        updates.chronic_conditions = document.getElementById("p-chronic").value.trim();
        updates.medications = document.getElementById("p-medications").value.trim();
        updates.emergency_contact_name = document.getElementById("p-emergency-name").value.trim();
        updates.emergency_contact_phone = document.getElementById("p-emergency-phone").value.trim();
    } else {
        updates.speciality = document.getElementById("p-speciality").value.trim();
        updates.qualification = document.getElementById("p-qualification").value.trim();
        updates.experience_years = parseInt(document.getElementById("p-experience").value) || 0;
        updates.clinic_name = document.getElementById("p-clinic-name").value.trim();
        updates.clinic_address = document.getElementById("p-clinic-address").value.trim();
        updates.consultation_fee = parseFloat(document.getElementById("p-fee").value) || 0;
        updates.available_days = document.getElementById("p-days").value;
        updates.short_bio = document.getElementById("p-bio").value.trim();
        updates.clinic_latitude = parseFloat(document.getElementById("lat").value) || 0;
        updates.clinic_longitude = parseFloat(document.getElementById("lng").value) || 0;
    }

    try {
        const res = await fetch("/auth/profile", {
            method: "PATCH",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${token}`
            },
            body: JSON.stringify(updates)
        });
        const data = await res.json();

        if (res.ok && data.success) {
            msg.textContent = "✅ " + (data.message || "Profile updated successfully!");
            msg.className = "status-msg success";
            sessionStorage.setItem("user", JSON.stringify(data.data.user));
            updateSidebar(data.data.user);
        } else {
            msg.textContent = "❌ " + (data.message || "Update failed.");
            msg.className = "status-msg error";
        }
    } catch (err) {
        msg.textContent = "❌ Error connecting to server: " + err.message;
        msg.className = "status-msg error";
    } finally {
        msg.style.display = "block";
        btn.disabled = false;
        btn.textContent = "Update Profile";
        window.scrollTo({ top: 0, behavior: "smooth" });
    }
});

// =============================================
// APPOINTMENTS
// =============================================
async function fetchAppointments() {
    try {
        const res = await fetch("/appointments/my", {
            headers: { "Authorization": `Bearer ${token}` }
        });
        const data = await res.json();
        const list = document.getElementById("appointments-list");

        if (!data.success || data.data.appointments.length === 0) {
            list.innerHTML = `<div class="empty-state">No appointments found.</div>`;
            return;
        }

        const appointments = data.data.appointments;

        // Patient: check for upcoming reminder
        if (currentUserRole === "patient") {
            checkUpcomingReminder(appointments);
        }

        list.innerHTML = "";
        appointments.forEach(appt => {
            const card = document.createElement("div");
            card.className = "appt-card";

            const isPatient = currentUserRole === "patient";
            const otherName = isPatient
                ? `Dr. ${appt.doctor_name}`
                : `Patient: ${appt.patient_name}`;

            const subInfo = isPatient
                ? `${appt.speciality || ""} ${appt.clinic_name ? "• " + appt.clinic_name : ""}`
                : `${appt.blood_group ? "Blood: " + appt.blood_group : ""} ${appt.allergies ? "• Allergies: " + appt.allergies : ""}`.trim();

            // Format date
            let dateDisplay = appt.date;
            try {
                const [y, m, d] = appt.date.split("-").map(Number);
                dateDisplay = new Date(y, m - 1, d).toLocaleDateString("en-US", { weekday: "short", year: "numeric", month: "short", day: "numeric" });
            } catch(e) {}

            // Action buttons
            let actionsHtml = "";
            if (currentUserRole === "doctor") {
                if (appt.status === "pending") {
                    actionsHtml = `
                        <button class="appt-btn confirm" onclick="updateAppointmentStatus(${appt.id}, 'confirmed')">✔ Confirm</button>
                        <button class="appt-btn cancel" onclick="updateAppointmentStatus(${appt.id}, 'cancelled')">✖ Cancel</button>
                    `;
                } else if (appt.status === "confirmed") {
                    actionsHtml = `
                        <button class="appt-btn prescribe" onclick="writePrescription(${appt.id}, ${appt.patient_id})">📋 Write Prescription</button>
                        <button class="appt-btn cancel" onclick="updateAppointmentStatus(${appt.id}, 'cancelled')">✖ Cancel</button>
                    `;
                }
            } else if (currentUserRole === "patient") {
                if (appt.status === "pending") {
                    actionsHtml = `<button class="appt-btn cancel" onclick="updateAppointmentStatus(${appt.id}, 'cancelled')">✖ Cancel</button>`;
                }
                if (appt.status === "confirmed") {
                    actionsHtml += `<button class="appt-btn rate" onclick="rateDoctor(${appt.doctor_id})">⭐ Rate Doctor</button>`;
                }
            }

            card.innerHTML = `
                <div class="appt-header">
                    <span class="appt-name">${otherName}</span>
                    <span class="status-badge ${appt.status}">${appt.status}</span>
                </div>
                ${subInfo ? `<div class="appt-meta">${subInfo}</div>` : ""}
                <div class="appt-meta">📅 ${dateDisplay} &nbsp;⏰ ${appt.time || "N/A"}</div>
                <div class="appt-reason"><strong>Reason:</strong> ${appt.reason || "—"}</div>
                ${actionsHtml ? `<div class="appt-actions" id="app-actions-${appt.id}">${actionsHtml}</div>` : ""}
            `;
            list.appendChild(card);
        });

    } catch (e) {
        console.error("Appointments error:", e);
        document.getElementById("appointments-list").innerHTML = `<div class="empty-state">Error loading appointments.</div>`;
    }
}

// =============================================
// UPDATE APPOINTMENT STATUS
// =============================================
async function updateAppointmentStatus(id, status) {
    try {
        const res = await fetch(`/appointments/${id}/status`, {
            method: "PATCH",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${token}`
            },
            body: JSON.stringify({ status })
        });
        const data = await res.json();
        if (data.success) {
            fetchAppointments(); // reload without page refresh
        } else {
            alert("❌ " + (data.message || "Failed to update status."));
        }
    } catch(e) {
        alert("Error updating appointment: " + e.message);
    }
}
window.updateAppointmentStatus = updateAppointmentStatus;

// =============================================
// RATE DOCTOR
// =============================================
async function rateDoctor(doctorId) {
    const ratingStr = prompt("Rate this doctor from 1 to 5:");
    if (!ratingStr) return;
    const rating = parseInt(ratingStr);
    if (isNaN(rating) || rating < 1 || rating > 5) return alert("Invalid rating. Please enter 1–5.");
    const comment = prompt("Optional comment (press Cancel to skip):");

    try {
        const res = await fetch("/reviews", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${token}`
            },
            body: JSON.stringify({ doctor_id: doctorId, rating, comment: comment || "" })
        });
        const data = await res.json();
        alert(data.success ? "✅ " + data.message : "❌ " + data.message);
    } catch(e) {
        alert("Error submitting review.");
    }
}
window.rateDoctor = rateDoctor;

// =============================================
// WRITE PRESCRIPTION
// =============================================
async function writePrescription(appointmentId, patientId) {
    const meds = prompt("Enter medicines (comma separated):");
    if (!meds) return;
    const inst = prompt("Enter instructions:");
    if (!inst) return;

    try {
        const res = await fetch("/prescriptions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${token}`
            },
            body: JSON.stringify({ appointment_id: appointmentId, patient_id: patientId, medicines: meds, instructions: inst })
        });
        const data = await res.json();
        alert(data.success ? "✅ " + data.message : "❌ " + data.message);
    } catch(e) {
        alert("Error writing prescription.");
    }
}
window.writePrescription = writePrescription;

// =============================================
// PRESCRIPTIONS
// =============================================
async function fetchPrescriptions() {
    try {
        const res = await fetch("/prescriptions/my", {
            headers: { "Authorization": `Bearer ${token}` }
        });
        const data = await res.json();
        const list = document.getElementById("prescriptions-list");

        if (!data.success || data.data.prescriptions.length === 0) {
            list.innerHTML = `<div class="empty-state">No prescriptions found.</div>`;
            return;
        }

        list.innerHTML = "";
        data.data.prescriptions.forEach(p => {
            const card = document.createElement("div");
            card.className = "rx-card print-section";
            card.innerHTML = `
                <div class="rx-header">
                    <span class="rx-doctor">Dr. ${p.doctor_name}</span>
                    <span class="rx-date">${new Date(p.issued_at).toLocaleDateString("en-US", { year:"numeric", month:"short", day:"numeric" })}</span>
                </div>
                <div><strong>Medicines:</strong> ${p.medicines}</div>
                <div style="margin-top:4px;"><strong>Instructions:</strong> ${p.instructions}</div>
                <button onclick="window.print()" class="print-btn">🖨 Print / Save PDF</button>
            `;
            list.appendChild(card);
        });
    } catch(e) {
        document.getElementById("prescriptions-list").innerHTML = `<div class="empty-state">Error loading prescriptions.</div>`;
    }
}

// =============================================
// INIT
// =============================================
loadProfile();
