require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const axios = require('axios');
const userStore = require('./src/bucket_user_store');

const hasLocalShared = fs.existsSync(path.join(__dirname, 'shared'));
const mongodb = hasLocalShared ? require('./shared/mongodb') : require('../shared/mongodb');
const {
    createUploadMiddleware,
    handleUploadError,
    deleteS3Object,
    deleteS3Objects,
    extractS3Keys,
    getMediaUrl
} = hasLocalShared ? require('./shared/s3_storage') : require('../shared/s3_storage');
const metrics = hasLocalShared ? require('./shared/metrics') : require('../shared/metrics');
const {
    normalizeEmail,
    escapeRegex,
    removeEmailFromFriendsArray,
    replaceEmailInFriendsArray,
    createIsAuthenticated,
    createIsInternalService,
    registerHealthRoutes,
    createServiceStarter
} = hasLocalShared ? require('./shared/service_common') : require('../shared/service_common');

const app = express();
const PORT = process.env.PORT || 3001;
const isProduction = process.env.NODE_ENV === 'production';

const MEMORIES_SERVICE_URL = () => process.env.MEMORIES_SERVICE_URL || 'http://memories-service:3002';
const SOCIAL_SERVICE_URL = () => process.env.SOCIAL_SERVICE_URL || 'http://social-service:3003';
const SHARING_SERVICE_URL = () => process.env.SHARING_SERVICE_URL || 'http://sharing-service:3004';

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
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
    console.error('FATAL: JWT_SECRET environment variable is required.');
    process.exit(1);
}

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(metrics.metricsMiddleware);
app.get('/metrics', metrics.metricsEndpoint);

const uploadSignupProfilePic = createUploadMiddleware(multer, {
    bucket: process.env.AWS_S3_BUCKET || 'default-bucket',
    prefix: 'users/',
    category: 'image',
    fieldName: 'profilePic',
    multiple: false
});

const uploadUpdateProfilePic = createUploadMiddleware(multer, {
    bucket: process.env.AWS_S3_BUCKET || 'default-bucket',
    prefix: 'users/',
    category: 'image',
    fieldName: 'profile_pic',
    multiple: false
});

const isAuthenticated = createIsAuthenticated(GATEWAY_SECRET, INTERNAL_SECRET, isProduction);
const isAuthorizedSession = createIsAuthenticated(GATEWAY_SECRET, INTERNAL_SECRET, isProduction, { allowMissingEmail: true });
const isInternalService = createIsInternalService(INTERNAL_SECRET);

function isValidEmailFormat(email) {
    return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

function signAuthToken(email, username) {
    return jwt.sign(
        { email, username: username || '' },
        JWT_SECRET,
        { expiresIn: '24h' }
    );
}

// Resolve consistent name fields across camelCase, snake_case, or legacy name-only records
function resolveUserNames(user) {
    if (!user || typeof user !== 'object') {
        return { firstName: '', lastName: '', first_name: '', last_name: '', name: '' };
    }
    const snakeFirst = typeof user.first_name === 'string' ? user.first_name.trim() : '';
    const snakeLast = typeof user.last_name === 'string' ? user.last_name.trim() : '';
    const camelFirst = typeof user.firstName === 'string' ? user.firstName.trim() : '';
    const camelLast = typeof user.lastName === 'string' ? user.lastName.trim() : '';

    let first = snakeFirst || camelFirst;
    let last = snakeLast || camelLast;

    if (!first && !last && typeof user.name === 'string' && user.name.trim()) {
        const parts = user.name.trim().split(/\s+/);
        first = parts[0] || '';
        last = parts.slice(1).join(' ');
    }

    const fullName = `${first} ${last}`.trim() ||
        (typeof user.name === 'string' ? user.name.trim() : '') ||
        (typeof user.username === 'string' ? user.username.trim() : '');

    return {
        firstName: first,
        lastName: last,
        first_name: first,
        last_name: last,
        name: fullName
    };
}

function buildUserPayload(email, username, names) {
    return {
        email,
        username: username || '',
        name: names.name,
        firstName: names.firstName,
        lastName: names.lastName,
        first_name: names.first_name,
        last_name: names.last_name
    };
}

// Sanitize friends array without exposing internal DB or auth fields
async function sanitizeFriendsList(friends) {
    if (!Array.isArray(friends)) return [];
    const seen = new Set();
    const sanitized = [];

    for (const entry of friends) {
        if (!entry) continue;
        if (typeof entry === 'string') {
            const em = normalizeEmail(entry);
            if (!em || seen.has(em)) continue;
            seen.add(em);
            sanitized.push({
                friend_id: em,
                name: em,
                email: em,
                relationship_type: '',
                how_you_met: '',
                image_url: ''
            });
            continue;
        }
        if (typeof entry !== 'object') continue;

        const em = normalizeEmail(entry.email);
        const dedupeKey = em || (entry.friend_id ? String(entry.friend_id).trim() : '') || (entry.id ? String(entry.id).trim() : '');
        if (dedupeKey) {
            if (seen.has(dedupeKey)) continue;
            seen.add(dedupeKey);
        }

        const friendCopy = { ...entry };
        delete friendCopy._id;
        delete friendCopy.password;
        delete friendCopy.passwordHash;
        delete friendCopy.bucket_id;
        delete friendCopy.__v;

        if (em) friendCopy.email = em;
        if (!friendCopy.name) {
            const friendNames = resolveUserNames(friendCopy);
            if (friendNames.name) {
                friendCopy.name = friendNames.name;
            }
        }
        if (friendCopy.image_url && typeof friendCopy.image_url === 'object' && friendCopy.image_url.provider === 's3') {
            friendCopy.image_url = await getMediaUrl(friendCopy.image_url);
        }

        sanitized.push(friendCopy);
    }

    return sanitized;
}

// Signup Route
app.post('/api/signup', uploadSignupProfilePic, async (req, res) => {
    const uploadedKey = req.file && req.file.provider === 's3' ? req.file.key : null;
    try {
        const rawFirst = req.body.firstName !== undefined ? req.body.firstName : req.body.first_name;
        const rawLast = req.body.lastName !== undefined ? req.body.lastName : req.body.last_name;
        const cleanFirst = typeof rawFirst === 'string' ? rawFirst.trim() : '';
        const cleanLast = typeof rawLast === 'string' ? rawLast.trim() : '';
        const cleanUsername = typeof req.body.username === 'string' ? req.body.username.trim() : '';
        const lowerEmail = normalizeEmail(req.body.email);
        const password = typeof req.body.password === 'string' ? req.body.password : '';

        if (!cleanFirst || !cleanLast || !cleanUsername || !lowerEmail || !password) {
            if (uploadedKey) await deleteS3Object(uploadedKey);
            return res.status(400).json({ error: 'All fields are required.' });
        }
        if (!isValidEmailFormat(lowerEmail)) {
            if (uploadedKey) await deleteS3Object(uploadedKey);
            return res.status(400).json({ error: 'Please enter a valid email address.' });
        }
        if (!/^[A-Za-z0-9_]{3,20}$/.test(cleanUsername)) {
            if (uploadedKey) await deleteS3Object(uploadedKey);
            return res.status(400).json({ error: 'Username must be 3-20 characters and contain only letters, numbers, and underscores.' });
        }
        if (password.length < 8) {
            if (uploadedKey) await deleteS3Object(uploadedKey);
            return res.status(400).json({ error: 'Password must be at least 8 characters.' });
        }
        if (await userStore.get_user(lowerEmail)) {
            if (uploadedKey) await deleteS3Object(uploadedKey);
            return res.status(400).json({ error: 'Email is already registered.' });
        }
        if (await userStore.username_exists(cleanUsername)) {
            if (uploadedKey) await deleteS3Object(uploadedKey);
            return res.status(400).json({ error: 'This username is already taken.' });
        }

        const hashedPassword = bcrypt.hashSync(password, 10);
        const newUser = {
            name: `${cleanFirst} ${cleanLast}`.trim(),
            firstName: cleanFirst,
            lastName: cleanLast,
            first_name: cleanFirst,
            last_name: cleanLast,
            username: cleanUsername,
            email: lowerEmail,
            password: hashedPassword,
            profile_pic: req.file
                ? (req.file.provider === 's3'
                    ? { provider: 's3', key: req.file.key, mimeType: req.file.mimeType, fileName: req.file.fileName, size: req.file.size }
                    : 'uploads/' + req.file.filename)
                : '',
            friends: []
        };

        await userStore.add_user(newUser.email, newUser);
        metrics.userRegistrationsTotal.inc();

        res.json({
            success: true,
            message: 'Signup successful',
            token: signAuthToken(newUser.email, newUser.username),
            user: buildUserPayload(newUser.email, newUser.username, newUser),
            redirect: '/login.html'
        });
    } catch (err) {
        if (uploadedKey) await deleteS3Object(uploadedKey);
        console.error('Signup error:', err.message);
        res.status(500).json({ error: 'Database service unavailable' });
    }
});

// Login Route
app.post('/api/login', async (req, res) => {
    try {
        const lowerEmail = normalizeEmail(req.body.email);
        const password = typeof req.body.password === 'string' ? req.body.password : '';
        if (!lowerEmail || !password) {
            return res.status(400).json({ error: 'Email and password are required.' });
        }

        const user = await userStore.get_user(lowerEmail);
        let passwordMatch = false;
        if (user && user.password) {
            try {
                passwordMatch = bcrypt.compareSync(password, user.password);
            } catch (_) {
                passwordMatch = false;
            }
        }

        if (!passwordMatch) {
            metrics.failedLoginsTotal.inc();
            return res.status(401).json({ error: 'Invalid email or password.' });
        }

        metrics.successfulLoginsTotal.inc();
        const names = resolveUserNames(user);
        const normalizedUserEmail = normalizeEmail(user.email) || lowerEmail;
        return res.json({
            success: true,
            message: 'Login successful',
            token: signAuthToken(normalizedUserEmail, user.username),
            user: buildUserPayload(normalizedUserEmail, user.username, names),
            redirect: '/home.html'
        });
    } catch (err) {
        console.error('Login error:', err.message);
        res.status(500).json({ error: 'Database service unavailable' });
    }
});

// Logout Route
app.post('/api/logout', (req, res) => {
    res.json({ success: true, message: 'Logged out successfully', redirect: '/login.html' });
});

// Current User Info
app.get('/api/current_user', isAuthorizedSession, async (req, res) => {
    try {
        const normalizedEmail = req.userEmail;
        if (!normalizedEmail) {
            return res.json({ loggedin: false, friends: [] });
        }

        const user = await userStore.get_user(normalizedEmail);
        if (!user) {
            return res.status(404).json({ loggedin: false, error: 'User not found', friends: [] });
        }

        const names = resolveUserNames(user);
        const friends = await sanitizeFriendsList(user.friends);

        res.json({
            loggedin: true,
            ...buildUserPayload(normalizeEmail(user.email) || normalizedEmail, user.username, names),
            friends
        });
    } catch (err) {
        console.error('Current user error:', err.message);
        res.status(500).json({ error: 'Database service unavailable' });
    }
});

// Profile Data - Never expose password hash or internal DB fields
app.get('/api/users/profile_data', isAuthenticated, async (req, res) => {
    try {
        const user = await userStore.get_user(req.userEmail);
        if (!user) return res.status(404).json({ error: 'User not found' });

        const names = resolveUserNames(user);
        const userCopy = { ...user };
        delete userCopy.password;
        delete userCopy.passwordHash;
        delete userCopy._id;
        delete userCopy.bucket_id;
        delete userCopy.__v;

        userCopy.email = normalizeEmail(user.email) || req.userEmail;
        userCopy.name = names.name;
        userCopy.firstName = names.firstName;
        userCopy.lastName = names.lastName;
        userCopy.first_name = names.first_name;
        userCopy.last_name = names.last_name;
        userCopy.friends = await sanitizeFriendsList(user.friends);
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
        const rows = await userStore.list_users_public();
        const flatUsers = await Promise.all(rows.map(async u => {
            const names = resolveUserNames(u);
            return {
                ...buildUserPayload(normalizeEmail(u.email), u.username, names),
                profile_pic: await getMediaUrl(u.profile_pic)
            };
        }));
        res.json(flatUsers);
    } catch (err) {
        console.error('Users search error:', err.message);
        res.status(500).json({ error: 'Database service unavailable' });
    }
});

function sanitizeInternalUserDoc(u, { includeFriends = false, includeProfilePic = false } = {}) {
    if (!u || typeof u !== 'object') return null;
    const names = resolveUserNames(u);
    const out = {
        ...buildUserPayload(normalizeEmail(u.email), u.username, names),
        bucket_id: u.bucket_id || userStore.get_bucket(u.email)
    };
    if (includeFriends) {
        out.friends = Array.isArray(u.friends) ? u.friends : [];
    }
    if (includeProfilePic) {
        out.profile_pic = u.profile_pic || '';
    }
    return out;
}

// Targeted internal batch lookup utilizing A-Z bucket_id compound index
app.post('/api/internal/users/lookup', isInternalService, async (req, res) => {
    try {
        const rawEmails = Array.isArray(req.body && req.body.emails) ? req.body.emails : [];
        const uniqueEmails = [...new Set(rawEmails.map(normalizeEmail).filter(Boolean))].slice(0, 200);
        if (uniqueEmails.length === 0) {
            return res.json({ users: {} });
        }

        const includeFriends = !!(req.body && req.body.includeFriends);
        const includeProfilePic = !!(req.body && req.body.includeProfilePic);
        const projection = {
            _id: 0,
            email: 1,
            bucket_id: 1,
            username: 1,
            name: 1,
            firstName: 1,
            lastName: 1,
            first_name: 1,
            last_name: 1,
            ...(includeFriends ? { friends: 1 } : {}),
            ...(includeProfilePic ? { profile_pic: 1 } : {})
        };

        const foundMap = await userStore.find_users_by_emails(uniqueEmails, { projection });
        const users = {};
        for (const [em, doc] of Object.entries(foundMap)) {
            users[em] = sanitizeInternalUserDoc(doc, { includeFriends, includeProfilePic });
        }
        res.json({ users });
    } catch (err) {
        console.error('Internal users lookup error:', err.message);
        res.status(500).json({ error: 'Database service unavailable' });
    }
});

// Projected internal graph endpoint returning strictly the authorized 2-hop BFS neighborhood
app.get('/api/internal/users/graph_nodes', isInternalService, async (req, res) => {
    try {
        const centerEmail = normalizeEmail(req.query && req.query.center);
        const graphProjection = {
            _id: 0,
            email: 1,
            bucket_id: 1,
            username: 1,
            name: 1,
            firstName: 1,
            lastName: 1,
            first_name: 1,
            last_name: 1,
            friends: 1
        };

        if (!centerEmail) {
            const allBuckets = await userStore.load_users({ projection: graphProjection });
            const cleanBuckets = userStore.initializeBuckets();
            for (const bucket in allBuckets) {
                for (const em in allBuckets[bucket]) {
                    const sanitized = sanitizeInternalUserDoc(allBuckets[bucket][em], { includeFriends: true, includeProfilePic: false });
                    if (sanitized && sanitized.email) {
                        cleanBuckets[bucket][sanitized.email] = sanitized;
                    }
                }
            }
            return res.json(cleanBuckets);
        }

        const buckets = userStore.initializeBuckets();
        const centerMap = await userStore.find_users_by_emails([centerEmail], { projection: graphProjection });
        const centerDoc = centerMap[centerEmail];
        if (!centerDoc) {
            return res.json(buckets);
        }

        const addToBuckets = (sanitizedDoc) => {
            if (!sanitizedDoc || !sanitizedDoc.email) return;
            const b = sanitizedDoc.bucket_id || userStore.get_bucket(sanitizedDoc.email);
            if (!buckets[b]) buckets[b] = {};
            buckets[b][sanitizedDoc.email] = sanitizedDoc;
        };

        addToBuckets(sanitizeInternalUserDoc(centerDoc, { includeFriends: true }));

        const extractFriendEmails = (uDoc) => {
            const list = [];
            if (!uDoc || !Array.isArray(uDoc.friends)) return list;
            for (const f of uDoc.friends) {
                if (!f) continue;
                const fe = typeof f === 'string'
                    ? normalizeEmail(f)
                    : normalizeEmail(f.email || f.id || f.friend_id);
                if (fe && fe !== centerEmail) list.push(fe);
            }
            return list;
        };

        const directEmails = [...new Set(extractFriendEmails(centerDoc))];
        const level1Map = directEmails.length > 0
            ? await userStore.find_users_by_emails(directEmails, { projection: graphProjection })
            : {};

        const level2Candidates = new Set();
        const directSet = new Set(directEmails);
        for (const fEmail of Object.keys(level1Map)) {
            const fDoc = level1Map[fEmail];
            addToBuckets(sanitizeInternalUserDoc(fDoc, { includeFriends: true }));
            for (const f2Email of extractFriendEmails(fDoc)) {
                if (f2Email !== centerEmail && !directSet.has(f2Email)) {
                    level2Candidates.add(f2Email);
                }
            }
        }

        if (level2Candidates.size > 0) {
            const level2Projection = {
                _id: 0,
                email: 1,
                bucket_id: 1,
                username: 1,
                name: 1,
                firstName: 1,
                lastName: 1,
                first_name: 1,
                last_name: 1
            };
            const level2Map = await userStore.find_users_by_emails(Array.from(level2Candidates), { projection: level2Projection });
            for (const f2Email of Object.keys(level2Map)) {
                addToBuckets(sanitizeInternalUserDoc(level2Map[f2Email], { includeFriends: false }));
            }
        }

        res.json(buckets);
    } catch (err) {
        console.error('Internal graph_nodes error:', err.message);
        res.status(500).json({ error: 'Database service unavailable' });
    }
});

app.post('/api/internal/users', isInternalService, async (req, res) => {
    try {
        const user = req.body;
        const normalizedEmail = normalizeEmail(user && user.email);
        if (user && normalizedEmail) {
            const names = resolveUserNames(user);
            const docToSave = {
                ...user,
                email: normalizedEmail,
                name: names.name || user.name || '',
                firstName: names.firstName,
                lastName: names.lastName,
                first_name: names.first_name,
                last_name: names.last_name
            };
            await userStore.add_user(normalizedEmail, docToSave);
            res.json({ success: true });
        } else {
            res.status(400).json({ error: 'Invalid user object' });
        }
    } catch (err) {
        console.error('Internal users save error:', err.message);
        res.status(500).json({ error: 'Database service unavailable' });
    }
});

async function internalServicePost(url, body) {
    return axios.post(url, body, {
        headers: { 'x-internal-secret': INTERNAL_SECRET },
        timeout: 5000
    });
}

async function notifySharingHeapRefresh() {
    try {
        await internalServicePost(`${SHARING_SERVICE_URL()}/api/internal/capsules/refresh_heap`, {});
    } catch (err) {
        console.warn('Auth Service: Best-effort sharing heap refresh skipped:', err.message);
    }
}

async function filterUnreferencedS3Keys(candidateKeys) {
    if (!Array.isArray(candidateKeys) || candidateKeys.length === 0) return [];
    const uniqueCandidates = [...new Set(candidateKeys.filter(k => typeof k === 'string' && k.trim()))];
    if (uniqueCandidates.length === 0) return [];

    if (!mongodb || typeof mongodb.isConnected !== 'function' || !mongodb.isConnected()) {
        return uniqueCandidates;
    }

    const stillReferenced = new Set();
    const referenceQueries = [
        {
            colName: mongodb.COLLECTIONS.USERS,
            filter: {
                $or: [
                    { 'profile_pic.key': { $in: uniqueCandidates } },
                    { 'friends.image_url.key': { $in: uniqueCandidates } },
                    { profile_pic: { $in: uniqueCandidates } },
                    { 'friends.image_url': { $in: uniqueCandidates } }
                ]
            },
            projection: { _id: 0, profile_pic: 1, 'friends.image_url': 1 }
        },
        {
            colName: mongodb.COLLECTIONS.MEMORIES,
            filter: {
                $or: [
                    { 'media.url.key': { $in: uniqueCandidates } },
                    { 'media.path.key': { $in: uniqueCandidates } },
                    { 'media.key': { $in: uniqueCandidates } },
                    { 'image.key': { $in: uniqueCandidates } },
                    { 'image.url.key': { $in: uniqueCandidates } }
                ]
            },
            projection: { _id: 0, media: 1, image: 1 }
        },
        {
            colName: mongodb.COLLECTIONS.FRIEND_REQUESTS,
            filter: {
                $or: [
                    { 'image_url.key': { $in: uniqueCandidates } },
                    { image_url: { $in: uniqueCandidates } }
                ]
            },
            projection: { _id: 0, image_url: 1 }
        },
        {
            colName: mongodb.COLLECTIONS.SHARED_MEMORIES,
            filter: {
                $or: [
                    { 'attachments.key': { $in: uniqueCandidates } },
                    { 'attachments.url.key': { $in: uniqueCandidates } },
                    { 'media.url.key': { $in: uniqueCandidates } },
                    { 'media.path.key': { $in: uniqueCandidates } },
                    { 'media.key': { $in: uniqueCandidates } },
                    { 'image.key': { $in: uniqueCandidates } },
                    { 'image.url.key': { $in: uniqueCandidates } }
                ]
            },
            projection: { _id: 0, attachments: 1, media: 1, image: 1 }
        },
        {
            colName: mongodb.COLLECTIONS.TIME_CAPSULES,
            filter: {
                $or: [
                    { 'media.path.key': { $in: uniqueCandidates } },
                    { 'media.url.key': { $in: uniqueCandidates } },
                    { 'media.key': { $in: uniqueCandidates } }
                ]
            },
            projection: { _id: 0, media: 1 }
        }
    ];

    for (const { colName, filter, projection } of referenceQueries) {
        try {
            const col = mongodb.getCollection(colName);
            if (!col || typeof col.find !== 'function') continue;
            const docs = await col.find(filter, { projection }).toArray();
            for (const doc of docs) {
                extractS3Keys(doc, stillReferenced);
            }
        } catch (err) {
            console.warn(`S3 reference check failed for ${colName}; skipping S3 cleanup to avoid data loss:`, err.message);
            return [];
        }
    }

    return uniqueCandidates.filter(k => !stillReferenced.has(k));
}

async function executeTransactionalEmailUpdate(oldEmail, newEmail, updatedDetails) {
    const client = mongodb.getClient();
    const session = client.startSession();
    try {
        const oldRegex = new RegExp(`^${escapeRegex(oldEmail)}$`, 'i');
        const memFriendFilter = {
            $or: [
                { friends: oldEmail },
                { friends: oldRegex },
                { 'friends.email': oldEmail },
                { 'friends.email': oldRegex },
                { 'friends.friend_id': oldEmail },
                { 'friends.friend_id': oldRegex },
                { 'friends.id': oldEmail },
                { 'friends.id': oldRegex }
            ]
        };
        await session.withTransaction(async () => {
            await userStore.update_user_email(oldEmail, newEmail, updatedDetails, session);

            const memoriesCol = mongodb.getCollection(mongodb.COLLECTIONS.MEMORIES);
            await memoriesCol.updateMany(
                { $or: [{ owner: oldEmail }, { owner: { $regex: oldRegex } }] },
                { $set: { owner: newEmail } },
                { session }
            );
            const taggedMemories = await memoriesCol.find(memFriendFilter, {
                session,
                projection: { _id: 0, memory_id: 1, friends: 1 }
            }).toArray();
            for (const mem of taggedMemories) {
                if (!Array.isArray(mem.friends) || mem.friends.length === 0) continue;
                const { changed, updated } = replaceEmailInFriendsArray(mem.friends, oldEmail, newEmail);
                if (changed) {
                    await memoriesCol.updateOne({ memory_id: mem.memory_id }, { $set: { friends: updated } }, { session });
                }
            }

            const freqCol = mongodb.getCollection(mongodb.COLLECTIONS.FRIEND_REQUESTS);
            const freqMatches = await freqCol.find({
                $or: [{ from: oldEmail }, { to: oldEmail }, { from: { $regex: oldRegex } }, { to: { $regex: oldRegex } }]
            }, { session }).toArray();
            for (const doc of freqMatches) {
                const nextFrom = normalizeEmail(doc.from) === oldEmail ? newEmail : doc.from;
                const nextTo = normalizeEmail(doc.to) === oldEmail ? newEmail : doc.to;
                const nextPairKey = doc.status === 'pending'
                    ? [normalizeEmail(nextFrom), normalizeEmail(nextTo)].sort().join('|')
                    : null;
                if (nextFrom !== doc.from || nextTo !== doc.to || (doc.status === 'pending' && nextPairKey !== doc.pending_pair_key)) {
                    const patch = { from: nextFrom, to: nextTo, updated_at: new Date().toISOString() };
                    if (doc.status === 'pending') {
                        patch.pending_pair_key = nextPairKey;
                    }
                    await freqCol.updateOne({ id: doc.id }, { $set: patch }, { session });
                }
            }

            const sharesCol = mongodb.getCollection(mongodb.COLLECTIONS.SHARED_MEMORIES);
            const matchedShares = await sharesCol.find({
                $or: [
                    { from: oldEmail },
                    { to: oldEmail },
                    { original_owner: oldEmail },
                    { from: { $regex: oldRegex } },
                    { to: { $regex: oldRegex } },
                    { original_owner: { $regex: oldRegex } },
                    ...memFriendFilter.$or
                ]
            }, {
                session,
                projection: { _id: 0, memory_id: 1, from: 1, to: 1, original_owner: 1, friends: 1 }
            }).toArray();
            for (const share of matchedShares) {
                const patch = {};
                if (normalizeEmail(share.from) === oldEmail) patch.from = newEmail;
                if (normalizeEmail(share.to) === oldEmail) patch.to = newEmail;
                if (normalizeEmail(share.original_owner) === oldEmail) patch.original_owner = newEmail;
                if (Array.isArray(share.friends) && share.friends.length > 0) {
                    const { changed, updated } = replaceEmailInFriendsArray(share.friends, oldEmail, newEmail);
                    if (changed) patch.friends = updated;
                }
                if (Object.keys(patch).length > 0) {
                    await sharesCol.updateOne({ memory_id: share.memory_id }, { $set: patch }, { session });
                }
            }

            const capsulesCol = mongodb.getCollection(mongodb.COLLECTIONS.TIME_CAPSULES);
            const capMatches = await capsulesCol.find({
                $or: [
                    { user_email: oldEmail },
                    { recipient_email: oldEmail },
                    { user_email: { $regex: oldRegex } },
                    { recipient_email: { $regex: oldRegex } }
                ]
            }, { session }).toArray();
            for (const cap of capMatches) {
                const patch = {};
                if (normalizeEmail(cap.user_email) === oldEmail) patch.user_email = newEmail;
                if (normalizeEmail(cap.recipient_email) === oldEmail) patch.recipient_email = newEmail;
                if (Object.keys(patch).length > 0) {
                    await capsulesCol.updateOne({ id: cap.id }, { $set: patch }, { session });
                }
            }
        });
    } finally {
        if (typeof session.endSession === 'function') {
            await session.endSession();
        }
    }
}

async function executeSagaEmailUpdate(oldEmail, newEmail, updatedDetails) {
    const authSnapshot = await userStore.update_user_email(oldEmail, newEmail, updatedDetails);
    const completedDownstream = [];
    const downstreamSteps = [
        { name: 'memories', url: `${MEMORIES_SERVICE_URL()}/api/internal/memories/update_email` },
        { name: 'social', url: `${SOCIAL_SERVICE_URL()}/api/internal/friends/update_email` },
        { name: 'sharing', url: `${SHARING_SERVICE_URL()}/api/internal/sharing/update_email` }
    ];

    try {
        for (const step of downstreamSteps) {
            await internalServicePost(step.url, { oldEmail, newEmail });
            completedDownstream.push(step);
        }
    } catch (stepErr) {
        for (const completed of completedDownstream.reverse()) {
            try {
                await internalServicePost(completed.url, { oldEmail: newEmail, newEmail: oldEmail });
            } catch (rbErr) {
                console.error(`Critical rollback failure reversing email update on ${completed.name}:`, rbErr.message);
            }
        }
        try {
            await userStore.restore_user_email_update(oldEmail, newEmail, authSnapshot);
        } catch (authRbErr) {
            console.error('Critical rollback failure restoring auth user email:', authRbErr.message);
        }
        const err = new Error('Failed to propagate email update consistently across services; changes were rolled back.');
        err.statusCode = 502;
        err.cause = stepErr;
        throw err;
    }
}

async function executeTransactionalAccountDelete(targetEmail) {
    const client = mongodb.getClient();
    const session = client.startSession();
    const candidateS3Keys = [];

    try {
        const targetRegex = new RegExp(`^${escapeRegex(targetEmail)}$`, 'i');
        const targetFriendFilter = {
            $or: [
                { friends: targetEmail },
                { friends: targetRegex },
                { 'friends.email': targetEmail },
                { 'friends.email': targetRegex },
                { 'friends.friend_id': targetEmail },
                { 'friends.friend_id': targetRegex },
                { 'friends.id': targetEmail },
                { 'friends.id': targetRegex }
            ]
        };
        await session.withTransaction(async () => {
            const memoriesCol = mongodb.getCollection(mongodb.COLLECTIONS.MEMORIES);
            const ownedMemories = await memoriesCol.find({
                $or: [{ owner: targetEmail }, { owner: { $regex: targetRegex } }]
            }, { session }).toArray();
            candidateS3Keys.push(...extractS3Keys(ownedMemories));
            if (ownedMemories.length > 0) {
                await memoriesCol.deleteMany({
                    $or: [{ owner: targetEmail }, { owner: { $regex: targetRegex } }]
                }, { session });
            }
            const remainingMemories = await memoriesCol.find(targetFriendFilter, {
                session,
                projection: { _id: 0, memory_id: 1, friends: 1 }
            }).toArray();
            for (const mem of remainingMemories) {
                if (!Array.isArray(mem.friends) || mem.friends.length === 0) continue;
                const { changed, updated } = removeEmailFromFriendsArray(mem.friends, targetEmail);
                if (changed) {
                    await memoriesCol.updateOne({ memory_id: mem.memory_id }, { $set: { friends: updated } }, { session });
                }
            }

            const freqCol = mongodb.getCollection(mongodb.COLLECTIONS.FRIEND_REQUESTS);
            const freqFilter = {
                $or: [{ from: targetEmail }, { to: targetEmail }, { from: { $regex: targetRegex } }, { to: { $regex: targetRegex } }]
            };
            const matchedRequests = await freqCol.find(freqFilter, { session }).toArray();
            for (const r of matchedRequests) {
                for (const key of extractS3Keys(r && r.image_url)) {
                    if (key.startsWith('friends/')) candidateS3Keys.push(key);
                }
            }
            if (matchedRequests.length > 0) {
                await freqCol.deleteMany(freqFilter, { session });
            }

            const sharesCol = mongodb.getCollection(mongodb.COLLECTIONS.SHARED_MEMORIES);
            const shareFilter = {
                $or: [{ from: targetEmail }, { to: targetEmail }, { from: { $regex: targetRegex } }, { to: { $regex: targetRegex } }]
            };
            const matchedShares = await sharesCol.find(shareFilter, { session }).toArray();
            candidateS3Keys.push(...extractS3Keys(matchedShares));
            if (matchedShares.length > 0) {
                await sharesCol.deleteMany(shareFilter, { session });
            }
            const remainingShares = await sharesCol.find(targetFriendFilter, {
                session,
                projection: { _id: 0, memory_id: 1, friends: 1 }
            }).toArray();
            for (const s of remainingShares) {
                if (!Array.isArray(s.friends) || s.friends.length === 0) continue;
                const { changed, updated } = removeEmailFromFriendsArray(s.friends, targetEmail);
                if (changed) {
                    await sharesCol.updateOne({ memory_id: s.memory_id }, { $set: { friends: updated } }, { session });
                }
            }

            const capsulesCol = mongodb.getCollection(mongodb.COLLECTIONS.TIME_CAPSULES);
            const capFilter = {
                $or: [
                    { user_email: targetEmail },
                    { recipient_email: targetEmail },
                    { user_email: { $regex: targetRegex } },
                    { recipient_email: { $regex: targetRegex } }
                ]
            };
            const matchedCapsules = await capsulesCol.find(capFilter, { session }).toArray();
            candidateS3Keys.push(...extractS3Keys(matchedCapsules));
            if (matchedCapsules.length > 0) {
                await capsulesCol.deleteMany(capFilter, { session });
            }

            await userStore.remove_friend_references(targetEmail, session);
            await userStore.remove_user(targetEmail, session);
        });
    } finally {
        if (typeof session.endSession === 'function') {
            await session.endSession();
        }
    }

    return candidateS3Keys;
}

async function executeSagaAccountDelete(targetEmail, existingUser) {
    const candidateS3Keys = [];
    const rollbacks = [];
    const previousUserSnapshot = existingUser ? { ...existingUser } : null;
    if (previousUserSnapshot) {
        delete previousUserSnapshot._id;
    }

    try {
        const memRes = await internalServicePost(`${MEMORIES_SERVICE_URL()}/api/internal/memories/cleanup_user`, { email: targetEmail });
        if (memRes && memRes.data) {
            if (Array.isArray(memRes.data.s3Keys)) candidateS3Keys.push(...memRes.data.s3Keys);
            rollbacks.push(async () => {
                await internalServicePost(`${MEMORIES_SERVICE_URL()}/api/internal/memories/restore_cleanup`, memRes.data);
            });
        }

        const socialRes = await internalServicePost(`${SOCIAL_SERVICE_URL()}/api/internal/friends/cleanup_user`, { email: targetEmail });
        if (socialRes && socialRes.data) {
            if (Array.isArray(socialRes.data.s3Keys)) candidateS3Keys.push(...socialRes.data.s3Keys);
            rollbacks.push(async () => {
                await internalServicePost(`${SOCIAL_SERVICE_URL()}/api/internal/friends/restore_cleanup`, socialRes.data);
            });
        }

        const sharingRes = await internalServicePost(`${SHARING_SERVICE_URL()}/api/internal/sharing/cleanup_user`, { email: targetEmail });
        if (sharingRes && sharingRes.data) {
            if (Array.isArray(sharingRes.data.s3Keys)) candidateS3Keys.push(...sharingRes.data.s3Keys);
            rollbacks.push(async () => {
                await internalServicePost(`${SHARING_SERVICE_URL()}/api/internal/sharing/restore_cleanup`, sharingRes.data);
            });
        }

        const friendRefResult = await userStore.remove_friend_references(targetEmail);
        rollbacks.push(async () => {
            await userStore.restore_friend_references(friendRefResult.modifiedUsers || []);
        });

        await userStore.remove_user(targetEmail);
        if (previousUserSnapshot) {
            rollbacks.push(async () => {
                await userStore.add_user(targetEmail, previousUserSnapshot);
            });
        }

        return candidateS3Keys;
    } catch (stepErr) {
        for (const undo of rollbacks.reverse()) {
            try {
                await undo();
            } catch (rbErr) {
                console.error('Critical rollback failure during account deletion:', rbErr.message);
            }
        }
        const err = new Error('Failed to delete account data cleanly; changes were rolled back.');
        err.statusCode = 502;
        err.cause = stepErr;
        throw err;
    }
}

app.post('/api/users/profile/update', isAuthenticated, uploadUpdateProfilePic, async (req, res) => {
    const uploadedKey = req.file && req.file.provider === 's3' ? req.file.key : null;
    try {
        const currentEmail = req.userEmail;
        const user = await userStore.get_user(currentEmail);
        if (!user) {
            if (uploadedKey) await deleteS3Object(uploadedKey);
            return res.status(404).json({ error: 'User not found' });
        }

        const existingNames = resolveUserNames(user);
        const rawFirst = req.body.first_name !== undefined ? req.body.first_name : req.body.firstName;
        const rawLast = req.body.last_name !== undefined ? req.body.last_name : req.body.lastName;
        const rawName = req.body.name;
        const cleanUsername = typeof req.body.username === 'string' ? req.body.username.trim() : '';
        const rawEmailInput = req.body.email !== undefined ? String(req.body.email).trim() : '';
        const requestedEmail = rawEmailInput ? normalizeEmail(rawEmailInput) : '';

        if (rawEmailInput && !isValidEmailFormat(requestedEmail)) {
            if (uploadedKey) await deleteS3Object(uploadedKey);
            return res.status(400).json({ error: 'Please enter a valid email address.' });
        }

        let nextFirst = (typeof rawFirst === 'string' && rawFirst.trim()) ? rawFirst.trim() : existingNames.firstName;
        let nextLast = (typeof rawLast === 'string' && rawLast.trim()) ? rawLast.trim() : existingNames.lastName;

        if (!(typeof rawFirst === 'string' && rawFirst.trim()) &&
            !(typeof rawLast === 'string' && rawLast.trim()) &&
            typeof rawName === 'string' && rawName.trim()) {
            const parts = rawName.trim().split(/\s+/);
            nextFirst = parts[0] || nextFirst;
            nextLast = parts.slice(1).join(' ') || nextLast;
        }

        const updatedFields = { ...user };
        delete updatedFields._id;
        updatedFields.firstName = nextFirst;
        updatedFields.lastName = nextLast;
        updatedFields.first_name = nextFirst;
        updatedFields.last_name = nextLast;
        updatedFields.name = `${nextFirst} ${nextLast}`.trim() || existingNames.name || user.username || '';

        if (cleanUsername && cleanUsername.toLowerCase() !== (user.username || '').trim().toLowerCase()) {
            if (!/^[A-Za-z0-9_]{3,20}$/.test(cleanUsername)) {
                if (uploadedKey) await deleteS3Object(uploadedKey);
                return res.status(400).json({ error: 'Username must be 3-20 characters and contain only letters, numbers, and underscores.' });
            }
            if (await userStore.username_exists(cleanUsername)) {
                if (uploadedKey) await deleteS3Object(uploadedKey);
                return res.status(400).json({ error: 'This username is already taken.' });
            }
            updatedFields.username = cleanUsername;
        } else if (cleanUsername) {
            updatedFields.username = cleanUsername;
        }

        const oldProfilePicKeys = extractS3Keys(user.profile_pic);
        if (req.file) {
            updatedFields.profile_pic = req.file.provider === 's3'
                ? { provider: 's3', key: req.file.key, mimeType: req.file.mimeType, fileName: req.file.fileName, size: req.file.size }
                : 'uploads/' + req.file.filename;
        }

        let newToken = null;
        if (requestedEmail && requestedEmail !== normalizeEmail(currentEmail)) {
            if (await userStore.get_user(requestedEmail)) {
                if (uploadedKey) await deleteS3Object(uploadedKey);
                return res.status(400).json({ error: 'Email already in use' });
            }

            let usedTransaction = false;
            if (mongodb && typeof mongodb.canUseTransactions === 'function' && await mongodb.canUseTransactions()) {
                try {
                    await executeTransactionalEmailUpdate(currentEmail, requestedEmail, updatedFields);
                    usedTransaction = true;
                    await notifySharingHeapRefresh();
                } catch (txnErr) {
                    if (!(mongodb && mongodb.isUnsupportedTransactionError(txnErr))) {
                        throw txnErr;
                    }
                }
            }

            if (!usedTransaction) {
                await executeSagaEmailUpdate(currentEmail, requestedEmail, updatedFields);
            }

            updatedFields.email = requestedEmail;
            newToken = signAuthToken(requestedEmail, updatedFields.username);
        } else {
            updatedFields.email = normalizeEmail(user.email) || currentEmail;
            await userStore.add_user(updatedFields.email, updatedFields);
        }

        if (uploadedKey && oldProfilePicKeys.length > 0) {
            const obsoleteKeys = oldProfilePicKeys.filter(k => k !== uploadedKey);
            if (obsoleteKeys.length > 0) {
                await deleteS3Objects(obsoleteKeys);
            }
        }

        const resp = {
            success: true,
            message: 'Profile updated successfully',
            user: buildUserPayload(updatedFields.email, updatedFields.username, updatedFields)
        };
        if (newToken) resp.token = newToken;
        res.json(resp);
    } catch (err) {
        if (uploadedKey) await deleteS3Object(uploadedKey);
        console.error('Profile update error:', err.message);
        res.status(err.statusCode || 500).json({ error: err.statusCode === 502 ? err.message : 'Database service unavailable' });
    }
});

// Password update endpoint
app.post('/api/users/profile/password', isAuthenticated, async (req, res) => {
    try {
        const user = await userStore.get_user(req.userEmail);
        if (!user) return res.status(404).json({ error: 'User not found' });

        const { old_password, new_password, confirm_password } = req.body;
        if (typeof old_password !== 'string' || typeof new_password !== 'string' || typeof confirm_password !== 'string') {
            return res.status(400).json({ error: 'All password fields are required.' });
        }

        let passwordMatch = false;
        try {
            passwordMatch = !!(user && user.password && bcrypt.compareSync(old_password, user.password));
        } catch (_) {
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
            const target = user.friends.find(f => f.friend_id === cleanId || f.id === cleanId || (f.email && normalizeEmail(f.email) === cleanId.toLowerCase()));
            if (target) {
                const origUserFriends = JSON.parse(JSON.stringify(user.friends));
                const nextUserFriends = user.friends.filter(f => f !== target);

                const targetEmail = target.email ? normalizeEmail(target.email) : (cleanId.includes('@') ? cleanId.toLowerCase() : null);
                const otherUser = targetEmail ? await userStore.get_user(targetEmail) : null;
                let nextOtherFriends = null;
                if (otherUser && Array.isArray(otherUser.friends)) {
                    const myEmail = normalizeEmail(currentEmail);
                    nextOtherFriends = otherUser.friends.filter(f => {
                        if (typeof f === 'string') return normalizeEmail(f) !== myEmail;
                        const fe = f.email ? normalizeEmail(f.email) : '';
                        const fi = f.friend_id || f.id || '';
                        return fe !== myEmail && fi !== myEmail;
                    });
                }

                let txDone = false;
                if (mongodb && typeof mongodb.canUseTransactions === 'function' && await mongodb.canUseTransactions()) {
                    const client = mongodb.getClient();
                    const session = client.startSession();
                    try {
                        await session.withTransaction(async () => {
                            await userStore.add_user(user.email, { ...user, friends: nextUserFriends }, session);
                            if (otherUser && nextOtherFriends !== null) {
                                await userStore.add_user(otherUser.email, { ...otherUser, friends: nextOtherFriends }, session);
                            }
                        });
                        txDone = true;
                    } catch (txnErr) {
                        if (!(mongodb && mongodb.isUnsupportedTransactionError(txnErr))) throw txnErr;
                    } finally {
                        if (typeof session.endSession === 'function') {
                            await session.endSession();
                        }
                    }
                }

                if (!txDone) {
                    user.friends = nextUserFriends;
                    await userStore.add_user(user.email, user);

                    if (otherUser && nextOtherFriends !== null) {
                        otherUser.friends = nextOtherFriends;
                        try {
                            await userStore.add_user(otherUser.email, otherUser);
                        } catch (otherErr) {
                            try {
                                user.friends = origUserFriends;
                                await userStore.add_user(user.email, user);
                            } catch (rollbackErr) {
                                console.error('Critical rollback failure during remove_friend:', rollbackErr.message);
                            }
                            throw otherErr;
                        }
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
        const targetEmail = normalizeEmail(req.userEmail);
        const existingUser = await userStore.get_user(targetEmail);
        const candidateS3Keys = [
            ...extractS3Keys(existingUser && existingUser.profile_pic),
            ...extractS3Keys(existingUser && existingUser.friends)
        ];

        let usedTransaction = false;
        if (mongodb && typeof mongodb.canUseTransactions === 'function' && await mongodb.canUseTransactions()) {
            try {
                const txnKeys = await executeTransactionalAccountDelete(targetEmail);
                candidateS3Keys.push(...txnKeys);
                usedTransaction = true;
                await notifySharingHeapRefresh();
            } catch (txnErr) {
                if (!(mongodb && mongodb.isUnsupportedTransactionError(txnErr))) {
                    throw txnErr;
                }
            }
        }

        if (!usedTransaction) {
            const sagaKeys = await executeSagaAccountDelete(targetEmail, existingUser);
            candidateS3Keys.push(...sagaKeys);
        }

        try {
            const safeKeysToDelete = await filterUnreferencedS3Keys(candidateS3Keys);
            if (safeKeysToDelete.length > 0) {
                await deleteS3Objects(safeKeysToDelete);
            }
        } catch (s3Err) {
            console.warn('Account deletion completed, S3 post-cleanup warning:', s3Err.message);
        }

        res.json({
            success: true,
            message: 'Account deleted',
            alreadyDeleted: !existingUser
        });
    } catch (err) {
        console.error('Delete account error:', err.message);
        res.status(err.statusCode || 500).json({ error: err.statusCode === 502 ? err.message : 'Database service unavailable' });
    }
});

app.get('/api/dashboard_data', isAuthenticated, async (req, res) => {
    try {
        const normalizedEmail = normalizeEmail(req.userEmail);
        const user = await userStore.get_user(normalizedEmail);
        if (!user) return res.status(404).json({ error: 'User not found' });

        const names = resolveUserNames(user);
        let userMemories = [];
        if (mongodb && typeof mongodb.isConnected === 'function' && mongodb.isConnected()) {
            const memCollection = mongodb.getCollection(mongodb.COLLECTIONS.MEMORIES);
            let cursor = memCollection.find({ owner: normalizedEmail }, { projection: { _id: 0 } });
            if (typeof cursor.sort === 'function') {
                cursor = cursor.sort({ date: -1, created_at: -1, memory_id: -1 });
            }
            userMemories = await cursor.toArray();
            if (userMemories.length === 0 && user.email && user.email !== normalizedEmail) {
                let fbCursor = memCollection.find({
                    owner: { $regex: new RegExp(`^${escapeRegex(normalizedEmail)}$`, 'i') }
                }, { projection: { _id: 0 } });
                if (typeof fbCursor.sort === 'function') {
                    fbCursor = fbCursor.sort({ date: -1, created_at: -1, memory_id: -1 });
                }
                userMemories = await fbCursor.toArray();
            }
            userMemories = await Promise.all(userMemories.map(async m => {
                if (!m || !Array.isArray(m.media) || m.media.length === 0) return m;
                const mappedMedia = await Promise.all(m.media.map(async mediaItem => {
                    if (mediaItem && mediaItem.url && typeof mediaItem.url === 'object' && mediaItem.url.provider === 's3') {
                        return { ...mediaItem, url: await getMediaUrl(mediaItem.url) };
                    }
                    return mediaItem;
                }));
                return { ...m, media: mappedMedia };
            }));
        } else {
            const memRes = await axios.get(`${MEMORIES_SERVICE_URL()}/api/internal/memories?owner=${encodeURIComponent(normalizedEmail)}&order=desc`, {
                headers: { 'x-internal-secret': INTERNAL_SECRET },
                timeout: 5000
            });
            userMemories = Array.isArray(memRes.data) ? memRes.data : [];
        }

        const sanitizedFriends = await sanitizeFriendsList(user.friends);
        const friendsCount = sanitizedFriends.length;
        const memoryCount = userMemories.length;

        const recentMemories = userMemories.slice(0, 3);
        const recentFriends = sanitizedFriends.slice().reverse().slice(0, 3);

        const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
        const newMemories = userMemories.filter(m => {
            const rawDate = m.created_at || m.date;
            const t = rawDate ? new Date(rawDate).getTime() : 0;
            return t && t >= weekAgo;
        }).length;

        const newFriends = sanitizedFriends.filter(f => {
            const t = new Date(f.date_added).getTime();
            return t && t >= weekAgo;
        }).length;

        let userShared = [];
        try {
            const shareRes = await axios.get(`${SHARING_SERVICE_URL()}/api/internal/shared_memories?user=${encodeURIComponent(normalizedEmail)}`, {
                headers: { 'x-internal-secret': INTERNAL_SECRET },
                timeout: 5000
            });
            userShared = Array.isArray(shareRes.data) ? shareRes.data : [];
        } catch (err) {
            console.error('Failed to fetch shared memories internally:', err.message);
            return res.status(503).json({ error: 'Sharing service unavailable' });
        }

        const sentSharedMemories = userShared
            .filter(m => normalizeEmail(m.from) === normalizedEmail)
            .sort((a, b) => new Date(b.created_at || b.date || 0) - new Date(a.created_at || a.date || 0));
        const unseenReceived = userShared
            .filter(m => normalizeEmail(m.to) === normalizedEmail && !m.seen)
            .sort((a, b) => new Date(b.created_at || b.date || 0) - new Date(a.created_at || a.date || 0));

        const hasUnseenSharedMemory = unseenReceived.length > 0;
        const newestUnseenMemoryId = hasUnseenSharedMemory ? (unseenReceived[0].memory_id || unseenReceived[0].original_memory_id) : null;

        res.json({
            firstName: names.firstName || names.name || user.username || normalizedEmail.split('@')[0],
            first_name: names.first_name,
            lastName: names.lastName,
            last_name: names.last_name,
            name: names.name,
            friendsCount,
            memoryCount,
            recentMemories,
            recentFriends,
            newMemories,
            newFriends,
            mapViews: user.map_views_this_week || 0,
            allFriends: sanitizedFriends,
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

app.use(handleUploadError);
app.use((err, req, res, next) => {
    console.error('Unhandled Auth Error:', err.message);
    res.status(500).json({ error: isProduction ? 'Internal Server Error' : (err.message || 'Internal Server Error') });
});

registerHealthRoutes({
    app,
    serviceName: 'auth-service',
    displayName: 'Auth Service',
    mongodb,
    isDbConnected: () => userStore.isDbConnected()
});

const startServer = createServiceStarter({
    app,
    port: PORT,
    displayName: 'Auth Service',
    mongodb
});

if (require.main === module) {
    startServer();
}

module.exports = { app, startServer, userStore };
