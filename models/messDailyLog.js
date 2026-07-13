const mongoose = require('mongoose');
const messLogSchema = new mongoose.Schema({

    date: {
        type: Date,
        required: true
    },

    menu: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Menu'
    },

    availableItems: [
        {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'MenuItem'
        }
    ],

    updatedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User' // Warden
    }

}, { timestamps: true });

module.exports = mongoose.model('MessLog', messLogSchema);