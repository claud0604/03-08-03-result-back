/**
 * AppSettings Model - Flexible configuration storage
 * Collection: app_settings
 */
const mongoose = require('mongoose');

const appSettingsSchema = new mongoose.Schema({
    type: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    data: {
        type: mongoose.Schema.Types.Mixed,
        default: {}
    },
    updatedAt: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true,
    collection: 'app_settings'
});

module.exports = mongoose.model('AppSettings', appSettingsSchema);
