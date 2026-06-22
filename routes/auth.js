/**
 * Customer Authentication Routes
 * Verifies customer identity using customerId + phone last 4 digits.
 */
const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const Customer = require('../models/Customer');
const AppSettings = require('../models/AppSettings');
const { R2_CONFIG } = require('../config/r2');

// Login throttling: lock after N wrong attempts for a fixed window.
const MAX_FAILED_ATTEMPTS = 5;
const LOCK_DURATION_MS = 30 * 60 * 1000; // 30 minutes

/**
 * POST /api/auth/verify
 * Authenticate customer with customerId + phone last 4 digits
 */
router.post('/verify', async (req, res, next) => {
    try {
        const { customerId, phoneLast4 } = req.body;

        if (!customerId || !phoneLast4) {
            return res.status(400).json({
                success: false,
                message: 'Customer ID and phone last 4 digits are required.'
            });
        }

        if (!/^\d{4}$/.test(phoneLast4)) {
            return res.status(400).json({
                success: false,
                message: 'Phone last 4 digits must be exactly 4 numbers.'
            });
        }

        const customer = await Customer.findOne({ customerId });

        if (!customer) {
            return res.status(404).json({
                success: false,
                message: 'Customer not found.'
            });
        }

        // Check if account is currently locked from too many failed attempts
        const now = Date.now();
        if (customer.authSecurity && customer.authSecurity.lockedUntil &&
            customer.authSecurity.lockedUntil.getTime() > now) {
            const lockedMinutes = Math.ceil(
                (customer.authSecurity.lockedUntil.getTime() - now) / 60000
            );
            return res.status(429).json({
                success: false,
                locked: true,
                lockedMinutes,
                message: 'Too many failed attempts. Please try again later.'
            });
        }

        // Check if diagnosis is published
        if (customer.meta.status !== 'completed') {
            return res.status(403).json({
                success: false,
                message: 'Diagnosis results are not yet available.'
            });
        }

        // Extract last 4 digits from stored phone (strip non-digits)
        const storedDigits = customer.customerInfo.phone.replace(/\D/g, '');
        const storedLast4 = storedDigits.slice(-4);

        if (phoneLast4 !== storedLast4) {
            // Wrong code: increment failure counter and lock if threshold reached.
            const failedAttempts = ((customer.authSecurity && customer.authSecurity.failedAttempts) || 0) + 1;
            const update = { 'authSecurity.failedAttempts': failedAttempts };
            let locked = false;
            let lockedMinutes = 0;

            if (failedAttempts >= MAX_FAILED_ATTEMPTS) {
                update['authSecurity.lockedUntil'] = new Date(now + LOCK_DURATION_MS);
                locked = true;
                lockedMinutes = Math.ceil(LOCK_DURATION_MS / 60000);
            }
            await Customer.updateOne({ customerId }, { $set: update });

            if (locked) {
                return res.status(429).json({
                    success: false,
                    locked: true,
                    lockedMinutes,
                    message: 'Too many failed attempts. Please try again later.'
                });
            }
            return res.status(401).json({
                success: false,
                remainingAttempts: MAX_FAILED_ATTEMPTS - failedAttempts,
                message: 'Invalid credentials.'
            });
        }

        // Correct code: clear any failure counter / lock
        if (customer.authSecurity &&
            (customer.authSecurity.failedAttempts || customer.authSecurity.lockedUntil)) {
            await Customer.updateOne(
                { customerId },
                { $set: { 'authSecurity.failedAttempts': 0, 'authSecurity.lockedUntil': null } }
            );
        }

        // Issue JWT
        const token = jwt.sign(
            { customerId: customer.customerId },
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
        );

        // Resolve partner config
        let partnerConfig = null;
        const partnerCode = customer.customerInfo.partner || '';
        if (partnerCode) {
            try {
                const settings = await AppSettings.findOne({ type: 'partners' });
                if (settings && settings.data && settings.data.partners) {
                    const match = settings.data.partners.find(p => p.code === partnerCode);
                    if (match) {
                        partnerConfig = {
                            name: match.name,
                            logoUrl: match.logoKey ? (R2_CONFIG.publicUrl + '/' + match.logoKey) : '',
                            bgColor: match.bgColor || ''
                        };
                    }
                }
            } catch (e) {
                console.error('[Auth] Partner config lookup error:', e.message);
            }
        }

        res.json({
            success: true,
            token,
            customer: {
                name: customer.customerInfo.name,
                customerId: customer.customerId,
                partner: partnerCode
            },
            partnerConfig
        });
    } catch (error) {
        next(error);
    }
});

module.exports = router;
