/**
 * Result Routes
 * Returns customer diagnosis data with R2 presigned URLs.
 */
const express = require('express');
const router = express.Router();
const Customer = require('../models/Customer');
const AppSettings = require('../models/AppSettings');
const CatalogItem = require('../models/CatalogItem');
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
    const CDN_PREFIXES = ['02-expert/', '04-update-mgmt/', 'catalog/'];

    const cdnKeys = [];
    const signKeys = [];
    uniqueKeys.forEach(key => {
        if (cdnBase && CDN_PREFIXES.some(p => key.startsWith(p))) {
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
 * Image-making completion score.
 * Rules live server-side so future dynamics (time decay, re-photo skin-tone
 * matching) can roll out without a frontend deploy.
 */
const SCORE_RULES = { color: 60, body: 30, inner: 10 };

function computeImageMakingScore(customer) {
    let score = 0;
    const breakdown = { color: false, body: false, inner: false };
    if (customer.colorDiagnosis && customer.colorDiagnosis.type) {
        score += SCORE_RULES.color;
        breakdown.color = true;
    }
    if (customer.bodyAnalysis && customer.bodyAnalysis.skeletonType) {
        score += SCORE_RULES.body;
        breakdown.body = true;
    }
    return { score, breakdown, max: 100 };
}

/**
 * Collect catalogItemIds from the customer's catalog recommendations and
 * return the ids of items that are now discontinued.
 */
async function findDiscontinuedItemIds(customer) {
    const recs = (customer.colorDiagnosis && customer.colorDiagnosis.catalogRecommendations) || {};
    const ids = [];
    ['shadowBlush', 'lip'].forEach(group => {
        (recs[group] || []).forEach(item => {
            if (item && item.catalogItemId) ids.push(item.catalogItemId);
        });
    });
    if (!ids.length) return [];

    try {
        const validIds = ids.filter(id => /^[0-9a-fA-F]{24}$/.test(id));
        if (!validIds.length) return [];
        const discontinued = await CatalogItem.find({
            _id: { $in: validIds },
            isDiscontinued: true
        }).select('_id').lean();
        return discontinued.map(d => String(d._id));
    } catch (e) {
        console.error('[Result] discontinued lookup error:', e.message);
        return [];
    }
}

/**
 * Enrich the customer's catalog recommendations with up-to-date purchaseLinks
 * (affiliate links) looked up live from the catalog — update-mgmt에서 링크를
 * 갱신하면 결과 페이지에 즉시 반영된다.
 */
async function enrichPurchaseLinks(customer) {
    const recs = customer.colorDiagnosis && customer.colorDiagnosis.catalogRecommendations;
    if (!recs) return;
    const ids = [];
    ['shadowBlush', 'lip'].forEach(group => {
        (recs[group] || []).forEach(item => {
            if (item && item.catalogItemId && /^[0-9a-fA-F]{24}$/.test(item.catalogItemId)) {
                ids.push(item.catalogItemId);
            }
        });
    });
    if (!ids.length) return;

    try {
        const items = await CatalogItem.find({ _id: { $in: ids } })
            .select('_id purchaseLinks').lean();
        const linkMap = {};
        items.forEach(i => { linkMap[String(i._id)] = i.purchaseLinks || []; });
        ['shadowBlush', 'lip'].forEach(group => {
            (recs[group] || []).forEach(item => {
                if (item && item.catalogItemId) {
                    item.purchaseLinks = linkMap[String(item.catalogItemId)] || [];
                }
            });
        });
    } catch (e) {
        console.error('[Result] purchaseLinks enrich error:', e.message);
    }
}

/**
 * GET /api/result/:customerId/branding
 * Returns partner branding info (logo + bgColor) without auth.
 * Called on page load before intro animation to apply partner logos.
 */
router.get('/:customerId/branding', async (req, res, next) => {
    try {
        const { customerId } = req.params;

        const customer = await Customer.findOne({ customerId })
            .select('customerInfo.partner')
            .lean();

        if (!customer) {
            return res.json({ success: true, partnerConfig: null });
        }

        const partnerCode = customer.customerInfo.partner || '';
        if (!partnerCode) {
            return res.json({ success: true, partnerConfig: null });
        }

        let partnerConfig = null;
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
            console.error('[Branding] Partner config lookup error:', e.message);
        }

        res.json({ success: true, partnerConfig });
    } catch (error) {
        next(error);
    }
});

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

        // Debug: log catalog data availability
        const cd = customer.colorDiagnosis || {};
        console.log('[Result] catalogRecommendations:', JSON.stringify({
            shadowBlush: (cd.catalogRecommendations?.shadowBlush || []).length,
            lip: (cd.catalogRecommendations?.lip || []).length,
            sampleShadow: cd.catalogRecommendations?.shadowBlush?.[0] || null
        }));
        console.log('[Result] productImages:', JSON.stringify({
            shadowBlush: (cd.productImages?.shadowBlush || []).length,
            lip: (cd.productImages?.lip || []).length,
            sampleShadow: cd.productImages?.shadowBlush?.[0] || null
        }));

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

        // Image-making completion score + discontinued product check
        const imageMakingScore = computeImageMakingScore(customer);
        const discontinuedItemIds = await findDiscontinuedItemIds(customer);
        await enrichPurchaseLinks(customer);

        // Resolve partner config if customer has a partner assigned
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
                console.error('[Result] Partner config lookup error:', e.message);
            }
        }

        res.json({
            success: true,
            data: {
                customerInfo: {
                    name: customer.customerInfo.name,
                    gender: customer.customerInfo.gender,
                    email: customer.customerInfo.email || '',
                    phone: customer.customerInfo.phone || '',
                    partner: partnerCode
                },
                customerPhotos: customer.customerPhotos,
                colorDiagnosis: customer.colorDiagnosis,
                faceAnalysis: customer.faceAnalysis,
                bodyAnalysis: customer.bodyAnalysis,
                styling: customer.styling
            },
            imageUrls,
            partnerConfig,
            imageMakingScore,
            discontinuedItemIds,
            reRecommend: { status: (customer.reRecommend && customer.reRecommend.status) || 'none' }
        });
    } catch (error) {
        next(error);
    }
});

module.exports = router;
