require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const { S3Storage, getMediaUrl } = require('./shared/s3_storage');

const common = require('./memories_common_functions');

const app = express();
const PORT = process.env.PORT || 3002;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const uploadDir = process.env.UPLOAD_DIR || (process.env.STORAGE_PATH ? path.join(process.env.STORAGE_PATH, 'Uploads') : path.join(__dirname, 'uploads/'));
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = new S3Storage({ bucket: process.env.AWS_S3_BUCKET || 'default-bucket', prefix: 'memories/' });
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

app.get('/api/memories', isAuthenticated, async (req, res) => {
    const currentEmail = req.userEmail;
    const allMemories = common.loadMemories();
    const userMemories = allMemories.filter(m => m.owner === currentEmail);
    const mapped = await Promise.all(userMemories.map(async m => {
        const mCopy = { ...m };
        if (mCopy.media && Array.isArray(mCopy.media)) {
            mCopy.media = await Promise.all(mCopy.media.map(async mediaItem => {
                if (mediaItem && mediaItem.url && typeof mediaItem.url === 'object' && mediaItem.url.provider === 's3') {
                    return { ...mediaItem, url: await getMediaUrl(mediaItem.url) };
                }
                return mediaItem;
            }));
        }
        return mCopy;
    }));
    res.json(mapped);
});

app.get('/api/internal/memories', async (req, res) => {
    const allMemories = common.loadMemories();
    const mapped = await Promise.all(allMemories.map(async m => {
        const mCopy = { ...m };
        if (mCopy.media && Array.isArray(mCopy.media)) {
            mCopy.media = await Promise.all(mCopy.media.map(async mediaItem => {
                if (mediaItem && mediaItem.url && typeof mediaItem.url === 'object' && mediaItem.url.provider === 's3') {
                    return { ...mediaItem, url: await getMediaUrl(mediaItem.url) };
                }
                return mediaItem;
            }));
        }
        return mCopy;
    }));
    res.json(mapped);
});

app.post('/api/memories', isAuthenticated, upload.array('memory_media[]', 10), (req, res) => {
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

    const allMemories = common.loadMemories();
    const newMemory = {
        memory_id: 'm_' + Math.random().toString(36).substr(2, 9),
        owner: currentEmail,
        title,
        date,
        mood: mood || '',
        location: location || '',
        description: description || '',
        tags: tags || '', // Added tags to match PHP
        friends: parsedFriends,
        media: mediaPaths,
        created_at: new Date().toISOString()
    };

    allMemories.push(newMemory);
    common.saveMemories(allMemories);

    res.json({ success: true, message: 'Memory added successfully' });
});

app.get('/api/memories/:id', isAuthenticated, async (req, res) => {
    const currentEmail = req.userEmail;
    const memoryId = req.params.id;
    const allMemories = common.loadMemories();
    const userMemories = allMemories.filter(m => m.owner === currentEmail);
    const memory = userMemories.find(m => m.memory_id === memoryId);

    if (memory) {
        const memIndex = userMemories.findIndex(m => m.memory_id === memoryId);
        const prevMemoryId = memIndex > 0 ? userMemories[memIndex - 1].memory_id : null;
        const nextMemoryId = memIndex >= 0 && memIndex < userMemories.length - 1 ? userMemories[memIndex + 1].memory_id : null;

        const mappedMemories = userMemories.map(m => ({ id: m.memory_id, title: m.title }));

        const memoryCopy = { ...memory };
        if (memoryCopy.media && Array.isArray(memoryCopy.media)) {
            memoryCopy.media = await Promise.all(memoryCopy.media.map(async mediaItem => {
                if (mediaItem && mediaItem.url && typeof mediaItem.url === 'object' && mediaItem.url.provider === 's3') {
                    return { ...mediaItem, url: await getMediaUrl(mediaItem.url) };
                }
                return mediaItem;
            }));
        }

        res.json({
            memory: memoryCopy,
            allUserMemories: mappedMemories,
            prevMemoryId,
            nextMemoryId
        });
    } else {
        res.status(404).json({ error: 'Memory not found' });
    }
});

app.delete('/api/memories/:id', isAuthenticated, (req, res) => {
    const currentEmail = req.userEmail;
    const memoryId = req.params.id;
    let allMemories = common.loadMemories();

    const initialLength = allMemories.length;
    allMemories = allMemories.filter(m => !(m.memory_id === memoryId && m.owner === currentEmail));

    if (allMemories.length < initialLength) {
        common.saveMemories(allMemories);
        res.json({ success: true, message: 'Memory deleted' });
    } else {
        res.status(404).json({ error: 'Memory not found or unauthorized' });
    }
});

app.use((err, req, res, next) => {
    console.error('Unhandled Error:', err);
    res.status(500).json({ error: err.message || 'Internal Server Error', stack: err.stack, name: err.name });
});

app.get('/health', (req, res) => {
    res.json({ status: 'UP', service: 'memories-service' });
});

const server = app.listen(PORT, () => {
    console.log(`Memories Service running on port ${PORT}`);
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
