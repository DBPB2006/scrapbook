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

function getMemoriesCollection() {
    if (!isDbConnected()) {
        throw new Error('MongoDB unavailable: Cannot access memories collection without an active database connection');
    }
    return mongodb.getCollection(mongodb.COLLECTIONS.MEMORIES);
}

/**
 * Loads memories (optionally scoped by owner and projection for internal callers).
 */
async function load_all_memories(options = {}) {
    if (options && typeof options.owner === 'string' && options.owner.trim()) {
        return await get_user_memories(options.owner);
    }
    const collection = getMemoriesCollection();
    try {
        const findOpts = (options && options.projection) ? { projection: options.projection } : {};
        return await collection.find({}, findOpts).toArray();
    } catch (err) {
        console.error('Scrapbook Memories: MongoDB load_all_memories error:', err.message);
        throw new Error(`Failed to load memories from MongoDB: ${err.message}`);
    }
}

/**
 * Retrieves all memories belonging to a specific owner.
 * Utilizes the compound index on { owner: 1, date: -1, created_at: -1, memory_id: -1 }.
 */
async function get_user_memories(ownerEmail, options = {}) {
    const normalized = normalizeEmail(ownerEmail);
    if (!normalized) return [];

    const collection = getMemoriesCollection();
    try {
        const findOpts = {
            projection: (options && options.projection) ? options.projection : { _id: 0 }
        };
        let cursor = collection.find({ owner: normalized }, findOpts);
        if (options && options.sort && typeof cursor.sort === 'function') {
            cursor = cursor.sort(options.sort);
        }
        let userMemories = await cursor.toArray();
        if ((!userMemories || userMemories.length === 0) && ownerEmail !== normalized) {
            // Case-insensitive regex fallback ONLY for un-normalized legacy input/records
            let fbCursor = collection.find({
                owner: { $regex: new RegExp(`^${escapeRegex(normalized)}$`, 'i') }
            }, findOpts);
            if (options && options.sort && typeof fbCursor.sort === 'function') {
                fbCursor = fbCursor.sort(options.sort);
            }
            userMemories = await fbCursor.toArray();
        }
        return userMemories || [];
    } catch (err) {
        console.error('Scrapbook Memories: MongoDB get_user_memories error:', err.message);
        throw new Error(`Failed to query user memories from MongoDB: ${err.message}`);
    }
}

/**
 * Retrieves a lightweight navigation timeline list for a user without full descriptions/media blobs.
 */
async function get_user_memory_nav_list(ownerEmail, order = 'asc') {
    const dir = String(order).toLowerCase() === 'desc' ? -1 : 1;
    const list = await get_user_memories(ownerEmail, {
        projection: { _id: 0, memory_id: 1, title: 1, date: 1, created_at: 1 },
        sort: { date: dir, created_at: dir, memory_id: dir }
    });
    return sortMemoriesChronologically(list, order);
}

/**
 * Retrieves paginated chronological memories using database-side count/sort/skip/limit
 * backed by idx_memories_owner_chronological ({ owner: 1, date: -1, created_at: -1, memory_id: -1 }).
 */
async function get_user_memories_paginated(ownerEmail, { order = 'asc', page: pageQuery, limit: limitQuery } = {}) {
    const normalized = normalizeEmail(ownerEmail);
    const sortOrder = String(order).toLowerCase() === 'desc' ? 'desc' : 'asc';
    const dir = sortOrder === 'desc' ? -1 : 1;

    if (!normalized) {
        return paginateMemories([], pageQuery, limitQuery);
    }

    const collection = getMemoriesCollection();
    try {
        if (typeof collection.countDocuments !== 'function') {
            const all = await get_user_memories(ownerEmail);
            return paginateMemories(sortMemoriesChronologically(all, sortOrder), pageQuery, limitQuery);
        }

        let filter = { owner: normalized };
        let totalRecords = await collection.countDocuments(filter);
        if (totalRecords === 0 && ownerEmail !== normalized) {
            const regexFilter = { owner: { $regex: new RegExp(`^${escapeRegex(normalized)}$`, 'i') } };
            const regexCount = await collection.countDocuments(regexFilter);
            if (regexCount > 0) {
                filter = regexFilter;
                totalRecords = regexCount;
            }
        }

        const isPageProvided = pageQuery !== undefined && pageQuery !== null && pageQuery !== '';
        let page = parseInt(pageQuery, 10);
        let limit = parseInt(limitQuery, 10);
        if (isNaN(page) || page < 1) page = 1;
        if (isNaN(limit) || limit < 1) {
            limit = isPageProvided ? 10 : (totalRecords > 0 ? totalRecords : 10);
        }
        if (limit > 100) limit = 100;

        const totalPages = totalRecords === 0 ? 0 : Math.ceil(totalRecords / limit);
        const pagination = {
            page,
            limit,
            totalRecords,
            totalPages,
            hasPrevPage: page > 1 && totalPages > 0,
            hasNextPage: page < totalPages
        };

        if (totalRecords === 0 || page > totalPages) {
            return { memories: [], pagination };
        }

        let cursor = collection.find(filter, { projection: { _id: 0 } });
        if (typeof cursor.sort === 'function') {
            cursor = cursor.sort({ date: dir, created_at: dir, memory_id: dir });
        }
        if (typeof cursor.skip === 'function') {
            cursor = cursor.skip((page - 1) * limit);
        }
        if (typeof cursor.limit === 'function') {
            cursor = cursor.limit(limit);
        }
        const paged = await cursor.toArray();
        return { memories: paged || [], pagination };
    } catch (err) {
        console.error('Scrapbook Memories: MongoDB get_user_memories_paginated error:', err.message);
        throw new Error(`Failed to query paginated user memories from MongoDB: ${err.message}`);
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
        console.error('Scrapbook Memories: MongoDB get_memory_by_id error:', err.message);
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
        console.error('Scrapbook Memories: MongoDB add_memory error:', err.message);
        throw new Error(`Failed to persist memory to MongoDB: ${err.message}`);
    }
}

/**
 * Updates an existing memory document ensuring ownership authorization.
 */
async function update_memory(memoryId, ownerEmail, updates) {
    if (!memoryId) return null;
    const normalized = normalizeEmail(ownerEmail);

    const cleanUpdates = { ...updates };
    delete cleanUpdates._id;

    const collection = getMemoriesCollection();
    try {
        const filter = { memory_id: memoryId, owner: normalized };
        const res = await collection.updateOne(filter, { $set: cleanUpdates });
        if (res && res.matchedCount === 0) {
            return null;
        }
        return await collection.findOne(filter, { projection: { _id: 0 } });
    } catch (err) {
        console.error('Scrapbook Memories: MongoDB update_memory error:', err.message);
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
        console.error('Scrapbook Memories: MongoDB delete_memory error:', err.message);
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

/**
 * Deletes all memories owned by a user and removes their references from other users' memory friends arrays.
 * Returns snapshot data for compensating rollback and candidate S3 keys for post-commit cleanup.
 */
async function cleanup_user_data(userEmail, session = null) {
    const normalized = normalizeEmail(userEmail);
    if (!normalized) {
        return { deletedCount: 0, modifiedFriendRefsCount: 0, deletedMemories: [], modifiedMemories: [] };
    }

    const collection = getMemoriesCollection();
    const opts = session ? { session } : {};
    const regex = new RegExp(`^${escapeRegex(normalized)}$`, 'i');

    const ownedMemories = await collection.find({
        $or: [{ owner: normalized }, { owner: { $regex: regex } }]
    }, opts).toArray();

    const deletedMemories = ownedMemories.map(m => {
        const copy = { ...m };
        delete copy._id;
        return copy;
    });

    if (ownedMemories.length > 0) {
        await collection.deleteMany({
            $or: [{ owner: normalized }, { owner: { $regex: regex } }]
        }, opts);
    }

    const remainingMemories = await collection.find({
        $or: [
            { friends: normalized },
            { friends: regex },
            { 'friends.email': normalized },
            { 'friends.email': regex },
            { 'friends.friend_id': normalized },
            { 'friends.friend_id': regex },
            { 'friends.id': normalized },
            { 'friends.id': regex }
        ]
    }, { projection: { _id: 0, memory_id: 1, friends: 1 }, ...opts }).toArray();
    const modifiedMemories = [];
    for (const mem of remainingMemories) {
        if (!Array.isArray(mem.friends) || mem.friends.length === 0) continue;
        const { changed, updated } = removeEmailFromFriendsArray(mem.friends, normalized);
        if (changed) {
            modifiedMemories.push({
                memory_id: mem.memory_id,
                previousFriends: JSON.parse(JSON.stringify(mem.friends))
            });
            await collection.updateOne(
                { memory_id: mem.memory_id },
                { $set: { friends: updated } },
                opts
            );
        }
    }

    return {
        deletedCount: deletedMemories.length,
        modifiedFriendRefsCount: modifiedMemories.length,
        deletedMemories,
        modifiedMemories
    };
}

/**
 * Compensating rollback helper for memory cleanup.
 */
async function restore_user_cleanup(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') return false;
    const collection = getMemoriesCollection();

    if (Array.isArray(snapshot.deletedMemories)) {
        for (const mem of snapshot.deletedMemories) {
            if (!mem || !mem.memory_id) continue;
            const cleanMem = { ...mem };
            delete cleanMem._id;
            await collection.updateOne(
                { memory_id: cleanMem.memory_id },
                { $set: cleanMem },
                { upsert: true }
            );
        }
    }

    if (Array.isArray(snapshot.modifiedMemories)) {
        for (const item of snapshot.modifiedMemories) {
            if (!item || !item.memory_id) continue;
            await collection.updateOne(
                { memory_id: item.memory_id },
                { $set: { friends: item.previousFriends || [] } }
            );
        }
    }

    return true;
}

/**
 * Updates a user's email across owned memories and friends arrays on all memories.
 */
async function update_user_email(oldEmail, newEmail, session = null) {
    const oldNorm = normalizeEmail(oldEmail);
    const newNorm = normalizeEmail(newEmail);
    if (!oldNorm || !newNorm || oldNorm === newNorm) {
        return { ownerUpdatedCount: 0, friendRefsUpdatedCount: 0 };
    }

    const collection = getMemoriesCollection();
    const opts = session ? { session } : {};
    const regex = new RegExp(`^${escapeRegex(oldNorm)}$`, 'i');

    const ownerRes = await collection.updateMany(
        { $or: [{ owner: oldNorm }, { owner: { $regex: regex } }] },
        { $set: { owner: newNorm } },
        opts
    );

    const taggedMemories = await collection.find({
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
    }, { projection: { _id: 0, memory_id: 1, friends: 1 }, ...opts }).toArray();
    let friendRefsUpdatedCount = 0;
    for (const mem of taggedMemories) {
        if (!Array.isArray(mem.friends) || mem.friends.length === 0) continue;
        const { changed, updated } = replaceEmailInFriendsArray(mem.friends, oldNorm, newNorm);
        if (changed) {
            await collection.updateOne(
                { memory_id: mem.memory_id },
                { $set: { friends: updated } },
                opts
            );
            friendRefsUpdatedCount++;
        }
    }

    return {
        ownerUpdatedCount: (ownerRes && ownerRes.modifiedCount) || 0,
        friendRefsUpdatedCount
    };
}

module.exports = {
    isDbConnected,
    load_all_memories,
    get_user_memories,
    get_user_memory_nav_list,
    get_user_memories_paginated,
    get_memory_by_id,
    add_memory,
    update_memory,
    delete_memory,
    sortMemoriesChronologically,
    cleanup_user_data,
    restore_user_cleanup,
    update_user_email
};
