require('dotenv').config();
const fs = require('fs');
const path = require('path');
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
            return res.status(400).json({ error: 'Title and Date are required.' });
        }

        const newMemory = {
            memory_id: 'm_' + Math.random().toString(36).substr(2, 9),
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

        const sortedUserMemories = await memoryStore.get_user_memory_nav_list(currentEmail, order);
        const memIndex = sortedUserMemories.findIndex(m => m.memory_id === memoryId);
        const prevMemoryId = memIndex > 0 ? sortedUserMemories[memIndex - 1].memory_id : null;
        const nextMemoryId = memIndex >= 0 && memIndex < sortedUserMemories.length - 1 ? sortedUserMemories[memIndex + 1].memory_id : null;

        const mappedMemories = sortedUserMemories.map(m => ({ id: m.memory_id, title: m.title, date: m.date }));
        const memoryCopy = await formatMemoryResponse(memory);

        res.json({
            memory: memoryCopy,
            allUserMemories: mappedMemories,
            prevMemoryId,
            nextMemoryId,
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
            return res.status(404).json({ error: 'Memory not found' });
        }
        if (normalizeEmail(existingMemory.owner) !== currentEmail) {
            return res.status(403).json({ error: 'Unauthorized: You can only edit your own memories' });
        }

        const { title, date, mood, location, description, tags, friends, selected_friends, keep_existing_media } = req.body;
        if (title !== undefined && (!title || !title.trim())) {
            return res.status(400).json({ error: 'Title cannot be empty.' });
        }
        if (date !== undefined && (!date || !date.trim())) {
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
            return res.status(404).json({ error: 'Memory not found' });
        }
        const memoryResponse = { ...updatedMemory };
        delete memoryResponse._id;

        res.json({ success: true, message: 'Memory updated successfully', memory: memoryResponse });
    } catch (err) {
        console.error('Update memory error:', err.message);
        res.status(500).json({ error: 'Database service unavailable' });
    }
});

// DELETE /api/memories/:id - Delete an existing memory (owner only)
app.delete('/api/memories/:id', isAuthenticated, async (req, res) => {
    try {
        const currentEmail = req.userEmail;
        const memoryId = req.params.id;

        const existing = await memoryStore.get_memory_by_id(memoryId);
        if (!existing) {
            return res.status(404).json({ error: 'Memory not found or unauthorized' });
        }
        if (normalizeEmail(existing.owner) !== currentEmail) {
            return res.status(403).json({ error: 'Unauthorized: You can only delete your own memories' });
        }

        const deleted = await memoryStore.delete_memory(memoryId, existing.owner || currentEmail);
        if (deleted) {
            metrics.memoriesDeletedTotal.inc();
            res.json({ success: true, message: 'Memory deleted' });
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

module.exports = { app, startServer, memoryStore };
