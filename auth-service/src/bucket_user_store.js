// Resolve shared MongoDB module safely across container, root, and service execution contexts
let mongodb = null;
try {
    mongodb = require('../../shared/mongodb');
} catch (e1) {
    try {
        mongodb = require('../shared/mongodb');
    } catch (e2) {
        try {
            mongodb = require('./shared/mongodb');
        } catch (e3) {
            mongodb = null;
        }
    }
}

function isDbConnected() {
    return !!(mongodb && typeof mongodb.isConnected === 'function' && mongodb.isConnected());
}

function getUsersCollection() {
    if (!isDbConnected()) {
        throw new Error('MongoDB unavailable: Cannot access users collection without an active database connection');
    }
    return mongodb.getCollection(mongodb.COLLECTIONS.USERS);
}

function initializeBuckets() {
    const buckets = {};
    for (let i = 65; i <= 90; i++) {
        buckets[String.fromCharCode(i)] = {};
    }
    return buckets;
}

function normalizeEmail(email) {
    if (!email || typeof email !== 'string') return '';
    return email.trim().toLowerCase();
}

/**
 * Custom A-Z Alphabetical Bucketing Algorithm (Synopsis §6.1 DSA)
 * Computes bucket identifier from the initial character of the normalized email.
 */
function get_bucket(email) {
    const normalized = normalizeEmail(email);
    if (!normalized) return 'A';
    const first = normalized.charAt(0).toUpperCase();
    return /^[A-Z]$/.test(first) ? first : 'A';
}

/**
 * Loads all users structured into the 26 A-Z alphabetical buckets directly from MongoDB.
 * Preserves the exact bucket format { A: {}, B: {}, ... Z: {} } for internal APIs and callers.
 */
async function load_users() {
    const collection = getUsersCollection();
    try {
        const userDocs = await collection.find({}).toArray();
        const buckets = initializeBuckets();
        for (const u of userDocs) {
            const email = normalizeEmail(u.email);
            if (!email) continue;
            const bucket = u.bucket_id || get_bucket(email);
            if (!buckets[bucket]) buckets[bucket] = {};
            buckets[bucket][email] = u;
        }
        return buckets;
    } catch (err) {
        console.error('MemoryBook Auth: MongoDB load_users error:', err.message);
        throw new Error(`Failed to load users from MongoDB: ${err.message}`);
    }
}

/**
 * Persists bucketed users to MongoDB via bulk upsert operations.
 */
async function save_users(users) {
    const collection = getUsersCollection();
    try {
        const ops = [];
        for (const bucket in users) {
            for (const email in users[bucket]) {
                const u = users[bucket][email];
                const normalized = normalizeEmail(email || u.email);
                if (!normalized) continue;
                const b = u.bucket_id || get_bucket(normalized);
                u.email = normalized;
                u.bucket_id = b;
                delete u._id;
                ops.push({
                    updateOne: {
                        filter: { email: normalized },
                        update: { $set: u },
                        upsert: true
                    }
                });
            }
        }
        if (ops.length > 0) {
            await collection.bulkWrite(ops);
        }
        return true;
    } catch (err) {
        console.error('MemoryBook Auth: MongoDB save_users error:', err.message);
        throw new Error(`Failed to save users to MongoDB: ${err.message}`);
    }
}

/**
 * Retrieves a user record by email using the mandatory A-Z bucket_id compound index.
 */
async function get_user(email) {
    const normalized = normalizeEmail(email);
    if (!normalized) return null;
    const bucket = get_bucket(normalized);

    const collection = getUsersCollection();
    try {
        // Primary query: compound index lookup on { bucket_id: 1, email: 1 }
        let user = await collection.findOne({ bucket_id: bucket, email: normalized });
        if (!user) {
            // Case-insensitive email match in case legacy record casing differs
            const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            user = await collection.findOne({
                email: { $regex: new RegExp(`^${escaped}$`, 'i') }
            });
        }
        return user || null;
    } catch (err) {
        console.error('MemoryBook Auth: MongoDB get_user error:', err.message);
        throw new Error(`Failed to query user from MongoDB: ${err.message}`);
    }
}

/**
 * Checks if a user exists by email.
 */
async function user_exists(email) {
    const user = await get_user(email);
    return !!user;
}

/**
 * Upserts a user record into MongoDB with the mandatory bucket_id field.
 */
async function add_user(email, details) {
    const normalized = normalizeEmail(email);
    if (!normalized) return false;
    const bucket = get_bucket(normalized);

    const userDoc = {
        ...details,
        email: normalized,
        bucket_id: bucket
    };
    delete userDoc._id;

    const collection = getUsersCollection();
    try {
        await collection.updateOne(
            { email: normalized },
            { $set: userDoc },
            { upsert: true }
        );
        return true;
    } catch (err) {
        console.error('MemoryBook Auth: MongoDB add_user error:', err.message);
        throw new Error(`Failed to persist user to MongoDB: ${err.message}`);
    }
}

/**
 * Checks if a username already exists across all users.
 */
async function username_exists(username) {
    if (!username || typeof username !== 'string') return false;
    const clean = username.trim();
    if (!clean) return false;

    const collection = getUsersCollection();
    try {
        const escaped = clean.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const user = await collection.findOne({
            username: { $regex: new RegExp(`^${escaped}$`, 'i') }
        });
        return !!user;
    } catch (err) {
        console.error('MemoryBook Auth: MongoDB username_exists error:', err.message);
        throw new Error(`Failed to query username in MongoDB: ${err.message}`);
    }
}

/**
 * Removes a user record by email.
 */
async function remove_user(email) {
    const normalized = normalizeEmail(email);
    if (!normalized) return false;
    const bucket = get_bucket(normalized);

    const collection = getUsersCollection();
    try {
        const res = await collection.deleteOne({ bucket_id: bucket, email: normalized });
        if (res.deletedCount > 0) return true;
        const fallbackRes = await collection.deleteOne({ email: normalized });
        return fallbackRes.deletedCount > 0;
    } catch (err) {
        console.error('MemoryBook Auth: MongoDB remove_user error:', err.message);
        throw new Error(`Failed to remove user from MongoDB: ${err.message}`);
    }
}

module.exports = {
    initializeBuckets,
    normalizeEmail,
    get_bucket,
    load_users,
    save_users,
    get_user,
    user_exists,
    add_user,
    username_exists,
    remove_user,
    isDbConnected
};
