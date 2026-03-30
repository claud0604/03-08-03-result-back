/**
 * Chronicle Model - Image Chronicle (Immutable Version History)
 * Each version captures the full recommendation state at a point in time.
 * Previous versions are NEVER modified.
 */
const mongoose = require('mongoose');

const changeSchema = new mongoose.Schema({
    field: { type: String, required: true },
    action: { type: String, enum: ['added', 'removed', 'replaced', 'updated'], required: true },
    oldValue: { type: mongoose.Schema.Types.Mixed, default: null },
    newValue: { type: mongoose.Schema.Types.Mixed, default: null },
    reason: { type: String, default: '' }
}, { _id: false });

const chronicleSchema = new mongoose.Schema({
    customerId: {
        type: String,
        required: true,
        index: true
    },

    version: {
        type: Number,
        required: true,
        min: 1
    },

    versionType: {
        type: String,
        enum: ['initial', 'update', 'event'],
        default: 'initial'
    },

    versionLabel: {
        type: String,
        default: ''
    },

    snapshot: {
        colorDiagnosis: { type: mongoose.Schema.Types.Mixed, default: {} },
        faceAnalysis: { type: mongoose.Schema.Types.Mixed, default: {} },
        bodyAnalysis: { type: mongoose.Schema.Types.Mixed, default: {} },
        styling: { type: mongoose.Schema.Types.Mixed, default: {} }
    },

    changes: [changeSchema],

    updatePackageId: {
        type: mongoose.Schema.Types.ObjectId,
        default: null
    }
}, {
    timestamps: true,
    collection: 'chronicles'
});

chronicleSchema.index({ customerId: 1, version: -1 });
chronicleSchema.index({ customerId: 1, version: 1 }, { unique: true });

module.exports = mongoose.model('Chronicle', chronicleSchema);
