/**
 * APL facefree2026 - Result Page Backend
 * Port: 3083
 * Shares MongoDB (customers) with cust-info and expert backends.
 * Uses Cloudflare R2 for presigned view URLs.
 */
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const connectDB = require('./config/database');
const { r2Client, R2_CONFIG } = require('./config/r2');
const errorHandler = require('./middleware/errorHandler');

const authRouter = require('./routes/auth');
const resultRouter = require('./routes/result');
const notifyRouter = require('./routes/notify');
const chronicleRouter = require('./routes/chronicle');

const app = express();
const PORT = process.env.PORT || 3083;

// MongoDB
connectDB();

// R2 config log
console.log(`R2 bucket: ${R2_CONFIG.bucket || '(not configured)'}`);

// CORS
app.use(cors({
    origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        if (origin.includes('localhost')) return callback(null, true);
        if (origin.endsWith('.pages.dev')) return callback(null, true);
        if (origin.endsWith('.apls.kr')) return callback(null, true);
        callback(new Error('Blocked by CORS policy.'));
    },
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
}));

app.use(express.json());

// Request logging (development)
if (process.env.NODE_ENV === 'development') {
    app.use((req, res, next) => {
        console.log(`${new Date().toISOString()} ${req.method} ${req.url}`);
        next();
    });
}

// Health check
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        service: 'ff2026-result-backend',
        timestamp: new Date().toISOString()
    });
});

// API routes
app.use('/api/auth', authRouter);
app.use('/api/result', resultRouter);
app.use('/api/notify', notifyRouter);
app.use('/api/chronicle', chronicleRouter);

// 404 handler
app.use((req, res) => {
    res.status(404).json({
        success: false,
        message: 'Resource not found.'
    });
});

// Error handler
app.use(errorHandler);

// Start server
app.listen(PORT, () => {
    console.log(`Result backend running on port ${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});

module.exports = app;
