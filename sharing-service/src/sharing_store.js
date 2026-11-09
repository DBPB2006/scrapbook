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

// Resolve shared MongoDB connection module safely across container, root, and service execution contexts
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

function normalizeEmail(email) {
    if (!email || typeof email !== 'string') return '';
    return email.trim().toLowerCase();
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
 * Retrieves all shared memories where user is sender or recipient.
 */
async function get_user_shared_memories(email) {
    const target = normalizeEmail(email);
    if (!target) return [];

    const collection = getSharedMemoriesCollection();
    try {
        return await collection.find({
            $or: [
                { from: target },
                { to: target }
            ]
        }, { projection: { _id: 0 } }).toArray();
    } catch (err) {
        console.error('MemoryBook Sharing: MongoDB get_user_shared_memories error:', err.message);
        throw new Error(`Failed to query user shared memories from MongoDB: ${err.message}`);
    }
}

/**
 * Retrieves all shared memories received by a specific user.
 */
async function get_received_shared_memories(toEmail) {
    const target = normalizeEmail(toEmail);
    if (!target) return [];

    const collection = getSharedMemoriesCollection();
    try {
        return await collection.find({ to: target }, { projection: { _id: 0 } }).toArray();
    } catch (err) {
        console.error('MemoryBook Sharing: MongoDB get_received_shared_memories error:', err.message);
        throw new Error(`Failed to query received shared memories from MongoDB: ${err.message}`);
    }
}

/**
 * Retrieves an individual shared memory targeted to the recipient.
 */
async function get_shared_memory_by_id(memoryId, toEmail) {
    if (!memoryId) return null;
    const target = normalizeEmail(toEmail);

    const collection = getSharedMemoriesCollection();
    try {
        return await collection.findOne({
            to: target,
            $or: [
                { memory_id: memoryId },
                { original_memory_id: memoryId }
            ]
        }, { projection: { _id: 0 } });
    } catch (err) {
        console.error('MemoryBook Sharing: MongoDB get_shared_memory_by_id error:', err.message);
        throw new Error(`Failed to query shared memory by ID from MongoDB: ${err.message}`);
    }
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
 * Marks a received shared memory as seen.
 */
async function mark_shared_memory_seen(memoryId, toEmail) {
    if (!memoryId) return false;
    const target = normalizeEmail(toEmail);

    const collection = getSharedMemoriesCollection();
    try {
        const res = await collection.updateOne(
            {
                to: target,
                $or: [
                    { memory_id: memoryId },
                    { original_memory_id: memoryId }
                ]
            },
            { $set: { seen: true } }
        );
        return res.modifiedCount > 0;
    } catch (err) {
        console.error('MemoryBook Sharing: MongoDB mark_shared_memory_seen error:', err.message);
        throw new Error(`Failed to mark shared memory seen in MongoDB: ${err.message}`);
    }
}

/**
 * Deletes a shared memory by ID with sender authorization.
 */
async function delete_shared_memory(memoryId, fromEmail) {
    if (!memoryId) return false;
    const source = normalizeEmail(fromEmail);

    const collection = getSharedMemoriesCollection();
    try {
        const res = await collection.deleteOne({ memory_id: memoryId, from: source });
        return res.deletedCount > 0;
    } catch (err) {
        console.error('MemoryBook Sharing: MongoDB delete_shared_memory error:', err.message);
        throw new Error(`Failed to delete shared memory from MongoDB: ${err.message}`);
    }
}

// =============================================================================
// Time Capsules Operations
// =============================================================================

/**
 * Loads all time capsules across the platform.
 */
async function load_all_capsules() {
    const collection = getTimeCapsulesCollection();
    try {
        return await collection.find({}, { projection: { _id: 0 } }).toArray();
    } catch (err) {
        console.error('MemoryBook Sharing: MongoDB load_all_capsules error:', err.message);
        throw new Error(`Failed to load time capsules from MongoDB: ${err.message}`);
    }
}

/**
 * Retrieves all capsules where user is sender or recipient.
 */
async function get_user_capsules(email) {
    const target = normalizeEmail(email);
    if (!target) return [];

    const collection = getTimeCapsulesCollection();
    try {
        return await collection.find({
            $or: [
                { user_email: target },
                { recipient_email: target }
            ]
        }, { projection: { _id: 0 } }).toArray();
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
 * Critical for BinaryMinHeap priority queue reconstruction on boot.
 */
async function get_locked_capsules() {
    const collection = getTimeCapsulesCollection();
    try {
        return await collection.find({ unlocked: { $ne: 1 } }, { projection: { _id: 0 } }).toArray();
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
 * Deletes a time capsule by ID with owner authorization.
 */
async function delete_capsule(id, userEmail) {
    if (!id) return false;
    const source = normalizeEmail(userEmail);

    const collection = getTimeCapsulesCollection();
    try {
        const res = await collection.deleteOne({ id, user_email: source });
        return res.deletedCount > 0;
    } catch (err) {
        console.error('MemoryBook Sharing: MongoDB delete_capsule error:', err.message);
        throw new Error(`Failed to delete time capsule from MongoDB: ${err.message}`);
    }
}

module.exports = {
    isDbConnected,
    getSharedMemoriesCollection,
    getTimeCapsulesCollection,
    normalizeEmail,
    // Shared Memories
    load_all_shared_memories,
    get_user_shared_memories,
    get_received_shared_memories,
    get_shared_memory_by_id,
    add_shared_memory,
    mark_shared_memory_seen,
    delete_shared_memory,
    // Time Capsules
    load_all_capsules,
    get_user_capsules,
    get_capsule_by_id,
    get_locked_capsules,
    add_capsule,
    unlock_capsule,
    delete_capsule
};

