/**
 * Efficient FIFO Queue implementation using moving front pointer.
 * Guarantees O(1) amortized enqueue and dequeue operations without
 * the O(N) array-shift overhead.
 */
class SocialQueue {
    constructor() {
        this.items = [];
        this.frontIndex = 0;
    }

    enqueue(item) {
        this.items.push(item);
    }

    dequeue() {
        if (this.isEmpty()) {
            return undefined;
        }
        const item = this.items[this.frontIndex];
        this.frontIndex++;

        // Periodic memory compaction when frontIndex exceeds threshold
        if (this.frontIndex > 100 && this.frontIndex > this.items.length / 2) {
            this.items = this.items.slice(this.frontIndex);
            this.frontIndex = 0;
        }

        return item;
    }

    peek() {
        if (this.isEmpty()) return undefined;
        return this.items[this.frontIndex];
    }

    isEmpty() {
        return this.frontIndex >= this.items.length;
    }

    size() {
        return this.items.length - this.frontIndex;
    }

    clear() {
        this.items = [];
        this.frontIndex = 0;
    }
}

module.exports = { SocialQueue, Queue: SocialQueue };

