require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const multer = require('multer');
const axios = require('axios');

const hasLocalShared = fs.existsSync(path.join(__dirname, 'shared'));
const mongodb = hasLocalShared ? require('./shared/mongodb') : require('../shared/mongodb');
const {
    getMediaUrl,
    createUploadMiddleware,
    handleUploadError,
    deleteS3Object,
    extractS3Keys
} = hasLocalShared ? require('./shared/s3_storage') : require('../shared/s3_storage');
const metrics = hasLocalShared ? require('./shared/metrics') : require('../shared/metrics');
const {
    normalizeEmail,
    friendEntryMatchesEmail,
    createIsAuthenticated,
    createIsInternalService,
    registerHealthRoutes,
    createServiceStarter
} = hasLocalShared ? require('./shared/service_common') : require('../shared/service_common');

const { SocialGraph } = require('./src/social_graph');
const friendRequestStore = require('./src/friend_request_store');

const app = express();
const PORT = process.env.PORT || 3003;
const isProduction = process.env.NODE_ENV === 'production';

const INTERNAL_SECRET = process.env.INTERNAL_SERVICE_SECRET;
if (!INTERNAL_SECRET) {
    console.error('FATAL: INTERNAL_SERVICE_SECRET environment variable is required.');
    process.exit(1);
}
const GATEWAY_SECRET = process.env.GATEWAY_SHARED_SECRET;
if (!GATEWAY_SECRET) {
    console.error('FATAL: GATEWAY_SHARED_SECRET environment variable is required.');
    process.exit(1);
}

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(metrics.metricsMiddleware);
app.get('/metrics', metrics.metricsEndpoint);

const uploadFriendImage = createUploadMiddleware(multer, {
    bucket: process.env.AWS_S3_BUCKET || 'default-bucket',
    prefix: 'friends/',
    category: 'image',
    fieldName: 'profileImage',
    multiple: false
});

const isAuthenticated = createIsAuthenticated(GATEWAY_SECRET, INTERNAL_SECRET, isProduction);
const isInternalService = createIsInternalService(INTERNAL_SECRET);

const AUTH_SERVICE_URL = () => process.env.AUTH_SERVICE_URL || 'http://auth-service:3001';
const MEMORIES_SERVICE_URL = () => process.env.MEMORIES_SERVICE_URL || 'http://memories-service:3002';

function getUserDisplayName(user, fallback = '') {
    if (!user || typeof user !== 'object') return fallback || '';
    const snake = `${typeof user.first_name === 'string' ? user.first_name.trim() : ''} ${typeof user.last_name === 'string' ? user.last_name.trim() : ''}`.trim();
    const camel = `${typeof user.firstName === 'string' ? user.firstName.trim() : ''} ${typeof user.lastName === 'string' ? user.lastName.trim() : ''}`.trim();
    const full = typeof user.name === 'string' ? user.name.trim() : '';
    const uname = typeof user.username === 'string' ? user.username.trim() : '';
    return snake || camel || full || uname || normalizeEmail(user.email) || fallback || '';
}

function hasFriendEntry(friends, targetEmail) {
    return Array.isArray(friends) && friends.some(f => friendEntryMatchesEmail(f, targetEmail));
}

function findFriendRecord(user, identifier) {
    if (!user || !Array.isArray(user.friends) || !identifier) return null;
    const rawId = String(identifier).trim();
    const normalizedId = rawId.toLowerCase();
    return user.friends.find(f => {
        if (!f) return false;
        if (typeof f === 'string') return normalizeEmail(f) === normalizedId;
        const fEmail = normalizeEmail(f.email);
        const fFriendId = f.friend_id !== undefined && f.friend_id !== null ? String(f.friend_id).trim() : '';
        const fLegacyId = f.id !== undefined && f.id !== null ? String(f.id).trim() : '';
        return fFriendId === rawId ||
            fLegacyId === rawId ||
            (fFriendId && fFriendId.toLowerCase() === normalizedId) ||
            (fLegacyId && fLegacyId.toLowerCase() === normalizedId) ||
            (fEmail && fEmail === normalizedId);
    }) || null;
}

function dedupeFriends(friends) {
    if (!Array.isArray(friends)) return [];
    const seen = new Set();
    const deduped = [];
    for (const f of friends) {
        if (!f) continue;
        if (typeof f === 'string') {
            const em = normalizeEmail(f);
            if (!em || seen.has(em)) continue;
            seen.add(em);
            deduped.push(em);
            continue;
        }
        const em = normalizeEmail(f.email);
        const key = em || (f.friend_id ? String(f.friend_id).trim().toLowerCase() : '') || (f.id ? String(f.id).trim().toLowerCase() : '');
        if (key) {
            if (seen.has(key)) continue;
            seen.add(key);
        }
        deduped.push({ ...f, ...(em ? { email: em } : {}) });
    }
    return deduped;
}

function flattenBucketsUsersData(usersData) {
    const flatUsers = {};
    if (!usersData || typeof usersData !== 'object') return flatUsers;
    if (Array.isArray(usersData)) {
        for (const u of usersData) {
            const em = normalizeEmail(u && u.email);
            if (em) flatUsers[em] = u;
        }
        return flatUsers;
    }
    for (const bucket in usersData) {
        const bucketEntries = usersData[bucket];
        if (!bucketEntries || typeof bucketEntries !== 'object') continue;
        if (bucketEntries.email) {
            const em = normalizeEmail(bucketEntries.email);
            if (em) flatUsers[em] = bucketEntries;
        } else {
            for (const email in bucketEntries) {
                const u = bucketEntries[email];
                const em = normalizeEmail((u && u.email) || email);
                if (em && u) flatUsers[em] = u;
            }
        }
    }
    return flatUsers;
}

async function fetchUsersByEmails(emails = [], { includeFriends = false, includeProfilePic = false } = {}) {
    const uniqueNormalized = [...new Set(emails.map(normalizeEmail).filter(Boolean))];
    if (uniqueNormalized.length === 0) return {};

    let lookupRes;
    try {
        lookupRes = await axios.post(`${AUTH_SERVICE_URL()}/api/internal/users/lookup`, {
            emails: uniqueNormalized,
            includeFriends: !!includeFriends,
            includeProfilePic: !!includeProfilePic
        }, {
            headers: { 'x-internal-secret': INTERNAL_SECRET },
            timeout: 5000
        });
    } catch (err) {
        const upstreamErr = new Error(`Authentication service unavailable: ${err.message}`);
        upstreamErr.statusCode = 503;
        throw upstreamErr;
    }

    const users = lookupRes && lookupRes.data && lookupRes.data.users;
    if (!users || typeof users !== 'object' || Array.isArray(users)) {
        const upstreamErr = new Error('Authentication service returned invalid user lookup data');
        upstreamErr.statusCode = 503;
        throw upstreamErr;
    }
    return users;
}

async function fetchGraphNeighborhoodOrThrow(centerEmail) {
    const normalizedCenter = normalizeEmail(centerEmail);
    let graphRes;
    try {
        graphRes = await axios.get(`${AUTH_SERVICE_URL()}/api/internal/users/graph_nodes?center=${encodeURIComponent(normalizedCenter)}`, {
            headers: { 'x-internal-secret': INTERNAL_SECRET },
            timeout: 5000
        });
    } catch (err) {
        const upstreamErr = new Error(`Authentication service unavailable: ${err.message}`);
        upstreamErr.statusCode = 503;
        throw upstreamErr;
    }

    const usersData = graphRes && graphRes.data;
    if (!usersData || typeof usersData !== 'object') {
        const upstreamErr = new Error('Authentication service returned invalid graph data');
        upstreamErr.statusCode = 503;
        throw upstreamErr;
    }

    return {
        flatUsers: flattenBucketsUsersData(usersData),
        usersData
    };
}

async function saveUserToAuthService(userObj) {
    const cleanUser = { ...userObj };
    delete cleanUser._id;
    await axios.post(`${AUTH_SERVICE_URL()}/api/internal/users`, cleanUser, {
        headers: { 'x-internal-secret': INTERNAL_SECRET },
        timeout: 5000
    });
}

function buildAuthorizedGraphState({ currentEmail, flatUsers, usersData, friendId = '' }) {
    const currentUser = flatUsers[currentEmail];
    if (!currentUser) {
        return { errorStatus: 404, errorMessage: 'User not found.' };
    }

    const directFriendEmails = new Set();
    const friendRefToEmail = new Map();
    const friendRecordByEmail = new Map();

    const currentFriends = Array.isArray(currentUser.friends) ? currentUser.friends : [];
    for (const f of currentFriends) {
        if (!f) continue;
        const fEmail = typeof f === 'string'
            ? normalizeEmail(f)
            : normalizeEmail(f.email || f.id || f.friend_id);
        if (!fEmail || fEmail === currentEmail) continue;

        directFriendEmails.add(fEmail);
        friendRefToEmail.set(fEmail, fEmail);
        if (!friendRecordByEmail.has(fEmail) && typeof f === 'object') {
            friendRecordByEmail.set(fEmail, f);
        }
        if (typeof f === 'object') {
            if (f.friend_id) friendRefToEmail.set(String(f.friend_id).trim().toLowerCase(), fEmail);
            if (f.id) friendRefToEmail.set(String(f.id).trim().toLowerCase(), fEmail);
        }
    }

    const cleanFriendId = typeof friendId === 'string' ? friendId.trim() : '';
    let filteredFriendRecord = null;
    let filteredFriendEmail = null;

    if (cleanFriendId) {
        filteredFriendRecord = findFriendRecord(currentUser, cleanFriendId);
        if (!filteredFriendRecord) {
            return {
                errorStatus: 403,
                errorMessage: 'Access denied: You are not authorized to access friendship data for this user.'
            };
        }
        filteredFriendEmail = typeof filteredFriendRecord === 'string'
            ? normalizeEmail(filteredFriendRecord)
            : normalizeEmail(filteredFriendRecord.email || filteredFriendRecord.id || filteredFriendRecord.friend_id);
        if (!filteredFriendEmail) {
            return { errorStatus: 403, errorMessage: 'Access denied: Invalid friend reference.' };
        }

        const scopedGraph = new SocialGraph();
        scopedGraph.addVertex(currentEmail, {
            name: getUserDisplayName(currentUser, currentEmail),
            registered: true
        });
        const friendUserObj = flatUsers[filteredFriendEmail];
        scopedGraph.addVertex(filteredFriendEmail, {
            name: getUserDisplayName(friendUserObj, (typeof filteredFriendRecord === 'object' && filteredFriendRecord.name) || filteredFriendEmail),
            registered: !!friendUserObj
        });
        scopedGraph.addEdge(currentEmail, filteredFriendEmail);

        return {
            currentUser,
            scopedGraph,
            directFriendEmails: new Set([filteredFriendEmail]),
            friendRefToEmail,
            filteredFriendRecord: typeof filteredFriendRecord === 'object' ? filteredFriendRecord : { email: filteredFriendEmail },
            filteredFriendEmail,
            suggestedEmails: []
        };
    }

    // Build graph from bounded 2-hop neighborhood for BFS level-2 friend recommendations
    const fullGraph = new SocialGraph();
    fullGraph.buildFromUsers(usersData);

    const suggestedEmails = fullGraph
        .findFriendSuggestions(currentEmail, 10, 2)
        .filter(email => email !== currentEmail && !directFriendEmails.has(email));
    const suggestionSet = new Set(suggestedEmails);

    const scopedGraph = new SocialGraph();
    scopedGraph.addVertex(currentEmail, {
        name: getUserDisplayName(currentUser, currentEmail),
        registered: true
    });

    for (const fEmail of directFriendEmails) {
        const friendUserObj = flatUsers[fEmail];
        const fRec = friendRecordByEmail.get(fEmail);
        scopedGraph.addVertex(fEmail, {
            name: getUserDisplayName(friendUserObj, (fRec && fRec.name) || fEmail),
            registered: !!friendUserObj
        });
        scopedGraph.addEdge(currentEmail, fEmail);
    }

    const directArray = Array.from(directFriendEmails);
    for (let i = 0; i < directArray.length; i++) {
        for (let j = i + 1; j < directArray.length; j++) {
            if (fullGraph.hasEdge(directArray[i], directArray[j])) {
                scopedGraph.addEdge(directArray[i], directArray[j]);
            }
        }
    }

    for (const suggEmail of suggestedEmails) {
        const suggUser = flatUsers[suggEmail];
        const suggVertex = fullGraph.getVertex(suggEmail);
        scopedGraph.addVertex(suggEmail, {
            name: getUserDisplayName(suggUser, (suggVertex && suggVertex.name) || suggEmail),
            registered: !!suggUser
        });
        for (const fEmail of directFriendEmails) {
            if (fullGraph.hasEdge(fEmail, suggEmail)) {
                scopedGraph.addEdge(fEmail, suggEmail);
            }
        }
    }

    return {
        currentUser,
        scopedGraph,
        directFriendEmails,
        friendRefToEmail,
        filteredFriendRecord: null,
        filteredFriendEmail: null,
        suggestedEmails,
        suggestionSet
    };
}

async function resolveAuthorizedGraphState(currentEmail, rawFriendId = '') {
    const cleanFriendId = typeof rawFriendId === 'string' ? rawFriendId.trim() : '';
    if (cleanFriendId) {
        const currentMap = await fetchUsersByEmails([currentEmail], { includeFriends: true });
        const currentUser = currentMap[currentEmail];
        if (!currentUser) {
            return { errorStatus: 404, errorMessage: 'User not found.' };
        }
        const directRec = findFriendRecord(currentUser, cleanFriendId);
        if (!directRec) {
            return {
                errorStatus: 403,
                errorMessage: 'Access denied: You are not authorized to access friendship data for this user.'
            };
        }
        const targetEmail = typeof directRec === 'string'
            ? normalizeEmail(directRec)
            : normalizeEmail(directRec.email || directRec.id || directRec.friend_id);
        if (!targetEmail) {
            return { errorStatus: 403, errorMessage: 'Access denied: Invalid friend reference.' };
        }
        const targetMap = await fetchUsersByEmails([targetEmail], { includeFriends: false });
        const flatUsers = { [currentEmail]: currentUser };
        if (targetMap[targetEmail]) {
            flatUsers[targetEmail] = targetMap[targetEmail];
        }
        return buildAuthorizedGraphState({
            currentEmail,
            flatUsers,
            usersData: flatUsers,
            friendId: cleanFriendId
        });
    }

    const { flatUsers, usersData } = await fetchGraphNeighborhoodOrThrow(currentEmail);
    return buildAuthorizedGraphState({
        currentEmail,
        flatUsers,
        usersData,
        friendId: ''
    });
}

// POST /api/internal/friends/cleanup_user - Remove all friend requests involving a deleted user
app.post('/api/internal/friends/cleanup_user', isInternalService, async (req, res) => {
    try {
        const email = normalizeEmail(req.body && req.body.email);
        if (!email) {
            return res.status(400).json({ error: 'Valid email is required.' });
        }
        const result = await friendRequestStore.cleanup_user_requests(email);
        const s3Keys = [];
        for (const r of result.deletedRequests) {
            for (const key of extractS3Keys(r && r.image_url)) {
                if (key.startsWith('friends/')) s3Keys.push(key);
            }
        }
        res.json({
            success: true,
            deletedCount: result.deletedCount,
            s3Keys
        });
    } catch (err) {
        console.error('Internal friends cleanup error:', err.message);
        res.status(500).json({ error: 'Database service unavailable' });
    }
});

// POST /api/internal/friends/update_email - Propagate email change across friend requests
app.post('/api/internal/friends/update_email', isInternalService, async (req, res) => {
    try {
        const oldEmail = normalizeEmail(req.body && req.body.oldEmail);
        const newEmail = normalizeEmail(req.body && req.body.newEmail);
        if (!oldEmail || !newEmail) {
            return res.status(400).json({ error: 'Both oldEmail and newEmail are required.' });
        }
        const result = await friendRequestStore.update_user_email(oldEmail, newEmail);
        res.json({ success: true, ...result });
    } catch (err) {
        console.error('Internal friends update_email error:', err.message);
        res.status(500).json({ error: 'Database service unavailable' });
    }
});

app.get('/api/friends', isAuthenticated, async (req, res) => {
    try {
        const currentEmail = req.userEmail;
        const currentMap = await fetchUsersByEmails([currentEmail], { includeFriends: true });
        const user = currentMap[currentEmail];
        if (!user) {
            return res.status(404).json({ error: 'User not found.' });
        }

        let userMemories = [];
        try {
            const memRes = await axios.get(`${MEMORIES_SERVICE_URL()}/api/internal/memories?owner=${encodeURIComponent(currentEmail)}`, {
                headers: { 'x-internal-secret': INTERNAL_SECRET },
                timeout: 5000
            });
            userMemories = Array.isArray(memRes.data) ? memRes.data : [];
        } catch (err) {
            console.error('Failed to fetch user memories:', err.message);
            const memErr = new Error('Memories service unavailable');
            memErr.statusCode = 503;
            throw memErr;
        }

        const friends = dedupeFriends(user.friends || []);
        const friendEmails = friends
            .map(f => (typeof f === 'string' ? normalizeEmail(f) : normalizeEmail(f && f.email)))
            .filter(Boolean);
        const friendUsersMap = friendEmails.length > 0
            ? await fetchUsersByEmails(friendEmails, { includeFriends: false, includeProfilePic: false })
            : {};

        const friendsWithCounts = await Promise.all(friends.map(async f => {
            if (typeof f === 'string') {
                const memCount = userMemories.filter(m =>
                    Array.isArray(m.friends) && m.friends.some(mf => friendEntryMatchesEmail(mf, f))
                ).length;
                return {
                    friend_id: f,
                    email: f,
                    name: getUserDisplayName(friendUsersMap[f], f),
                    memoryCount: memCount,
                    image_url: ''
                };
            }
            const fEmail = normalizeEmail(f.email);
            const fId = f.friend_id ? String(f.friend_id).trim().toLowerCase() : '';
            const legacyId = f.id ? String(f.id).trim().toLowerCase() : '';
            const memCount = userMemories.filter(m => {
                if (!Array.isArray(m.friends)) return false;
                return m.friends.some(mf => {
                    const ref = typeof mf === 'string'
                        ? mf.trim().toLowerCase()
                        : String((mf && (mf.email || mf.friend_id || mf.id)) || '').trim().toLowerCase();
                    return ref && (ref === fEmail || (fId && ref === fId) || (legacyId && ref === legacyId));
                });
            }).length;

            const resolvedName = (typeof f.name === 'string' && f.name.trim())
                ? f.name
                : getUserDisplayName(friendUsersMap[fEmail] || f, fEmail || fId || 'Friend');

            return {
                ...f,
                name: resolvedName,
                ...(fEmail ? { email: fEmail } : {}),
                memoryCount: memCount,
                image_url: await getMediaUrl(f.image_url)
            };
        }));

        res.json(friendsWithCounts);
    } catch (err) {
        console.error('Get friends error:', err.message);
        res.status(err.statusCode || 500).json({ error: err.statusCode === 503 ? err.message : 'Database service unavailable' });
    }
});

// Send Friend Request
const handleSendFriendRequest = async (req, res) => {
    const uploadedKey = req.file && req.file.provider === 's3' ? req.file.key : null;
    const cleanupUploadedKey = async () => {
        if (uploadedKey) {
            try { await deleteS3Object(uploadedKey); } catch (_) {}
        }
    };
    try {
        const currentEmail = req.userEmail;
        const targetEmail = normalizeEmail(req.body.to_email || req.body.friendEmail);
        const { friendName, relationshipTag, howYouMet, message } = req.body;

        if (!targetEmail) {
            await cleanupUploadedKey();
            return res.status(400).json({ error: 'Recipient email is required.' });
        }
        if (currentEmail === targetEmail) {
            await cleanupUploadedKey();
            return res.status(400).json({ error: 'Cannot send a friend request to yourself.' });
        }

        const usersMap = await fetchUsersByEmails([currentEmail, targetEmail], {
            includeFriends: true,
            includeProfilePic: true
        });
        const fromUser = usersMap[currentEmail];
        const toUser = usersMap[targetEmail];

        if (!fromUser) {
            await cleanupUploadedKey();
            return res.status(404).json({ error: 'Authenticated sender account not found.' });
        }
        if (!toUser) {
            await cleanupUploadedKey();
            return res.status(404).json({ error: 'Recipient user not found.' });
        }

        const isAlreadyFriend = hasFriendEntry(fromUser.friends, targetEmail) || hasFriendEntry(toUser.friends, currentEmail);
        if (isAlreadyFriend) {
            await cleanupUploadedKey();
            return res.status(400).json({ error: 'You are already friends with this user.' });
        }

        const existingPending = await friendRequestStore.find_pending_between(currentEmail, targetEmail);
        if (existingPending) {
            await cleanupUploadedKey();
            return res.status(400).json({ error: 'A pending friend request already exists between you and this user.' });
        }

        const imgUrl = req.file
            ? { provider: 's3', key: req.file.key, mimeType: req.file.mimeType, fileName: req.file.fileName, size: req.file.size }
            : '';

        const newRequest = {
            id: 'freq_' + crypto.randomBytes(6).toString('hex'),
            from: currentEmail,
            from_name: getUserDisplayName(fromUser, currentEmail),
            from_profile_pic: fromUser.profile_pic || '',
            to: targetEmail,
            to_name: (typeof friendName === 'string' && friendName.trim()) ? friendName.trim() : getUserDisplayName(toUser, targetEmail),
            to_profile_pic: toUser.profile_pic || '',
            relationship_type: relationshipTag || '',
            how_you_met: howYouMet || '',
            image_url: imgUrl,
            message: message || '',
            status: 'pending',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };

        try {
            await friendRequestStore.add_request(newRequest);
        } catch (addErr) {
            await cleanupUploadedKey();
            if (addErr && (addErr.code === 11000 || /E11000/i.test(addErr.message || ''))) {
                return res.status(400).json({ error: 'A pending friend request already exists between you and this user.' });
            }
            throw addErr;
        }

        res.json({ success: true, message: 'Friend request sent successfully', request: newRequest });
    } catch (err) {
        await cleanupUploadedKey();
        console.error('Send friend request error:', err.message);
        res.status(err.statusCode || 500).json({ error: err.statusCode === 503 ? err.message : 'Database service unavailable' });
    }
};

app.post('/api/friends/requests', isAuthenticated, uploadFriendImage, handleSendFriendRequest);
app.post('/api/friends/request', isAuthenticated, uploadFriendImage, handleSendFriendRequest);

// Incoming Friend Requests
app.get('/api/friends/requests/incoming', isAuthenticated, async (req, res) => {
    try {
        const incoming = await friendRequestStore.get_incoming_requests(req.userEmail);
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

// Outgoing Friend Requests
app.get('/api/friends/requests/outgoing', isAuthenticated, async (req, res) => {
    try {
        const outgoing = await friendRequestStore.get_outgoing_requests(req.userEmail);
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

// Accept Friend Request
app.post('/api/friends/requests/:id/accept', isAuthenticated, async (req, res) => {
    try {
        const currentEmail = req.userEmail;
        const requestId = (req.params.id || '').trim();

        const request = await friendRequestStore.get_request_by_id(requestId);
        if (!request) {
            return res.status(404).json({ error: 'Friend request not found.' });
        }

        const fromEmail = normalizeEmail(request.from);
        const toEmail = normalizeEmail(request.to);

        if (toEmail !== currentEmail) {
            return res.status(403).json({ error: 'Unauthorized: You can only accept requests sent to you.' });
        }
        if (request.status !== 'pending') {
            return res.status(400).json({ error: `Request cannot be accepted because its status is '${request.status}'.` });
        }
        if (!fromEmail || !toEmail || fromEmail === toEmail) {
            return res.status(400).json({ error: 'Invalid friend request participants.' });
        }

        const usersMap = await fetchUsersByEmails([fromEmail, toEmail], {
            includeFriends: true,
            includeProfilePic: true
        });
        const fromUser = usersMap[fromEmail];
        const toUser = usersMap[toEmail];

        if (!fromUser || !toUser) {
            return res.status(404).json({ error: 'One or both users in this friend request no longer exist.' });
        }

        const updatedToFriends = JSON.parse(JSON.stringify(dedupeFriends(toUser.friends || [])));
        const updatedFromFriends = JSON.parse(JSON.stringify(dedupeFriends(fromUser.friends || [])));
        const nowIso = new Date().toISOString();

        if (!hasFriendEntry(updatedToFriends, fromEmail)) {
            updatedToFriends.push({
                friend_id: 'f_' + crypto.randomBytes(6).toString('hex'),
                name: request.from_name || getUserDisplayName(fromUser, fromEmail),
                email: fromEmail,
                relationship_type: request.relationship_type || '',
                how_you_met: request.how_you_met || '',
                image_url: request.image_url || request.from_profile_pic || fromUser.profile_pic || '',
                date_added: nowIso
            });
        }

        if (!hasFriendEntry(updatedFromFriends, toEmail)) {
            updatedFromFriends.push({
                friend_id: 'f_' + crypto.randomBytes(6).toString('hex'),
                name: getUserDisplayName(toUser, request.to_name || toEmail),
                email: toEmail,
                relationship_type: request.relationship_type || '',
                how_you_met: request.how_you_met || '',
                image_url: toUser.profile_pic || request.to_profile_pic || '',
                date_added: nowIso
            });
        }

        const finalToFriends = dedupeFriends(updatedToFriends);
        const finalFromFriends = dedupeFriends(updatedFromFriends);

        const claimed = await friendRequestStore.claim_pending_request(requestId, currentEmail, 'accepted');
        if (!claimed) {
            const latest = await friendRequestStore.get_request_by_id(requestId);
            if (!latest) {
                return res.status(404).json({ error: 'Friend request not found.' });
            }
            if (normalizeEmail(latest.to) !== currentEmail) {
                return res.status(403).json({ error: 'Unauthorized: You can only accept requests sent to you.' });
            }
            return res.status(400).json({ error: `Request cannot be accepted because its status is '${latest.status}'.` });
        }

        await Promise.all([
            saveUserToAuthService({ ...toUser, email: toEmail, friends: finalToFriends }),
            saveUserToAuthService({ ...fromUser, email: fromEmail, friends: finalFromFriends })
        ]);

        res.json({ success: true, message: 'Friend request accepted successfully' });
    } catch (err) {
        console.error('Accept friend request error:', err.message);
        res.status(err.statusCode || 500).json({ error: err.statusCode === 503 ? err.message : 'Database service unavailable' });
    }
});

// Decline Friend Request
app.post('/api/friends/requests/:id/decline', isAuthenticated, async (req, res) => {
    try {
        const currentEmail = req.userEmail;
        const requestId = (req.params.id || '').trim();

        const request = await friendRequestStore.get_request_by_id(requestId);
        if (!request) {
            return res.status(404).json({ error: 'Friend request not found.' });
        }
        if (normalizeEmail(request.to) !== currentEmail) {
            return res.status(403).json({ error: 'Unauthorized: You can only decline requests sent to you.' });
        }
        if (request.status !== 'pending') {
            return res.status(400).json({ error: `Request cannot be declined because its status is '${request.status}'.` });
        }

        const claimed = await friendRequestStore.claim_pending_request(requestId, currentEmail, 'declined');
        if (!claimed) {
            const latest = await friendRequestStore.get_request_by_id(requestId);
            const currentStatus = latest ? latest.status : 'unknown';
            return res.status(400).json({ error: `Request cannot be declined because its status is '${currentStatus}'.` });
        }

        res.json({ success: true, message: 'Friend request declined' });
    } catch (err) {
        console.error('Decline friend request error:', err.message);
        res.status(500).json({ error: 'Database service unavailable' });
    }
});

// Cancel outgoing request
app.delete('/api/friends/requests/:id', isAuthenticated, async (req, res) => {
    try {
        const currentEmail = req.userEmail;
        const requestId = (req.params.id || '').trim();

        const request = await friendRequestStore.get_request_by_id(requestId);
        if (!request) {
            return res.status(404).json({ error: 'Friend request not found.' });
        }
        if (normalizeEmail(request.from) !== currentEmail) {
            return res.status(403).json({ error: 'Unauthorized: You can only cancel requests sent by you.' });
        }
        if (request.status !== 'pending') {
            return res.status(400).json({ error: `Request cannot be cancelled because its status is '${request.status}'.` });
        }

        const deleted = await friendRequestStore.delete_request(requestId, currentEmail, { requirePending: true });
        if (!deleted) {
            const latest = await friendRequestStore.get_request_by_id(requestId);
            if (!latest) {
                return res.status(404).json({ error: 'Friend request not found.' });
            }
            if (normalizeEmail(latest.from) !== currentEmail) {
                return res.status(403).json({ error: 'Unauthorized: You can only cancel requests sent by you.' });
            }
            return res.status(400).json({ error: `Request cannot be cancelled because its status is '${latest.status}'.` });
        }

        res.json({ success: true, message: 'Friend request cancelled' });
    } catch (err) {
        console.error('Cancel friend request error:', err.message);
        res.status(500).json({ error: 'Database service unavailable' });
    }
});

// Direct friend creation is disabled to enforce mutual consent via friend requests
app.post('/api/friends', isAuthenticated, (req, res) => {
    return res.status(403).json({
        error: 'Direct friend creation is disabled to prevent one-sided friendships. Send a mutual friend request via POST /api/friends/requests instead.',
        code: 'DIRECT_FRIEND_CREATION_DISABLED'
    });
});

app.delete('/api/friends/:id', isAuthenticated, async (req, res) => {
    try {
        const currentEmail = req.userEmail;
        const friendId = (req.params.id || '').trim();

        if (!friendId) {
            return res.status(400).json({ error: 'Friend identifier is required.' });
        }

        const currentMap = await fetchUsersByEmails([currentEmail], { includeFriends: true });
        const currentUser = currentMap[currentEmail];
        if (!currentUser) {
            return res.status(404).json({ error: 'User not found.' });
        }
        if (!Array.isArray(currentUser.friends) || currentUser.friends.length === 0) {
            return res.status(404).json({ error: 'Friendship not found in your friends list.' });
        }

        const targetFriendRecord = findFriendRecord(currentUser, friendId);
        if (!targetFriendRecord) {
            return res.status(404).json({ error: 'Friendship not found in your friends list.' });
        }

        const targetEmail = typeof targetFriendRecord === 'string'
            ? normalizeEmail(targetFriendRecord)
            : (targetFriendRecord.email
                ? normalizeEmail(targetFriendRecord.email)
                : (friendId.includes('@') ? normalizeEmail(friendId) : null));

        const updatedCurrentFriends = currentUser.friends.filter(f => f !== targetFriendRecord);

        let otherUser = null;
        let updatedOtherFriends = null;
        if (targetEmail) {
            const targetMap = await fetchUsersByEmails([targetEmail], { includeFriends: true });
            otherUser = targetMap[targetEmail] || null;
            if (otherUser && Array.isArray(otherUser.friends)) {
                updatedOtherFriends = otherUser.friends.filter(f => !friendEntryMatchesEmail(f, currentEmail));
            }
        }

        await saveUserToAuthService({ ...currentUser, email: currentEmail, friends: updatedCurrentFriends });
        if (otherUser && updatedOtherFriends !== null) {
            await saveUserToAuthService({ ...otherUser, email: targetEmail, friends: updatedOtherFriends });
        }

        res.json({ success: true, message: 'Friend removed' });
    } catch (err) {
        console.error('Delete friend error:', err.message);
        res.status(err.statusCode || 500).json({ error: err.statusCode === 503 ? err.message : 'Database service unavailable' });
    }
});

app.get('/api/friendship_graph', isAuthenticated, async (req, res) => {
    try {
        const currentEmail = req.userEmail;
        const rawView = typeof req.query.view === 'string' ? req.query.view.trim().toLowerCase() : '';
        if (rawView && !['map', 'network', 'graph'].includes(rawView)) {
            return res.status(400).json({ error: 'Invalid view parameter. Supported values: map, network.' });
        }
        const isMapView = rawView === 'map';
        const rawFriendId = typeof req.query.friend_id === 'string' ? req.query.friend_id.trim() : '';

        const graphState = await resolveAuthorizedGraphState(currentEmail, rawFriendId);
        if (graphState.errorStatus) {
            return res.status(graphState.errorStatus).json({ error: graphState.errorMessage });
        }

        const {
            scopedGraph,
            directFriendEmails,
            friendRefToEmail,
            filteredFriendRecord,
            filteredFriendEmail,
            suggestedEmails,
            suggestionSet
        } = graphState;

        const [nodes, emails, emailIndexMap] = scopedGraph.buildNodesAndIndexMap();
        const size = emails.length;

        let myMemories = [];
        try {
            const memRes = await axios.get(`${MEMORIES_SERVICE_URL()}/api/internal/memories?owner=${encodeURIComponent(currentEmail)}`, {
                headers: { 'x-internal-secret': INTERNAL_SECRET },
                timeout: 5000
            });
            myMemories = (Array.isArray(memRes.data) ? memRes.data : [])
                .filter(m => m && normalizeEmail(m.owner) === currentEmail);
        } catch (err) {
            console.error('Failed to fetch user memories for graph:', err.message);
            const memErr = new Error('Memories service unavailable');
            memErr.statusCode = 503;
            throw memErr;
        }

        const resolveMemoryFriendEmail = (mf) => {
            if (!mf) return '';
            const raw = typeof mf === 'string'
                ? mf.trim().toLowerCase()
                : String(mf.email || mf.friend_id || mf.id || '').trim().toLowerCase();
            if (!raw) return '';
            return friendRefToEmail.get(raw) || raw;
        };

        if (filteredFriendEmail) {
            myMemories = myMemories.filter(m =>
                Array.isArray(m.friends) && m.friends.some(mf => resolveMemoryFriendEmail(mf) === filteredFriendEmail)
            );
        }

        const memoryEdges = {};
        const memoryLocations = [];
        const ownerIdx = emailIndexMap[currentEmail];

        myMemories.forEach(memory => {
            if (Array.isArray(memory.friends)) {
                const seenFriendIdxs = new Set();
                memory.friends.forEach(mf => {
                    const resolvedFriendEmail = resolveMemoryFriendEmail(mf);
                    if (!resolvedFriendEmail) return;
                    if (filteredFriendEmail && resolvedFriendEmail !== filteredFriendEmail) return;
                    if (emailIndexMap[resolvedFriendEmail] !== undefined && ownerIdx !== undefined) {
                        const friendIdx = emailIndexMap[resolvedFriendEmail];
                        if (friendIdx === ownerIdx || seenFriendIdxs.has(friendIdx)) return;
                        seenFriendIdxs.add(friendIdx);
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
            if (memory.location && String(memory.location).trim()) {
                memoryLocations.push({
                    title: memory.title || '',
                    location: memory.location,
                    id: memory.memory_id || ''
                });
            }
        });

        const userTypes = emails.map(email => {
            if (email === currentEmail) return 'current';
            if (directFriendEmails.has(email)) return 'friend';
            if (suggestionSet && suggestionSet.has(email)) return 'suggestion';
            return 'other';
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

        const suggestedFriends = suggestedEmails.map(email => nodes[email] ? nodes[email].name : email);

        res.json({
            view: isMapView ? 'map' : 'network',
            friendId: rawFriendId || null,
            filteredFriend: filteredFriendEmail ? {
                email: filteredFriendEmail,
                name: nodes[filteredFriendEmail] ? nodes[filteredFriendEmail].name : ((filteredFriendRecord && filteredFriendRecord.name) || filteredFriendEmail),
                friend_id: (filteredFriendRecord && (filteredFriendRecord.friend_id || filteredFriendRecord.id)) || ''
            } : null,
            userCount: size,
            currentUserIndex: emailIndexMap[currentEmail] !== undefined ? emailIndexMap[currentEmail] : -1,
            users: Object.values(nodes),
            nodeTypes: userTypes,
            nodePositions,
            emailIndexMap,
            adjacencyList: scopedGraph.toAdjacencyList(),
            memoryEdges,
            memoryLocations,
            suggestedFriends
        });
    } catch (err) {
        console.error('Friendship graph error:', err.message);
        res.status(err.statusCode || 500).json({ error: err.statusCode === 503 ? err.message : 'Database service unavailable' });
    }
});

app.get('/api/social/adjacency_list', isAuthenticated, async (req, res) => {
    try {
        const currentEmail = req.userEmail;
        const rawFriendId = typeof req.query.friend_id === 'string' ? req.query.friend_id.trim() : '';

        const graphState = await resolveAuthorizedGraphState(currentEmail, rawFriendId);
        if (graphState.errorStatus) {
            return res.status(graphState.errorStatus).json({ error: graphState.errorMessage });
        }

        const { scopedGraph } = graphState;
        res.json({
            vertexCount: scopedGraph.vertexCount(),
            edgeCount: scopedGraph.edgeCount(),
            adjacencyList: scopedGraph.toAdjacencyList()
        });
    } catch (err) {
        console.error('Adjacency list error:', err.message);
        res.status(err.statusCode || 500).json({ error: err.statusCode === 503 ? err.message : 'Database service unavailable' });
    }
});

app.use(handleUploadError);
app.use((err, req, res, next) => {
    console.error('Unhandled Social Error:', err.message);
    res.status(500).json({ error: isProduction ? 'Internal Server Error' : (err.message || 'Internal Server Error') });
});

registerHealthRoutes({
    app,
    serviceName: 'social-service',
    displayName: 'Social Service',
    mongodb,
    isDbConnected: () => friendRequestStore.isDbConnected()
});

const startServer = createServiceStarter({
    app,
    port: PORT,
    displayName: 'Social Service',
    mongodb
});

if (require.main === module) {
    startServer();
}

module.exports = { app, startServer, friendRequestStore };
