let map, userMarker;
let markers = [];
const token = sessionStorage.getItem("access_token");
const user = JSON.parse(sessionStorage.getItem("user") || "null");

if (!token) {
   window.location.href = "login.html";
} else if (user && user.role === "doctor") {
   window.location.href = "profile.html";
}

// ==========================================
// DAY NORMALIZATION (mirrors backend logic)
// ==========================================
const DAY_NORMALIZE_MAP = {
   monday: "Mon",
   mon: "Mon",
   tuesday: "Tue",
   tue: "Tue",
   tues: "Tue",
   wednesday: "Wed",
   wed: "Wed",
   thursday: "Thu",
   thu: "Thu",
   thur: "Thu",
   thurs: "Thu",
   friday: "Fri",
   fri: "Fri",
   saturday: "Sat",
   sat: "Sat",
   sunday: "Sun",
   sun: "Sun",
};

// 0=Sun 1=Mon 2=Tue 3=Wed 4=Thu 5=Fri 6=Sat (JS getDay())
const DAY_SHORT_TO_JS = {
   Sun: 0,
   Mon: 1,
   Tue: 2,
   Wed: 3,
   Thu: 4,
   Fri: 5,
   Sat: 6,
};
const JS_DAY_NAMES = [
   "Sunday",
   "Monday",
   "Tuesday",
   "Wednesday",
   "Thursday",
   "Friday",
   "Saturday",
];

function normalizeDayClient(day) {
   return (
      DAY_NORMALIZE_MAP[day.trim().toLowerCase()] ||
      day.trim().charAt(0).toUpperCase() + day.trim().slice(1, 3)
   );
}

function parseAvailableDays(availableDaysStr) {
   if (!availableDaysStr) return { normalized: [], jsNums: new Set() };
   const normalized = availableDaysStr
      .split(",")
      .map((d) => normalizeDayClient(d))
      .filter(Boolean);
   const jsNums = new Set(
      normalized.map((d) => DAY_SHORT_TO_JS[d]).filter((n) => n !== undefined)
   );
   return { normalized, jsNums };
}

// ==========================================
// MAP LOGIC
// ==========================================
function initMap() {
   map = L.map("doctors-map").setView([22.517365, 88.418746], 5);
   L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap contributors",
   }).addTo(map);
}

async function detectLocation() {
   if (!navigator.geolocation) {
      alert("Geolocation not supported.");
      return;
   }
   document.getElementById("status-text").textContent = "Locating you...";
   document.getElementById("map-loader").style.display = "flex";

   navigator.geolocation.getCurrentPosition(
      async (position) => {
         const { latitude, longitude } = position.coords;
         document.getElementById(
            "status-text"
         ).textContent = `Found you! Searching for doctors within 50km...`;
         if (userMarker) map.removeLayer(userMarker);
         userMarker = L.circleMarker([latitude, longitude], {
            color: "#0066cc",
            radius: 10,
            fillOpacity: 0.8,
         })
            .addTo(map)
            .bindPopup("You are here")
            .openPopup();
         map.setView([latitude, longitude], 12);
         await fetchDoctors(latitude, longitude);
      },
      () => {
         document.getElementById("status-text").textContent =
            "Location access denied. Please enable it to find doctors.";
         document.getElementById("map-loader").style.display = "none";
      }
   );
}

async function fetchDoctors(lat, lon) {
   try {
      const response = await fetch(
         `/appointments/doctors/nearby?lat=${lat}&lon=${lon}&max_distance=50`
      );
      const data = await response.json();
      if (response.ok && data.success) {
         await renderDoctors(data.data.doctors);
      } else {
         document.getElementById("status-text").textContent =
            "Failed to fetch doctors: " + (data.message || "Unknown error");
      }
   } catch (err) {
      document.getElementById("status-text").textContent =
         "Error connecting to server: " + (err.message || err);
   } finally {
      document.getElementById("map-loader").style.display = "none";
   }
}

async function fetchDoctorRating(doctorId) {
   try {
      const res = await fetch(`/reviews/doctor/${doctorId}`);
      const data = await res.json();
      if (data.success && data.data.avg_rating > 0) {
         return `⭐ ${data.data.avg_rating.toFixed(1)}`;
      }
      return "No ratings yet";
   } catch (e) {
      return "No ratings yet";
   }
}

async function renderDoctors(doctors) {
   const list = document.getElementById("doctors-list");
   list.innerHTML = "";
   markers.forEach((m) => map.removeLayer(m));
   markers = [];

   if (doctors.length === 0) {
      list.innerHTML = `<p style="text-align:center; color:#777; margin-top:50px;">No doctors found within 50km of your location.</p>`;
      return;
   }

   document.getElementById(
      "status-text"
   ).textContent = `Found ${doctors.length} doctors near you.`;

   for (const doc of doctors) {
      const ratingText = await fetchDoctorRating(doc.id);

      const marker = L.marker([doc.clinic_latitude, doc.clinic_longitude])
         .addTo(map)
         .bindPopup(
            `<b>Dr. ${doc.full_name}</b><br>${doc.speciality}<br>${
               doc.clinic_name || "Clinic"
            }`
         );
      markers.push(marker);

      const card = document.createElement("div");
      card.className = "doctor-card";

      const { normalized: normDays } = parseAvailableDays(
         doc.available_days || ""
      );
      const daysDisplay =
         normDays.length > 0
            ? `Available: ${normDays.join(", ")}`
            : "Availability not specified";

      card.innerHTML = `
            <h3 onclick="focusDoctor(${doc.clinic_latitude}, ${
         doc.clinic_longitude
      }, ${markers.length - 1})">Dr. ${doc.full_name}</h3>
            <p><strong>${doc.speciality}</strong> | ${
         doc.qualification || ""
      }</p>
            <p>${doc.clinic_name || "Private Clinic"}</p>
            <p style="color:#777; font-size:0.8rem; margin-bottom: 5px;">${
               doc.clinic_address || ""
            }</p>
            <p style="font-size:0.85rem; color:#f39c12; font-weight:bold;">${ratingText}</p>
            <p style="font-size:0.8rem; color:#2e7d32; font-weight:500;">${daysDisplay}</p>
            <div style="display:flex; justify-content:space-between; align-items:center; margin-top:5px;">
                <span class="distance-tag">${doc.distance_km} km away</span>
                <span style="font-weight:600; color:#2e7d32;">₹${
                   doc.consultation_fee || 0
                }</span>
            </div>
            <div style="display:flex; gap:10px; margin-top:10px;">
                <button class="action-btn book" onclick="openBookingModal(${JSON.stringify(
                   doc
                ).replace(/"/g, "&quot;")})">Book Appointment</button>
                <button class="action-btn msg" onclick="messageDoctor(${
                   doc.id
                })">Message Doctor</button>
            </div>
        `;
      list.appendChild(card);
   }

   if (markers.length > 0) {
      const group = new L.featureGroup([userMarker, ...markers]);
      map.fitBounds(group.getBounds().pad(0.1));
   }
}

window.focusDoctor = function (lat, lng, markerIndex) {
   map.setView([lat, lng], 15);
   markers[markerIndex].openPopup();
};

window.messageDoctor = function (doctorId) {
   window.location.href = `chat-doctor.html?doctor_id=${doctorId}`;
};

// ==========================================
// BOOKING MODAL — Fully Dynamic (never hardcoded in HTML)
// ==========================================

let currentBookingDoctor = null;
let selectedTimeSlot = null;

window.openBookingModal = function (doctor) {
   // doctor may be passed as a JSON-serialized string via onclick attr or as object
   if (typeof doctor === "string") {
      try {
         doctor = JSON.parse(doctor);
      } catch (e) {}
   }
   currentBookingDoctor = doctor;
   selectedTimeSlot = null;

   // Remove any existing modal first
   const existing = document.getElementById("booking-modal");
   if (existing) existing.remove();

   const { normalized: normDays } = parseAvailableDays(
      doctor.available_days || ""
   );
   const daysLabel =
      normDays.length > 0 ? normDays.join(", ") : "Not specified";
   const today = new Date().toISOString().split("T")[0];

   const modal = document.createElement("div");
   modal.id = "booking-modal";
   modal.style.cssText =
      "display:flex; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.55); z-index:2000; justify-content:center; align-items:center;";
   modal.innerHTML = `
        <div class="modal-content" id="booking-modal-inner">
            <h3>📅 Book Appointment</h3>
            <p style="font-weight:700; color:#333; margin-bottom:4px; font-size:1rem;">Dr. ${
               doctor.full_name
            }</p>
            <p style="font-size:0.82rem; color:#555; margin-bottom:4px;">${
               doctor.speciality || ""
            } ${doctor.clinic_name ? "• " + doctor.clinic_name : ""}</p>

            <form id="booking-form" autocomplete="off">
                <input type="hidden" id="book-doctor-id" value="${doctor.id}" />

                <label>Date</label>
                <div class="available-days-hint">📆 Available: ${daysLabel}</div>
                <input type="date" id="book-date" required min="${today}" />
                <div class="date-error-msg" id="date-error-msg"></div>

                <div id="time-slots-section">
                    <label>Select Time Slot</label>
                    <div class="time-slots-container" id="time-slots-container"></div>
                    <input type="hidden" id="book-time" />
                </div>

                <label style="margin-top:14px;">Reason for Visit</label>
                <textarea id="book-reason" rows="3" placeholder="Describe the reason for your visit..." required></textarea>

                <div class="modal-actions">
                    <button type="button" class="action-btn" onclick="closeBookingModal()">Cancel</button>
                    <button type="submit" class="action-btn book" id="confirm-book-btn">Confirm Booking</button>
                </div>
            </form>
        </div>
    `;
   document.body.appendChild(modal);
   modal.style.display = "flex";

   // Wire up date change validation
   const dateInput = modal.querySelector("#book-date");
   dateInput.addEventListener("change", onBookingDateChange);

   // Wire up form submit
   modal
      .querySelector("#booking-form")
      .addEventListener("submit", handleBookingSubmit);

   // Close on backdrop click
   modal.addEventListener("click", (e) => {
      if (e.target === modal) closeBookingModal();
   });
};

function onBookingDateChange() {
   const dateInput = document.getElementById("book-date");
   const errorEl = document.getElementById("date-error-msg");
   const timeSlotsSection = document.getElementById("time-slots-section");
   document.getElementById("book-time").value = "";
   selectedTimeSlot = null;

   if (!dateInput.value) return;

   const { normalized: normDays, jsNums } = parseAvailableDays(
      currentBookingDoctor.available_days || ""
   );

   // Use UTC to avoid timezone shifting the date
   const [y, m, d] = dateInput.value.split("-").map(Number);
   const selectedDate = new Date(y, m - 1, d);
   const dayNum = selectedDate.getDay(); // 0=Sun

   if (normDays.length > 0 && !jsNums.has(dayNum)) {
      const dayName = JS_DAY_NAMES[dayNum];
      errorEl.textContent = `This doctor is not available on ${dayName}. Please choose a ${normDays.join(
         " or "
      )}.`;
      errorEl.style.display = "block";
      dateInput.value = "";
      timeSlotsSection.style.display = "none";
      return;
   }

   errorEl.style.display = "none";
   timeSlotsSection.style.display = "block";
   loadTimeSlots(dateInput.value);
}

async function loadTimeSlots(dateStr) {
   const container = document.getElementById("time-slots-container");
   container.innerHTML = `<span style="font-size:0.82rem; color:#777;">Loading slots...</span>`;

   let bookedSlots = [];
   try {
      const res = await fetch(
         `/appointments/slots?doctor_id=${currentBookingDoctor.id}&date=${dateStr}`
      );
      const data = await res.json();
      if (data.success) bookedSlots = data.data.booked_slots || [];
   } catch (e) {
      console.warn("Could not fetch slots:", e);
   }

   // Generate slots 09:00 to 18:00 in 30-minute intervals
   const slots = [];
   for (let h = 9; h < 18; h++) {
      slots.push(`${String(h).padStart(2, "0")}:00`);
      slots.push(`${String(h).padStart(2, "0")}:30`);
   }

   container.innerHTML = "";
   slots.forEach((slot) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "time-slot-btn";
      btn.textContent = slot;
      const isBooked = bookedSlots.includes(slot);
      if (isBooked) {
         btn.disabled = true;
         btn.title = "Already booked";
      } else {
         btn.addEventListener("click", () => {
            document
               .querySelectorAll(".time-slot-btn")
               .forEach((b) => b.classList.remove("selected"));
            btn.classList.add("selected");
            selectedTimeSlot = slot;
            document.getElementById("book-time").value = slot;
         });
      }
      container.appendChild(btn);
   });
}

async function handleBookingSubmit(e) {
   e.preventDefault();
   const btn = document.getElementById("confirm-book-btn");

   const dateInput = document.getElementById("book-date");
   const reason = document.getElementById("book-reason").value.trim();

   if (!selectedTimeSlot) {
      alert("Please select a time slot.");
      return;
   }
   if (!reason) {
      alert("Please enter a reason for your visit.");
      return;
   }

   btn.disabled = true;
   btn.textContent = "Booking...";

   // Format date explicitly as YYYY-MM-DD
   const formattedDate = dateInput.value; // already YYYY-MM-DD from input[type=date]
   // Time is HH:MM from time slot button
   const formattedTime = selectedTimeSlot;

   const payload = {
      doctor_id: parseInt(document.getElementById("book-doctor-id").value),
      date: formattedDate,
      time: formattedTime,
      reason: reason,
   };

   try {
      const res = await fetch(`/appointments/book`, {
         method: "POST",
         headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
         },
         body: JSON.stringify(payload),
      });
      const data = await res.json();

      if (data.success) {
         closeBookingModal();
         // Show success message
         showBookingSuccess(currentBookingDoctor, formattedDate, formattedTime);
      } else {
         alert("❌ " + (data.message || "Failed to book appointment."));
      }
   } catch (err) {
      // alert("Error connecting to server: " + err.message);
   } finally {
      btn.disabled = false;
      btn.textContent = "Confirm Booking";
   }
}

function showBookingSuccess(doctor, date, time) {
   // Format date nicely
   const [y, m, d] = date.split("-").map(Number);
   const dateObj = new Date(y, m - 1, d);
   const dayName = dateObj.toLocaleDateString("en-US", { weekday: "long" });
   const dateFormatted = dateObj.toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
   });

   const banner = document.createElement("div");
   banner.style.cssText = `
        position: fixed; top: 80px; right: 20px; z-index: 3000;
        background: #e8f5e9; border: 1.5px solid #4caf50; border-radius: 12px;
        padding: 16px 20px; max-width: 340px; box-shadow: 0 4px 20px rgba(0,0,0,0.12);
        animation: fadeIn 0.3s ease;
    `;
   banner.innerHTML = `
        <div style="font-weight:700; color:#1b5e20; margin-bottom:6px;">✅ Appointment Booked!</div>
        <div style="font-size:0.88rem; color:#2e7d32;">
            Dr. ${doctor.full_name} (${doctor.speciality})<br>
            ${dayName}, ${dateFormatted} at ${time}<br>
            <em>Status: Pending confirmation from doctor</em>
        </div>
    `;
   document.body.appendChild(banner);
   setTimeout(() => banner.remove(), 6000);
}

window.closeBookingModal = function () {
   const modal = document.getElementById("booking-modal");
   if (modal) modal.remove();
   currentBookingDoctor = null;
   selectedTimeSlot = null;
};

initMap();
detectLocation();
