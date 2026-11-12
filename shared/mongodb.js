/**
 * Standalone MongoDB Connection & Index Foundation
 * Scrapbook Platform
 */

const { MongoClient } = require('mongodb');

const COLLECTIONS = Object.freeze({
    USERS: 'users',
    MEMORIES: 'memories',
    FRIEND_REQUESTS: 'friend_requests',
    TIME_CAPSULES: 'time_capsules',
    SHARED_MEMORIES: 'shared_memories'
});

const INDEX_DEFINITIONS = Object.freeze({
    [COLLECTIONS.USERS]: [
        { keys: { email: 1 }, options: { unique: true, name: 'idx_users_email_unique' } },
        {
            keys: { username: 1 },
            options: {
                unique: true,
                partialFilterExpression: { username: { $type: 'string', $gt: '' } },
                name: 'idx_users_username_unique'
            }
        },
        { keys: { bucket_id: 1, email: 1 }, options: { name: 'idx_users_bucket_email' } }
    ],
    [COLLECTIONS.MEMORIES]: [
        { keys: { memory_id: 1 }, options: { unique: true, name: 'idx_memories_id_unique' } },
        {
            keys: { owner: 1, date: -1, created_at: -1, memory_id: -1 },
            options: { name: 'idx_memories_owner_chronological' }
        }
    ],
    [COLLECTIONS.FRIEND_REQUESTS]: [
        { keys: { id: 1 }, options: { unique: true, name: 'idx_freq_id_unique' } },
        {
            keys: { from: 1, to: 1 },
            options: {
                unique: true,
                partialFilterExpression: { status: 'pending' },
                name: 'idx_freq_pending_direction_unique'
            }
        },
        {
            keys: { pending_pair_key: 1 },
            options: {
                unique: true,
                partialFilterExpression: { status: 'pending', pending_pair_key: { $type: 'string' } },
                name: 'idx_freq_pending_pair_unique'
            }
        },
        { keys: { to: 1, status: 1 }, options: { name: 'idx_freq_incoming_status' } },
        { keys: { from: 1, status: 1 }, options: { name: 'idx_freq_outgoing_status' } }
    ],
    [COLLECTIONS.TIME_CAPSULES]: [
        { keys: { id: 1 }, options: { unique: true, name: 'idx_tc_id_unique' } },
        { keys: { unlocked: 1, reveal_date: 1 }, options: { name: 'idx_tc_unlocked_reveal' } },
        { keys: { recipient_email: 1, unlocked: 1 }, options: { name: 'idx_tc_recipient_unlocked' } },
        { keys: { user_email: 1 }, options: { name: 'idx_tc_sender' } }
    ],
    [COLLECTIONS.SHARED_MEMORIES]: [
        { keys: { memory_id: 1 }, options: { unique: true, name: 'idx_shared_mem_id_unique' } },
        {
            keys: { original_memory_id: 1, created_at: -1, date: -1 },
            options: { name: 'idx_shared_original_created' }
        },
        { keys: { to: 1, seen: 1, created_at: -1, date: -1 }, options: { name: 'idx_shared_to_seen_created' } },
        { keys: { to: 1, created_at: -1, date: -1 }, options: { name: 'idx_shared_to_created' } },
        { keys: { from: 1, created_at: -1, date: -1 }, options: { name: 'idx_shared_from_created' } }
    ]
});

let clientInstance = null;
let dbInstance = null;
let connectionPromise = null;
let lastConfig = null;
let reconnectTimer = null;
let intentionalClose = false;

function maskUri(uri) {
    return typeof uri === 'string'
        ? uri.replace(/(mongodb(?:\+srv)?:\/\/[^:/?#@]+:)([^@/?#]+)(@)/, '$1***$3')
        : '';
}

async function connect(uri = null, databaseName = null, customOptions = {}) {
    if (clientInstance && dbInstance) return { client: clientInstance, db: dbInstance };
    if (connectionPromise) return connectionPromise;

    intentionalClose = false;
    const targetUri = (uri || process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/scrapbook').trim();
    const targetDbName = (databaseName || process.env.MONGODB_DATABASE || '').trim() || undefined;
    const maxPoolSize = Number.parseInt(process.env.MONGODB_POOL_MAX, 10) || 10;

    const options = {
        maxPoolSize,
        serverSelectionTimeoutMS: 10000,
        retryWrites: false,
        ...customOptions
    };

    const hasCreds = /^mongodb(?:\+srv)?:\/\/[^/?#@]+:[^/?#@]+@/i.test(targetUri);
    if (!options.authSource && hasCreds && !/[?&]authSource=/i.test(targetUri)) {
        const authSrc = (process.env.MONGODB_AUTH_SOURCE || targetDbName || '').trim();
        if (authSrc) options.authSource = authSrc;
    }

    lastConfig = { uri: targetUri, databaseName: targetDbName, customOptions: options };

    connectionPromise = (async () => {
        const client = new MongoClient(targetUri, options);
        try {
            await client.connect();
            const db = client.db(targetDbName);
            await db.command({ ping: 1 });

            clientInstance = client;
            dbInstance = db;

            const resetOnDisconnect = () => {
                if (clientInstance === client) {
                    clientInstance = null;
                    dbInstance = null;
                    connectionPromise = null;
                }
            };
            client.on('close', resetOnDisconnect);
            client.on('topologyClosed', resetOnDisconnect);

            return { client, db };
        } catch (error) {
            try { await client.close(true); } catch (_) {}
            if (clientInstance === client || clientInstance === null) {
                connectionPromise = null;
                clientInstance = null;
                dbInstance = null;
            }
            const err = new Error(`MongoDB connection failed [${maskUri(targetUri)}]: ${error.message}`);
            err.originalError = error;
            throw err;
        }
    })();

    return connectionPromise;
}

function getDb() {
    if (!dbInstance) {
        throw new Error('Database not connected. Call connect() first.');
    }
    return dbInstance;
}

function getCollection(collectionName) {
    return getDb().collection(collectionName);
}

function isConnected() {
    return !!(clientInstance && dbInstance);
}

async function ping(timeoutMs = 2000) {
    if (!isConnected()) return false;
    let timer = null;
    try {
        return await Promise.race([
            dbInstance.command({ ping: 1 }).then(res => !!(res && res.ok === 1), () => false),
            new Promise(resolve => {
                timer = setTimeout(() => resolve(false), timeoutMs);
                if (typeof timer.unref === 'function') timer.unref();
            })
        ]);
    } catch (_) {
        return false;
    } finally {
        if (timer) clearTimeout(timer);
    }
}

function stopReconnectLoop() {
    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }
}

function startReconnectLoop(options = {}) {
    if (intentionalClose || reconnectTimer) return false;
    if (isConnected()) return true;

    const cfg = lastConfig || {};
    const onConnected = typeof options.onConnected === 'function' ? options.onConnected : null;
    const label = options.serviceName || 'MongoDB';

    const scheduleNext = () => {
        if (intentionalClose || isConnected()) return;
        reconnectTimer = setTimeout(async () => {
            reconnectTimer = null;
            if (intentionalClose || isConnected()) return;
            try {
                const { db, client } = await connect(options.uri || cfg.uri, options.databaseName || cfg.databaseName, options.customOptions || cfg.customOptions);
                await initializeIndexes(db);
                if (onConnected) await onConnected(db, client);
                console.log(`${label}: Recovered MongoDB connection.`);
            } catch (err) {
                console.warn(`${label}: MongoDB reconnect failed: ${err.message}`);
                scheduleNext();
            }
        }, 5000);
        if (typeof reconnectTimer.unref === 'function') reconnectTimer.unref();
    };

    scheduleNext();
    return true;
}

async function close(force = false) {
    intentionalClose = true;
    stopReconnectLoop();
    const activeClient = clientInstance;
    clientInstance = null;
    dbInstance = null;
    connectionPromise = null;
    if (activeClient) {
        await activeClient.close(force);
    }
}

async function deduplicatePendingFriendRequests(col) {
    const pendingDocs = await col.find({ status: 'pending' }).toArray();
    if (!Array.isArray(pendingDocs) || pendingDocs.length === 0) return;

    pendingDocs.sort((a, b) => (new Date(a.created_at || 0).getTime() || 0) - (new Date(b.created_at || 0).getTime() || 0));
    const seenPairs = new Set();

    for (const doc of pendingDocs) {
        const from = typeof doc.from === 'string' ? doc.from.trim().toLowerCase() : '';
        const to = typeof doc.to === 'string' ? doc.to.trim().toLowerCase() : '';
        if (!from || !to) continue;
        const pairKey = [from, to].sort().join('|');

        if (seenPairs.has(pairKey)) {
            if (doc.id) await col.deleteOne({ id: doc.id });
            continue;
        }
        seenPairs.add(pairKey);

        const patch = {};
        if (doc.from !== from) patch.from = from;
        if (doc.to !== to) patch.to = to;
        if (doc.pending_pair_key !== pairKey) patch.pending_pair_key = pairKey;
        if (Object.keys(patch).length > 0 && doc.id) {
            await col.updateOne({ id: doc.id }, { $set: patch });
        }
    }
}

async function ensureIndex(col, colName, spec) {
    try {
        return await col.createIndex(spec.keys, spec.options);
    } catch (err) {
        if (err && (err.code === 85 || err.code === 86)) {
            try { await col.dropIndex(spec.options.name); } catch (_) {}
            return col.createIndex(spec.keys, spec.options);
        }
        if (err && err.code === 11000 && colName === COLLECTIONS.FRIEND_REQUESTS) {
            await deduplicatePendingFriendRequests(col);
            return col.createIndex(spec.keys, spec.options);
        }
        throw err;
    }
}

async function initializeIndexes(targetDb = null) {
    const db = targetDb || getDb();
    for (const [colName, specs] of Object.entries(INDEX_DEFINITIONS)) {
        const col = db.collection(colName);
        for (const spec of specs) {
            await ensureIndex(col, colName, spec);
        }
    }
}

module.exports = {
    COLLECTIONS,
    connect,
    getDb,
    getCollection,
    isConnected,
    ping,
    close,
    startReconnectLoop,
    stopReconnectLoop,
    initializeIndexes
};
