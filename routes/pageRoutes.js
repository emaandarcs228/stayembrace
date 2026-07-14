const express = require('express');
const router = express.Router();

// GENERAL
router.get('/', (req, res) => res.render('home'));
router.get('/login', (req, res) => res.render('login'));
router.get('/register', (req, res) => res.render('register'));

// INFO PAGES
router.get('/about', (req, res) => res.render('about'));
router.get('/dormitories', (req, res) => res.render('dormitories'));
router.get('/rules', (req, res) => res.render('rules'));
router.get('/contact', (req, res) => res.render('contact'));
router.get('/services', (req, res) => res.render('services'));

// STUDENT
router.get('/login/student', (req, res) =>
    res.render('login-student', { error: null })
);

router.get('/register/student', (req, res) =>
    res.render('register-student', { error: null })
);

router.get('/register/driver', (req, res) =>
    res.render('register-driver', { error: null })
);

// ADMIN
router.get('/login/admin', (req, res) =>
    res.render('login-admin', { error: null })
);

// WARDEN
router.get('/login/warden', (req, res) =>
    res.render('login-warden', { error: null })
);

// DRIVER
router.get('/login/driver', (req, res) =>
    res.render('login-driver', { error: null })
);

module.exports = router;