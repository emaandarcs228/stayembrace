const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({

    userId: {
        type     : String,
        required : true,
        unique   : true
    },

    fullname: {
        type     : String,
        required : true
    },

    email: {
        type     : String,
        unique   : true,
        required : true
    },

    password: {
        type     : String,
        required : true
    },

    // Stores the plain-text password entered at registration.
    // Used ONCE — emailed on admin approval, then cleared from the DB.
    tempPassword: {
        type    : String,
        default : null,
        select  : true
    },

    role: {
        type     : String,
        enum     : ['student', 'admin', 'warden'],
        required : true
    },

    status: {
        type    : String,
        enum    : ['pending', 'approved', 'rejected'],
        default : 'pending'
    },

    phoneNumber: {
        type    : String,
        default : null
    },

    profileImage: {
        type    : String,
        default : null
    },

    // ── Student only — uploaded at registration, reviewed by admin ──
    // Stays null for admin / warden accounts (created internally).
    idImage: {
        type    : String,
        default : null
    },

    gender: {
        type    : String,
        enum    : ['male', 'female'],
        default : null
    },

    dateOfBirth: {
        type    : Date,
        default : null
    },

    createdBy: {
        type    : String,
        ref     : 'User',
        default : 'admin'
    }

}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);