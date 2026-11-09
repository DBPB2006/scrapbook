const { SocialQueue } = require('./social_queue');

/**
 * Undirected Social Graph represented using an Adjacency List (Synopsis §6.2).
 * Space Complexity: O(V + E)
 * Edge Insertion / Removal: O(1)
 * Neighbor Lookup: O(1)
 */
class SocialGraph {
    constructor() {
        this.vertices = new Map();     // email -> { name, registered, ... }
        this.adjacencyList = new Map(); // email -> Set<friendEmail>
    }

    normalizeEmail(email) {
        if (!email || typeof email !== 'string') return '';
        return email.trim().toLowerCase();
    }

    addVertex(email, metadata = {}) {
        const normalized = this.normalizeEmail(email);
        if (!normalized) return false;

        if (!this.vertices.has(normalized)) {
            this.vertices.set(normalized, {
                email: normalized,
                name: metadata.name || metadata.username || normalized,
                registered: metadata.registered !== undefined ? metadata.registered : true,
                ...metadata
            });
        }

        if (!this.adjacencyList.has(normalized)) {
            this.adjacencyList.set(normalized, new Set());
        }
        return true;
    }

    hasVertex(email) {
        const normalized = this.normalizeEmail(email);
        return this.vertices.has(normalized);
    }

    getVertex(email) {
        const normalized = this.normalizeEmail(email);
        return this.vertices.get(normalized) || null;
    }

    getVertices() {
        return Array.from(this.vertices.keys());
    }

    addEdge(email1, email2) {
        const u = this.normalizeEmail(email1);
        const v = this.normalizeEmail(email2);
        if (!u || !v || u === v) return false;

        this.addVertex(u);
        this.addVertex(v);

        this.adjacencyList.get(u).add(v);
        this.adjacencyList.get(v).add(u);
        return true;
    }

    removeEdge(email1, email2) {
        const u = this.normalizeEmail(email1);
        const v = this.normalizeEmail(email2);
        if (!u || !v) return false;

        let removed = false;
        if (this.adjacencyList.has(u)) {
            removed = this.adjacencyList.get(u).delete(v) || removed;
        }
        if (this.adjacencyList.has(v)) {
            removed = this.adjacencyList.get(v).delete(u) || removed;
        }
        return removed;
    }

    hasEdge(email1, email2) {
        const u = this.normalizeEmail(email1);
        const v = this.normalizeEmail(email2);
        if (!u || !v) return false;
        return this.adjacencyList.has(u) && this.adjacencyList.get(u).has(v);
    }

    getNeighbors(email) {
        const normalized = this.normalizeEmail(email);
        if (!this.adjacencyList.has(normalized)) return [];
        return Array.from(this.adjacencyList.get(normalized));
    }

    vertexCount() {
        return this.vertices.size;
    }

    edgeCount() {
        let total = 0;
        for (const neighbors of this.adjacencyList.values()) {
            total += neighbors.size;
        }
        return Math.floor(total / 2); // Undirected edges counted once
    }

    /**
     * Rebuilds graph state from users database records.
     * Compatible with bucketed or flat user collections.
     */
    buildFromUsers(usersData) {
        this.vertices.clear();
        this.adjacencyList.clear();

        const registeredUsers = {};
        if (usersData && typeof usersData === 'object') {
            for (const key of Object.keys(usersData)) {
                const val = usersData[key];
                if (val && typeof val === 'object' && !val.email) {
                    // Bucketed structure: usersData['A']['alice@example.com']
                    for (const email of Object.keys(val)) {
                        registeredUsers[this.normalizeEmail(email)] = val[email];
                    }
                } else if (val && val.email) {
                    // Flat map: usersData['alice@example.com']
                    registeredUsers[this.normalizeEmail(val.email)] = val;
                }
            }
        }

        // 1. Add all registered users as vertices
        for (const email of Object.keys(registeredUsers)) {
            const u = registeredUsers[email];
            this.addVertex(email, {
                name: u.name || u.username || email,
                registered: true
            });
        }

        // 2. Add edges for all friendships
        for (const email of Object.keys(registeredUsers)) {
            const u = registeredUsers[email];
            if (Array.isArray(u.friends)) {
                for (const friend of u.friends) {
                    const fEmail = this.normalizeEmail(friend.email || friend.id || friend.friend_id);
                    if (fEmail) {
                        this.addVertex(fEmail, {
                            name: friend.name || fEmail,
                            registered: !!registeredUsers[fEmail]
                        });
                        this.addEdge(email, fEmail);
                    }
                }
            }
        }
    }

    /**
     * Serializes to Adjacency List representation.
     */
    toAdjacencyList() {
        const result = {};
        for (const [email, neighbors] of this.adjacencyList.entries()) {
            result[email] = Array.from(neighbors);
        }
        return result;
    }

    /**
     * Builds nodes, emails list, and index mapping for frontend visualization.
     */
    buildNodesAndIndexMap() {
        const nodes = {};
        const emails = [];
        const emailIndexMap = {};

        let idx = 0;
        for (const [email, meta] of this.vertices.entries()) {
            nodes[email] = {
                email,
                name: meta.name || email,
                registered: meta.registered
            };
            emails.push(email);
            emailIndexMap[email] = idx;
            idx++;
        }
        return [nodes, emails, emailIndexMap];
    }

    /**
     * Bounded Breadth-First Search (BFS) for friend recommendations (Synopsis §6.2).
     * Explores graph level by level up to maxDepth (level 2: friends-of-friends).
     * Excludes self, direct friends, and duplicate candidates.
     * Time Complexity: O(V + E) over visited subgraph
     */
    findFriendSuggestions(startEmail, maxSuggestions = 10, maxDepth = 2) {
        const start = this.normalizeEmail(startEmail);
        if (!start || !this.adjacencyList.has(start)) {
            return [];
        }

        const directFriends = this.adjacencyList.get(start);
        const visited = new Set();
        visited.add(start);

        const queue = new SocialQueue();
        queue.enqueue([start, 0]);

        const suggestions = [];
        const candidateSet = new Set();

        while (!queue.isEmpty()) {
            const [current, depth] = queue.dequeue();

            if (depth >= 2 && current !== start && !directFriends.has(current) && !candidateSet.has(current)) {
                candidateSet.add(current);
                suggestions.push(current);
                if (suggestions.length >= maxSuggestions) {
                    break;
                }
            }

            if (depth < maxDepth) {
                const neighbors = this.adjacencyList.get(current);
                if (neighbors) {
                    for (const neighbor of neighbors) {
                        if (!visited.has(neighbor)) {
                            visited.add(neighbor);
                            queue.enqueue([neighbor, depth + 1]);
                        }
                    }
                }
            }
        }

        return suggestions;
    }
}

module.exports = { SocialGraph };

