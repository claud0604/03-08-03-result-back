/**
 * CatalogItem Model - Product catalog (shared collection, managed by 04-update-mgmt)
 * Result service only READS this collection to check discontinued status.
 */
const mongoose = require('mongoose');

const catalogItemSchema = new mongoose.Schema({
    // Classification
    category: {
        type: String,
        enum: ['cosmetics', 'fashion', 'goods', 'fragrance'],
        required: true,
        index: true
    },
    subcategory: {
        type: String,
        required: true,
        index: true
    },

    // Product Info
    name: { type: String, required: true },
    brand: { type: String, default: '' },
    imageUrl: { type: String, default: '' },
    purchaseLinks: [{
        store: { type: String },
        url: { type: String }
    }],

    // Color Suitability
    suitableColorTypes: [{ type: String }],
    colorModifiers: [{ type: String }],

    // Tone & Image Keywords
    tone: [{ type: String }],
    imageKeywords: [{ type: String }],

    // Trend Info
    trendYear: { type: Number, default: 2026 },
    trendSeason: {
        type: String,
        enum: ['spring', 'summer', 'autumn', 'winter', ''],
        default: ''
    },

    // Customer matching keywords
    matchKeywords: [{ type: String }],

    // Discontinuation
    isDiscontinued: { type: Boolean, default: false },
    discontinuedAt: { type: Date, default: null },
    replacementItemId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'CatalogItem',
        default: null
    },
    replacementItemIds: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'CatalogItem'
    }],
    discontinuedReason: { type: String, default: '' },

    // Admin
    notes: { type: String, default: '' },
    isActive: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 }
}, {
    timestamps: true,
    collection: '04_catalog_items'
});

catalogItemSchema.index({ isDiscontinued: 1 });

module.exports = mongoose.model('CatalogItem', catalogItemSchema);
