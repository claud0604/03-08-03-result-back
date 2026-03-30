/**
 * Chronicle Routes
 * Provides version history for customer diagnosis results.
 */
const express = require('express');
const router = express.Router();
const Chronicle = require('../models/Chronicle');
const authCustomer = require('../middleware/authCustomer');

/**
 * GET /api/chronicle/:customerId
 * Get all chronicle versions for a customer (summary list).
 */
router.get('/:customerId', authCustomer, async (req, res, next) => {
    try {
        const { customerId } = req.params;

        if (req.customerId !== customerId) {
            return res.status(403).json({ success: false, message: 'Access denied.' });
        }

        const chronicles = await Chronicle.find({ customerId })
            .select('version versionType versionLabel changes createdAt')
            .sort({ version: -1 })
            .lean();

        res.json({
            success: true,
            data: chronicles.map(c => ({
                version: c.version,
                versionType: c.versionType,
                versionLabel: c.versionLabel,
                changeCount: c.changes ? c.changes.length : 0,
                createdAt: c.createdAt
            }))
        });
    } catch (error) {
        next(error);
    }
});

/**
 * GET /api/chronicle/:customerId/:version
 * Get a specific chronicle version with full snapshot.
 */
router.get('/:customerId/:version', authCustomer, async (req, res, next) => {
    try {
        const { customerId, version } = req.params;

        if (req.customerId !== customerId) {
            return res.status(403).json({ success: false, message: 'Access denied.' });
        }

        const chronicle = await Chronicle.findOne({
            customerId,
            version: parseInt(version)
        }).lean();

        if (!chronicle) {
            return res.status(404).json({
                success: false,
                message: 'Chronicle version not found.'
            });
        }

        res.json({
            success: true,
            data: chronicle
        });
    } catch (error) {
        next(error);
    }
});

module.exports = router;
