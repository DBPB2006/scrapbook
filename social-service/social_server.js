const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const axios = require('axios');

const app = express();
const PORT = 3003;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const uploadDir = path.join(__dirname, 'uploads/friends/');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadDir)
    },
    filename: function (req, file, cb) {
        cb(null, 'friend_' + Date.now() + path.extname(file.originalname))
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

app.get('/api/friends', isAuthenticated, async (req, res) => {
    const currentEmail = req.userEmail;
    
    let allUsers = [];
    try {
        const usersRes = await axios.get('http://auth-service:3001/api/users', { headers: { 'x-user-email': currentEmail } });
        allUsers = usersRes.data;
    } catch(err) { console.error('Failed to fetch users'); }
    
    const user = allUsers.find(u => u.email === currentEmail) || {};
    
    let allMemories = [];
    try {
        const memRes = await axios.get('http://memories-service:3002/api/internal/memories');
        allMemories = memRes.data;
    } catch(err) { console.error('Failed to fetch memories'); }
    
    const userMemories = allMemories.filter(m => m.owner === currentEmail);
    
    const friends = user.friends || [];
    
    const friendsWithCounts = friends.map(f => {
        const friendId = f.friend_id || f.id || f.email;
        const memCount = userMemories.filter(m => m.friends && m.friends.includes(friendId)).length;
        return {
            ...f,
            memoryCount: memCount
        };
    });

    res.json(friendsWithCounts);
});

app.post('/api/friends', isAuthenticated, upload.single('profileImage'), async (req, res) => {
    const currentEmail = req.userEmail;
    let allUsers = [];
    let usersData = {};
    try {
        const usersRes = await axios.get('http://auth-service:3001/api/internal/users/raw');
        usersData = usersRes.data;
        for (const bucket in usersData) {
            for (const email in usersData[bucket]) {
                allUsers.push(usersData[bucket][email]);
            }
        }
    } catch(err) { console.error('Failed to fetch users'); }
    
    const user = allUsers.find(u => u.email === currentEmail) || { email: currentEmail };
    
    const { friendName, friendEmail, relationshipTag, howYouMet } = req.body;

    if (!friendName || !howYouMet || !friendEmail) {
        return res.status(400).json({ error: 'All required fields must be filled.' });
    }

    if (user.friends && user.friends.some(f => f.email && f.email.toLowerCase() === friendEmail.toLowerCase())) {
        return res.status(400).json({ error: 'Friend with this email already exists.' });
    }

    let imgUrl = '';
    if (req.file) {
        imgUrl = 'uploads/friends/' + req.file.filename;
    }

    const newFriend = {
        friend_id: 'f_' + Math.random().toString(36).substr(2, 9),
        name: friendName,
        email: friendEmail.toLowerCase(),
        relationship_type: relationshipTag || '',
        how_you_met: howYouMet,
        image_url: imgUrl,
        date_added: new Date().toISOString()
    };

    if (!user.friends) {
        user.friends = [];
    }
    user.friends.push(newFriend);
    
    try {
        await axios.post('http://auth-service:3001/api/internal/users', user);
    } catch (err) { console.error('Failed to save user'); }

    res.json({ success: true, message: 'Friend added successfully' });
});

app.delete('/api/friends/:id', isAuthenticated, async (req, res) => {
    const currentEmail = req.userEmail;
    const friendId = req.params.id;
    
    let allUsers = [];
    try {
        const usersRes = await axios.get('http://auth-service:3001/api/users', { headers: { 'x-user-email': currentEmail } });
        allUsers = usersRes.data;
    } catch(err) { console.error('Failed to fetch users'); }
    
    const user = allUsers.find(u => u.email === currentEmail) || { email: currentEmail };

    if (user.friends) {
        user.friends = user.friends.filter(f => f.friend_id !== friendId && f.id !== friendId);
        try {
            await axios.post('http://auth-service:3001/api/internal/users', user);
        } catch (err) { console.error('Failed to save user'); }
    }
    
    res.json({ success: true, message: 'Friend removed' });
});

app.get('/api/friendship_graph', isAuthenticated, async (req, res) => {
    const currentEmail = req.userEmail;
    
    let usersData = {};
    try {
        const usersRes = await axios.get('http://auth-service:3001/api/internal/users/raw');
        usersData = usersRes.data;
    } catch(err) { console.error('Failed to fetch users'); }

    const allUsers = {};
    for (const bucket in usersData) {
        for (const email in usersData[bucket]) {
            allUsers[email] = usersData[bucket][email];
        }
    }

    let nodes = {}, emails = [], emailIndexMap = {}, friendshipMatrix = [];
    try {
        const dsRes = await axios.post('http://ds-service:3005/api/ds/network/matrix', { usersData, allUsers });
        ({ nodes, emails, emailIndexMap, friendshipMatrix } = dsRes.data);
    } catch(err) { console.error('Failed to build matrix via DS service'); }

    const size = Object.keys(nodes).length;

    let allMemories = [];
    try {
        const memRes = await axios.get('http://memories-service:3002/api/internal/memories');
        allMemories = memRes.data;
    } catch(err) { console.error('Failed to fetch memories'); }
    
    const myMemories = allMemories.filter(m => m.owner === currentEmail);
    
    const memoryMatrix = Array.from({ length: size }, () => Array(size).fill(0));
    const memoryEdges = {};
    const memoryLocations = [];

    const ownerIdx = emailIndexMap[currentEmail];
    myMemories.forEach(memory => {
        if (memory.friends && Array.isArray(memory.friends)) {
            memory.friends.forEach(friendEmail => {
                if (emailIndexMap[friendEmail] !== undefined) {
                    const friendIdx = emailIndexMap[friendEmail];
                    memoryMatrix[ownerIdx][friendIdx]++;
                    memoryMatrix[friendIdx][ownerIdx]++;

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
        if (memory.location) {
            memoryLocations.push({
                title: memory.title || '',
                location: memory.location,
                id: memory.memory_id || ''
            });
        }
    });

    const userTypes = [];
    let friendEmails = [];
    if (allUsers[currentEmail] && Array.isArray(allUsers[currentEmail].friends)) {
        friendEmails = allUsers[currentEmail].friends.map(f => f.email || f.id || f.friend_id);
    }

    emails.forEach((email, i) => {
        if (email === currentEmail) userTypes[i] = 'current';
        else if (friendEmails.includes(email)) userTypes[i] = 'friend';
        else userTypes[i] = 'other';
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

    const friendGraph = {};
    for (const email in allUsers) {
        friendGraph[email] = (allUsers[email].friends || []).map(f => f.email || f.id || f.friend_id);
    }

    let suggestedEmails = [];
    try {
        const suggRes = await axios.post('http://ds-service:3005/api/ds/network/suggestions', {
            friendshipMatrix, emailIndexMap, emails, currentEmail, friendGraph
        });
        suggestedEmails = suggRes.data.suggestions || [];
    } catch(err) { console.error('Failed to get suggestions via DS service'); }

    const suggestedFriends = suggestedEmails.map(email => nodes[email] ? nodes[email].name : email);

    res.json({
        userCount: size,
        currentUserIndex: emailIndexMap[currentEmail] !== undefined ? emailIndexMap[currentEmail] : -1,
        users: Object.values(nodes),
        nodeTypes: userTypes,
        nodePositions,
        friendshipMatrix,
        memoryMatrix,
        memoryEdges,
        memoryLocations,
        suggestedFriends
    });
});

app.listen(PORT, () => {
    console.log(`Social Service running on port ${PORT}`);
});
