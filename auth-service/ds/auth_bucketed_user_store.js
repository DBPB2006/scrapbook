const fs = require('fs');
const path = require('path');

const usersJsonPath = path.join(__dirname, '..', 'data', 'users.json');

function load_users() {
    if (!fs.existsSync(usersJsonPath)) {
        // Initialize 26 buckets (A-Z)
        const buckets = {};
        for (let i = 65; i <= 90; i++) {
            buckets[String.fromCharCode(i)] = {};
        }
        return buckets;
    }
    const json = fs.readFileSync(usersJsonPath, 'utf8');
    const data = JSON.parse(json);
    
    // Ensure all buckets exist
    for (let i = 65; i <= 90; i++) {
        const letter = String.fromCharCode(i);
        if (!data[letter]) {
            data[letter] = {};
        }
    }
    return data;
}

function save_users(users) {
    const dir = path.dirname(usersJsonPath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    try {
        fs.writeFileSync(usersJsonPath, JSON.stringify(users, null, 4));
    } catch (err) {
        console.error('MemoryBook: Failed to write users file at ' + usersJsonPath, err);
    }
}

function get_bucket(email) {
    const first = email.charAt(0).toUpperCase();
    return /^[A-Z]$/.test(first) ? first : 'A';
}

function user_exists(email) {
    const users = load_users();
    const bucket = get_bucket(email);
    return !!users[bucket][email];
}

function add_user(email, details) {
    const users = load_users();
    const bucket = get_bucket(email);
    users[bucket][email] = details;
    save_users(users);
}

function get_user(email) {
    const users = load_users();
    const bucket = get_bucket(email);
    return users[bucket][email] || null;
}

function username_exists(username) {
    const users = load_users();
    for (const bucket in users) {
        for (const email in users[bucket]) {
            const user = users[bucket][email];
            if (user.username && user.username.toLowerCase() === username.toLowerCase()) {
                return true;
            }
        }
    }
    return false;
}

module.exports = {
    load_users,
    save_users,
    get_bucket,
    user_exists,
    add_user,
    get_user,
    username_exists
};
