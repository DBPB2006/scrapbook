const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const common = require('./ds/sharing_common_functions');

const app = express();
const PORT = 3004;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const uploadDir = path.join(__dirname, 'uploads/');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadDir)
    },
    filename: function (req, file, cb) {
        cb(null, 'shared_' + Date.now() + path.extname(file.originalname))
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

// Capsules Routes
app.get('/api/capsules', isAuthenticated, async (req, res) => {
    const currentEmail = req.userEmail;
    let capsules = common.loadTimeCapsules();
    let updated = false;

    let userCapsules = [];
    for (let c of capsules) {
        if (c.user_email === currentEmail || c.recipient_email === currentEmail) {
            if (c.unlocked != 1 && c.reveal_date) {
                try {
                    const dsRes = await axios.post('http://ds-service:3005/api/ds/stack/isUnlocked', { reveal_date: c.reveal_date });
                    if (dsRes.data.unlocked) {
                        c.unlocked = 1;
                        updated = true;
                    }
                } catch(err) { console.error('DS check failed', err.message); }
            }
            userCapsules.push(c);
        }
    }

    if (updated) {
        common.saveTimeCapsules(capsules);
    }

    let sortedCapsules = userCapsules;
    try {
        const pqRes = await axios.post('http://ds-service:3005/api/ds/pq/sort', { capsules: userCapsules });
        sortedCapsules = pqRes.data;
    } catch(err) { console.error('DS sort failed', err.message); }
    
    res.json(sortedCapsules);
});

app.post('/api/capsules', isAuthenticated, upload.array('media[]'), (req, res) => {
    const { recipient_email, message, description, reveal_date } = req.body;
    const currentEmail = req.userEmail;
    
    if (!recipient_email || !message || !reveal_date) {
        return res.status(400).json({ error: 'Recipient, message, and reveal date are required.' });
    }

    const media = [];
    if (req.files) {
        req.files.forEach(file => {
            media.push({
                type: file.mimetype,
                path: 'uploads/' + file.filename,
                name: file.originalname
            });
        });
    }

    const capsules = common.loadTimeCapsules();
    const newCapsule = {
        id: 'tc_' + Math.random().toString(36).substr(2, 9),
        user_email: currentEmail,
        recipient_email: recipient_email,
        reveal_date: new Date(reveal_date).toISOString().replace('T', ' ').substring(0, 19),
        message,
        description,
        media,
        created_at: new Date().toISOString().replace('T', ' ').substring(0, 19),
        unlocked: 0
    };

    capsules.push(newCapsule);
    common.saveTimeCapsules(capsules);

    res.json({ success: true, message: 'Capsule created successfully' });
});

app.get('/api/capsules/:id', isAuthenticated, async (req, res) => {
    const currentEmail = req.userEmail;
    const capsuleId = req.params.id;
    let capsules = common.loadTimeCapsules();

    let capsule = null;
    let updated = false;

    for (let i = 0; i < capsules.length; i++) {
        let c = capsules[i];
        if (c.id === capsuleId && (c.user_email === currentEmail || c.recipient_email === currentEmail)) {
            capsule = c;
            if (c.unlocked != 1 && c.reveal_date) {
                try {
                    const dsRes = await axios.post('http://ds-service:3005/api/ds/stack/isUnlocked', { reveal_date: c.reveal_date });
                    if (dsRes.data.unlocked) {
                        capsules[i].unlocked = 1;
                        capsule.unlocked = 1;
                        updated = true;
                    }
                } catch(err) { console.error('DS check failed'); }
            }
            break;
        }
    }

    if (!capsule) {
        return res.status(404).json({ error: 'Capsule not found' });
    }

    if (updated) {
        common.saveTimeCapsules(capsules);
    }

    const otherCapsules = capsules.filter(c => c.id !== capsuleId && (c.user_email === currentEmail || c.recipient_email === currentEmail));

    res.json({ capsule, otherCapsules });
});


// Shared Memories Routes
app.get('/api/shared_memories', isAuthenticated, (req, res) => {
    const currentEmail = req.userEmail;
    const allShared = common.loadSharedMemories();
    const userShared = allShared.filter(m => m.from === currentEmail || m.to === currentEmail);
    const enriched = userShared.map(m => ({
        ...m,
        is_received: m.to === currentEmail
    }));
    enriched.reverse();
    res.json(enriched);
});

app.get('/api/internal/shared_memories', (req, res) => {
    res.json(common.loadSharedMemories());
});

app.post('/api/shared_memories', isAuthenticated, upload.array('attachments[]'), async (req, res) => {
    const currentEmail = req.userEmail;
    const { to_email, memory_title, message, date, selected_memory_id } = req.body;
    
    let allUsers = [];
    try {
        const usersRes = await axios.get('http://auth-service:3001/api/users', { headers: { 'x-user-email': currentEmail } });
        allUsers = usersRes.data;
    } catch(err) { console.error(err); }
    
    const currentUser = allUsers.find(u => u.email === currentEmail) || { email: currentEmail, name: currentEmail };
    const toUser = allUsers.find(u => u.email === to_email);
    
    if (!to_email || !memory_title || !message || !date) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    if (!toUser) {
        return res.status(404).json({ error: 'Recipient user not found' });
    }

    const attachments = [];
    if (req.files) {
        req.files.forEach(f => {
            attachments.push('uploads/' + f.filename);
        });
    }

    let originalMemory = null;
    if (selected_memory_id) {
        try {
            const memRes = await axios.get('http://memories-service:3002/api/internal/memories');
            const allMemories = memRes.data;
            originalMemory = allMemories.find(m => m.memory_id === selected_memory_id && m.owner === currentEmail);
        } catch(err) { console.error('Failed to fetch memories'); }
    }

    const newShared = {
        from: currentEmail,
        from_username: currentUser.username || currentUser.name,
        to: to_email,
        to_username: toUser.username || toUser.name,
        memory_id: 'm_' + Math.random().toString(36).substr(2, 9),
        original_memory_id: originalMemory ? originalMemory.memory_id : null,
        memory_title: memory_title,
        message: message,
        date: date,
        seen: false,
        attachments: attachments
    };

    if (originalMemory && originalMemory.image) {
        newShared.image = originalMemory.image;
    }

    const allShared = common.loadSharedMemories();
    allShared.push(newShared);
    common.saveSharedMemories(allShared);

    res.json({ success: true, message: 'Memory shared successfully' });
});

app.get('/api/shared_memories/:id', isAuthenticated, (req, res) => {
    const currentEmail = req.userEmail;
    const memoryId = req.params.id;
    let allShared = common.loadSharedMemories();
    
    let receivedMemories = allShared.filter(m => m.to === currentEmail);
    
    let sharedMemory = null;
    let updated = false;

    for (let i = 0; i < allShared.length; i++) {
        let m = allShared[i];
        if (m.to === currentEmail && (m.memory_id === memoryId || m.original_memory_id === memoryId)) {
            sharedMemory = m;
            if (!m.seen) {
                allShared[i].seen = true;
                sharedMemory.seen = true;
                updated = true;
            }
            break;
        }
    }

    if (!sharedMemory) {
        return res.status(404).json({ error: 'Memory not found' });
    }

    if (updated) {
        common.saveSharedMemories(allShared);
    }

    res.json({ sharedMemory, receivedMemories });
});

app.listen(PORT, () => {
    console.log(`Sharing Service running on port ${PORT}`);
});
