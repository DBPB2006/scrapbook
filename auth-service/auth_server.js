require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const bucketStore = require('./src/bucket_user_store');

// Resolve shared MongoDB module safely across container, root, and service execution contexts
let mongodb = null;
try {
    mongodb = require('./shared/mongodb');
} catch (e1) {
    try {
        mongodb = require('../shared/mongodb');
    } catch (e2) {
        try {
            mongodb = require('../../shared/mongodb');
        } catch (e3) {
            mongodb = null;
        }
    }
}

// Native A-Z Bucketed User Store (Synopsis §6.1) with MongoDB Integration
const userStore = {
    load_users: async () => bucketStore.load_users(),
    save_users: async (users) => bucketStore.save_users(users),
    get_bucket: (email) => bucketStore.get_bucket(email),
    get_user: async (email) => bucketStore.get_user(email),
    add_user: async (email, details) => bucketStore.add_user(email, details),
    username_exists: async (username) => bucketStore.username_exists(username),
    user_exists: async (email) => bucketStore.user_exists(email),
    remove_user: async (email) => bucketStore.remove_user(email)
};

const multer = require('multer');
const axios = require('axios');

let s3Module, metrics;
try {
    s3Module = require('./shared/s3_storage');
} catch (e) {
    s3Module = require('../shared/s3_storage');
}
try {
    metrics = require('./shared/metrics');
} catch (e) {
    metrics = require('../shared/metrics');
}
const { S3Storage, getMediaUrl } = s3Module;

const app = express();
const PORT = process.env.PORT || 3001;
const isProduction = process.env.NODE_ENV === 'production';

const INTERNAL_SECRET = process.env.INTERNAL_SERVICE_SECRET || 'mb-internal-service-secret-2026';
const GATEWAY_SECRET = process.env.GATEWAY_SHARED_SECRET || 'mb-gateway-service-secret-2026';
const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
    console.error('FATAL: JWT_SECRET environment variable is missing.');
    process.exit(1);
}

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(metrics.metricsMiddleware);
app.get('/metrics', metrics.metricsEndpoint);

// Storage config for multer
const storage = new S3Storage({ bucket: process.env.AWS_S3_BUCKET || 'default-bucket', prefix: 'users/' });
const upload = multer({ storage: storage });

// Security: Verify identity propagated from Gateway or internal service
const isAuthenticated = (req, res, next) => {
    const email = req.headers['x-user-email'];
    const gwHeader = req.headers['x-gateway-secret'];
    const intHeader = req.headers['x-internal-secret'];

    if (!email || (isProduction && gwHeader !== GATEWAY_SECRET && intHeader !== INTERNAL_SECRET)) {
        return res.status(401).json({ error: 'Unauthorized: Valid authenticated session required' });
    }
    req.userEmail = email;
    next();
};

// Security: Enforce internal service authorization
const isInternalService = (req, res, next) => {
    const secret = req.headers['x-internal-secret'];
    if (!secret || secret !== INTERNAL_SECRET) {
        return res.status(403).json({ error: 'Access denied: Internal service authorization required.' });
    }
    next();
};

// Signup Route
app.post('/api/signup', upload.single('profilePic'), async (req, res) => {
    try {
        const { firstName, lastName, username, email, password } = req.body;

        if (!firstName || !lastName || !username || !email || !password) {
            return res.status(400).json({ error: 'All fields are required.' });
        }

        const validUsername = /^[A-Za-z0-9_]{3,20}$/.test(username);
        if (!validUsername) {
            return res.status(400).json({ error: 'Username must be 3-20 characters and contain only letters, numbers, and underscores.' });
        }

        if (password.length < 8) {
            return res.status(400).json({ error: 'Password must be at least 8 characters.' });
        }

        const lowerEmail = email.toLowerCase().trim();

        // Check if email exists
        if (await userStore.get_user(lowerEmail)) {
            return res.status(400).json({ error: 'Email is already registered.' });
        }

        // Check if username exists
        if (await userStore.username_exists(username)) {
            return res.status(400).json({ error: 'This username is already taken.' });
        }

        // Pure Bcrypt Hashing (Synopsis §9 Table 6)
        const hashedPassword = bcrypt.hashSync(password, 10);
        const name = `${firstName} ${lastName}`.trim();

        const newUser = {
            name,
            firstName,
            lastName,
            username,
            email: lowerEmail,
            password: hashedPassword,
            profile_pic: req.file ? (req.file.provider === 's3' ? { provider: 's3', key: req.file.key, mimeType: req.file.mimeType, fileName: req.file.fileName, size: req.file.size } : 'uploads/' + req.file.filename) : '',
            friends: []
        };

        await userStore.add_user(newUser.email, newUser);
        metrics.userRegistrationsTotal.inc();

        const token = jwt.sign(
            { email: newUser.email, username: newUser.username },
            JWT_SECRET,
            { expiresIn: '24h' }
        );

        res.json({
            success: true,
            message: 'Signup successful',
            token,
            user: {
                email: newUser.email,
                username: newUser.username,
                name: newUser.name
            },
            redirect: '/login.html'
        });
    } catch (err) {
        console.error('Signup error:', err.message);
        res.status(500).json({ error: 'Database service unavailable' });
    }
});

// Login Route
app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required.' });
        }

        const lowerEmail = email.toLowerCase().trim();
        const user = await userStore.get_user(lowerEmail);

        // Enforce strict bcrypt verification (never plaintext fallback)
        let passwordMatch = false;
        if (user && user.password) {
            try {
                passwordMatch = bcrypt.compareSync(password, user.password);
            } catch (err) {
                passwordMatch = false;
            }
        }

        if (passwordMatch) {
            metrics.successfulLoginsTotal.inc();
            const token = jwt.sign(
                { email: user.email, username: user.username || '' },
                JWT_SECRET,
                { expiresIn: '24h' }
            );
            return res.json({
                success: true,
                message: 'Login successful',
                token,
                user: {
                    email: user.email,
                    username: user.username || '',
                    name: user.name || ''
                },
                redirect: '/home.html'
            });
        } else {
            metrics.failedLoginsTotal.inc();
            return res.status(401).json({ error: 'Invalid email or password.' });
        }
    } catch (err) {
        console.error('Login error:', err.message);
        res.status(500).json({ error: 'Database service unavailable' });
    }
});

// Logout Route
app.post('/api/logout', async (req, res) => {
    res.json({ success: true, message: 'Logged out successfully', redirect: '/login.html' });
});

// Current User Info
app.get('/api/current_user', async (req, res) => {
    try {
        const email = req.headers['x-user-email'];
        if (email) {
            const user = await userStore.get_user(email);
            res.json({ loggedin: true, email: email, username: user ? user.username : '', name: user ? user.name : '' });
        } else {
            res.json({ loggedin: false });
        }
    } catch (err) {
        console.error('Current user error:', err.message);
        res.status(500).json({ error: 'Database service unavailable' });
    }
});

// Profile Data - Never expose password hash or internal _id
app.get('/api/users/profile_data', isAuthenticated, async (req, res) => {
    try {
        const user = await userStore.get_user(req.userEmail);
        if (!user) return res.status(404).json({ error: 'User not found' });
        const userCopy = { ...user };
        delete userCopy.password;
        delete userCopy._id;
        userCopy.profile_pic = await getMediaUrl(user.profile_pic);
        res.json(userCopy);
    } catch (err) {
        console.error('Profile data error:', err.message);
        res.status(500).json({ error: 'Database service unavailable' });
    }
});

// User Search endpoint
app.get('/api/users', isAuthenticated, async (req, res) => {
    try {
        const allUsers = await userStore.load_users();
        const flatUsers = [];
        for (const bucket in allUsers) {
            for (const email in allUsers[bucket]) {
                const u = allUsers[bucket][email];
                let displayName = u.name;
                if (!displayName && (u.first_name || u.last_name || u.firstName || u.lastName)) {
                    displayName = `${u.first_name || u.firstName || ''} ${u.last_name || u.lastName || ''}`.trim();
                }
                flatUsers.push({
                    email: u.email,
                    name: displayName,
                    username: u.username,
                    profile_pic: await getMediaUrl(u.profile_pic)
                });
            }
        }
        res.json(flatUsers);
    } catch (err) {
        console.error('Users search error:', err.message);
        res.status(500).json({ error: 'Database service unavailable' });
    }
});

// Task 4: Internal endpoint protected with internal service authorization
app.get('/api/internal/users/raw', isInternalService, async (req, res) => {
    try {
        res.json(await userStore.load_users());
    } catch (err) {
        console.error('Internal users raw error:', err.message);
        res.status(500).json({ error: 'Database service unavailable' });
    }
});

// Task 4: Internal endpoint protected with internal service authorization
app.post('/api/internal/users', isInternalService, async (req, res) => {
    try {
        const user = req.body;
        if (user && user.email) {
            await userStore.add_user(user.email, user);
            res.json({ success: true });
        } else {
            res.status(400).json({ error: 'Invalid user object' });
        }
    } catch (err) {
        console.error('Internal users save error:', err.message);
        res.status(500).json({ error: 'Database service unavailable' });
    }
});

app.post('/api/users/profile/update', isAuthenticated, upload.single('profile_pic'), async (req, res) => {
    try {
        const currentEmail = req.userEmail;
        const user = await userStore.get_user(currentEmail);
        if (!user) return res.status(404).json({ error: 'User not found' });

        const { first_name, last_name, username, email } = req.body;

        if (first_name) user.first_name = first_name;
        if (last_name) user.last_name = last_name;
        if (username) {
            user.username = username;
        }

        if (req.file) {
            user.profile_pic = req.file.provider === 's3' ? { provider: 's3', key: req.file.key, mimeType: req.file.mimeType, fileName: req.file.fileName, size: req.file.size } : 'uploads/' + req.file.filename;
        }

        let newToken = null;
        if (email && email.toLowerCase().trim() !== currentEmail.toLowerCase().trim()) {
            const lowerEmail = email.toLowerCase().trim();
            if (await userStore.get_user(lowerEmail)) {
                return res.status(400).json({ error: 'Email already in use' });
            }
            await userStore.remove_user(currentEmail);
            user.email = lowerEmail;
            await userStore.add_user(user.email, user);
            newToken = jwt.sign(
                { email: user.email, username: user.username || '' },
                JWT_SECRET,
                { expiresIn: '24h' }
            );
        } else {
            await userStore.add_user(user.email, user);
        }

        const resp = { success: true, message: 'Profile updated successfully' };
        if (newToken) resp.token = newToken;
        res.json(resp);
    } catch (err) {
        console.error('Profile update error:', err.message);
        res.status(500).json({ error: 'Database service unavailable' });
    }
});

// Password update endpoint
app.post('/api/users/profile/password', isAuthenticated, async (req, res) => {
    try {
        const currentEmail = req.userEmail;
        const user = await userStore.get_user(currentEmail);
        if (!user) return res.status(404).json({ error: 'User not found' });

        const { old_password, new_password, confirm_password } = req.body;

        let passwordMatch = false;
        try {
            passwordMatch = user && user.password && bcrypt.compareSync(old_password, user.password);
        } catch (e) {
            passwordMatch = false;
        }

        if (!passwordMatch) {
            return res.status(400).json({ error: 'Old password is incorrect' });
        }
        if (new_password !== confirm_password) {
            return res.status(400).json({ error: 'New passwords do not match' });
        }
        if (new_password.length < 8) {
            return res.status(400).json({ error: 'Password must be at least 8 characters' });
        }

        user.password = bcrypt.hashSync(new_password, 10);
        await userStore.add_user(user.email, user);

        res.json({ success: true, message: 'Password changed successfully' });
    } catch (err) {
        console.error('Password change error:', err.message);
        res.status(500).json({ error: 'Database service unavailable' });
    }
});

app.post('/api/users/profile/remove_friend', isAuthenticated, async (req, res) => {
    try {
        const currentEmail = req.userEmail;
        const user = await userStore.get_user(currentEmail);
        if (!user) return res.status(404).json({ error: 'User not found' });

        const { remove_friend_id } = req.body;
        if (!remove_friend_id) return res.status(400).json({ error: 'Friend identifier is required.' });

        if (user.friends && Array.isArray(user.friends)) {
            const cleanId = String(remove_friend_id).trim();
            const target = user.friends.find(f => f.friend_id === cleanId || f.id === cleanId || (f.email && f.email.toLowerCase().trim() === cleanId.toLowerCase()));
            if (target) {
                user.friends = user.friends.filter(f => f !== target);
                await userStore.add_user(user.email, user);

                const targetEmail = target.email ? target.email.toLowerCase().trim() : (cleanId.includes('@') ? cleanId.toLowerCase() : null);
                if (targetEmail) {
                    const otherUser = await userStore.get_user(targetEmail);
                    if (otherUser && Array.isArray(otherUser.friends)) {
                        const myEmail = currentEmail.toLowerCase().trim();
                        otherUser.friends = otherUser.friends.filter(f => {
                            const fe = f.email ? f.email.toLowerCase().trim() : '';
                            const fi = f.friend_id || f.id || '';
                            return fe !== myEmail && fi !== myEmail;
                        });
                        await userStore.add_user(otherUser.email, otherUser);
                    }
                }
            }
        }

        res.json({ success: true, message: 'Friend removed successfully' });
    } catch (err) {
        console.error('Remove friend error:', err.message);
        res.status(500).json({ error: 'Database service unavailable' });
    }
});

app.post('/api/users/profile/delete_account', isAuthenticated, async (req, res) => {
    try {
        await userStore.remove_user(req.userEmail);
        res.json({ success: true, message: 'Account deleted' });
    } catch (err) {
        console.error('Delete account error:', err.message);
        res.status(500).json({ error: 'Database service unavailable' });
    }
});

app.get('/api/dashboard_data', isAuthenticated, async (req, res) => {
    try {
        const currentEmail = req.userEmail;
        const normalizedEmail = (currentEmail || '').toLowerCase().trim();
        const user = await userStore.get_user(normalizedEmail);
        if (!user) return res.status(404).json({ error: 'User not found' });

        let userMemories = [];
        // Primary path: Direct MongoDB query avoiding loading all platform users' memories
        if (mongodb && typeof mongodb.isConnected === 'function' && mongodb.isConnected()) {
            try {
                const memCollection = mongodb.getCollection(mongodb.COLLECTIONS.MEMORIES);
                userMemories = await memCollection.find({ owner: normalizedEmail }).toArray();
            } catch (dbErr) {
                console.error('Failed to query user memories from MongoDB directly:', dbErr.message);
                userMemories = [];
            }
        }

        // Secondary fallback: Internal service-to-service communication
        if (!userMemories || userMemories.length === 0) {
            try {
                const memRes = await axios.get(`${process.env.MEMORIES_SERVICE_URL || 'http://memories-service:3002'}/api/internal/memories`, {
                    headers: { 'x-internal-secret': INTERNAL_SECRET }
                });
                const allMemories = Array.isArray(memRes.data) ? memRes.data : [];
                userMemories = allMemories.filter(m => m.owner && m.owner.toLowerCase().trim() === normalizedEmail);
            } catch (err) {
                console.error('Failed to fetch memories internally:', err.message);
            }
        }

        const friendsCount = user.friends ? user.friends.length : 0;
        const memoryCount = userMemories.length;

        const recentMemories = userMemories.slice().reverse().slice(0, 3);
        const recentFriends = user.friends ? user.friends.slice().reverse().slice(0, 3) : [];

        const now = Date.now();
        const weekAgo = now - 7 * 24 * 60 * 60 * 1000;

        // Scoped strictly to authenticated user's memories within the 7-day window
        const newMemories = userMemories.filter(m => {
            const rawDate = m.created_at || m.date;
            const t = rawDate ? new Date(rawDate).getTime() : 0;
            return t && t >= weekAgo;
        }).length;

        const newFriends = user.friends ? user.friends.filter(f => {
            const t = new Date(f.date_added).getTime();
            return t && t >= weekAgo;
        }).length : 0;

        const mapViews = user.map_views_this_week || 0;

        let allShared = [];
        try {
            const shareRes = await axios.get(`${process.env.SHARING_SERVICE_URL || 'http://sharing-service:3004'}/api/internal/shared_memories`, {
                headers: { 'x-internal-secret': INTERNAL_SECRET }
            });
            allShared = shareRes.data;
        } catch (err) { console.error('Failed to fetch shared memories', err.message); }

        const sentSharedMemories = allShared.filter(m => m.from === currentEmail).sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
        const receivedSharedMemories = allShared.filter(m => m.to === currentEmail);
        const unseenReceived = receivedSharedMemories.filter(m => !m.seen).sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

        const hasUnseenSharedMemory = unseenReceived.length > 0;
        const newestUnseenMemoryId = hasUnseenSharedMemory ? (unseenReceived[0].memory_id || unseenReceived[0].original_memory_id) : null;

        res.json({
            firstName: user.first_name || user.name || user.username || currentEmail.split('@')[0],
            friendsCount,
            memoryCount,
            recentMemories,
            recentFriends,
            newMemories,
            newFriends,
            mapViews,
            allFriends: user.friends || [],
            sentSharedMemories,
            hasUnseenSharedMemory,
            newestUnseenMemoryId,
            userMemories
        });
    } catch (err) {
        console.error('Dashboard data error:', err.message);
        res.status(500).json({ error: 'Database service unavailable' });
    }
});

app.use((err, req, res, next) => {
    console.error('Unhandled Auth Error:', err);
    res.status(500).json({
        error: isProduction ? 'Internal Server Error' : (err.message || 'Internal Server Error')
    });
});

const HEALTH_DB_PING_TIMEOUT_MS = 2000;

async function isDatabaseHealthy() {
    if (!bucketStore.isDbConnected()) {
        return false;
    }
    if (!mongodb || typeof mongodb.getDb !== 'function') {
        return false;
    }
    let timeoutId = null;
    try {
        const db = mongodb.getDb();
        if (!db || typeof db.command !== 'function') {
            return false;
        }
        const pingPromise = Promise.resolve(db.command({ ping: 1 })).then(
            (result) => !!(result && result.ok === 1),
            () => false
        );
        const timeoutPromise = new Promise((resolve) => {
            timeoutId = setTimeout(() => resolve(false), HEALTH_DB_PING_TIMEOUT_MS);
        });
        return await Promise.race([pingPromise, timeoutPromise]);
    } catch (err) {
        return false;
    } finally {
        if (timeoutId) {
            clearTimeout(timeoutId);
        }
    }
}

app.get('/health/live', (req, res) => {
    res.status(200).json({
        status: 'UP',
        service: 'auth-service'
    });
});

app.get('/health', async (req, res) => {
    const dbConnected = await isDatabaseHealthy();
    res.status(dbConnected ? 200 : 503).json({
        status: dbConnected ? 'UP' : 'DOWN',
        service: 'auth-service',
        database: dbConnected ? 'connected' : 'disconnected'
    });
});

let serverInstance = null;

async function startServer() {
    if (mongodb && process.env.MONGODB_URI) {
        try {
            const { db } = await mongodb.connect();
            await mongodb.initializeIndexes(db);
            console.log('Auth Service: Successfully connected to MongoDB and initialized indexes.');
        } catch (err) {
            console.error('Auth Service: Error - MongoDB connection failed on startup:', err.message);
        }
    } else {
        console.warn('Auth Service: Warning - No MONGODB_URI configured.');
    }

    serverInstance = app.listen(PORT, () => {
        console.log(`Auth Service running on port ${PORT}`);
    });

    const shutdown = async () => {
        console.log('Shutting down gracefully...');
        if (mongodb && mongodb.isConnected()) {
            try {
                await mongodb.close();
                console.log('MongoDB connection closed.');
            } catch (err) {
                console.error('Error closing MongoDB connection:', err.message);
            }
        }
        if (serverInstance) {
            serverInstance.close(() => {
                console.log('Closed out remaining connections');
                process.exit(0);
            });
        }
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    return serverInstance;
}

if (require.main === module) {
    startServer();
}

module.exports = { app, startServer, userStore };
