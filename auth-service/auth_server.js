require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const common = require('./auth_common_functions');

const userStore = {
    load_users: () => common.loadUsers(),
    save_users: (users) => common.saveUsers(users),
    get_bucket: async (email) => { const users = common.loadUsers(); const res = await axios.post(`${process.env.DS_SERVICE_URL || 'http://ds-service:3005'}/api/ds/bucket/get_user`, { users, email }); return res.data.bucket; },
    get_user: async (email) => { const users = common.loadUsers(); const res = await axios.post(`${process.env.DS_SERVICE_URL || 'http://ds-service:3005'}/api/ds/bucket/get_user`, { users, email }); return res.data.user; },
    add_user: async (email, details) => { const users = common.loadUsers(); const res = await axios.post(`${process.env.DS_SERVICE_URL || 'http://ds-service:3005'}/api/ds/bucket/add_user`, { users, email, details }); common.saveUsers(res.data.users); },
    username_exists: async (username) => { const users = common.loadUsers(); const res = await axios.post(`${process.env.DS_SERVICE_URL || 'http://ds-service:3005'}/api/ds/bucket/username_exists`, { users, username }); return res.data.exists; }
};
const multer = require('multer');
const path = require('path');
const axios = require('axios');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3001;

const uploadDir = process.env.UPLOAD_DIR || path.join(__dirname, 'uploads/');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Storage config for multer
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadDir)
    },
    filename: function (req, file, cb) {
        cb(null, 'avatar_' + Date.now() + path.extname(file.originalname))
    }
});
const upload = multer({ storage: storage });

// Middleware to check auth from gateway header
const isAuthenticated = (req, res, next) => {
    const email = req.headers['x-user-email'];
    if (!email) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    req.userEmail = email;
    next();
};

// Signup Route
app.post('/api/signup', upload.single('profilePic'), async (req, res) => {
    const { firstName, lastName, username, email, password, confirmPassword } = req.body;
    
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

    const lowerEmail = email.toLowerCase();
    
    // Check if email exists
    if (await userStore.get_user(lowerEmail)) {
        return res.status(400).json({ error: 'Email is already registered.' });
    }
    
    // Check if username exists (requires iterating through all users)
    if (await userStore.username_exists(username)) {
        return res.status(400).json({ error: 'This username is already taken.' });
    }

    const hashedPassword = bcrypt.hashSync(password, 10);
    const name = `${firstName} ${lastName}`.trim();

    const newUser = {
        name,
        firstName,
        lastName,
        username,
        email: lowerEmail,
        password: hashedPassword,
        profile_pic: req.file ? 'uploads/' + req.file.filename : '',
        friends: []
    };

    await userStore.add_user(newUser.email, newUser);

    // Note: Gateway handles session creation, but we just return success
    // The frontend should ideally call login after signup to establish session
    res.json({ success: true, message: 'Signup successful', redirect: '/login.html' });
});

// Login Route
app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required.' });
    }

    const lowerEmail = email.toLowerCase();
    const user = await userStore.get_user(lowerEmail);

    let passwordMatch = false;
    if (user) {
        if (user.password === password) {
            passwordMatch = true;
            user.password = bcrypt.hashSync(password, 10);
            await userStore.add_user(user.email, user);
        } else if (bcrypt.compareSync(password, user.password)) {
            passwordMatch = true;
        }
    }

    if (passwordMatch) {
        // Return success. The API gateway handles sessions, so it needs to intercept this
        // to set the cookie. Or the frontend calls a gateway endpoint that calls this.
        // For simplicity in this architecture without rewriting the frontend deeply:
        // We will just let the gateway proxy pass it back, but wait...
        // If the gateway proxies, the microservice doesn't set the session.
        // We must pass a header back to the gateway so it knows to create a session!
        res.setHeader('x-set-session-email', lowerEmail);
        res.setHeader('x-set-session-username', user.username);
        return res.json({ success: true, message: 'Login successful', redirect: '/home.html' });
    } else {
        return res.status(401).json({ error: 'Invalid email or password.' });
    }
});

// Logout Route
app.post('/api/logout', async (req, res) => {
    res.setHeader('x-clear-session', 'true');
    res.json({ success: true, redirect: '/login.html' });
});

// Current User Info
app.get('/api/current_user', async (req, res) => {
    const email = req.headers['x-user-email'];
    if (email) {
        const user = await userStore.get_user(email);
        res.json({ loggedin: true, email: email, username: user ? user.username : '', name: user ? user.name : '' });
    } else {
        res.json({ loggedin: false });
    }
});

// Profile Data
app.get('/api/users/profile_data', isAuthenticated, async (req, res) => {
    const user = await userStore.get_user(req.userEmail);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
});

// User Search endpoint (combining from various places)
app.get('/api/users', isAuthenticated, async (req, res) => {
    const allUsers = userStore.load_users();
    const flatUsers = [];
    for (const bucket in allUsers) {
        for (const email in allUsers[bucket]) {
            const u = allUsers[bucket][email];
            flatUsers.push({
                email: u.email,
                name: u.name,
                username: u.username,
                profile_pic: u.profile_pic
            });
        }
    }
    res.json(flatUsers);
});

app.get('/api/internal/users/raw', async (req, res) => {
    res.json(userStore.load_users());
});

app.post('/api/internal/users', async (req, res) => {
    const user = req.body;
    if (user && user.email) {
        await userStore.add_user(user.email, user);
        res.json({ success: true });
    } else {
        res.status(400).json({ error: 'Invalid user object' });
    }
});



app.post('/api/users/profile/update', isAuthenticated, upload.single('profile_pic'), async (req, res) => {
    const currentEmail = req.userEmail;
    const user = await userStore.get_user(currentEmail);
    const { first_name, last_name, username, email } = req.body;

    if (first_name) user.first_name = first_name;
    if (last_name) user.last_name = last_name;
    if (username) {
        user.username = username;
    }

    if (req.file) {
        user.profile_pic = 'uploads/' + req.file.filename;
    }

    if (email && email.toLowerCase() !== currentEmail.toLowerCase()) {
        const lowerEmail = email.toLowerCase();
        if (await userStore.get_user(lowerEmail)) {
            return res.status(400).json({ error: 'Email already in use' });
        }
        const users = userStore.load_users(); delete users[await userStore.get_bucket(currentEmail)][currentEmail]; userStore.save_users(users);
        user.email = lowerEmail;
        await userStore.add_user(user.email, user);
        res.setHeader('x-set-session-email', lowerEmail);
    } else {
        await userStore.add_user(user.email, user);
    }

    res.json({ success: true, message: 'Profile updated successfully' });
});

app.post('/api/users/profile/password', isAuthenticated, async (req, res) => {
    const currentEmail = req.userEmail;
    const user = await userStore.get_user(currentEmail);
    const { old_password, new_password, confirm_password } = req.body;

    const passwordMatch = user.password === old_password || bcrypt.compareSync(old_password, user.password);
    
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
});

app.post('/api/users/profile/remove_friend', isAuthenticated, async (req, res) => {
    const currentEmail = req.userEmail;
    const user = await userStore.get_user(currentEmail);
    const { remove_friend_id } = req.body;

    if (user.friends) {
        user.friends = user.friends.filter(f => f.friend_id !== remove_friend_id && f.email !== remove_friend_id && f.id !== remove_friend_id);
        await userStore.add_user(user.email, user);
    }

    res.json({ success: true, message: 'Friend removed successfully' });
});

app.post('/api/users/profile/delete_account', isAuthenticated, async (req, res) => {
    const users = userStore.load_users(); delete users[await userStore.get_bucket(req.userEmail)][req.userEmail]; userStore.save_users(users);
    res.setHeader('x-clear-session', 'true');
    res.json({ success: true, message: 'Account deleted' });
});

app.get('/api/dashboard_data', isAuthenticated, async (req, res) => {
    const currentEmail = req.userEmail;
    const user = await userStore.get_user(currentEmail);
    
    let allMemories = [];
    try {
        const memRes = await axios.get(`${process.env.MEMORIES_SERVICE_URL || 'http://memories-service:3002'}/api/internal/memories`);
        allMemories = memRes.data;
    } catch(err) { console.error('Failed to fetch memories'); }
    
    const userMemories = allMemories.filter(m => m.owner === currentEmail);
    
    const friendsCount = user.friends ? user.friends.length : 0;
    const memoryCount = userMemories.length;

    const recentMemories = userMemories.slice().reverse().slice(0, 3);
    const recentFriends = user.friends ? user.friends.slice().reverse().slice(0, 3) : [];

    const now = Date.now();
    const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
    
    const newMemories = allMemories.filter(m => {
        const t = new Date(m.created_at || m.date).getTime();
        return t && t >= weekAgo;
    }).length;

    const newFriends = user.friends ? user.friends.filter(f => {
        const t = new Date(f.date_added).getTime();
        return t && t >= weekAgo;
    }).length : 0;

    const mapViews = user.map_views_this_week || 0;

    let allShared = [];
    try {
        const shareRes = await axios.get(`${process.env.SHARING_SERVICE_URL || 'http://sharing-service:3004'}/api/internal/shared_memories`);
        allShared = shareRes.data;
    } catch(err) { console.error('Failed to fetch shared memories'); }
    
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
});

app.get('/health', (req, res) => {
    res.json({ status: 'UP', service: 'auth-service' });
});

const server = app.listen(PORT, () => {
    console.log(`Auth Service running on port ${PORT}`);
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
