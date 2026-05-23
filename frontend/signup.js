let currentSignupTab = 'patient';
let map, marker;

// Initialize Map
function initMap() {
    if (map) return;
    map = L.map('signup-map').setView([20.5937, 78.9629], 5); // Default India view
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors'
    }).addTo(map);

    marker = L.marker([20.5937, 78.9629], { draggable: true }).addTo(map);
    marker.on('dragend', function (e) {
        const pos = marker.getLatLng();
        document.getElementById('lat').value = pos.lat.toFixed(6);
        document.getElementById('lng').value = pos.lng.toFixed(6);
    });
}

function updateMarker(lat, lng) {
    const pos = [lat, lng];
    marker.setLatLng(pos);
    map.setView(pos, 15);
    document.getElementById('lat').value = lat.toFixed(6);
    document.getElementById('lng').value = lng.toFixed(6);
}

function switchSignupTab(tab) {
  currentSignupTab = tab;
  
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
  const tabs = document.querySelectorAll('.tab-btn');
  
  if(tab === 'patient') {
    tabs[0].classList.add('active');
    document.getElementById('patient-fields').style.display = 'block';
    document.getElementById('doctor-fields').style.display = 'none';
    document.getElementById('signup-submit-btn').textContent = "Register as Patient";
    
    // Required updates
    document.getElementById('dob').required = true;
    document.getElementById('gender').required = true;
    document.getElementById('speciality').required = false;
    document.getElementById('licence').required = false;
    document.getElementById('experience').required = false;
    document.getElementById('qualification').required = false;
  } else {
    tabs[1].classList.add('active');
    document.getElementById('patient-fields').style.display = 'none';
    document.getElementById('doctor-fields').style.display = 'block';
    document.getElementById('signup-submit-btn').textContent = "Register as Doctor";
    
    // Required updates
    document.getElementById('dob').required = false;
    document.getElementById('gender').required = false;
    document.getElementById('speciality').required = true;
    document.getElementById('licence').required = true;
    document.getElementById('experience').required = true;
    document.getElementById('qualification').required = true;
    
    setTimeout(() => {
        initMap();
        map.invalidateSize();
    }, 100);
  }
}

async function detectMyLocation() {
    if (!navigator.geolocation) {
        alert("Geolocation is not supported by your browser.");
        return;
    }
    navigator.geolocation.getCurrentPosition((position) => {
        updateMarker(position.coords.latitude, position.coords.longitude);
    }, () => {
        alert("Unable to retrieve your location.");
    });
}

async function geocodeAddress() {
    const address = document.getElementById('clinic_address').value;
    if (!address) return;
    
    try {
        const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}`);
        const data = await response.json();
        if (data && data.length > 0) {
            updateMarker(parseFloat(data[0].lat), parseFloat(data[0].lon));
        } else {
            // Optional: alert("Could not find address location.");
        }
    } catch (err) {
        console.error("Error connecting to geocoding service.");
    }
}

// Debounce for Nominatim Geocoding
let geocodeTimeout;
document.addEventListener("DOMContentLoaded", () => {
    const addressInput = document.getElementById('clinic_address');
    if (addressInput) {
        addressInput.addEventListener("input", () => {
            clearTimeout(geocodeTimeout);
            geocodeTimeout = setTimeout(geocodeAddress, 1000);
        });
    }
});

document.getElementById("signup-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  
  const errorBox = document.getElementById("signup-error");
  errorBox.style.display = "none";
  
  const payload = {
    role: currentSignupTab,
    full_name: document.getElementById('name').value,
    phone: document.getElementById('phone').value,
    email: document.getElementById('email').value,
    password: document.getElementById('password').value
  };
  
  if(currentSignupTab === 'patient') {
    payload.dob = document.getElementById('dob').value;
    payload.gender = document.getElementById('gender').value;
    payload.blood_group = document.getElementById('blood_group').value;
    payload.city = document.getElementById('city').value;
    payload.allergies = document.getElementById('allergies').value;
    payload.chronic_conditions = document.getElementById('chronic').value;
    payload.medications = document.getElementById('medications').value;
    
    payload.emergency_contact_name = document.getElementById('emergency_name').value || null;
    payload.emergency_contact_phone = document.getElementById('emergency_phone').value || null;
  } else {
    payload.speciality = document.getElementById('speciality').value;
    payload.licence_number = document.getElementById('licence').value;
    payload.experience_years = parseInt(document.getElementById('experience').value);
    payload.qualification = document.getElementById('qualification').value;
    payload.clinic_name = document.getElementById('clinic_name').value;
    payload.clinic_address = document.getElementById('clinic_address').value;
    payload.consultation_fee = parseFloat(document.getElementById('fee').value || 0);
    payload.available_days = document.getElementById('available_days').value;
    payload.short_bio = document.getElementById('bio').value;
    payload.clinic_latitude = parseFloat(document.getElementById('lat').value || 0);
    payload.clinic_longitude = parseFloat(document.getElementById('lng').value || 0);
  }
  
  const btn = document.getElementById("signup-submit-btn");
  btn.disabled = true;
  btn.textContent = "Registering...";
  
  try {
      const response = await fetch(`/auth/register`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
      });
      
      const data = await response.json();
      
      if(response.ok && data.success) {
          // ✅ Auto-login: store token & user, then go straight to chat
          sessionStorage.setItem("access_token", data.data.access_token);
          sessionStorage.setItem("user", JSON.stringify(data.data.user));
          window.location.href = "index.html";
      } else {
          errorBox.textContent = data.message || "Sign up failed. Please check your inputs.";
          errorBox.style.display = "block";
      }
  } catch (err) {
      // ✅ Descriptive error messages based on error type
      if (err.name === "TypeError" && err.message.includes("fetch")) {
          errorBox.textContent = `Cannot reach the server. Please make sure the backend is running.`;
      } else {
          errorBox.textContent = "Connection error: " + (err.message || "Unknown error. Please try again.");
      }
      errorBox.style.display = "block";
  } finally {
      btn.disabled = false;
      btn.textContent = currentSignupTab === 'patient' ? "Register as Patient" : "Register as Doctor";
  }
});
