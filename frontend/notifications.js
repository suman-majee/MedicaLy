// notifications.js
// Included in all HTML pages to poll unread message count

document.addEventListener("DOMContentLoaded", () => {
    const token = sessionStorage.getItem("access_token");
    if (!token) return;

    function fetchUnreadCount() {
        fetch('/doctor-chat/unread-count', {
            headers: { 'Authorization': `Bearer ${token}` }
        })
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                updateBadge(data.data.count);
            }
        })
        .catch(err => console.error("Error fetching unread count:", err));
    }

    function updateBadge(count) {
        let badge = document.getElementById("nav-msg-badge");
        if (!badge) {
            // Find the Messages link and append a badge
            const links = document.querySelectorAll("a, .nav-link");
            let msgLink = null;
            links.forEach(l => {
                if (l.textContent.includes("Messages") || l.href.includes("chat-doctor.html")) {
                    msgLink = l;
                }
            });

            if (msgLink) {
                msgLink.style.position = "relative";
                badge = document.createElement("span");
                badge.id = "nav-msg-badge";
                badge.style.position = "absolute";
                badge.style.top = "-5px";
                badge.style.right = "-10px";
                badge.style.background = "#eb2c0a";
                badge.style.color = "white";
                badge.style.borderRadius = "50%";
                badge.style.padding = "2px 6px";
                badge.style.fontSize = "10px";
                badge.style.fontWeight = "bold";
                msgLink.appendChild(badge);
            }
        }

        if (badge) {
            if (count > 0) {
                badge.style.display = "inline-block";
                badge.textContent = count > 9 ? "9+" : count;
            } else {
                badge.style.display = "none";
            }
        }
    }

    // Export so other scripts can manually update badge
    window.updateNotificationBadge = (countToSubtract) => {
        let badge = document.getElementById("nav-msg-badge");
        if (badge && badge.style.display !== "none") {
            let current = parseInt(badge.textContent.replace('+', ''));
            if (!isNaN(current)) {
                current -= countToSubtract;
                updateBadge(Math.max(0, current));
            }
        }
    };

    fetchUnreadCount();
    setInterval(fetchUnreadCount, 10000); // every 10 seconds
});
