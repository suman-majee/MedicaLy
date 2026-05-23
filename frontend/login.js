let currentTab = 'patient';

function switchTab(tab) {
  currentTab = tab;
  
  // Update buttons
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.remove('active');
  });
  
  // Highlight clicked button
  const tabs = document.querySelectorAll('.tab-btn');
  if(tab === 'patient') {
    tabs[0].classList.add('active');
    document.getElementById('login-submit-btn').textContent = "Login as Patient";
  } else {
    tabs[1].classList.add('active');
    document.getElementById('login-submit-btn').textContent = "Login as Doctor";
  }
  
  // Clear any previous error
  const errorBox = document.getElementById("login-error");
  if (errorBox) errorBox.style.display = "none";
}

document.getElementById("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  
  const errorBox = document.getElementById("login-error");
  if (errorBox) errorBox.style.display = "none";
  
  const payload = {
      role: currentTab,
      email: document.getElementById('email').value,
      password: document.getElementById('password').value
  };
  
  const btn = document.getElementById("login-submit-btn");
  btn.disabled = true;
  btn.textContent = "Logging in...";
  
  try {
      const response = await fetch(`/auth/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
      });
      
      const data = await response.json();
      
      if(response.ok && data.success) {
          // ✅ Store token and full user profile
          sessionStorage.setItem("access_token", data.data.access_token);
          sessionStorage.setItem("user", JSON.stringify(data.data.user));
          // ✅ Go directly to chat — no intermediate forms
          window.location.href = "index.html";
      } else {
          // ✅ Show specific error from API
          if (errorBox) {
              errorBox.textContent = data.message || "Invalid email or password.";
              errorBox.style.display = "block";
          } else {
              alert(data.message || "Login failed");
          }
      }
  } catch (err) {
      // ✅ Descriptive error messages
      const msg = (err.name === "TypeError" && err.message.includes("fetch"))
          ? `Cannot reach the server. Please make sure the backend is running.`
          : "Connection error: " + (err.message || "Unknown error");
      if (errorBox) {
          errorBox.textContent = msg;
          errorBox.style.display = "block";
      } else {
          alert(msg);
      }
  } finally {
      btn.disabled = false;
      btn.textContent = currentTab === 'patient' ? "Login as Patient" : "Login as Doctor";
  }
});
