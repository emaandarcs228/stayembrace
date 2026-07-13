const passwordInput = document.getElementById("password");
const strengthText = document.getElementById("password-strength");

function isStrongPassword(password) {
    let count = 0;

    if (/[a-z]/.test(password)) count++;
    if (/[A-Z]/.test(password)) count++;
    if (/\d/.test(password)) count++;
    if (/[^A-Za-z0-9]/.test(password)) count++;

    return password.length >= 8 && count >= 3;
}

// ✅ Prevent crash if element not found
if (passwordInput && strengthText) {
    passwordInput.addEventListener("input", () => {
        const value = passwordInput.value;

        if (value.length === 0) {
            strengthText.textContent = "";
            return;
        }

        if (isStrongPassword(value)) {
            strengthText.textContent = "Strong Password";
            strengthText.style.color = "green";
        } else {
            strengthText.textContent = "Weak Password";
            strengthText.style.color = "red";
        }
    });
}

