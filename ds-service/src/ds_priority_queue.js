class PriorityQueue {
    constructor() {
        this.queue = [];
    }

    insert(item, priority) {
        this.queue.push({ item, priority });
    }

    pop() {
        if (this.queue.length === 0) return null;
        let minIdx = 0;
        for (let i = 1; i < this.queue.length; i++) {
            if (new Date(this.queue[i].priority) < new Date(this.queue[minIdx].priority)) {
                minIdx = i;
            }
        }
        const item = this.queue[minIdx].item;
        this.queue.splice(minIdx, 1);
        return item;
    }

    peek() {
        if (this.queue.length === 0) return null;
        let minIdx = 0;
        for (let i = 1; i < this.queue.length; i++) {
            if (new Date(this.queue[i].priority) < new Date(this.queue[minIdx].priority)) {
                minIdx = i;
            }
        }
        return this.queue[minIdx].item;
    }

    toSortedArray() {
        const sorted = [...this.queue];
        sorted.sort((a, b) => new Date(a.priority) - new Date(b.priority));
        return sorted.map(entry => entry.item);
    }

    isEmpty() {
        return this.queue.length === 0;
    }

    size() {
        return this.queue.length;
    }
}

module.exports = {
    PriorityQueue
};
