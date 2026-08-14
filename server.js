/**
 * APL facefree2026 - Result Page Backend
 * Port: 3083
 * Shares MongoDB (customers) with cust-info and expert backends.
 * Uses Cloudflare R2 for presigned view URLs.
 */
require('dotenv').config();

// 안정화(2026-08): 처리되지 않은 예외/거부로 프로세스가 즉사하는 것을 방지.
// unhandledRejection은 대개 개별 요청의 await 누락 → 로깅만 하고 프로세스 유지.
process.on('unhandledRejection', (reason) => {
    console.error('[unhandledRejection]', (reason && (reason.stack || reason.message)) || reason);
});
// uncaughtException은 상태 불명 → 로깅 후 통제된 종료(PM2가 재시작).
process.on('uncaughtException', (err) => {
    console.error('[uncaughtException]', (err && (err.stack || err.message)) || err);
    setTimeout(() => process.exit(1), 500);
});

const express = require('express');
const cors = require('cors');
const connectDB = require('./config/database');
const { r2Client, R2_CONFIG } = require('./config/r2');
const errorHandler = require('./middleware/errorHandler');

const authRouter = require('./routes/auth');
const resultRouter = require('./routes/result');
const notifyRouter = require('./routes/notify');
const chronicleRouter = require('./routes/chronicle');
const paymentRouter = require('./routes/payment');

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
app.use('/api/payment', paymentRouter);

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
