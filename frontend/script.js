const chatBox = document.getElementById("chat-box");
const chatForm = document.getElementById("chat-form");
const userInput = document.getElementById("user-input");
const toggleSidebarBtn = document.getElementById("toggle-sidebar-btn");
const historySidebar = document.getElementById("history-sidebar");
const historyList = document.getElementById("history-list");
const guestBanner = document.getElementById("guest-banner");

// ✅ Shared timestamp formatter — handles Date objects, ISO strings, and SQLite strings
function formatTime(ts) {
  if (!ts) return "";
  let d;
  if (ts instanceof Date) {
    d = ts;
  } else if (typeof ts === "string") {
    d = new Date(ts.includes("T") ? ts : ts.replace(" ", "T"));
  } else {
    return "";
  }
  if (isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

let messageHistory = [];
let currentSessionId = null;

// 🚀 Auth handling
let token = sessionStorage.getItem("access_token");
let user = JSON.parse(sessionStorage.getItem("user") || "null");

// ✅ On page load, validate token by fetching fresh profile from server
async function validateAndLoadUser() {
  if (!token) {
    // No token — show as guest
    guestBanner.style.display = "flex";
    updateHeader();
    initChat();
    return;
  }

  try {
    const response = await fetch(`/auth/me`, {
      headers: { "Authorization": `Bearer ${token}` }
    });
    const data = await response.json();

    if (response.ok && data.success) {
      user = data.data;
      sessionStorage.setItem("user", JSON.stringify(user));
      
      if (user.role === "patient") {
        toggleSidebarBtn.style.display = "block";
        fetchChatHistory();
      }
    } else {
      console.warn("Token invalid, clearing session:", data.message);
      sessionStorage.removeItem("access_token");
      sessionStorage.removeItem("user");
      token = null;
      user = null;
      guestBanner.style.display = "flex";
    }
  } catch (err) {
    console.warn("Could not reach server to validate token:", err.message);
  }

  updateHeader();
  initChat();
}

function updateHeader() {
  const headerActions = document.getElementById("header-actions");
  if (token && user) {
    let html = `
      <div style="display:flex; align-items:center; gap:10px;">
        <span style="font-weight:600; color:white;">Hi, ${user.full_name.split(' ')[0]}</span>
        <a href="chat-doctor.html" class="nav-link" style="color:white; text-decoration:none; margin-right:10px;">Messages</a>
        ${user.role === 'patient' ? '<a href="doctors.html" class="login-btn" style="background:#fff; color:#eb2c0a;">Find Doctors</a>' : ''}
        <a href="profile.html" class="login-btn" style="background:#fff; color:#eb2c0a;">Profile</a>
        <button onclick="logout()" class="login-btn" style="cursor:pointer; border:none;">Logout</button>
      </div>
    `;
    headerActions.innerHTML = html;
  }
}

function logout() {
  sessionStorage.removeItem("access_token");
  sessionStorage.removeItem("user");
  sessionStorage.removeItem("chatHistory");
  window.location.reload();
}

function initChat() {
  const saved = sessionStorage.getItem("chatHistory");
  if (saved) {
    messageHistory = JSON.parse(saved);
    renderAllMessages(messageHistory);
  } else {
    if (user) {
      const firstName = user.full_name.split(' ')[0];
      const greeting = `Hello, ${firstName}! How can I assist you today? I'm MedicaLy, your medical AI assistant.`;
      addMessage("bot", greeting);
      messageHistory.push({ role: "assistant", content: greeting });
    } else {
      const greeting = "Hello! I am MedicaLy, a medical AI assistant. Please describe your symptoms or ask a medical question.";
      addMessage("bot", greeting);
      messageHistory.push({ role: "assistant", content: greeting });
    }
    sessionStorage.setItem("chatHistory", JSON.stringify(messageHistory));
  }
}

function renderAllMessages(messages) {
  chatBox.innerHTML = "";
  messages.forEach(msg => {
    if (msg.role === "user") {
      addMessage("user", msg.content);
    } else if (msg.role === "assistant") {
      let htmlResponse = formatBotResponse(msg.content);
      if (msg.suggested_doctors && msg.suggested_doctors.length > 0) {
          htmlResponse += renderDoctorSuggestions(msg.recommended_speciality, msg.suggested_doctors);
      }
      addMessage("bot", htmlResponse, true);
    }
  });
  chatBox.scrollTop = chatBox.scrollHeight;
}

function newChat() {
  messageHistory = [];
  currentSessionId = null;
  sessionStorage.removeItem("chatHistory");
  chatBox.innerHTML = "";
  // Show fresh greeting
  if (user) {
    const firstName = user.full_name.split(' ')[0];
    const greeting = `Hello, ${firstName}! How can I assist you today? I'm MedicaLy, your medical AI assistant.`;
    addMessage("bot", greeting);
    messageHistory.push({ role: "assistant", content: greeting });
  } else {
    const greeting = "Hello! I am MedicaLy, a medical AI assistant. Please describe your symptoms or ask a medical question.";
    addMessage("bot", greeting);
    messageHistory.push({ role: "assistant", content: greeting });
  }
  sessionStorage.setItem("chatHistory", JSON.stringify(messageHistory));
}
window.newChat = newChat;

// ✅ Initialize
if (chatBox) {
  validateAndLoadUser();
} else {
  updateHeader();
}

if (toggleSidebarBtn) {
  toggleSidebarBtn.addEventListener("click", () => {
    historySidebar.style.display = historySidebar.style.display === "none" ? "block" : "none";
  });
}

async function fetchChatHistory() {
  if (!token) return;
  try {
    const res = await fetch(`/api/chat/history`, {
      headers: { "Authorization": `Bearer ${token}` }
    });
    const data = await res.json();
    if (data.success && data.data.sessions.length > 0) {
      historyList.innerHTML = data.data.sessions.map(s => `
        <div class="history-item" onclick="loadSession(${s.id})" style="padding:10px; border-bottom:1px solid #ddd; cursor:pointer; font-size:14px; color:#333;">
          <strong style="color:#0066cc;">${new Date(s.created_at).toLocaleDateString()}</strong><br/>
          <span style="color:#555; font-style:italic;">${s.preview ? s.preview.substring(0, 30) + '...' : 'New Session'}</span>
        </div>
      `).join("");
    } else {
      historyList.innerHTML = "<p style='color:#777; font-size:12px;'>No past sessions.</p>";
    }
  } catch (err) {
    console.error("Error fetching history:", err);
  }
}

async function loadSession(sessionId) {
  if (!token) return;
  try {
    const res = await fetch(`/api/chat/history/${sessionId}`, {
      headers: { "Authorization": `Bearer ${token}` }
    });
    const data = await res.json();
    if (data.success) {
      currentSessionId = sessionId;
      messageHistory = data.data.messages;
      chatBox.innerHTML = "";
      messageHistory.forEach(msg => {
        if (msg.role === "user") {
          addMessage("user", msg.content);
        } else if (msg.role === "assistant") {
          addMessage("bot", formatBotResponse(msg.content), true);
        }
      });
      // Close sidebar on mobile
      if (window.innerWidth < 768) {
        historySidebar.style.display = "none";
      }
    }
  } catch (err) {
    console.error("Error loading session:", err);
  }
}

chatForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const message = userInput.value.trim();
  if (message === "") return;

  addMessage("user", message);
  // Only push exactly {role, content} — no extra fields that break Pydantic
  messageHistory.push({ role: "user", content: message });
  sessionStorage.setItem("chatHistory", JSON.stringify(messageHistory));
  userInput.value = "";

  const loader = showLoader();

  const headers = { "Content-Type": "application/json" };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  // Clean messageHistory before sending — strip non-standard entries and extra fields
  const cleanMessages = messageHistory
    .filter(m => m && typeof m.role === "string" && typeof m.content === "string")
    .map(m => ({ role: m.role, content: m.content }));

  fetch(`/api/chat`, {
    method: "POST",
    headers: headers,
    body: JSON.stringify({ messages: cleanMessages })
  })
    .then(res => res.json())
    .then(data => {
      const replyTime = new Date(); // client time at moment response arrives
      removeLoader(loader);
      if (data.success) {
        if (data.data.session_id) {
            currentSessionId = data.data.session_id;
        }
        messageHistory.push({ 
            role: "assistant", 
            content: data.data.response,
            suggested_doctors: data.data.suggested_doctors,
            recommended_speciality: data.data.recommended_speciality
        });
        sessionStorage.setItem("chatHistory", JSON.stringify(messageHistory));
        
        const htmlResponse = formatBotResponse(data.data.response);
        addMessage("bot", htmlResponse, true, replyTime);

        // Append doctor suggestion card AFTER the message bubble, not inside it
        if (data.data.recommended_speciality) {
            renderDoctorSuggestions(data.data.recommended_speciality, data.data.suggested_doctors);
        }
        if (user && user.role === 'patient') fetchChatHistory(); // refresh history
      } else {
        addMessage("bot", "⚠️ " + (data.message || "Failed to get response"));
      }
    })
    .catch(err => {
      removeLoader(loader);
      if (err.name === "TypeError" && err.message.includes("fetch")) {
        addMessage("bot", "⚠️ Cannot reach the server. Please make sure the backend is running.");
      } else {
        addMessage("bot", `⚠️ Connection error: ${err.message || err}`);
      }
    });
});

function addMessage(sender, content, isHtml = false, timestamp = null) {
  const msg = document.createElement("div");
  msg.classList.add("chat-message", sender === "user" ? "user-message" : "bot-message");

  const icon = document.createElement("img");
  icon.src = sender === "user" ? "assets/user.png" : "assets/bot.png";
  icon.alt = sender;
  icon.classList.add("icon");

  // Timestamp label
  const ts = timestamp || new Date();
  const timeEl = document.createElement("span");
  timeEl.style.cssText = "display:block; font-size:11px; opacity:0.5; margin-top:4px; text-align:" + (sender === "user" ? "right" : "left");
  timeEl.textContent = formatTime(ts);

  if (isHtml) {
    msg.innerHTML = content;
    msg.insertBefore(icon, msg.firstChild);
  } else {
    msg.textContent = content;
    msg.insertBefore(icon, msg.firstChild);
  }
  msg.appendChild(timeEl);

  chatBox.appendChild(msg);
  chatBox.scrollTop = chatBox.scrollHeight;
}

function showLoader() {
  const loader = document.createElement("div");
  loader.classList.add("loader");

  const icon = document.createElement("img");
  icon.src = "assets/bot.png";
  icon.classList.add("icon");
  icon.style.width = "28px";
  icon.style.height = "28px";
  icon.style.borderRadius = "50%";

  const svg = document.createElement("img");
  svg.src = "assets/loader.svg";
  svg.alt = "Loading...";
  svg.style.height = "24px";

  loader.appendChild(icon);
  loader.appendChild(svg);
  chatBox.appendChild(loader);
  chatBox.scrollTop = chatBox.scrollHeight;
  return loader;
}

function removeLoader(loaderElement) {
  if (loaderElement && loaderElement.parentNode) {
    loaderElement.parentNode.removeChild(loaderElement);
  }
}

function formatBotResponse(rawText) {
  const confidenceLabels = {
    "very likely": "🟢 <span style='color:#006400; font-weight:bold;'>Very Likely</span>",
    "possible": "🟡 <span style='color:#b58900; font-weight:bold;'>Possible</span>",
    "less likely": "🔴 <span style='color:#b22222; font-weight:bold;'>Less Likely</span>"
  };

  const lines = rawText.split(/\n|(?=\d+\.\s|\-\s)/).filter(Boolean);
  const formatted = lines.map((line) => {
    const diseaseMatch = line.match(/\*\*(.+?)\*\*/);
    const confidenceMatch = Object.keys(confidenceLabels).find((level) =>
      line.toLowerCase().includes(level)
    );

    const diseaseName = diseaseMatch ? `<strong style="color:#0066cc;">${diseaseMatch[1]}</strong>` : line;
    const label = confidenceMatch ? ` – ${confidenceLabels[confidenceMatch]}` : "";
    return `<li style="margin-bottom: 8px;">${diseaseName}${label}</li>`;
  });

  return `
    <ul style="padding-left: 20px; margin: 0 0 10px 0; color: #222;">
      ${formatted.join("")}
    </ul>
  `;
}

function renderDoctorSuggestions(speciality, doctors) {
    const existing = document.getElementById("doctor-suggestion-card");
    if (existing) existing.remove();

    if (!speciality) return;

    const card = document.createElement("div");
    card.id = "doctor-suggestion-card";
    card.style.cssText = `
        background: #f0f9ff;
        border: 1px solid #bae6fd;
        border-radius: 12px;
        padding: 14px 16px;
        margin: 8px 16px;
        max-width: 520px;
    `;

    // No doctors found for this speciality
    if (!doctors || doctors.length === 0) {
        card.innerHTML = `
            <p style="font-size:13px; color:#0369a1; margin-bottom:8px;">
                Based on your symptoms, you should see a <strong>${speciality}</strong>.
            </p>
            <p style="font-size:12px; color:#64748b;">
                No ${speciality} is currently registered in our system.
                <a href="doctors.html" style="color:#0369a1;">Browse all available doctors →</a>
            </p>`;
        const chatBox = document.getElementById("chat-box");
        chatBox.appendChild(card);
        chatBox.scrollTop = chatBox.scrollHeight;
        return;
    }

    let html = `<p style="font-size:13px; color:#0369a1; margin-bottom:10px;">
        Based on your symptoms, you may want to see a <strong>${speciality}</strong>:
    </p>`;

    doctors.forEach(doc => {
        const escapedDoc = JSON.stringify(doc).replace(/"/g, '&quot;');
        const isLoggedInPatient = user && user.role === 'patient';
        html += `
        <div style="background:#fff; border:0.5px solid #e0f2fe; border-radius:8px;
                    padding:10px 12px; margin-bottom:8px;">
            <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px;">
                <div>
                    <div style="font-weight:500; font-size:14px; color:#0c4a6e;">Dr. ${doc.full_name}</div>
                    <div style="font-size:12px; color:#64748b;">${doc.speciality}</div>
                    <div style="font-size:12px; color:#64748b;">${doc.clinic_address || 'Location not set'}</div>
                    <div style="font-size:12px; font-weight:500; color:#0369a1;">\u20B9${doc.consultation_fee || 'N/A'} consultation</div>
                </div>
                <div style="display:flex; flex-direction:column; gap:6px; flex-shrink:0;">
                    <button onclick="window.location.href='doctors.html'"
                        style="font-size:12px; padding:5px 10px; border-radius:6px;
                               border:1px solid #0369a1; background:#fff; color:#0369a1; cursor:pointer;">
                        View on Map
                    </button>
                    <button onclick="startDoctorChat(${doc.id})"
                        style="font-size:12px; padding:5px 10px; border-radius:6px;
                               border:none; background:#0369a1; color:#fff; cursor:pointer;">
                        Message Doctor
                    </button>
                    ${isLoggedInPatient ? `<button onclick="toggleChatBookingForm('chat-book-${doc.id}', '${doc.id}', '${doc.full_name.replace(/'/g,"\\'")}')"
                        style="font-size:12px; padding:5px 10px; border-radius:6px;
                               border:none; background:#2e7d32; color:#fff; cursor:pointer;">
                        Book Appointment
                    </button>` : ''}
                </div>
            </div>
            ${isLoggedInPatient ? `
            <div id="chat-book-${doc.id}" style="display:none; margin-top:10px; padding:10px; background:#f8fafc; border-radius:8px; border:1px solid #e2e8f0;">
                <div style="font-size:12px; font-weight:600; color:#334155; margin-bottom:6px;">Book with Dr. ${doc.full_name}</div>
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
                    <div>
                        <label style="font-size:11px; color:#64748b; display:block; margin-bottom:2px;">Date</label>
                        <input type="date" id="chat-date-${doc.id}" style="width:100%; padding:5px 8px; border:1px solid #e2e8f0; border-radius:6px; font-size:12px;" min="${new Date().toISOString().split('T')[0]}" />
                    </div>
                    <div>
                        <label style="font-size:11px; color:#64748b; display:block; margin-bottom:2px;">Time</label>
                        <input type="time" id="chat-time-${doc.id}" style="width:100%; padding:5px 8px; border:1px solid #e2e8f0; border-radius:6px; font-size:12px;" min="09:00" max="18:00" />
                    </div>
                    <div style="grid-column:span 2;">
                        <label style="font-size:11px; color:#64748b; display:block; margin-bottom:2px;">Reason</label>
                        <input type="text" id="chat-reason-${doc.id}" placeholder="Reason for visit" style="width:100%; padding:5px 8px; border:1px solid #e2e8f0; border-radius:6px; font-size:12px;" />
                    </div>
                </div>
                <button onclick="bookFromChat(${doc.id}, '${doc.full_name.replace(/'/g,"\\'")}')"
                    style="margin-top:8px; padding:6px 16px; border-radius:6px; border:none; background:#2e7d32; color:#fff; font-size:12px; font-weight:600; cursor:pointer;">
                    Confirm Booking
                </button>
                <div id="chat-book-msg-${doc.id}" style="font-size:11px; margin-top:5px;"></div>
            </div>` : ''}
        </div>`;
    });

    card.innerHTML = html;
    const chatBox = document.getElementById("chat-box");
    chatBox.appendChild(card);
    chatBox.scrollTop = chatBox.scrollHeight;
}

window.startDoctorChat = function(doctorId) {
    sessionStorage.setItem("chat_target_id", doctorId);
    window.location.href = "chat-doctor.html";
};

window.toggleChatBookingForm = function(formId, doctorId, doctorName) {
    const el = document.getElementById(formId);
    if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
};

window.bookFromChat = async function(doctorId, doctorName) {
    if (!token) { alert("Please log in to book an appointment."); return; }

    const dateInput = document.getElementById(`chat-date-${doctorId}`);
    const timeInput = document.getElementById(`chat-time-${doctorId}`);
    const reasonInput = document.getElementById(`chat-reason-${doctorId}`);
    const msgEl = document.getElementById(`chat-book-msg-${doctorId}`);

    if (!dateInput.value) { msgEl.textContent = "⚠ Please select a date."; msgEl.style.color = "#c62828"; return; }
    if (!timeInput.value) { msgEl.textContent = "⚠ Please select a time."; msgEl.style.color = "#c62828"; return; }
    if (!reasonInput.value.trim()) { msgEl.textContent = "⚠ Please enter a reason."; msgEl.style.color = "#c62828"; return; }

    // Format date as YYYY-MM-DD, time as HH:MM
    const formattedDate = new Date(dateInput.value).toISOString().split('T')[0];
    const formattedTime = timeInput.value.slice(0, 5);

    msgEl.textContent = "Booking...";
    msgEl.style.color = "#0369a1";

    try {
        const res = await fetch('/appointments/book', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                doctor_id: parseInt(doctorId),
                date: formattedDate,
                time: formattedTime,
                reason: reasonInput.value.trim()
            })
        });
        const data = await res.json();
        if (data.success) {
            // Collapse the form
            const formEl = document.getElementById(`chat-book-${doctorId}`);
            if (formEl) formEl.style.display = 'none';

            // Append confirmation message in chat (Suggestion 1)
            const [y, m, d] = formattedDate.split('-').map(Number);
            const dateObj = new Date(y, m - 1, d);
            const dayName = dateObj.toLocaleDateString('en-US', { weekday: 'long' });
            const dateFormatted = dateObj.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
            const confirmMsg = `✅ Appointment booked with Dr. ${doctorName} on ${dayName}, ${dateFormatted} at ${formattedTime}. Status: Pending confirmation from doctor.`;
            addMessage('bot', confirmMsg);
        } else {
            msgEl.textContent = "❌ " + (data.message || "Booking failed.");
            msgEl.style.color = "#c62828";
        }
    } catch(err) {
        msgEl.textContent = "❌ Error: " + err.message;
        msgEl.style.color = "#c62828";
    }
};

function goToNewChat() {
    sessionStorage.removeItem("chatHistory");
    window.location.href = "index.html";
}
window.goToNewChat = goToNewChat;
