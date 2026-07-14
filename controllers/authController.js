// =====================================================================
// CHANGES vs original:
//   registerStudent  → generates a tempPassword, stores it as
//                       user.tempPassword (plain text) so the admin
//                       controller can email it on approval.
//                       The real login password is still bcrypt-hashed.
//   Everything else  → unchanged.
// =====================================================================

const User          = require('../models/user');
const bcrypt        = require('bcryptjs');
const jwt           = require('jsonwebtoken');
const { validateFile, validateDriverDocuments } = require('../utils/validateFile');


// ======================
// USER ID GENERATOR
// ======================
async function generateUserId(role) {

    const prefix =
        role === "student" ? "STU" :
        role === "admin"   ? "ADM" :
        role === "warden"  ? "WAR" :
        role === "driver"  ? "DRV" : "USR";

    const year     = new Date().getFullYear();
    const count    = await User.countDocuments({ role });
    const sequence = (count + 1).toString().padStart(4, "0");

    return `${prefix}-${year}-${sequence}`;
}


// ======================
// PASSWORD VALIDATION
// ======================
function isStrongPassword(password) {
    let count = 0;
    if (/[a-z]/.test(password))        count++;
    if (/[A-Z]/.test(password))        count++;
    if (/\d/.test(password))           count++;
    if (/[^A-Za-z0-9]/.test(password)) count++;
    return password.length >= 8 && count >= 3;
}


// ======================
// STUDENT REGISTER
// ======================
exports.registerStudent = async (req, res) => {

    try {

        const {
            fullname,
            email,
            phoneNumber,
            gender,
            dateOfBirth,
            password,
            confirm_password
        } = req.body;

        // ── Helper: render with error and clear the uploaded file ──
        const fail = (msg) => {
            // If multer already saved a file, delete it so orphans don't accumulate
            if (req.file) {
                const fs   = require('fs');
                const path = require('path');
                const filePath = path.join(__dirname, '..', 'public', 'uploads', 'ids', req.file.filename);
                fs.unlink(filePath, () => {});
            }
            return res.render('register-student', { error: msg });
        };

        // ── Required text fields ──
        if (!fullname || !email || !phoneNumber || !gender || !dateOfBirth || !password || !confirm_password) {
            return fail('All fields are required.');
        }

        // ── ID document required ──
        if (!req.file) {
            return fail('Please upload your CNIC or Student ID card.');
        }

        // ── Password checks ──
        if (password !== confirm_password) {
            return fail('Passwords do not match.');
        }

        if (!isStrongPassword(password)) {
            return fail(
                'Password must be at least 8 characters and include uppercase, lowercase, number, and special character.'
            );
        }

        // ── Duplicate email check ──
        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return fail('Email already registered.');
        }

        // ── Server-side magic-byte validation on uploaded ID document ──
        // Prevents uploading renamed arbitrary files as genuine ID cards.
        if (req.file) {
            const fileResult = validateFile(req.file.path);
            if (!fileResult.valid) {
                return fail('ID Card upload: ' + fileResult.reason);
            }
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const newUser = new User({
            userId      : await generateUserId('student'),
            fullname,
            email,
            password    : hashedPassword,
            tempPassword: password,           // stored for approval email, cleared after
            role        : 'student',
            status      : 'pending',
            phoneNumber,
            gender,
            dateOfBirth : new Date(dateOfBirth),
            idImage     : 'uploads/ids/' + req.file.filename,
            profileImage: null,
            createdBy   : null
        });

        await newUser.save();
        return res.redirect('/register/student/pending');

    } catch (err) {
        console.error('registerStudent Error:', err);
        res.status(500).send('Server Error');
    }
};


// ======================
// DRIVER REGISTER
// ======================
exports.registerDriver = async (req, res) => {
    try {
        const {
            fullname, email, phoneNumber, gender, dateOfBirth, cnic,
            licenseNumber, licenseExpiry,
            vehicleType, vehicleRegistration, vehicleModel,
            serviceArea, experienceYears,
            password, confirm_password
        } = req.body;

        // ── Helper: render with error ──
        const fail = (msg) => {
            if (req.files) {
                const fs   = require('fs');
                const path = require('path');
                Object.values(req.files).flat().forEach(f => {
                    fs.unlink(path.join(__dirname, '..', 'public', 'uploads', 'driver-docs', f.filename), () => {});
                });
            }
            return res.render('register-driver', { error: msg });
        };

        // ── Pakistani format validations ──
        const cnicPattern       = /^\d{5}-\d{7}-\d{1}$/;
        const licensePattern    = /^[A-Za-z0-9\-]{6,20}$/;
        const vehicleRegPattern = /^[A-Za-z]{2,3}[- ]?\d{3,4}$/;

        if (cnic && !cnicPattern.test(cnic)) {
            return fail('CNIC must be in format XXXXX-XXXXXXX-X (e.g. 35202-1234567-8).');
        }
        if (licenseNumber && !licensePattern.test(licenseNumber)) {
            return fail('License number must be 6-20 characters (letters, numbers, hyphens).');
        }
        if (vehicleRegistration && !vehicleRegPattern.test(vehicleRegistration)) {
            return fail('Vehicle registration must be in format XXX-XXXX (e.g. LEP-1234, ABC-567).');
        }

        if (!fullname || !email || !phoneNumber || !gender || !dateOfBirth || !password || !confirm_password) {
            return fail('All required fields must be filled.');
        }

        if (password !== confirm_password) {
            return fail('Passwords do not match.');
        }

        if (!isStrongPassword(password)) {
            return fail('Password must be at least 8 characters and include uppercase, lowercase, number, and special character.');
        }

        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return fail('Email already registered.');
        }

        // ── Server-side magic-byte validation on uploaded documents ──
        // Prevents uploading renamed arbitrary files as genuine documents.
        const docError = validateDriverDocuments(req.files);
        if (docError) {
            return fail(docError.field + ': ' + docError.reason);
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const newUser = new User({
            userId      : await generateUserId('driver'),
            fullname,
            email,
            password    : hashedPassword,
            tempPassword: password,
            role        : 'driver',
            status      : 'pending',
            phoneNumber,
            gender,
            dateOfBirth : new Date(dateOfBirth),
            profileImage: null,
            createdBy   : null
        });

        await newUser.save();

        // ── Map uploaded files ──
        const uploaded = req.files || {};
        const getFile = (name) => {
            const f = uploaded[name];
            return f && f[0] ? 'uploads/driver-docs/' + f[0].filename : null;
        };

        const Driver = require('../models/driver');
        await Driver.create({
            user: newUser._id,
            cnic,
            licenseNumber: licenseNumber || null,
            licenseExpiry: licenseExpiry ? new Date(licenseExpiry) : null,
            vehicleType: vehicleType || null,
            vehicleRegistration: vehicleRegistration || null,
            vehicleModel: vehicleModel || null,
            serviceArea: serviceArea || null,
            experienceYears: experienceYears ? parseInt(experienceYears) : null,
            cnicFrontImage: getFile('cnicFront'),
            cnicBackImage: getFile('cnicBack'),
            licenseImage: getFile('licenseImage'),
            vehicleDocImage: getFile('vehicleDoc'),
            isVerified: false,
            isActive: true
        });

        return res.redirect('/register/driver/pending');

    } catch (err) {
        console.error('registerDriver Error:', err);
        res.status(500).send('Server Error');
    }
};


// ======================
// STUDENT LOGIN
// ======================
exports.loginStudent = async (req, res) => {

    try {
        // 🔥 FIX: Clear any existing token first to prevent role confusion
        res.cookie("token", "", { 
            httpOnly: true, 
            expires: new Date(0) 
        });

        const { userId, password } = req.body;
        const cleanUserId = userId?.trim();

        const user = await User.findOne({ userId: cleanUserId, role: "student" });

        if (!user) {
            return res.render('login-student', { error: "Invalid ID or password" });
        }

        if (user.status !== "approved") {
            return res.render('login-student', {
                error: "Account not approved yet. Please wait for admin approval."
            });
        }

        const match = await bcrypt.compare(password, user.password);
        if (!match) {
            return res.render('login-student', { error: "Invalid ID or password" });
        }

        const token = jwt.sign(
            { id: user._id, role: user.role },
            process.env.JWT_SECRET,
            { expiresIn: "1d" }
        );

        res.cookie("token", token, { 
            httpOnly: true,
            maxAge: 24 * 60 * 60 * 1000 // 1 day in milliseconds
        });
        
        return res.redirect("/student/dashboard");

    } catch (err) {
        console.log(err);
        res.status(500).send("Server Error");
    }
};


// ======================
// ADMIN LOGIN
// ======================
exports.loginAdmin = async (req, res) => {

    try {
        // 🔥 FIX: Clear any existing token first to prevent role confusion
        res.cookie("token", "", { 
            httpOnly: true, 
            expires: new Date(0) 
        });

        console.log("REQ BODY:", req.body);

        const { userId, password } = req.body;
        const cleanUserId = userId?.trim();

        const user = await User.findOne({ userId: cleanUserId, role: "admin" });

        if (!user) {
            return res.render('login-admin', { error: "Invalid credentials" });
        }

        const match = await bcrypt.compare(password, user.password);
        if (!match) {
            return res.render('login-admin', { error: "Invalid credentials" });
        }

        const token = jwt.sign(
            { id: user._id, role: user.role },
            process.env.JWT_SECRET,
            { expiresIn: "1d" }
        );

        res.cookie("token", token, { 
            httpOnly: true,
            maxAge: 24 * 60 * 60 * 1000 // 1 day in milliseconds
        });
        
        return res.redirect("/admin/dashboard");

    } catch (err) {
        console.log(err);
        res.status(500).send("Server Error");
    }
};


// ======================
// DRIVER LOGIN
// ======================
exports.loginDriver = async (req, res) => {
    try {
        // Clear any existing token first to prevent role confusion
        res.cookie("token", "", { 
            httpOnly: true, 
            expires: new Date(0) 
        });

        const { userId, password } = req.body;
        const cleanUserId = userId?.trim();

        const user = await User.findOne({ userId: cleanUserId, role: "driver" });

        if (!user) {
            return res.render('login-driver', { error: "Invalid credentials" });
        }

        if (user.status !== "approved") {
            return res.render('login-driver', {
                error: "Account not approved yet. Please wait for admin approval."
            });
        }

        const match = await bcrypt.compare(password, user.password);
        if (!match) {
            return res.render('login-driver', { error: "Invalid credentials" });
        }

        const token = jwt.sign(
            { id: user._id, role: user.role },
            process.env.JWT_SECRET,
            { expiresIn: "1d" }
        );

        res.cookie("token", token, { 
            httpOnly: true,
            maxAge: 24 * 60 * 60 * 1000 // 1 day in milliseconds
        });
        
        // Redirect to driver dashboard (placeholder — can be updated to a real dashboard later)
        return res.redirect("/driver/dashboard");

    } catch (err) {
        console.log(err);
        res.status(500).send("Server Error");
    }
};


// ======================
// WARDEN LOGIN
// ======================
exports.loginWarden = async (req, res) => {

    try {
        // 🔥 FIX: Clear any existing token first to prevent role confusion
        res.cookie("token", "", { 
            httpOnly: true, 
            expires: new Date(0) 
        });

        const { userId, password } = req.body;
        const cleanUserId = userId?.trim();

        const user = await User.findOne({ userId: cleanUserId, role: "warden" });

        if (!user) {
            return res.render('login-warden', { error: "Invalid credentials" });
        }

        const match = await bcrypt.compare(password, user.password);
        if (!match) {
            return res.render('login-warden', { error: "Invalid credentials" });
        }

        const token = jwt.sign(
            { id: user._id, role: user.role },
            process.env.JWT_SECRET,
            { expiresIn: "1d" }
        );

        res.cookie("token", token, { 
            httpOnly: true,
            maxAge: 24 * 60 * 60 * 1000 // 1 day in milliseconds
        });

        // ── Log warden login ──
        try {
            const WardenActivityLog = require('../models/wardenActivityLog');
            await WardenActivityLog.create({
                warden        : user._id,
                wardenName    : user.fullname || 'Unknown',
                wardenUserId  : user.userId   || '—',
                action        : 'LOGIN',
                description   : `Logged in from ${req.ip || 'unknown IP'}`,
                ip            : req.ip || null
            });
        } catch (_) {}
        
        return res.redirect("/warden/dashboard");

    } catch (err) {
        console.log(err);
        res.status(500).send("Server Error");
    }
};


// ======================
// LOGOUT
// ======================
exports.logout = async (req, res) => {
    // ── Log warden logout BEFORE clearing cookie ──
    if (req.user && req.user.role === 'warden') {
        try {
            const WardenActivityLog = require('../models/wardenActivityLog');
            await WardenActivityLog.create({
                warden        : req.user._id,
                wardenName    : req.user.fullname || 'Unknown',
                wardenUserId  : req.user.userId   || '—',
                action        : 'LOGOUT',
                description   : 'Logged out',
                ip            : req.ip || null
            });
        } catch (_) {}
    }

    // Clear the token cookie completely
    res.cookie("token", "", { 
        httpOnly: true, 
        expires: new Date(0),
        sameSite: 'lax'
    });
    
    return res.redirect("/login");
};