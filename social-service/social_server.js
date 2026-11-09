require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const axios = require('axios');

// Resolve shared MongoDB connection module safely across container, root, and service execution contexts
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

const { SocialGraph } = require('./src/social_graph');
const friendRequestStore = require('./src/friend_request_store');

const app = express();
const PORT = process.env.PORT || 3003;
const isProduction = process.env.NODE_ENV === 'production';

const INTERNAL_SECRET = process.env.INTERNAL_SERVICE_SECRET || 'mb-internal-service-secret-2026';
const GATEWAY_SECRET = process.env.GATEWAY_SHARED_SECRET || 'mb-gateway-service-secret-2026';

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(metrics.metricsMiddleware);
app.get('/metrics', metrics.metricsEndpoint);

const storage = new S3Storage({ bucket: process.env.AWS_S3_BUCKET || 'default-bucket', prefix: 'friends/' });
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

app.get('/api/friends', isAuthenticated, async (req, res) => {
    const currentEmail = req.userEmail;

    let allUsers = [];
    let usersData = {};
    try {
        const usersRes = await axios.get(`${process.env.AUTH_SERVICE_URL || 'http://auth-service:3001'}/api/internal/users/raw`, {
            headers: { 'x-internal-secret': INTERNAL_SECRET }
        });
        usersData = usersRes.data;
        for (const bucket in usersData) {
            for (const email in usersData[bucket]) {
                allUsers.push(usersData[bucket][email]);
            }
        }
    } catch (err) { console.error('Failed to fetch users', err.message); }

    const user = allUsers.find(u => u.email === currentEmail) || {};

    let allMemories = [];
    try {
        const memRes = await axios.get(`${process.env.MEMORIES_SERVICE_URL || 'http://memories-service:3002'}/api/internal/memories`, {
            headers: { 'x-internal-secret': INTERNAL_SECRET }
        });
        allMemories = memRes.data;
    } catch (err) { console.error('Failed to fetch memories', err.message); }

    const userMemories = allMemories.filter(m => m.owner === currentEmail);

    const friends = user.friends || [];

    const friendsWithCounts = await Promise.all(friends.map(async f => {
        const friendId = f.friend_id || f.id || f.email;
        const memCount = userMemories.filter(m => m.friends && m.friends.includes(friendId)).length;
        return {
            ...f,
            memoryCount: memCount,
            image_url: await getMediaUrl(f.image_url)
        };
    }));

    res.json(friendsWithCounts);
});

// Helper to fetch all users from auth service
async function fetchAllUsersInternal() {
    try {
        const usersRes = await axios.get(`${process.env.AUTH_SERVICE_URL || 'http://auth-service:3001'}/api/internal/users/raw`, {
            headers: { 'x-internal-secret': INTERNAL_SECRET }
        });
        const usersData = usersRes.data || {};
        const flatUsers = {};
        for (const bucket in usersData) {
            for (const email in usersData[bucket]) {
                flatUsers[email.toLowerCase()] = usersData[bucket][email];
            }
        }
        return flatUsers;
    } catch (err) {
        console.error('Failed to fetch users internally:', err.message);
        return {};
    }
}

// 1. Send Friend Request (FR-5)
const handleSendFriendRequest = async (req, res) => {
    try {
        const currentEmail = req.userEmail.toLowerCase();
        const targetEmail = (req.body.to_email || req.body.friendEmail || '').trim().toLowerCase();
        const { friendName, relationshipTag, howYouMet, message } = req.body;

        if (!targetEmail) {
            return res.status(400).json({ error: 'Recipient email is required.' });
        }

        if (currentEmail === targetEmail) {
            return res.status(400).json({ error: 'Cannot send a friend request to yourself.' });
        }

        const allUsers = await fetchAllUsersInternal();
        const fromUser = allUsers[currentEmail];
        const toUser = allUsers[targetEmail];

        if (!toUser) {
            return res.status(404).json({ error: 'Recipient user not found.' });
        }

        // Prevent requests between existing friends
        const isAlreadyFriend = (fromUser && Array.isArray(fromUser.friends) && fromUser.friends.some(f => (f.email && f.email.toLowerCase() === targetEmail) || f.friend_id === targetEmail)) ||
            (toUser && Array.isArray(toUser.friends) && toUser.friends.some(f => (f.email && f.email.toLowerCase() === currentEmail) || f.friend_id === currentEmail));
        if (isAlreadyFriend) {
            return res.status(400).json({ error: 'You are already friends with this user.' });
        }

        // Prevent duplicate pending requests in either direction via MongoDB query
        const existingPending = await friendRequestStore.find_pending_between(currentEmail, targetEmail);
        if (existingPending) {
            return res.status(400).json({ error: 'A pending friend request already exists between you and this user.' });
        }

        let imgUrl = '';
        if (req.file) {
            imgUrl = req.file.provider === 's3' ? { provider: 's3', key: req.file.key, mimeType: req.file.mimeType, fileName: req.file.fileName, size: req.file.size } : 'uploads/friends/' + req.file.filename;
        }

        const newRequest = {
            id: 'freq_' + Math.random().toString(36).substr(2, 9),
            from: currentEmail,
            from_name: (fromUser && (fromUser.name || fromUser.username)) || currentEmail,
            from_profile_pic: (fromUser && fromUser.profile_pic) || '',
            to: targetEmail,
            to_name: friendName || toUser.name || toUser.username || targetEmail,
            to_profile_pic: toUser.profile_pic || '',
            relationship_type: relationshipTag || '',
            how_you_met: howYouMet || '',
            image_url: imgUrl,
            message: message || '',
            status: 'pending',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };

        await friendRequestStore.add_request(newRequest);

        res.json({ success: true, message: 'Friend request sent successfully', request: newRequest });
    } catch (err) {
        console.error('Send friend request error:', err.message);
        res.status(500).json({ error: 'Database service unavailable' });
    }
};

app.post('/api/friends/requests', isAuthenticated, upload.single('profileImage'), handleSendFriendRequest);
app.post('/api/friends/request', isAuthenticated, upload.single('profileImage'), handleSendFriendRequest);

// 2. Incoming Friend Requests
app.get('/api/friends/requests/incoming', isAuthenticated, async (req, res) => {
    try {
        const currentEmail = req.userEmail.toLowerCase();
        const incoming = await friendRequestStore.get_incoming_requests(currentEmail);

        const enriched = await Promise.all(incoming.map(async r => {
            const copy = { ...r };
            delete copy._id;
            return {
                ...copy,
                from_profile_pic: await getMediaUrl(r.from_profile_pic),
                image_url: await getMediaUrl(r.image_url)
            };
        }));

        res.json(enriched);
    } catch (err) {
        console.error('Incoming requests error:', err.message);
        res.status(500).json({ error: 'Database service unavailable' });
    }
});

// 3. Outgoing Friend Requests
app.get('/api/friends/requests/outgoing', isAuthenticated, async (req, res) => {
    try {
        const currentEmail = req.userEmail.toLowerCase();
        const outgoing = await friendRequestStore.get_outgoing_requests(currentEmail);

        const enriched = await Promise.all(outgoing.map(async r => {
            const copy = { ...r };
            delete copy._id;
            return {
                ...copy,
                to_profile_pic: await getMediaUrl(r.to_profile_pic),
                image_url: await getMediaUrl(r.image_url)
            };
        }));

        res.json(enriched);
    } catch (err) {
        console.error('Outgoing requests error:', err.message);
        res.status(500).json({ error: 'Database service unavailable' });
    }
});

// 4. Accept Friend Request
app.post('/api/friends/requests/:id/accept', isAuthenticated, async (req, res) => {
    try {
        const currentEmail = req.userEmail.toLowerCase();
        const requestId = req.params.id;

        const request = await friendRequestStore.get_request_by_id(requestId);
        if (!request) {
            return res.status(404).json({ error: 'Friend request not found.' });
        }

        if (request.to !== currentEmail) {
            return res.status(403).json({ error: 'Unauthorized: You can only accept requests sent to you.' });
        }

        if (request.status !== 'pending') {
            return res.status(400).json({ error: `Request cannot be accepted because its status is '${request.status}'.` });
        }

        await friendRequestStore.update_request_status(requestId, 'accepted');

        // Establish bidirectional friendship in Auth store for undirected graph representation
        const allUsers = await fetchAllUsersInternal();
        const fromUser = allUsers[request.from] || { email: request.from, friends: [] };
        const toUser = allUsers[request.to] || { email: request.to, friends: [] };

        if (!Array.isArray(fromUser.friends)) fromUser.friends = [];
        if (!Array.isArray(toUser.friends)) toUser.friends = [];

        // Add to recipient's friends list
        if (!toUser.friends.some(f => (f.email && f.email.toLowerCase() === request.from) || f.friend_id === request.from)) {
            toUser.friends.push({
                friend_id: 'f_' + Math.random().toString(36).substr(2, 9),
                name: request.from_name || fromUser.name || request.from,
                email: request.from,
                relationship_type: request.relationship_type || '',
                how_you_met: request.how_you_met || '',
                image_url: request.image_url || request.from_profile_pic || '',
                date_added: new Date().toISOString()
            });
        }

        // Add to sender's friends list
        if (!fromUser.friends.some(f => (f.email && f.email.toLowerCase() === request.to) || f.friend_id === request.to)) {
            fromUser.friends.push({
                friend_id: 'f_' + Math.random().toString(36).substr(2, 9),
                name: request.to_name || toUser.name || request.to,
                email: request.to,
                relationship_type: request.relationship_type || '',
                how_you_met: request.how_you_met || '',
                image_url: request.to_profile_pic || '',
                date_added: new Date().toISOString()
            });
        }

        try {
            await Promise.all([
                axios.post(`${process.env.AUTH_SERVICE_URL || 'http://auth-service:3001'}/api/internal/users`, toUser, {
                    headers: { 'x-internal-secret': INTERNAL_SECRET }
                }),
                axios.post(`${process.env.AUTH_SERVICE_URL || 'http://auth-service:3001'}/api/internal/users`, fromUser, {
                    headers: { 'x-internal-secret': INTERNAL_SECRET }
                })
            ]);
        } catch (err) {
            console.error('Failed to save friendship to auth service:', err.message);
        }

        res.json({ success: true, message: 'Friend request accepted successfully' });
    } catch (err) {
        console.error('Accept friend request error:', err.message);
        res.status(500).json({ error: 'Database service unavailable' });
    }
});

// 5. Decline Friend Request
app.post('/api/friends/requests/:id/decline', isAuthenticated, async (req, res) => {
    try {
        const currentEmail = req.userEmail.toLowerCase();
        const requestId = req.params.id;

        const request = await friendRequestStore.get_request_by_id(requestId);
        if (!request) {
            return res.status(404).json({ error: 'Friend request not found.' });
        }

        if (request.to !== currentEmail) {
            return res.status(403).json({ error: 'Unauthorized: You can only decline requests sent to you.' });
        }

        if (request.status !== 'pending') {
            return res.status(400).json({ error: `Request cannot be declined because its status is '${request.status}'.` });
        }

        await friendRequestStore.update_request_status(requestId, 'declined');

        res.json({ success: true, message: 'Friend request declined' });
    } catch (err) {
        console.error('Decline friend request error:', err.message);
        res.status(500).json({ error: 'Database service unavailable' });
    }
});

// 6. Cancel outgoing request
app.delete('/api/friends/requests/:id', isAuthenticated, async (req, res) => {
    try {
        const currentEmail = req.userEmail.toLowerCase();
        const requestId = req.params.id;

        const request = await friendRequestStore.get_request_by_id(requestId);
        if (!request) {
            return res.status(404).json({ error: 'Friend request not found.' });
        }

        if (request.from !== currentEmail) {
            return res.status(403).json({ error: 'Unauthorized: You can only cancel requests sent by you.' });
        }

        await friendRequestStore.delete_request(requestId, currentEmail);

        res.json({ success: true, message: 'Friend request cancelled' });
    } catch (err) {
        console.error('Cancel friend request error:', err.message);
        res.status(500).json({ error: 'Database service unavailable' });
    }
});

app.post('/api/friends', isAuthenticated, upload.single('profileImage'), async (req, res) => {
    const currentEmail = req.userEmail;
    let allUsers = [];
    let usersData = {};
    try {
        const usersRes = await axios.get(`${process.env.AUTH_SERVICE_URL || 'http://auth-service:3001'}/api/internal/users/raw`, {
            headers: { 'x-internal-secret': INTERNAL_SECRET }
        });
        usersData = usersRes.data;
        for (const bucket in usersData) {
            for (const email in usersData[bucket]) {
                allUsers.push(usersData[bucket][email]);
            }
        }
    } catch (err) { console.error('Failed to fetch users', err.message); }

    const user = allUsers.find(u => u.email === currentEmail) || { email: currentEmail };

    const { friendName, friendEmail, relationshipTag, howYouMet } = req.body;

    if (!friendName || !howYouMet || !friendEmail) {
        return res.status(400).json({ error: 'All required fields must be filled.' });
    }

    if (user.friends && user.friends.some(f => f.email && f.email.toLowerCase() === friendEmail.toLowerCase())) {
        return res.status(400).json({ error: 'Friend with this email already exists.' });
    }

    let imgUrl = '';
    if (req.file) {
        imgUrl = req.file.provider === 's3' ? { provider: 's3', key: req.file.key, mimeType: req.file.mimeType, fileName: req.file.fileName, size: req.file.size } : 'uploads/friends/' + req.file.filename;
    }

    const newFriend = {
        friend_id: 'f_' + Math.random().toString(36).substr(2, 9),
        name: friendName,
        email: friendEmail.toLowerCase(),
        relationship_type: relationshipTag || '',
        how_you_met: howYouMet,
        image_url: imgUrl,
        date_added: new Date().toISOString()
    };

    if (!user.friends) {
        user.friends = [];
    }
    user.friends.push(newFriend);

    try {
        await axios.post(`${process.env.AUTH_SERVICE_URL || 'http://auth-service:3001'}/api/internal/users`, user, {
            headers: { 'x-internal-secret': INTERNAL_SECRET }
        });
    } catch (err) { console.error('Failed to save user', err.message); }

    res.json({ success: true, message: 'Friend added successfully' });
});

app.delete('/api/friends/:id', isAuthenticated, async (req, res) => {
    try {
        const currentEmail = req.userEmail.toLowerCase().trim();
        const friendId = (req.params.id || '').trim();

        if (!friendId) {
            return res.status(400).json({ error: 'Friend identifier is required.' });
        }

        const allUsers = await fetchAllUsersInternal();
        const currentUser = allUsers[currentEmail];

        if (!currentUser) {
            return res.status(404).json({ error: 'User not found.' });
        }

        if (!Array.isArray(currentUser.friends) || currentUser.friends.length === 0) {
            return res.status(404).json({ error: 'Friendship not found in your friends list.' });
        }

        // Verify friendship exists in requesting user's list (by friend_id, id, or email)
        const friendIndex = currentUser.friends.findIndex(f => {
            if (f.friend_id && f.friend_id === friendId) return true;
            if (f.id && f.id === friendId) return true;
            if (f.email && f.email.toLowerCase().trim() === friendId.toLowerCase().trim()) return true;
            return false;
        });

        if (friendIndex === -1) {
            return res.status(404).json({ error: 'Friendship not found in your friends list.' });
        }

        const targetFriendRecord = currentUser.friends[friendIndex];
        const targetEmail = targetFriendRecord.email
            ? targetFriendRecord.email.toLowerCase().trim()
            : (friendId.includes('@') ? friendId.toLowerCase().trim() : null);

        // 1. Remove from requesting user's friends list
        currentUser.friends.splice(friendIndex, 1);

        // 2. Remove requesting user from the other user's friends list (symmetric deletion)
        let otherUser = null;
        if (targetEmail && allUsers[targetEmail]) {
            otherUser = allUsers[targetEmail];
            if (Array.isArray(otherUser.friends)) {
                otherUser.friends = otherUser.friends.filter(f => {
                    const fEmail = f.email ? f.email.toLowerCase().trim() : '';
                    const fId = f.friend_id || f.id || '';
                    return fEmail !== currentEmail && fId !== currentEmail;
                });
            }
        }

        // 3. Persist updates to auth service store
        const savePromises = [
            axios.post(`${process.env.AUTH_SERVICE_URL || 'http://auth-service:3001'}/api/internal/users`, currentUser, {
                headers: { 'x-internal-secret': INTERNAL_SECRET }
            })
        ];
        if (otherUser) {
            savePromises.push(
                axios.post(`${process.env.AUTH_SERVICE_URL || 'http://auth-service:3001'}/api/internal/users`, otherUser, {
                    headers: { 'x-internal-secret': INTERNAL_SECRET }
                })
            );
        }

        await Promise.all(savePromises);

        res.json({ success: true, message: 'Friend removed' });
    } catch (err) {
        console.error('Delete friend error:', err.message);
        res.status(500).json({ error: 'Database service unavailable' });
    }
});

app.get('/api/friendship_graph', isAuthenticated, async (req, res) => {
    const currentEmail = req.userEmail;

    let usersData = {};
    try {
        const usersRes = await axios.get(`${process.env.AUTH_SERVICE_URL || 'http://auth-service:3001'}/api/internal/users/raw`, {
            headers: { 'x-internal-secret': INTERNAL_SECRET }
        });
        usersData = usersRes.data;
    } catch (err) { console.error('Failed to fetch users', err.message); }

    const allUsers = {};
    for (const bucket in usersData) {
        for (const email in usersData[bucket]) {
            allUsers[email] = usersData[bucket][email];
        }
    }

    // Build Social Graph using native Adjacency List (Synopsis §6.2)
    const graph = new SocialGraph();
    graph.buildFromUsers(usersData);

    const [nodes, emails, emailIndexMap] = graph.buildNodesAndIndexMap();
    const size = emails.length;

    let allMemories = [];
    try {
        const memRes = await axios.get(`${process.env.MEMORIES_SERVICE_URL || 'http://memories-service:3002'}/api/internal/memories`, {
            headers: { 'x-internal-secret': INTERNAL_SECRET }
        });
        allMemories = memRes.data;
    } catch (err) { console.error('Failed to fetch memories', err.message); }

    const myMemories = allMemories.filter(m => m.owner === currentEmail);

    const memoryEdges = {};
    const memoryLocations = [];

    const ownerIdx = emailIndexMap[currentEmail];
    myMemories.forEach(memory => {
        if (memory.friends && Array.isArray(memory.friends)) {
            memory.friends.forEach(friendEmail => {
                if (emailIndexMap[friendEmail] !== undefined) {
                    const friendIdx = emailIndexMap[friendEmail];
                    const edgeKey = ownerIdx < friendIdx ? ownerIdx + '_' + friendIdx : friendIdx + '_' + ownerIdx;
                    if (!memoryEdges[edgeKey]) memoryEdges[edgeKey] = [];
                    memoryEdges[edgeKey].push({
                        id: memory.memory_id || '',
                        title: memory.title || '',
                        ownerIdx,
                        friendIdx
                    });
                }
            });
        }
        if (memory.location) {
            memoryLocations.push({
                title: memory.title || '',
                location: memory.location,
                id: memory.memory_id || ''
            });
        }
    });

    const userTypes = [];
    let friendEmails = [];
    if (allUsers[currentEmail] && Array.isArray(allUsers[currentEmail].friends)) {
        friendEmails = allUsers[currentEmail].friends.map(f => f.email || f.id || f.friend_id);
    }

    emails.forEach((email, i) => {
        if (email === currentEmail) userTypes[i] = 'current';
        else if (friendEmails.includes(email)) userTypes[i] = 'friend';
        else userTypes[i] = 'other';
    });

    const nodePositions = [];
    const centerX = 450, centerY = 450, radius = 350;
    for (let i = 0; i < size; i++) {
        const angle = 2 * Math.PI * i / size - Math.PI / 2;
        nodePositions.push({
            x: centerX + radius * Math.cos(angle),
            y: centerY + radius * Math.sin(angle)
        });
    }

    // Friend recommendations via native bounded BFS + Queue (Synopsis §6.2)
    const suggestedEmails = graph.findFriendSuggestions(currentEmail, 10, 2);
    const suggestedFriends = suggestedEmails.map(email => nodes[email] ? nodes[email].name : email);

    res.json({
        userCount: size,
        currentUserIndex: emailIndexMap[currentEmail] !== undefined ? emailIndexMap[currentEmail] : -1,
        users: Object.values(nodes),
        nodeTypes: userTypes,
        nodePositions,
        emailIndexMap,
        adjacencyList: graph.toAdjacencyList(),
        memoryEdges,
        memoryLocations,
        suggestedFriends
    });
});

app.get('/api/social/adjacency_list', isAuthenticated, async (req, res) => {
    let usersData = {};
    try {
        const usersRes = await axios.get(`${process.env.AUTH_SERVICE_URL || 'http://auth-service:3001'}/api/internal/users/raw`, {
            headers: { 'x-internal-secret': INTERNAL_SECRET }
        });
        usersData = usersRes.data;
    } catch (err) {
        console.error('Failed to fetch users', err.message);
    }
    const graph = new SocialGraph();
    graph.buildFromUsers(usersData);
    res.json({
        vertexCount: graph.vertexCount(),
        edgeCount: graph.edgeCount(),
        adjacencyList: graph.toAdjacencyList()
    });
});

app.use((err, req, res, next) => {
    console.error('Unhandled Social Error:', err);
    res.status(500).json({
        error: isProduction ? 'Internal Server Error' : (err.message || 'Internal Server Error')
    });
});

const HEALTH_DB_PING_TIMEOUT_MS = 2000;

async function isDatabaseHealthy() {
    if (!friendRequestStore.isDbConnected()) {
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
        service: 'social-service'
    });
});

app.get('/health', async (req, res) => {
    const dbConnected = await isDatabaseHealthy();
    res.status(dbConnected ? 200 : 503).json({
        status: dbConnected ? 'UP' : 'DOWN',
        service: 'social-service',
        database: dbConnected ? 'connected' : 'disconnected'
    });
});

let serverInstance = null;

async function startServer() {
    if (mongodb && process.env.MONGODB_URI) {
        try {
            const { db } = await mongodb.connect();
            await mongodb.initializeIndexes(db);
            console.log('Social Service: Successfully connected to MongoDB and initialized indexes.');
        } catch (err) {
            console.error('Social Service: Error - MongoDB connection failed on startup:', err.message);
        }
    } else {
        console.warn('Social Service: Warning - No MONGODB_URI configured.');
    }

    serverInstance = app.listen(PORT, () => {
        console.log(`Social Service running on port ${PORT}`);
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

module.exports = { app, startServer, friendRequestStore };
