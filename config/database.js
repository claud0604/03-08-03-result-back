/**
 * MongoDB Atlas Connection
 * 안정화(2026-08): 초기 연결 실패 시 프로세스를 죽이지 않고 백오프 재시도,
 * 운영 중 끊김은 mongoose 자동 재연결 + 이벤트 로깅으로 감지한다.
 */
const mongoose = require('mongoose');

const MONGO_OPTIONS = {
    serverSelectionTimeoutMS: 10000, // 서버 선택 10초 내 실패 판정 (무한 대기 방지)
    socketTimeoutMS: 45000,
    maxPoolSize: 10,
    minPoolSize: 1,
};

// 연결 상태 이벤트 로깅 (끊김/재연결 가시화)
mongoose.connection.on('disconnected', () => {
    console.warn('[MongoDB] disconnected — 자동 재연결 시도 중');
});
mongoose.connection.on('reconnected', () => {
    console.log('[MongoDB] reconnected');
});
mongoose.connection.on('error', (err) => {
    console.error('[MongoDB] connection error:', err.message);
});

const connectDB = async () => {
    // 초기 연결 실패 시 process.exit 대신 백오프 재시도 (PM2 재시작 루프 방지)
    for (let attempt = 1; ; attempt++) {
        try {
            const conn = await mongoose.connect(process.env.MONGODB_URI, MONGO_OPTIONS);
            console.log(`MongoDB connected: ${conn.connection.host} / ${conn.connection.name}`);
            return conn;
        } catch (error) {
            const wait = Math.min(30000, attempt * 3000);
            console.error(`MongoDB connection failed (attempt ${attempt}): ${error.message} — ${wait}ms 후 재시도`);
            await new Promise((r) => setTimeout(r, wait));
        }
    }
};

module.exports = connectDB;
