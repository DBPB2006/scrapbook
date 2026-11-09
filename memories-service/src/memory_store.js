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

function getMemoriesCollection() {
    if (!isDbConnected()) {
        throw new Error('MongoDB unavailable: Cannot access memories collection without an active database connection');
    }
    return mongodb.getCollection(mongodb.COLLECTIONS.MEMORIES);
}

function normalizeEmail(email) {
    if (!email || typeof email !== 'string') return '';
    return email.trim().toLowerCase();
}

/**
 * Loads all memories across all users (used by internal service endpoint).
 */
async function load_all_memories() {
    const collection = getMemoriesCollection();
    try {
        return await collection.find({}).toArray();
    } catch (err) {
        console.error('MemoryBook Memories: MongoDB load_all_memories error:', err.message);
        throw new Error(`Failed to load memories from MongoDB: ${err.message}`);
    }
}

/**
 * Retrieves all memories belonging to a specific owner.
 * Utilizes the compound index on { owner: 1, date: -1, created_at: -1 }.
 */
async function get_user_memories(ownerEmail) {
    const normalized = normalizeEmail(ownerEmail);
    if (!normalized) return [];

    const collection = getMemoriesCollection();
    try {
        // Primary index query: { owner: normalized }
        let userMemories = await collection.find({ owner: normalized }).toArray();
        if ((!userMemories || userMemories.length === 0) && ownerEmail !== normalized) {
            // Case-insensitive regex fallback for un-normalized legacy records
            userMemories = await collection.find({
                owner: { $regex: new RegExp(`^${normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }
            }).toArray();
        }
        return userMemories || [];
    } catch (err) {
        console.error('MemoryBook Memories: MongoDB get_user_memories error:', err.message);
        throw new Error(`Failed to query user memories from MongoDB: ${err.message}`);
    }
}

/**
 * Retrieves an individual memory by its unique memory_id.
 */
async function get_memory_by_id(memoryId) {
    if (!memoryId || typeof memoryId !== 'string') return null;

    const collection = getMemoriesCollection();
    try {
        return await collection.findOne({ memory_id: memoryId });
    } catch (err) {
        console.error('MemoryBook Memories: MongoDB get_memory_by_id error:', err.message);
        throw new Error(`Failed to query memory by ID from MongoDB: ${err.message}`);
    }
}

/**
 * Adds or upserts a memory document into MongoDB.
 */
async function add_memory(memory) {
    if (!memory || !memory.memory_id) return false;
    memory.owner = normalizeEmail(memory.owner);

    const collection = getMemoriesCollection();
    try {
        await collection.updateOne(
            { memory_id: memory.memory_id },
            { $set: memory },
            { upsert: true }
        );
        return memory;
    } catch (err) {
        console.error('MemoryBook Memories: MongoDB add_memory error:', err.message);
        throw new Error(`Failed to persist memory to MongoDB: ${err.message}`);
    }
}

/**
 * Updates an existing memory document ensuring ownership authorization.
 */
async function update_memory(memoryId, ownerEmail, updates) {
    if (!memoryId) return null;
    const normalized = normalizeEmail(ownerEmail);

    const collection = getMemoriesCollection();
    try {
        const filter = { memory_id: memoryId, owner: normalized };
        await collection.updateOne(filter, { $set: updates });
        return await collection.findOne(filter);
    } catch (err) {
        console.error('MemoryBook Memories: MongoDB update_memory error:', err.message);
        throw new Error(`Failed to update memory in MongoDB: ${err.message}`);
    }
}

/**
 * Deletes a memory document ensuring ownership authorization.
 */
async function delete_memory(memoryId, ownerEmail) {
    if (!memoryId) return false;
    const normalized = normalizeEmail(ownerEmail);

    const collection = getMemoriesCollection();
    try {
        const res = await collection.deleteOne({ memory_id: memoryId, owner: normalized });
        return res.deletedCount > 0;
    } catch (err) {
        console.error('MemoryBook Memories: MongoDB delete_memory error:', err.message);
        throw new Error(`Failed to delete memory from MongoDB: ${err.message}`);
    }
}

/**
 * Chronological sorting and pagination DSA utilities (Synopsis §6.3)
 */
function getMemoryTimestamp(mem) {
    if (mem && mem.date) {
        const t = new Date(mem.date).getTime();
        if (!isNaN(t)) return t;
    }
    if (mem && mem.created_at) {
        const t = new Date(mem.created_at).getTime();
        if (!isNaN(t)) return t;
    }
    return 0;
}

function compareMemoriesChronological(a, b, order = 'asc') {
    const isDesc = String(order).toLowerCase() === 'desc';
    const timeA = getMemoryTimestamp(a);
    const timeB = getMemoryTimestamp(b);
    if (timeA !== timeB) {
        return isDesc ? timeB - timeA : timeA - timeB;
    }
    // Tie-breaking: created_at timestamp
    const createdA = a && a.created_at ? new Date(a.created_at).getTime() : 0;
    const createdB = b && b.created_at ? new Date(b.created_at).getTime() : 0;
    if (createdA !== createdB && !isNaN(createdA) && !isNaN(createdB)) {
        return isDesc ? createdB - createdA : createdA - createdB;
    }
    // Tie-breaking: memory_id string localeCompare
    const idA = String((a && a.memory_id) || '');
    const idB = String((b && b.memory_id) || '');
    return isDesc ? idB.localeCompare(idA) : idA.localeCompare(idB);
}

function sortMemoriesChronologically(memories, order = 'asc') {
    if (!Array.isArray(memories)) return [];
    return [...memories].sort((a, b) => compareMemoriesChronological(a, b, order));
}

function paginateMemories(memories, pageQuery, limitQuery) {
    const totalRecords = Array.isArray(memories) ? memories.length : 0;

    let page = parseInt(pageQuery, 10);
    let limit = parseInt(limitQuery, 10);

    const isPageProvided = pageQuery !== undefined && pageQuery !== null && pageQuery !== '';

    if (isNaN(page) || page < 1) {
        page = 1;
    }

    if (isNaN(limit) || limit < 1) {
        limit = isPageProvided ? 10 : (totalRecords > 0 ? totalRecords : 10);
    }

    // Upper boundary clamp
    if (limit > 100) {
        limit = 100;
    }

    const totalPages = totalRecords === 0 ? 0 : Math.ceil(totalRecords / limit);

    let paged = [];
    if (totalRecords > 0 && page <= totalPages) {
        const startIndex = (page - 1) * limit;
        paged = memories.slice(startIndex, startIndex + limit);
    } else if (totalRecords > 0 && page > totalPages) {
        paged = [];
    }

    return {
        memories: paged,
        pagination: {
            page,
            limit,
            totalRecords,
            totalPages,
            hasPrevPage: page > 1 && totalPages > 0,
            hasNextPage: page < totalPages
        }
    };
}

module.exports = {
    isDbConnected,
    getMemoriesCollection,
    normalizeEmail,
    load_all_memories,
    get_user_memories,
    get_memory_by_id,
    add_memory,
    update_memory,
    delete_memory,
    getMemoryTimestamp,
    compareMemoriesChronological,
    sortMemoriesChronologically,
    paginateMemories
};
