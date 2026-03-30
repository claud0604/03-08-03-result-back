/**
 * Cloudflare R2 Client Configuration (S3-compatible)
 */
const { S3Client } = require('@aws-sdk/client-s3');

const r2Client = new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY
    }
});

const R2_CONFIG = {
    bucket: process.env.R2_BUCKET_NAME,
    publicUrl: process.env.R2_PUBLIC_URL || '',
    uploadExpires: parseInt(process.env.SIGNED_URL_UPLOAD_EXPIRES) || 900,
    viewExpires: parseInt(process.env.SIGNED_URL_VIEW_EXPIRES) || 3600
};

module.exports = { r2Client, R2_CONFIG };
