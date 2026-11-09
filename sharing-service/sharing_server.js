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
const { S3Storage, getMediaUrl, getDownloadUrl } = s3Module;

const sharingStore = require('./src/sharing_store');
const { BinaryMinHeap } = require('./src/min_heap');
const { isCapsuleUnlocked, calculateTimeDifference, displayTimeDifference } = require('./src/time_stack');

const app = express();
const PORT = process.env.PORT || 3004;
const isProduction = process.env.NODE_ENV === 'production';

const INTERNAL_SECRET = process.env.INTERNAL_SERVICE_SECRET || 'mb-internal-service-secret-2026';
const GATEWAY_SECRET = process.env.GATEWAY_SHARED_SECRET || 'mb-gateway-service-secret-2026';

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(metrics.metricsMiddleware);
app.get('/metrics', metrics.metricsEndpoint);

const storage = new S3Storage({ bucket: process.env.AWS_S3_BUCKET || 'default-bucket', prefix: 'shared/' });
const upload = multer({ storage: storage });

// Security: Verify identity propagated from Gateway or internal service
const isAuthenticated = (req, res, next) => {
    const email = req.headers['x-user-email'];
    const gwHeader = req.headers['x-gateway-secret'];
    const intHeader = req.headers['x-internal-secret'];

    // In production, reject requests attempting to bypass Gateway identity checks
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

// In-memory Min-Heap scheduling structure (Synopsis §6.3)
const capsuleSchedulerHeap = new BinaryMinHeap();

// Server-side unlock evaluator (Synopsis §6.3 & §9 Table 6)
// Compares current server time against stored unlock_at/reveal_date value as authoritative source of truth
const checkIsUnlocked = async (revealDateStr) => {
    return isCapsuleUnlocked(revealDateStr);
};

// =============================================================================
// Time Capsules Routes
// =============================================================================

app.get('/api/capsules', isAuthenticated, async (req, res) => {
    try {
        const currentEmail = req.userEmail;
        const userCapsules = await sharingStore.get_user_capsules(currentEmail);
        let updated = false;

        for (const c of userCapsules) {
            if (c.unlocked != 1 && c.reveal_date) {
                if (await checkIsUnlocked(c.reveal_date)) {
                    await sharingStore.unlock_capsule(c.id);
                    c.unlocked = 1;
                    updated = true;
                }
            }
        }

        if (updated) {
            // Refresh in-memory scheduler heap on state change from MongoDB
            const remainingLocked = await sharingStore.get_locked_capsules();
            capsuleSchedulerHeap.rebuild(remainingLocked);
        }

        // Chronological scheduling sort using native Binary Min-Heap (Synopsis §6.3)
        const userHeap = new BinaryMinHeap();
        userCapsules.forEach(c => userHeap.insert(c, c.reveal_date));
        const sortedCapsules = userHeap.toSortedArray();

        // Task 1: Mask secret message and media URLs for locked capsules
        const sanitizedCapsules = await Promise.all(sortedCapsules.map(async c => {
            const isUnlocked = c.unlocked == 1;
            const cCopy = { ...c };

            if (!isUnlocked) {
                cCopy.message = `[Locked until ${c.reveal_date}]`;
                cCopy.description = null;
                cCopy.media = [];
                cCopy.is_locked = true;
            } else {
                cCopy.is_locked = false;
                if (cCopy.media && Array.isArray(cCopy.media)) {
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
            }
            return cCopy;
        }));

        res.json(sanitizedCapsules);
    } catch (err) {
        console.error('Get capsules error:', err.message);
        res.status(500).json({ error: 'Database service unavailable' });
    }
});

app.post('/api/capsules', isAuthenticated, upload.array('media[]'), async (req, res) => {
    try {
        const { recipient_email, message, description, reveal_date } = req.body;
        const currentEmail = req.userEmail;

        if (!recipient_email || !message || !reveal_date) {
            return res.status(400).json({ error: 'Recipient, message, and reveal date are required.' });
        }

        const media = [];
        if (req.files) {
            req.files.forEach(file => {
                if (file.provider === 's3') {
                    media.push({
                        type: file.mimeType,
                        path: { provider: 's3', key: file.key, mimeType: file.mimeType, fileName: file.fileName, size: file.size },
                        name: file.fileName
                    });
                } else {
                    media.push({
                        type: file.mimetype,
                        path: 'uploads/' + file.filename,
                        name: file.originalname
                    });
                }
            });
        }

        const isoReveal = String(reveal_date).replace(' ', 'T');
        const parsedRevealDate = new Date(isoReveal.includes('Z') || isoReveal.includes('+') ? isoReveal : isoReveal + 'Z');
        const normalizedRevealDate = !isNaN(parsedRevealDate.getTime())
            ? parsedRevealDate.toISOString().replace('T', ' ').substring(0, 19)
            : reveal_date;

        const newCapsule = {
            id: 'tc_' + Math.random().toString(36).substr(2, 9),
            user_email: currentEmail.toLowerCase(),
            recipient_email: recipient_email.toLowerCase(),
            reveal_date: normalizedRevealDate,
            message,
            description: description || '',
            media,
            created_at: new Date().toISOString().replace('T', ' ').substring(0, 19),
            unlocked: 0
        };

        // Persist authoritatively to MongoDB
        await sharingStore.add_capsule(newCapsule);
        // Maintain in-memory Min-Heap
        capsuleSchedulerHeap.insert(newCapsule, newCapsule.reveal_date);

        res.json({ success: true, message: 'Capsule created successfully' });
    } catch (err) {
        console.error('Create capsule error:', err.message);
        res.status(500).json({ error: 'Database service unavailable' });
    }
});

app.get('/api/internal/capsules/scheduler_peek', (req, res) => {
    const nextItem = capsuleSchedulerHeap.peek();
    const nextNode = capsuleSchedulerHeap.peekNode();
    res.json({
        heapSize: capsuleSchedulerHeap.size(),
        earliestUnlock: nextNode ? nextNode.priority : null,
        nextCapsule: nextItem
    });
});

app.post('/api/capsules/countdown', (req, res) => {
    const { start_date, reveal_date } = req.body;
    if (!reveal_date) return res.status(400).json({ error: 'reveal_date is required' });
    const nowStr = start_date || new Date().toISOString();
    const diff = calculateTimeDifference(nowStr, reveal_date);
    const formatted = displayTimeDifference(nowStr, reveal_date);
    const unlocked = isCapsuleUnlocked(reveal_date);
    res.json({ diff, formatted, unlocked });
});

app.get('/api/capsules/:id', isAuthenticated, async (req, res) => {
    try {
        const currentEmail = req.userEmail.toLowerCase();
        const capsuleId = req.params.id;

        const targetCapsule = await sharingStore.get_capsule_by_id(capsuleId);

        if (!targetCapsule) {
            return res.status(404).json({ error: 'Capsule not found' });
        }

        // Authorization check - only sender and recipient may access capsule metadata or content
        if (targetCapsule.user_email.toLowerCase() !== currentEmail && targetCapsule.recipient_email.toLowerCase() !== currentEmail) {
            return res.status(403).json({ error: 'Access denied: You are not authorized to access this capsule.' });
        }

        // Server-side unlock eligibility evaluation
        let updated = false;
        if (targetCapsule.unlocked != 1 && targetCapsule.reveal_date) {
            if (await checkIsUnlocked(targetCapsule.reveal_date)) {
                await sharingStore.unlock_capsule(targetCapsule.id);
                targetCapsule.unlocked = 1;
                updated = true;
            }
        }

        if (updated) {
            const remainingLocked = await sharingStore.get_locked_capsules();
            capsuleSchedulerHeap.rebuild(remainingLocked);
        }

        const isUnlocked = targetCapsule.unlocked == 1;
        const capsuleCopy = { ...targetCapsule };

        if (!isUnlocked) {
            // Enforce server-side secret masking: never return locked secret content or media URLs
            capsuleCopy.message = `[Locked until ${targetCapsule.reveal_date}]`;
            capsuleCopy.description = null;
            capsuleCopy.media = [];
            capsuleCopy.is_locked = true;
        } else {
            capsuleCopy.is_locked = false;
            if (capsuleCopy.media && Array.isArray(capsuleCopy.media)) {
                capsuleCopy.media = await Promise.all(capsuleCopy.media.map(async m => {
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
        }

        // Sanitize otherCapsules sidebar to prevent metadata or payload leaks
        const userCapsules = await sharingStore.get_user_capsules(currentEmail);
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
        const currentEmail = req.userEmail.toLowerCase();
        const userShared = await sharingStore.get_user_shared_memories(currentEmail);
        const enriched = await Promise.all(userShared.map(async m => {
            const mCopy = { ...m, is_received: m.to === currentEmail };
            if (mCopy.attachments && Array.isArray(mCopy.attachments)) {
                mCopy.attachments = await Promise.all(mCopy.attachments.map(async att => {
                    const rawAtt = att;
                    const fileName = (typeof rawAtt === 'object' && (rawAtt.fileName || rawAtt.name)) || '';
                    const previewUrl = await getMediaUrl(rawAtt);
                    const downloadUrl = await getDownloadUrl(rawAtt, fileName);
                    return {
                        preview_url: previewUrl,
                        download_url: downloadUrl || previewUrl,
                        fileName: fileName,
                        name: fileName,
                        url: previewUrl,
                        mimeType: (typeof rawAtt === 'object' && (rawAtt.mimeType || rawAtt.type)) || '',
                        type: (typeof rawAtt === 'object' && (rawAtt.mimeType || rawAtt.type)) || ''
                    };
                }));
            }
            if (mCopy.media && Array.isArray(mCopy.media)) {
                mCopy.media = await Promise.all(mCopy.media.map(async mItem => {
                    const rawObj = (mItem && typeof mItem.url === 'object') ? mItem.url : mItem;
                    const fileName = (mItem && mItem.name) || (typeof rawObj === 'object' && (rawObj.fileName || rawObj.name)) || '';
                    const previewUrl = await getMediaUrl(rawObj);
                    const downloadUrl = await getDownloadUrl(rawObj, fileName);
                    return {
                        ...mItem,
                        preview_url: previewUrl,
                        download_url: downloadUrl || previewUrl,
                        fileName: fileName,
                        name: fileName,
                        url: previewUrl
                    };
                }));
            }
            if (mCopy.image) {
                const rawImg = mCopy.image;
                const fileName = (typeof rawImg === 'object' && (rawImg.fileName || rawImg.name)) || '';
                const previewUrl = await getMediaUrl(rawImg);
                const downloadUrl = await getDownloadUrl(rawImg, fileName);
                mCopy.image = {
                    preview_url: previewUrl,
                    download_url: downloadUrl || previewUrl,
                    fileName: fileName,
                    name: fileName,
                    url: previewUrl
                };
            }
            return mCopy;
        }));
        enriched.reverse();
        res.json(enriched);
    } catch (err) {
        console.error('Get shared memories error:', err.message);
        res.status(500).json({ error: 'Database service unavailable' });
    }
});

// Internal endpoint protected with internal service authorization
app.get('/api/internal/shared_memories', isInternalService, async (req, res) => {
    try {
        const allShared = await sharingStore.load_all_shared_memories();
        const mapped = await Promise.all(allShared.map(async m => {
            const mCopy = { ...m };
            if (mCopy.attachments && Array.isArray(mCopy.attachments)) {
                mCopy.attachments = await Promise.all(mCopy.attachments.map(async att => {
                    const rawAtt = att;
                    const fileName = (typeof rawAtt === 'object' && (rawAtt.fileName || rawAtt.name)) || '';
                    const previewUrl = await getMediaUrl(rawAtt);
                    const downloadUrl = await getDownloadUrl(rawAtt, fileName);
                    return {
                        preview_url: previewUrl,
                        download_url: downloadUrl || previewUrl,
                        fileName: fileName,
                        name: fileName,
                        url: previewUrl,
                        mimeType: (typeof rawAtt === 'object' && (rawAtt.mimeType || rawAtt.type)) || '',
                        type: (typeof rawAtt === 'object' && (rawAtt.mimeType || rawAtt.type)) || ''
                    };
                }));
            }
            return mCopy;
        }));
        res.json(mapped);
    } catch (err) {
        console.error('Internal shared memories error:', err.message);
        res.status(500).json({ error: 'Database service unavailable' });
    }
});

app.post('/api/shared_memories', isAuthenticated, upload.array('attachments[]'), async (req, res) => {
    try {
        const currentEmail = req.userEmail.toLowerCase();
        const { to_email, memory_title, message, date, selected_memory_id, mood, location, tags, description, friends } = req.body;

        let allUsers = [];
        try {
            const usersRes = await axios.get(`${process.env.AUTH_SERVICE_URL || 'http://auth-service:3001'}/api/internal/users/raw`, {
                headers: {
                    'x-internal-secret': INTERNAL_SECRET
                }
            });
            const usersData = usersRes.data || {};
            if (Array.isArray(usersData)) {
                allUsers = usersData;
            } else {
                for (const bucket in usersData) {
                    for (const email in usersData[bucket]) {
                        allUsers.push(usersData[bucket][email]);
                    }
                }
            }
        } catch (err) {
            console.error('Failed to query users internally from auth service:', err.message);
        }

        const currentUser = allUsers.find(u => u.email && u.email.toLowerCase() === currentEmail) || { email: currentEmail, name: currentEmail };
        const toUser = allUsers.find(u => u.email && u.email.toLowerCase() === (to_email || '').toLowerCase());

        if (!to_email || (!memory_title && !selected_memory_id)) {
            return res.status(400).json({ error: 'Missing required fields: recipient and memory title or selected memory are required.' });
        }

        if (!toUser) {
            return res.status(404).json({ error: 'Recipient user not found' });
        }

        let originalMemory = null;
        if (selected_memory_id) {
            try {
                try {
                    const memRes = await axios.get(`${process.env.MEMORIES_SERVICE_URL || 'http://memories-service:3002'}/api/internal/memories/${encodeURIComponent(selected_memory_id)}`, {
                        headers: { 'x-internal-secret': INTERNAL_SECRET },
                        timeout: 5000
                    });
                    if (memRes.data && memRes.data.owner && memRes.data.owner.toLowerCase() === currentEmail) {
                        originalMemory = memRes.data;
                    }
                } catch (e) {
                    const listRes = await axios.get(`${process.env.MEMORIES_SERVICE_URL || 'http://memories-service:3002'}/api/internal/memories`, {
                        headers: { 'x-internal-secret': INTERNAL_SECRET },
                        timeout: 5000
                    });
                    const allMemories = listRes.data || [];
                    originalMemory = allMemories.find(m => m.memory_id === selected_memory_id && m.owner && m.owner.toLowerCase() === currentEmail);
                }
            } catch (err) {
                console.error('Failed to fetch memories', err.message);
            }
        }

        const attachments = [];
        const copiedMedia = [];

        // 1. Copy ALL media items from the original memory
        const originalMediaList = (originalMemory && originalMemory.raw_media && Array.isArray(originalMemory.raw_media) && originalMemory.raw_media.length > 0)
            ? originalMemory.raw_media
            : (originalMemory && originalMemory.media && Array.isArray(originalMemory.media) ? originalMemory.media : []);

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
                copiedMedia.push({
                    url: attObj,
                    type: mItem.type || mItem.url.mimeType || '',
                    name: mItem.name || mItem.url.fileName || ''
                });
            } else if (mItem.provider === 's3' && mItem.key) {
                const attObj = {
                    provider: 's3',
                    key: mItem.key,
                    mimeType: mItem.mimeType || mItem.type || '',
                    fileName: mItem.fileName || mItem.name || '',
                    size: mItem.size || 0
                };
                attachments.push(attObj);
                copiedMedia.push({
                    url: attObj,
                    type: mItem.mimeType || mItem.type || '',
                    name: mItem.fileName || mItem.name || ''
                });
            } else if (typeof mItem.url === 'string') {
                attachments.push(mItem.url);
                copiedMedia.push({
                    url: mItem.url,
                    type: mItem.type || '',
                    name: mItem.name || mItem.url.split('/').pop()
                });
            } else if (typeof mItem === 'string') {
                attachments.push(mItem);
                copiedMedia.push({
                    url: mItem,
                    type: '',
                    name: mItem.split('/').pop()
                });
            }
        });

        // 2. Include any newly uploaded files
        if (req.files && Array.isArray(req.files)) {
            req.files.forEach(f => {
                if (f.provider === 's3') {
                    const attObj = {
                        provider: 's3',
                        key: f.key,
                        mimeType: f.mimeType,
                        fileName: f.fileName,
                        size: f.size
                    };
                    attachments.push(attObj);
                    copiedMedia.push({
                        url: attObj,
                        type: f.mimeType,
                        name: f.fileName
                    });
                } else {
                    const localPath = 'uploads/' + f.filename;
                    attachments.push(localPath);
                    copiedMedia.push({
                        url: localPath,
                        type: f.mimetype,
                        name: f.originalname
                    });
                }
            });
        }

        // 3. Derive memory image
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

        // Parse friends safely
        let parsedFriends = (originalMemory && originalMemory.friends) || [];
        if (friends) {
            try {
                parsedFriends = typeof friends === 'string' ? JSON.parse(friends) : friends;
            } catch (e) {
                parsedFriends = Array.isArray(friends) ? friends : [friends];
            }
        }

        const newShared = {
            from: currentEmail,
            from_username: currentUser.username || currentUser.name,
            to: to_email.toLowerCase(),
            to_username: toUser.username || toUser.name,
            memory_id: 'm_' + Math.random().toString(36).substr(2, 9),
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
            attachments: attachments,
            media: copiedMedia,
            created_at: new Date().toISOString()
        };

        if (memoryImage) {
            newShared.image = memoryImage;
        }

        await sharingStore.add_shared_memory(newShared);
        metrics.memoriesSharedTotal.inc();

        res.json({ success: true, message: 'Memory shared successfully', memory_id: newShared.memory_id });
    } catch (err) {
        console.error('Share memory error:', err.message);
        res.status(500).json({ error: 'Database service unavailable' });
    }
});

app.get('/api/shared_memories/:id', isAuthenticated, async (req, res) => {
    try {
        const currentEmail = req.userEmail.toLowerCase();
        const memoryId = req.params.id;

        const sharedMemory = await sharingStore.get_shared_memory_by_id(memoryId, currentEmail);

        if (!sharedMemory) {
            return res.status(404).json({ error: 'Memory not found' });
        }

        if (!sharedMemory.seen) {
            await sharingStore.mark_shared_memory_seen(memoryId, currentEmail);
            sharedMemory.seen = true;
        }

        let receivedMemories = await sharingStore.get_received_shared_memories(currentEmail);

        if (sharedMemory.attachments && Array.isArray(sharedMemory.attachments)) {
            sharedMemory.attachments = await Promise.all(sharedMemory.attachments.map(async att => {
                const rawAtt = att;
                const fileName = (typeof rawAtt === 'object' && (rawAtt.fileName || rawAtt.name)) || '';
                const previewUrl = await getMediaUrl(rawAtt);
                const downloadUrl = await getDownloadUrl(rawAtt, fileName);
                return {
                    preview_url: previewUrl,
                    download_url: downloadUrl || previewUrl,
                    fileName: fileName,
                    name: fileName,
                    url: previewUrl,
                    mimeType: (typeof rawAtt === 'object' && (rawAtt.mimeType || rawAtt.type)) || '',
                    type: (typeof rawAtt === 'object' && (rawAtt.mimeType || rawAtt.type)) || ''
                };
            }));
        }

        if (sharedMemory.media && Array.isArray(sharedMemory.media)) {
            sharedMemory.media = await Promise.all(sharedMemory.media.map(async mItem => {
                const rawObj = (mItem && typeof mItem.url === 'object') ? mItem.url : mItem;
                const fileName = (mItem && mItem.name) || (typeof rawObj === 'object' && (rawObj.fileName || rawObj.name)) || '';
                const previewUrl = await getMediaUrl(rawObj);
                const downloadUrl = await getDownloadUrl(rawObj, fileName);
                return {
                    ...mItem,
                    preview_url: previewUrl,
                    download_url: downloadUrl || previewUrl,
                    fileName: fileName,
                    name: fileName,
                    url: previewUrl
                };
            }));
        }

        if (sharedMemory.image) {
            const rawImg = sharedMemory.image;
            const fileName = (typeof rawImg === 'object' && (rawImg.fileName || rawImg.name)) || '';
            const previewUrl = await getMediaUrl(rawImg);
            const downloadUrl = await getDownloadUrl(rawImg, fileName);
            sharedMemory.image = {
                preview_url: previewUrl,
                download_url: downloadUrl || previewUrl,
                fileName: fileName,
                name: fileName,
                url: previewUrl
            };
        }

        receivedMemories = await Promise.all(receivedMemories.map(async rm => {
            const rmCopy = { ...rm };
            if (rmCopy.attachments && Array.isArray(rmCopy.attachments)) {
                rmCopy.attachments = await Promise.all(rmCopy.attachments.map(async att => {
                    const rawAtt = att;
                    const fileName = (typeof rawAtt === 'object' && (rawAtt.fileName || rawAtt.name)) || '';
                    const previewUrl = await getMediaUrl(rawAtt);
                    const downloadUrl = await getDownloadUrl(rawAtt, fileName);
                    return {
                        preview_url: previewUrl,
                        download_url: downloadUrl || previewUrl,
                        fileName: fileName,
                        name: fileName,
                        url: previewUrl,
                        mimeType: (typeof rawAtt === 'object' && (rawAtt.mimeType || rawAtt.type)) || '',
                        type: (typeof rawAtt === 'object' && (rawAtt.mimeType || rawAtt.type)) || ''
                    };
                }));
            }
            if (rmCopy.media && Array.isArray(rmCopy.media)) {
                rmCopy.media = await Promise.all(rmCopy.media.map(async mItem => {
                    const rawObj = (mItem && typeof mItem.url === 'object') ? mItem.url : mItem;
                    const fileName = (mItem && mItem.name) || (typeof rawObj === 'object' && (rawObj.fileName || rawObj.name)) || '';
                    const previewUrl = await getMediaUrl(rawObj);
                    const downloadUrl = await getDownloadUrl(rawObj, fileName);
                    return {
                        ...mItem,
                        preview_url: previewUrl,
                        download_url: downloadUrl || previewUrl,
                        fileName: fileName,
                        name: fileName,
                        url: previewUrl
                    };
                }));
            }
            return rmCopy;
        }));

        res.json({ sharedMemory, receivedMemories });
    } catch (err) {
        console.error('Get shared memory by id error:', err.message);
        res.status(500).json({ error: 'Database service unavailable' });
    }
});

app.use((err, req, res, next) => {
    console.error('Unhandled Sharing Error:', err);
    res.status(500).json({
        error: isProduction ? 'Internal Server Error' : (err.message || 'Internal Server Error')
    });
});

const HEALTH_DB_PING_TIMEOUT_MS = 2000;

async function isDatabaseHealthy() {
    if (!sharingStore.isDbConnected()) {
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
        service: 'sharing-service'
    });
});

app.get('/health', async (req, res) => {
    const dbConnected = await isDatabaseHealthy();
    res.status(dbConnected ? 200 : 503).json({
        status: dbConnected ? 'UP' : 'DOWN',
        service: 'sharing-service',
        database: dbConnected ? 'connected' : 'disconnected'
    });
});

let serverInstance = null;

async function startServer() {
    if (mongodb && process.env.MONGODB_URI) {
        try {
            const { db } = await mongodb.connect();
            await mongodb.initializeIndexes(db);
            console.log('Sharing Service: Successfully connected to MongoDB and initialized indexes.');

            // Rebuild in-memory capsule scheduler heap from authoritative MongoDB store
            try {
                const lockedCaps = await sharingStore.get_locked_capsules();
                capsuleSchedulerHeap.rebuild(lockedCaps);
                console.log(`Sharing Service: Loaded ${lockedCaps.length} locked capsule(s) into Min-Heap scheduler.`);
            } catch (heapErr) {
                console.warn('Failed to rebuild capsule scheduler heap:', heapErr.message);
            }
        } catch (err) {
            console.error('Sharing Service: Error - MongoDB connection failed on startup:', err.message);
        }
    } else {
        console.warn('Sharing Service: Warning - No MONGODB_URI configured.');
    }

    serverInstance = app.listen(PORT, () => {
        console.log(`Sharing Service running on port ${PORT}`);
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

module.exports = { app, startServer, sharingStore, capsuleSchedulerHeap };
