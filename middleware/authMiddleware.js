const jwt = require("jsonwebtoken");
const User = require("../models/user");

/**
 * BASE AUTHENTICATION - checks if user is logged in
 * Use this for routes accessible by any authenticated user
 */
exports.authMiddleware = async (req, res, next) => {
    try {
        const token = req.cookies.token;

        if (!token) {
            return res.redirect("/login");
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findById(decoded.id);

        if (!user) {
            return res.redirect("/login");
        }

        req.user = user;
        next();

    } catch (err) {
        console.error('Auth Middleware Error:', err);
        return res.redirect("/login");
    }
};

/**
 * ROLE-BASED MIDDLEWARE FACTORY
 * Creates middleware for specific roles
 */
const roleMiddleware = (allowedRoles) => {
    return async (req, res, next) => {
        try {
            const token = req.cookies.token;

            if (!token) {
                return res.redirect("/login");
            }

            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            const user = await User.findById(decoded.id);

            if (!user) {
                return res.redirect("/login");
            }

            // Check if user's role is allowed
            if (!allowedRoles.includes(user.role)) {
                console.log(`Access Denied: ${user.email} (${user.role}) tried to access ${req.originalUrl}`);
                console.log(`User object:`, { id: user._id, name: user.fullname, role: user.role });
                
                // Determine redirect URL based on user's role
                let redirectUrl = '/login';
                if (user.role === 'student') {
                    redirectUrl = '/student/dashboard';
                } else if (user.role === 'admin') {
                    redirectUrl = '/admin/dashboard';
                } else if (user.role === 'warden') {
                    redirectUrl = '/warden/dashboard';
                }

                // Clear the current token to prevent confusion
                res.cookie("token", "", { httpOnly: true, expires: new Date(0) });

                return res.status(403).render('error', {
                    title: 'Access Denied',
                    message: `You are logged in as ${user.fullname} (${user.role}) but trying to access a page meant for ${allowedRoles.join(' or ')}. Please login with the correct account.`,
                    user: user,
                    redirectUrl: redirectUrl,
                    requiredRoles: allowedRoles
                });
            }

            req.user = user;
            next();

        } catch (err) {
            console.error('Role Middleware Error:', err);
            // Clear invalid token
            res.cookie("token", "", { httpOnly: true, expires: new Date(0) });
            return res.redirect("/login");
        }
    };
};

// ======================
// CONVENIENCE MIDDLEWARES
// ======================

exports.adminMiddleware = roleMiddleware(['admin']);
exports.studentMiddleware = roleMiddleware(['student']);
exports.wardenMiddleware = roleMiddleware(['warden']);
exports.staffMiddleware = roleMiddleware(['admin', 'warden']);