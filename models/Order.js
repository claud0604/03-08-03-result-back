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

// 별도 컬렉션 사용: cust-info의 'orders'(orderId unique)와 스키마가 달라 충돌하므로 분리
module.exports = mongoose.model('Order', OrderSchema, 'rerecommend_orders');
