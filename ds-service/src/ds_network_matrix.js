const { Queue } = require('./ds_queue');

function buildNodesAndIndexMap(usersData) {
    const registeredUsers = {};
    for (const bucket in usersData) {
        for (const email in usersData[bucket]) {
            registeredUsers[email] = usersData[bucket][email];
        }
    }
    const nodes = {};
    for (const email in registeredUsers) {
        const user = registeredUsers[email];
        if (!nodes[email]) {
            nodes[email] = {
                name: user.name || user.username || email,
                registered: true
            };
        }
        if (Array.isArray(user.friends)) {
            for (const f of user.friends) {
                const fEmail = f.email;
                if (!nodes[fEmail]) {
                    nodes[fEmail] = {
                        name: f.name || fEmail,
                        registered: !!registeredUsers[fEmail]
                    };
                }
            }
        }
    }
    const emails = Object.keys(nodes);
    const indexMap = {};
    emails.forEach((email, i) => {
        indexMap[email] = i;
    });
    return [nodes, emails, indexMap];
}

function buildFriendshipMatrix(nodes, indexMap, registeredUsers) {
    const size = Object.keys(nodes).length;
    const matrix = Array.from({ length: size }, () => Array(size).fill(0));
    
    for (const email in registeredUsers) {
        if (indexMap[email] === undefined) continue;
        const i = indexMap[email];
        const user = registeredUsers[email];
        if (Array.isArray(user.friends)) {
            for (const friend of user.friends) {
                const fEmail = friend.email;
                if (indexMap[fEmail] !== undefined) {
                    const j = indexMap[fEmail];
                    matrix[i][j] = 1;
                }
            }
        }
    }
    return matrix;
}

function buildMemoryFrequencyMatrix(nodes, indexMap, memories) {
    const size = Object.keys(nodes).length;
    const matrix = Array.from({ length: size }, () => Array(size).fill(0));
    
    for (const memory of memories) {
        const owner = memory.owner;
        if (indexMap[owner] === undefined) continue;
        const i = indexMap[owner];
        if (Array.isArray(memory.friends)) {
            for (const fEmail of memory.friends) {
                if (indexMap[fEmail] !== undefined) {
                    const j = indexMap[fEmail];
                    matrix[i][j]++;
                    matrix[j][i]++;
                }
            }
        }
    }
    return matrix;
}

function getFriendSuggestions(friendshipMatrix, indexMap, emails, startEmail, friendGraph) {
    const suggestions = [];
    if (indexMap[startEmail] === undefined) return suggestions;
    
    const startIndex = indexMap[startEmail];
    const queue = new Queue();
    queue.enqueue([startIndex, 0]);
    const visited = [];
    const alreadyFriends = [startIndex];
    
    if (friendGraph[startEmail]) {
        for (const fEmail of friendGraph[startEmail]) {
            if (indexMap[fEmail] !== undefined) {
                alreadyFriends.push(indexMap[fEmail]);
            }
        }
    }
    
    while (!queue.isEmpty()) {
        const [node, level] = queue.dequeue();
        if (visited.includes(node)) continue;
        visited.push(node);
        
        if (level >= 2 && !alreadyFriends.includes(node)) {
            suggestions.push(emails[node]);
            if (suggestions.length >= 10) break;
        }
        
        if (level < 3) {
            for (let i = 0; i < friendshipMatrix[node].length; i++) {
                if (friendshipMatrix[node][i] === 1 && !visited.includes(i)) {
                    queue.enqueue([i, level + 1]);
                }
            }
        }
    }
    
    if (suggestions.length < 5) {
        for (let index = 0; index < emails.length; index++) {
            const email = emails[index];
            if (!alreadyFriends.includes(index) && !suggestions.includes(email)) {
                suggestions.push(email);
                if (suggestions.length >= 5) break;
            }
        }
    }
    
    return suggestions;
}

module.exports = {
    buildNodesAndIndexMap,
    buildFriendshipMatrix,
    buildMemoryFrequencyMatrix,
    getFriendSuggestions
};
