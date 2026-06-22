const express = require('express');
const router = express.Router();
const Order = require('../models/Order');
const Customer = require('../models/Customer');
const authCustomer = require('../middleware/authCustomer');

// POST /api/payment/confirm
// 포트원(토스페이먼츠 채널) V2 결제 검증 후 orders 기록 + 고객 재추천 대기 표시
router.post('/confirm', authCustomer, async (req, res) => {
    const { paymentId, customerId, amount } = req.body;

    if (!paymentId || !customerId || !amount) {
        return res.status(400).json({ success: false, message: 'Missing required fields.' });
    }

    if (!process.env.PORTONE_API_SECRET) {
        console.error('[Payment] PORTONE_API_SECRET not set');
        return res.status(500).json({ success: false, message: 'Payment service not configured.' });
    }

    try {
        // 포트원 V2 결제 조회 (Node 18+ 내장 fetch)
        const portoneRes = await fetch(
            `https://api.portone.io/payments/${encodeURIComponent(paymentId)}`,
            { headers: { Authorization: `PortOne ${process.env.PORTONE_API_SECRET}` } }
        );

        if (!portoneRes.ok) {
            const errBody = await portoneRes.text();
            console.error('[Payment] PortOne API error:', portoneRes.status, errBody);
            return res.status(400).json({ success: false, message: 'Payment verification failed.' });
        }

        const payment = await portoneRes.json();

        // 금액 위변조 방지
        if (payment.amount.total !== amount) {
            console.error('[Payment] Amount mismatch:', payment.amount.total, '!==', amount);
            return res.status(400).json({ success: false, message: 'Amount mismatch.' });
        }

        // 결제 완료 상태 확인
        if (payment.status !== 'PAID') {
            return res.status(400).json({ success: false, message: `Payment not completed. status=${payment.status}` });
        }

        // 중복 처리 방지
        const existing = await Order.findOne({ paymentId });
        if (existing) {
            return res.json({ success: true, orderId: existing._id, duplicate: true });
        }

        const order = new Order({
            customerId,
            type: 'rerecommend',
            paymentId,
            amount: payment.amount.total,
            status: 'paid',
            pgProvider: 'tosspayments',
            paidAt: payment.paidAt ? new Date(payment.paidAt) : new Date()
        });
        await order.save();

        // Mark customer as awaiting re-recommendation so experts can pick it up
        await Customer.updateOne(
            { customerId },
            {
                $set: {
                    'reRecommend.status': 'pending',
                    'reRecommend.requestedAt': new Date(),
                    'reRecommend.completedAt': null,
                    'reRecommend.orderId': String(order._id)
                }
            }
        );

        return res.json({ success: true, orderId: order._id });
    } catch (err) {
        console.error('[Payment] confirm error:', err.message);
        return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
});

module.exports = router;
