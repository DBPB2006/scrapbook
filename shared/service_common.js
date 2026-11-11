/**
 * Shared Microservice Utilities
 * Scrapbook Platform
 */

const crypto = require('crypto');

function normalizeEmail(email) {
    if (!email || typeof email !== 'string') return '';
    return email.trim().toLowerCase();
}

function escapeRegex(str) {
    return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeFriendId(value) {
    if (typeof value === 'string') return value.trim().toLowerCase();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    return '';
}

function getFriendEntryIdentity(entry) {
    if (!entry) return '';
    if (typeof entry === 'string') return normalizeEmail(entry);
    if (typeof entry !== 'object') return '';
    return normalizeEmail(entry.email) || normalizeFriendId(entry.friend_id) || normalizeFriendId(entry.id) || '';
}

function friendEntryMatchesEmail(entry, targetEmail) {
    const target = normalizeEmail(targetEmail);
    if (!target || !entry) return false;
    if (typeof entry === 'string') {
        return normalizeEmail(entry) === target;
    }
    if (typeof entry === 'object') {
        return normalizeEmail(entry.email) === target ||
            normalizeFriendId(entry.friend_id) === target ||
            normalizeFriendId(entry.id) === target;
    }
    return false;
}

function removeEmailFromFriendsArray(friends, targetEmail) {
    if (!Array.isArray(friends)) return { changed: false, updated: friends };
    const targetNorm = normalizeEmail(targetEmail);
    let changed = false;
    const updated = [];

    for (const entry of friends) {
        if (!entry) continue;
        if (friendEntryMatchesEmail(entry, targetNorm)) {
            changed = true;
            continue;
        }
        if (typeof entry === 'string' || typeof entry === 'object') {
            updated.push(entry);
        }
    }

    return { changed, updated };
}

function replaceEmailInFriendsArray(friends, oldEmail, newEmail) {
    if (!Array.isArray(friends)) return { changed: false, updated: friends };
    const oldNorm = normalizeEmail(oldEmail);
    const newNorm = normalizeEmail(newEmail);
    let changed = false;
    const seen = new Set();
    const updated = [];

    for (const entry of friends) {
        if (!entry) continue;
        let next = entry;

        if (typeof entry === 'string') {
            if (normalizeEmail(entry) === oldNorm) {
                next = newNorm;
                changed = true;
            }
        } else if (typeof entry === 'object') {
            const copy = { ...entry };
            let entryChanged = false;
            if (normalizeEmail(copy.email) === oldNorm) {
                copy.email = newNorm;
                entryChanged = true;
            }
            if (typeof copy.friend_id === 'string' && normalizeEmail(copy.friend_id) === oldNorm) {
                copy.friend_id = newNorm;
                entryChanged = true;
            }
            if (typeof copy.id === 'string' && normalizeEmail(copy.id) === oldNorm) {
                copy.id = newNorm;
                entryChanged = true;
            }
            if (entryChanged && normalizeEmail(copy.name) === oldNorm) {
                copy.name = newNorm;
            }
            if (entryChanged) changed = true;
            next = copy;
        } else {
            continue;
        }

        const key = getFriendEntryIdentity(next);
        if (key) {
            if (seen.has(key)) {
                changed = true;
                continue;
            }
            seen.add(key);
        }
        updated.push(next);
    }

    return { changed, updated };
}

function timingSafeSecretEquals(provided, expected) {
    if (typeof provided !== 'string' || typeof expected !== 'string' || !provided || !expected) {
        return false;
    }
    const a = Buffer.from(provided, 'utf8');
    const b = Buffer.from(expected, 'utf8');
    if (a.length !== b.length) {
        crypto.timingSafeEqual(b, b);
        return false;
    }
    return crypto.timingSafeEqual(a, b);
}

function createIsAuthenticated(gatewaySecret, internalSecret, isProduction = (process.env.NODE_ENV === 'production'), { allowMissingEmail = false } = {}) {
    return (req, res, next) => {
        const normalized = normalizeEmail(req.headers['x-user-email']);
        const hasValidSecret = timingSafeSecretEquals(req.headers['x-gateway-secret'], gatewaySecret) ||
            timingSafeSecretEquals(req.headers['x-internal-secret'], internalSecret);
        if ((isProduction && !hasValidSecret) || (!allowMissingEmail && !normalized)) {
            return res.status(401).json({ error: 'Unauthorized: Valid authenticated session required' });
        }
        req.userEmail = normalized;
        next();
    };
}

function createIsInternalService(internalSecret) {
    return (req, res, next) => {
        const secret = req.headers['x-internal-secret'];
        if (!timingSafeSecretEquals(secret, internalSecret)) {
            return res.status(403).json({ error: 'Access denied: Internal service authorization required.' });
        }
        next();
    };
}

const HEALTH_DB_PING_TIMEOUT_MS = 2000;

function registerHealthRoutes({ app, serviceName, displayName, mongodb, isDbConnected, onConnected = null }) {
    const reconnectOpts = onConnected
        ? { serviceName: displayName, onConnected }
        : { serviceName: displayName };

    app.get('/health/live', (req, res) => {
        res.status(200).json({
            status: 'UP',
            service: serviceName
        });
    });

    app.get('/health', async (req, res) => {
        const connected = !!(
            mongodb &&
            isDbConnected() &&
            (typeof mongodb.ping === 'function' ? await mongodb.ping(HEALTH_DB_PING_TIMEOUT_MS) : true)
        );
        if (!connected && mongodb && process.env.MONGODB_URI && typeof mongodb.startReconnectLoop === 'function') {
            mongodb.startReconnectLoop(reconnectOpts);
        }
        res.status(connected ? 200 : 503).json({
            status: connected ? 'UP' : 'DOWN',
            service: serviceName,
            database: connected ? 'connected' : 'disconnected'
        });
    });
}

function createServiceStarter({ app, port, displayName, mongodb, onConnected = null }) {
    let serverInstance = null;

    return async function startServer() {
        const reconnectOpts = onConnected
            ? { serviceName: displayName, onConnected }
            : { serviceName: displayName };

        if (mongodb && process.env.MONGODB_URI) {
            try {
                const { db } = await mongodb.connect();
                await mongodb.initializeIndexes(db);
                console.log(`${displayName}: Successfully connected to MongoDB and initialized indexes.`);
                if (typeof onConnected === 'function') {
                    await onConnected(db);
                }
            } catch (err) {
                console.error(`${displayName}: Error - MongoDB connection failed on startup:`, err.message);
                if (process.env.MONGODB_FAIL_FAST === 'true') {
                    process.exit(1);
                }
                if (typeof mongodb.startReconnectLoop === 'function') {
                    mongodb.startReconnectLoop(reconnectOpts);
                }
            }
        } else {
            console.warn(`${displayName}: Warning - No MONGODB_URI configured.`);
        }

        serverInstance = app.listen(port, () => {
            console.log(`${displayName} running on port ${port}`);
        });

        let shuttingDown = false;
        const shutdown = async () => {
            if (shuttingDown) return;
            shuttingDown = true;
            console.log('Shutting down gracefully...');
            if (mongodb && typeof mongodb.stopReconnectLoop === 'function') {
                mongodb.stopReconnectLoop();
            }
            const forceTimer = setTimeout(() => {
                console.warn('Forced shutdown after timeout.');
                process.exit(0);
            }, 5000);
            if (typeof forceTimer.unref === 'function') forceTimer.unref();

            if (serverInstance) {
                serverInstance.close(async () => {
                    if (mongodb && mongodb.isConnected()) {
                        try {
                            await mongodb.close();
                            console.log('MongoDB connection closed.');
                        } catch (err) {
                            console.error('Error closing MongoDB connection:', err.message);
                        }
                    }
                    console.log('Closed out remaining connections');
                    process.exit(0);
                });
                if (typeof serverInstance.closeIdleConnections === 'function') {
                    serverInstance.closeIdleConnections();
                }
            } else {
                if (mongodb && mongodb.isConnected()) {
                    try { await mongodb.close(); } catch (_) {}
                }
                process.exit(0);
            }
        };

        process.on('SIGINT', shutdown);
        process.on('SIGTERM', shutdown);

        return serverInstance;
    };
}

module.exports = {
    normalizeEmail,
    escapeRegex,
    friendEntryMatchesEmail,
    removeEmailFromFriendsArray,
    replaceEmailInFriendsArray,
    createIsAuthenticated,
    createIsInternalService,
    registerHealthRoutes,
    createServiceStarter
};
