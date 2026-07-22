const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const common = require('./ds/memories_common_functions');

const app = express();
const PORT = 3002;

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
        cb(null, 'mem_' + Date.now() + '-' + file.originalname)
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

app.get('/api/memories', isAuthenticated, (req, res) => {
    const currentEmail = req.userEmail;
    const allMemories = common.loadMemories();
    const userMemories = allMemories.filter(m => m.owner === currentEmail);
    res.json(userMemories);
});

app.get('/api/internal/memories', (req, res) => {
    res.json(common.loadMemories());
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
        mediaPaths = req.files.map(file => ({
            url: 'uploads/' + file.filename,
            type: file.mimetype,
            name: file.originalname // Added to match PHP logic
        }));
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

app.get('/api/memories/:id', isAuthenticated, (req, res) => {
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

        res.json({
            memory: memory,
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

app.listen(PORT, () => {
    console.log(`Memories Service running on port ${PORT}`);
});
