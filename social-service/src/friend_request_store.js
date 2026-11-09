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

function getRequestsCollection() {
    if (!isDbConnected()) {
        throw new Error('MongoDB unavailable: Cannot access friend_requests collection without an active database connection');
    }
    return mongodb.getCollection(mongodb.COLLECTIONS.FRIEND_REQUESTS);
}

function normalizeEmail(email) {
    if (!email || typeof email !== 'string') return '';
    return email.trim().toLowerCase();
}

/**
 * Loads all friend requests across the platform.
 */
async function load_all_requests() {
    const collection = getRequestsCollection();
    try {
        return await collection.find({}).toArray();
    } catch (err) {
        console.error('MemoryBook Social: MongoDB load_all_requests error:', err.message);
        throw new Error(`Failed to load friend requests from MongoDB: ${err.message}`);
    }
}

/**
 * Finds any pending friend request between two users in either direction.
 * Utilizes the compound index on { from: 1, to: 1, status: 1 }.
 */
async function find_pending_between(email1, email2) {
    const u1 = normalizeEmail(email1);
    const u2 = normalizeEmail(email2);
    if (!u1 || !u2) return null;

    const collection = getRequestsCollection();
    try {
        return await collection.findOne({
            status: 'pending',
            $or: [
                { from: u1, to: u2 },
                { from: u2, to: u1 }
            ]
        });
    } catch (err) {
        console.error('MemoryBook Social: MongoDB find_pending_between error:', err.message);
        throw new Error(`Failed to query pending friend request from MongoDB: ${err.message}`);
    }
}

/**
 * Retrieves incoming pending requests for a user.
 * Utilizes the index on { to: 1, status: 1 }.
 */
async function get_incoming_requests(toEmail) {
    const target = normalizeEmail(toEmail);
    if (!target) return [];

    const collection = getRequestsCollection();
    try {
        return await collection.find({ to: target, status: 'pending' }).toArray();
    } catch (err) {
        console.error('MemoryBook Social: MongoDB get_incoming_requests error:', err.message);
        throw new Error(`Failed to query incoming friend requests from MongoDB: ${err.message}`);
    }
}

/**
 * Retrieves outgoing pending requests sent by a user.
 * Utilizes the index on { from: 1, status: 1 }.
 */
async function get_outgoing_requests(fromEmail) {
    const source = normalizeEmail(fromEmail);
    if (!source) return [];

    const collection = getRequestsCollection();
    try {
        return await collection.find({ from: source, status: 'pending' }).toArray();
    } catch (err) {
        console.error('MemoryBook Social: MongoDB get_outgoing_requests error:', err.message);
        throw new Error(`Failed to query outgoing friend requests from MongoDB: ${err.message}`);
    }
}

/**
 * Retrieves a friend request by its unique ID.
 * Utilizes the unique index on { id: 1 }.
 */
async function get_request_by_id(id) {
    if (!id || typeof id !== 'string') return null;

    const collection = getRequestsCollection();
    try {
        return await collection.findOne({ id });
    } catch (err) {
        console.error('MemoryBook Social: MongoDB get_request_by_id error:', err.message);
        throw new Error(`Failed to query friend request by ID from MongoDB: ${err.message}`);
    }
}

/**
 * Creates or upserts a friend request in MongoDB.
 */
async function add_request(request) {
    if (!request || !request.id) return null;
    request.from = normalizeEmail(request.from);
    request.to = normalizeEmail(request.to);

    const collection = getRequestsCollection();
    try {
        await collection.updateOne(
            { id: request.id },
            { $set: request },
            { upsert: true }
        );
        return request;
    } catch (err) {
        console.error('MemoryBook Social: MongoDB add_request error:', err.message);
        throw new Error(`Failed to persist friend request to MongoDB: ${err.message}`);
    }
}

/**
 * Updates the status of a friend request ('accepted' or 'declined').
 */
async function update_request_status(id, status) {
    if (!id) return null;
    const now = new Date().toISOString();

    const collection = getRequestsCollection();
    try {
        await collection.updateOne(
            { id },
            { $set: { status, updated_at: now } }
        );
        return await collection.findOne({ id });
    } catch (err) {
        console.error('MemoryBook Social: MongoDB update_request_status error:', err.message);
        throw new Error(`Failed to update friend request status in MongoDB: ${err.message}`);
    }
}

/**
 * Cancels / deletes an outgoing friend request.
 */
async function delete_request(id, fromEmail) {
    if (!id) return false;
    const source = normalizeEmail(fromEmail);

    const collection = getRequestsCollection();
    try {
        const res = await collection.deleteOne({ id, from: source });
        return res.deletedCount > 0;
    } catch (err) {
        console.error('MemoryBook Social: MongoDB delete_request error:', err.message);
        throw new Error(`Failed to delete friend request from MongoDB: ${err.message}`);
    }
}

module.exports = {
    isDbConnected,
    getRequestsCollection,
    normalizeEmail,
    load_all_requests,
    find_pending_between,
    get_incoming_requests,
    get_outgoing_requests,
    get_request_by_id,
    add_request,
    update_request_status,
    delete_request
};
