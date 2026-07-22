const express = require('express');
const session = require('express-session');
const cors = require('cors');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();
const PORT = 3090;

app.use(cors());

app.use(session({
    secret: 'scrapbook_secret_key',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false } // In prod, set secure: true with HTTPS
}));

// Serve static pages and uploads (these will be volume mounted in docker)
app.use(express.static('pages'));
app.use('/uploads', express.static('uploads'));

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
app.use('/api/login', createProxyMiddleware(proxyOptions('http://auth-service:3001')));
app.use('/api/signup', createProxyMiddleware(proxyOptions('http://auth-service:3001')));
app.use('/api/logout', createProxyMiddleware(proxyOptions('http://auth-service:3001')));
app.use('/api/current_user', createProxyMiddleware(proxyOptions('http://auth-service:3001')));
app.use('/api/users', createProxyMiddleware(proxyOptions('http://auth-service:3001')));
app.use('/api/dashboard_data', createProxyMiddleware(proxyOptions('http://auth-service:3001')));

// Core Memories Service
app.use('/api/memories', createProxyMiddleware(proxyOptions('http://memories-service:3002')));

// Social Service
app.use('/api/friends', createProxyMiddleware(proxyOptions('http://social-service:3003')));
app.use('/api/friendship_graph', createProxyMiddleware(proxyOptions('http://social-service:3003')));

// Sharing Service
app.use('/api/capsules', createProxyMiddleware(proxyOptions('http://sharing-service:3004')));
app.use('/api/shared_memories', createProxyMiddleware(proxyOptions('http://sharing-service:3004')));

app.listen(PORT, () => {
    console.log(`API Gateway running at http://localhost:${PORT}`);
});
