const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

// Shared utility functions

function getStoragePath(domain) {
    const base = process.env.STORAGE_PATH || path.join(__dirname, 'data');
    return path.join(base, domain);
}
function verifyPassword(inputPassword, hashedPassword) {
    return bcrypt.compareSync(inputPassword, hashedPassword);
}

function getBucket(email) {
    if (!email) return 'A';
    const first = email.charAt(0).toUpperCase();
    return /^[A-Z]$/.test(first) ? first : 'A';
}

function loadUsers(file = path.join(getStoragePath('Users'), 'users.json')) {
    if (!fs.existsSync(file)) return {};
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8')) || {};
    } catch (e) {
        return {};
    }
}

function saveUsers(users, file = path.join(getStoragePath('Users'), 'users.json')) {
    const dir = path.dirname(file);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(users, null, 4));
}

function getCurrentUser(users, email) {
    const bucket = getBucket(email);
    return (users[bucket] && users[bucket][email]) ? users[bucket][email] : null;
}

function saveCurrentUser(users, user) {
    const bucket = getBucket(user.email);
    if (!users[bucket]) users[bucket] = {};
    users[bucket][user.email] = user;
}

function loadMemories(file = path.join(getStoragePath('Memories'), 'memories.json')) {
    if (!fs.existsSync(file)) return [];
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8')) || [];
    } catch (e) {
        return [];
    }
}

function saveMemories(memories, file = path.join(getStoragePath('Memories'), 'memories.json')) {
    const dir = path.dirname(file);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(memories, null, 4));
}

function loadSharedMemories(file = path.join(getStoragePath('Friends'), 'shared_memories.json')) {
    if (!fs.existsSync(file)) return [];
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8')) || [];
    } catch (e) {
        return [];
    }
}

function saveSharedMemories(shared, file = path.join(getStoragePath('Friends'), 'shared_memories.json')) {
    const dir = path.dirname(file);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(shared, null, 4));
}

function loadTimeCapsules(file = path.join(getStoragePath('Capsules'), 'time_capsules.json')) {
    if (!fs.existsSync(file)) return [];
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8')) || [];
    } catch (e) {
        return [];
    }
}

function saveTimeCapsules(capsules, file = path.join(getStoragePath('Capsules'), 'time_capsules.json')) {
    const dir = path.dirname(file);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(capsules, null, 4));
}

function getFirstName(nameOrEmail) {
    if (!nameOrEmail) return '';
    const parts = nameOrEmail.split(' ');
    return parts[0];
}

function getInitial(nameOrEmail) {
    if (!nameOrEmail) return '';
    return nameOrEmail.charAt(0).toUpperCase();
}

function findUserByEmail(users, email) {
    for (const bucket in users) {
        if (users[bucket] && users[bucket][email]) {
            return users[bucket][email];
        }
    }
    return null;
}

function validateEmail(email) {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
}

module.exports = {
    verifyPassword,
    getBucket,
    loadUsers,
    saveUsers,
    getCurrentUser,
    saveCurrentUser,
    loadMemories,
    saveMemories,
    loadSharedMemories,
    saveSharedMemories,
    loadTimeCapsules,
    saveTimeCapsules,
    getFirstName,
    getInitial,
    findUserByEmail,
    validateEmail
};
