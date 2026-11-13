require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { createProxyMiddleware } = require('http-proxy-middleware');

const metrics = fs.existsSync(path.join(__dirname, 'shared'))
    ? require('./shared/metrics')
    : require('../shared/metrics');

const app = express();
// Trust the single AWS ALB reverse proxy hop so req.ip reflects the true client IP
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3090;
const METRICS_PORT = process.env.METRICS_PORT !== undefined ? parseInt(process.env.METRICS_PORT, 10) : 3091;
const isProduction = process.env.NODE_ENV === 'production';
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
    console.error('FATAL: JWT_SECRET environment variable is required.');
    process.exit(1);
}
const GATEWAY_SHARED_SECRET = process.env.GATEWAY_SHARED_SECRET;
if (!GATEWAY_SHARED_SECRET) {
    console.error('FATAL: GATEWAY_SHARED_SECRET environment variable is required.');
    process.exit(1);
}

// Dynamic CORS configuration
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
        if (!origin) return callback(null, true);
        const normalizedRequestOrigin = normalizeOrigin(origin);
        if (!normalizedRequestOrigin || normalizedRequestOrigin.includes('*')) {
            return callback(null, false);
        }
        return callback(null, getAllowedOrigins().includes(normalizedRequestOrigin));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    exposedHeaders: ['Authorization'],
    maxAge: 86400
}));

app.use(metrics.metricsMiddleware);
app.get('/metrics', (req, res) => {
    res.status(403).json({ error: 'Access denied: Metrics endpoint cannot be accessed externally.' });
});

// Prevent external clients from accessing internal service endpoints
app.use('/api/internal', (req, res) => {
    res.status(403).json({ error: 'Access denied: Internal endpoints cannot be accessed externally.' });
});

// Rate limiting on authentication routes
const authRateLimitMap = new Map();
const AUTH_WINDOW_MS = 15 * 60 * 1000;
const AUTH_MAX_ATTEMPTS = 15;

// Periodically prune expired rate-limit records to prevent memory growth
const authRateLimitPruneInterval = setInterval(() => {
    const now = Date.now();
    for (const [ip, record] of authRateLimitMap.entries()) {
        if (now > record.resetTime) {
            authRateLimitMap.delete(ip);
        }
    }
}, AUTH_WINDOW_MS);
if (typeof authRateLimitPruneInterval.unref === 'function') {
    authRateLimitPruneInterval.unref();
}

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

// Strip client-supplied identity/secret headers, verify JWT Bearer tokens, and inject verified identity
const sanitizeAndInjectIdentity = (req, res, next) => {
    delete req.headers['x-user-email'];
    delete req.headers['x-user-username'];
    delete req.headers['x-gateway-secret'];
    delete req.headers['x-internal-secret'];

    if (req.method === 'OPTIONS') {
        return next();
    }

    req.headers['x-gateway-secret'] = GATEWAY_SHARED_SECRET;

    const reqPath = (req.originalUrl || req.url || req.path).split('?')[0];
    const isPublicRoute = (reqPath === '/api/login' && req.method === 'POST') ||
                          (reqPath === '/api/signup' && req.method === 'POST');

    if (isPublicRoute) {
        return next();
    }

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

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        if (!decoded || !decoded.email) {
            return res.status(401).json({ error: 'Unauthorized: Invalid token payload' });
        }

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

const proxyOptions = (target) => ({
    target,
    changeOrigin: true,
    onProxyReq: (proxyReq, req) => {
        if (req.headers['x-gateway-secret']) {
            proxyReq.setHeader('x-gateway-secret', req.headers['x-gateway-secret']);
        }
        if (req.headers['x-user-email']) {
            proxyReq.setHeader('x-user-email', req.headers['x-user-email']);
        }
        if (req.headers['x-user-username'] !== undefined) {
            proxyReq.setHeader('x-user-username', req.headers['x-user-username']);
        }
    },
    onError: (err, req, res) => {
        console.error(`Gateway Proxy Error (${target}):`, err.message);
        if (!res.headersSent) {
            res.status(502).json({ error: 'Upstream service unavailable' });
        }
    }
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
app.use('/api/social/adjacency_list', createProxyMiddleware(proxyOptions(socialServiceUrl)));

// Sharing Service
const sharingServiceUrl = process.env.SHARING_SERVICE_URL || 'http://sharing-service:3004';
app.use('/api/capsules', createProxyMiddleware(proxyOptions(sharingServiceUrl)));
app.use('/api/shared_memories', createProxyMiddleware(proxyOptions(sharingServiceUrl)));

app.get('/health', (req, res) => {
    res.json({ status: 'UP', service: 'gateway-service' });
});

app.use((err, req, res, next) => {
    console.error('Unhandled Gateway Error:', err.message);
    res.status(500).json({ error: isProduction ? 'Internal Server Error' : (err.message || 'Internal Server Error') });
});

let server = null;
let metricsServer = null;

function startServer() {
    server = app.listen(PORT, () => {
        console.log(`API Gateway running at http://localhost:${PORT}`);
    });

    if (Number.isInteger(METRICS_PORT) && METRICS_PORT >= 0) {
        const metricsApp = express();
        metricsApp.get('/metrics', metrics.metricsEndpoint);
        metricsServer = metricsApp.listen(METRICS_PORT, () => {
            console.log(`API Gateway metrics running on internal port ${METRICS_PORT}`);
        });
    }

    let shuttingDown = false;
    const shutdown = () => {
        if (shuttingDown) return;
        shuttingDown = true;
        console.log('Shutting down gracefully...');
        const forceTimer = setTimeout(() => {
            console.warn('Forced shutdown after timeout.');
            process.exit(0);
        }, 5000);
        if (typeof forceTimer.unref === 'function') forceTimer.unref();

        const closeServer = (srv) => new Promise((resolve) => {
            if (!srv) return resolve();
            srv.close(() => resolve());
            if (typeof srv.closeIdleConnections === 'function') {
                srv.closeIdleConnections();
            }
        });
        Promise.all([closeServer(server), closeServer(metricsServer)]).then(() => {
            if (forceTimer) clearTimeout(forceTimer);
            console.log('Closed out remaining connections');
            process.exit(0);
        });
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    return server;
}

if (require.main === module) {
    startServer();
}

module.exports = { app, startServer };
