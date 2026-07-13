const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
require('dotenv').config();

const connectDB = require('./config/db');

const app = express();
const PORT = process.env.PORT || 3000;

// DATABASE
connectDB();

const { schedule: hostelSchedule } = require('./jobs/hostelFeeJob');
const { schedule: attendanceSchedule } = require('./jobs/attendanceEscalationJob');
const { schedule: leaveSchedule } = require('./jobs/leaveEscalationJob');
const { schedule: laundrySchedule } = require('./jobs/laundryReminderJob');
hostelSchedule();
attendanceSchedule();
leaveSchedule();
laundrySchedule();

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());

// Static files
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'public/uploads')));

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Routes
const authRoutes = require('./routes/authRoutes');
const pageRoutes = require('./routes/pageRoutes');
const adminRoutes = require('./routes/adminRoutes');
const studentRoutes = require('./routes/studentRoutes');
const wardenRoutes = require('./routes/wardenRoutes'); 

app.use('/', pageRoutes);
app.use('/', authRoutes);
app.use('/admin', adminRoutes);
app.use('/student', studentRoutes);
app.use('/warden', wardenRoutes);

// 404 handler
app.use((req, res) => {
    res.status(404).send('Page Not Found');
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});