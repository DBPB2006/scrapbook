const fs = require('fs');
const path = require('path');

const hasParentShared = fs.existsSync(path.join(__dirname, '..', 'shared'));
const mongodb = hasParentShared ? require('../shared/mongodb') : require('../../shared/mongodb');
const {
    normalizeEmail,
    escapeRegex
} = hasParentShared ? require('../shared/service_common') : require('../../shared/service_common');

function isDbConnected() {
    return !!(mongodb && typeof mongodb.isConnected === 'function' && mongodb.isConnected());
}

function getRequestsCollection() {
    if (!isDbConnected()) {
        throw new Error('MongoDB unavailable: Cannot access friend_requests collection without an active database connection');
    }
    return mongodb.getCollection(mongodb.COLLECTIONS.FRIEND_REQUESTS);
}

function computePendingPairKey(email1, email2) {
    const u1 = normalizeEmail(email1);
    const u2 = normalizeEmail(email2);
    if (!u1 || !u2) return null;
    return [u1, u2].sort().join('|');
}

/**
 * Finds any pending friend request between two users in either direction.
 * Utilizes the compound index on { from: 1, to: 1, status: 1 }.
 */
async function find_pending_between(email1, email2) {
    const u1 = normalizeEmail(email1);
    const u2 = normalizeEmail(email2);
    if (!u1 || !u2) return null;

    const pairKey = computePendingPairKey(u1, u2);
    const collection = getRequestsCollection();
    try {
        return await collection.findOne({
            status: 'pending',
            $or: [
                ...(pairKey ? [{ pending_pair_key: pairKey }] : []),
                { from: u1, to: u2 },
                { from: u2, to: u1 }
            ]
        });
    } catch (err) {
        console.error('Scrapbook Social: MongoDB find_pending_between error:', err.message);
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
        console.error('Scrapbook Social: MongoDB get_incoming_requests error:', err.message);
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
        console.error('Scrapbook Social: MongoDB get_outgoing_requests error:', err.message);
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
        console.error('Scrapbook Social: MongoDB get_request_by_id error:', err.message);
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
    const status = request.status || 'pending';
    request.status = status;
    request.pending_pair_key = status === 'pending' ? computePendingPairKey(request.from, request.to) : null;

    const collection = getRequestsCollection();
    try {
        await collection.updateOne(
            { id: request.id },
            { $set: request },
            { upsert: true }
        );
        return request;
    } catch (err) {
        console.error('Scrapbook Social: MongoDB add_request error:', err.message);
        const wrapped = new Error(`Failed to persist friend request to MongoDB: ${err.message}`);
        if (err && err.code !== undefined) wrapped.code = err.code;
        wrapped.originalError = err;
        throw wrapped;
    }
}

/**
 * Atomically transitions a pending friend request to targetStatus ('accepted' or 'declined')
 * using findOneAndUpdate to prevent concurrent duplicate acceptance races.
 */
async function claim_pending_request(id, recipientEmail, targetStatus = 'accepted', session = null) {
    if (!id || typeof id !== 'string') return null;
    const target = normalizeEmail(recipientEmail);
    if (!target) return null;
    const now = new Date().toISOString();

    const collection = getRequestsCollection();
    try {
        const res = await collection.findOneAndUpdate(
            { id, status: 'pending' },
            { $set: { status: targetStatus, updated_at: now, pending_pair_key: null } },
            { returnDocument: 'before', ...(session ? { session } : {}) }
        );
        const doc = (res && typeof res === 'object' && 'value' in res && 'ok' in res) ? res.value : res;
        if (!doc) return null;
        if (normalizeEmail(doc.to) !== target) {
            // Undo status change if somehow matched against mismatched casing recipient
            await collection.updateOne(
                { id, status: targetStatus },
                {
                    $set: {
                        status: 'pending',
                        updated_at: doc.updated_at || now,
                        pending_pair_key: computePendingPairKey(doc.from, doc.to)
                    }
                },
                session ? { session } : {}
            );
            return null;
        }
        return doc;
    } catch (err) {
        console.error('Scrapbook Social: MongoDB claim_pending_request error:', err.message);
        throw new Error(`Failed to transition pending friend request in MongoDB: ${err.message}`);
    }
}

/**
 * Compensating rollback helper: reverts request status (e.g. 'accepted' -> 'pending')
 * when a non-transactional downstream persistence step fails.
 */
async function revert_request_status(id, expectedStatus = 'accepted', targetStatus = 'pending') {
    if (!id || typeof id !== 'string') return false;
    const now = new Date().toISOString();

    const collection = getRequestsCollection();
    try {
        const patch = { status: targetStatus, updated_at: now };
        if (targetStatus === 'pending') {
            const existing = await collection.findOne({ id });
            if (existing) {
                patch.pending_pair_key = computePendingPairKey(existing.from, existing.to);
            }
        } else {
            patch.pending_pair_key = null;
        }
        const res = await collection.updateOne(
            { id, status: expectedStatus },
            { $set: patch }
        );
        return res.matchedCount > 0;
    } catch (err) {
        console.error('Scrapbook Social: MongoDB revert_request_status error:', err.message);
        throw new Error(`Failed to revert friend request status in MongoDB: ${err.message}`);
    }
}

/**
 * Cancels / deletes an outgoing friend request.
 */
async function delete_request(id, fromEmail, options = {}) {
    if (!id) return false;
    const source = normalizeEmail(fromEmail);
    const requirePending = !options || options.requirePending !== false;

    const collection = getRequestsCollection();
    try {
        const filter = requirePending
            ? { id, from: source, status: 'pending' }
            : { id, from: source };
        const res = await collection.deleteOne(filter);
        return res.deletedCount > 0;
    } catch (err) {
        console.error('Scrapbook Social: MongoDB delete_request error:', err.message);
        throw new Error(`Failed to delete friend request from MongoDB: ${err.message}`);
    }
}

/**
 * Removes all friend requests sent or received by a deleted user account.
 */
async function cleanup_user_requests(userEmail, session = null) {
    const target = normalizeEmail(userEmail);
    if (!target) {
        return { deletedCount: 0, deletedRequests: [] };
    }

    const collection = getRequestsCollection();
    const opts = session ? { session } : {};
    const regex = new RegExp(`^${escapeRegex(target)}$`, 'i');
    const filter = {
        $or: [
            { from: target },
            { to: target },
            { from: { $regex: regex } },
            { to: { $regex: regex } }
        ]
    };

    const matches = await collection.find(filter, opts).toArray();
    const deletedRequests = matches.map(r => {
        const copy = { ...r };
        delete copy._id;
        return copy;
    });

    if (matches.length > 0) {
        await collection.deleteMany(filter, opts);
    }

    return {
        deletedCount: deletedRequests.length,
        deletedRequests
    };
}

/**
 * Compensating rollback helper for deleted friend requests.
 */
async function restore_user_requests(deletedRequests) {
    if (!Array.isArray(deletedRequests) || deletedRequests.length === 0) return true;
    const collection = getRequestsCollection();
    for (const reqDoc of deletedRequests) {
        if (!reqDoc || !reqDoc.id) continue;
        const cleanDoc = { ...reqDoc };
        delete cleanDoc._id;
        await collection.updateOne(
            { id: cleanDoc.id },
            { $set: cleanDoc },
            { upsert: true }
        );
    }
    return true;
}

/**
 * Updates from/to email references when a user changes their email address.
 */
async function update_user_email(oldEmail, newEmail, session = null) {
    const oldNorm = normalizeEmail(oldEmail);
    const newNorm = normalizeEmail(newEmail);
    if (!oldNorm || !newNorm || oldNorm === newNorm) {
        return { updatedCount: 0, previousDocs: [] };
    }

    const collection = getRequestsCollection();
    const opts = session ? { session } : {};
    const regex = new RegExp(`^${escapeRegex(oldNorm)}$`, 'i');
    const matches = await collection.find({
        $or: [
            { from: oldNorm },
            { to: oldNorm },
            { from: { $regex: regex } },
            { to: { $regex: regex } }
        ]
    }, opts).toArray();

    const previousDocs = [];
    let updatedCount = 0;
    for (const doc of matches) {
        const fromNorm = normalizeEmail(doc.from);
        const toNorm = normalizeEmail(doc.to);
        const nextFrom = fromNorm === oldNorm ? newNorm : doc.from;
        const nextTo = toNorm === oldNorm ? newNorm : doc.to;
        const nextPairKey = doc.status === 'pending'
            ? computePendingPairKey(nextFrom, nextTo)
            : null;
        if (nextFrom !== doc.from || nextTo !== doc.to || (doc.status === 'pending' && nextPairKey !== doc.pending_pair_key)) {
            previousDocs.push({
                id: doc.id,
                from: doc.from,
                to: doc.to,
                pending_pair_key: doc.pending_pair_key
            });
            const patch = {
                from: nextFrom,
                to: nextTo,
                updated_at: new Date().toISOString()
            };
            if (doc.status === 'pending') {
                patch.pending_pair_key = nextPairKey;
            }
            await collection.updateOne(
                { id: doc.id },
                { $set: patch },
                opts
            );
            updatedCount++;
        }
    }

    return { updatedCount, previousDocs };
}

module.exports = {
    isDbConnected,
    find_pending_between,
    get_incoming_requests,
    get_outgoing_requests,
    get_request_by_id,
    add_request,
    claim_pending_request,
    revert_request_status,
    delete_request,
    cleanup_user_requests,
    restore_user_requests,
    update_user_email
};
