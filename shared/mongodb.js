/**
 * MongoDB Community Server Connection Foundation
 * Memory Book Platform - Shared Database Client Module
 *
 * Provides a production-grade, process-level singleton connection pool
 * using the official MongoDB driver (MongoClient).
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

// Process-level singletons
let clientInstance = null;
let dbInstance = null;
let connectionPromise = null;

/**
 * Sanitizes connection URI to safely mask credentials in logs.
 * Example: mongodb://admin:secret123@host:27017 -> mongodb://admin:***@host:27017
 */
function maskUri(uri) {
    if (!uri || typeof uri !== 'string') return '';
    return uri.replace(/(mongodb(?:\+srv)?:\/\/[^:]+:)([^@]+)(@)/, '$1***$3');
}

/**
 * Builds MongoClient options from environment configuration.
 * Standard options for self-hosted MongoDB Community Server.
 */
function buildClientOptions(overrides = {}) {
    const options = {
        maxPoolSize: parseInt(process.env.MONGODB_POOL_MAX || '20', 10),
        minPoolSize: parseInt(process.env.MONGODB_POOL_MIN || '2', 10),
        connectTimeoutMS: parseInt(process.env.MONGODB_CONNECT_TIMEOUT_MS || '10000', 10),
        socketTimeoutMS: parseInt(process.env.MONGODB_SOCKET_TIMEOUT_MS || '45000', 10),
        serverSelectionTimeoutMS: parseInt(process.env.MONGODB_SERVER_SELECTION_TIMEOUT_MS || '10000', 10),
        ...overrides
    };

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
 * @param {string} [databaseName] Optional DB name override (defaults to MONGODB_DATABASE or 'memorybook')
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

    const targetUri = uri || 
                      process.env.MONGODB_URI || 
                      'mongodb://127.0.0.1:27017/memorybook';

    const targetDbName = databaseName || 
                         process.env.MONGODB_DATABASE || 
                         'memorybook';

    const clientOptions = buildClientOptions(customOptions);

    connectionPromise = (async () => {
        try {
            const client = new MongoClient(targetUri, clientOptions);
            await client.connect();

            const db = client.db(targetDbName);

            // Verify connectivity via ping command
            await db.command({ ping: 1 });

            clientInstance = client;
            dbInstance = db;

            // Handle unexpected disconnections
            client.on('close', () => {
                clientInstance = null;
                dbInstance = null;
                connectionPromise = null;
            });

            return { client: clientInstance, db: dbInstance };
        } catch (error) {
            // Reset connection promise on failure so retries can occur
            connectionPromise = null;
            clientInstance = null;
            dbInstance = null;
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
 * Gracefully shuts down the connection pool.
 * @param {boolean} [force=false]
 * @returns {Promise<void>}
 */
async function close(force = false) {
    if (clientInstance) {
        try {
            await clientInstance.close(force);
        } finally {
            clientInstance = null;
            dbInstance = null;
            connectionPromise = null;
        }
    }
}

/**
 * Initializes target collections and creates required indexes for the Memory Book domain.
 * Preserves the custom A–Z bucket_id compound index for user lookups.
 *
 * @param {import('mongodb').Db} [targetDb] Database instance to initialize (defaults to active Db)
 * @returns {Promise<object>} Map of created index names by collection
 */
async function initializeIndexes(targetDb = null) {
    const db = targetDb || getDb();
    const results = {};

    // 1. Users collection
    // - Unique email
    // - Unique username (sparse to allow legacy accounts)
    // - Compound index on { bucket_id: 1, email: 1 } for custom A-Z bucket partitioning
    const users = db.collection(COLLECTIONS.USERS);
    results.users = await Promise.all([
        users.createIndex({ email: 1 }, { unique: true, name: 'idx_users_email_unique' }),
        users.createIndex({ username: 1 }, { unique: true, sparse: true, name: 'idx_users_username_unique' }),
        users.createIndex({ bucket_id: 1, email: 1 }, { name: 'idx_users_bucket_email' })
    ]);

    // 2. Memories collection
    // - Unique memory_id string identifier
    // - Compound index on { owner: 1, date: -1, created_at: -1 } for chronological ordering & keyset pagination
    // - Index on tags for memory filtering
    const memories = db.collection(COLLECTIONS.MEMORIES);
    results.memories = await Promise.all([
        memories.createIndex({ memory_id: 1 }, { unique: true, name: 'idx_memories_id_unique' }),
        memories.createIndex({ owner: 1, date: -1, created_at: -1 }, { name: 'idx_memories_owner_chronological' }),
        memories.createIndex({ owner: 1, tags: 1 }, { name: 'idx_memories_owner_tags' })
    ]);

    // 3. Friend Requests collection
    // - Unique request id
    // - Compound index on { from: 1, to: 1, status: 1 } to prevent duplicate pending requests
    // - Incoming queries: { to: 1, status: 1 }
    // - Outgoing queries: { from: 1, status: 1 }
    const friendRequests = db.collection(COLLECTIONS.FRIEND_REQUESTS);
    results.friend_requests = await Promise.all([
        friendRequests.createIndex({ id: 1 }, { unique: true, name: 'idx_freq_id_unique' }),
        friendRequests.createIndex({ from: 1, to: 1, status: 1 }, { name: 'idx_freq_direction_status' }),
        friendRequests.createIndex({ to: 1, status: 1 }, { name: 'idx_freq_incoming_status' }),
        friendRequests.createIndex({ from: 1, status: 1 }, { name: 'idx_freq_outgoing_status' })
    ]);

    // 4. Time Capsules collection
    // - Unique capsule id
    // - Recipient & status queries: { recipient_email: 1, unlocked: 1 }
    // - Sender queries: { user_email: 1 }
    // - Reveal date index: { reveal_date: 1, unlocked: 1 } for chronological sort & lock checks
    const timeCapsules = db.collection(COLLECTIONS.TIME_CAPSULES);
    results.time_capsules = await Promise.all([
        timeCapsules.createIndex({ id: 1 }, { unique: true, name: 'idx_tc_id_unique' }),
        timeCapsules.createIndex({ recipient_email: 1, unlocked: 1 }, { name: 'idx_tc_recipient_unlocked' }),
        timeCapsules.createIndex({ user_email: 1 }, { name: 'idx_tc_sender' }),
        timeCapsules.createIndex({ reveal_date: 1, unlocked: 1 }, { name: 'idx_tc_reveal_unlocked' })
    ]);

    // 5. Shared Memories collection
    // - Unique shared memory id
    // - Unseen queries: { to: 1, seen: 1 }
    // - Sender queries: { from: 1, date: -1 }
    // - Recipient queries: { to: 1, date: -1 }
    const sharedMemories = db.collection(COLLECTIONS.SHARED_MEMORIES);
    results.shared_memories = await Promise.all([
        sharedMemories.createIndex({ memory_id: 1 }, { unique: true, name: 'idx_shared_mem_id_unique' }),
        sharedMemories.createIndex({ to: 1, seen: 1 }, { name: 'idx_shared_to_seen' }),
        sharedMemories.createIndex({ from: 1, date: -1 }, { name: 'idx_shared_from_date' }),
        sharedMemories.createIndex({ to: 1, date: -1 }, { name: 'idx_shared_to_date' })
    ]);

    return results;
}

module.exports = {
    COLLECTIONS,
    connect,
    getDb,
    getClient,
    getCollection,
    isConnected,
    close,
    initializeIndexes,
    maskUri,
    buildClientOptions
};

