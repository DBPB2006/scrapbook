const express = require('express');
const cors = require('cors');
const { PriorityQueue } = require('./src/ds_priority_queue');
const { isCapsuleUnlocked } = require('./src/ds_stack');
const networkMatrix = require('./src/ds_network_matrix');
const bucketStore = require('./src/ds_bucketed_user_store');

const app = express();
const PORT = 3005;

app.use(cors());
app.use(express.json({ limit: '50mb' }));

app.post('/api/ds/pq/sort', (req, res) => {
    try {
        const capsules = req.body.capsules || [];
        const pq = new PriorityQueue();
        capsules.forEach(c => pq.insert(c, c.reveal_date));
        res.json(pq.toSortedArray());
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/ds/stack/isUnlocked', (req, res) => {
    try {
        const { reveal_date } = req.body;
        if (!reveal_date) return res.status(400).json({ error: 'reveal_date is required' });
        const unlocked = isCapsuleUnlocked(reveal_date);
        res.json({ unlocked });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/ds/network/matrix', (req, res) => {
    try {
        const { usersData, allUsers } = req.body;
        if (!usersData || !allUsers) return res.status(400).json({ error: 'usersData and allUsers are required' });
        
        const [nodes, emails, emailIndexMap] = networkMatrix.buildNodesAndIndexMap(usersData);
        const friendshipMatrix = networkMatrix.buildFriendshipMatrix(nodes, emailIndexMap, allUsers);
        
        res.json({ nodes, emails, emailIndexMap, friendshipMatrix });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/ds/network/suggestions', (req, res) => {
    try {
        const { friendshipMatrix, emailIndexMap, emails, currentEmail, friendGraph } = req.body;
        const suggestions = networkMatrix.getFriendSuggestions(friendshipMatrix, emailIndexMap, emails, currentEmail, friendGraph);
        res.json({ suggestions });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Bucketed User Store endpoints
app.post('/api/ds/bucket/get_user', (req, res) => {
    try {
        const { users, email } = req.body;
        if (!users || !email) return res.status(400).json({ error: 'users and email required' });
        
        const bucket = bucketStore.get_bucket(email);
        const user = (users[bucket] && users[bucket][email]) ? users[bucket][email] : null;
        res.json({ user, bucket });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/ds/bucket/add_user', (req, res) => {
    try {
        const { users, email, details } = req.body;
        if (!users || !email || !details) return res.status(400).json({ error: 'users, email, and details required' });
        
        const bucket = bucketStore.get_bucket(email);
        if (!users[bucket]) users[bucket] = {};
        users[bucket][email] = details;
        res.json({ users });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/ds/bucket/username_exists', (req, res) => {
    try {
        const { users, username } = req.body;
        if (!users || !username) return res.status(400).json({ error: 'users and username required' });
        
        let exists = false;
        for (const bucket in users) {
            for (const email in users[bucket]) {
                const user = users[bucket][email];
                if (user.username && user.username.toLowerCase() === username.toLowerCase()) {
                    exists = true;
                    break;
                }
            }
            if (exists) break;
        }
        res.json({ exists });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.listen(PORT, () => {
    console.log(`DS Service running on port ${PORT}`);
});
