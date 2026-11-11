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

/**
 * Lists users with public directory projection only (excludes password hashes and private friend lists).
 */
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
 * Avoids full collection scans when callers only need specific user records.
 */
async function find_users_by_emails(emails = [], options = {}) {
    if (!Array.isArray(emails) || emails.length === 0) return {};
    const uniqueNormalized = [...new Set(emails.map(normalizeEmail).filter(Boolean))];
    if (uniqueNormalized.length === 0) return {};

    const collection = getUsersCollection();
    const findOpts = {};
    if (options.projection) findOpts.projection = options.projection;
    if (options.session) findOpts.session = options.session;

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

        // Targeted case-insensitive fallback ONLY for any requested emails missing from canonical match
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

/**
 * Retrieves a user record by email using the mandatory A-Z bucket_id compound index.
 */
async function get_user(email, session = null) {
    const normalized = normalizeEmail(email);
    if (!normalized) return null;
    const bucket = get_bucket(normalized);
    const opts = session ? { session } : {};

    const collection = getUsersCollection();
    try {
        // Primary query: compound index lookup on { bucket_id: 1, email: 1 }
        let user = await collection.findOne({ bucket_id: bucket, email: normalized }, opts);
        if (!user) {
            // Case-insensitive email match in case legacy record casing differs
            const escaped = escapeRegex(normalized);
            user = await collection.findOne({
                email: { $regex: new RegExp(`^${escaped}$`, 'i') }
            }, opts);
        }
        return user || null;
    } catch (err) {
        console.error('Scrapbook Auth: MongoDB get_user error:', err.message);
        throw new Error(`Failed to query user from MongoDB: ${err.message}`);
    }
}

/**
 * Upserts a user record into MongoDB with the mandatory bucket_id field.
 */
async function add_user(email, details, session = null) {
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
        const opts = session ? { upsert: true, session } : { upsert: true };
        await collection.updateOne(
            { email: normalized },
            { $set: userDoc },
            opts
        );
        return true;
    } catch (err) {
        console.error('Scrapbook Auth: MongoDB add_user error:', err.message);
        throw new Error(`Failed to persist user to MongoDB: ${err.message}`);
    }
}

/**
 * Checks if a username already exists across all users.
 */
async function username_exists(username, session = null) {
    if (!username || typeof username !== 'string') return false;
    const clean = username.trim();
    if (!clean) return false;

    const collection = getUsersCollection();
    try {
        const escaped = escapeRegex(clean);
        const opts = session ? { session } : {};
        const user = await collection.findOne({
            username: { $regex: new RegExp(`^${escaped}$`, 'i') }
        }, opts);
        return !!user;
    } catch (err) {
        console.error('Scrapbook Auth: MongoDB username_exists error:', err.message);
        throw new Error(`Failed to query username in MongoDB: ${err.message}`);
    }
}

/**
 * Removes a user record by email.
 */
async function remove_user(email, session = null) {
    const normalized = normalizeEmail(email);
    if (!normalized) return false;
    const bucket = get_bucket(normalized);
    const opts = session ? { session } : {};

    const collection = getUsersCollection();
    try {
        const res = await collection.deleteOne({ bucket_id: bucket, email: normalized }, opts);
        if (res.deletedCount > 0) return true;
        const fallbackRes = await collection.deleteOne({ email: normalized }, opts);
        if (fallbackRes.deletedCount > 0) return true;
        const regexRes = await collection.deleteOne({
            email: { $regex: new RegExp(`^${escapeRegex(normalized)}$`, 'i') }
        }, opts);
        return regexRes.deletedCount > 0;
    } catch (err) {
        console.error('Scrapbook Auth: MongoDB remove_user error:', err.message);
        throw new Error(`Failed to remove user from MongoDB: ${err.message}`);
    }
}

/**
 * Removes references to a deleted user from all remaining users' friends arrays.
 * Returns snapshots for compensating rollback on partial failure.
 */
async function remove_friend_references(targetEmail, session = null) {
    const targetNorm = normalizeEmail(targetEmail);
    if (!targetNorm) {
        return { modifiedCount: 0, modifiedUsers: [], removedFriendS3Keys: [] };
    }

    const collection = getUsersCollection();
    const regex = new RegExp(`^${escapeRegex(targetNorm)}$`, 'i');
    const opts = {
        projection: { _id: 0, email: 1, friends: 1 },
        ...(session ? { session } : {})
    };
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
    }, opts).toArray();
    const modifiedUsers = [];

    for (const doc of matchedUsers) {
        const docEmail = normalizeEmail(doc.email);
        if (docEmail === targetNorm) continue;
        if (!Array.isArray(doc.friends) || doc.friends.length === 0) continue;

        const { changed, updated: nextFriends } = removeEmailFromFriendsArray(doc.friends, targetNorm);
        if (changed) {
            modifiedUsers.push({
                email: doc.email,
                previousFriends: JSON.parse(JSON.stringify(doc.friends))
            });
            await collection.updateOne(
                { email: doc.email },
                { $set: { friends: nextFriends } },
                opts
            );
        }
    }

    return {
        modifiedCount: modifiedUsers.length,
        modifiedUsers
    };
}

/**
 * Replaces a user's email inside all users' friends arrays and deduplicates entries.
 */
async function replace_friend_email_references(oldEmail, newEmail, session = null) {
    const oldNorm = normalizeEmail(oldEmail);
    const newNorm = normalizeEmail(newEmail);
    if (!oldNorm || !newNorm || oldNorm === newNorm) {
        return { modifiedCount: 0, modifiedUsers: [] };
    }

    const collection = getUsersCollection();
    const regex = new RegExp(`^${escapeRegex(oldNorm)}$`, 'i');
    const opts = {
        projection: { _id: 0, email: 1, friends: 1 },
        ...(session ? { session } : {})
    };
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
    }, opts).toArray();
    const modifiedUsers = [];

    for (const doc of matchedUsers) {
        if (!Array.isArray(doc.friends) || doc.friends.length === 0) continue;

        const { changed, updated: updatedFriends } = replaceEmailInFriendsArray(doc.friends, oldNorm, newNorm);
        if (changed) {
            modifiedUsers.push({
                email: doc.email,
                previousFriends: JSON.parse(JSON.stringify(doc.friends))
            });
            await collection.updateOne(
                { email: doc.email },
                { $set: { friends: updatedFriends } },
                opts
            );
        }
    }

    return {
        modifiedCount: modifiedUsers.length,
        modifiedUsers
    };
}

/**
 * Compensating rollback helper: restores modified users' friends arrays.
 */
async function restore_friend_references(modifiedUsers) {
    if (!Array.isArray(modifiedUsers) || modifiedUsers.length === 0) return true;
    const collection = getUsersCollection();
    for (const entry of modifiedUsers) {
        if (!entry || !entry.email) continue;
        await collection.updateOne(
            { email: entry.email },
            { $set: { friends: entry.previousFriends || [] } }
        );
    }
    return true;
}

/**
 * Updates a user's email and A-Z bucket_id in place cleanly without triggering unique username conflicts,
 * and propagates the email update across all friend references in the users collection.
 */
async function update_user_email(oldEmail, newEmail, updatedDetails, session = null) {
    const oldNorm = normalizeEmail(oldEmail);
    const newNorm = normalizeEmail(newEmail);
    if (!oldNorm || !newNorm) {
        throw new Error('Both oldEmail and newEmail are required');
    }

    const collection = getUsersCollection();
    const opts = session ? { session } : {};
    const existing = await get_user(oldNorm, session);
    if (!existing) {
        throw new Error('Original user record not found');
    }

    const previousUserSnapshot = { ...existing };
    delete previousUserSnapshot._id;

    const nextBucket = get_bucket(newNorm);
    const cleanUpdate = {
        ...updatedDetails,
        email: newNorm,
        bucket_id: nextBucket
    };
    delete cleanUpdate._id;

    await collection.updateOne(
        { email: existing.email },
        { $set: cleanUpdate },
        opts
    );

    const refResult = await replace_friend_email_references(oldNorm, newNorm, session);
    return {
        previousUserSnapshot,
        modifiedUsers: refResult.modifiedUsers
    };
}

/**
 * Compensating rollback helper for failed email changes.
 */
async function restore_user_email_update(oldEmail, newEmail, snapshot) {
    const collection = getUsersCollection();
    if (snapshot && snapshot.previousUserSnapshot) {
        const oldNorm = normalizeEmail(oldEmail);
        const newNorm = normalizeEmail(newEmail);
        const restored = {
            ...snapshot.previousUserSnapshot,
            email: oldNorm,
            bucket_id: get_bucket(oldNorm)
        };
        delete restored._id;
        const res = await collection.updateOne(
            { email: newNorm },
            { $set: restored }
        );
        if (res.matchedCount === 0) {
            await collection.updateOne(
                { email: oldNorm },
                { $set: restored },
                { upsert: true }
            );
        }
    }
    if (snapshot && Array.isArray(snapshot.modifiedUsers)) {
        await restore_friend_references(snapshot.modifiedUsers);
    }
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
    restore_friend_references,
    update_user_email,
    restore_user_email_update,
    isDbConnected
};
