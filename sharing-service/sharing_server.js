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

const sharingStore = require('./src/sharing_store');
const { BinaryMinHeap } = require('./src/min_heap');
const { isCapsuleUnlocked, calculateTimeDifference, displayTimeDifference } = require('./src/time_stack');

const app = express();
const PORT = process.env.PORT || 3004;
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

const uploadCapsuleMedia = createUploadMiddleware(multer, {
    bucket: process.env.AWS_S3_BUCKET || 'default-bucket',
    prefix: 'shared/',
    category: 'media',
    fieldName: 'media[]',
    multiple: true
});

const uploadSharedAttachments = createUploadMiddleware(multer, {
    bucket: process.env.AWS_S3_BUCKET || 'default-bucket',
    prefix: 'shared/',
    category: 'media',
    fieldName: 'attachments[]',
    multiple: true
});

const isAuthenticated = createIsAuthenticated(GATEWAY_SECRET, INTERNAL_SECRET, isProduction);
const isInternalService = createIsInternalService(INTERNAL_SECRET);

// In-memory Min-Heap scheduling structure
const capsuleSchedulerHeap = new BinaryMinHeap();

async function rebuildCapsuleHeap() {
    const lockedCaps = await sharingStore.get_locked_capsules();
    capsuleSchedulerHeap.rebuild(lockedCaps);
    return lockedCaps.length;
}

async function onDbConnected() {
    try {
        const count = await rebuildCapsuleHeap();
        console.log(`Sharing Service: Loaded ${count} locked capsule(s) into Min-Heap scheduler.`);
    } catch (heapErr) {
        console.warn('Sharing Service: Failed to rebuild capsule scheduler heap:', heapErr.message);
    }
}

async function formatCapsuleResponse(capsule) {
    const isUnlocked = capsule.unlocked == 1;
    const cCopy = { ...capsule };

    // Server-side secret masking: never return locked secret content or media URLs
    if (!isUnlocked) {
        cCopy.message = `[Locked until ${capsule.reveal_date}]`;
        cCopy.description = null;
        cCopy.media = [];
        cCopy.is_locked = true;
        return cCopy;
    }

    cCopy.is_locked = false;
    if (Array.isArray(cCopy.media)) {
        cCopy.media = await Promise.all(cCopy.media.map(async m => {
            const rawPath = m.path;
            const fileName = m.name || (typeof rawPath === 'object' && rawPath.fileName) || '';
            const previewUrl = await getMediaUrl(rawPath);
            const downloadUrl = await getDownloadUrl(rawPath, fileName);
            return {
                ...m,
                path: previewUrl,
                download_url: downloadUrl || previewUrl,
                name: fileName || m.name
            };
        }));
    }
    return cCopy;
}

async function presignAttachments(attachments) {
    if (!Array.isArray(attachments)) return attachments;
    return Promise.all(attachments.map(async rawAtt => {
        const fileName = (typeof rawAtt === 'object' && (rawAtt.fileName || rawAtt.name)) || '';
        const mime = (typeof rawAtt === 'object' && (rawAtt.mimeType || rawAtt.type)) || '';
        const previewUrl = await getMediaUrl(rawAtt);
        const downloadUrl = await getDownloadUrl(rawAtt, fileName);
        return {
            preview_url: previewUrl,
            download_url: downloadUrl || previewUrl,
            fileName,
            name: fileName,
            url: previewUrl,
            mimeType: mime,
            type: mime
        };
    }));
}

async function presignSharedMediaList(media) {
    if (!Array.isArray(media)) return media;
    return Promise.all(media.map(async mItem => {
        const rawObj = (mItem && typeof mItem.url === 'object') ? mItem.url : mItem;
        const fileName = (mItem && mItem.name) || (typeof rawObj === 'object' && (rawObj.fileName || rawObj.name)) || '';
        const previewUrl = await getMediaUrl(rawObj);
        const downloadUrl = await getDownloadUrl(rawObj, fileName);
        return {
            ...mItem,
            preview_url: previewUrl,
            download_url: downloadUrl || previewUrl,
            fileName,
            name: fileName,
            url: previewUrl
        };
    }));
}

async function presignSharedImage(rawImg) {
    if (!rawImg) return rawImg;
    const fileName = (typeof rawImg === 'object' && (rawImg.fileName || rawImg.name)) || '';
    const previewUrl = await getMediaUrl(rawImg);
    const downloadUrl = await getDownloadUrl(rawImg, fileName);
    return {
        preview_url: previewUrl,
        download_url: downloadUrl || previewUrl,
        fileName,
        name: fileName,
        url: previewUrl
    };
}

// =============================================================================
// Time Capsules Routes
// =============================================================================

app.get('/api/capsules', isAuthenticated, async (req, res) => {
    try {
        const userCapsules = await sharingStore.get_user_capsules(req.userEmail);
        let updated = false;

        for (const c of userCapsules) {
            if (c.unlocked != 1 && c.reveal_date && isCapsuleUnlocked(c.reveal_date)) {
                await sharingStore.unlock_capsule(c.id);
                c.unlocked = 1;
                updated = true;
            }
        }

        if (updated) {
            await rebuildCapsuleHeap();
        }

        // Chronological scheduling sort using native Binary Min-Heap
        const userHeap = new BinaryMinHeap();
        userCapsules.forEach(c => userHeap.insert(c, c.reveal_date));
        const sortedCapsules = userHeap.toSortedArray();

        const sanitizedCapsules = await Promise.all(sortedCapsules.map(formatCapsuleResponse));
        res.json(sanitizedCapsules);
    } catch (err) {
        console.error('Get capsules error:', err.message);
        res.status(500).json({ error: 'Database service unavailable' });
    }
});

app.post('/api/capsules', isAuthenticated, uploadCapsuleMedia, async (req, res) => {
    try {
        const { recipient_email, message, description, reveal_date } = req.body;

        if (!recipient_email || !message || !reveal_date) {
            return res.status(400).json({ error: 'Recipient, message, and reveal date are required.' });
        }

        const media = (req.files || []).map(file => {
            if (file.provider === 's3') {
                return {
                    type: file.mimeType,
                    path: { provider: 's3', key: file.key, mimeType: file.mimeType, fileName: file.fileName, size: file.size },
                    name: file.fileName
                };
            }
            return {
                type: file.mimetype,
                path: 'uploads/' + file.filename,
                name: file.originalname
            };
        });

        const isoReveal = String(reveal_date).replace(' ', 'T');
        const parsedRevealDate = new Date(isoReveal.includes('Z') || isoReveal.includes('+') ? isoReveal : isoReveal + 'Z');
        const normalizedRevealDate = !isNaN(parsedRevealDate.getTime())
            ? parsedRevealDate.toISOString().replace('T', ' ').substring(0, 19)
            : reveal_date;

        const newCapsule = {
            id: 'tc_' + Math.random().toString(36).substr(2, 9),
            user_email: req.userEmail,
            recipient_email: normalizeEmail(recipient_email),
            reveal_date: normalizedRevealDate,
            message,
            description: description || '',
            media,
            created_at: new Date().toISOString().replace('T', ' ').substring(0, 19),
            unlocked: 0
        };

        await sharingStore.add_capsule(newCapsule);
        capsuleSchedulerHeap.insert(newCapsule, newCapsule.reveal_date);

        res.json({ success: true, message: 'Capsule created successfully' });
    } catch (err) {
        console.error('Create capsule error:', err.message);
        res.status(500).json({ error: 'Database service unavailable' });
    }
});

app.post('/api/internal/capsules/refresh_heap', isInternalService, async (req, res) => {
    try {
        await rebuildCapsuleHeap();
        res.json({ success: true, heapSize: capsuleSchedulerHeap.size() });
    } catch (err) {
        console.error('Internal refresh heap error:', err.message);
        res.status(500).json({ error: 'Database service unavailable' });
    }
});

app.post('/api/internal/sharing/cleanup_user', isInternalService, async (req, res) => {
    try {
        const email = normalizeEmail(req.body && req.body.email);
        if (!email) {
            return res.status(400).json({ error: 'Valid email is required.' });
        }
        const result = await sharingStore.cleanup_user_data(email);
        await rebuildCapsuleHeap();
        const s3Keys = [
            ...extractS3Keys(result.deletedShares),
            ...extractS3Keys(result.deletedCapsules)
        ];
        res.json({
            success: true,
            deletedSharesCount: result.deletedSharesCount,
            modifiedSharesCount: result.modifiedSharesCount,
            deletedCapsulesCount: result.deletedCapsulesCount,
            deletedShares: result.deletedShares,
            modifiedShares: result.modifiedShares,
            deletedCapsules: result.deletedCapsules,
            s3Keys: [...new Set(s3Keys)]
        });
    } catch (err) {
        console.error('Internal sharing cleanup error:', err.message);
        res.status(500).json({ error: 'Database service unavailable' });
    }
});

app.post('/api/internal/sharing/restore_cleanup', isInternalService, async (req, res) => {
    try {
        await sharingStore.restore_user_cleanup(req.body || {});
        await rebuildCapsuleHeap();
        res.json({ success: true });
    } catch (err) {
        console.error('Internal sharing restore error:', err.message);
        res.status(500).json({ error: 'Database service unavailable' });
    }
});

app.post('/api/internal/sharing/update_email', isInternalService, async (req, res) => {
    try {
        const oldEmail = normalizeEmail(req.body && req.body.oldEmail);
        const newEmail = normalizeEmail(req.body && req.body.newEmail);
        if (!oldEmail || !newEmail) {
            return res.status(400).json({ error: 'Both oldEmail and newEmail are required.' });
        }
        const result = await sharingStore.update_user_email(oldEmail, newEmail);
        await rebuildCapsuleHeap();
        res.json({ success: true, ...result });
    } catch (err) {
        console.error('Internal sharing update_email error:', err.message);
        res.status(500).json({ error: 'Database service unavailable' });
    }
});

app.post('/api/capsules/countdown', (req, res) => {
    const { start_date, reveal_date } = req.body;
    if (!reveal_date) return res.status(400).json({ error: 'reveal_date is required' });
    const nowStr = start_date || new Date().toISOString();
    res.json({
        diff: calculateTimeDifference(nowStr, reveal_date),
        formatted: displayTimeDifference(nowStr, reveal_date),
        unlocked: isCapsuleUnlocked(reveal_date)
    });
});

app.get('/api/capsules/:id', isAuthenticated, async (req, res) => {
    try {
        const currentEmail = req.userEmail;
        const capsuleId = req.params.id;
        const targetCapsule = await sharingStore.get_capsule_by_id(capsuleId);

        if (!targetCapsule) {
            return res.status(404).json({ error: 'Capsule not found' });
        }

        if (normalizeEmail(targetCapsule.user_email) !== currentEmail &&
            normalizeEmail(targetCapsule.recipient_email) !== currentEmail) {
            return res.status(403).json({ error: 'Access denied: You are not authorized to access this capsule.' });
        }

        if (targetCapsule.unlocked != 1 && targetCapsule.reveal_date && isCapsuleUnlocked(targetCapsule.reveal_date)) {
            await sharingStore.unlock_capsule(targetCapsule.id);
            targetCapsule.unlocked = 1;
            await rebuildCapsuleHeap();
        }

        const capsuleCopy = await formatCapsuleResponse(targetCapsule);

        // Project only sidebar metadata to avoid payload leaks
        const userCapsules = await sharingStore.get_user_capsules(currentEmail, {
            projection: {
                _id: 0,
                id: 1,
                user_email: 1,
                recipient_email: 1,
                reveal_date: 1,
                created_at: 1,
                unlocked: 1
            }
        });
        const otherCapsules = userCapsules
            .filter(c => c.id !== capsuleId)
            .map(oc => ({
                id: oc.id,
                user_email: oc.user_email,
                recipient_email: oc.recipient_email,
                reveal_date: oc.reveal_date,
                created_at: oc.created_at,
                unlocked: oc.unlocked,
                is_locked: oc.unlocked != 1
            }));

        res.json({ capsule: capsuleCopy, otherCapsules });
    } catch (err) {
        console.error('Get capsule by id error:', err.message);
        res.status(500).json({ error: 'Database service unavailable' });
    }
});

// =============================================================================
// Shared Memories Routes
// =============================================================================

app.get('/api/shared_memories', isAuthenticated, async (req, res) => {
    try {
        const currentEmail = req.userEmail;
        const userShared = await sharingStore.get_user_shared_memories(currentEmail);
        const enriched = await Promise.all(userShared.map(async m => {
            const mCopy = { ...m, is_received: normalizeEmail(m.to) === currentEmail };
            if (Array.isArray(mCopy.attachments)) {
                mCopy.attachments = await presignAttachments(mCopy.attachments);
            }
            if (Array.isArray(mCopy.media)) {
                mCopy.media = await presignSharedMediaList(mCopy.media);
            }
            if (mCopy.image) {
                mCopy.image = await presignSharedImage(mCopy.image);
            }
            return mCopy;
        }));
        res.json(enriched);
    } catch (err) {
        console.error('Get shared memories error:', err.message);
        res.status(500).json({ error: 'Database service unavailable' });
    }
});

app.get('/api/internal/shared_memories', isInternalService, async (req, res) => {
    try {
        const userParam = typeof req.query.user === 'string' ? normalizeEmail(req.query.user) : '';
        const allShared = userParam
            ? await sharingStore.get_user_shared_memories(userParam)
            : await sharingStore.load_all_shared_memories();
        const mapped = await Promise.all(allShared.map(async m => {
            const mCopy = { ...m };
            if (Array.isArray(mCopy.attachments)) {
                mCopy.attachments = await presignAttachments(mCopy.attachments);
            }
            return mCopy;
        }));
        res.json(mapped);
    } catch (err) {
        console.error('Internal shared memories error:', err.message);
        res.status(500).json({ error: 'Database service unavailable' });
    }
});

app.post('/api/shared_memories', isAuthenticated, uploadSharedAttachments, async (req, res) => {
    try {
        const currentEmail = req.userEmail;
        const { to_email, memory_title, message, date, selected_memory_id, mood, location, tags, description, friends } = req.body;
        const normalizedTargetEmail = normalizeEmail(to_email);

        if (!normalizedTargetEmail || (!memory_title && !selected_memory_id)) {
            return res.status(400).json({ error: 'Missing required fields: recipient and memory title or selected memory are required.' });
        }

        let usersMap = {};
        try {
            const lookupRes = await axios.post(`${process.env.AUTH_SERVICE_URL || 'http://auth-service:3001'}/api/internal/users/lookup`, {
                emails: [currentEmail, normalizedTargetEmail],
                includeFriends: false,
                includeProfilePic: false
            }, {
                headers: { 'x-internal-secret': INTERNAL_SECRET },
                timeout: 5000
            });
            usersMap = (lookupRes && lookupRes.data && lookupRes.data.users && typeof lookupRes.data.users === 'object')
                ? lookupRes.data.users
                : {};
        } catch (err) {
            console.error('Failed to lookup users internally from auth service:', err.message);
            return res.status(503).json({ error: 'Authentication service unavailable' });
        }

        const currentUser = usersMap[currentEmail] || { email: currentEmail, name: currentEmail };
        const toUser = usersMap[normalizedTargetEmail];

        if (!toUser) {
            return res.status(404).json({ error: 'Recipient user not found' });
        }

        let originalMemory = null;
        if (selected_memory_id) {
            try {
                const memRes = await axios.get(`${process.env.MEMORIES_SERVICE_URL || 'http://memories-service:3002'}/api/internal/memories/${encodeURIComponent(selected_memory_id)}`, {
                    headers: { 'x-internal-secret': INTERNAL_SECRET },
                    timeout: 5000
                });
                if (memRes.data && memRes.data.owner && normalizeEmail(memRes.data.owner) === currentEmail) {
                    originalMemory = memRes.data;
                }
            } catch (err) {
                const status = err && err.response && err.response.status;
                if (status === 404) {
                    originalMemory = null;
                } else {
                    console.error('Failed to fetch selected memory from memories service:', err.message);
                    return res.status(503).json({ error: 'Memories service unavailable' });
                }
            }
        }

        const attachments = [];
        const copiedMedia = [];

        const originalMediaList = (originalMemory && originalMemory.raw_media && Array.isArray(originalMemory.raw_media) && originalMemory.raw_media.length > 0)
            ? originalMemory.raw_media
            : (originalMemory && Array.isArray(originalMemory.media) ? originalMemory.media : []);

        originalMediaList.forEach(mItem => {
            if (!mItem) return;
            if (mItem.url && typeof mItem.url === 'object' && mItem.url.provider === 's3') {
                const attObj = {
                    provider: 's3',
                    key: mItem.url.key,
                    mimeType: mItem.type || mItem.url.mimeType || '',
                    fileName: mItem.name || mItem.url.fileName || '',
                    size: mItem.url.size || 0
                };
                attachments.push(attObj);
                copiedMedia.push({ url: attObj, type: attObj.mimeType, name: attObj.fileName });
            } else if (mItem.provider === 's3' && mItem.key) {
                const attObj = {
                    provider: 's3',
                    key: mItem.key,
                    mimeType: mItem.mimeType || mItem.type || '',
                    fileName: mItem.fileName || mItem.name || '',
                    size: mItem.size || 0
                };
                attachments.push(attObj);
                copiedMedia.push({ url: attObj, type: attObj.mimeType, name: attObj.fileName });
            } else if (typeof mItem.url === 'string') {
                attachments.push(mItem.url);
                copiedMedia.push({ url: mItem.url, type: mItem.type || '', name: mItem.name || mItem.url.split('/').pop() });
            } else if (typeof mItem === 'string') {
                attachments.push(mItem);
                copiedMedia.push({ url: mItem, type: '', name: mItem.split('/').pop() });
            }
        });

        if (Array.isArray(req.files)) {
            req.files.forEach(f => {
                if (f.provider === 's3') {
                    const attObj = { provider: 's3', key: f.key, mimeType: f.mimeType, fileName: f.fileName, size: f.size };
                    attachments.push(attObj);
                    copiedMedia.push({ url: attObj, type: f.mimeType, name: f.fileName });
                } else {
                    const localPath = 'uploads/' + f.filename;
                    attachments.push(localPath);
                    copiedMedia.push({ url: localPath, type: f.mimetype, name: f.originalname });
                }
            });
        }

        let memoryImage = (originalMemory && originalMemory.image) || null;
        if (!memoryImage && originalMediaList.length > 0) {
            const firstImg = originalMediaList.find(x => {
                const t = x.type || (x.url && x.url.mimeType) || x.mimeType || '';
                return t.startsWith('image/');
            });
            if (firstImg) {
                if (firstImg.url && typeof firstImg.url === 'object' && firstImg.url.provider === 's3') {
                    memoryImage = { ...firstImg.url };
                } else if (firstImg.provider === 's3') {
                    memoryImage = { ...firstImg };
                } else if (typeof firstImg.url === 'string') {
                    memoryImage = firstImg.url;
                }
            }
        }

        let parsedFriends = (originalMemory && originalMemory.friends) || [];
        if (friends) {
            try {
                parsedFriends = typeof friends === 'string' ? JSON.parse(friends) : friends;
            } catch (_) {
                parsedFriends = Array.isArray(friends) ? friends : [friends];
            }
        }

        const formatDisplay = (u, fallback) =>
            u.username || u.name || `${u.first_name || u.firstName || ''} ${u.last_name || u.lastName || ''}`.trim() || fallback;

        const newShared = {
            from: currentEmail,
            from_username: formatDisplay(currentUser, currentEmail),
            to: normalizedTargetEmail,
            to_username: formatDisplay(toUser, normalizedTargetEmail),
            memory_id: 'm_' + crypto.randomBytes(6).toString('hex'),
            original_memory_id: originalMemory ? originalMemory.memory_id : (selected_memory_id || null),
            original_owner: originalMemory ? originalMemory.owner : currentEmail,
            memory_title: memory_title || (originalMemory ? originalMemory.title : 'Memory'),
            title: memory_title || (originalMemory ? originalMemory.title : 'Memory'),
            message: message || (originalMemory ? originalMemory.description : ''),
            description: (originalMemory && originalMemory.description) || description || message || '',
            date: date || (originalMemory ? originalMemory.date : new Date().toISOString().split('T')[0]),
            mood: (originalMemory && originalMemory.mood) || mood || '',
            location: (originalMemory && originalMemory.location) || location || '',
            tags: (originalMemory && originalMemory.tags) || tags || '',
            friends: parsedFriends,
            seen: false,
            attachments,
            media: copiedMedia,
            created_at: new Date().toISOString()
        };

        if (memoryImage) {
            newShared.image = memoryImage;
        }

        await sharingStore.add_shared_memory(newShared);
        metrics.memoriesSharedTotal.inc();

        res.json({
            success: true,
            message: 'Memory shared successfully',
            memory_id: newShared.memory_id,
            original_memory_id: newShared.original_memory_id
        });
    } catch (err) {
        console.error('Share memory error:', err.message);
        res.status(500).json({ error: 'Database service unavailable' });
    }
});

app.get('/api/shared_memories/:id', isAuthenticated, async (req, res) => {
    try {
        const currentEmail = req.userEmail;
        const memoryId = (req.query.share_id && typeof req.query.share_id === 'string')
            ? req.query.share_id.trim()
            : req.params.id;

        const lookup = await sharingStore.get_shared_memory_for_user(memoryId, currentEmail, {
            to: typeof req.query.to === 'string' ? req.query.to : undefined
        });

        if (!lookup.found) {
            return res.status(404).json({ error: 'Memory not found' });
        }
        if (!lookup.authorized) {
            return res.status(403).json({ error: 'Access denied: You are not authorized to access this shared memory.' });
        }
        if (!lookup.record) {
            return res.status(404).json({ error: 'Memory not found' });
        }

        const sharedMemory = lookup.record;
        if (normalizeEmail(sharedMemory.to) === currentEmail && !sharedMemory.seen) {
            await sharingStore.mark_shared_memory_seen(sharedMemory.memory_id, currentEmail);
            sharedMemory.seen = true;
        }

        if (Array.isArray(sharedMemory.attachments)) {
            sharedMemory.attachments = await presignAttachments(sharedMemory.attachments);
        }
        if (Array.isArray(sharedMemory.media)) {
            sharedMemory.media = await presignSharedMediaList(sharedMemory.media);
        }
        if (sharedMemory.image) {
            sharedMemory.image = await presignSharedImage(sharedMemory.image);
        }

        const rawReceived = await sharingStore.get_received_shared_memories(currentEmail);
        const receivedMemories = await Promise.all(rawReceived.map(async rm => {
            const rmCopy = { ...rm };
            if (Array.isArray(rmCopy.attachments)) {
                rmCopy.attachments = await presignAttachments(rmCopy.attachments);
            }
            if (Array.isArray(rmCopy.media)) {
                rmCopy.media = await presignSharedMediaList(rmCopy.media);
            }
            return rmCopy;
        }));

        res.json({ sharedMemory, receivedMemories });
    } catch (err) {
        console.error('Get shared memory by id error:', err.message);
        res.status(500).json({ error: 'Database service unavailable' });
    }
});

app.use(handleUploadError);
app.use((err, req, res, next) => {
    console.error('Unhandled Sharing Error:', err.message);
    res.status(500).json({ error: isProduction ? 'Internal Server Error' : (err.message || 'Internal Server Error') });
});

registerHealthRoutes({
    app,
    serviceName: 'sharing-service',
    displayName: 'Sharing Service',
    mongodb,
    isDbConnected: () => sharingStore.isDbConnected(),
    onConnected: onDbConnected
});

const startServer = createServiceStarter({
    app,
    port: PORT,
    displayName: 'Sharing Service',
    mongodb,
    onConnected: onDbConnected
});

if (require.main === module) {
    startServer();
}

module.exports = { app, startServer, sharingStore, capsuleSchedulerHeap };
