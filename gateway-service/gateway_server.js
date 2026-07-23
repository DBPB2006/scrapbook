require('dotenv').config();
const express = require('express');
const path = require('path');
const session = require('express-session');
const cors = require('cors');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();
const PORT = process.env.PORT || 3090;

app.use(cors());

app.use(session({
    secret: 'scrapbook_secret_key',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false } // In prod, set secure: true with HTTPS
}));

// Serve static pages and uploads (these will be volume mounted in docker)
app.use(express.static('pages'));
app.use('/uploads', express.static(process.env.UPLOAD_DIR || path.join(__dirname, 'uploads/')));

// Middleware to inject session data into headers for downstream services
const injectSessionHeader = (req, res, next) => {
    // If a user is logged in, their email is in the session
    if (req.session && req.session.email) {
        req.headers['x-user-email'] = req.session.email;
    }
    next();
};

app.use('/api', injectSessionHeader);

// Proxy configuration
const proxyOptions = (target) => ({
    target,
    changeOrigin: true,
    onProxyRes: function (proxyRes, req, res) {
        // Intercept headers from microservice to update session
        if (proxyRes.headers['x-set-session-email']) {
            req.session.loggedin = true;
            req.session.email = proxyRes.headers['x-set-session-email'];
            req.session.username = proxyRes.headers['x-set-session-username'] || '';
            req.session.save();
        }
        if (proxyRes.headers['x-clear-session'] === 'true') {
            req.session.destroy();
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

// Sharing Service
const sharingServiceUrl = process.env.SHARING_SERVICE_URL || 'http://sharing-service:3004';
app.use('/api/capsules', createProxyMiddleware(proxyOptions(sharingServiceUrl)));
app.use('/api/shared_memories', createProxyMiddleware(proxyOptions(sharingServiceUrl)));

app.get('/health', (req, res) => {
    res.json({ status: 'UP', service: 'gateway-service' });
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
