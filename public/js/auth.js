// ── Shared password strength checker (matches backend isStrongPassword) ──
window.isStrongPassword = function(password) {
    let count = 0;
    if (/[a-z]/.test(password)) count++;
    if (/[A-Z]/.test(password)) count++;
    if (/\d/.test(password)) count++;
    if (/[^A-Za-z0-9]/.test(password)) count++;
    return password.length >= 8 && count >= 3;
};

// ── Per-condition checklist ──
window.getPasswordConditions = function(password) {
    return {
        length: password.length >= 8,
        lower:  /[a-z]/.test(password),
        upper:  /[A-Z]/.test(password),
        digit:  /\d/.test(password),
        special: /[^A-Za-z0-9]/.test(password)
    };
};

window.getPasswordConditionCount = function(conditions) {
    return (conditions.lower ? 1 : 0) + (conditions.upper ? 1 : 0) + (conditions.digit ? 1 : 0) + (conditions.special ? 1 : 0);
};

window.isPasswordFullyValid = function(password) {
    var c = window.getPasswordConditions(password);
    return c.length && window.getPasswordConditionCount(c) >= 3;
};

// ── Builds an HTML condition checklist string ──
window.passwordConditionsHTML = function(password) {
    var c = window.getPasswordConditions(password);
    var catCount = window.getPasswordConditionCount(c);
    var allMet = c.length && catCount >= 3;
    var items = [
        { key: 'length', label: '8+ characters', met: c.length },
        { key: 'upper',  label: 'Uppercase letter', met: c.upper },
        { key: 'lower',  label: 'Lowercase letter', met: c.lower },
        { key: 'digit',  label: 'Digit', met: c.digit },
        { key: 'special', label: 'Special character', met: c.special },
        { key: 'count',  label: 'At least 3 of 4 types (upper, lower, digit, special)', met: catCount >= 3 }
    ];
    var html = '<div style="font-size:.7rem;line-height:1.6;margin-top:.1rem">';
    items.forEach(function(item) {
        if (allMet) {
            html += '<span style="color:#2E7D32">✓ ' + item.label + '</span><br>';
        } else if (item.met) {
            html += '<span style="color:#2E7D32">✓ ' + item.label + '</span><br>';
        } else {
            html += '<span style="color:#C62828">✗ ' + item.label + '</span><br>';
        }
    });
    html += '</div>';
    return html;
};

// ── Inline hint updater for any password input ──
// Usage: oninput="window.updatePasswordHint('myInputId', 'myHintId')"
window.updatePasswordHint = function(inputId, hintId) {
    var input = document.getElementById(inputId);
    var hint  = document.getElementById(hintId);
    if (!input || !hint) return;
    var val = input.value;
    if (val.length === 0) {
        hint.innerHTML = 'Min 8 chars with at least 3 of: uppercase, lowercase, number, special character.';
        hint.style.color = '#888';
        return false;
    }
    var valid = window.isPasswordFullyValid(val);
    if (valid) {
        hint.innerHTML = '✓ Password meets requirements.';
        hint.style.color = '#2E7D32';
    } else {
        hint.innerHTML = window.passwordConditionsHTML(val);
        hint.style.color = '';
    }
    return valid;
};

// ── Auto-attach to existing password fields ──
(function() {
    var pwInput = document.getElementById('password');
    var stText = document.getElementById('password-strength');
    if (pwInput && stText) {
        pwInput.addEventListener('input', function() {
            var val = pwInput.value;
            if (val.length === 0) {
                stText.innerHTML = '';
                return;
            }
            if (window.isPasswordFullyValid(val)) {
                stText.innerHTML = '<span style="color:#2E7D32;font-weight:600">✓ Strong Password</span>';
            } else {
                stText.innerHTML = window.passwordConditionsHTML(val);
            }
        });
    }
})();

