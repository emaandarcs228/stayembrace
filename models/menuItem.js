const mongoose = require('mongoose');

const menuItemSchema = new mongoose.Schema({

    menu: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Menu',
        required: true
    },

    name: {
        type: String,
        required: true
    },

    price: {
        type: Number,
        required: true
    },

    isAvailable: {
        type: Boolean,
        default: true
    },

    image: String,

    description: String

}, { timestamps: true });

module.exports = mongoose.model('MenuItem', menuItemSchema);