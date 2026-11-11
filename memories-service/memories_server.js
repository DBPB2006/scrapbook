require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const multer = require('multer');

const hasLocalShared = fs.existsSync(path.join(__dirname, 'shared'));
const mongodb = hasLocalShared ? require('./shared/mongodb') : require('../shared/mongodb');
const {
    getMediaUrl,
    getDownloadUrl,
    createUploadMiddleware,
    handleUploadError,
    deleteS3Objects,
    extractS3Keys
} = hasLocalShared ? require('./shared/s3_storage') : require('../shared/s3_storage');
const metrics = hasLocalShared ? require('./shared/metrics') : require('../shared/metrics');
const {
    normalizeEmail,
    createIsAuthenticated,
    createIsInternalService,
    registerHealthRoutes,
    createServiceStarter
} = hasLocalShared ? require('./shared/service_common') : require('../shared/service_common');

const memoryStore = require('./src/memory_store');

const app = express();
const PORT = process.env.PORT || 3002;
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

const uploadMemoryMedia = createUploadMiddleware(multer, {
    bucket: process.env.AWS_S3_BUCKET || 'default-bucket',
    prefix: 'memories/',
    category: 'media',
    fieldName: 'memory_media[]',
    multiple: true
});

const isAuthenticated = createIsAuthenticated(GATEWAY_SECRET, INTERNAL_SECRET, isProduction);
const isInternalService = createIsInternalService(INTERNAL_SECRET);

async function presignMemoryMediaList(media) {
    if (!Array.isArray(media)) return media;
    return Promise.all(media.map(async mediaItem => {
        if (mediaItem && mediaItem.url && typeof mediaItem.url === 'object' && mediaItem.url.provider === 's3') {
            const rawUrlObj = mediaItem.url;
            const fileName = mediaItem.name || rawUrlObj.fileName || '';
            const previewUrl = await getMediaUrl(rawUrlObj);
            const downloadUrl = await getDownloadUrl(rawUrlObj, fileName);
            return {
                ...mediaItem,
                url: previewUrl,
                download_url: downloadUrl || previewUrl,
                name: fileName || mediaItem.name
            };
        }
        return mediaItem;
    }));
}

async function formatMemoryResponse(memory, includeRawMedia = false) {
    const mCopy = { ...memory };
    delete mCopy._id;
    if (includeRawMedia) {
        mCopy.raw_media = memory.media ? JSON.parse(JSON.stringify(memory.media)) : [];
    }
    if (Array.isArray(mCopy.media)) {
        mCopy.media = await presignMemoryMediaList(mCopy.media);
    }
    return mCopy;
}

function mapUploadedMediaFiles(files) {
    if (!Array.isArray(files) || files.length === 0) return [];
    return files.map(file => {
        if (file.provider === 's3') {
            return {
                url: { provider: 's3', key: file.key, mimeType: file.mimeType, fileName: file.fileName, size: file.size },
                type: file.mimeType,
                name: file.fileName
            };
        }
        return {
            url: 'uploads/' + file.filename,
            type: file.mimetype,
            name: file.originalname
        };
    });
}

function parseFriendsParam(rawFriends) {
    if (!rawFriends) return [];
    try {
        return typeof rawFriends === 'string' ? JSON.parse(rawFriends) : rawFriends;
    } catch (_) {
        return Array.isArray(rawFriends) ? rawFriends : [rawFriends];
    }
}

function getUploadedS3Keys(files) {
    if (!Array.isArray(files) || files.length === 0) return [];
    return files.filter(f => f && f.provider === 's3' && f.key).map(f => f.key);
}

async function cleanupUploadedFiles(files) {
    const keys = getUploadedS3Keys(files);
    if (keys.length > 0) {
        try { await deleteS3Objects(keys); } catch (_) {}
    }
}

async function filterUnreferencedS3Keys(candidateKeys) {
    if (!Array.isArray(candidateKeys) || candidateKeys.length === 0) return [];
    const uniqueCandidates = [...new Set(candidateKeys.filter(k => typeof k === 'string' && k.trim()))];
    if (uniqueCandidates.length === 0) return [];

    if (!mongodb || typeof mongodb.isConnected !== 'function' || !mongodb.isConnected()) {
        console.warn('Memories Service: MongoDB disconnected; skipping S3 cleanup to avoid data loss.');
        return [];
    }

    const stillReferenced = new Set();
    const referenceQueries = [
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
            if (!col || typeof col.find !== 'function') {
                console.warn(`Memories Service: S3 reference check unavailable for ${colName}; skipping S3 cleanup to avoid data loss.`);
                return [];
            }
            const docs = await col.find(filter, { projection }).toArray();
            for (const doc of docs) {
                extractS3Keys(doc, stillReferenced);
            }
        } catch (err) {
            console.warn(`Memories Service: S3 reference check failed for ${colName}; skipping S3 cleanup to avoid data loss:`, err.message);
            return [];
        }
    }

    return uniqueCandidates.filter(k => !stillReferenced.has(k));
}

async function buildFriendUsersMap(ownerEmail, friends) {
    if (!Array.isArray(friends) || friends.length === 0) return {};
    const emails = new Set([normalizeEmail(ownerEmail)].filter(Boolean));
    for (const entry of friends) {
        if (!entry) continue;
        if (typeof entry === 'string') {
            const em = normalizeEmail(entry);
            if (em && em.includes('@')) emails.add(em);
        } else if (typeof entry === 'object') {
            const em = normalizeEmail(entry.email || entry.id || entry.friend_id);
            if (em && em.includes('@')) emails.add(em);
        }
    }
    if (emails.size === 0) return {};

    try {
        const authUrl = process.env.AUTH_SERVICE_URL || 'http://auth-service:3001';
        const resp = await fetch(`${authUrl}/api/internal/users/lookup`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-internal-secret': INTERNAL_SECRET
            },
            body: JSON.stringify({ emails: Array.from(emails), includeFriends: true, includeProfilePic: false }),
            signal: AbortSignal.timeout(3000)
        });
        if (!resp.ok) return {};
        const payload = await resp.json();
        const users = payload && payload.users && typeof payload.users === 'object' ? payload.users : {};
        const friendUsers = {};

        for (const [em, u] of Object.entries(users)) {
            if (!u || typeof u !== 'object') continue;
            const norm = normalizeEmail(em);
            const fullName = u.name || `${u.first_name || u.firstName || ''} ${u.last_name || u.lastName || ''}`.trim();
            friendUsers[norm] = {
                name: fullName || u.username || norm,
                first_name: u.first_name || u.firstName || '',
                username: u.username || '',
                email: norm
            };
        }

        const ownerDoc = users[normalizeEmail(ownerEmail)];
        if (ownerDoc && Array.isArray(ownerDoc.friends)) {
            for (const f of ownerDoc.friends) {
                if (!f || typeof f !== 'object') continue;
                const fEmail = normalizeEmail(f.email);
                const lookedUp = fEmail ? friendUsers[fEmail] : null;
                const displayObj = {
                    name: f.name || (lookedUp && lookedUp.name) || fEmail || '',
                    first_name: f.first_name || (lookedUp && lookedUp.first_name) || '',
                    username: (lookedUp && lookedUp.username) || '',
                    email: fEmail || ''
                };
                for (const refKey of [fEmail, f.friend_id, f.id]) {
                    const k = typeof refKey === 'string' || typeof refKey === 'number'
                        ? String(refKey).trim().toLowerCase()
                        : '';
                    if (k && !friendUsers[k]) friendUsers[k] = displayObj;
                }
            }
        }
        return friendUsers;
    } catch (err) {
        console.warn('Memories Service: Best-effort friend lookup skipped:', err.message);
        return {};
    }
}

// GET /api/memories - Chronologically sorted and paginated user memories
app.get('/api/memories', isAuthenticated, async (req, res) => {
    try {
        const order = (req.query.order || req.query.sort || 'asc').toLowerCase() === 'desc' ? 'desc' : 'asc';
        const paginated = await memoryStore.get_user_memories_paginated(req.userEmail, {
            order,
            page: req.query.page,
            limit: req.query.limit
        });
        const memories = await Promise.all(paginated.memories.map(m => formatMemoryResponse(m)));

        res.json({ memories, pagination: paginated.pagination });
    } catch (err) {
        console.error('Get memories error:', err.message);
        res.status(500).json({ error: 'Database service unavailable' });
    }
});

// Internal endpoint protected with internal service authorization
app.get('/api/internal/memories', isInternalService, async (req, res) => {
    try {
        const ownerParam = typeof req.query.owner === 'string' ? req.query.owner.trim() : '';
        const order = (req.query.order || req.query.sort || 'asc').toLowerCase() === 'desc' ? 'desc' : 'asc';
        const rawMemories = ownerParam
            ? await memoryStore.get_user_memories(ownerParam)
            : await memoryStore.load_all_memories();
        const sorted = memoryStore.sortMemoriesChronologically(rawMemories, order);
        const mapped = await Promise.all(sorted.map(m => formatMemoryResponse(m, true)));
        res.json(mapped);
    } catch (err) {
        console.error('Internal memories error:', err.message);
        res.status(500).json({ error: 'Database service unavailable' });
    }
});

// GET /api/internal/memories/:id - Retrieve specific raw memory for internal service consumption (e.g. sharing)
app.get('/api/internal/memories/:id', isInternalService, async (req, res) => {
    try {
        const memory = await memoryStore.get_memory_by_id(req.params.id);
        if (!memory) {
            return res.status(404).json({ error: 'Memory not found' });
        }
        res.json(await formatMemoryResponse(memory, true));
    } catch (err) {
        console.error('Internal get memory by ID error:', err.message);
        res.status(500).json({ error: 'Database service unavailable' });
    }
});

// POST /api/internal/memories/cleanup_user - Remove owned memories and friend references for deleted user
app.post('/api/internal/memories/cleanup_user', isInternalService, async (req, res) => {
    try {
        const email = normalizeEmail(req.body && req.body.email);
        if (!email) {
            return res.status(400).json({ error: 'Valid email is required.' });
        }
        const result = await memoryStore.cleanup_user_data(email);
        const s3Keys = extractS3Keys(result.deletedMemories);
        res.json({
            success: true,
            deletedCount: result.deletedCount,
            modifiedFriendRefsCount: result.modifiedFriendRefsCount,
            deletedMemories: result.deletedMemories,
            modifiedMemories: result.modifiedMemories,
            s3Keys
        });
    } catch (err) {
        console.error('Internal memories cleanup error:', err.message);
        res.status(500).json({ error: 'Database service unavailable' });
    }
});

// POST /api/internal/memories/restore_cleanup - Compensating rollback for failed account deletion
app.post('/api/internal/memories/restore_cleanup', isInternalService, async (req, res) => {
    try {
        await memoryStore.restore_user_cleanup(req.body || {});
        res.json({ success: true });
    } catch (err) {
        console.error('Internal memories restore error:', err.message);
        res.status(500).json({ error: 'Database service unavailable' });
    }
});

// POST /api/internal/memories/update_email - Propagate email change across memories
app.post('/api/internal/memories/update_email', isInternalService, async (req, res) => {
    try {
        const oldEmail = normalizeEmail(req.body && req.body.oldEmail);
        const newEmail = normalizeEmail(req.body && req.body.newEmail);
        if (!oldEmail || !newEmail) {
            return res.status(400).json({ error: 'Both oldEmail and newEmail are required.' });
        }
        const result = await memoryStore.update_user_email(oldEmail, newEmail);
        res.json({ success: true, ...result });
    } catch (err) {
        console.error('Internal memories update_email error:', err.message);
        res.status(500).json({ error: 'Database service unavailable' });
    }
});

// POST /api/memories - Create a new memory
app.post('/api/memories', isAuthenticated, uploadMemoryMedia, async (req, res) => {
    try {
        const { title, date, mood, location, description, tags } = req.body;
        if (!title || !date) {
            await cleanupUploadedFiles(req.files);
            return res.status(400).json({ error: 'Title and Date are required.' });
        }

        const newMemory = {
            memory_id: 'm_' + crypto.randomBytes(6).toString('hex'),
            owner: req.userEmail,
            title: title.trim(),
            date: date.trim(),
            mood: mood || '',
            location: location || '',
            description: description || '',
            tags: tags || '',
            friends: parseFriendsParam(req.body.friends || req.body.selected_friends),
            media: mapUploadedMediaFiles(req.files),
            created_at: new Date().toISOString()
        };

        await memoryStore.add_memory(newMemory);
        metrics.memoriesCreatedTotal.inc();

        res.json({ success: true, message: 'Memory added successfully', memory_id: newMemory.memory_id });
    } catch (err) {
        await cleanupUploadedFiles(req.files);
        console.error('Add memory error:', err.message);
        res.status(500).json({ error: 'Database service unavailable' });
    }
});

// GET /api/memories/:id - Retrieve specific memory with navigation links
app.get('/api/memories/:id', isAuthenticated, async (req, res) => {
    try {
        const currentEmail = req.userEmail;
        const memoryId = req.params.id;
        const order = (req.query.order || req.query.sort || 'asc').toLowerCase() === 'desc' ? 'desc' : 'asc';

        const memory = await memoryStore.get_memory_by_id(memoryId);
        if (!memory || normalizeEmail(memory.owner) !== currentEmail) {
            return res.status(404).json({ error: 'Memory not found' });
        }

        const [sortedUserMemories, memoryCopy, friendUsers] = await Promise.all([
            memoryStore.get_user_memory_nav_list(currentEmail, order),
            formatMemoryResponse(memory),
            buildFriendUsersMap(currentEmail, memory.friends)
        ]);
        const memIndex = sortedUserMemories.findIndex(m => m.memory_id === memoryId);
        const prevMemoryId = memIndex > 0 ? sortedUserMemories[memIndex - 1].memory_id : null;
        const nextMemoryId = memIndex >= 0 && memIndex < sortedUserMemories.length - 1 ? sortedUserMemories[memIndex + 1].memory_id : null;

        const mappedMemories = sortedUserMemories.map(m => ({ id: m.memory_id, title: m.title, date: m.date }));

        res.json({
            memory: memoryCopy,
            allUserMemories: mappedMemories,
            prevMemoryId,
            nextMemoryId,
            friendUsers,
            order
        });
    } catch (err) {
        console.error('Get memory by ID error:', err.message);
        res.status(500).json({ error: 'Database service unavailable' });
    }
});

// PUT /api/memories/:id - Edit an existing memory (owner only)
app.put('/api/memories/:id', isAuthenticated, uploadMemoryMedia, async (req, res) => {
    try {
        const currentEmail = req.userEmail;
        const memoryId = req.params.id;

        const existingMemory = await memoryStore.get_memory_by_id(memoryId);
        if (!existingMemory) {
            await cleanupUploadedFiles(req.files);
            return res.status(404).json({ error: 'Memory not found' });
        }
        if (normalizeEmail(existingMemory.owner) !== currentEmail) {
            await cleanupUploadedFiles(req.files);
            return res.status(403).json({ error: 'Unauthorized: You can only edit your own memories' });
        }

        const { title, date, mood, location, description, tags, friends, selected_friends, keep_existing_media } = req.body;
        if (title !== undefined && (!title || !title.trim())) {
            await cleanupUploadedFiles(req.files);
            return res.status(400).json({ error: 'Title cannot be empty.' });
        }
        if (date !== undefined && (!date || !date.trim())) {
            await cleanupUploadedFiles(req.files);
            return res.status(400).json({ error: 'Date cannot be empty.' });
        }

        const updates = { ...existingMemory };
        delete updates._id;
        if (title !== undefined) updates.title = title.trim();
        if (date !== undefined) updates.date = date.trim();
        if (mood !== undefined) updates.mood = mood;
        if (location !== undefined) updates.location = location;
        if (description !== undefined) updates.description = description;
        if (tags !== undefined) updates.tags = tags;

        const rawFriends = friends || selected_friends;
        if (rawFriends !== undefined) {
            updates.friends = parseFriendsParam(rawFriends);
        }

        const uploadedKeys = getUploadedS3Keys(req.files);
        const replacedCandidateKeys = keep_existing_media === 'false' ? extractS3Keys(existingMemory.media) : [];
        const newMediaPaths = mapUploadedMediaFiles(req.files);
        if (keep_existing_media === 'false') {
            updates.media = newMediaPaths;
        } else if (newMediaPaths.length > 0) {
            if (!Array.isArray(updates.media)) updates.media = updates.media ? [updates.media] : [];
            updates.media = updates.media.concat(newMediaPaths);
        }

        updates.updated_at = new Date().toISOString();

        const updatedMemory = await memoryStore.update_memory(memoryId, existingMemory.owner || currentEmail, updates);
        if (!updatedMemory) {
            await cleanupUploadedFiles(req.files);
            return res.status(404).json({ error: 'Memory not found' });
        }

        if (replacedCandidateKeys.length > 0) {
            try {
                const safeOldKeys = (await filterUnreferencedS3Keys(replacedCandidateKeys))
                    .filter(k => !uploadedKeys.includes(k));
                if (safeOldKeys.length > 0) {
                    await deleteS3Objects(safeOldKeys);
                }
            } catch (s3Err) {
                console.warn('Memory updated cleanly, replaced S3 cleanup warning:', s3Err.message);
            }
        }

        const memoryResponse = await formatMemoryResponse(updatedMemory);
        res.json({ success: true, message: 'Memory updated successfully', memory: memoryResponse });
    } catch (err) {
        await cleanupUploadedFiles(req.files);
        console.error('Update memory error:', err.message);
        res.status(500).json({ error: 'Database service unavailable' });
    }
});

// DELETE /api/memories/:id - Delete an existing memory (owner only)
app.delete('/api/memories/:id', isAuthenticated, async (req, res) => {
    try {
        const currentEmail = req.userEmail;
        const memoryId = req.params.id;
        const order = (req.query.order || req.query.sort || 'asc').toLowerCase() === 'desc' ? 'desc' : 'asc';

        const existing = await memoryStore.get_memory_by_id(memoryId);
        if (!existing) {
            return res.status(404).json({ error: 'Memory not found or unauthorized' });
        }
        if (normalizeEmail(existing.owner) !== currentEmail) {
            return res.status(403).json({ error: 'Unauthorized: You can only delete your own memories' });
        }

        const navList = await memoryStore.get_user_memory_nav_list(existing.owner || currentEmail, order);
        const memIndex = navList.findIndex(m => m.memory_id === memoryId);
        let redirectId = null;
        if (memIndex >= 0) {
            if (memIndex + 1 < navList.length) redirectId = navList[memIndex + 1].memory_id;
            else if (memIndex - 1 >= 0) redirectId = navList[memIndex - 1].memory_id;
        } else {
            const firstRemaining = navList.find(m => m.memory_id !== memoryId);
            redirectId = firstRemaining ? firstRemaining.memory_id : null;
        }

        const deleted = await memoryStore.delete_memory(memoryId, existing.owner || currentEmail);
        if (deleted) {
            metrics.memoriesDeletedTotal.inc();
            const candidateKeys = extractS3Keys(existing.media);
            if (candidateKeys.length > 0) {
                try {
                    const safeKeys = await filterUnreferencedS3Keys(candidateKeys);
                    if (safeKeys.length > 0) {
                        await deleteS3Objects(safeKeys);
                    }
                } catch (s3Err) {
                    console.warn('Memory deleted cleanly, S3 post-cleanup warning:', s3Err.message);
                }
            }
            res.json({ success: true, message: 'Memory deleted', redirectId });
        } else {
            res.status(404).json({ error: 'Memory not found or unauthorized' });
        }
    } catch (err) {
        console.error('Delete memory error:', err.message);
        res.status(500).json({ error: 'Database service unavailable' });
    }
});

app.use(handleUploadError);
app.use((err, req, res, next) => {
    console.error('Unhandled Memories Error:', err.message);
    res.status(500).json({ error: isProduction ? 'Internal Server Error' : (err.message || 'Internal Server Error') });
});

registerHealthRoutes({
    app,
    serviceName: 'memories-service',
    displayName: 'Memories Service',
    mongodb,
    isDbConnected: () => memoryStore.isDbConnected()
});

const startServer = createServiceStarter({
    app,
    port: PORT,
    displayName: 'Memories Service',
    mongodb
});

if (require.main === module) {
    startServer();
}

module.exports = { app, startServer, memoryStore, filterUnreferencedS3Keys };
