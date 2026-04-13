/**
 * Result Routes
 * Returns customer diagnosis data with R2 presigned URLs.
 */
const express = require('express');
const router = express.Router();
const Customer = require('../models/Customer');
const authCustomer = require('../middleware/authCustomer');
const { r2Client, R2_CONFIG } = require('../config/r2');
const { GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

/**
 * Recursively walk an object and collect all R2/storage keys.
 * Skips data URIs, color hex codes, and external HTTP URLs.
 */
function collectStorageKeys(obj, keys = []) {
    if (!obj || typeof obj !== 'object') return keys;

    for (const [key, val] of Object.entries(obj)) {
        if (typeof val === 'string' && val && val.includes('/')) {
            if (val.startsWith('data:') || val.startsWith('#')) {
                // skip data URIs and color codes
            } else if (!val.startsWith('http')) {
                keys.push(val);
            }
        } else if (Array.isArray(val)) {
            val.forEach(item => {
                if (typeof item === 'string' && item && item.includes('/')) {
                    if (item.startsWith('data:') || item.startsWith('#')) {
                        // skip
                    } else if (!item.startsWith('http')) {
                        keys.push(item);
                    }
                } else if (typeof item === 'object') {
                    collectStorageKeys(item, keys);
                }
            });
        } else if (typeof val === 'object') {
            collectStorageKeys(val, keys);
        }
    }
    return keys;
}

/**
 * Convert R2 keys to URLs.
 * - 02-expert/ prefix keys → CDN public URL (no signing needed)
 * - Other keys → presigned URL
 */
async function resolveR2Urls(storageKeys) {
    const urlMap = {};
    if (!storageKeys.length) return urlMap;

    const uniqueKeys = [...new Set(storageKeys)];
    const cdnBase = R2_CONFIG.publicUrl;
    const PRESET_PREFIX = '02-expert/';

    const cdnKeys = [];
    const signKeys = [];
    uniqueKeys.forEach(key => {
        if (cdnBase && key.startsWith(PRESET_PREFIX)) {
            cdnKeys.push(key);
        } else {
            signKeys.push(key);
        }
    });

    // CDN keys → direct URL (fast)
    cdnKeys.forEach(key => {
        urlMap[key] = cdnBase + '/' + key;
    });

    // Remaining keys → presigned URL
    const results = await Promise.allSettled(
        signKeys.map(async (key) => {
            const command = new GetObjectCommand({
                Bucket: R2_CONFIG.bucket,
                Key: key
            });
            const url = await getSignedUrl(r2Client, command, {
                expiresIn: R2_CONFIG.viewExpires
            });
            return { key, url };
        })
    );

    results.forEach(result => {
        if (result.status === 'fulfilled') {
            urlMap[result.value.key] = result.value.url;
        }
    });

    return urlMap;
}

/**
 * GET /api/result/:customerId
 * Get full diagnosis result with resolved image URLs.
 */
router.get('/:customerId', authCustomer, async (req, res, next) => {
    try {
        const { customerId } = req.params;

        if (req.customerId !== customerId) {
            return res.status(403).json({
                success: false,
                message: 'Access denied.'
            });
        }

        const customer = await Customer.findOne({ customerId }).select('-__v -aiDiagnosis.rawGeminiResponse').lean();

        if (!customer) {
            return res.status(404).json({
                success: false,
                message: 'Customer not found.'
            });
        }

        if (customer.meta.status !== 'completed') {
            return res.status(403).json({
                success: false,
                message: 'Diagnosis results are not yet available.'
            });
        }

        // Collect all storage keys from customer data
        const storageKeys = collectStorageKeys({
            customerPhotos: customer.customerPhotos,
            colorDiagnosis: customer.colorDiagnosis,
            faceAnalysis: customer.faceAnalysis,
            bodyAnalysis: customer.bodyAnalysis,
            styling: customer.styling
        });

        // Resolve keys to presigned URLs
        const imageUrls = await resolveR2Urls(storageKeys);

        res.json({
            success: true,
            data: {
                customerInfo: {
                    name: customer.customerInfo.name,
                    gender: customer.customerInfo.gender
                },
                customerPhotos: customer.customerPhotos,
                colorDiagnosis: customer.colorDiagnosis,
                faceAnalysis: customer.faceAnalysis,
                bodyAnalysis: customer.bodyAnalysis,
                styling: customer.styling
            },
            imageUrls
        });
    } catch (error) {
        next(error);
    }
});

module.exports = router;
