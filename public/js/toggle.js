const togglePassword = document.querySelectorAll(".password-toggle")[0];

if (togglePassword && passwordInput) {
    togglePassword.addEventListener("click", () => {
        const type = passwordInput.type === "password" ? "text" : "password";
        passwordInput.type = type;

        const icon = togglePassword.querySelector("i");
        icon.classList.toggle("fa-eye");
        icon.classList.toggle("fa-eye-slash");
    });
}


const confirmPasswordInput = document.querySelectorAll(".password-field input")[1];
const toggleCPassword = document.querySelectorAll(".password-toggle")[1];

if (toggleCPassword && confirmPasswordInput) {
    toggleCPassword.addEventListener("click", () => {
        const type = confirmPasswordInput.type === "password" ? "text" : "password";
        confirmPasswordInput.type = type;

        const icon = toggleCPassword.querySelector("i");
        icon.classList.toggle("fa-eye");
        icon.classList.toggle("fa-eye-slash");
    });
}