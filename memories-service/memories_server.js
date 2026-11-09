require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');

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
const { S3Storage, getMediaUrl, getDownloadUrl } = s3Module;

const memoryStore = require('./src/memory_store');

const app = express();
const PORT = process.env.PORT || 3002;
const isProduction = process.env.NODE_ENV === 'production';

const INTERNAL_SECRET = process.env.INTERNAL_SERVICE_SECRET || 'mb-internal-service-secret-2026';
const GATEWAY_SECRET = process.env.GATEWAY_SHARED_SECRET || 'mb-gateway-service-secret-2026';

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(metrics.metricsMiddleware);
app.get('/metrics', metrics.metricsEndpoint);

const storage = new S3Storage({ bucket: process.env.AWS_S3_BUCKET || 'default-bucket', prefix: 'memories/' });
const upload = multer({ storage: storage });

// Security: Verify identity propagated from Gateway or internal service
const isAuthenticated = (req, res, next) => {
    const email = req.headers['x-user-email'];
    const gwHeader = req.headers['x-gateway-secret'];
    const intHeader = req.headers['x-internal-secret'];

    if (!email || (isProduction && gwHeader !== GATEWAY_SECRET && intHeader !== INTERNAL_SECRET)) {
        return res.status(401).json({ error: 'Unauthorized: Valid authenticated session required' });
    }
    req.userEmail = email.trim().toLowerCase();
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

// GET /api/memories - Chronologically sorted and paginated user memories
app.get('/api/memories', isAuthenticated, async (req, res) => {
    try {
        const currentEmail = req.userEmail;
        const order = (req.query.order || req.query.sort || 'asc').toLowerCase() === 'desc' ? 'desc' : 'asc';
        const userMemories = await memoryStore.get_user_memories(currentEmail);

        const sortedMemories = memoryStore.sortMemoriesChronologically(userMemories, order);
        const paginated = memoryStore.paginateMemories(sortedMemories, req.query.page, req.query.limit);

        const mapped = await Promise.all(paginated.memories.map(async m => {
            const mCopy = { ...m };
            delete mCopy._id;
            if (mCopy.media && Array.isArray(mCopy.media)) {
                mCopy.media = await Promise.all(mCopy.media.map(async mediaItem => {
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
            return mCopy;
        }));

        res.json({
            memories: mapped,
            pagination: paginated.pagination
        });
    } catch (err) {
        console.error('Get memories error:', err.message);
        res.status(500).json({ error: 'Database service unavailable' });
    }
});

// Internal endpoint protected with internal service authorization
app.get('/api/internal/memories', isInternalService, async (req, res) => {
    try {
        const order = (req.query.order || req.query.sort || 'asc').toLowerCase() === 'desc' ? 'desc' : 'asc';
        const allMemories = await memoryStore.load_all_memories();
        const sorted = memoryStore.sortMemoriesChronologically(allMemories, order);
        const mapped = await Promise.all(sorted.map(async m => {
            const mCopy = { ...m };
            delete mCopy._id;
            mCopy.raw_media = m.media ? JSON.parse(JSON.stringify(m.media)) : [];
            if (mCopy.media && Array.isArray(mCopy.media)) {
                mCopy.media = await Promise.all(mCopy.media.map(async mediaItem => {
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
            return mCopy;
        }));
        res.json(mapped);
    } catch (err) {
        console.error('Internal memories error:', err.message);
        res.status(500).json({ error: 'Database service unavailable' });
    }
});

// GET /api/internal/memories/:id - Retrieve specific raw memory for internal service consumption (e.g. sharing)
app.get('/api/internal/memories/:id', isInternalService, async (req, res) => {
    try {
        const memoryId = req.params.id;
        const memory = await memoryStore.get_memory_by_id(memoryId);
        if (!memory) {
            return res.status(404).json({ error: 'Memory not found' });
        }
        const mCopy = { ...memory };
        delete mCopy._id;
        mCopy.raw_media = memory.media ? JSON.parse(JSON.stringify(memory.media)) : [];
        if (mCopy.media && Array.isArray(mCopy.media)) {
            mCopy.media = await Promise.all(mCopy.media.map(async mediaItem => {
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
        res.json(mCopy);
    } catch (err) {
        console.error('Internal get memory by ID error:', err.message);
        res.status(500).json({ error: 'Database service unavailable' });
    }
});

// POST /api/memories - Create a new memory
app.post('/api/memories', isAuthenticated, upload.array('memory_media[]', 10), async (req, res) => {
    try {
        const { title, date, mood, location, description, tags } = req.body;
        const friends = req.body.friends || req.body.selected_friends;
        const currentEmail = req.userEmail;

        if (!title || !date) {
            return res.status(400).json({ error: 'Title and Date are required.' });
        }

        let parsedFriends = [];
        if (friends) {
            try {
                parsedFriends = typeof friends === 'string' ? JSON.parse(friends) : friends;
            } catch (e) {
                parsedFriends = Array.isArray(friends) ? friends : [friends];
            }
        }

        let mediaPaths = [];
        if (req.files && req.files.length > 0) {
            mediaPaths = req.files.map(file => {
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

        const newMemory = {
            memory_id: 'm_' + Math.random().toString(36).substr(2, 9),
            owner: currentEmail,
            title: title.trim(),
            date: date.trim(),
            mood: mood || '',
            location: location || '',
            description: description || '',
            tags: tags || '',
            friends: parsedFriends,
            media: mediaPaths,
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

        const userMemories = await memoryStore.get_user_memories(currentEmail);
        const sortedUserMemories = memoryStore.sortMemoriesChronologically(userMemories, order);
        const memory = sortedUserMemories.find(m => m.memory_id === memoryId);

        if (memory) {
            const memIndex = sortedUserMemories.findIndex(m => m.memory_id === memoryId);
            const prevMemoryId = memIndex > 0 ? sortedUserMemories[memIndex - 1].memory_id : null;
            const nextMemoryId = memIndex >= 0 && memIndex < sortedUserMemories.length - 1 ? sortedUserMemories[memIndex + 1].memory_id : null;

            const mappedMemories = sortedUserMemories.map(m => ({ id: m.memory_id, title: m.title, date: m.date }));

            const memoryCopy = { ...memory };
            delete memoryCopy._id;
            if (memoryCopy.media && Array.isArray(memoryCopy.media)) {
                memoryCopy.media = await Promise.all(memoryCopy.media.map(async mediaItem => {
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

            res.json({
                memory: memoryCopy,
                allUserMemories: mappedMemories,
                prevMemoryId,
                nextMemoryId,
                order
            });
        } else {
            res.status(404).json({ error: 'Memory not found' });
        }
    } catch (err) {
        console.error('Get memory by ID error:', err.message);
        res.status(500).json({ error: 'Database service unavailable' });
    }
});

// PUT /api/memories/:id - Edit an existing memory (owner only)
app.put('/api/memories/:id', isAuthenticated, upload.array('memory_media[]', 10), async (req, res) => {
    try {
        const currentEmail = req.userEmail;
        const memoryId = req.params.id;

        const existingMemory = await memoryStore.get_memory_by_id(memoryId);
        if (!existingMemory) {
            return res.status(404).json({ error: 'Memory not found' });
        }

        if (existingMemory.owner !== currentEmail) {
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
        if (title !== undefined) updates.title = title.trim();
        if (date !== undefined) updates.date = date.trim();
        if (mood !== undefined) updates.mood = mood;
        if (location !== undefined) updates.location = location;
        if (description !== undefined) updates.description = description;
        if (tags !== undefined) updates.tags = tags;

        const rawFriends = friends || selected_friends;
        if (rawFriends !== undefined) {
            let parsedFriends = [];
            try {
                parsedFriends = typeof rawFriends === 'string' ? JSON.parse(rawFriends) : rawFriends;
            } catch (e) {
                parsedFriends = Array.isArray(rawFriends) ? rawFriends : [rawFriends];
            }
            updates.friends = parsedFriends;
        }

        // Media handling
        let newMediaPaths = [];
        if (req.files && req.files.length > 0) {
            newMediaPaths = req.files.map(file => {
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

        if (keep_existing_media === 'false') {
            updates.media = newMediaPaths;
        } else if (newMediaPaths.length > 0) {
            if (!Array.isArray(updates.media)) updates.media = updates.media ? [updates.media] : [];
            updates.media = updates.media.concat(newMediaPaths);
        }

        updates.updated_at = new Date().toISOString();

        const updatedMemory = await memoryStore.update_memory(memoryId, currentEmail, updates);
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
        if (existing.owner !== currentEmail) {
            return res.status(403).json({ error: 'Unauthorized: You can only delete your own memories' });
        }

        const deleted = await memoryStore.delete_memory(memoryId, currentEmail);

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

app.use((err, req, res, next) => {
    console.error('Unhandled Memories Error:', err);
    res.status(500).json({
        error: isProduction ? 'Internal Server Error' : (err.message || 'Internal Server Error')
    });
});

const HEALTH_DB_PING_TIMEOUT_MS = 2000;

async function isDatabaseHealthy() {
    if (!memoryStore.isDbConnected()) {
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
        service: 'memories-service'
    });
});

app.get('/health', async (req, res) => {
    const dbConnected = await isDatabaseHealthy();
    res.status(dbConnected ? 200 : 503).json({
        status: dbConnected ? 'UP' : 'DOWN',
        service: 'memories-service',
        database: dbConnected ? 'connected' : 'disconnected'
    });
});

let serverInstance = null;

async function startServer() {
    if (mongodb && process.env.MONGODB_URI) {
        try {
            const { db } = await mongodb.connect();
            await mongodb.initializeIndexes(db);
            console.log('Memories Service: Successfully connected to MongoDB and initialized indexes.');
        } catch (err) {
            console.error('Memories Service: Error - MongoDB connection failed on startup:', err.message);
        }
    } else {
        console.warn('Memories Service: Warning - No MONGODB_URI configured.');
    }

    serverInstance = app.listen(PORT, () => {
        console.log(`Memories Service running on port ${PORT}`);
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

module.exports = { app, startServer, memoryStore };
