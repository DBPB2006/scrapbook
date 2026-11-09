/**
 * MongoDB Store for Sharing Service
 * Memory Book Platform - Sharing Microservice Persistence Layer
 *
 * Provides persistent operations for:
 * 1. Shared Memories (`shared_memories` collection)
 * 2. Time Capsules (`time_capsules` collection)
 *
 * Utilizes centralized singleton connection pool from shared/mongodb.js.
 */

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

function getSharedMemoriesCollection() {
    if (!isDbConnected()) {
        throw new Error('MongoDB unavailable: Cannot access shared_memories collection without an active database connection');
    }
    return mongodb.getCollection(mongodb.COLLECTIONS.SHARED_MEMORIES);
}

function getTimeCapsulesCollection() {
    if (!isDbConnected()) {
        throw new Error('MongoDB unavailable: Cannot access time_capsules collection without an active database connection');
    }
    return mongodb.getCollection(mongodb.COLLECTIONS.TIME_CAPSULES);
}

// =============================================================================
// Shared Memories Operations
// =============================================================================

/**
 * Loads all shared memories across the platform (internal service endpoint).
 */
async function load_all_shared_memories() {
    const collection = getSharedMemoriesCollection();
    try {
        return await collection.find({}, { projection: { _id: 0 } }).toArray();
    } catch (err) {
        console.error('MemoryBook Sharing: MongoDB load_all_shared_memories error:', err.message);
        throw new Error(`Failed to load shared memories from MongoDB: ${err.message}`);
    }
}

/**
 * Retrieves all shared memories where user is sender or recipient, newest first.
 */
async function get_user_shared_memories(email, options = {}) {
    const target = normalizeEmail(email);
    if (!target) return [];

    const collection = getSharedMemoriesCollection();
    try {
        const findOpts = { projection: (options && options.projection) ? options.projection : { _id: 0 } };
        let cursor = collection.find({
            $or: [
                { from: target },
                { to: target }
            ]
        }, findOpts);
        if (typeof cursor.sort === 'function') {
            cursor = cursor.sort({ created_at: -1, date: -1 });
        }
        return await cursor.toArray();
    } catch (err) {
        console.error('MemoryBook Sharing: MongoDB get_user_shared_memories error:', err.message);
        throw new Error(`Failed to query user shared memories from MongoDB: ${err.message}`);
    }
}

/**
 * Retrieves all shared memories received by a specific user, newest first.
 */
async function get_received_shared_memories(toEmail) {
    const target = normalizeEmail(toEmail);
    if (!target) return [];

    const collection = getSharedMemoriesCollection();
    try {
        let cursor = collection.find({ to: target }, { projection: { _id: 0 } });
        if (typeof cursor.sort === 'function') {
            cursor = cursor.sort({ created_at: -1, date: -1 });
        }
        return await cursor.toArray();
    } catch (err) {
        console.error('MemoryBook Sharing: MongoDB get_received_shared_memories error:', err.message);
        throw new Error(`Failed to query received shared memories from MongoDB: ${err.message}`);
    }
}

/**
 * Retrieves an exact shared memory record by its unique share-record identifier (`memory_id`).
 */
async function get_shared_memory_by_record_id(memoryId) {
    if (!memoryId || typeof memoryId !== 'string') return null;

    const collection = getSharedMemoriesCollection();
    try {
        return await collection.findOne({ memory_id: memoryId.trim() }, { projection: { _id: 0 } });
    } catch (err) {
        console.error('MemoryBook Sharing: MongoDB get_shared_memory_by_record_id error:', err.message);
        throw new Error(`Failed to query shared memory by record ID from MongoDB: ${err.message}`);
    }
}

/**
 * Retrieves all share records associated with an original memory ID, newest first.
 */
async function get_shared_memories_by_original_id(originalMemoryId) {
    if (!originalMemoryId || typeof originalMemoryId !== 'string') return [];

    const collection = getSharedMemoriesCollection();
    try {
        return await collection
            .find({ original_memory_id: originalMemoryId.trim() }, { projection: { _id: 0 } })
            .sort({ created_at: -1, date: -1 })
            .toArray();
    } catch (err) {
        console.error('MemoryBook Sharing: MongoDB get_shared_memories_by_original_id error:', err.message);
        throw new Error(`Failed to query shared memories by original ID from MongoDB: ${err.message}`);
    }
}

/**
 * Resolves a shared memory for either its sender or intended recipient with explicit authorization.
 * Prioritizes unique share-record ID (`memory_id`) before falling back to `original_memory_id`.
 */
async function get_shared_memory_for_user(identifier, userEmail, options = {}) {
    if (!identifier || typeof identifier !== 'string') {
        return { found: false, authorized: false, record: null };
    }
    const target = normalizeEmail(userEmail);
    const cleanId = identifier.trim();

    // 1. Primary lookup: unique share-record identifier
    const exactRecord = await get_shared_memory_by_record_id(cleanId);
    if (exactRecord) {
        const isSender = target && normalizeEmail(exactRecord.from) === target;
        const isRecipient = target && normalizeEmail(exactRecord.to) === target;
        if (!isSender && !isRecipient) {
            return { found: true, authorized: false, record: null };
        }
        return { found: true, authorized: true, record: exactRecord };
    }

    // 2. Fallback lookup: legacy links passing original_memory_id (handles multi-share cleanly)
    const originalMatches = await get_shared_memories_by_original_id(cleanId);
    if (!originalMatches || originalMatches.length === 0) {
        return { found: false, authorized: false, record: null };
    }

    if (!target) {
        return { found: true, authorized: false, record: null };
    }

    let authorizedMatches = originalMatches.filter(
        r => normalizeEmail(r.from) === target || normalizeEmail(r.to) === target
    );

    if (authorizedMatches.length === 0) {
        return { found: true, authorized: false, record: null };
    }

    if (options && options.to) {
        const requestedTo = normalizeEmail(options.to);
        authorizedMatches = authorizedMatches.filter(r => normalizeEmail(r.to) === requestedTo);
        if (authorizedMatches.length === 0) {
            return { found: true, authorized: true, record: null };
        }
    }

    // Deterministic ordering: prefer record where user is recipient over sent, then newest timestamp
    authorizedMatches.sort((a, b) => {
        const aIsRecipient = normalizeEmail(a.to) === target ? 1 : 0;
        const bIsRecipient = normalizeEmail(b.to) === target ? 1 : 0;
        if (aIsRecipient !== bIsRecipient) return bIsRecipient - aIsRecipient;
        return new Date(b.created_at || b.date || 0) - new Date(a.created_at || a.date || 0);
    });

    return { found: true, authorized: true, record: authorizedMatches[0] };
}

/**
 * Persists a new shared memory record into MongoDB.
 */
async function add_shared_memory(record) {
    if (!record || !record.memory_id) {
        throw new Error('Invalid shared memory payload: memory_id is required');
    }
    record.from = normalizeEmail(record.from);
    record.to = normalizeEmail(record.to);

    const collection = getSharedMemoriesCollection();
    try {
        await collection.updateOne(
            { memory_id: record.memory_id },
            { $set: record },
            { upsert: true }
        );
        const { _id, ...cleanRecord } = record;
        return cleanRecord;
    } catch (err) {
        console.error('MemoryBook Sharing: MongoDB add_shared_memory error:', err.message);
        throw new Error(`Failed to persist shared memory to MongoDB: ${err.message}`);
    }
}

/**
 * Marks a received shared memory as seen (restricted strictly to the intended recipient).
 * Targets exact `memory_id` first to avoid colliding across multiple shares of the same original memory.
 */
async function mark_shared_memory_seen(memoryId, toEmail) {
    if (!memoryId || typeof memoryId !== 'string') return false;
    const target = normalizeEmail(toEmail);
    if (!target) return false;
    const cleanId = memoryId.trim();

    const collection = getSharedMemoriesCollection();
    try {
        const exactRes = await collection.updateOne(
            { memory_id: cleanId, to: target },
            { $set: { seen: true } }
        );
        if (exactRes.matchedCount > 0) {
            return exactRes.modifiedCount > 0;
        }

        // Legacy fallback by original_memory_id scoped strictly to the recipient
        const fallbackDoc = await collection
            .find({ original_memory_id: cleanId, to: target })
            .sort({ created_at: -1, date: -1 })
            .limit(1)
            .toArray();
        if (fallbackDoc && fallbackDoc.length > 0 && fallbackDoc[0].memory_id) {
            const res = await collection.updateOne(
                { memory_id: fallbackDoc[0].memory_id, to: target },
                { $set: { seen: true } }
            );
            return res.modifiedCount > 0;
        }
        return false;
    } catch (err) {
        console.error('MemoryBook Sharing: MongoDB mark_shared_memory_seen error:', err.message);
        throw new Error(`Failed to mark shared memory seen in MongoDB: ${err.message}`);
    }
}

// =============================================================================
// Time Capsules Operations
// =============================================================================

/**
 * Retrieves all capsules where user is sender or recipient.
 */
async function get_user_capsules(email, options = {}) {
    const target = normalizeEmail(email);
    if (!target) return [];

    const collection = getTimeCapsulesCollection();
    try {
        const projection = (options && options.projection) ? options.projection : { _id: 0 };
        let cursor = collection.find({
            $or: [
                { user_email: target },
                { recipient_email: target }
            ]
        }, { projection });
        if (typeof cursor.sort === 'function') {
            cursor = cursor.sort({ reveal_date: 1 });
        }
        return await cursor.toArray();
    } catch (err) {
        console.error('MemoryBook Sharing: MongoDB get_user_capsules error:', err.message);
        throw new Error(`Failed to query user capsules from MongoDB: ${err.message}`);
    }
}

/**
 * Retrieves an individual time capsule by unique ID.
 */
async function get_capsule_by_id(id) {
    if (!id) return null;

    const collection = getTimeCapsulesCollection();
    try {
        return await collection.findOne({ id }, { projection: { _id: 0 } });
    } catch (err) {
        console.error('MemoryBook Sharing: MongoDB get_capsule_by_id error:', err.message);
        throw new Error(`Failed to query time capsule by ID from MongoDB: ${err.message}`);
    }
}

/**
 * Retrieves all locked capsules (unlocked != 1).
 * Utilizes idx_tc_unlocked_reveal ({ unlocked: 1, reveal_date: 1 }) for BinaryMinHeap reconstruction.
 */
async function get_locked_capsules() {
    const collection = getTimeCapsulesCollection();
    try {
        let cursor = collection.find({ unlocked: { $ne: 1 } }, { projection: { _id: 0 } });
        if (typeof cursor.sort === 'function') {
            cursor = cursor.sort({ reveal_date: 1 });
        }
        return await cursor.toArray();
    } catch (err) {
        console.error('MemoryBook Sharing: MongoDB get_locked_capsules error:', err.message);
        throw new Error(`Failed to query locked capsules from MongoDB: ${err.message}`);
    }
}

/**
 * Persists a new time capsule record into MongoDB.
 */
async function add_capsule(capsule) {
    if (!capsule || !capsule.id) {
        throw new Error('Invalid capsule payload: id is required');
    }
    capsule.user_email = normalizeEmail(capsule.user_email);
    capsule.recipient_email = normalizeEmail(capsule.recipient_email);

    const collection = getTimeCapsulesCollection();
    try {
        await collection.updateOne(
            { id: capsule.id },
            { $set: capsule },
            { upsert: true }
        );
        const { _id, ...cleanCapsule } = capsule;
        return cleanCapsule;
    } catch (err) {
        console.error('MemoryBook Sharing: MongoDB add_capsule error:', err.message);
        throw new Error(`Failed to persist time capsule to MongoDB: ${err.message}`);
    }
}

/**
 * Authoritatively updates capsule status to unlocked (1) in MongoDB.
 */
async function unlock_capsule(id) {
    if (!id) return false;

    const collection = getTimeCapsulesCollection();
    try {
        const res = await collection.updateOne(
            { id },
            { $set: { unlocked: 1 } }
        );
        return res.modifiedCount > 0;
    } catch (err) {
        console.error('MemoryBook Sharing: MongoDB unlock_capsule error:', err.message);
        throw new Error(`Failed to unlock time capsule in MongoDB: ${err.message}`);
    }
}

/**
 * Cleans up shared memories and time capsules associated with a deleted account.
 */
async function cleanup_user_data(userEmail, session = null) {
    const target = normalizeEmail(userEmail);
    if (!target) {
        return {
            deletedSharesCount: 0,
            modifiedSharesCount: 0,
            deletedCapsulesCount: 0,
            deletedShares: [],
            modifiedShares: [],
            deletedCapsules: []
        };
    }

    const sharesCol = getSharedMemoriesCollection();
    const capsulesCol = getTimeCapsulesCollection();
    const opts = session ? { session } : {};
    const regex = new RegExp(`^${escapeRegex(target)}$`, 'i');

    const shareFilter = {
        $or: [
            { from: target },
            { to: target },
            { from: { $regex: regex } },
            { to: { $regex: regex } }
        ]
    };

    const matchedShares = await sharesCol.find(shareFilter, opts).toArray();
    const deletedShares = matchedShares.map(s => {
        const copy = { ...s };
        delete copy._id;
        return copy;
    });

    if (matchedShares.length > 0) {
        await sharesCol.deleteMany(shareFilter, opts);
    }

    const remainingShares = await sharesCol.find({
        $or: [
            { friends: target },
            { friends: regex },
            { 'friends.email': target },
            { 'friends.email': regex },
            { 'friends.friend_id': target },
            { 'friends.friend_id': regex },
            { 'friends.id': target },
            { 'friends.id': regex }
        ]
    }, { projection: { _id: 0, memory_id: 1, friends: 1 }, ...opts }).toArray();
    const modifiedShares = [];
    for (const s of remainingShares) {
        if (!Array.isArray(s.friends) || s.friends.length === 0) continue;
        const { changed, updated } = removeEmailFromFriendsArray(s.friends, target);
        if (changed) {
            modifiedShares.push({
                memory_id: s.memory_id,
                previousFriends: JSON.parse(JSON.stringify(s.friends))
            });
            await sharesCol.updateOne(
                { memory_id: s.memory_id },
                { $set: { friends: updated } },
                opts
            );
        }
    }

    const capsuleFilter = {
        $or: [
            { user_email: target },
            { recipient_email: target },
            { user_email: { $regex: regex } },
            { recipient_email: { $regex: regex } }
        ]
    };
    const matchedCapsules = await capsulesCol.find(capsuleFilter, opts).toArray();
    const deletedCapsules = matchedCapsules.map(c => {
        const copy = { ...c };
        delete copy._id;
        return copy;
    });

    if (matchedCapsules.length > 0) {
        await capsulesCol.deleteMany(capsuleFilter, opts);
    }

    return {
        deletedSharesCount: deletedShares.length,
        modifiedSharesCount: modifiedShares.length,
        deletedCapsulesCount: deletedCapsules.length,
        deletedShares,
        modifiedShares,
        deletedCapsules
    };
}

/**
 * Compensating rollback helper for sharing & capsule cleanup.
 */
async function restore_user_cleanup(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') return false;
    const sharesCol = getSharedMemoriesCollection();
    const capsulesCol = getTimeCapsulesCollection();

    if (Array.isArray(snapshot.deletedShares)) {
        for (const s of snapshot.deletedShares) {
            if (!s || !s.memory_id) continue;
            const copy = { ...s };
            delete copy._id;
            await sharesCol.updateOne(
                { memory_id: copy.memory_id },
                { $set: copy },
                { upsert: true }
            );
        }
    }

    if (Array.isArray(snapshot.modifiedShares)) {
        for (const item of snapshot.modifiedShares) {
            if (!item || !item.memory_id) continue;
            await sharesCol.updateOne(
                { memory_id: item.memory_id },
                { $set: { friends: item.previousFriends || [] } }
            );
        }
    }

    if (Array.isArray(snapshot.deletedCapsules)) {
        for (const c of snapshot.deletedCapsules) {
            if (!c || !c.id) continue;
            const copy = { ...c };
            delete copy._id;
            await capsulesCol.updateOne(
                { id: copy.id },
                { $set: copy },
                { upsert: true }
            );
        }
    }

    return true;
}

/**
 * Propagates a user's email change across shared memories and time capsules.
 */
async function update_user_email(oldEmail, newEmail, session = null) {
    const oldNorm = normalizeEmail(oldEmail);
    const newNorm = normalizeEmail(newEmail);
    if (!oldNorm || !newNorm || oldNorm === newNorm) {
        return { updatedSharesCount: 0, updatedCapsulesCount: 0 };
    }

    const sharesCol = getSharedMemoriesCollection();
    const capsulesCol = getTimeCapsulesCollection();
    const opts = session ? { session } : {};

    const regex = new RegExp(`^${escapeRegex(oldNorm)}$`, 'i');
    const matchedShares = await sharesCol.find({
        $or: [
            { from: oldNorm },
            { to: oldNorm },
            { original_owner: oldNorm },
            { from: { $regex: regex } },
            { to: { $regex: regex } },
            { original_owner: { $regex: regex } },
            { friends: oldNorm },
            { friends: regex },
            { 'friends.email': oldNorm },
            { 'friends.email': regex },
            { 'friends.friend_id': oldNorm },
            { 'friends.friend_id': regex },
            { 'friends.id': oldNorm },
            { 'friends.id': regex }
        ]
    }, { projection: { _id: 0, memory_id: 1, from: 1, to: 1, original_owner: 1, friends: 1 }, ...opts }).toArray();
    let updatedSharesCount = 0;
    for (const share of matchedShares) {
        const patch = {};
        let touched = false;
        if (normalizeEmail(share.from) === oldNorm) {
            patch.from = newNorm;
            touched = true;
        }
        if (normalizeEmail(share.to) === oldNorm) {
            patch.to = newNorm;
            touched = true;
        }
        if (normalizeEmail(share.original_owner) === oldNorm) {
            patch.original_owner = newNorm;
            touched = true;
        }
        if (Array.isArray(share.friends) && share.friends.length > 0) {
            const { changed, updated } = replaceEmailInFriendsArray(share.friends, oldNorm, newNorm);
            if (changed) {
                patch.friends = updated;
                touched = true;
            }
        }
        if (touched) {
            await sharesCol.updateOne(
                { memory_id: share.memory_id },
                { $set: patch },
                opts
            );
            updatedSharesCount++;
        }
    }

    const capsulesMatches = await capsulesCol.find({
        $or: [
            { user_email: oldNorm },
            { recipient_email: oldNorm },
            { user_email: { $regex: regex } },
            { recipient_email: { $regex: regex } }
        ]
    }, opts).toArray();

    let updatedCapsulesCount = 0;
    for (const cap of capsulesMatches) {
        const patch = {};
        if (normalizeEmail(cap.user_email) === oldNorm) patch.user_email = newNorm;
        if (normalizeEmail(cap.recipient_email) === oldNorm) patch.recipient_email = newNorm;
        if (Object.keys(patch).length > 0) {
            await capsulesCol.updateOne({ id: cap.id }, { $set: patch }, opts);
            updatedCapsulesCount++;
        }
    }

    return { updatedSharesCount, updatedCapsulesCount };
}

module.exports = {
    isDbConnected,
    // Shared Memories
    load_all_shared_memories,
    get_user_shared_memories,
    get_received_shared_memories,
    get_shared_memory_for_user,
    add_shared_memory,
    mark_shared_memory_seen,
    // Time Capsules
    get_user_capsules,
    get_capsule_by_id,
    get_locked_capsules,
    add_capsule,
    unlock_capsule,
    // Account Lifecycle Helpers
    cleanup_user_data,
    restore_user_cleanup,
    update_user_email
};

