/**
 * MongoDB Community Server Connection Foundation
 * Memory Book Platform - Shared Database Client Module
 *
 * Provides a production-grade, process-level singleton connection pool,
 * URI/authSource resolution, bounded reconnect recovery, and idempotent
 * index management using the official MongoDB driver (MongoClient).
 */

const { MongoClient } = require('mongodb');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Ensure crypto is polyfilled for Node 18 runtime environments
if (!globalThis.crypto) {
    globalThis.crypto = crypto.webcrypto || crypto;
}

// Target collection names for the Memory Book platform
const COLLECTIONS = Object.freeze({
    USERS: 'users',
    MEMORIES: 'memories',
    FRIEND_REQUESTS: 'friend_requests',
    TIME_CAPSULES: 'time_capsules',
    SHARED_MEMORIES: 'shared_memories'
});

// Approved indexes aligned strictly to actual platform queries and sorts
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

// Obsolete speculative/superseded indexes removed safely during initializeIndexes()
const LEGACY_DROPPED_INDEXES = Object.freeze({
    [COLLECTIONS.MEMORIES]: ['idx_memories_owner_tags'],
    [COLLECTIONS.FRIEND_REQUESTS]: ['idx_freq_direction_status'],
    [COLLECTIONS.TIME_CAPSULES]: ['idx_tc_reveal_unlocked'],
    [COLLECTIONS.SHARED_MEMORIES]: ['idx_shared_to_seen', 'idx_shared_to_date', 'idx_shared_from_date']
});

// Process-level singletons
let clientInstance = null;
let dbInstance = null;
let connectionPromise = null;
let lastConnectionConfig = null;
let reconnectTimer = null;
let reconnectAttempt = 0;
let reconnectInFlight = false;
let intentionalClose = false;

/**
 * Parses a positive integer env setting cleanly with bounds, preventing NaN leakage.
 */
function parsePositiveInt(rawValue, fallback, min = 1, max = 600000) {
    if (rawValue === undefined || rawValue === null || rawValue === '') return fallback;
    const parsed = Number.parseInt(String(rawValue).trim(), 10);
    if (!Number.isFinite(parsed) || parsed < min) return fallback;
    return Math.min(parsed, max);
}

/**
 * Sanitizes connection URI to safely mask credentials in logs.
 * Example: mongodb://admin:secret123@host:27017 -> mongodb://admin:***@host:27017
 */
function maskUri(uri) {
    if (!uri || typeof uri !== 'string') return '';
    return uri.replace(/(mongodb(?:\+srv)?:\/\/[^:/?#@]+:)([^@/?#]+)(@)/, '$1***$3');
}

/**
 * Extracts database name from a MongoDB URI path when explicitly specified.
 */
function extractDatabaseFromUri(uri) {
    if (!uri || typeof uri !== 'string') return '';
    const match = uri.match(/^mongodb(?:\+srv)?:\/\/[^/?#]+\/([^?#]*)/i);
    if (!match || !match[1]) return '';
    const raw = decodeURIComponent(match[1].trim()).replace(/\/+$/, '');
    return raw || '';
}

function uriHasCredentials(uri) {
    return typeof uri === 'string' && /^mongodb(?:\+srv)?:\/\/[^/?#@]+:[^/?#@]+@/i.test(uri);
}

function uriHasExplicitAuthSource(uri) {
    return typeof uri === 'string' && /(?:[?&])authSource=([^&#]+)/i.test(uri);
}

/**
 * Resolves effective URI, target DB name, and authSource consistently across env & URI parameters.
 */
function resolveDatabaseConfig(uri = null, databaseName = null, customOptions = {}) {
    const targetUri = (uri || process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/memorybook').trim();
    const uriDb = extractDatabaseFromUri(targetUri);
    const envDb = typeof process.env.MONGODB_DATABASE === 'string' ? process.env.MONGODB_DATABASE.trim() : '';
    const explicitDb = typeof databaseName === 'string' ? databaseName.trim() : '';
    const targetDbName = explicitDb || envDb || uriDb || 'memorybook';

    const envAuthSource = typeof process.env.MONGODB_AUTH_SOURCE === 'string' ? process.env.MONGODB_AUTH_SOURCE.trim() : '';
    let authSource = customOptions.authSource || '';
    if (!authSource && !uriHasExplicitAuthSource(targetUri) && uriHasCredentials(targetUri)) {
        authSource = envAuthSource || uriDb || targetDbName;
    }

    return {
        targetUri,
        targetDbName,
        uriDb,
        authSource: authSource || undefined
    };
}

/**
 * Checks whether an application URI appears to target root/admin credentials.
 */
function isAdminStyleUri(uri) {
    if (!uri || typeof uri !== 'string') return false;
    const credMatch = uri.match(/^mongodb(?:\+srv)?:\/\/([^:/?#@]+):/i);
    const username = credMatch ? decodeURIComponent(credMatch[1]).toLowerCase() : '';
    const authSrcMatch = uri.match(/(?:[?&])authSource=([^&#]+)/i);
    const authSrc = authSrcMatch ? decodeURIComponent(authSrcMatch[1]).toLowerCase() : '';
    return username === 'admin' || username === 'root' || authSrc === 'admin';
}

/**
 * Builds MongoClient options from environment configuration.
 * Standard options for self-hosted MongoDB Community Server.
 */
function buildClientOptions(overrides = {}) {
    const maxPoolSize = parsePositiveInt(process.env.MONGODB_POOL_MAX, 20, 1, 500);
    const rawMinPoolSize = parsePositiveInt(process.env.MONGODB_POOL_MIN, 2, 0, 500);
    const minPoolSize = Math.min(rawMinPoolSize, maxPoolSize);

    const options = {
        maxPoolSize,
        minPoolSize,
        connectTimeoutMS: parsePositiveInt(process.env.MONGODB_CONNECT_TIMEOUT_MS, 10000, 100, 300000),
        socketTimeoutMS: parsePositiveInt(process.env.MONGODB_SOCKET_TIMEOUT_MS, 45000, 100, 600000),
        serverSelectionTimeoutMS: parsePositiveInt(process.env.MONGODB_SERVER_SELECTION_TIMEOUT_MS, 10000, 100, 300000),
        waitQueueTimeoutMS: parsePositiveInt(process.env.MONGODB_WAIT_QUEUE_TIMEOUT_MS, 10000, 100, 300000),
        heartbeatFrequencyMS: parsePositiveInt(process.env.MONGODB_HEARTBEAT_FREQUENCY_MS, 10000, 500, 300000),
        retryWrites: true,
        retryReads: true,
        ...overrides
    };

    // Keep explicit invariant even if overrides changed maxPoolSize/minPoolSize
    if (typeof options.minPoolSize === 'number' && typeof options.maxPoolSize === 'number' && options.minPoolSize > options.maxPoolSize) {
        options.minPoolSize = options.maxPoolSize;
    }

    // TLS Configuration (disabled by default for private self-hosted MongoDB)
    if (process.env.MONGODB_TLS === 'true') {
        options.tls = true;
        const caPath = process.env.MONGODB_CA_PATH;
        if (caPath && fs.existsSync(caPath)) {
            options.tlsCAFile = path.resolve(caPath);
        }
    }

    return options;
}

/**
 * Establishes or reuses a singleton database connection pool.
 *
 * @param {string} [uri] Optional URI override (defaults to MONGODB_URI)
 * @param {string} [databaseName] Optional DB name override (defaults to MONGODB_DATABASE, URI path, or 'memorybook')
 * @param {object} [customOptions] Additional MongoClient options
 * @returns {Promise<{client: MongoClient, db: import('mongodb').Db}>}
 */
async function connect(uri = null, databaseName = null, customOptions = {}) {
    // 1. Return active singleton if already established and responsive
    if (clientInstance && dbInstance) {
        return { client: clientInstance, db: dbInstance };
    }

    // 2. Await in-flight connection promise to prevent duplicate pool creation under concurrent calls
    if (connectionPromise) {
        return connectionPromise;
    }

    intentionalClose = false;
    const { targetUri, targetDbName, authSource } = resolveDatabaseConfig(uri, databaseName, customOptions);
    lastConnectionConfig = { uri: targetUri, databaseName: targetDbName, customOptions };

    const mergedCustomOptions = authSource && !customOptions.authSource
        ? { authSource, ...customOptions }
        : customOptions;
    const clientOptions = buildClientOptions(mergedCustomOptions);

    if (process.env.NODE_ENV !== 'test' && !process.env.MONGODB_ALLOW_ADMIN_URI && isAdminStyleUri(targetUri)) {
        console.warn(`MongoDB Warning [${maskUri(targetUri)}]: URI appears to reference an admin user or authSource=admin. Use the least-privilege application user and ?authSource=${targetDbName}.`);
    }

    connectionPromise = (async () => {
        const client = new MongoClient(targetUri, clientOptions);
        try {
            await client.connect();

            const db = client.db(targetDbName);

            // Verify connectivity via ping command
            await db.command({ ping: 1 });

            clientInstance = client;
            dbInstance = db;
            reconnectAttempt = 0;

            const resetOnDisconnect = () => {
                if (clientInstance === client) {
                    clientInstance = null;
                    dbInstance = null;
                    connectionPromise = null;
                }
            };

            // Clear singleton references ONLY when this active client disconnects
            client.on('close', resetOnDisconnect);
            client.on('topologyClosed', resetOnDisconnect);

            return { client: clientInstance, db: dbInstance };
        } catch (error) {
            try {
                await client.close(true);
            } catch (_) {}
            // Reset connection promise on failure so retries can occur cleanly
            if (clientInstance === client || clientInstance === null) {
                connectionPromise = null;
                clientInstance = null;
                dbInstance = null;
            }
            const safeUri = maskUri(targetUri);
            const err = new Error(`MongoDB connection failed [${safeUri}]: ${error.message}`);
            err.originalError = error;
            throw err;
        }
    })();

    return connectionPromise;
}

/**
 * Returns the active Db instance.
 * @throws {Error} if connect() has not been called or connection is inactive
 * @returns {import('mongodb').Db}
 */
function getDb() {
    if (!dbInstance) {
        throw new Error('Database not connected. Please call and await connect() prior to accessing getDb().');
    }
    return dbInstance;
}

/**
 * Returns the active MongoClient instance.
 * @returns {MongoClient|null}
 */
function getClient() {
    return clientInstance;
}

/**
 * Convenience accessor for a specific collection.
 * @param {string} collectionName
 * @returns {import('mongodb').Collection}
 */
function getCollection(collectionName) {
    return getDb().collection(collectionName);
}

/**
 * Returns whether the database connection is currently active.
 * @returns {boolean}
 */
function isConnected() {
    return !!(clientInstance && dbInstance);
}

/**
 * Executes a bounded latency ping against the active database connection.
 * @param {number} [timeoutMs=2000]
 * @returns {Promise<boolean>}
 */
async function ping(timeoutMs = 2000) {
    if (!isConnected()) return false;
    let timer = null;
    try {
        const pingPromise = Promise.resolve(dbInstance.command({ ping: 1 })).then(
            (res) => !!(res && res.ok === 1),
            () => false
        );
        const timeoutPromise = new Promise((resolve) => {
            timer = setTimeout(() => resolve(false), timeoutMs);
        });
        return await Promise.race([pingPromise, timeoutPromise]);
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
    reconnectInFlight = false;
    reconnectAttempt = 0;
}

/**
 * Starts bounded non-blocking exponential-backoff reconnection loop when DB is unavailable.
 */
function startReconnectLoop(options = {}) {
    if (intentionalClose || reconnectTimer || reconnectInFlight) return false;
    if (isConnected()) return true;

    const baseDelayMs = parsePositiveInt(options.baseDelayMs || process.env.MONGODB_RETRY_BASE_MS, 2000, 50, 60000);
    const maxDelayMs = parsePositiveInt(options.maxDelayMs || process.env.MONGODB_RETRY_MAX_MS, 30000, baseDelayMs, 300000);
    const cfg = lastConnectionConfig || {};
    const targetUri = options.uri || cfg.uri || null;
    const targetDb = options.databaseName || cfg.databaseName || null;
    const customOpts = options.customOptions || cfg.customOptions || {};
    const onConnected = typeof options.onConnected === 'function' ? options.onConnected : null;
    const label = options.serviceName || 'MongoDB';

    const scheduleNext = () => {
        if (intentionalClose || isConnected()) {
            reconnectInFlight = false;
            return;
        }
        const delay = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, Math.min(reconnectAttempt, 6)));
        reconnectAttempt += 1;
        reconnectTimer = setTimeout(async () => {
            reconnectTimer = null;
            if (intentionalClose || isConnected()) {
                reconnectInFlight = false;
                return;
            }
            reconnectInFlight = true;
            try {
                const { db, client } = await connect(targetUri, targetDb, customOpts);
                await initializeIndexes(db);
                if (onConnected) {
                    await onConnected(db, client);
                }
                reconnectInFlight = false;
                reconnectAttempt = 0;
                console.log(`${label}: Recovered MongoDB connection and verified indexes.`);
            } catch (err) {
                reconnectInFlight = false;
                console.warn(`${label}: MongoDB reconnect attempt #${reconnectAttempt} failed: ${err.message}`);
                scheduleNext();
            }
        }, delay);
        if (typeof reconnectTimer.unref === 'function') {
            reconnectTimer.unref();
        }
    };

    scheduleNext();
    return true;
}

/**
 * Gracefully shuts down the connection pool and stops any pending reconnect timers.
 * @param {boolean} [force=false]
 * @returns {Promise<void>}
 */
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

function canonicalize(value) {
    if (value === null || value === undefined || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(canonicalize);
    const sorted = {};
    for (const key of Object.keys(value).sort()) {
        sorted[key] = canonicalize(value[key]);
    }
    return sorted;
}

function keysMatchInOrder(existingKey, desiredKey) {
    return JSON.stringify(Object.entries(existingKey || {})) === JSON.stringify(Object.entries(desiredKey || {}));
}

function optionsMatch(existingIdx, desiredOptions) {
    if (!!existingIdx.unique !== !!desiredOptions.unique) return false;
    if (!!existingIdx.sparse !== !!desiredOptions.sparse) return false;
    const existingPfe = existingIdx.partialFilterExpression ? JSON.stringify(canonicalize(existingIdx.partialFilterExpression)) : null;
    const desiredPfe = desiredOptions.partialFilterExpression ? JSON.stringify(canonicalize(desiredOptions.partialFilterExpression)) : null;
    return existingPfe === desiredPfe;
}

async function dropIndexIfExists(collection, indexName) {
    if (!collection || typeof collection.indexes !== 'function' || typeof collection.dropIndex !== 'function') {
        return false;
    }
    try {
        const existing = await collection.indexes();
        const found = Array.isArray(existing) && existing.some(idx => idx && idx.name === indexName);
        if (found) {
            await collection.dropIndex(indexName);
            return true;
        }
    } catch (err) {
        if (err && (err.code === 26 || err.codeName === 'NamespaceNotFound' || err.code === 27 || err.codeName === 'IndexNotFound')) {
            return false;
        }
        throw err;
    }
    return false;
}

/**
 * Safely cleans legacy duplicate pending friend requests (same direction or cross-direction)
 * prior to creating partial unique indexes, preserving the oldest request per pair.
 */
async function deduplicatePendingFriendRequests(friendRequestsCol) {
    if (!friendRequestsCol || typeof friendRequestsCol.find !== 'function') return 0;
    const pendingDocs = await friendRequestsCol.find({ status: 'pending' }).toArray();
    if (!Array.isArray(pendingDocs) || pendingDocs.length === 0) return 0;

    pendingDocs.sort((a, b) => {
        const ta = new Date(a.created_at || 0).getTime() || 0;
        const tb = new Date(b.created_at || 0).getTime() || 0;
        return ta - tb;
    });

    const seenPairs = new Set();
    let updatedOrDeleted = 0;

    for (const doc of pendingDocs) {
        const from = typeof doc.from === 'string' ? doc.from.trim().toLowerCase() : '';
        const to = typeof doc.to === 'string' ? doc.to.trim().toLowerCase() : '';
        if (!from || !to) continue;
        const pairKey = [from, to].sort().join('|');
        if (seenPairs.has(pairKey)) {
            if (doc.id && typeof friendRequestsCol.deleteOne === 'function') {
                await friendRequestsCol.deleteOne({ id: doc.id });
                updatedOrDeleted += 1;
            }
            continue;
        }
        seenPairs.add(pairKey);

        const patch = {};
        if (doc.from !== from) patch.from = from;
        if (doc.to !== to) patch.to = to;
        if (doc.pending_pair_key !== pairKey) patch.pending_pair_key = pairKey;
        if (Object.keys(patch).length > 0 && doc.id && typeof friendRequestsCol.updateOne === 'function') {
            await friendRequestsCol.updateOne({ id: doc.id }, { $set: patch });
            updatedOrDeleted += 1;
        }
    }

    return updatedOrDeleted;
}

/**
 * Idempotently creates or safely upgrades an index without failing on Option/Key conflicts.
 */
async function ensureIndex(collection, keys, options) {
    if (!collection || typeof collection.createIndex !== 'function') return options.name;

    if (typeof collection.indexes === 'function') {
        let existing = [];
        try {
            existing = await collection.indexes();
        } catch (err) {
            if (!(err && (err.code === 26 || err.codeName === 'NamespaceNotFound'))) {
                throw err;
            }
        }

        const byName = Array.isArray(existing) ? existing.find(idx => idx && idx.name === options.name) : null;
        if (byName) {
            if (keysMatchInOrder(byName.key, keys) && optionsMatch(byName, options)) {
                return byName.name;
            }
            if (typeof collection.dropIndex === 'function') {
                await collection.dropIndex(options.name);
            }
        } else if (Array.isArray(existing)) {
            const byKeys = existing.find(idx => idx && keysMatchInOrder(idx.key, keys));
            if (byKeys && optionsMatch(byKeys, options)) {
                return byKeys.name;
            }
            if (byKeys && typeof collection.dropIndex === 'function' && byKeys.name !== '_id_') {
                await collection.dropIndex(byKeys.name);
            }
        }
    }

    return await collection.createIndex(keys, options);
}

/**
 * Initializes target collections and creates required indexes for the Memory Book domain.
 * Safe and idempotent to run repeatedly across deployments and restarts.
 * Preserves the custom A–Z bucket_id compound index for user lookups.
 *
 * @param {import('mongodb').Db} [targetDb] Database instance to initialize (defaults to active Db)
 * @returns {Promise<object>} Map of created/verified index names by collection
 */
async function initializeIndexes(targetDb = null) {
    const db = targetDb || getDb();
    const results = {};

    // Drop legacy/speculative indexes before ensuring current definitions
    for (const [colName, obsoleteNames] of Object.entries(LEGACY_DROPPED_INDEXES)) {
        const col = db.collection(colName);
        for (const oldName of obsoleteNames) {
            await dropIndexIfExists(col, oldName);
        }
    }

    // Backfill pending_pair_key & collapse legacy duplicate pending requests ONLY when partial unique indexes are not yet present
    const freqCol = db.collection(COLLECTIONS.FRIEND_REQUESTS);
    let needPendingDedup = true;
    if (typeof freqCol.indexes === 'function') {
        try {
            const freqExisting = await freqCol.indexes();
            const hasDirectionUnique = Array.isArray(freqExisting) && freqExisting.some(idx => idx && idx.name === 'idx_freq_pending_direction_unique' && idx.unique);
            const hasPairUnique = Array.isArray(freqExisting) && freqExisting.some(idx => idx && idx.name === 'idx_freq_pending_pair_unique' && idx.unique);
            if (hasDirectionUnique && hasPairUnique) {
                needPendingDedup = false;
            }
        } catch (err) {
            if (!(err && (err.code === 26 || err.codeName === 'NamespaceNotFound'))) {
                throw err;
            }
        }
    }
    if (needPendingDedup) {
        await deduplicatePendingFriendRequests(freqCol);
    }

    for (const [colName, specs] of Object.entries(INDEX_DEFINITIONS)) {
        const col = db.collection(colName);
        const created = [];
        for (const spec of specs) {
            const name = await ensureIndex(col, spec.keys, spec.options);
            created.push(name);
        }
        results[colName] = created;
    }

    return results;
}

/**
 * Checks whether the active MongoDB connection topology supports replica-set ACID transactions.
 * Standalone MongoDB instances fall back safely to application-level sagas.
 *
 * @returns {Promise<boolean>}
 */
async function canUseTransactions() {
    try {
        if (!isConnected()) return false;
        const client = getClient();
        if (!client || typeof client.startSession !== 'function') return false;
        if (client.supportsTransactions === true) return true;
        const topoType = client.topology && client.topology.description && client.topology.description.type;
        if (topoType === 'ReplicaSetWithPrimary' || topoType === 'Sharded') {
            return true;
        }
        if (process.env.MONGODB_USE_TRANSACTIONS === 'true') return true;
        if (dbInstance && typeof dbInstance.command === 'function') {
            const hello = await dbInstance.command({ hello: 1 });
            return !!(hello && (hello.setName || hello.msg === 'isdbgrid'));
        }
        return false;
    } catch (_) {
        return false;
    }
}

/**
 * Identifies errors returned when starting a transaction against a non-replica-set topology.
 *
 * @param {Error} err
 * @returns {boolean}
 */
function isUnsupportedTransactionError(err) {
    if (!err) return false;
    const msg = String(err.message || '');
    const orig = err.originalError || err.cause || {};
    return err.code === 20 ||
        orig.code === 20 ||
        err.codeName === 'IllegalOperation' ||
        orig.codeName === 'IllegalOperation' ||
        /Transaction numbers are only allowed on a replica set member or mongos/i.test(msg) ||
        /does not support retryable writes/i.test(msg);
}

module.exports = {
    COLLECTIONS,
    connect,
    getDb,
    getClient,
    getCollection,
    isConnected,
    ping,
    close,
    startReconnectLoop,
    stopReconnectLoop,
    initializeIndexes,
    canUseTransactions,
    isUnsupportedTransactionError
};
