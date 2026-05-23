const token = sessionStorage.getItem("access_token");
const user = JSON.parse(sessionStorage.getItem("user") || "null");

if (!token || !user) {
    window.location.href = "login.html";
}

let currentContactId = null;
let currentContactName = "";
let contacts = [];
let pollingInterval = null;
let lastMessageId = 0;
let isSending = false;

const contactsListEl = document.getElementById("contacts-list");
const chatAreaEl = document.getElementById("chat-area");
const noChatSelectedEl = document.getElementById("no-chat-selected");
const chatMessagesEl = document.getElementById("chat-messages");
const chatContactNameEl = document.getElementById("chat-contact-name");
const chatForm = document.getElementById("chat-form");
const msgInput = document.getElementById("msg-input");
const sendBtn = chatForm ? chatForm.querySelector("button[type='submit']") : null;

// Send button only enabled when input has text
if (msgInput && sendBtn) {
    sendBtn.disabled = true;
    msgInput.addEventListener("input", () => {
        sendBtn.disabled = msgInput.value.trim() === "";
    });
}

// Check sessionStorage for direct messaging
let directContactId = sessionStorage.getItem("chat_target_id");
if (directContactId) {
    directContactId = parseInt(directContactId);
    if (directContactId === user.id) {
        sessionStorage.removeItem("chat_target_id");
        alert("You cannot start a chat with yourself.");
        window.location.href = "doctors.html";
    } else {
        sessionStorage.removeItem("chat_target_id");
    }
}

async function fetchContacts() {
    try {
        const res = await fetch('/doctor-chat/contacts', {
            headers: { "Authorization": `Bearer ${token}` }
        });
        const data = await res.json();
        if (data.success) {
            contacts = data.data.contacts;
            renderContacts();
            
            // Auto-select if URL param is present and not yet selected
            if (directContactId && !currentContactId) {
                const contactExists = contacts.find(c => c.contact_id === directContactId);
                if (contactExists) {
                    selectContact(contactExists.contact_id, contactExists.contact_name);
                } else {
                    // Contact not in history, create a temp entry
                    currentContactId = directContactId;
                    currentContactName = user.role === 'patient' ? "Dr. Selected" : "Selected Patient"; // Placeholder name
                    contacts.unshift({
                        contact_id: currentContactId,
                        contact_name: currentContactName,
                        role: user.role === 'patient' ? 'doctor' : 'patient',
                        unread_count: 0,
                        last_message: "Start a new conversation"
                    });
                    renderContacts();
                    selectContact(currentContactId, currentContactName);
                }
                directContactId = null; // Only do this once
            }
        }
        console.log("Contacts fetched:", data);
    } catch (e) {
        console.error("Error fetching contacts:", e);
    }
}

function renderContacts() {
    contactsListEl.innerHTML = "";
    if (contacts.length === 0) {
        contactsListEl.innerHTML = "<p style='padding:15px; color:#777; font-size:0.9rem;'>No recent conversations.</p>";
        return;
    }
    
    contacts.forEach(c => {
        const el = document.createElement("div");
        el.className = `contact-item ${currentContactId === c.contact_id ? 'active' : ''}`;
        el.onclick = () => selectContact(c.contact_id, c.contact_name);
        
        const prefix = c.role === 'doctor' ? 'Dr. ' : '';
        const nameDisplay = `${prefix}${c.contact_name}`;
        
        let badgeHtml = c.unread_count > 0 ? `<span class="unread-badge">${c.unread_count}</span>` : "";
        
        el.innerHTML = `
            <div class="contact-info">
                <span class="contact-name">${nameDisplay}</span>
                <span class="contact-preview">${c.last_message || ''}</span>
            </div>
            ${badgeHtml}
        `;
        contactsListEl.appendChild(el);
    });
}

async function selectContact(contactId, contactName) {
    currentContactId = contactId;
    currentContactName = contactName;
    
    const prefix = user.role === 'patient' ? 'Dr. ' : ''; // If I'm patient, they are doctor
    // Note: The prefix logic here might be slightly off if two doctors chat, but current schema only allows doc <-> patient
    chatContactNameEl.textContent = `${prefix}${contactName}`;
    
    noChatSelectedEl.style.display = "none";
    chatAreaEl.style.display = "flex";
    
    renderContacts(); // Update active class
    
    lastMessageId = 0;
    chatMessagesEl.innerHTML = "";
    
    await loadChatHistory();
    
    // Clear unread badge in notification.js globally
    if (window.updateNotificationBadge) {
        const contact = contacts.find(c => c.contact_id === contactId);
        if (contact && contact.unread_count > 0) {
            window.updateNotificationBadge(contact.unread_count);
            contact.unread_count = 0;
            renderContacts();
        }
    }
}

async function loadChatHistory() {
    if (!currentContactId) return;
    
    try {
        const res = await fetch(`/doctor-chat/history/${currentContactId}`, {
            headers: { "Authorization": `Bearer ${token}` }
        });
        const data = await res.json();
        
        if (data.success) {
            const msgs = data.data.messages;
            
            if (msgs.length === 0 && lastMessageId === 0) {
                chatMessagesEl.innerHTML = "<p style='text-align:center; color:#777; margin-top:20px;'>No messages yet. Send a message to start!</p>";
                return;
            }
            
            // Only append messages newer than what we've already shown
            const newMsgs = msgs.filter(m => m.id > lastMessageId);
            if (newMsgs.length > 0) {
                // On initial load show all; on poll only show other person's new messages
                const isInitialLoad = lastMessageId === 0;
                newMsgs.forEach(msg => {
                    if (isInitialLoad || msg.sender_id != user.id) {
                        appendMessage(msg);
                    }
                });
                lastMessageId = msgs[msgs.length - 1].id;
                scrollToBottom();
            }
        }
    } catch (e) {
        console.error("Error loading history:", e);
    }
}

// ✅ Shared timestamp formatter (mirrors script.js)
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

function appendMessage(msgObj) {
    // Remove "No messages yet" placeholder
    if (chatMessagesEl.querySelector('p')) {
        chatMessagesEl.innerHTML = "";
    }
    
    const isMine = msgObj.sender_id == user.id;
    const div = document.createElement("div");
    div.className = `msg-bubble ${isMine ? 'msg-sent' : 'msg-received'}`;
    
    const timeStr = formatTime(msgObj.timestamp);
    div.innerHTML = `${msgObj.message}<span class="msg-time">${timeStr}</span>`;
    chatMessagesEl.appendChild(div);
}

function scrollToBottom() {
    chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
}

// Single submit handler — registered once, never re-added
async function sendMessage(e) {
    e.preventDefault();
    if (!currentContactId) return;
    if (isSending) return;

    const content = msgInput.value.trim();
    if (!content) return;

    const sentAt = new Date().toISOString(); // capture exact client time

    isSending = true;
    if (sendBtn) sendBtn.disabled = true;
    msgInput.value = "";

    // Optimistic render with client timestamp — shown immediately
    appendMessage({ sender_id: user.id, message: content, timestamp: sentAt });
    scrollToBottom();

    try {
        const res = await fetch('/doctor-chat/send', {
            method: 'POST',
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${token}`
            },
            body: JSON.stringify({
                recipient_id: currentContactId,
                message: content,
                sent_at: sentAt
            })
        });

        const data = await res.json();
        if (!data.success) {
            console.error("Failed to send message:", data.message);
        } else {
            const contact = contacts.find(c => c.contact_id === currentContactId);
            if (contact) {
                contact.last_message = content;
                renderContacts();
            } else {
                fetchContacts();
            }
        }
    } catch (err) {
        console.error("Error sending message:", err);
    } finally {
        isSending = false;
        if (sendBtn) sendBtn.disabled = msgInput.value.trim() === "";
    }
}

if (chatForm) {
    chatForm.removeEventListener("submit", sendMessage);
    chatForm.addEventListener("submit", sendMessage);
}

// Polling loop
async function pollUpdates() {
    if (!currentContactId) return;
    await loadChatHistory();
    await fetchContacts();
}

// Initial fetch
fetchContacts();

// Start polling every 2 seconds, pause when tab is hidden
pollingInterval = setInterval(pollUpdates, 2000);

document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
        clearInterval(pollingInterval);
    } else {
        pollingInterval = setInterval(pollUpdates, 2000);
    }
});
