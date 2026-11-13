const fs = require('fs');
const path = require('path');

const hasParentShared = fs.existsSync(path.join(__dirname, '..', 'shared'));
const mongodb = hasParentShared ? require('../shared/mongodb') : require('../../shared/mongodb');
const {
    normalizeEmail,
    escapeRegex,
    removeEmailFromFriendsArray,
    replaceEmailInFriendsArray
} = hasParentShared ? require('../shared/service_common') : require('../../shared/service_common');

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

/**
 * Custom A-Z Alphabetical Bucketing Algorithm
 * Computes bucket identifier from the initial character of the normalized email.
 */
function get_bucket(email) {
    const normalized = normalizeEmail(email);
    if (!normalized) return 'A';
    const first = normalized.charAt(0).toUpperCase();
    return /^[A-Z]$/.test(first) ? first : 'A';
}

async function load_users(options = {}) {
    const collection = getUsersCollection();
    try {
        const findOpts = options && options.projection ? { projection: options.projection } : {};
        const userDocs = await collection.find({}, findOpts).toArray();
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
        console.error('Scrapbook Auth: MongoDB load_users error:', err.message);
        throw new Error(`Failed to load users from MongoDB: ${err.message}`);
    }
}

async function list_users_public() {
    const collection = getUsersCollection();
    try {
        return await collection.find({}, {
            projection: {
                _id: 0,
                email: 1,
                name: 1,
                firstName: 1,
                lastName: 1,
                first_name: 1,
                last_name: 1,
                username: 1,
                profile_pic: 1
            }
        }).toArray();
    } catch (err) {
        console.error('Scrapbook Auth: MongoDB list_users_public error:', err.message);
        throw new Error(`Failed to list users from MongoDB: ${err.message}`);
    }
}

/**
 * Targeted batch lookup by email utilizing the { bucket_id: 1, email: 1 } compound index.
 */
async function find_users_by_emails(emails = [], options = {}) {
    if (!Array.isArray(emails) || emails.length === 0) return {};
    const uniqueNormalized = [...new Set(emails.map(normalizeEmail).filter(Boolean))];
    if (uniqueNormalized.length === 0) return {};

    const collection = getUsersCollection();
    const findOpts = options.projection ? { projection: options.projection } : {};

    try {
        const primaryFilter = {
            $or: uniqueNormalized.map(email => ({
                bucket_id: get_bucket(email),
                email
            }))
        };
        const docs = await collection.find(primaryFilter, findOpts).toArray();
        const map = {};
        for (const doc of docs) {
            const em = normalizeEmail(doc && doc.email);
            if (em) map[em] = doc;
        }

        const missing = uniqueNormalized.filter(em => !map[em]);
        if (missing.length > 0) {
            const fallbackFilter = {
                $or: missing.map(em => ({
                    email: { $regex: new RegExp(`^${escapeRegex(em)}$`, 'i') }
                }))
            };
            const fallbackDocs = await collection.find(fallbackFilter, findOpts).toArray();
            for (const doc of fallbackDocs) {
                const em = normalizeEmail(doc && doc.email);
                if (em && !map[em]) map[em] = doc;
            }
        }

        return map;
    } catch (err) {
        console.error('Scrapbook Auth: MongoDB find_users_by_emails error:', err.message);
        throw new Error(`Failed to query users by email from MongoDB: ${err.message}`);
    }
}

async function get_user(email) {
    const normalized = normalizeEmail(email);
    if (!normalized) return null;
    const bucket = get_bucket(normalized);

    const collection = getUsersCollection();
    try {
        let user = await collection.findOne({ bucket_id: bucket, email: normalized });
        if (!user) {
            user = await collection.findOne({
                email: { $regex: new RegExp(`^${escapeRegex(normalized)}$`, 'i') }
            });
        }
        return user || null;
    } catch (err) {
        console.error('Scrapbook Auth: MongoDB get_user error:', err.message);
        throw new Error(`Failed to query user from MongoDB: ${err.message}`);
    }
}

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
        console.error('Scrapbook Auth: MongoDB add_user error:', err.message);
        throw new Error(`Failed to persist user to MongoDB: ${err.message}`);
    }
}

async function username_exists(username) {
    if (!username || typeof username !== 'string') return false;
    const clean = username.trim();
    if (!clean) return false;

    const collection = getUsersCollection();
    try {
        const user = await collection.findOne({
            username: { $regex: new RegExp(`^${escapeRegex(clean)}$`, 'i') }
        });
        return !!user;
    } catch (err) {
        console.error('Scrapbook Auth: MongoDB username_exists error:', err.message);
        throw new Error(`Failed to query username in MongoDB: ${err.message}`);
    }
}

async function remove_user(email) {
    const normalized = normalizeEmail(email);
    if (!normalized) return false;
    const bucket = get_bucket(normalized);

    const collection = getUsersCollection();
    try {
        const res = await collection.deleteOne({ bucket_id: bucket, email: normalized });
        if (res.deletedCount > 0) return true;
        const fallbackRes = await collection.deleteOne({ email: normalized });
        if (fallbackRes.deletedCount > 0) return true;
        const regexRes = await collection.deleteOne({
            email: { $regex: new RegExp(`^${escapeRegex(normalized)}$`, 'i') }
        });
        return regexRes.deletedCount > 0;
    } catch (err) {
        console.error('Scrapbook Auth: MongoDB remove_user error:', err.message);
        throw new Error(`Failed to remove user from MongoDB: ${err.message}`);
    }
}

async function remove_friend_references(targetEmail) {
    const targetNorm = normalizeEmail(targetEmail);
    if (!targetNorm) return { modifiedCount: 0 };

    const collection = getUsersCollection();
    const regex = new RegExp(`^${escapeRegex(targetNorm)}$`, 'i');
    const matchedUsers = await collection.find({
        $or: [
            { friends: targetNorm },
            { friends: regex },
            { 'friends.email': targetNorm },
            { 'friends.email': regex },
            { 'friends.friend_id': targetNorm },
            { 'friends.friend_id': regex },
            { 'friends.id': targetNorm },
            { 'friends.id': regex }
        ]
    }, { projection: { _id: 0, email: 1, friends: 1 } }).toArray();

    let modifiedCount = 0;
    for (const doc of matchedUsers) {
        if (normalizeEmail(doc.email) === targetNorm) continue;
        if (!Array.isArray(doc.friends) || doc.friends.length === 0) continue;

        const { changed, updated: nextFriends } = removeEmailFromFriendsArray(doc.friends, targetNorm);
        if (changed) {
            await collection.updateOne(
                { email: doc.email },
                { $set: { friends: nextFriends } }
            );
            modifiedCount += 1;
        }
    }

    return { modifiedCount };
}

async function replace_friend_email_references(oldEmail, newEmail) {
    const oldNorm = normalizeEmail(oldEmail);
    const newNorm = normalizeEmail(newEmail);
    if (!oldNorm || !newNorm || oldNorm === newNorm) {
        return { modifiedCount: 0 };
    }

    const collection = getUsersCollection();
    const regex = new RegExp(`^${escapeRegex(oldNorm)}$`, 'i');
    const matchedUsers = await collection.find({
        $or: [
            { friends: oldNorm },
            { friends: regex },
            { 'friends.email': oldNorm },
            { 'friends.email': regex },
            { 'friends.friend_id': oldNorm },
            { 'friends.friend_id': regex },
            { 'friends.id': oldNorm },
            { 'friends.id': regex }
        ]
    }, { projection: { _id: 0, email: 1, friends: 1 } }).toArray();

    let modifiedCount = 0;
    for (const doc of matchedUsers) {
        if (!Array.isArray(doc.friends) || doc.friends.length === 0) continue;

        const { changed, updated: updatedFriends } = replaceEmailInFriendsArray(doc.friends, oldNorm, newNorm);
        if (changed) {
            await collection.updateOne(
                { email: doc.email },
                { $set: { friends: updatedFriends } }
            );
            modifiedCount += 1;
        }
    }

    return { modifiedCount };
}

async function update_user_email(oldEmail, newEmail, updatedDetails) {
    const oldNorm = normalizeEmail(oldEmail);
    const newNorm = normalizeEmail(newEmail);
    if (!oldNorm || !newNorm) {
        throw new Error('Both oldEmail and newEmail are required');
    }

    const collection = getUsersCollection();
    const existing = await get_user(oldNorm);
    if (!existing) {
        throw new Error('Original user record not found');
    }

    const nextBucket = get_bucket(newNorm);
    const cleanUpdate = {
        ...updatedDetails,
        email: newNorm,
        bucket_id: nextBucket
    };
    delete cleanUpdate._id;

    await collection.updateOne(
        { email: existing.email },
        { $set: cleanUpdate }
    );

    await replace_friend_email_references(oldNorm, newNorm);
    return true;
}

module.exports = {
    initializeBuckets,
    get_bucket,
    load_users,
    list_users_public,
    find_users_by_emails,
    get_user,
    add_user,
    username_exists,
    remove_user,
    remove_friend_references,
    replace_friend_email_references,
    update_user_email,
    isDbConnected
};
