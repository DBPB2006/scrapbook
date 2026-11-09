require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { createProxyMiddleware } = require('http-proxy-middleware');
let metrics;
try {
    metrics = require('./shared/metrics');
} catch (e) {
    metrics = require('../shared/metrics');
}

const app = express();
const PORT = process.env.PORT || 3090;
const isProduction = process.env.NODE_ENV === 'production';
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
    console.error('FATAL: JWT_SECRET environment variable is missing.');
    process.exit(1);
}


// Dynamic CORS configuration (Synopsis §8.4 / §9 Table 6)
const defaultAllowedOrigins = [
    'http://localhost:3000',
    'http://localhost:3090',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:3090',
    'http://localhost:8080',
    'http://127.0.0.1:8080',
    'http://localhost:5500',
    'http://127.0.0.1:5500'
];

const normalizeOrigin = (value) => {
    if (typeof value !== 'string') return '';
    return value.trim().replace(/\/+$/, '');
};

if (process.env.FRONTEND_ORIGIN && process.env.FRONTEND_ORIGIN.includes('*')) {
    console.warn('Gateway CORS: Wildcard origin entries in FRONTEND_ORIGIN are disallowed and will be ignored.');
}

const getAllowedOrigins = () => {
    const origins = [...defaultAllowedOrigins];
    if (process.env.FRONTEND_ORIGIN) {
        process.env.FRONTEND_ORIGIN.split(',').forEach(rawOrigin => {
            const normalized = normalizeOrigin(rawOrigin);
            // Explicitly disallow wildcard origins and unreplaced placeholders
            if (!normalized || normalized.includes('*') || normalized.includes('<') || normalized.includes('>')) {
                return;
            }
            if (!/^https?:\/\//i.test(normalized)) {
                return;
            }
            if (!origins.includes(normalized)) {
                origins.push(normalized);
            }
        });
    }
    return origins;
};

app.use(cors({
    origin: function (origin, callback) {
        // Allow requests with no origin (health probes, curl, server-to-server)
        if (!origin) return callback(null, true);
        const normalizedRequestOrigin = normalizeOrigin(origin);
        if (!normalizedRequestOrigin || normalizedRequestOrigin.includes('*')) {
            return callback(null, false);
        }
        const allowed = getAllowedOrigins();
        if (allowed.includes(normalizedRequestOrigin)) {
            return callback(null, true);
        }
        return callback(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    exposedHeaders: ['Authorization'],
    maxAge: 86400
}));

app.use(metrics.metricsMiddleware);
app.get('/metrics', metrics.metricsEndpoint);

// Serve static pages and uploads (volume-mounted in Docker)
app.use(express.static('pages'));
app.use('/uploads', express.static(process.env.UPLOAD_DIR || (process.env.STORAGE_PATH ? path.join(process.env.STORAGE_PATH, 'Uploads') : path.join(__dirname, 'uploads/'))));

// Security: Prevent external clients from accessing internal service endpoints
app.use('/api/internal', (req, res) => {
    res.status(403).json({ error: 'Access denied: Internal endpoints cannot be accessed externally.' });
});

// Rate limiting on sensitive authentication routes (Synopsis §8.4 Table 5 Scenario 7)
const authRateLimitMap = new Map();
const AUTH_WINDOW_MS = 15 * 60 * 1000; // 15-minute window
const AUTH_MAX_ATTEMPTS = 15; // Max 15 attempts per 15 minutes per IP

const authRateLimiter = (req, res, next) => {
    if (req.method !== 'POST') return next();

    const clientIp = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const record = authRateLimitMap.get(clientIp) || { count: 0, resetTime: now + AUTH_WINDOW_MS };

    if (now > record.resetTime) {
        record.count = 1;
        record.resetTime = now + AUTH_WINDOW_MS;
    } else {
        record.count++;
    }
    authRateLimitMap.set(clientIp, record);

    res.setHeader('X-RateLimit-Limit', AUTH_MAX_ATTEMPTS);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, AUTH_MAX_ATTEMPTS - record.count));

    if (record.count > AUTH_MAX_ATTEMPTS) {
        const retryAfter = Math.ceil((record.resetTime - now) / 1000);
        res.setHeader('Retry-After', retryAfter);
        return res.status(429).json({
            error: 'Too many authentication attempts. Please try again later.',
            retryAfterSeconds: retryAfter
        });
    }
    next();
};

app.use('/api/login', authRateLimiter);
app.use('/api/signup', authRateLimiter);

// Security: Identity Header Sanitization and JWT Bearer Authentication (Synopsis §9 Table 6)
// Strips untrusted client headers, verifies JWT Bearer tokens, and injects verified identity
const sanitizeAndInjectIdentity = (req, res, next) => {
    // 1. Remove untrusted client-supplied identity & secret headers to prevent spoofing
    delete req.headers['x-user-email'];
    delete req.headers['x-user-username'];
    delete req.headers['x-gateway-secret'];
    delete req.headers['x-internal-secret'];
    delete req.headers['x-set-session-email'];
    delete req.headers['x-set-session-username'];
    delete req.headers['x-clear-session'];
    delete req.headers['x-session-id'];

    // 2. Allow CORS preflight requests without authentication
    if (req.method === 'OPTIONS') {
        return next();
    }

    // 3. Mark request as verified by Gateway with shared secret for downstream microservices
    req.headers['x-gateway-secret'] = process.env.GATEWAY_SHARED_SECRET || 'mb-gateway-service-secret-2026';

    // 4. Public routes that bypass JWT verification
    const reqPath = (req.originalUrl || req.url || req.path).split('?')[0];
    const isPublicRoute = (reqPath === '/api/login' && req.method === 'POST') ||
                          (reqPath === '/api/signup' && req.method === 'POST');

    if (isPublicRoute) {
        return next();
    }

    // 5. Protected routes: Extract Bearer token from Authorization header
    const authHeader = req.headers['authorization'];
    if (!authHeader) {
        return res.status(401).json({ error: 'Unauthorized: No authorization token provided' });
    }

    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
        return res.status(401).json({ error: 'Unauthorized: Invalid authorization format. Expected Bearer <token>' });
    }

    const token = parts[1].trim();
    if (!token) {
        return res.status(401).json({ error: 'Unauthorized: Token is empty' });
    }

    // 6. Verify JWT token signature and expiration
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        if (!decoded || !decoded.email) {
            return res.status(401).json({ error: 'Unauthorized: Invalid token payload' });
        }

        // Inject verified identity headers for downstream microservices
        req.headers['x-user-email'] = decoded.email.trim().toLowerCase();
        req.headers['x-user-username'] = decoded.username || '';
        req.user = decoded;
        next();
    } catch (err) {
        if (err.name === 'TokenExpiredError') {
            return res.status(401).json({ error: 'Unauthorized: Token has expired' });
        }
        return res.status(401).json({ error: 'Unauthorized: Invalid or tampered token' });
    }
};

app.use('/api', sanitizeAndInjectIdentity);

// Proxy configuration for downstream microservices
const proxyOptions = (target) => ({
    target,
    changeOrigin: true
});

// Auth & Users Service
const authServiceUrl = process.env.AUTH_SERVICE_URL || 'http://auth-service:3001';
app.use('/api/login', createProxyMiddleware(proxyOptions(authServiceUrl)));
app.use('/api/signup', createProxyMiddleware(proxyOptions(authServiceUrl)));
app.use('/api/logout', createProxyMiddleware(proxyOptions(authServiceUrl)));
app.use('/api/current_user', createProxyMiddleware(proxyOptions(authServiceUrl)));
app.use('/api/users', createProxyMiddleware(proxyOptions(authServiceUrl)));
app.use('/api/dashboard_data', createProxyMiddleware(proxyOptions(authServiceUrl)));

// Core Memories Service
const memoriesServiceUrl = process.env.MEMORIES_SERVICE_URL || 'http://memories-service:3002';
app.use('/api/memories', createProxyMiddleware(proxyOptions(memoriesServiceUrl)));

// Social Service
const socialServiceUrl = process.env.SOCIAL_SERVICE_URL || 'http://social-service:3003';
app.use('/api/friends', createProxyMiddleware(proxyOptions(socialServiceUrl)));
app.use('/api/friendship_graph', createProxyMiddleware(proxyOptions(socialServiceUrl)));

// Sharing Service
const sharingServiceUrl = process.env.SHARING_SERVICE_URL || 'http://sharing-service:3004';
app.use('/api/capsules', createProxyMiddleware(proxyOptions(sharingServiceUrl)));
app.use('/api/shared_memories', createProxyMiddleware(proxyOptions(sharingServiceUrl)));

app.get('/health', (req, res) => {
    res.json({ status: 'UP', service: 'gateway-service' });
});

// Generic safe error handler preventing information leakage
app.use((err, req, res, next) => {
    console.error('Unhandled Gateway Error:', err);
    res.status(500).json({
        error: isProduction ? 'Internal Server Error' : (err.message || 'Internal Server Error')
    });
});

const server = app.listen(PORT, () => {
    console.log(`API Gateway running at http://localhost:${PORT}`);
});

const shutdown = () => {
    console.log('Shutting down gracefully...');
    server.close(() => {
        console.log('Closed out remaining connections');
        process.exit(0);
    });
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
