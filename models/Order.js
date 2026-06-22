const mongoose = require('mongoose');

const OrderSchema = new mongoose.Schema({
    customerId: { type: String, required: true, index: true },
    type: { type: String, required: true }, // 'rerecommend'
    paymentId: { type: String, required: true, unique: true },
    amount: { type: Number, required: true },
    status: { type: String, default: 'pending' }, // 'paid' | 'failed'
    pgProvider: { type: String },
    paidAt: { type: Date }
}, { timestamps: true });

module.exports = mongoose.model('Order', OrderSchema, 'orders');
